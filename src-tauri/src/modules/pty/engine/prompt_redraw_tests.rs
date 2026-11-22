//! A shell prompt must survive changes of the terminal width: no command
//! output lost above it, no prompt row left behind twice (finding F3 in
//! docs/plans/2026-11-21-terminal-text-fidelity.md).
//!
//! The byte streams are synthesized from what zsh 5.9 and bash 5.3 really
//! write (captured with scripts/terminal-qa/capture.py): the prompt with the
//! marks of Terax's shell integration, and the repaint each shell sends on
//! SIGWINCH, which counts rows at the width it painted for last.

use super::erase_wrap::EraseWrapFix;
use super::prompt_redraw::PromptRedraw;
use super::shell::{ShellIntegration, ShellToken};
use super::text::read_text;
use super::{start_with_shell_options, Engine, EngineOptions, ShellConfig};
use libghostty_vt::{Terminal, TerminalOptions};
use std::time::{Duration, Instant};

const TOKEN: &str = "1234567890abcdef1234567890abcdef";
const ROWS: u16 = 24;

/// The terminal with the same pieces, in the same order, as the engine
/// session: erase-line filter, signed shell marks, prompt erase on reflow.
struct Pane {
    term: Terminal<'static, 'static>,
    filter: EraseWrapFix,
    shell: ShellIntegration,
    redraw: PromptRedraw,
    cols: u16,
    erased: usize,
}

impl Pane {
    fn new(cols: u16) -> Self {
        Self {
            term: Terminal::new(TerminalOptions {
                cols,
                rows: ROWS,
                max_scrollback: 1024 * 1024,
            })
            .unwrap(),
            filter: EraseWrapFix::default(),
            shell: ShellIntegration::new(Some(TOKEN.into())),
            redraw: PromptRedraw::default(),
            cols,
            erased: 0,
        }
    }

    fn feed(&mut self, bytes: impl AsRef<[u8]>) {
        let mut filtered = Vec::new();
        self.filter.process(bytes.as_ref(), &mut filtered);
        let (term, redraw) = (&mut self.term, &mut self.redraw);
        self.shell
            .ingest_segments(&filtered, |segment, event| {
                term.vt_write(segment);
                if let Some(event) = &event {
                    redraw.observe(term, event);
                }
                Ok(())
            })
            .unwrap();
    }

    fn resize(&mut self, cols: u16) {
        if cols != self.cols
            && self
                .redraw
                .before_reflow(&mut self.term, self.filter.at_ground())
        {
            self.erased += 1;
        }
        self.term.resize(cols, ROWS, 8, 16).unwrap();
        self.cols = cols;
    }

    /// Every row, scrollback included, without trailing blanks.
    fn text(&self) -> String {
        tidy(&read_text(&self.term, 1000).unwrap())
    }
}

fn tidy(text: &str) -> String {
    let rows: Vec<&str> = text.lines().map(str::trim_end).collect();
    rows.join("\n").trim_end().to_string()
}

/// What `lines` look like printed at `cols`: the oracle for every test.
fn wrapped(lines: &[String], cols: u16) -> String {
    let mut rows = Vec::new();
    for line in lines {
        assert!(line.is_ascii());
        if line.is_empty() {
            rows.push(String::new());
        }
        for chunk in line.as_bytes().chunks(usize::from(cols)) {
            rows.push(String::from_utf8(chunk.to_vec()).unwrap());
        }
    }
    tidy(&rows.join("\n"))
}

fn mark(body: &str) -> String {
    format!("\x1b]133;{body};aid={TOKEN}\x1b\\")
}

/// Rows a logical line takes at `cols`. The scenarios avoid lines that end
/// exactly at the right edge, where the shells add their own wrap handling.
fn height(len: usize, cols: u16) -> usize {
    assert!(len % usize::from(cols) != 0, "{len} fills {cols} columns");
    len / usize::from(cols) + 1
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Zsh,
    Bash,
}

