//! Shared frame fixtures (`tests/fixtures/terminal-frames/`), produced from
//! real libghostty output. `UPDATE_FIXTURES=1` rewrites them; otherwise the
//! test fails when its output differs from the files on disk. The webview's
//! decoder test reads the same files.

use std::path::{Path, PathBuf};

use libghostty_vt::terminal::{CursorStyle as GhosttyCursorStyle, ScrollViewport};
use libghostty_vt::{Terminal, TerminalOptions};
use serde::Serialize;

use super::frame::decode::{decode, Frame};
use super::frame::{
    CellStyle, ATTR_BLINK, ATTR_BOLD, ATTR_FAINT, ATTR_INVERSE, ATTR_INVISIBLE, ATTR_ITALIC,
    ATTR_OVERLINE, ATTR_STRIKETHROUGH, CELL_SPACER_TAIL, CELL_WIDE_HEAD, CODEPOINT_MASK, COLOR_SET,
    FLAG_CURSOR_BLINK, FLAG_FULL, FLAG_VIEWPORT_SCROLLED, NO_CURSOR_COLOR,
};
use super::snapshot::Snapshotter;

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/terminal-frames")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FixtureFrame {
    seq: u32,
    cols: u16,
    viewport_rows: u16,
    full: bool,
    viewport_scrolled: bool,
    cursor: FixtureCursor,
    default_fg: String,
    default_bg: String,
    rows: Vec<FixtureRow>,
}

#[derive(Serialize)]
struct FixtureCursor {
    x: u16,
    y: u16,
    style: &'static str,
    blink: bool,
    color: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FixtureRow {
    y: u16,
    wrapped: bool,
    prompt: &'static str,
    text: String,
    runs: Vec<FixtureRun>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FixtureRun {
    start: u32,
    len: u16,
    fg: Option<String>,
    bg: Option<String>,
    underline_color: Option<String>,
    attrs: Vec<&'static str>,
    underline: &'static str,
}

fn hex(c: u32) -> String {
    format!(
        "#{:02x}{:02x}{:02x}",
        c & 0xff,
        (c >> 8) & 0xff,
        (c >> 16) & 0xff
    )
}

fn explicit(c: u32) -> Option<String> {
    (c & COLOR_SET != 0).then(|| hex(c))
}

const ATTR_NAMES: [(u16, &str); 8] = [
    (ATTR_BOLD, "bold"),
    (ATTR_ITALIC, "italic"),
    (ATTR_FAINT, "faint"),
    (ATTR_INVERSE, "inverse"),
    (ATTR_INVISIBLE, "invisible"),
    (ATTR_STRIKETHROUGH, "strikethrough"),
    (ATTR_OVERLINE, "overline"),
    (ATTR_BLINK, "blink"),
];

fn run_json(start: u32, len: u16, style: &CellStyle) -> FixtureRun {
    FixtureRun {
        start,
        len,
        fg: explicit(style.fg),
        bg: explicit(style.bg),
        underline_color: explicit(style.underline_color),
        attrs: ATTR_NAMES
            .iter()
            .filter(|(bit, _)| style.attrs & bit != 0)
            .map(|&(_, name)| name)
            .collect(),
        underline: ["none", "single", "double", "curly", "dotted", "dashed"]
            .get(usize::from(style.attrs >> 8 & 0b111))
            .copied()
            .unwrap_or("none"),
    }
}

fn to_fixture(frame: &Frame) -> FixtureFrame {
    FixtureFrame {
        seq: frame.seq,
        cols: frame.cols,
        viewport_rows: frame.rows,
        full: frame.flags & FLAG_FULL != 0,
        viewport_scrolled: frame.flags & FLAG_VIEWPORT_SCROLLED != 0,
        cursor: FixtureCursor {
            x: frame.cursor_x,
            y: frame.cursor_y,
            style: ["hidden", "block", "bar", "underline", "hollow-block"]
                .get(usize::from(frame.cursor_style))
                .copied()
                .unwrap_or("hidden"),
            blink: frame.flags & FLAG_CURSOR_BLINK != 0,
            color: (frame.cursor_color != NO_CURSOR_COLOR).then(|| hex(frame.cursor_color)),
        },
        default_fg: hex(frame.default_fg),
        default_bg: hex(frame.default_bg),
        rows: frame
            .row_records
            .iter()
            .map(|row| {
                let mut start = 0u32;
                let runs = row
                    .runs
                    .iter()
                    .map(|&(id, len)| {
                        let run = run_json(start, len, &frame.styles[usize::from(id)]);
                        start += u32::from(len);
                        run
                    })
                    .collect();
                FixtureRow {
                    y: row.y,
                    wrapped: row.flags & 1 != 0,
                    prompt: ["none", "prompt", "continuation"]
                        .get(usize::from(row.flags >> 1 & 0b11))
                        .copied()
                        .unwrap_or("none"),
                    text: row.text(),
                    runs,
                }
            })
            .collect(),
    }
}

fn check(name: &str, bytes: &[u8]) -> Frame {
    let frame = decode(bytes);
    let mut json = serde_json::to_string_pretty(&to_fixture(&frame)).unwrap();
    json.push('\n');
    let dir = fixture_dir();
    let frame_path = dir.join(format!("{name}.frame"));
    let json_path = dir.join(format!("{name}.json"));
    if std::env::var_os("UPDATE_FIXTURES").is_some_and(|v| v == "1") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&frame_path, bytes).unwrap();
        std::fs::write(&json_path, &json).unwrap();
    } else {
        let hint = "run the test with UPDATE_FIXTURES=1 to regenerate";
        let on_disk = std::fs::read(&frame_path)
            .unwrap_or_else(|e| panic!("{}: {e}; {hint}", frame_path.display()));
        assert!(
            on_disk == bytes,
            "{name}.frame differs from the encoder output; {hint}"
        );
        let on_disk = std::fs::read_to_string(&json_path)
            .unwrap_or_else(|e| panic!("{}: {e}; {hint}", json_path.display()));
        assert_eq!(on_disk, json, "{name}.json differs; {hint}");
    }
    frame
}

