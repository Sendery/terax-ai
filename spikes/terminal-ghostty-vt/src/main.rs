use std::error::Error;
use std::fs;
use std::io::Write;
use std::time::{Duration, Instant};

use libghostty_vt::render::{CellIterator, Dirty, RowIterator};
use libghostty_vt::screen::CellWide;
use libghostty_vt::style::Underline;
use libghostty_vt::{RenderState, Terminal, TerminalOptions};

type Res<T> = Result<T, Box<dyn Error>>;

const READ_BUF: usize = 16 * 1024;
const SCROLLBACK: usize = 10_000;

const FLAG_BOLD: u32 = 1;
const FLAG_ITALIC: u32 = 2;
const FLAG_UNDERLINE: u32 = 4;
const FLAG_INVERSE: u32 = 8;
const FLAG_FAINT: u32 = 16;
const FLAG_STRIKE: u32 = 32;
const FLAG_WIDE: u32 = 64;
const FLAG_HAS_FG: u32 = 128;
const BG_HAS: u32 = 1 << 24;

struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u32 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (self.0 >> 33) as u32
    }
    fn below(&mut self, n: u32) -> u32 {
        self.next() % n
    }
}

const WORDS: &[&str] = &[
    "compiling", "terax", "warning", "unused", "variable", "src/modules/terminal",
    "finished", "release", "target", "error[E0308]", "mismatched", "types", "expected",
    "found", "request", "200", "GET", "/api/v1/sessions", "12ms", "cache", "hit", "INFO",
    "DEBUG", "worker", "spawned", "pid=48211", "renderer", "slot", "bound", "flush",
];

fn gen_ascii(target: usize) -> Vec<u8> {
    let mut rng = Lcg(1);
    let mut out = Vec::with_capacity(target + 256);
    while out.len() < target {
        let words = 6 + rng.below(12);
        for i in 0..words {
            if i > 0 {
                out.push(b' ');
            }
            out.extend_from_slice(WORDS[rng.below(WORDS.len() as u32) as usize].as_bytes());
        }
        out.extend_from_slice(b"\r\n");
    }
    out
}

const GLYPHS: &[&str] = &["\u{2500}", "\u{2502}", "\u{2714}", "\u{4e2d}\u{6587}", "\u{1f680}", "\u{e9}", "\u{f1}"];

fn gen_sgr(target: usize) -> Vec<u8> {
    let mut rng = Lcg(2);
    let mut out = Vec::with_capacity(target + 256);
    while out.len() < target {
        let words = 5 + rng.below(10);
        for i in 0..words {
            if i > 0 {
                out.push(b' ');
            }
            match rng.below(4) {
                0 => write!(out, "\x1b[38;5;{}m", rng.below(256)).unwrap(),
                1 => write!(
                    out,
                    "\x1b[38;2;{};{};{}m",
                    rng.below(256),
                    rng.below(256),
                    rng.below(256)
                )
                .unwrap(),
                2 => write!(out, "\x1b[1;{}m", 30 + rng.below(8)).unwrap(),
                _ => write!(out, "\x1b[4;48;5;{}m", rng.below(256)).unwrap(),
            }
            out.extend_from_slice(WORDS[rng.below(WORDS.len() as u32) as usize].as_bytes());
            if rng.below(6) == 0 {
                out.push(b' ');
                out.extend_from_slice(GLYPHS[rng.below(GLYPHS.len() as u32) as usize].as_bytes());
            }
            out.extend_from_slice(b"\x1b[0m");
        }
        out.extend_from_slice(b"\r\n");
    }
    out
}

// Full-screen agent style repaint: synchronized output, absolute cursor
// addressing, erase-line and styled text, the shape Claude Code and Pi emit.
fn gen_tui(target: usize, rows: u16) -> Vec<u8> {
    let mut rng = Lcg(3);
    let mut out = Vec::with_capacity(target + 4096);
    out.extend_from_slice(b"\x1b[?1049h\x1b[2J");
    while out.len() < target {
        out.extend_from_slice(b"\x1b[?2026h\x1b[?25l");
        let first = 1 + rng.below(u32::from(rows) / 2);
        let count = 8 + rng.below(u32::from(rows) / 2 - 8);
        for r in first..first + count {
            write!(out, "\x1b[{r};1H\x1b[2K").unwrap();
            write!(out, "\x1b[38;5;{}m\u{2502}\x1b[0m ", rng.below(256)).unwrap();
            let words = 4 + rng.below(10);
            for _ in 0..words {
                if rng.below(3) == 0 {
                    write!(out, "\x1b[38;2;{};{};{}m", rng.below(256), rng.below(256), rng.below(256))
                        .unwrap();
                }
                out.extend_from_slice(WORDS[rng.below(WORDS.len() as u32) as usize].as_bytes());
                out.extend_from_slice(b"\x1b[0m ");
            }
        }
        write!(out, "\x1b[{};3H\x1b[?25h\x1b[?2026l", first + count).unwrap();
    }
    out
}