/// A shell sitting at its prompt, as far as its terminal output goes.
struct Shell {
    kind: Kind,
    /// Visible text of each `PS1` line.
    prompt: Vec<String>,
    /// What the user typed so far.
    buffer: String,
    /// `terax_redraw=1` on the prompt start mark.
    promise: bool,
    /// Width of the last paint: the shell counts rows with it on SIGWINCH.
    painted_cols: u16,
}

impl Shell {
    fn new(kind: Kind, prompt: &[&str], cols: u16) -> Self {
        Self {
            kind,
            prompt: prompt.iter().map(|line| line.to_string()).collect(),
            buffer: String::new(),
            promise: true,
            painted_cols: cols,
        }
    }

    fn last_line(&self) -> String {
        format!("{}{}", self.prompt.last().unwrap(), self.buffer)
    }

    /// The prompt as it stands, as logical lines.
    fn lines(&self) -> Vec<String> {
        let mut lines = self.prompt.clone();
        *lines.last_mut().unwrap() = self.last_line();
        lines
    }

    /// The hook that runs before each prompt (`precmd`, `PROMPT_COMMAND`).
    fn precmd(&self) -> String {
        let start = if self.promise {
            "A;terax_redraw=1"
        } else {
            "A"
        };
        format!("{}{}", mark("D;0"), mark(start))
    }

    /// `PS1` from its `from`th line on, then the typed text.
    fn ps1(&self, from: usize) -> String {
        let mut out = String::new();
        for (index, line) in self.prompt.iter().enumerate().skip(from) {
            match (self.kind, index) {
                (_, 0) => out.push_str(&mark("P;k=i")),
                // bash repaints only the last line, so each one is marked.
                (Kind::Bash, _) => out.push_str(&mark("P;k=s")),
                (Kind::Zsh, _) => {}
            }
            out.push_str(line);
            if index + 1 < self.prompt.len() {
                out.push_str("\r\n");
            }
        }
        out.push_str(&mark("B"));
        out.push_str(&self.buffer);
        out
    }

    fn paint(&mut self, cols: u16) -> String {
        self.painted_cols = cols;
        match self.kind {
            Kind::Zsh => format!("\r\x1b[0m\x1b[27m\x1b[24m\x1b[J{}\x1b[K", self.ps1(0)),
            Kind::Bash => self.ps1(0),
        }
    }

    /// A fresh prompt: the hook, then the first paint.
    fn prompt(&mut self, cols: u16) -> String {
        self.buffer.clear();
        format!("{}{}", self.precmd(), self.paint(cols))
    }

    fn type_text(&mut self, text: &str) -> String {
        self.buffer.push_str(text);
        text.to_string()
    }

    /// Enter: the command runs and prints `output`.
    fn run(&mut self, output: &[&str]) -> String {
        let mut out = format!("\r\n{}", mark("C;cmdline_url=cmd"));
        for line in output {
            out.push_str(line);
            out.push_str("\r\n");
        }
        out
    }

    /// The repaint after SIGWINCH. The terminal already has `cols` columns;
    /// the shell still counts rows at the width of its last paint.
    fn winch(&mut self, cols: u16) -> String {
        let old = self.painted_cols;
        let last = height(self.last_line().len(), old);
        let mut out = String::new();
        match self.kind {
            // zsh: up to the first prompt row, erase to the end of the
            // screen, paint everything.
            Kind::Zsh => {
                let above: usize = self.prompt[..self.prompt.len() - 1]
                    .iter()
                    .map(|line| height(line.len(), old))
                    .sum();
                for _ in 0..above + last - 1 {
                    out.push_str("\x1b[A");
                }
                out.push_str(&self.paint(cols));
            }
            // readline: erase the rows of the last prompt line, bottom up,
            // and paint that line only.
            Kind::Bash => {
                for row in 0..last {
                    out.push_str("\r\x1b[K");
                    if row + 1 < last {
                        out.push_str("\x1b[A");
                    }
                }
                out.push('\r');
                self.painted_cols = cols;
                out.push_str(&self.ps1(self.prompt.len() - 1));
            }
        }
        out
    }
}

