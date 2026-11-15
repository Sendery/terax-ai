use libghostty_vt::fmt::Format;
use libghostty_vt::selection::gesture::{DragEvent, Geometry, Gesture, PressEvent, ReleaseEvent};
use libghostty_vt::selection::{FormatOptions, SelectWordOptions};
use libghostty_vt::terminal::{Point, PointCoordinate};
use libghostty_vt::{Error, Terminal};
use serde::Deserialize;
use std::time::Duration;

const MAX_SELECTION_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum SelectionCommand {
    Press {
        col: u16,
        row: u16,
        x: f64,
        y: f64,
        #[serde(rename = "atMs")]
        at_ms: u64,
    },
    Drag {
        col: u16,
        row: u16,
        x: f64,
        y: f64,
        #[serde(rename = "cellWidth")]
        cell_width: u32,
        #[serde(rename = "paddingLeft")]
        padding_left: u32,
        #[serde(rename = "screenHeight")]
        screen_height: u32,
        rectangle: bool,
    },
    Release,
    Word {
        col: u16,
        row: u16,
    },
    All,
    Clear,
    Read,
}
impl SelectionCommand {
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Self::Press { x, y, at_ms, .. } => {
                validate_position(*x, *y)?;
                if *at_ms > 9_000_000_000_000 {
                    return Err("invalid selection event time".into());
                }
            }
            Self::Drag {
                x,
                y,
                cell_width,
                padding_left,
                screen_height,
                ..
            } => {
                validate_position(*x, *y)?;
                if *cell_width == 0
                    || *cell_width > 100_000
                    || *screen_height == 0
                    || *screen_height > 1_000_000
                    || *padding_left > 1_000_000
                {
                    return Err("invalid selection surface geometry".into());
                }
            }
            _ => {}
        }
        Ok(())
    }
    pub fn mutates(&self) -> bool {
        !matches!(self, Self::Read)
    }
}
fn validate_position(x: f64, y: f64) -> Result<(), String> {
    if !x.is_finite() || !y.is_finite() || x.abs() > 1_000_000.0 || y.abs() > 1_000_000.0 {
        Err("invalid selection position".into())
    } else {
        Ok(())
    }
}

