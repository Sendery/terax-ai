//! Text fidelity: what the user sees, copies and scrolls back through must
//! match what the program wrote. Each test pins one QA scenario from
//! docs/plans/2026-11-21-terminal-text-fidelity.md against the pinned
//! libghostty-vt build.

use super::erase_wrap::EraseWrapFix;
use super::selection::{SelectionCommand, SelectionState};
use super::text::read_text;
use libghostty_vt::{Terminal, TerminalOptions};

fn term(cols: u16, rows: u16) -> Terminal<'static, 'static> {
    Terminal::new(TerminalOptions {
        cols,
        rows,
        max_scrollback: 1024 * 1024,
    })
    .unwrap()
}

/// What Copy puts on the clipboard after Select All.
fn copy_all(term: &Terminal<'_, '_>) -> String {
    let mut state = SelectionState::default();
    let text = state
        .apply(term, &SelectionCommand::All)
        .unwrap()
        .unwrap_or_default();
    state.reset(term);
    text
}

/// Every physical row, scrollback included.
fn rows(term: &Terminal<'_, '_>) -> String {
    read_text(term, 1000).unwrap()
}

/// Writes through the same filter the engine applies before the terminal.
fn feed(term: &mut Terminal<'_, '_>, bytes: &[u8]) {
    let mut out = Vec::new();
    EraseWrapFix::default().process(bytes, &mut out);
    term.vt_write(&out);
}

fn resize(term: &mut Terminal<'_, '_>, cols: u16, rows: u16) {
    term.resize(cols, rows, 8, 16).unwrap();
}

// --- Copy -----------------------------------------------------------------

#[test]
fn copy_keeps_a_soft_wrapped_line_as_one_line() {
    let mut t = term(10, 5);
    t.vt_write(b"0123456789abcdefghijKLMNO");
    assert_eq!(rows(&t), "0123456789\nabcdefghij\nKLMNO");
    assert_eq!(copy_all(&t), "0123456789abcdefghijKLMNO");
}

#[test]
fn copy_keeps_hard_newlines() {
    let mut t = term(10, 5);
    t.vt_write(b"one\r\ntwo\r\nthree");
    assert_eq!(copy_all(&t), "one\ntwo\nthree");
}

#[test]
fn copy_keeps_the_newline_after_a_line_that_exactly_fills_the_row() {
    let mut t = term(4, 5);
    t.vt_write(b"abcd\r\nefgh\r\nij");
    assert_eq!(copy_all(&t), "abcd\nefgh\nij");
}

#[test]
fn copy_keeps_blank_lines_between_paragraphs() {
    let mut t = term(10, 6);
    t.vt_write(b"first\r\n\r\nsecond");
    assert_eq!(copy_all(&t), "first\n\nsecond");
}

#[test]
fn copy_of_a_wrapped_line_with_wide_characters_has_no_newline() {
    // A wide character that does not fit in the last column wraps whole; the
    // spacer left behind must not become a newline or a space.
    let mut t = term(5, 4);
    t.vt_write("abcd\u{4e2d}ef".as_bytes());
    assert_eq!(copy_all(&t), "abcd\u{4e2d}ef");
}

// --- Resize ---------------------------------------------------------------

#[test]
fn narrowing_and_widening_restores_soft_wrapped_lines() {
    let mut t = term(20, 6);
    t.vt_write(b"the quick brown fox jumps over\r\nshort line\r\n$ ");
    let before = copy_all(&t);
    resize(&mut t, 8, 6);
    assert_eq!(copy_all(&t), before, "narrow");
    resize(&mut t, 20, 6);
    assert_eq!(copy_all(&t), before, "back to wide");
    assert_eq!(rows(&t), "the quick brown fox\njumps over\nshort line\n$");
}

#[test]
fn resizing_never_joins_lines_that_ended_in_a_newline() {
    let mut t = term(10, 6);
    t.vt_write(b"0123456789\r\nnext\r\n$ ");
    resize(&mut t, 5, 6);
    resize(&mut t, 10, 6);
    resize(&mut t, 14, 6);
    assert_eq!(copy_all(&t), "0123456789\nnext\n$");
}

#[test]
fn resizing_keeps_history_that_is_in_the_scrollback() {
    let mut t = term(12, 3);
    for i in 0..10 {
        t.vt_write(format!("line {i} with words\r\n").as_bytes());
    }
    let before = copy_all(&t);
    resize(&mut t, 7, 3);
    resize(&mut t, 12, 3);
    assert_eq!(copy_all(&t), before);
}

// --- Scrollback and full-screen-ish programs -------------------------------

