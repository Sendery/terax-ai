//! Keeps a shell prompt intact when the terminal changes width.
//!
//! zsh and bash repaint their prompt on SIGWINCH from where they believe it
//! starts: they move the cursor up by the number of rows the prompt and the
//! typed command occupied at the old width, erase, and print again. By then
//! the terminal has reflowed those rows to the new width, so the count is
//! wrong. Too few rows up (narrowing) leaves a copy of the first prompt rows
//! behind; too many (widening) erases command output above the prompt.
//!
//! The cure is to erase the prompt before the reflow: blank rows that are
//! not soft-wrapped keep their count at any width, so the shell's count is
//! right again and it repaints over blank rows. libghostty has this built in
//! (`OSC 133;A;redraw=1`), but at the pinned commit it leaves the soft-wrap
//! flag on the rows it blanks, so a prompt that wrapped still loses or gains
//! rows in the reflow, and it leaves the cursor in its column, which adds a
//! row when that column no longer exists. It also finds the prompt through
//! unsigned row flags. Terax therefore never sends `redraw=` and does the
//! erase here, anchored on marks signed with the session token:
//!
//! - `OSC 133;A;aid=<token>;terax_redraw=1`: a prompt starts on this row and
//!   the shell promises to repaint, on a size change, everything from the
//!   row of the last `A` or `P` mark down.
//! - `OSC 133;P;...;aid=<token>`: a prompt line starts on this row (zsh: the
//!   first line of `PS1`; bash: every line, since readline repaints only the
//!   last one).
//! - `OSC 133;C` or `D`: the prompt is gone, nothing is erased.

use super::shell::ShellEvent;
use libghostty_vt::{
    screen::{Screen, TrackedGridRef},
    terminal::{Mode, Point, PointCoordinate, PointSpace},
    Terminal,
};

#[derive(Default)]
pub struct PromptRedraw {
    /// The shell on screen promised to repaint from `anchor`.
    armed: bool,
    /// Row of the last prompt mark; follows the row through scrolls and
    /// reflows.
    anchor: Option<TrackedGridRef>,
}

impl PromptRedraw {
    /// Call for every shell event, right after the bytes up to its mark
    /// reached the terminal (the cursor is then where the mark was written).
    pub fn observe(&mut self, term: &Terminal<'_, '_>, event: &ShellEvent) {
        match event {
            ShellEvent::PromptStart { redraws } => {
                self.armed = *redraws;
                self.anchor = if self.armed { cursor_row(term) } else { None };
            }
            ShellEvent::PromptLine => {
                if self.armed {
                    self.anchor = cursor_row(term);
                }
            }
            ShellEvent::PromptEnd => {}
            ShellEvent::CommandStart { .. } | ShellEvent::CommandEnd { .. } => {
                self.armed = false;
                self.anchor = None;
            }
        }
    }

    /// Call before a resize that changes the column count. Erases the prompt
    /// rows the shell is about to repaint and returns whether it did.
    /// `stream_at_ground` must be false while the output stream is inside an
    /// escape sequence, where no bytes can be inserted.
    pub fn before_reflow(&mut self, term: &mut Terminal<'_, '_>, stream_at_ground: bool) -> bool {
        if !self.armed || !stream_at_ground {
            return false;
        }
        let Some(rows) = self.rows(term) else {
            return false;
        };
        // Erase from the prompt's first row to the end of the screen (ED 0
        // also drops the soft-wrap flags, EL 2 would not) and park the
        // cursor on its own row at the left edge. Both shells start their
        // repaint with relative vertical moves and a carriage return.
        let (top, cursor) = rows;
        term.vt_write(format!("\x1b[{top};1H\x1b[J\x1b[{cursor};1H").as_bytes());
        true
    }

    /// One-based rows of the prompt start and of the cursor, when the prompt
    /// can be erased safely.
    fn rows(&self, term: &Terminal<'_, '_>) -> Option<(u32, u32)> {
        if term.active_screen().ok()? != Screen::Primary || term.mode(Mode::ORIGIN).ok()? {
            return None;
        }
        // No value: the mark scrolled out of the screen. The shell cannot
        // repaint such a prompt correctly and neither can we.
        let top = self.anchor.as_ref()?.point(PointSpace::Active).ok()??.y;
        let cursor = u32::from(term.cursor_y().ok()?);
        (top <= cursor).then_some((top + 1, cursor + 1))
    }
}

fn cursor_row(term: &Terminal<'_, '_>) -> Option<TrackedGridRef> {
    if term.active_screen().ok()? != Screen::Primary {
        return None;
    }
    let y = u32::from(term.cursor_y().ok()?);
    term.track_grid_ref(Point::Active(PointCoordinate { x: 0, y }))
        .ok()
}
