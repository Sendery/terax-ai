//! Headless wrapper around installed coding-agent CLIs (Claude Code, Codex,
//! cursor-agent, OpenCode). The webview never spawns processes itself: it asks
//! this module to detect which binaries exist and to run one in headless
//! streaming mode, with stdout lines relayed verbatim over a Tauri `Channel`.
//! Per-CLI event parsing lives on the frontend (one parser per CLI); Rust stays
//! a generic, injection-safe spawner so adding a CLI never touches Rust.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;

use serde::{Deserialize, Serialize};
use shared_child::SharedChild;
use tauri::ipc::Channel;

use crate::modules::workspace::{authorize_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};

type ChildMap = Arc<Mutex<HashMap<u32, Arc<SharedChild>>>>;

#[derive(Default)]
pub struct AgentCliState {
    children: ChildMap,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AgentCliEvent {
    /// One line of stdout (typically a single JSON event from the CLI).
    Stdout { line: String },
    /// One line of stderr (diagnostics, progress, auth prompts).
    Stderr { line: String },
    /// Process exited. `code` is None if terminated by signal.
    Exit { code: Option<i32> },
    /// Spawn or wiring failure before/while running.
    Error { message: String },
}

/// PATH as seen by the user's login shell. A GUI-launched app inherits a
/// minimal PATH that usually omits `~/.local/bin`, `~/.npm-global/bin`, nvm,
/// etc. We resolve the real PATH once and reuse it for both detection and
/// spawning so the agent (and the tools it shells out to) behave as in a
/// terminal. Falls back to the inherited PATH if the probe fails.
pub(crate) fn login_path() -> &'static str {
    static CACHE: OnceLock<String> = OnceLock::new();
    CACHE.get_or_init(|| {
        if let Some(p) = probe_login_path() {
            let trimmed = p.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
        std::env::var("PATH").unwrap_or_default()
    })
}

#[cfg(unix)]
fn probe_login_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let out = Command::new(shell)
        .arg("-lc")
        .arg("printf %s \"$PATH\"")
        .stdin(Stdio::null())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[cfg(windows)]
fn probe_login_path() -> Option<String> {
    // Windows GUI apps inherit the full user+system PATH already.
    None
}

#[cfg(windows)]
fn executable_exts() -> Vec<String> {
    std::env::var("PATHEXT")
        .unwrap_or_else(|_| ".EXE;.CMD;.BAT;.COM".into())
        .split(';')
        .filter(|s| !s.is_empty())
        .map(|s| s.trim_start_matches('.').to_ascii_lowercase())
        .collect()
}

/// Resolve a bare binary name to an absolute path by scanning `login_path()`.
/// Mirrors `command -v` semantics without spawning a shell per lookup.
pub(crate) fn resolve_bin(bin: &str) -> Option<PathBuf> {
    if bin.is_empty() {
        return None;
    }
    // An explicit path is used as-is when it points at a real file.
    if bin.contains('/') || bin.contains('\\') {
        let p = PathBuf::from(bin);
        return p.is_file().then_some(p);
    }
    let sep = if cfg!(windows) { ';' } else { ':' };
    for dir in login_path().split(sep).filter(|s| !s.is_empty()) {
        let base = PathBuf::from(dir).join(bin);
        if base.is_file() {
            return Some(base);
        }
        #[cfg(windows)]
        for ext in executable_exts() {
            let cand = PathBuf::from(dir).join(format!("{bin}.{ext}"));
            if cand.is_file() {
                return Some(cand);
            }
        }
    }
    None
}

/// Map each requested binary name to its absolute path, or `None` if not found.
#[tauri::command]
pub async fn agent_cli_which(bins: Vec<String>) -> HashMap<String, Option<String>> {
    bins.into_iter()
        .map(|b| {
            let resolved = resolve_bin(&b).map(|p| p.to_string_lossy().into_owned());
            (b, resolved)
        })
        .collect()
}

/// Upper bound for a prompt handed over stdin. A flattened chat transcript can
/// be large, but nothing a chat composes comes near this.
const MAX_STDIN_BYTES: usize = 8 * 1024 * 1024;

/// Environment that lets a spawned agent reach this instance's Pi bridge. The
/// Pi-Terax extension only registers its control tools inside a Terax
/// terminal or under `TERAX_FORCE=1`; the discovery path pins it to this
/// instance rather than whichever one last wrote the shared file.
fn bridge_env(discovery: Option<PathBuf>) -> Vec<(&'static str, String)> {
    let mut env = vec![("TERAX_FORCE", "1".to_string()), ("TERAX_SURFACE", "chat".to_string())];
    if let Some(path) = discovery {
        env.push(("TERAX_PI_DISCOVERY", path.to_string_lossy().into_owned()));
    }
    env
}

/// Optional extras for one spawn, grouped so the command signature stays small.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCliSpawnOptions {
    /// Written to the child's stdin, then closed. Absent means stdin is null.
    #[serde(default)]
    pub stdin: Option<String>,
    /// Hand the child this instance's Pi bridge (see `bridge_env`).
    #[serde(default)]
    pub bridge: bool,
}