struct FrameEncoder<'a> {
    render: RenderState<'a>,
    rows: RowIterator<'a>,
    cells: CellIterator<'a>,
    seq: u32,
}

struct FrameInfo {
    dirty_rows: u16,
    full: bool,
}

impl<'a> FrameEncoder<'a> {
    fn new() -> Res<Self> {
        Ok(Self {
            render: RenderState::new()?,
            rows: RowIterator::new()?,
            cells: CellIterator::new()?,
            seq: 0,
        })
    }

    // Frame layout, little endian:
    //   u32 seq, u16 cols, u16 rows, u16 cursor_x, u16 cursor_y,
    //   u8 cursor_visible, u8 full, u16 dirty_row_count,
    //   u32 default_fg, u32 default_bg,
    //   then per dirty row: u16 y, u16 pad, cols * (u32 codepoint, u32 fg|flags, u32 bg)
    fn encode(&mut self, term: &Terminal<'a, '_>, force_full: bool, out: &mut Vec<u8>) -> Res<Option<FrameInfo>> {
        out.clear();
        let snapshot = self.render.update(term)?;
        let dirty = snapshot.dirty()?;
        if dirty == Dirty::Clean && !force_full {
            return Ok(None);
        }
        let full = force_full || dirty == Dirty::Full;
        let cols = snapshot.cols()?;
        let rows = snapshot.rows()?;
        let colors = snapshot.colors()?;
        let cursor = snapshot.cursor_viewport()?;
        let visible = snapshot.cursor_visible()? && cursor.is_some();
        let (cx, cy) = cursor.map_or((0, 0), |c| (c.x, c.y));

        out.extend_from_slice(&self.seq.to_le_bytes());
        out.extend_from_slice(&cols.to_le_bytes());
        out.extend_from_slice(&rows.to_le_bytes());
        out.extend_from_slice(&cx.to_le_bytes());
        out.extend_from_slice(&cy.to_le_bytes());
        out.push(u8::from(visible));
        out.push(u8::from(full));
        let count_at = out.len();
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&rgb(colors.foreground.r, colors.foreground.g, colors.foreground.b).to_le_bytes());
        out.extend_from_slice(&rgb(colors.background.r, colors.background.g, colors.background.b).to_le_bytes());

        let mut dirty_rows = 0u16;
        let mut y = 0u16;
        let mut row_iter = self.rows.update(&snapshot)?;
        while let Some(row) = row_iter.next() {
            if full || row.dirty()? {
                dirty_rows += 1;
                out.extend_from_slice(&y.to_le_bytes());
                out.extend_from_slice(&0u16.to_le_bytes());
                let mut cell_iter = self.cells.update(row)?;
                while let Some(cell) = cell_iter.next() {
                    let raw = cell.raw_cell()?;
                    let mut cp = 0u32;
                    let mut fg = 0u32;
                    let mut bg = 0u32;
                    if raw.has_text()? {
                        cp = raw.codepoint()?;
                    }
                    if raw.wide()? == CellWide::Wide {
                        fg |= FLAG_WIDE << 24;
                    }
                    if cell.has_styling()? {
                        let style = cell.style()?;
                        let mut flags = 0u32;
                        if style.bold { flags |= FLAG_BOLD; }
                        if style.italic { flags |= FLAG_ITALIC; }
                        if style.underline != Underline::None { flags |= FLAG_UNDERLINE; }
                        if style.inverse { flags |= FLAG_INVERSE; }
                        if style.faint { flags |= FLAG_FAINT; }
                        if style.strikethrough { flags |= FLAG_STRIKE; }
                        if let Some(c) = cell.fg_color()? {
                            flags |= FLAG_HAS_FG;
                            fg |= rgb(c.r, c.g, c.b);
                        }
                        fg |= flags << 24;
                    }
                    if let Some(c) = cell.bg_color()? {
                        bg = rgb(c.r, c.g, c.b) | BG_HAS;
                    }
                    out.extend_from_slice(&cp.to_le_bytes());
                    out.extend_from_slice(&fg.to_le_bytes());
                    out.extend_from_slice(&bg.to_le_bytes());
                }
                row.set_dirty(false)?;
            }
            y += 1;
        }
        out[count_at..count_at + 2].copy_from_slice(&dirty_rows.to_le_bytes());
        snapshot.set_dirty(Dirty::Clean)?;
        self.seq += 1;
        Ok(Some(FrameInfo { dirty_rows, full }))
    }
}

fn rgb(r: u8, g: u8, b: u8) -> u32 {
    u32::from(r) | u32::from(g) << 8 | u32::from(b) << 16
}

