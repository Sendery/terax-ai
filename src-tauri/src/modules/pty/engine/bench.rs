//! Bench sessions: an engine with no PTY, fed a generated payload as fast as
//! it accepts it. The payloads are the spike's (`spikes/terminal-ghostty-vt`),
//! generated in blocks so a large run never holds the whole payload.

use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

use super::Engine;

pub const MAX_MEGABYTES: u32 = 1024;
const MIB: usize = 1024 * 1024;
// One PTY read's worth, as the real reader hands the engine.
const CHUNK: usize = 16 * 1024;
const BLOCK: usize = 256 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PayloadKind {
    Ascii,
    Sgr,
    Tui,
}

impl PayloadKind {
    pub fn parse(kind: &str) -> Option<Self> {
        match kind {
            "ascii" => Some(Self::Ascii),
            "sgr" => Some(Self::Sgr),
            "tui" => Some(Self::Tui),
            _ => None,
        }
    }
}

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

    fn pick<'a>(&mut self, items: &[&'a str]) -> &'a str {
        items[self.below(items.len() as u32) as usize]
    }
}

const WORDS: &[&str] = &[
    "compiling",
    "terax",
    "warning",
    "unused",
    "variable",
    "src/modules/terminal",
    "finished",
    "release",
    "target",
    "error[E0308]",
    "mismatched",
    "types",
    "expected",
    "found",
    "request",
    "200",
    "GET",
    "/api/v1/sessions",
    "12ms",
    "cache",
    "hit",
    "INFO",
    "DEBUG",
    "worker",
    "spawned",
    "pid=48211",
    "renderer",
    "slot",
    "bound",
    "flush",
];

const GLYPHS: &[&str] = &[
    "\u{2500}",
    "\u{2502}",
    "\u{2714}",
    "\u{4e2d}\u{6587}",
    "\u{1f680}",
    "\u{e9}",
    "\u{f1}",
];

/// Deterministic payload: the same kind and size always produce the same bytes.
pub struct Payload {
    kind: PayloadKind,
    rng: Lcg,
    rows: u16,
    started: bool,
}

impl Payload {
    pub fn new(kind: PayloadKind, rows: u16) -> Self {
        let seed = match kind {
            PayloadKind::Ascii => 1,
            PayloadKind::Sgr => 2,
            PayloadKind::Tui => 3,
        };
        Self {
            kind,
            rng: Lcg(seed),
            rows,
            started: false,
        }
    }

    /// Appends whole lines (whole repaints for `tui`) until `out` holds at
    /// least `target` bytes.
    pub fn fill(&mut self, out: &mut Vec<u8>, target: usize) {
        if !self.started {
            self.started = true;
            if self.kind == PayloadKind::Tui {
                out.extend_from_slice(b"\x1b[?1049h\x1b[2J");
            }
        }
        while out.len() < target {
            match self.kind {
                PayloadKind::Ascii => self.ascii_line(out),
                PayloadKind::Sgr => self.sgr_line(out),
                PayloadKind::Tui => self.tui_repaint(out),
            }
        }
    }

    fn ascii_line(&mut self, out: &mut Vec<u8>) {
        let words = 6 + self.rng.below(12);
        for i in 0..words {
            if i > 0 {
                out.push(b' ');
            }
            out.extend_from_slice(self.rng.pick(WORDS).as_bytes());
        }
        out.extend_from_slice(b"\r\n");
    }

    fn sgr_line(&mut self, out: &mut Vec<u8>) {
        let rng = &mut self.rng;
        let words = 5 + rng.below(10);
        for i in 0..words {
            if i > 0 {
                out.push(b' ');
            }
            let _ = match rng.below(4) {
                0 => write!(out, "\x1b[38;5;{}m", rng.below(256)),
                1 => write!(
                    out,
                    "\x1b[38;2;{};{};{}m",
                    rng.below(256),
                    rng.below(256),
                    rng.below(256)
                ),
                2 => write!(out, "\x1b[1;{}m", 30 + rng.below(8)),
                _ => write!(out, "\x1b[4;48;5;{}m", rng.below(256)),
            };
            out.extend_from_slice(rng.pick(WORDS).as_bytes());
            if rng.below(6) == 0 {
                out.push(b' ');
                out.extend_from_slice(rng.pick(GLYPHS).as_bytes());
            }
            out.extend_from_slice(b"\x1b[0m");
        }
        out.extend_from_slice(b"\r\n");
    }