/// Spawn a CLI agent in headless mode. `argv[0]` is the binary (bare name or
/// absolute path); the remaining entries are passed verbatim as separate
/// arguments (no shell, so the prompt cannot inject). Streams stdout/stderr
/// lines over `on_event` and resolves once the child has been launched; the
/// `Exit` event marks completion. `id` is a frontend-chosen handle for cancel.
// Two of the arguments are Tauri-injected state, not caller input.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn agent_cli_spawn(
    id: u32,
    argv: Vec<String>,
    cwd: Option<String>,
    workspace: Option<WorkspaceEnv>,
    options: Option<AgentCliSpawnOptions>,
    on_event: Channel<AgentCliEvent>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    state: tauri::State<'_, AgentCliState>,
) -> Result<(), String> {
    let Some((bin, args)) = argv.split_first() else {
        return Err("empty argv".into());
    };
    if bin.trim().is_empty() {
        return Err("empty binary".into());
    }

    let AgentCliSpawnOptions { stdin, bridge } = options.unwrap_or_default();
    if stdin.as_ref().is_some_and(|text| text.len() > MAX_STDIN_BYTES) {
        return Err("prompt is too large".into());
    }

    let workspace = WorkspaceEnv::from_option(workspace);
    authorize_spawn_cwd(&registry, cwd.as_deref(), &workspace)?;

    let program = resolve_bin(bin).ok_or_else(|| format!("{bin} not found on PATH"))?;

    let mut cmd = Command::new(&program);
    cmd.args(args)
        .env("PATH", login_path())
        .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        cmd.current_dir(dir);
    }
    if bridge {
        for (key, value) in bridge_env(crate::modules::pi::cache_file_path().ok()) {
            cmd.env(key, value);
        }
    }
    crate::modules::proc::hide_console(&mut cmd);

    let child = Arc::new(SharedChild::spawn(&mut cmd).map_err(|e| {
        log::warn!("agent_cli_spawn failed for {bin}: {e}");
        e.to_string()
    })?);

    if let (Some(text), Some(mut pipe)) = (stdin, child.take_stdin()) {
        // Written off-thread so a child that reads slowly never blocks the
        // command; dropping the pipe closes stdin, which ends the prompt.
        thread::spawn(move || {
            let _ = pipe.write_all(text.as_bytes());
        });
    }

    let stdout_pipe = child.take_stdout();
    let stderr_pipe = child.take_stderr();
    state.children.lock().unwrap().insert(id, Arc::clone(&child));

    if let Some(pipe) = stdout_pipe {
        let ch = on_event.clone();
        thread::spawn(move || stream_lines(pipe, &ch, true));
    }
    if let Some(pipe) = stderr_pipe {
        let ch = on_event.clone();
        thread::spawn(move || stream_lines(pipe, &ch, false));
    }

    let waiter = Arc::clone(&child);
    let children = Arc::clone(&state.children);
    thread::spawn(move || {
        let code = waiter.wait().ok().and_then(|s| s.code());
        let _ = on_event.send(AgentCliEvent::Exit { code });
        children.lock().unwrap().remove(&id);
    });

    Ok(())
}

/// Kill a running agent by its spawn `id`. No-op if already gone.
#[tauri::command]
pub async fn agent_cli_kill(id: u32, state: tauri::State<'_, AgentCliState>) -> Result<(), String> {
    let child = state.children.lock().unwrap().remove(&id);
    if let Some(child) = child {
        let _ = child.kill();
    }
    Ok(())
}

/// The provider, model and thinking level Pi starts with when no `--model` is
/// given, as recorded in its global settings.
#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiDefaults {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_thinking_level: Option<String>,
}

const MAX_PI_SETTINGS_BYTES: u64 = 256 * 1024;
const MAX_PI_DEFAULT_LEN: usize = 200;

fn clean_pi_default(value: Option<String>) -> Option<String> {
    let value = value?.trim().to_string();
    let printable = value.chars().all(|c| !c.is_control());
    (!value.is_empty() && value.len() <= MAX_PI_DEFAULT_LEN && printable).then_some(value)
}

/// Pull the three default fields out of Pi's settings file, ignoring every
/// other key (package sources, tokens, paths) so nothing else leaves the file.
fn parse_pi_defaults(raw: &str) -> Option<PiDefaults> {
    let parsed: PiDefaults = serde_json::from_str(raw).ok()?;
    let cleaned = PiDefaults {
        default_provider: clean_pi_default(parsed.default_provider),
        default_model: clean_pi_default(parsed.default_model),
        default_thinking_level: clean_pi_default(parsed.default_thinking_level),
    };
    (cleaned != PiDefaults::default()).then_some(cleaned)
}