/// What an Ink renderer (Claude Code, Gemini CLI) does on every frame: move
/// up over the previous frame, erasing each line, then write the new one.
fn ink_frame(t: &mut Terminal<'_, '_>, previous_lines: usize, frame: &str) {
    let mut out = String::new();
    for i in 0..previous_lines {
        out.push_str("\x1b[2K");
        if i + 1 < previous_lines {
            out.push_str("\x1b[1A");
        }
    }
    if previous_lines > 0 {
        out.push_str("\x1b[G");
    }
    out.push_str(frame);
    t.vt_write(out.as_bytes());
}

fn count(haystack: &str, needle: &str) -> usize {
    haystack.matches(needle).count()
}

#[test]
fn an_ink_frame_shorter_than_the_screen_redraws_in_place() {
    let mut t = term(40, 10);
    t.vt_write(b"$ claude\r\n");
    let frame = "> input box\r\n  status line\r\n";
    ink_frame(&mut t, 0, frame);
    for _ in 0..20 {
        ink_frame(&mut t, 3, frame);
    }
    let all = rows(&t);
    assert_eq!(count(&all, "input box"), 1, "{all}");
}

#[test]
fn erase_scrollback_clears_history() {
    let mut t = term(20, 3);
    for i in 0..10 {
        t.vt_write(format!("old {i}\r\n").as_bytes());
    }
    t.vt_write(b"\x1b[H\x1b[2J\x1b[3J");
    t.vt_write(b"fresh");
    assert_eq!(rows(&t), "fresh");
}

#[test]
fn an_ink_frame_after_a_narrowing_resize_leaves_its_reflowed_rows_in_history() {
    // Known and outside the terminal's control: on SIGWINCH Ink erases the
    // previous frame using the line count it computed at the old width, so
    // rows the reflow added stay behind as a copy in the history. Every
    // terminal that reflows does the same; Terax keeps it rare by sending
    // one resize per gesture instead of one per frame.
    let mut t = term(30, 12);
    t.vt_write(b"$ claude\r\n");
    let wide = "\u{256d}\u{2500}\u{2500} Claude Code \u{2500}\u{2500}\u{256e}\r\n\u{2502} > type here          \u{2502}\r\n\u{2570}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{256f}\r\n";
    ink_frame(&mut t, 0, wide);
    resize(&mut t, 20, 12);
    ink_frame(&mut t, 3, wide);
    let all = rows(&t);
    assert_eq!(count(&all, "Claude Code"), 2, "{all}");
}

// --- Replays of real program output ------------------------------------------

/// Feeds a PTY capture (scratch tool: events of output bytes and resizes) into
/// a terminal and prints how many times each marker survives in the history.
/// Run with TERAX_REPLAY=<capture.json> TERAX_REPLAY_MARKERS=a,b.
#[test]
#[ignore = "investigation tool; needs a capture file"]
fn replay_capture() {
    let Ok(path) = std::env::var("TERAX_REPLAY") else {
        return;
    };
    let capture: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let size = capture["size"].as_array().unwrap();
    let mut t = term(
        size[0].as_u64().unwrap() as u16,
        size[1].as_u64().unwrap() as u16,
    );
    let markers: Vec<String> = std::env::var("TERAX_REPLAY_MARKERS")
        .unwrap_or_default()
        .split(',')
        .filter(|m| !m.is_empty())
        .map(str::to_string)
        .collect();
    let report = |t: &Terminal<'_, '_>, label: &str| {
        let all = rows(t);
        let counts: Vec<String> = markers
            .iter()
            .map(|m| format!("{m}={}", count(&all, m)))
            .collect();
        eprintln!(
            "{label}: rows={} scrollback={} {}",
            t.total_rows().unwrap(),
            t.scrollback_rows().unwrap(),
            counts.join(" ")
        );
    };
    let mut filter = EraseWrapFix::default();
    let mut filtered = Vec::new();
    for event in capture["events"].as_array().unwrap() {
        let kind = event[0].as_str().unwrap();
        match kind {
            "out" => {
                let hex = event[1].as_str().unwrap();
                let bytes: Vec<u8> = (0..hex.len())
                    .step_by(2)
                    .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
                    .collect();
                if std::env::var("TERAX_REPLAY_RAW").is_ok() {
                    t.vt_write(&bytes);
                } else {
                    filter.process(&bytes, &mut filtered);
                    t.vt_write(&filtered);
                    filtered.clear();
                }
            }
            "resize" => {
                report(&t, "before resize");
                if std::env::var("TERAX_REPLAY_COPY_EACH").is_ok() {
                    eprintln!("--- copy before resize ---\n{}\n---", copy_all(&t));
                }
                let cols = event[1].as_u64().unwrap() as u16;
                let rows_ = event[2].as_u64().unwrap() as u16;
                let no_reflow = std::env::var("TERAX_REPLAY_NO_REFLOW").is_ok();
                if std::env::var("TERAX_REPLAY_CLEAR").is_ok() {
                    // Erase the visible rows in place (what the program is
                    // about to do itself) so the resize has nothing to push.
                    let visible = t.rows().unwrap();
                    let mut erase = b"\x1b7\x1b[H".to_vec();
                    for _ in 0..visible {
                        erase.extend_from_slice(b"\x1b[2K\x1b[1B");
                    }
                    erase.extend_from_slice(b"\x1b8");
                    t.vt_write(&erase);
                }
                if no_reflow {
                    t.vt_write(b"\x1b[?7l");
                }
                resize(&mut t, cols, rows_);
                if no_reflow {
                    t.vt_write(b"\x1b[?7h");
                }
                eprintln!("-- resize {cols}x{rows_} no_reflow={no_reflow}");
            }
            _ => {}
        }
    }
    report(&t, "end");
    let all = rows(&t);
    let mut missing = Vec::new();
    let mut doubled = Vec::new();
    for i in 1..=70 {
        let n = all
            .lines()
            .filter(|line| line.trim_end().ends_with(&format!("marker-{i}")))
            .count();
        if n == 0 {
            missing.push(i);
        } else if n > 1 {
            doubled.push((i, n));
        }
    }
    eprintln!("markers missing={missing:?} doubled={doubled:?}");
    if std::env::var("TERAX_REPLAY_COPY").is_ok() {
        eprintln!("=== copy all ===\n{}\n=== end copy ===", copy_all(&t));
    }
    if std::env::var("TERAX_REPLAY_DUMP").is_ok() {
        eprintln!("{}", rows(&t));
    }
}

