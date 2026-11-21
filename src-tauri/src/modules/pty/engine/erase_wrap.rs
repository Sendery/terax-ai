//! Erase-in-Line (EL 2, `ESC [ 2 K`) clears a whole row but, like xterm,
//! Ghostty keeps the row's soft-wrap flag. Programs that repaint by erasing
//! lines (Ink: Claude Code, Gemini CLI) then leave rows marked as continuing
//! into the next one although they now hold separate lines: copying joins
//! them without the newline, and widening the terminal reflows them into one
//! row with a gap in the middle.
//!
//! EL 0 (`ESC [ K`) does reset the flag. After an EL 2 the row is already
//! blank, so following it with an EL 0 changes no cell, moves no cursor and
//! only drops the stale flag. This filter adds that EL 0 on the way into the
//! terminal, keeping sequences split across reads intact and leaving string
//! payloads (OSC, DCS, APC, PM, SOS) untouched.

const ESC: u8 = 0x1b;
const BEL: u8 = 0x07;
const RESET_WRAP: &[u8] = b"\x1b[K";
/// A CSI longer than this is not one we rewrite; it is flushed as is.
const CSI_HOLD_MAX: usize = 64;

#[derive(Clone, Copy, PartialEq, Eq)]
enum State {
    Ground,
    Escape,
    Csi,
    /// Inside OSC / DCS / APC / PM / SOS until ST (or BEL for OSC).
    Text {
        osc: bool,
    },
    /// Saw ESC inside a string: `\` ends it, anything else continues it.
    TextEscape {
        osc: bool,
    },
}

pub struct EraseWrapFix {
    state: State,
    csi: Vec<u8>,
}

impl Default for EraseWrapFix {
    fn default() -> Self {
        Self {
            state: State::Ground,
            csi: Vec::with_capacity(16),
        }
    }
}

impl EraseWrapFix {
    /// Appends `input` to `out`, with an EL 0 after every complete EL 2.
    pub fn process(&mut self, input: &[u8], out: &mut Vec<u8>) {
        if self.state == State::Ground && !input.contains(&ESC) {
            out.extend_from_slice(input);
            return;
        }
        out.reserve(input.len() + 8);
        for &byte in input {
            match self.state {
                State::Ground => {
                    if byte == ESC {
                        self.state = State::Escape;
                    }
                    out.push(byte);
                }
                State::Escape => {
                    out.push(byte);
                    self.state = match byte {
                        b'[' => {
                            self.csi.clear();
                            State::Csi
                        }
                        b']' => State::Text { osc: true },
                        b'P' | b'_' | b'^' | b'X' => State::Text { osc: false },
                        ESC => State::Escape,
                        _ => State::Ground,
                    };
                }
                State::Csi => {
                    out.push(byte);
                    match byte {
                        0x40..=0x7e => {
                            if byte == b'K' && is_erase_complete(&self.csi) {
                                out.extend_from_slice(RESET_WRAP);
                            }
                            self.csi.clear();
                            self.state = State::Ground;
                        }
                        ESC => {
                            // An interrupted sequence; start over on the ESC.
                            self.csi.clear();
                            self.state = State::Escape;
                        }
                        _ => {
                            if self.csi.len() < CSI_HOLD_MAX {
                                self.csi.push(byte);
                            } else {
                                // Too long to be EL 2: stop tracking it.
                                self.csi.clear();
                                self.csi.push(b'?');
                            }
                        }
                    }
                }
                State::Text { osc } => {
                    out.push(byte);
                    if byte == ESC {
                        self.state = State::TextEscape { osc };
                    } else if osc && byte == BEL {
                        self.state = State::Ground;
                    }
                }
                State::TextEscape { osc } => {
                    out.push(byte);
                    self.state = match byte {
                        b'\\' => State::Ground,
                        ESC => State::TextEscape { osc },
                        _ => State::Text { osc },
                    };
                }
            }
        }
    }
}

/// `2`, or `02` and so on: EL with mode 2 and nothing else (no private
/// marker, no intermediates, a single parameter).
fn is_erase_complete(params: &[u8]) -> bool {
    !params.is_empty()
        && params.iter().all(u8::is_ascii_digit)
        && params.iter().skip_while(|&&b| b == b'0').eq(b"2".iter())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(chunks: &[&[u8]]) -> Vec<u8> {
        let mut fix = EraseWrapFix::default();
        let mut out = Vec::new();
        for chunk in chunks {
            fix.process(chunk, &mut out);
        }
        out
    }

    #[test]
    fn appends_a_wrap_reset_after_erase_complete_line() {
        assert_eq!(run(&[b"a\x1b[2Kb"]), b"a\x1b[2K\x1b[Kb");
        assert_eq!(run(&[b"\x1b[02K"]), b"\x1b[02K\x1b[K");
    }

    #[test]
    fn leaves_other_erases_and_sequences_alone() {
        for input in [
            &b"\x1b[K"[..],
            b"\x1b[0K",
            b"\x1b[1K",
            b"\x1b[?2K",
            b"\x1b[2J",
            b"\x1b[12K",
            b"\x1b[2;1K",
            b"\x1b[2 K",
            b"plain text",
            "caf\u{e9} \u{1f680}".as_bytes(),
        ] {
            assert_eq!(run(&[input]), input, "{:?}", String::from_utf8_lossy(input));
        }
    }

    #[test]
    fn handles_sequences_split_across_reads() {
        assert_eq!(run(&[b"x\x1b", b"[", b"2", b"Ky"]), b"x\x1b[2K\x1b[Ky");
    }

    #[test]
    fn ignores_look_alikes_inside_string_payloads() {
        // An OSC title cannot contain ESC, but a DCS passthrough can carry
        // sequences meant for another terminal: neither is touched.
        let osc = b"\x1b]0;title [2K\x07\x1b[2K";
        assert_eq!(run(&[osc]), b"\x1b]0;title [2K\x07\x1b[2K\x1b[K");
        let dcs = b"\x1bPtmux;\x1b\x1b[2K\x1b\\after";
        assert_eq!(run(&[dcs]), dcs);
        let st = b"\x1b]8;;https://x\x1b\\\x1b[2K";
        assert_eq!(run(&[st]), b"\x1b]8;;https://x\x1b\\\x1b[2K\x1b[K");
    }

    #[test]
    fn a_very_long_csi_is_passed_through_untracked() {
        let mut long = b"\x1b[".to_vec();
        long.extend(std::iter::repeat_n(b'2', 100));
        long.push(b'K');
        assert_eq!(run(&[&long]), long);
    }
}