fn pi_settings_path() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("PI_CODING_AGENT_DIR").filter(|d| !d.is_empty()) {
        return Some(PathBuf::from(dir).join("settings.json"));
    }
    Some(dirs::home_dir()?.join(".pi").join("agent").join("settings.json"))
}

/// Pi's own default model, so the chat can say which model "Pi default" means.
/// `None` when Pi is not set up or the file is unreadable.
#[tauri::command]
pub async fn agent_cli_pi_defaults() -> Option<PiDefaults> {
    let path = pi_settings_path()?;
    let meta = std::fs::metadata(&path).ok()?;
    if !meta.is_file() || meta.len() > MAX_PI_SETTINGS_BYTES {
        return None;
    }
    parse_pi_defaults(&std::fs::read_to_string(&path).ok()?)
}

fn stream_lines<R: std::io::Read>(pipe: R, ch: &Channel<AgentCliEvent>, stdout: bool) {
    let reader = BufReader::new(pipe);
    for line in reader.lines() {
        let Ok(line) = line else { break };
        let event = if stdout {
            AgentCliEvent::Stdout { line }
        } else {
            AgentCliEvent::Stderr { line }
        };
        if ch.send(event).is_err() {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_path_is_non_empty() {
        // Either the login-shell probe or the inherited PATH must yield something.
        assert!(!login_path().is_empty());
    }

    #[test]
    fn resolve_bin_rejects_missing() {
        assert!(resolve_bin("definitely-not-a-real-binary-zzz-9000").is_none());
        assert!(resolve_bin("").is_none());
    }

    #[test]
    fn bridge_env_forces_the_extension_and_pins_this_instance() {
        let env = bridge_env(Some(PathBuf::from("/cache/terax-ai/pi-bridge.json")));
        assert!(env.contains(&("TERAX_FORCE", "1".to_string())));
        assert!(env.contains(&("TERAX_SURFACE", "chat".to_string())));
        assert!(env.contains(&(
            "TERAX_PI_DISCOVERY",
            "/cache/terax-ai/pi-bridge.json".to_string()
        )));
        assert!(!env.iter().any(|(k, _)| *k == "TERAX_TERMINAL"));
    }

    #[test]
    fn bridge_env_without_discovery_still_opts_in() {
        let env = bridge_env(None);
        assert!(env.contains(&("TERAX_FORCE", "1".to_string())));
        assert!(!env.iter().any(|(k, _)| *k == "TERAX_PI_DISCOVERY"));
    }

    #[test]
    fn pi_defaults_reads_only_the_default_fields() {
        let raw = r#"{"defaultProvider":"anthropic","defaultModel":"claude-opus-5","defaultThinkingLevel":"high","packages":["npm:x"],"token":"secret"}"#;
        let parsed = parse_pi_defaults(raw).expect("defaults");
        assert_eq!(parsed.default_provider.as_deref(), Some("anthropic"));
        assert_eq!(parsed.default_model.as_deref(), Some("claude-opus-5"));
        assert_eq!(parsed.default_thinking_level.as_deref(), Some("high"));
        let json = serde_json::to_string(&parsed).unwrap();
        assert!(!json.contains("secret"));
        assert!(!json.contains("packages"));
    }

    #[test]
    fn pi_defaults_rejects_garbage_and_empty_settings() {
        assert_eq!(parse_pi_defaults("not json"), None);
        assert_eq!(parse_pi_defaults("{}"), None);
        assert_eq!(parse_pi_defaults(r#"{"defaultModel":"  "}"#), None);
        assert_eq!(parse_pi_defaults(r#"{"defaultModel":42}"#), None);
        let long = "x".repeat(MAX_PI_DEFAULT_LEN + 1);
        assert_eq!(
            parse_pi_defaults(&format!(r#"{{"defaultModel":"{long}"}}"#)),
            None
        );
        assert_eq!(parse_pi_defaults(r#"{"defaultModel":"a
b"}"#), None);
    }

    #[cfg(unix)]
    #[test]
    fn resolve_bin_finds_path_binary() {
        let p = resolve_bin("sh").expect("sh should resolve on PATH");
        assert!(p.is_absolute());
        assert!(p.is_file());
    }

    #[cfg(unix)]
    #[test]
    fn resolve_bin_honors_explicit_path() {
        assert_eq!(resolve_bin("/bin/sh"), Some(PathBuf::from("/bin/sh")));
        assert!(resolve_bin("/nonexistent/dir/nope").is_none());
    }
}