const TOP: &str = "+- dir /private/tmp/some/long/project/path/that/wraps/when/the/window/is/narrow";
const OUTPUT: [&str; 4] = [
    "short line",
    "",
    "tab separated values",
    "a very long sentence that keeps going and going well past the edge of the terminal so it wraps",
];
const COMMAND: &str = "echo this is a long command line that goes beyond the width of the terminal";

/// A command with output above a prompt with a long typed command, then the
/// widths in turn. After every repaint the whole history must read as if it
/// had been printed at that width. Returns how many resizes erased a prompt.
fn resize_at_the_prompt(mut shell: Shell, widths: &[u16]) -> Result<usize, String> {
    let start = shell.painted_cols;
    let mut pane = Pane::new(start);
    let mut history = Vec::new();

    pane.feed(shell.prompt(start));
    pane.feed(shell.type_text("cat sample.txt"));
    history.extend(shell.lines());
    pane.feed(shell.run(&OUTPUT));
    history.extend(OUTPUT.iter().map(|line| line.to_string()));
    pane.feed(shell.prompt(start));
    pane.feed(shell.type_text(COMMAND));

    for &cols in widths {
        pane.resize(cols);
        pane.feed(shell.winch(cols));
        let mut lines = history.clone();
        lines.extend(shell.lines());
        let (got, want) = (pane.text(), wrapped(&lines, cols));
        if got != want {
            return Err(format!(
                "at {cols} columns:\n{got}\n--- expected:\n{want}"
            ));
        }
    }
    Ok(pane.erased)
}

const WIDTHS: [u16; 9] = [50, 120, 80, 33, 100, 47, 131, 60, 80];

#[test]
fn zsh_two_line_prompt_survives_narrowing_and_widening() {
    let shell = Shell::new(Kind::Zsh, &[TOP, "`-> "], 80);
    assert_eq!(resize_at_the_prompt(shell, &WIDTHS), Ok(WIDTHS.len()));
}

#[test]
fn zsh_single_line_prompt_survives_narrowing_and_widening() {
    let shell = Shell::new(Kind::Zsh, &["host ~/project % "], 80);
    assert_eq!(resize_at_the_prompt(shell, &WIDTHS), Ok(WIDTHS.len()));
}

#[test]
fn zsh_three_line_prompt_survives_narrowing_and_widening() {
    let shell = Shell::new(Kind::Zsh, &[TOP, "| git main, 3 changed", "`-> "], 80);
    assert_eq!(resize_at_the_prompt(shell, &WIDTHS), Ok(WIDTHS.len()));
}

#[test]
fn bash_two_line_prompt_survives_narrowing_and_widening() {
    let shell = Shell::new(Kind::Bash, &[TOP, "L2$ "], 80);
    assert_eq!(resize_at_the_prompt(shell, &WIDTHS), Ok(WIDTHS.len()));
}

#[test]
fn bash_single_line_prompt_survives_narrowing_and_widening() {
    let shell = Shell::new(Kind::Bash, &["user@host:~/project$ "], 80);
    assert_eq!(resize_at_the_prompt(shell, &WIDTHS), Ok(WIDTHS.len()));
}

#[test]
fn without_the_promise_the_repaint_corrupts_the_history() {
    // The cause, pinned: the same streams with no erase before the reflow.
    // If this starts passing, the shells or the reflow changed and the
    // erase may no longer be needed.
    for kind in [Kind::Zsh, Kind::Bash] {
        let mut shell = Shell::new(kind, &[TOP, "`-> "], 80);
        shell.promise = false;
        assert!(resize_at_the_prompt(shell, &WIDTHS).is_err());
    }
}

#[test]
fn zsh_narrowing_alone_duplicates_the_first_prompt_row_without_the_erase() {
    let mut shell = Shell::new(Kind::Zsh, &[TOP, "`-> "], 100);
    shell.promise = false;
    let mut pane = Pane::new(100);
    pane.feed(shell.prompt(100));
    pane.resize(50);
    pane.feed(shell.winch(50));
    assert_eq!(pane.text().matches("+- dir").count(), 2, "{}", pane.text());
}