// --- Stale soft-wrap flags --------------------------------------------------

#[test]
fn erasing_and_rewriting_a_wrapped_row_drops_its_soft_wrap() {
    // Row 0 wraps into row 1. A TUI then erases both rows and writes two
    // separate lines there: they must not be joined on copy or on resize.
    let mut t = term(10, 4);
    feed(&mut t, b"abcdefghijkl");
    feed(&mut t, b"\x1b[1;1H\x1b[2KX first\x1b[2;1H\x1b[2KY second");
    assert_eq!(copy_all(&t), "X first\nY second", "copy");
    resize(&mut t, 30, 4);
    assert_eq!(rows(&t), "X first\nY second", "after widening");
}

#[test]
fn reflow_then_tui_repaint_does_not_join_lines_when_widening() {
    // What the screenshots show: a line longer than the new width is split
    // by the reflow (soft wrap), the TUI repaints two different lines over
    // the split rows, and widening joins them with a gap in between.
    let mut t = term(20, 6);
    feed(&mut t, b"> 0123456789abcdefg\r\n");
    resize(&mut t, 10, 6);
    feed(&mut t, b"\x1b[H");
    for line in ["- one.", "- two."] {
        feed(&mut t, b"\x1b[2K");
        feed(&mut t, line.as_bytes());
        feed(&mut t, b"\r\n");
    }
    resize(&mut t, 20, 6);
    let all = rows(&t);
    assert!(
        !all.lines()
            .any(|l| l.contains("one.") && l.contains("two.")),
        "{all}"
    );
}

#[test]
fn pinned_ghostty_keeps_the_soft_wrap_on_erase_complete_line() {
    // Why erase_wrap.rs exists: the raw terminal joins the two lines. If a
    // future Ghostty resets the flag itself, this fails and the filter can go.
    let mut t = term(10, 4);
    t.vt_write(b"abcdefghijkl\x1b[1;1H\x1b[2KX\x1b[2;1H\x1b[2KY");
    assert_eq!(copy_all(&t), "X         Y");
}

#[test]
#[ignore = "investigation: which erase resets the soft wrap"]
fn which_erase_resets_the_soft_wrap() {
    for (name, erase) in [
        ("EL0 at col 0", "\x1b[K"),
        ("EL2", "\x1b[2K"),
        ("EL1", "\x1b[1K"),
        ("ECH full", "\x1b[10X"),
        ("ED0 from row start", "\x1b[J"),
    ] {
        let mut t = term(10, 4);
        t.vt_write(b"abcdefghijkl");
        t.vt_write(format!("\x1b[1;1H{erase}X\x1b[2;1H\x1b[2KY").as_bytes());
        eprintln!("{name:>20}: copy={:?}", copy_all(&t));
    }
}