pub struct SelectionState {
    gesture: Option<Gesture<'static>>,
    byte_limit: usize,
}
impl Default for SelectionState {
    fn default() -> Self {
        Self {
            gesture: None,
            byte_limit: MAX_SELECTION_BYTES,
        }
    }
}
pub struct SelectionUpdate {
    pub redraw: bool,
    pub text: Result<Option<String>, String>,
}
impl SelectionState {
    pub fn update(
        &mut self,
        term: &Terminal<'_, '_>,
        command: &SelectionCommand,
    ) -> SelectionUpdate {
        SelectionUpdate {
            redraw: command.mutates(),
            text: self.apply(term, command),
        }
    }
    pub fn reset(&mut self, term: &Terminal<'_, '_>) {
        if let Some(gesture) = self.gesture.as_mut() {
            gesture.reset(term);
        }
    }
    fn gesture(&mut self) -> Result<&mut Gesture<'static>, String> {
        if self.gesture.is_none() {
            self.gesture = Some(Gesture::new().map_err(|error| error.to_string())?);
        }
        Ok(self.gesture.as_mut().expect("gesture was initialized"))
    }
    pub fn apply(
        &mut self,
        term: &Terminal<'_, '_>,
        command: &SelectionCommand,
    ) -> Result<Option<String>, String> {
        command.validate()?;
        let point = |col: u16, row: u16| {
            term.grid_ref(Point::Viewport(PointCoordinate {
                x: col,
                y: u32::from(row),
            }))
            .map_err(|error| error.to_string())
        };
        match command {
            SelectionCommand::Press {
                col,
                row,
                x,
                y,
                at_ms,
            } => {
                let grid_ref = point(*col, *row)?;
                let mut event = PressEvent::new().map_err(|error| error.to_string())?;
                event
                    .set_position(*x, *y)
                    .map_err(|error| error.to_string())?
                    .set_time(Duration::from_millis(*at_ms))
                    .map_err(|error| error.to_string())?
                    .set_repeat_interval(Duration::from_millis(300))
                    .map_err(|error| error.to_string())?
                    .set_repeat_distance(4.0)
                    .map_err(|error| error.to_string())?;
                let selection = event
                    .apply(self.gesture()?, term, grid_ref)
                    .map_err(|error| error.to_string())?;
                term.set_selection(selection.as_ref())
                    .map_err(|error| error.to_string())?;
            }
            SelectionCommand::Drag {
                col,
                row,
                x,
                y,
                cell_width,
                padding_left,
                screen_height,
                rectangle,
            } => {
                let grid_ref = point(*col, *row)?;
                let mut event = DragEvent::new().map_err(|error| error.to_string())?;
                event
                    .set_position(*x, *y)
                    .map_err(|error| error.to_string())?
                    .set_rectangle(*rectangle)
                    .map_err(|error| error.to_string())?;
                let geometry = Geometry {
                    columns: u32::from(term.cols().map_err(|error| error.to_string())?),
                    cell_width: *cell_width,
                    padding_left: *padding_left,
                    screen_height: *screen_height,
                };
                let selection = event
                    .apply(self.gesture()?, term, grid_ref, geometry)
                    .map_err(|error| error.to_string())?;
                term.set_selection(selection.as_ref())
                    .map_err(|error| error.to_string())?;
            }
            SelectionCommand::Release => {
                if let Some(gesture) = self.gesture.as_mut() {
                    ReleaseEvent::new()
                        .map_err(|error| error.to_string())?
                        .apply(gesture, term, None)
                        .map_err(|error| error.to_string())?;
                }
            }
            SelectionCommand::Word { col, row } => {
                let selection = term
                    .select_word(SelectWordOptions::new(point(*col, *row)?))
                    .map_err(|error| error.to_string())?;
                self.reset(term);
                term.set_selection(selection.as_ref())
                    .map_err(|error| error.to_string())?;
            }
            SelectionCommand::All => {
                let selection = term.select_all().map_err(|error| error.to_string())?;
                self.reset(term);
                term.set_selection(selection.as_ref())
                    .map_err(|error| error.to_string())?;
            }
            SelectionCommand::Clear => {
                self.reset(term);
                term.set_selection(None)
                    .map_err(|error| error.to_string())?;
            }
            SelectionCommand::Read => {}
        }
        read_selection(term, self.byte_limit)
    }
}