fn terminal(cols: u16, rows: u16) -> Terminal<'static, 'static> {
    Terminal::new(TerminalOptions {
        cols,
        rows,
        max_scrollback: 100,
    })
    .unwrap()
}

fn frame_of(
    term: &Terminal<'static, 'static>,
    snap: &mut Snapshotter,
    seq: u32,
    full: bool,
) -> Vec<u8> {
    snap.build(term, seq, full)
        .unwrap()
        .expect("a frame")
        .to_vec()
}

fn full_frame(cols: u16, rows: u16, input: &[u8]) -> Vec<u8> {
    let mut term = terminal(cols, rows);
    term.vt_write(input);
    frame_of(&term, &mut Snapshotter::new().unwrap(), 1, true)
}

fn style_at(frame: &Frame, y: u16, x: usize) -> &CellStyle {
    let row = frame.row(y).unwrap();
    let mut at = 0usize;
    for &(id, len) in &row.runs {
        at += usize::from(len);
        if x < at {
            return &frame.styles[usize::from(id)];
        }
    }
    &frame.styles[0]
}

#[test]
fn plain_text() {
    let f = check("plain-text", &full_frame(24, 4, b"hello\r\nworld"));
    assert_eq!(f.row(0).unwrap().text(), "hello");
    assert_eq!(f.row(1).unwrap().text(), "world");
    assert_eq!(f.row(2).unwrap().cells.len(), 0);
    assert_eq!((f.cursor_x, f.cursor_y), (5, 1));
    assert_eq!(f.styles.len(), 1);
}

#[test]
fn styled_palette() {
    let input = concat!(
        "\x1b[31mred\x1b[0m \x1b[1;32mbold green\x1b[0m\r\n",
        "\x1b[38;5;208mfg208\x1b[48;5;21m bg21\x1b[0m\r\n",
        "\x1b[3mitalic\x1b[0m \x1b[2mfaint\x1b[0m \x1b[7minverse\x1b[0m\r\n",
        "\x1b[9mstrike\x1b[0m \x1b[53mover\x1b[0m \x1b[5mblink\x1b[0m \x1b[8mhid\x1b[0m\r\n",
        "\x1b[4msingle\x1b[0m \x1b[4:2mdouble\x1b[0m \x1b[4:3mcurly\x1b[0m\r\n",
        "\x1b[4:4mdotted\x1b[0m \x1b[4:5mdashed\x1b[0m \x1b[4;58;5;196mul196\x1b[0m",
    );
    let f = check("styled-palette", &full_frame(40, 6, input.as_bytes()));
    assert_eq!(f.row(0).unwrap().text(), "red bold green");
    assert_ne!(style_at(&f, 0, 0).fg & COLOR_SET, 0);
    assert_eq!(style_at(&f, 0, 3), &CellStyle::DEFAULT);
    assert_ne!(style_at(&f, 0, 4).attrs & ATTR_BOLD, 0);
    assert_ne!(style_at(&f, 1, 6).bg & COLOR_SET, 0);
    assert_ne!(style_at(&f, 2, 0).attrs & ATTR_ITALIC, 0);
    assert_ne!(style_at(&f, 2, 7).attrs & ATTR_FAINT, 0);
    assert_ne!(style_at(&f, 2, 13).attrs & ATTR_INVERSE, 0);
    assert_ne!(style_at(&f, 3, 0).attrs & ATTR_STRIKETHROUGH, 0);
    assert_ne!(style_at(&f, 3, 7).attrs & ATTR_OVERLINE, 0);
    assert_ne!(style_at(&f, 3, 12).attrs & ATTR_BLINK, 0);
    assert_ne!(style_at(&f, 3, 18).attrs & ATTR_INVISIBLE, 0);
    assert_eq!(style_at(&f, 4, 0).attrs >> 8, 1);
    assert_eq!(style_at(&f, 4, 7).attrs >> 8, 2);
    assert_eq!(style_at(&f, 4, 14).attrs >> 8, 3);
    assert_eq!(style_at(&f, 5, 0).attrs >> 8, 4);
    assert_eq!(style_at(&f, 5, 7).attrs >> 8, 5);
    assert_ne!(style_at(&f, 5, 14).underline_color & COLOR_SET, 0);
}

