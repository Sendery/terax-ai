use libghostty_vt::{terminal::Mode, Terminal};

pub fn apply(term: &mut Terminal<'_, '_>, enabled: bool) -> Result<(), libghostty_vt::Error> {
    term.set_default_cursor_blink(Some(enabled))?
        .set_mode(Mode::CURSOR_BLINKING, enabled)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use libghostty_vt::render::CursorVisualStyle;
    use libghostty_vt::terminal::Mode;
    use libghostty_vt::{RenderState, Terminal, TerminalOptions};
    fn cursor(term: &Terminal<'_, '_>) -> (bool, CursorVisualStyle) {
        let mut state = RenderState::new().unwrap();
        let snapshot = state.update(term).unwrap();
        (
            snapshot.cursor_blinking().unwrap(),
            snapshot.cursor_visual_style().unwrap(),
        )
    }
    #[test]
    fn pinned_core_supports_cursor_default_and_current_mode_without_overriding_later_program_negotiation(
    ) {
        let mut term = Terminal::new(TerminalOptions {
            cols: 80,
            rows: 24,
            max_scrollback: 0,
        })
        .unwrap();
        term.set_default_cursor_blink(Some(true))
            .expect("pinned core must support DEFAULT_CURSOR_BLINK option23");
        term.set_mode(Mode::CURSOR_BLINKING, true)
            .expect("pinned core must support DEC12");
        assert!(cursor(&term).0);
        term.vt_write(b"\x1b[2 q");
        assert!(!cursor(&term).0);
        term.vt_write(b"\x1b[0 q");
        assert!(cursor(&term).0);
        term.vt_write(b"\x1b[3 q");
        assert_eq!(cursor(&term), (true, CursorVisualStyle::Underline));
        term.set_default_cursor_blink(Some(false)).unwrap();
        term.set_mode(Mode::CURSOR_BLINKING, false).unwrap();
        assert_eq!(cursor(&term), (false, CursorVisualStyle::Underline));
        term.vt_write(b"\x1b[5 q");
        assert_eq!(cursor(&term), (true, CursorVisualStyle::Bar));
        term.vt_write(b"\x1b[?12l");
        assert!(!cursor(&term).0);
        term.vt_write(b"\x1b[?12h");
        assert!(cursor(&term).0);
        term.vt_write(b"\x1b[0 q");
        assert!(!cursor(&term).0);
    }
}

#[cfg(test)]
mod actor_tests {
    use super::super::{
        frame::{
            decode::{decode, Frame},
            CursorStyle, FLAG_CURSOR_BLINK,
        },
        shell::ShellToken,
        start_with_shell_appearance, Appearance, Engine, ShellConfig,
    };
    use std::sync::mpsc::{self, Receiver};
    use std::time::Duration;

    fn actor(blocks: bool) -> (Engine, Receiver<Vec<u8>>) {
        let (tx, rx) = mpsc::channel();
        let engine = start_with_shell_appearance(
            20,
            3,
            Appearance {
                cursor_blink: true,
                ..Appearance::default()
            },
            ShellConfig {
                token: ShellToken::for_test(),
                blocks,
            },
            Box::new(move |frame| tx.send(frame).is_ok()),
            Box::new(|_| {}),
        )
        .unwrap();
        (engine, rx)
    }
    fn frame(rx: &Receiver<Vec<u8>>, stage: &str) -> Frame {
        decode(
            &rx.recv_timeout(Duration::from_secs(5))
                .unwrap_or_else(|error| panic!("{stage}: {error}")),
        )
    }
    fn blinking(frame: &Frame) -> bool {
        frame.flags & FLAG_CURSOR_BLINK != 0
    }
    #[test]
    fn startup_and_live_preference_preserve_later_program_cursor_choices_in_ordinary_and_blocks() {
        for blocks in [false, true] {
            let (engine, rx) = actor(blocks);
            let mut current = frame(&rx, "startup");
            assert!(
                blinking(&current),
                "startup preference must precede first frame"
            );
            engine.handle.credit(current.seq);
            assert!(engine.input.feed(b"\x1b[2 q".to_vec()));
            current = frame(&rx, "program steady block");
            assert!(!blinking(&current));
            assert_eq!(current.cursor_style, CursorStyle::Block as u8);

            engine.handle.set_cursor_blink(true);
            engine.handle.credit(current.seq);
            current = frame(&rx, "live preference true");
            assert!(blinking(&current));
            assert_eq!(current.cursor_style, CursorStyle::Block as u8);

            engine.handle.credit(current.seq);
            assert!(engine.input.feed(b"\x1b[4 q".to_vec()));
            current = frame(&rx, "program steady underline");
            assert!(!blinking(&current));
            assert_eq!(current.cursor_style, CursorStyle::Underline as u8);

            engine.handle.request_full();
            engine.handle.credit(current.seq);
            current = frame(&rx, "full reconstruction");
            assert!(
                !blinking(&current),
                "full reconstruction cannot reapply the user preference"
            );
            assert_eq!(current.cursor_style, CursorStyle::Underline as u8);

            engine.handle.credit(current.seq);
            assert!(engine.input.feed(b"\x1b[0 q".to_vec()));
            current = frame(&rx, "program default reset");
            assert!(
                blinking(&current),
                "program default reset must use current preference"
            );

            engine.handle.set_cursor_blink(false);
            engine.handle.credit(current.seq);
            current = frame(&rx, "live preference false");
            assert!(!blinking(&current));
            engine.handle.credit(current.seq);
            assert!(engine.input.feed(b"\x1b[5 q".to_vec()));
            current = frame(&rx, "program blinking bar");
            assert!(
                blinking(&current),
                "later program negotiation must remain effective"
            );
            assert_eq!(current.cursor_style, CursorStyle::Bar as u8);
            engine.input.shutdown();
            engine.thread.join().unwrap();
        }
    }
}