#[test]
fn zsh_widening_alone_erases_output_without_the_erase() {
    let mut shell = Shell::new(Kind::Zsh, &[TOP, "`-> "], 50);
    shell.promise = false;
    let mut pane = Pane::new(50);
    pane.feed("first output\r\nlast output\r\n");
    pane.feed(shell.prompt(50));
    pane.resize(100);
    pane.feed(shell.winch(100));
    assert!(!pane.text().contains("last output"), "{}", pane.text());
}

#[test]
fn a_running_command_is_never_erased() {
    // After the pre-exec mark the rows under the prompt are command output.
    let mut shell = Shell::new(Kind::Zsh, &[TOP, "`-> "], 80);
    let mut pane = Pane::new(80);
    pane.feed(shell.prompt(80));
    pane.feed(shell.type_text("slow"));
    let mut lines = shell.lines();
    pane.feed(shell.run(&OUTPUT));
    lines.extend(OUTPUT.iter().map(|line| line.to_string()));
    for cols in [40, 120, 80] {
        pane.resize(cols);
        assert_eq!(pane.text(), wrapped(&lines, cols), "at {cols} columns");
    }
    assert_eq!(pane.erased, 0);
}

#[test]
fn a_finished_command_is_not_erased_before_the_next_prompt() {
    let mut shell = Shell::new(Kind::Zsh, &["% "], 80);
    let mut pane = Pane::new(80);
    pane.feed(shell.prompt(80));
    pane.feed(shell.run(&OUTPUT));
    pane.feed(mark("D;0"));
    pane.resize(40);
    assert_eq!(pane.erased, 0);
    assert!(pane.text().contains("short line"));
}

#[test]
fn marks_without_the_session_token_erase_nothing() {
    // Program output can print any OSC; only the shell knows the token.
    for forged in [
        "\x1b]133;A;terax_redraw=1\x1b\\".to_string(),
        "\x1b]133;A;aid=wrong;terax_redraw=1\x1b\\".to_string(),
        format!("\x1b]133;A;aid={TOKEN};aid={TOKEN};terax_redraw=1\x1b\\"),
    ] {
        let mut pane = Pane::new(80);
        pane.feed("line one\r\n");
        pane.feed(forged);
        pane.feed("line two\r\nline three");
        pane.resize(40);
        assert_eq!(pane.erased, 0);
        assert_eq!(pane.text(), "line one\nline two\nline three");
    }
}

#[test]
fn a_prompt_start_without_the_promise_erases_nothing() {
    // fish, and zsh when it cannot put its mark in PS1.
    let mut pane = Pane::new(80);
    pane.feed(format!("out\r\n{}> {}typed", mark("A"), mark("B")));
    pane.resize(40);
    assert_eq!(pane.erased, 0);
    assert_eq!(pane.text(), "out\n> typed");
}

#[test]
fn a_new_prompt_start_without_the_promise_withdraws_an_earlier_one() {
    let mut pane = Pane::new(80);
    pane.feed(format!("{}% ", mark("A;terax_redraw=1")));
    pane.feed(format!("\r\n{}> ", mark("A")));
    pane.resize(40);
    assert_eq!(pane.erased, 0);
}

#[test]
fn the_erase_starts_at_the_last_prompt_line_mark() {
    let mut pane = Pane::new(80);
    pane.feed("output\r\n");
    pane.feed(mark("A;terax_redraw=1"));
    pane.feed("printed by a later hook\r\n");
    pane.feed(format!("{}% {}typed", mark("P;k=i"), mark("B")));
    pane.resize(40);
    assert_eq!(pane.erased, 1);
    assert_eq!(pane.text(), "output\nprinted by a later hook");
    assert_eq!(pane.term.cursor_x().unwrap(), 0);
    assert_eq!(pane.term.cursor_y().unwrap(), 2);
}

#[test]
fn a_resize_that_keeps_the_width_erases_nothing() {
    let mut shell = Shell::new(Kind::Zsh, &["% "], 80);
    let mut pane = Pane::new(80);
    pane.feed(shell.prompt(80));
    pane.feed(shell.type_text("typed"));
    pane.resize(80);
    assert_eq!(pane.erased, 0);
    assert_eq!(pane.text(), "% typed");
}