    // Synchronized-output repaint with absolute addressing, the shape Claude
    // Code and Pi emit.
    fn tui_repaint(&mut self, out: &mut Vec<u8>) {
        let rng = &mut self.rng;
        let span = (u32::from(self.rows) / 2).max(9);
        out.extend_from_slice(b"\x1b[?2026h\x1b[?25l");
        let first = 1 + rng.below(span);
        let count = 8 + rng.below(span - 8);
        for r in first..first + count {
            let _ = write!(out, "\x1b[{r};1H\x1b[2K");
            let _ = write!(out, "\x1b[38;5;{}m\u{2502}\x1b[0m ", rng.below(256));
            let words = 4 + rng.below(10);
            for _ in 0..words {
                if rng.below(3) == 0 {
                    let _ = write!(
                        out,
                        "\x1b[38;2;{};{};{}m",
                        rng.below(256),
                        rng.below(256),
                        rng.below(256)
                    );
                }
                out.extend_from_slice(rng.pick(WORDS).as_bytes());
                out.extend_from_slice(b"\x1b[0m ");
            }
        }
        let _ = write!(out, "\x1b[{};3H\x1b[?25h\x1b[?2026l", first + count);
    }
}

pub fn validate_megabytes(megabytes: u32) -> Result<(), String> {
    if megabytes == 0 || megabytes > MAX_MEGABYTES {
        return Err(format!("megabytes must be 1..={MAX_MEGABYTES}"));
    }
    Ok(())
}

/// Feeds `megabytes` of `kind` into the engine in PTY sized chunks, then shuts
/// it down and reports 0, or -1 when cancelled first.
pub fn run(
    engine: Engine,
    kind: PayloadKind,
    megabytes: u32,
    rows: u16,
    cancel: Arc<AtomicBool>,
    on_exit: impl FnOnce(i32) + Send + 'static,
) -> Result<(), String> {
    let Engine { input, thread, .. } = engine;
    thread::Builder::new()
        .name("terax-gterm-bench".into())
        .spawn(move || {
            let total = megabytes as usize * MIB;
            let mut payload = Payload::new(kind, rows);
            let mut block = Vec::with_capacity(BLOCK + 8 * 1024);
            let mut fed = 0usize;
            'feed: while fed < total {
                block.clear();
                payload.fill(&mut block, BLOCK.min(total - fed));
                for chunk in block.chunks(CHUNK) {
                    if cancel.load(Ordering::Relaxed) || !input.feed(chunk.to_vec()) {
                        break 'feed;
                    }
                    fed += chunk.len();
                }
            }
            let completed = fed >= total && !cancel.load(Ordering::Relaxed);
            input.shutdown();
            thread.join();
            on_exit(if completed { 0 } else { -1 });
        })
        .map(|_| ())
        .map_err(|e| format!("spawn bench feeder: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_parse() {
        assert_eq!(PayloadKind::parse("ascii"), Some(PayloadKind::Ascii));
        assert_eq!(PayloadKind::parse("sgr"), Some(PayloadKind::Sgr));
        assert_eq!(PayloadKind::parse("tui"), Some(PayloadKind::Tui));
        assert_eq!(PayloadKind::parse("TUI"), None);
        assert_eq!(PayloadKind::parse(""), None);
    }

    #[test]
    fn megabytes_are_bounded() {
        assert!(validate_megabytes(1).is_ok());
        assert!(validate_megabytes(MAX_MEGABYTES).is_ok());
        assert!(validate_megabytes(0).is_err());
        assert!(validate_megabytes(MAX_MEGABYTES + 1).is_err());
    }

    #[test]
    fn payloads_are_deterministic_and_reach_the_target() {
        for kind in [PayloadKind::Ascii, PayloadKind::Sgr, PayloadKind::Tui] {
            let mut a = Vec::new();
            let mut b = Vec::new();
            Payload::new(kind, 60).fill(&mut a, 64 * 1024);
            Payload::new(kind, 60).fill(&mut b, 64 * 1024);
            assert!(a.len() >= 64 * 1024, "{kind:?}");
            assert_eq!(a, b, "{kind:?}");
        }
    }

    #[test]
    fn tui_handles_small_terminals() {
        let mut out = Vec::new();
        Payload::new(PayloadKind::Tui, 4).fill(&mut out, 16 * 1024);
        assert!(out.starts_with(b"\x1b[?1049h"));
    }
}