#[test]
fn styled_truecolor() {
    let input = concat!(
        "\x1b[38;2;255;128;0morange\x1b[0m \x1b[48;2;0;64;128mnavy\x1b[0m\r\n",
        "\x1b[4;58;2;10;20;30mulrgb\x1b[0m\r\n",
        "\x1b[48;2;40;40;40mfill\x1b[K\x1b[0m",
    );
    let f = check("styled-truecolor", &full_frame(16, 3, input.as_bytes()));
    assert_eq!(style_at(&f, 0, 0).fg, 0x0100_80ff);
    assert_eq!(style_at(&f, 0, 7).bg, 0x0180_4000);
    assert_eq!(style_at(&f, 1, 0).underline_color, 0x011e_140a);
    let filled = f.row(2).unwrap();
    assert_eq!(filled.cells.len(), 16, "erased cells keep their background");
    assert_eq!(style_at(&f, 2, 15).bg, 0x0128_2828);
}

#[test]
fn wide_and_combining() {
    let input = "\u{4e2d}\u{6587}ab\r\ne\u{301}x \u{1f680}!\r\n0123456789A\u{4e2d}";
    let f = check("wide-combining", &full_frame(12, 4, input.as_bytes()));
    let row0 = f.row(0).unwrap();
    assert_eq!(row0.text(), "\u{4e2d}\u{6587}ab");
    assert_eq!(row0.cells[0], 0x4e2d | CELL_WIDE_HEAD);
    assert_eq!(row0.cells[1], CELL_SPACER_TAIL);
    let row1 = f.row(1).unwrap();
    assert_eq!(
        row1.cells[0] & CODEPOINT_MASK,
        u32::from('e'),
        "first codepoint only"
    );
    assert_eq!(row1.text(), "ex \u{1f680}!");
    let row2 = f.row(2).unwrap();
    assert_eq!(
        row2.flags & 1,
        1,
        "a wide char that does not fit wraps the row"
    );
    assert_eq!(f.row(3).unwrap().text(), "\u{4e2d}");
}

#[test]
fn partial_frame() {
    let mut term = terminal(20, 4);
    let mut snap = Snapshotter::new().unwrap();
    term.vt_write(b"one\r\ntwo\r\nthree");
    frame_of(&term, &mut snap, 1, true);
    term.vt_write(b"\x1b[2;1H\x1b[2KTWO");
    let f = check("partial", &frame_of(&term, &mut snap, 2, false));
    assert!(!f.full());
    assert_eq!(f.seq, 2);
    // The row the cursor left is redrawn too, without its cursor.
    let ys: Vec<u16> = f.row_records.iter().map(|r| r.y).collect();
    assert_eq!(ys, vec![1, 2]);
    assert_eq!(f.row(1).unwrap().text(), "TWO");
    assert_eq!(f.row(2).unwrap().text(), "three");
    assert_eq!((f.cursor_x, f.cursor_y), (3, 1));
}

#[test]
fn nothing_changed_means_no_frame() {
    let mut term = terminal(20, 4);
    let mut snap = Snapshotter::new().unwrap();
    term.vt_write(b"idle");
    frame_of(&term, &mut snap, 1, true);
    assert!(snap.build(&term, 2, false).unwrap().is_none());
}