#[test]
fn nothing_is_erased_while_the_stream_is_inside_a_sequence() {
    let mut shell = Shell::new(Kind::Zsh, &["% "], 80);
    let mut pane = Pane::new(80);
    pane.feed(shell.prompt(80));
    pane.feed("typed\x1b[38;5");
    pane.resize(40);
    assert_eq!(pane.erased, 0);
    pane.feed(";1m");
    assert_eq!(pane.text(), "% typed");
}

#[test]
fn nothing_is_erased_on_the_alternate_screen() {
    // An editor opened from a line-editor widget runs with no pre-exec mark.
    let mut shell = Shell::new(Kind::Zsh, &["% "], 80);
    let mut pane = Pane::new(80);
    pane.feed(shell.prompt(80));
    pane.feed("\x1b[?1049h\x1b[Heditor");
    pane.resize(40);
    assert_eq!(pane.erased, 0);
    assert_eq!(pane.text(), "editor");
}

#[test]
fn nothing_is_erased_when_the_prompt_start_left_the_screen() {
    let mut pane = Pane::new(80);
    pane.feed(format!("{}% {}", mark("A;terax_redraw=1"), mark("B")));
    for row in 0..ROWS * 2 {
        pane.feed(format!("pasted line {row}\r\n"));
    }
    let before = pane.text();
    pane.resize(60);
    assert_eq!(pane.erased, 0);
    assert_eq!(pane.text(), before);
}

#[test]
fn block_mode_prompt_keeps_its_reserved_rows() {
    // TERAX_BLOCKS: PS1 is two reserved rows and the prompt end mark.
    let ps1 = format!("\r\x1b[J{}\r\n\r\n{}", mark("P;k=i"), mark("B"));
    let typed = "a command typed in the shell line editor that is long enough to wrap";
    let mut pane = Pane::new(80);
    pane.feed("previous output\r\n");
    pane.feed(format!("{}{}", mark("D;0"), mark("A;terax_redraw=1")));
    pane.feed(format!("{ps1}{typed}"));
    for (cols, painted) in [(40u16, 80u16), (100, 40)] {
        pane.resize(cols);
        let above = 2 + height(typed.len(), painted) - 1;
        pane.feed(format!("{}{ps1}{typed}", "\x1b[A".repeat(above)));
        let lines = [
            "previous output".to_string(),
            String::new(),
            String::new(),
            typed.to_string(),
        ];
        assert_eq!(pane.text(), wrapped(&lines, cols), "at {cols} columns");
    }
    assert_eq!(pane.erased, 2);
}

#[test]
fn pinned_ghostty_redraw_keeps_the_soft_wrap_of_a_wrapped_prompt() {
    // Why Terax erases the prompt itself instead of asking libghostty to
    // (`OSC 133;A;redraw=1`): libghostty blanks the prompt cells but leaves
    // the rows soft-wrapped, so widening joins the blank rows, the shell
    // moves up too far and erases the output above. If this starts failing,
    // the native erase may have been fixed upstream.
    let mut term = Terminal::new(TerminalOptions {
        cols: 20,
        rows: 10,
        max_scrollback: 1024 * 1024,
    })
    .unwrap();
    let prompt = "\x1b]133;A;redraw=1\x07a prompt that wraps over rows > \x1b]133;B\x07";
    term.vt_write(b"output one\r\noutput two\r\n");
    term.vt_write(prompt.as_bytes());
    term.resize(60, 10, 8, 16).unwrap();
    // zsh: the prompt took two rows at 20 columns, so one row up.
    term.vt_write(format!("\x1b[A\r\x1b[J{prompt}").as_bytes());
    let text = tidy(&read_text(&term, 1000).unwrap());
    assert_eq!(text, "output one\na prompt that wraps over rows >");
}

// --- The engine session ------------------------------------------------------

fn actor(blocks: bool) -> Engine {
    start_with_shell_options(
        80,
        ROWS,
        EngineOptions::default(),
        ShellConfig {
            token: ShellToken::for_test(),
            blocks,
        },
        Box::new(|_| true),
        Box::new(|_| {}),
    )
    .unwrap()
}

