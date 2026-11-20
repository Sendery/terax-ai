//! `terax --read`: hands a file or piped text to the running Terax, which
//! opens it in the Reader panel under the terminal that ran it (or a Reader
//! tab with `--tab`). Like `--mcp`, it runs before any Tauri state exists and
//! talks to the instance over the Pi bridge.

use std::io::{IsTerminal, Read, Write};
use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

use crate::modules::mcp::{Bridge, TcpBridge};
use crate::modules::pi::MAX_FRAME_BYTES;

pub const READ_FLAG: &str = "--read";
const STDIN_LIMIT: u64 = 2 * 1024 * 1024;
/// Text this small travels inline; larger text goes through a temp file.
const INLINE_TEXT_LIMIT: usize = 256 * 1024;
/// Room for the frame's version, id, token and command around the payload.
const FRAME_OVERHEAD: usize = 1024;

const USAGE: &str = "\
Usage: terax --read [FILE] [--title TITLE] [--no-play] [--tab]
       <command> | terax --read [--title TITLE] [--no-play] [--tab]

Opens FILE, or text piped on stdin, in the Terax Reader panel under this
terminal (the tab on screen when run outside a Terax terminal).
  --title TITLE   name shown in the panel and the library
  --no-play       open without starting playback
  --tab           open in a Reader tab instead of the panel";

#[derive(Debug, PartialEq, Eq)]
pub struct ReadArgs {
    pub file: Option<String>,
    pub title: Option<String>,
    pub play: bool,
    /// Open in a Reader tab rather than the panel under the terminal.
    pub tab: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ReadCommand {
    Help,
    Open(ReadArgs),
}

pub fn is_read_invocation() -> bool {
    std::env::args().nth(1).as_deref() == Some(READ_FLAG)
}

/// Parses the arguments that follow `--read`. A lone `-` means stdin.
pub fn parse_read_args(args: &[String]) -> Result<ReadCommand, String> {
    let mut file: Option<String> = None;
    let mut title: Option<String> = None;
    let mut play = true;
    let mut tab = false;
    let mut options_done = false;
    let mut iter = args.iter();
    fn set_file(value: &str, file: &mut Option<String>) -> Result<(), String> {
        if file.is_some() {
            return Err(format!("unexpected extra argument: {value}"));
        }
        if value != "-" {
            *file = Some(value.to_string());
        }
        Ok(())
    }
    while let Some(arg) = iter.next() {
        if options_done || arg == "-" || !arg.starts_with('-') {
            set_file(arg, &mut file)?;
            continue;
        }
        match arg.as_str() {
            "--" => options_done = true,
            "-h" | "--help" => return Ok(ReadCommand::Help),
            "--no-play" => play = false,
            "--tab" => tab = true,
            "--title" => {
                let value = iter.next().ok_or("--title needs a value")?;
                title = Some(value.clone());
            }
            other => match other.strip_prefix("--title=") {
                Some(value) => title = Some(value.to_string()),
                None => return Err(format!("unknown option: {other}")),
            },
        }
    }
    let title = title
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());
    Ok(ReadCommand::Open(ReadArgs {
        file,
        title,
        play,
        tab,
    }))
}

/// The pty of the Terax terminal this runs in, from `TERAX_PTY_ID`.
pub fn caller_pty_id(value: Option<&str>) -> Option<u64> {
    value?.trim().parse().ok()
}

/// Names the calling terminal, so the panel opens under its tab. Left out
/// with `--tab`, which never docks.
pub fn add_caller(payload: &mut Value, pty_id: Option<u64>, tab: bool) {
    if tab {
        return;
    }
    if let (Some(id), Value::Object(fields)) = (pty_id, payload) {
        fields.insert("callerPtyId".into(), json!(id));
    }
}

fn base_payload(title: Option<&str>, play: bool) -> Map<String, Value> {
    let mut payload = Map::new();
    if let Some(title) = title {
        payload.insert("title".into(), json!(title));
    }
    payload.insert("play".into(), json!(play));
    payload
}