fn new_terminal(cols: u16, rows: u16) -> Res<Terminal<'static, 'static>> {
    Ok(Terminal::new(TerminalOptions { cols, rows, max_scrollback: SCROLLBACK })?)
}

fn mbps(bytes: usize, d: Duration) -> f64 {
    bytes as f64 / (1024.0 * 1024.0) / d.as_secs_f64()
}

fn bench(path: &str, cols: u16, rows: u16) -> Res<()> {
    let data = fs::read(path)?;
    let mut best = Duration::MAX;
    for _ in 0..3 {
        let mut term = new_terminal(cols, rows)?;
        let start = Instant::now();
        for chunk in data.chunks(READ_BUF) {
            term.vt_write(chunk);
        }
        best = best.min(start.elapsed());
    }
    let parse = mbps(data.len(), best);

    // Worst case for the frame path: one frame per 64 KiB of input, far above
    // the 60 frames per second a real session would produce at this throughput.
    let every = 64 * 1024;
    let mut term = new_terminal(cols, rows)?;
    let mut enc = FrameEncoder::new()?;
    let mut frame = Vec::with_capacity(usize::from(cols) * usize::from(rows) * 12 + 64);
    let (mut frames, mut frame_bytes, mut dirty_rows, mut full_frames) = (0u64, 0u64, 0u64, 0u64);
    let mut frame_time = Duration::ZERO;
    let start = Instant::now();
    for chunk in data.chunks(every) {
        for part in chunk.chunks(READ_BUF) {
            term.vt_write(part);
        }
        let t = Instant::now();
        if let Some(info) = enc.encode(&term, false, &mut frame)? {
            frames += 1;
            frame_bytes += frame.len() as u64;
            dirty_rows += u64::from(info.dirty_rows);
            full_frames += u64::from(info.full);
        }
        frame_time += t.elapsed();
    }
    let total = start.elapsed();

    let t = Instant::now();
    let reps = 200;
    for _ in 0..reps {
        enc.encode(&term, true, &mut frame)?;
    }
    let full_us = t.elapsed().as_secs_f64() * 1e6 / f64::from(reps);

    println!(
        "{{\"file\":\"{path}\",\"bytes\":{},\"cols\":{cols},\"rows\":{rows},\"parse_mb_s\":{parse:.1},\"parse_with_frames_mb_s\":{:.1},\"frames\":{frames},\"full_frames\":{full_frames},\"avg_frame_us\":{:.1},\"avg_frame_bytes\":{},\"avg_dirty_rows\":{:.1},\"forced_full_frame_us\":{full_us:.1},\"full_frame_bytes\":{}}}",
        data.len(),
        mbps(data.len(), total),
        frame_time.as_secs_f64() * 1e6 / frames.max(1) as f64,
        frame_bytes / frames.max(1),
        dirty_rows as f64 / frames.max(1) as f64,
        frame.len(),
    );
    Ok(())
}

fn frames(path: &str, cols: u16, rows: u16, every_kb: usize, max: usize, out_path: &str) -> Res<()> {
    let data = fs::read(path)?;
    let mut term = new_terminal(cols, rows)?;
    let mut enc = FrameEncoder::new()?;
    let mut frame = Vec::new();
    let mut out = Vec::new();
    let mut n = 0;
    for chunk in data.chunks(every_kb * 1024) {
        for part in chunk.chunks(READ_BUF) {
            term.vt_write(part);
        }
        if enc.encode(&term, n == 0, &mut frame)?.is_some() {
            out.extend_from_slice(&(frame.len() as u32).to_le_bytes());
            out.extend_from_slice(&frame);
            n += 1;
            if n >= max {
                break;
            }
        }
    }
    fs::write(out_path, &out)?;
    eprintln!("{n} frames, {} bytes -> {out_path}", out.len());
    Ok(())
}

fn main() -> Res<()> {
    let args: Vec<String> = std::env::args().collect();
    let arg = |i: usize| args.get(i).map(String::as_str).ok_or("missing argument");
    match arg(1)? {
        "gen" => {
            let target = arg(3)?.parse::<usize>()? * 1024 * 1024;
            let data = match arg(2)? {
                "ascii" => gen_ascii(target),
                "sgr" => gen_sgr(target),
                "tui" => gen_tui(target, 60),
                other => return Err(format!("unknown payload {other}").into()),
            };
            fs::write(arg(4)?, data)?;
        }
        "bench" => bench(arg(2)?, arg(3)?.parse()?, arg(4)?.parse()?)?,
        "frames" => frames(
            arg(2)?,
            arg(3)?.parse()?,
            arg(4)?.parse()?,
            arg(5)?.parse()?,
            arg(6)?.parse()?,
            arg(7)?,
        )?,
        other => return Err(format!("unknown command {other}").into()),
    }
    Ok(())
}