fn actor_feed(engine: &Engine, fed: &mut u64, bytes: String) {
    *fed += bytes.len() as u64;
    assert!(engine.input.feed(bytes.into_bytes()));
    let deadline = Instant::now() + Duration::from_secs(5);
    while engine.handle.stats().bytes_fed < *fed {
        assert!(Instant::now() < deadline, "engine did not take the bytes");
        std::thread::sleep(Duration::from_millis(2));
    }
}

fn actor_text(engine: &Engine) -> String {
    let text = engine
        .handle
        .read_text(1000)
        .unwrap()
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .unwrap();
    tidy(&text)
}

#[test]
fn the_engine_erases_the_prompt_before_it_reflows() {
    for blocks in [false, true] {
        let engine = actor(blocks);
        let mut fed = 0;
        let mut shell = Shell::new(Kind::Zsh, &[TOP, "`-> "], 80);
        let mut history = Vec::new();
        actor_feed(&engine, &mut fed, shell.prompt(80));
        actor_feed(&engine, &mut fed, shell.type_text("cat sample.txt"));
        history.extend(shell.lines());
        actor_feed(&engine, &mut fed, shell.run(&OUTPUT));
        history.extend(OUTPUT.iter().map(|line| line.to_string()));
        actor_feed(&engine, &mut fed, shell.prompt(80));
        actor_feed(&engine, &mut fed, shell.type_text(COMMAND));
        for cols in [50, 120, 80] {
            engine.handle.resize(cols, ROWS);
            // The text request is served after the resize, in order.
            let erased = actor_text(&engine);
            assert_eq!(erased, wrapped(&history, cols), "erased, {cols} columns");
            actor_feed(&engine, &mut fed, shell.winch(cols));
            let mut lines = history.clone();
            lines.extend(shell.lines());
            assert_eq!(
                actor_text(&engine),
                wrapped(&lines, cols),
                "blocks {blocks}, {cols} columns"
            );
        }
        assert_eq!(engine.handle.failure(), None);
        engine.input.shutdown();
        engine.thread.join().unwrap();
    }
}

// --- Replays of real shell output -------------------------------------------

/// Replays a capture made with scripts/terminal-qa/capture.py through the
/// same pieces as the engine session and prints every row at the end.
/// TERAX_REPLAY=<capture.json>; TERAX_REPLAY_TOKEN is the session token the
/// capture ran with (default `tok123`); TERAX_REPLAY_EACH=1 also prints the
/// rows before every resize.
#[test]
#[ignore = "investigation tool; needs a capture file"]
fn replay_capture_through_prompt_redraw() {
    let Ok(path) = std::env::var("TERAX_REPLAY") else {
        return;
    };
    let capture: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let size = capture["size"].as_array().unwrap();
    assert_eq!(size[1].as_u64().unwrap(), u64::from(ROWS), "capture rows");
    let mut pane = Pane::new(size[0].as_u64().unwrap() as u16);
    let token = std::env::var("TERAX_REPLAY_TOKEN").unwrap_or_else(|_| "tok123".into());
    pane.shell = ShellIntegration::new(Some(token));
    for event in capture["events"].as_array().unwrap() {
        match event[0].as_str().unwrap() {
            "out" => {
                let hex = event[1].as_str().unwrap();
                let bytes: Vec<u8> = (0..hex.len())
                    .step_by(2)
                    .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
                    .collect();
                pane.feed(bytes);
            }
            "resize" => {
                if std::env::var("TERAX_REPLAY_EACH").is_ok() {
                    eprintln!("--- before resize ---\n{}", pane.text());
                }
                let cols = event[1].as_u64().unwrap() as u16;
                assert_eq!(event[2].as_u64().unwrap(), u64::from(ROWS), "capture rows");
                let erased = pane.erased;
                pane.resize(cols);
                eprintln!(
                    "-- resize to {cols} columns, erased={}",
                    pane.erased > erased
                );
            }
            _ => {}
        }
    }
    eprintln!("=== rows ===\n{}\n=== end ===", pane.text());
}
