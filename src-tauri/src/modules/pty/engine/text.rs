use libghostty_vt::fmt::Format;
use libghostty_vt::selection::{FormatOptions, Selection};
use libghostty_vt::terminal::{Point, PointCoordinate};
use libghostty_vt::{Error, Terminal};

pub const MAX_LINES: u16 = 1000;
const MAX_TEXT_BYTES: usize = 1024 * 1024;

pub fn validate_lines(lines: u16) -> Result<(), String> {
    if lines == 0 || lines > MAX_LINES {
        Err("terminal text line limit must be 1 through 1000".into())
    } else {
        Ok(())
    }
}

pub fn read_text(term: &Terminal<'_, '_>, lines: u16) -> Result<String, String> {
    read_text_limited(term, lines, MAX_TEXT_BYTES)
}

fn read_text_limited(term: &Terminal<'_, '_>, lines: u16, limit: usize) -> Result<String, String> {
    validate_lines(lines)?;
    if limit == 0 || limit > MAX_TEXT_BYTES {
        return Err("invalid terminal text byte limit".into());
    }
    let total = term.total_rows().map_err(|e| e.to_string())?;
    if total == 0 {
        return Ok(String::new());
    }
    let end_y = u32::try_from(total - 1).map_err(|_| "terminal text row range is too large")?;
    let start_y = u32::try_from(total.saturating_sub(usize::from(lines)))
        .map_err(|_| "terminal text row range is too large")?;
    let cols = term.cols().map_err(|e| e.to_string())?;
    if cols == 0 {
        return Err("terminal text grid has no columns".into());
    }
    let start = term
        .grid_ref(Point::Screen(PointCoordinate { x: 0, y: start_y }))
        .map_err(|e| e.to_string())?;
    let end = term
        .grid_ref(Point::Screen(PointCoordinate {
            x: cols - 1,
            y: end_y,
        }))
        .map_err(|e| e.to_string())?;
    let selection = Selection::new(start, end, false);
    let options = || {
        FormatOptions::new()
            .with_emit_format(Format::Plain)
            .with_unwrap(false)
            .with_trim(true)
            .with_selection(&selection)
    };
    let required = match term.format_selection_buf(options(), &mut []) {
        Ok(Some(0)) => return Ok(String::new()),
        Err(Error::OutOfSpace { required }) if required > 0 => required,
        Err(error) => return Err(format!("format terminal text: {error}")),
        Ok(_) => return Err("invalid terminal text sizing reply".into()),
    };
    if required > limit {
        return Err("terminal text exceeds the output byte limit".into());
    }
    let mut bytes = vec![0; required];
    let written = term
        .format_selection_buf(options(), &mut bytes)
        .map_err(|error| format!("format terminal text: {error}"))?
        .ok_or("terminal text selection is unavailable")?;
    if written > bytes.len() {
        return Err("invalid terminal text output size".into());
    }
    bytes.truncate(written);
    let text =
        String::from_utf8(bytes).map_err(|_| "terminal text formatter returned invalid UTF-8")?;
    let mut rows: Vec<&str> = text
        .split('\n')
        .map(|line| line.trim_end_matches([' ', '\r']))
        .collect();
    while rows.last() == Some(&"") {
        rows.pop();
    }
    Ok(rows.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use libghostty_vt::terminal::ScrollViewport;
    use libghostty_vt::{Terminal, TerminalOptions};

    fn terminal(cols: u16, rows: u16) -> Terminal<'static, 'static> {
        Terminal::new(TerminalOptions {
            cols,
            rows,
            max_scrollback: 1024 * 1024,
        })
        .unwrap()
    }

    #[test]
    fn an_empty_terminal_has_valid_empty_text() {
        let term = terminal(8, 2);
        assert_eq!(read_text(&term, 2).unwrap(), "");
    }

    #[test]
    fn reads_the_bounded_tail_independent_of_viewport_without_mutating_selection() {
        let mut term = terminal(16, 2);
        term.vt_write(b"one\r\ntwo\r\nthree\r\nfour");
        assert_eq!(read_text(&term, 2).unwrap(), "three\nfour");
        term.scroll_viewport(ScrollViewport::Delta(-100));
        assert_eq!(read_text(&term, 1).unwrap(), "four");
        assert!(term
            .format_selection_buf(libghostty_vt::selection::FormatOptions::new(), &mut [0; 32])
            .unwrap()
            .is_none());
    }

    #[test]
    fn preserves_combining_wide_text_and_physical_wrapped_rows() {
        let mut term = terminal(32, 3);
        term.vt_write("é e\u{301} 中 \u{1f680}".as_bytes());
        assert_eq!(read_text(&term, 3).unwrap(), "é e\u{301} 中 \u{1f680}");
        let mut wrapped = terminal(4, 3);
        wrapped.vt_write(b"abcdefghij");
        assert_eq!(read_text(&wrapped, 3).unwrap(), "abcd\nefgh\nij");
    }

    #[test]
    fn reads_the_active_alternate_screen_and_restores_primary_history() {
        let mut term = terminal(16, 2);
        term.vt_write(b"main\r\nhistory");
        term.vt_write(b"\x1b[?1049h\x1b[H\x1b[2Jalternate");
        assert_eq!(read_text(&term, 2).unwrap(), "alternate");
        term.vt_write(b"\x1b[?1049l");
        assert_eq!(read_text(&term, 2).unwrap(), "main\nhistory");
    }

    #[test]
    fn rejects_invalid_limits_and_insufficient_output_space_explicitly() {
        let mut term = terminal(80, 2);
        term.vt_write(b"not a truncated success");
        assert!(read_text(&term, 0).is_err());
        assert!(read_text(&term, 1001).is_err());
        assert!(read_text_limited(&term, 2, 8).is_err());
    }
}