pub fn path_payload(path: &Path, title: Option<&str>, play: bool, stdin: bool) -> Value {
    let mut payload = base_payload(title, play);
    payload.insert("path".into(), json!(path.to_string_lossy()));
    if stdin {
        payload.insert("stdin".into(), json!(true));
    }
    Value::Object(payload)
}

/// The inline `{ text }` payload, or `None` when the text should go through a
/// file instead: past the inline limit, or when JSON escaping would push the
/// bridge frame over its cap.
pub fn inline_text_payload(text: &str, title: Option<&str>, play: bool) -> Option<Value> {
    if text.len() >= INLINE_TEXT_LIMIT {
        return None;
    }
    let mut payload = base_payload(title, play);
    payload.insert("text".into(), json!(text));
    let payload = Value::Object(payload);
    let size = serde_json::to_string(&payload).ok()?.len() + FRAME_OVERHEAD;
    (size <= MAX_FRAME_BYTES).then_some(payload)
}

pub fn absolute_path(file: &str, cwd: &Path) -> PathBuf {
    let path = Path::new(file);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    }
}

fn read_stdin_text() -> Result<String, String> {
    let mut bytes = Vec::new();
    std::io::stdin()
        .lock()
        .take(STDIN_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("cannot read stdin: {e}"))?;
    if bytes.len() as u64 > STDIN_LIMIT {
        return Err("stdin is larger than the 2 MiB Reader limit".into());
    }
    String::from_utf8(bytes).map_err(|_| "stdin is not UTF-8 text".into())
}

fn private_temp_file(text: &str) -> Result<tempfile::NamedTempFile, String> {
    // tempfile creates the file 0600 with a random name under temp_dir().
    let mut file = tempfile::Builder::new()
        .prefix("terax-read-")
        .suffix(".txt")
        .tempfile()
        .map_err(|e| format!("cannot create a temp file: {e}"))?;
    file.write_all(text.as_bytes())
        .and_then(|()| file.flush())
        .map_err(|e| format!("cannot write a temp file: {e}"))?;
    Ok(file)
}