#[test]
fn alternate_screen_repaint() {
    let repaint = concat!(
        "\x1b[?1049h\x1b[2J\x1b[H\x1b[?2026h",
        "\x1b[1;1H\x1b[7m top bar \x1b[0m",
        "\x1b[3;3Hbody",
        "\x1b[?2026l",
    );
    let mut term = terminal(20, 5);
    let mut snap = Snapshotter::new().unwrap();
    term.vt_write(b"primary text\r\n");
    frame_of(&term, &mut snap, 1, true);
    term.vt_write(repaint.as_bytes());
    let f = check("alt-screen", &frame_of(&term, &mut snap, 2, false));
    assert!(f.full(), "switching screens redraws everything");
    assert_eq!(f.row(0).unwrap().text(), " top bar");
    assert_ne!(style_at(&f, 0, 0).attrs & ATTR_INVERSE, 0);
    assert_eq!(f.row(2).unwrap().text(), "  body");
    assert!(f.row_records.iter().all(|r| !r.text().contains("primary")));
}

fn cursor_case(name: &str, setup: impl FnOnce(&mut Terminal<'static, 'static>)) -> Frame {
    let mut term = terminal(10, 2);
    term.vt_write(b"> ");
    setup(&mut term);
    check(
        name,
        &frame_of(&term, &mut Snapshotter::new().unwrap(), 1, true),
    )
}

#[test]
fn cursor_styles() {
    let f = cursor_case("cursor-block", |t| t.vt_write(b"\x1b[2 q"));
    assert_eq!((f.cursor_style, f.flags & FLAG_CURSOR_BLINK), (1, 0));
    assert_eq!((f.cursor_x, f.cursor_y), (2, 0));
    let f = cursor_case("cursor-bar", |t| t.vt_write(b"\x1b[6 q"));
    assert_eq!(f.cursor_style, 2);
    let f = cursor_case("cursor-underline", |t| t.vt_write(b"\x1b[4 q"));
    assert_eq!(f.cursor_style, 3);
    let f = cursor_case("cursor-hollow", |t| {
        t.set_default_cursor_style(Some(GhosttyCursorStyle::BlockHollow))
            .unwrap();
        t.vt_write(b"\x1b[0 q");
    });
    assert_eq!(f.cursor_style, 4);
    let f = cursor_case("cursor-hidden", |t| t.vt_write(b"\x1b[?25l"));
    assert_eq!(f.cursor_style, 0);
    let f = cursor_case("cursor-blink", |t| t.vt_write(b"\x1b[1 q"));
    assert_eq!(
        (f.cursor_style, f.flags & FLAG_CURSOR_BLINK),
        (1, FLAG_CURSOR_BLINK)
    );
    let f = cursor_case("cursor-color", |t| t.vt_write(b"\x1b]12;#ff8800\x07"));
    assert_eq!(f.cursor_color, 0x0000_88ff);
}

#[test]
fn wrapped_prompt_rows() {
    let input = b"\x1b]133;A\x07$ \x1b]133;B\x070123456789abc";
    let f = check("wrap-and-prompt", &full_frame(10, 4, input));
    let row0 = f.row(0).unwrap();
    assert_eq!(row0.text(), "$ 01234567");
    assert_eq!(row0.flags & 1, 1, "soft wrapped");
    assert_eq!(row0.flags >> 1, 1, "prompt row");
    assert_eq!(f.row(1).unwrap().text(), "89abc");
}

#[test]
fn scrolled_viewport() {
    let mut term = terminal(10, 3);
    for i in 0..8 {
        term.vt_write(format!("line {i}\r\n").as_bytes());
    }
    term.scroll_viewport(ScrollViewport::Delta(-3));
    let f = check(
        "scrolled",
        &frame_of(&term, &mut Snapshotter::new().unwrap(), 1, true),
    );
    assert_ne!(f.flags & FLAG_VIEWPORT_SCROLLED, 0);
    assert_eq!(f.row(0).unwrap().text(), "line 3");
}

/// Snapshot plus encode of a full 200x60 frame of styled output. Run with
/// `--ignored --nocapture`, optimized, to read the number.
#[test]
#[ignore = "timing; run optimized with --ignored --nocapture"]
fn full_frame_encode_time() {
    use super::bench::{Payload, PayloadKind};
    for kind in [PayloadKind::Ascii, PayloadKind::Sgr, PayloadKind::Tui] {
        let mut term = terminal(200, 60);
        let mut payload = Vec::new();
        Payload::new(kind, 60).fill(&mut payload, 4 * 1024 * 1024);
        term.vt_write(&payload);
        let mut snap = Snapshotter::new().unwrap();
        let mut len = 0;
        for _ in 0..20 {
            len = frame_of(&term, &mut snap, 1, true).len();
        }
        const REPS: u32 = 500;
        let started = std::time::Instant::now();
        for _ in 0..REPS {
            snap.build(&term, 1, true).unwrap().unwrap();
        }
        let micros = started.elapsed().as_secs_f64() * 1e6 / f64::from(REPS);
        println!("full 200x60 frame, {kind:?}: {micros:.1} us, {len} bytes");
    }
}