fn read_selection(term: &Terminal<'_, '_>, byte_limit: usize) -> Result<Option<String>, String> {
    let options = || {
        FormatOptions::new()
            .with_emit_format(Format::Plain)
            .with_unwrap(true)
            .with_trim(true)
    };
    let required = match term.format_selection_buf(options(), &mut []) {
        Ok(None) => return Ok(None),
        Ok(Some(0)) => return Ok(Some(String::new())),
        Err(Error::OutOfSpace { required }) if required > 0 => required,
        Err(error) => return Err(format!("format terminal selection: {error}")),
        Ok(_) => return Err("invalid terminal selection sizing reply".into()),
    };
    if byte_limit == 0 || byte_limit > MAX_SELECTION_BYTES || required > byte_limit {
        return Err("terminal selection exceeds the output byte limit".into());
    }
    let mut bytes = vec![0; required];
    let written = term
        .format_selection_buf(options(), &mut bytes)
        .map_err(|error| error.to_string())?
        .ok_or("terminal selection became unavailable")?;
    if written > bytes.len() {
        return Err("invalid terminal selection output size".into());
    }
    bytes.truncate(written);
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| "terminal selection returned invalid UTF-8".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use libghostty_vt::{Terminal, TerminalOptions};

    fn terminal() -> Terminal<'static, 'static> {
        Terminal::new(TerminalOptions {
            cols: 20,
            rows: 3,
            max_scrollback: 1024 * 1024,
        })
        .unwrap()
    }
    fn command(value: serde_json::Value) -> SelectionCommand {
        serde_json::from_value(value).unwrap()
    }
    fn press(col: u16, at_ms: u64) -> SelectionCommand {
        command(
            serde_json::json!({"kind":"press", "col":col,"row":0,"x": f64::from(col)*10.0+1.0,"y":5.0,"atMs":at_ms}),
        )
    }
    fn drag(col: u16) -> SelectionCommand {
        command(
            serde_json::json!({"kind":"drag", "col":col,"row":0,"x":f64::from(col)*10.0+9.0,"y":5.0,"cellWidth":10,"paddingLeft":0,"screenHeight":30,"rectangle":false}),
        )
    }

    #[test]
    fn drag_selects_real_terminal_text_and_release_preserves_it() {
        let mut term = terminal();
        term.vt_write(b"hello world");
        let mut selection = SelectionState::default();
        selection.apply(&term, &press(0, 100)).unwrap();
        assert_eq!(
            selection.apply(&term, &drag(4)).unwrap().as_deref(),
            Some("hello")
        );
        assert_eq!(
            selection
                .apply(&term, &SelectionCommand::Release)
                .unwrap()
                .as_deref(),
            Some("hello")
        );
        assert_eq!(
            selection.apply(&term, &SelectionCommand::Clear).unwrap(),
            None
        );
        selection.reset(&term);
    }
    #[test]
    fn word_and_all_selection_keep_combining_and_wide_text() {
        let mut term = terminal();
        term.vt_write("a\u{301}bc \u{65e5}\u{672c}".as_bytes());
        let mut selection = SelectionState::default();
        let word = command(serde_json::json!({"kind":"word","col":1,"row":0}));
        assert_eq!(
            selection.apply(&term, &word).unwrap().as_deref(),
            Some("a\u{301}bc")
        );
        assert_eq!(
            selection
                .apply(&term, &SelectionCommand::All)
                .unwrap()
                .as_deref(),
            Some("a\u{301}bc \u{65e5}\u{672c}")
        );
        selection.reset(&term);
    }
    #[test]
    fn a_formatting_error_after_mutation_still_requires_a_redraw() {
        let mut term = terminal();
        term.vt_write(b"one two three");
        let mut state = SelectionState {
            gesture: None,
            byte_limit: 4,
        };
        let word = command(serde_json::json!({"kind":"word","col":0,"row":0}));
        assert_eq!(state.apply(&term, &word).unwrap().as_deref(), Some("one"));
        let update = state.update(&term, &SelectionCommand::All);
        assert!(
            update.redraw,
            "formatting failure must not hide a selection mutation"
        );
        assert!(update.text.is_err());
        assert!(
            state.apply(&term, &SelectionCommand::Read).is_err(),
            "old selected text cannot stand in for the changed selection"
        );
        state.reset(&term);
    }

    #[test]
    fn invalid_coordinates_and_geometry_are_rejected_without_clearing_selection() {
        let mut term = terminal();
        term.vt_write(b"hello");
        let mut selection = SelectionState::default();
        selection.apply(&term, &SelectionCommand::All).unwrap();
        assert!(selection.apply(&term, &press(30, 100)).is_err());
        let invalid = command(
            serde_json::json!({"kind":"drag","col":1,"row":0,"x":1.0,"y":1.0,"cellWidth":0,"paddingLeft":0,"screenHeight":3,"rectangle":false}),
        );
        assert!(selection.apply(&term, &invalid).is_err());
        assert_eq!(
            selection
                .apply(&term, &SelectionCommand::Read)
                .unwrap()
                .as_deref(),
            Some("hello")
        );
        selection.reset(&term);
    }
}