fn opened_title(reply: &Value, fallback: &str) -> String {
    reply
        .get("title")
        .and_then(Value::as_str)
        .filter(|t| !t.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn run_open(args: ReadArgs, bridge: &dyn Bridge) -> i32 {
    let title = args.title.as_deref();
    // Held until the call returns: the app copies the text into its own
    // library before answering, and dropping the handle deletes the file.
    let mut _temp: Option<tempfile::NamedTempFile> = None;
    let (payload, fallback) = match args.file {
        Some(file) => {
            let cwd = std::env::current_dir().unwrap_or_default();
            let path = absolute_path(&file, &cwd);
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or(file);
            (path_payload(&path, title, args.play, false), name)
        }
        None => {
            if std::io::stdin().is_terminal() {
                eprintln!("{USAGE}");
                return 2;
            }
            let text = match read_stdin_text() {
                Ok(text) => text,
                Err(e) => {
                    eprintln!("terax --read: {e}");
                    return 1;
                }
            };
            if text.trim().is_empty() {
                eprintln!("terax --read: nothing to read on stdin");
                return 1;
            }
            let payload = match inline_text_payload(&text, title, args.play) {
                Some(payload) => payload,
                None => match private_temp_file(&text) {
                    Ok(file) => {
                        let payload = path_payload(file.path(), title, args.play, true);
                        _temp = Some(file);
                        payload
                    }
                    Err(e) => {
                        eprintln!("terax --read: {e}");
                        return 1;
                    }
                },
            };
            (payload, "stdin".to_string())
        }
    };
    let mut payload = payload;
    if args.tab {
        if let Value::Object(fields) = &mut payload {
            fields.insert("placement".into(), json!("tab"));
        }
    }
    let pty = std::env::var(crate::modules::pty::shell_init::PTY_ID_ENV).ok();
    add_caller(&mut payload, caller_pty_id(pty.as_deref()), args.tab);
    match bridge.call("reader.open", payload) {
        Ok(reply) => {
            let shown = title.map(str::to_string).unwrap_or(fallback);
            println!("Opened in Terax Reader: {}", opened_title(&reply, &shown));
            0
        }
        Err(e) => {
            eprintln!("terax --read: {}", e.message);
            1
        }
    }
}

/// Entry point for `terax --read ...`. Returns the process exit code.
pub fn run() -> i32 {
    let args: Vec<String> = std::env::args().skip(2).collect();
    match parse_read_args(&args) {
        Ok(ReadCommand::Help) => {
            println!("{USAGE}");
            0
        }
        Ok(ReadCommand::Open(args)) => {
            let Some(bridge) = TcpBridge::from_env() else {
                eprintln!("terax --read: cannot resolve the Terax cache directory");
                return 1;
            };
            run_open(args, &bridge)
        }
        Err(e) => {
            eprintln!("terax --read: {e}\n\n{USAGE}");
            2
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::mcp::BridgeError;
    use std::cell::RefCell;

    fn parse(args: &[&str]) -> Result<ReadCommand, String> {
        parse_read_args(&args.iter().map(|s| s.to_string()).collect::<Vec<_>>())
    }

    fn open(file: Option<&str>, title: Option<&str>, play: bool) -> ReadCommand {
        ReadCommand::Open(ReadArgs {
            file: file.map(str::to_string),
            title: title.map(str::to_string),
            play,
            tab: false,
        })
    }

    #[test]
    fn tab_flag_asks_for_a_reader_tab() {
        match parse(&["--tab", "a.md"]).unwrap() {
            ReadCommand::Open(args) => {
                assert!(args.tab);
                assert_eq!(args.file.as_deref(), Some("a.md"));
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn parses_file_title_and_no_play_in_any_order() {
        assert_eq!(parse(&[]).unwrap(), open(None, None, true));
        assert_eq!(
            parse(&["notes.md"]).unwrap(),
            open(Some("notes.md"), None, true)
        );
        assert_eq!(
            parse(&["--no-play", "--title", "My notes", "a.md"]).unwrap(),
            open(Some("a.md"), Some("My notes"), false)
        );
        assert_eq!(
            parse(&["a.md", "--title=Chapter 1"]).unwrap(),
            open(Some("a.md"), Some("Chapter 1"), true)
        );
        assert_eq!(
            parse(&["-", "--title", "  "]).unwrap(),
            open(None, None, true)
        );
        assert_eq!(
            parse(&["--", "--weird.md"]).unwrap(),
            open(Some("--weird.md"), None, true)
        );
        assert_eq!(parse(&["x", "--help"]).unwrap(), ReadCommand::Help);
    }

    #[test]
    fn rejects_unknown_options_missing_values_and_extra_files() {
        assert!(parse(&["--titel", "x"])
            .unwrap_err()
            .contains("unknown option"));
        assert!(parse(&["--title"]).unwrap_err().contains("needs a value"));
        assert!(parse(&["a.md", "b.md"]).unwrap_err().contains("b.md"));
    }

    #[test]
    fn resolves_relative_files_against_the_cwd() {
        let cwd = Path::new("/work/dir");
        assert_eq!(
            absolute_path("a/b.md", cwd),
            PathBuf::from("/work/dir/a/b.md")
        );
        assert_eq!(absolute_path("/abs.md", cwd), PathBuf::from("/abs.md"));
    }

    #[test]
    fn small_text_goes_inline_and_large_or_escaped_text_does_not() {
        let payload = inline_text_payload("hello", Some("T"), false).unwrap();
        assert_eq!(
            payload,
            json!({ "text": "hello", "title": "T", "play": false })
        );
        assert!(inline_text_payload(&"a".repeat(INLINE_TEXT_LIMIT), None, true).is_none());
        // Control characters escape to six bytes each, so 100 KiB of them
        // overflows the 384 KiB frame although the raw text is small.
        let escaped = "\u{1}".repeat(100 * 1024);
        assert!(inline_text_payload(&escaped, None, true).is_none());
    }

    #[test]
    fn path_payload_marks_stdin_temp_files() {
        let payload = path_payload(Path::new("/tmp/x.txt"), None, true, true);
        assert_eq!(
            payload,
            json!({ "path": "/tmp/x.txt", "play": true, "stdin": true })
        );
        let file = path_payload(Path::new("/a.md"), Some("A"), false, false);
        assert_eq!(
            file,
            json!({ "path": "/a.md", "title": "A", "play": false })
        );
    }

    struct FakeBridge {
        reply: Result<Value, BridgeError>,
        calls: RefCell<Vec<(String, Value)>>,
    }

    impl Bridge for FakeBridge {
        fn call(&self, command: &str, payload: Value) -> Result<Value, BridgeError> {
            self.calls.borrow_mut().push((command.to_string(), payload));
            self.reply.clone()
        }
        fn status(&self) -> Value {
            Value::Null
        }
    }

    #[test]
    fn file_mode_sends_reader_open_and_maps_errors_to_exit_codes() {
        let ok = FakeBridge {
            reply: Ok(json!({ "tabId": 3, "id": "0123456789ab", "title": "a.md" })),
            calls: RefCell::default(),
        };
        let args = ReadArgs {
            file: Some("/x/a.md".into()),
            title: None,
            play: true,
            tab: false,
        };
        assert_eq!(run_open(args, &ok), 0);
        let calls = ok.calls.borrow();
        assert_eq!(calls[0].0, "reader.open");
        assert_eq!(calls[0].1, json!({ "path": "/x/a.md", "play": true }));
        drop(calls);

        let args = ReadArgs {
            file: Some("/x/a.md".into()),
            title: None,
            play: true,
            tab: true,
        };
        assert_eq!(run_open(args, &ok), 0);
        assert_eq!(
            ok.calls.borrow()[1].1,
            json!({ "path": "/x/a.md", "play": true, "placement": "tab" })
        );

        let failing = FakeBridge {
            reply: Err(BridgeError {
                code: "not_running".into(),
                message: "down".into(),
            }),
            calls: RefCell::default(),
        };
        let args = ReadArgs {
            file: Some("/x/a.md".into()),
            title: None,
            play: false,
            tab: false,
        };
        assert_eq!(run_open(args, &failing), 1);
    }

    #[test]
    fn the_calling_terminal_is_named_unless_a_tab_was_asked_for() {
        assert_eq!(caller_pty_id(Some("42")), Some(42));
        assert_eq!(caller_pty_id(Some(" 7\n")), Some(7));
        assert_eq!(caller_pty_id(Some("")), None);
        assert_eq!(caller_pty_id(Some("abc")), None);
        assert_eq!(caller_pty_id(None), None);

        let mut docked = json!({ "text": "hi" });
        add_caller(&mut docked, Some(42), false);
        assert_eq!(docked["callerPtyId"], json!(42));

        let mut tabbed = json!({ "text": "hi", "placement": "tab" });
        add_caller(&mut tabbed, Some(42), true);
        assert!(tabbed.get("callerPtyId").is_none());

        let mut outside = json!({ "text": "hi" });
        add_caller(&mut outside, None, false);
        assert!(outside.get("callerPtyId").is_none());
    }

    #[test]
    fn reply_title_wins_over_the_local_fallback() {
        assert_eq!(opened_title(&json!({ "title": "Doc" }), "stdin"), "Doc");
        assert_eq!(opened_title(&json!({ "title": "" }), "stdin"), "stdin");
        assert_eq!(opened_title(&Value::Null, "stdin"), "stdin");
    }
}
