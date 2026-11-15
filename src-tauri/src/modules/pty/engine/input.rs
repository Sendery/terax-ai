use libghostty_vt::key::{Action, Encoder, Event, Key, Mods};
use libghostty_vt::screen::{CellWide, Screen};
use libghostty_vt::terminal::{Mode, Point, PointCoordinate};
use libghostty_vt::{focus, mouse, paste, Error, Terminal};
use serde::Deserialize;

pub const MAX_PASTE_BYTES: usize = 1024 * 1024;
const MAX_KEY_BYTES: usize = 4096;
const MOD_MASK: u16 = 63;

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum InputEvent {
    Key { event: KeyEvent },
    Paste { text: String },
    Mouse { event: MouseEvent },
    MoveCursor { event: CursorTarget },
    Focus { focused: bool },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CursorTarget {
    col: u16,
    row: u16,
    cols: u16,
    rows: u16,
    cursor_x: u16,
    cursor_y: u16,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct KeyEvent {
    code: KeyCode,
    text: Option<String>,
    action: KeyAction,
    mods: u16,
    consumed_mods: u16,
    unshifted: Option<char>,
    legacy_shift_enter: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MouseEvent {
    #[serde(default = "one")]
    repeat: u8,
    action: MouseAction,
    button: Option<u8>,
    mods: u16,
    x: f64,
    y: f64,
    cell_width: u32,
    cell_height: u32,
    screen_width: u32,
    screen_height: u32,
    buttons: u8,
}

fn one() -> u8 {
    1
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum MouseAction {
    Press,
    Release,
    Motion,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
enum KeyAction {
    #[default]
    Press,
    Release,
    Repeat,
}

impl InputEvent {
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Self::Key { event } => {
                if event.mods & !MOD_MASK != 0 || event.consumed_mods & !event.mods != 0 {
                    return Err("invalid terminal key modifiers".into());
                }
                if event
                    .text
                    .as_ref()
                    .is_some_and(|text| text.len() > MAX_KEY_BYTES)
                {
                    return Err("terminal key text exceeds the byte limit".into());
                }
            }
            Self::Mouse { event } => {
                if event.repeat == 0
                    || event.repeat > 32
                    || (event.repeat > 1
                        && (!matches!(event.action, MouseAction::Press)
                            || !matches!(event.button, Some(3..=6))))
                    || event.mods & !MOD_MASK != 0
                    || event.button.is_some_and(|button| button > 8)
                    || event.buttons > 31
                    || !event.x.is_finite()
                    || !event.y.is_finite()
                    || event.x.abs() > 1_000_000.0
                    || event.y.abs() > 1_000_000.0
                    || event.cell_width == 0
                    || event.cell_height == 0
                    || event.cell_width > 4096
                    || event.cell_height > 4096
                    || event.screen_width == 0
                    || event.screen_height == 0
                    || event.screen_width > 1_000_000
                    || event.screen_height > 1_000_000
                {
                    return Err("invalid terminal mouse event".into());
                }
            }
            Self::MoveCursor { event } => {
                if event.cols == 0
                    || event.cols > 1000
                    || event.rows == 0
                    || event.rows > 500
                    || event.col >= event.cols
                    || event.row >= event.rows
                    || event.cursor_x >= event.cols
                    || event.cursor_y >= event.rows
                {
                    return Err("invalid terminal cursor target".into());
                }
            }
            Self::Paste { text } if text.len() > MAX_PASTE_BYTES => {
                return Err("terminal paste exceeds the byte limit".into());
            }
            _ => {}
        }
        Ok(())
    }
}

fn modifiers(bits: u16) -> Mods {
    let mut result = Mods::empty();
    for (bit, flag) in [
        (1, Mods::SHIFT),
        (2, Mods::ALT),
        (4, Mods::CTRL),
        (8, Mods::SUPER),
        (16, Mods::CAPS_LOCK),
        (32, Mods::NUM_LOCK),
    ] {
        if bits & bit != 0 {
            result |= flag;
        }
    }
    result
}

pub fn encode(
    term: &Terminal<'_, '_>,
    input: &InputEvent,
    modify_other_keys: u32,
) -> Result<Vec<u8>, String> {
    input.validate()?;
    match input {
        InputEvent::Key { event } => {
            let mut key = Event::new().map_err(|error| error.to_string())?;
            key.set_key(event.code.native())
                .set_action(match event.action {
                    KeyAction::Press => Action::Press,
                    KeyAction::Release => Action::Release,
                    KeyAction::Repeat => Action::Repeat,
                })
                .set_mods(modifiers(event.mods))
                .set_consumed_mods(modifiers(event.consumed_mods))
                .set_utf8(event.text.clone());
            if let Some(codepoint) = event.unshifted {
                key.set_unshifted_codepoint(codepoint);
            }
            let mut encoder = Encoder::new().map_err(|error| error.to_string())?;
            encoder.set_options_from_terminal(term);
            // The pinned encode_to_vec helper can fail to grow its capacity.
            // Use the required byte count from the native encoder explicitly.
            let mut output = vec![0; 128];
            let written = match encoder.encode(&key, &mut output) {
                Ok(written) => written,
                Err(Error::OutOfSpace { required })
                    if required > 0 && required <= MAX_PASTE_BYTES + 12 =>
                {
                    output.resize(required, 0);
                    encoder
                        .encode(&key, &mut output)
                        .map_err(|error| error.to_string())?
                }
                Err(error) => return Err(error.to_string()),
            };
            if written > output.len() {
                return Err("invalid terminal key output size".into());
            }
            output.truncate(written);
            if event.legacy_shift_enter
                && matches!(event.code, KeyCode::Enter | KeyCode::NumpadEnter)
                && event.mods & 15 == 1
                && !matches!(event.action, KeyAction::Release)
                && modify_other_keys == 0
                && term
                    .kitty_keyboard_flags()
                    .map_err(|error| error.to_string())?
                    .is_empty()
            {
                output = b"\x1b\r".to_vec();
            }
            Ok(output)
        }
        InputEvent::MoveCursor { event } => move_cursor(term, event, modify_other_keys),
        InputEvent::Mouse { event } => {
            let mut mouse = mouse::Event::new().map_err(|error| error.to_string())?;
            mouse
                .set_action(match event.action {
                    MouseAction::Press => mouse::Action::Press,
                    MouseAction::Release => mouse::Action::Release,
                    MouseAction::Motion => mouse::Action::Motion,
                })
                .set_button(event.button.map(|button| match button {
                    0 => mouse::Button::Left,
                    1 => mouse::Button::Middle,
                    2 => mouse::Button::Right,
                    3 => mouse::Button::Four,
                    4 => mouse::Button::Five,
                    5 => mouse::Button::Six,
                    6 => mouse::Button::Seven,
                    7 => mouse::Button::Eight,
                    _ => mouse::Button::Nine,
                }))
                .set_mods(modifiers(event.mods))
                .set_position(mouse::Position {
                    x: event.x as f32,
                    y: event.y as f32,
                });
            let mut encoder = mouse::Encoder::new().map_err(|error| error.to_string())?;
            encoder
                .set_options_from_terminal(term)
                .set_any_button_pressed(event.buttons != 0)
                .set_track_last_cell(false)
                .set_size(mouse::EncoderSize {
                    screen_width: event.screen_width,
                    screen_height: event.screen_height,
                    cell_width: event.cell_width,
                    cell_height: event.cell_height,
                    padding_top: 0,
                    padding_bottom: 0,
                    padding_left: 0,
                    padding_right: 0,
                });
            let mut output = [0; 128];
            let written = encoder
                .encode(&mouse, &mut output)
                .map_err(|error| error.to_string())?;
            Ok(output[..written].repeat(usize::from(event.repeat)))
        }
        InputEvent::Paste { text } => {
            let mut data = text.replace("\r\n", "\n").into_bytes();
            let bracketed = term
                .mode(Mode::BRACKETED_PASTE)
                .map_err(|error| error.to_string())?;
            let mut output = vec![0; data.len() + 12];
            let written = paste::encode(&mut data, bracketed, &mut output)
                .map_err(|error| error.to_string())?;
            output.truncate(written);
            Ok(output)
        }
        InputEvent::Focus { focused } => {
            if !term
                .mode(Mode::FOCUS_EVENT)
                .map_err(|error| error.to_string())?
            {
                return Ok(Vec::new());
            }
            let event = if *focused {
                focus::Event::Gained
            } else {
                focus::Event::Lost
            };
            let mut bytes = [0; 8];
            let written = event
                .encode(&mut bytes)
                .map_err(|error| error.to_string())?;
            Ok(bytes[..written].to_vec())
        }
    }
}

fn move_cursor(
    term: &Terminal<'_, '_>,
    target: &CursorTarget,
    modify_other_keys: u32,
) -> Result<Vec<u8>, String> {
    let native = |error: Error| error.to_string();
    let scrollbar = term.scrollbar().map_err(native)?;
    if term.cols().map_err(native)? != target.cols
        || term.rows().map_err(native)? != target.rows
        || term.cursor_x().map_err(native)? != target.cursor_x
        || term.cursor_y().map_err(native)? != target.cursor_y
        || scrollbar.offset.saturating_add(scrollbar.len) < scrollbar.total
        || term.is_mouse_tracking().map_err(native)?
    {
        return Ok(Vec::new());
    }
    let cols = usize::from(target.cols);
    let from = usize::from(target.cursor_y) * cols + usize::from(target.cursor_x);
    let to = usize::from(target.row) * cols + usize::from(target.col);
    let mut moves = Vec::new();
    if matches!(term.active_screen().map_err(native)?, Screen::Primary) {
        moves.push((
            if to < from {
                KeyCode::ArrowLeft
            } else {
                KeyCode::ArrowRight
            },
            from.abs_diff(to),
        ));
    } else {
        let mut wrapped = Vec::with_capacity(usize::from(target.rows));
        for y in 0..target.rows {
            wrapped.push(
                term.grid_ref(Point::Active(PointCoordinate {
                    x: 0,
                    y: u32::from(y),
                }))
                .map_err(native)?
                .row()
                .map_err(native)?
                .is_wrap_continuation()
                .map_err(native)?,
            );
        }
        let head = |mut row: usize| {
            while row > 0 && wrapped[row] {
                row -= 1;
            }
            row
        };
        let start = head(usize::from(target.cursor_y));
        let end = head(usize::from(target.row));
        let vertical = (start.min(end)..start.max(end))
            .filter(|row| !wrapped[*row])
            .count();
        let cell_distance = |from: usize, to: usize| -> Result<usize, String> {
            if from.abs_diff(to) > 32768 {
                return Err("terminal cursor movement exceeds the input limit".into());
            }
            let mut cells = 0;
            for index in from.min(to)..from.max(to) {
                let cell = term
                    .grid_ref(Point::Active(PointCoordinate {
                        x: (index % cols) as u16,
                        y: (index / cols) as u32,
                    }))
                    .map_err(native)?
                    .cell()
                    .map_err(native)?;
                if !matches!(
                    cell.wide().map_err(native)?,
                    CellWide::SpacerTail | CellWide::SpacerHead
                ) {
                    cells += 1;
                }
            }
            Ok(cells)
        };
        if vertical > 0 {
            moves.push((
                KeyCode::ArrowLeft,
                cell_distance(from, start * cols + usize::from(target.cursor_x))?,
            ));
            moves.push((
                if end < start {
                    KeyCode::ArrowUp
                } else {
                    KeyCode::ArrowDown
                },
                vertical,
            ));
        }
        let horizontal_from = if vertical > 0 {
            end * cols + usize::from(target.cursor_x)
        } else {
            from
        };
        let cells = cell_distance(horizontal_from, to)?;
        moves.push((
            if to < horizontal_from {
                KeyCode::ArrowLeft
            } else {
                KeyCode::ArrowRight
            },
            cells,
        ));
    }
    let mut output = Vec::new();
    for (code, count) in moves {
        if count > 32768 {
            return Err("terminal cursor movement exceeds the input limit".into());
        }
        let key = InputEvent::Key {
            event: KeyEvent {
                code,
                ..KeyEvent::default()
            },
        };
        let encoded = encode(term, &key, modify_other_keys)?;
        let bytes = encoded
            .len()
            .checked_mul(count)
            .ok_or("invalid terminal cursor movement")?;
        if output.len() + bytes > MAX_PASTE_BYTES {
            return Err("terminal cursor movement exceeds the input limit".into());
        }
        output.extend(encoded.repeat(count));
    }
    Ok(output)
}

// Closed mapping for DOM KeyboardEvent.code values to the pinned native enum.
#[derive(Clone, Copy, Debug, Default, Deserialize)]
enum KeyCode {
    #[default]
    Unidentified,
    Backquote,
    Backslash,
    BracketLeft,
    BracketRight,
    Comma,
    Digit0,
    Digit1,
    Digit2,
    Digit3,
    Digit4,
    Digit5,
    Digit6,
    Digit7,
    Digit8,
    Digit9,
    Equal,
    IntlBackslash,
    IntlRo,
    IntlYen,
    #[serde(rename = "KeyA")]
    A,
    #[serde(rename = "KeyB")]
    B,
    #[serde(rename = "KeyC")]
    C,
    #[serde(rename = "KeyD")]
    D,
    #[serde(rename = "KeyE")]
    E,
    #[serde(rename = "KeyF")]
    F,
    #[serde(rename = "KeyG")]
    G,
    #[serde(rename = "KeyH")]
    H,
    #[serde(rename = "KeyI")]
    I,
    #[serde(rename = "KeyJ")]
    J,
    #[serde(rename = "KeyK")]
    K,
    #[serde(rename = "KeyL")]
    L,
    #[serde(rename = "KeyM")]
    M,
    #[serde(rename = "KeyN")]
    N,
    #[serde(rename = "KeyO")]
    O,
    #[serde(rename = "KeyP")]
    P,
    #[serde(rename = "KeyQ")]
    Q,
    #[serde(rename = "KeyR")]
    R,
    #[serde(rename = "KeyS")]
    S,
    #[serde(rename = "KeyT")]
    T,
    #[serde(rename = "KeyU")]
    U,
    #[serde(rename = "KeyV")]
    V,
    #[serde(rename = "KeyW")]
    W,
    #[serde(rename = "KeyX")]
    X,
    #[serde(rename = "KeyY")]
    Y,
    #[serde(rename = "KeyZ")]
    Z,
    Minus,
    Period,
    Quote,
    Semicolon,
    Slash,
    AltLeft,
    AltRight,
    Backspace,
    CapsLock,
    ContextMenu,
    ControlLeft,
    ControlRight,
    Enter,
    MetaLeft,
    MetaRight,
    ShiftLeft,
    ShiftRight,
    Space,
    Tab,
    Convert,
    KanaMode,
    NonConvert,
    Delete,
    End,
    Help,
    Home,
    Insert,
    PageDown,
    PageUp,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    NumLock,
    Numpad0,
    Numpad1,
    Numpad2,
    Numpad3,
    Numpad4,
    Numpad5,
    Numpad6,
    Numpad7,
    Numpad8,
    Numpad9,
    NumpadAdd,
    NumpadBackspace,
    NumpadClear,
    NumpadClearEntry,
    NumpadComma,
    NumpadDecimal,
    NumpadDivide,
    NumpadEnter,
    NumpadEqual,
    NumpadMemoryAdd,
    NumpadMemoryClear,
    NumpadMemoryRecall,
    NumpadMemoryStore,
    NumpadMemorySubtract,
    NumpadMultiply,
    NumpadParenLeft,
    NumpadParenRight,
    NumpadSubtract,
    NumpadSeparator,
    NumpadUp,
    NumpadDown,
    NumpadRight,
    NumpadLeft,
    NumpadBegin,
    NumpadHome,
    NumpadEnd,
    NumpadInsert,
    NumpadDelete,
    NumpadPageUp,
    NumpadPageDown,
    Escape,
    F1,
    F2,
    F3,
    F4,
    F5,
    F6,
    F7,
    F8,
    F9,
    F10,
    F11,
    F12,
    F13,
    F14,
    F15,
    F16,
    F17,
    F18,
    F19,
    F20,
    F21,
    F22,
    F23,
    F24,
    F25,
    Fn,
    FnLock,
    PrintScreen,
    ScrollLock,
    Pause,
    BrowserBack,
    BrowserFavorites,
    BrowserForward,
    BrowserHome,
    BrowserRefresh,
    BrowserSearch,
    BrowserStop,
    Eject,
    LaunchApp1,
    LaunchApp2,
    LaunchMail,
    MediaPlayPause,
    MediaSelect,
    MediaStop,
    MediaTrackNext,
    MediaTrackPrevious,
    Power,
    Sleep,
    AudioVolumeDown,
    AudioVolumeMute,
    AudioVolumeUp,
    WakeUp,
    Copy,
    Cut,
    Paste,
}
impl KeyCode {
    fn native(self) -> Key {
        match self {
            Self::Unidentified => Key::Unidentified,
            Self::Backquote => Key::Backquote,
            Self::Backslash => Key::Backslash,
            Self::BracketLeft => Key::BracketLeft,
            Self::BracketRight => Key::BracketRight,
            Self::Comma => Key::Comma,
            Self::Digit0 => Key::Digit0,
            Self::Digit1 => Key::Digit1,
            Self::Digit2 => Key::Digit2,
            Self::Digit3 => Key::Digit3,
            Self::Digit4 => Key::Digit4,
            Self::Digit5 => Key::Digit5,
            Self::Digit6 => Key::Digit6,
            Self::Digit7 => Key::Digit7,
            Self::Digit8 => Key::Digit8,
            Self::Digit9 => Key::Digit9,
            Self::Equal => Key::Equal,
            Self::IntlBackslash => Key::IntlBackslash,
            Self::IntlRo => Key::IntlRo,
            Self::IntlYen => Key::IntlYen,
            Self::A => Key::A,
            Self::B => Key::B,
            Self::C => Key::C,
            Self::D => Key::D,
            Self::E => Key::E,
            Self::F => Key::F,
            Self::G => Key::G,
            Self::H => Key::H,
            Self::I => Key::I,
            Self::J => Key::J,
            Self::K => Key::K,
            Self::L => Key::L,
            Self::M => Key::M,
            Self::N => Key::N,
            Self::O => Key::O,
            Self::P => Key::P,
            Self::Q => Key::Q,
            Self::R => Key::R,
            Self::S => Key::S,
            Self::T => Key::T,
            Self::U => Key::U,
            Self::V => Key::V,
            Self::W => Key::W,
            Self::X => Key::X,
            Self::Y => Key::Y,
            Self::Z => Key::Z,
            Self::Minus => Key::Minus,
            Self::Period => Key::Period,
            Self::Quote => Key::Quote,
            Self::Semicolon => Key::Semicolon,
            Self::Slash => Key::Slash,
            Self::AltLeft => Key::AltLeft,
            Self::AltRight => Key::AltRight,
            Self::Backspace => Key::Backspace,
            Self::CapsLock => Key::CapsLock,
            Self::ContextMenu => Key::ContextMenu,
            Self::ControlLeft => Key::ControlLeft,
            Self::ControlRight => Key::ControlRight,
            Self::Enter => Key::Enter,
            Self::MetaLeft => Key::MetaLeft,
            Self::MetaRight => Key::MetaRight,
            Self::ShiftLeft => Key::ShiftLeft,
            Self::ShiftRight => Key::ShiftRight,
            Self::Space => Key::Space,
            Self::Tab => Key::Tab,
            Self::Convert => Key::Convert,
            Self::KanaMode => Key::KanaMode,
            Self::NonConvert => Key::NonConvert,
            Self::Delete => Key::Delete,
            Self::End => Key::End,
            Self::Help => Key::Help,
            Self::Home => Key::Home,
            Self::Insert => Key::Insert,
            Self::PageDown => Key::PageDown,
            Self::PageUp => Key::PageUp,
            Self::ArrowDown => Key::ArrowDown,
            Self::ArrowLeft => Key::ArrowLeft,
            Self::ArrowRight => Key::ArrowRight,
            Self::ArrowUp => Key::ArrowUp,
            Self::NumLock => Key::NumLock,
            Self::Numpad0 => Key::Numpad0,
            Self::Numpad1 => Key::Numpad1,
            Self::Numpad2 => Key::Numpad2,
            Self::Numpad3 => Key::Numpad3,
            Self::Numpad4 => Key::Numpad4,
            Self::Numpad5 => Key::Numpad5,
            Self::Numpad6 => Key::Numpad6,
            Self::Numpad7 => Key::Numpad7,
            Self::Numpad8 => Key::Numpad8,
            Self::Numpad9 => Key::Numpad9,
            Self::NumpadAdd => Key::NumpadAdd,
            Self::NumpadBackspace => Key::NumpadBackspace,
            Self::NumpadClear => Key::NumpadClear,
            Self::NumpadClearEntry => Key::NumpadClearEntry,
            Self::NumpadComma => Key::NumpadComma,
            Self::NumpadDecimal => Key::NumpadDecimal,
            Self::NumpadDivide => Key::NumpadDivide,
            Self::NumpadEnter => Key::NumpadEnter,
            Self::NumpadEqual => Key::NumpadEqual,
            Self::NumpadMemoryAdd => Key::NumpadMemoryAdd,
            Self::NumpadMemoryClear => Key::NumpadMemoryClear,
            Self::NumpadMemoryRecall => Key::NumpadMemoryRecall,
            Self::NumpadMemoryStore => Key::NumpadMemoryStore,
            Self::NumpadMemorySubtract => Key::NumpadMemorySubtract,
            Self::NumpadMultiply => Key::NumpadMultiply,
            Self::NumpadParenLeft => Key::NumpadParenLeft,
            Self::NumpadParenRight => Key::NumpadParenRight,
            Self::NumpadSubtract => Key::NumpadSubtract,
            Self::NumpadSeparator => Key::NumpadSeparator,
            Self::NumpadUp => Key::NumpadUp,
            Self::NumpadDown => Key::NumpadDown,
            Self::NumpadRight => Key::NumpadRight,
            Self::NumpadLeft => Key::NumpadLeft,
            Self::NumpadBegin => Key::NumpadBegin,
            Self::NumpadHome => Key::NumpadHome,
            Self::NumpadEnd => Key::NumpadEnd,
            Self::NumpadInsert => Key::NumpadInsert,
            Self::NumpadDelete => Key::NumpadDelete,
            Self::NumpadPageUp => Key::NumpadPageUp,
            Self::NumpadPageDown => Key::NumpadPageDown,
            Self::Escape => Key::Escape,
            Self::F1 => Key::F1,
            Self::F2 => Key::F2,
            Self::F3 => Key::F3,
            Self::F4 => Key::F4,
            Self::F5 => Key::F5,
            Self::F6 => Key::F6,
            Self::F7 => Key::F7,
            Self::F8 => Key::F8,
            Self::F9 => Key::F9,
            Self::F10 => Key::F10,
            Self::F11 => Key::F11,
            Self::F12 => Key::F12,
            Self::F13 => Key::F13,
            Self::F14 => Key::F14,
            Self::F15 => Key::F15,
            Self::F16 => Key::F16,
            Self::F17 => Key::F17,
            Self::F18 => Key::F18,
            Self::F19 => Key::F19,
            Self::F20 => Key::F20,
            Self::F21 => Key::F21,
            Self::F22 => Key::F22,
            Self::F23 => Key::F23,
            Self::F24 => Key::F24,
            Self::F25 => Key::F25,
            Self::Fn => Key::Fn,
            Self::FnLock => Key::FnLock,
            Self::PrintScreen => Key::PrintScreen,
            Self::ScrollLock => Key::ScrollLock,
            Self::Pause => Key::Pause,
            Self::BrowserBack => Key::BrowserBack,
            Self::BrowserFavorites => Key::BrowserFavorites,
            Self::BrowserForward => Key::BrowserForward,
            Self::BrowserHome => Key::BrowserHome,
            Self::BrowserRefresh => Key::BrowserRefresh,
            Self::BrowserSearch => Key::BrowserSearch,
            Self::BrowserStop => Key::BrowserStop,
            Self::Eject => Key::Eject,
            Self::LaunchApp1 => Key::LaunchApp1,
            Self::LaunchApp2 => Key::LaunchApp2,
            Self::LaunchMail => Key::LaunchMail,
            Self::MediaPlayPause => Key::MediaPlayPause,
            Self::MediaSelect => Key::MediaSelect,
            Self::MediaStop => Key::MediaStop,
            Self::MediaTrackNext => Key::MediaTrackNext,
            Self::MediaTrackPrevious => Key::MediaTrackPrevious,
            Self::Power => Key::Power,
            Self::Sleep => Key::Sleep,
            Self::AudioVolumeDown => Key::AudioVolumeDown,
            Self::AudioVolumeMute => Key::AudioVolumeMute,
            Self::AudioVolumeUp => Key::AudioVolumeUp,
            Self::WakeUp => Key::WakeUp,
            Self::Copy => Key::Copy,
            Self::Cut => Key::Cut,
            Self::Paste => Key::Paste,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use libghostty_vt::{Terminal, TerminalOptions};

    fn encode(term: &Terminal<'_, '_>, event: &InputEvent) -> Result<Vec<u8>, String> {
        super::encode(term, event, 0)
    }

    fn terminal() -> Terminal<'static, 'static> {
        Terminal::new(TerminalOptions {
            cols: 80,
            rows: 24,
            max_scrollback: 1024 * 1024,
        })
        .unwrap()
    }
    fn key(code: &str, mods: u16) -> InputEvent {
        serde_json::from_value(
            serde_json::json!({ "kind": "key", "event": { "code": code, "mods": mods } }),
        )
        .unwrap()
    }

    fn cursor_target(term: &Terminal<'_, '_>, col: u16, row: u16) -> InputEvent {
        InputEvent::MoveCursor {
            event: CursorTarget {
                col,
                row,
                cols: term.cols().unwrap(),
                rows: term.rows().unwrap(),
                cursor_x: term.cursor_x().unwrap(),
                cursor_y: term.cursor_y().unwrap(),
            },
        }
    }

    #[test]
    fn alt_click_moves_through_native_rows_and_live_cursor_key_modes() {
        let mut term = Terminal::new(TerminalOptions {
            cols: 8,
            rows: 4,
            max_scrollback: 8192,
        })
        .unwrap();
        term.vt_write(b"abcdefghij");
        assert_eq!(
            encode(&term, &cursor_target(&term, 5, 0)).unwrap(),
            b"\x1b[D".repeat(5)
        );
        term.vt_write(b"\x1b[?1049h\x1b[?1h\x1b[2;3H");
        assert_eq!(
            encode(&term, &cursor_target(&term, 4, 3)).unwrap(),
            [b"\x1bOB".repeat(2), b"\x1bOC".repeat(2)].concat()
        );
        term.vt_write(b"\x1b[2J\x1b[Habcdefghij");
        assert_eq!(
            encode(&term, &cursor_target(&term, 2, 2)).unwrap(),
            [b"\x1bOD".repeat(8), b"\x1bOB".to_vec()].concat()
        );
        term.vt_write("\x1b[2J\x1b[H界abcdefg".as_bytes());
        assert_eq!(
            encode(&term, &cursor_target(&term, 1, 2)).unwrap(),
            [b"\x1bOD".repeat(7), b"\x1bOB".to_vec()].concat()
        );
        term.vt_write("\x1b[2J\x1b[H界a\x1b[H".as_bytes());
        assert_eq!(
            encode(&term, &cursor_target(&term, 3, 0)).unwrap(),
            b"\x1bOC".repeat(2)
        );
    }

    #[test]
    fn alt_click_rejects_scrollback_changed_cursor_and_mouse_owner() {
        use libghostty_vt::terminal::ScrollViewport;
        let mut term = Terminal::new(TerminalOptions {
            cols: 8,
            rows: 4,
            max_scrollback: 8192,
        })
        .unwrap();
        let stale = cursor_target(&term, 4, 0);
        term.vt_write(b"x");
        assert!(encode(&term, &stale).unwrap().is_empty());
        term.vt_write(b"\x1b[?1000h");
        assert!(encode(&term, &cursor_target(&term, 4, 0))
            .unwrap()
            .is_empty());
        term.vt_write(b"\x1b[?1000l1\r\n2\r\n3\r\n4\r\n5\r\n6");
        term.scroll_viewport(ScrollViewport::Top);
        assert!(encode(&term, &cursor_target(&term, 4, 0))
            .unwrap()
            .is_empty());
    }
    #[test]
    fn mouse_encoding_follows_live_modes_and_physical_cell_geometry() {
        let mut term = terminal();
        let event = |action: &str, button: Option<u8>, buttons: u8| {
            serde_json::from_value(
            serde_json::json!({"kind":"mouse","event":{"action":action,"button":button,"buttons":buttons,
                "mods":0,"x":24.0,"y":48.0,"cellWidth":16,"cellHeight":32,"screenWidth":1280,"screenHeight":768}})
        ).unwrap()
        };
        assert!(encode(&term, &event("press", Some(0), 1))
            .unwrap()
            .is_empty());
        term.vt_write(b"\x1b[?1000h\x1b[?1006h");
        assert_eq!(
            encode(&term, &event("press", Some(0), 1)).unwrap(),
            b"\x1b[<0;2;2M"
        );
        assert_eq!(
            encode(&term, &event("release", Some(0), 0)).unwrap(),
            b"\x1b[<0;2;2m"
        );
        assert!(encode(&term, &event("motion", None, 0)).unwrap().is_empty());
        term.vt_write(b"\x1b[?1003h");
        assert_eq!(
            encode(&term, &event("motion", None, 0)).unwrap(),
            b"\x1b[<35;2;2M"
        );
        assert_eq!(
            encode(&term, &event("press", Some(3), 0)).unwrap(),
            b"\x1b[<64;2;2M"
        );
        term.vt_write(b"\x1b[?1016h");
        assert_eq!(
            encode(&term, &event("press", Some(0), 1)).unwrap(),
            b"\x1b[<0;24;48M"
        );
        let mut invalid = event("press", Some(0), 1);
        if let InputEvent::Mouse { event } = &mut invalid {
            event.cell_width = 0;
        }
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn navigation_follows_the_live_application_cursor_mode() {
        let mut term = terminal();
        assert_eq!(encode(&term, &key("ArrowUp", 0)).unwrap(), b"\x1b[A");
        term.vt_write(b"\x1b[?1h");
        assert_eq!(encode(&term, &key("ArrowUp", 0)).unwrap(), b"\x1bOA");
        term.vt_write(b"\x1b[?1l");
        assert_eq!(encode(&term, &key("ArrowUp", 0)).unwrap(), b"\x1b[A");
    }
    #[test]
    fn shifted_enter_follows_modify_other_keys_and_kitty_negotiation() {
        let mut term = terminal();
        assert_eq!(encode(&term, &key("Enter", 0)).unwrap(), b"\r");
        term.vt_write(b"\x1b[>4;2m");
        assert_eq!(encode(&term, &key("Enter", 1)).unwrap(), b"\x1b[27;2;13~");
        term.vt_write(b"\x1b[>1u");
        assert_eq!(encode(&term, &key("Enter", 1)).unwrap(), b"\x1b[13;2u");
        term.vt_write(b"\x1b[<u");
        assert_eq!(encode(&term, &key("Enter", 1)).unwrap(), b"\x1b[27;2;13~");
    }
    #[test]
    fn control_keys_and_committed_unicode_are_encoded_without_loss() {
        let term = terminal();
        assert_eq!(encode(&term, &key("KeyC", 4)).unwrap(), b"\x03");
        let text: InputEvent = serde_json::from_value(serde_json::json!({"kind":"key","event":{"code":"Unidentified","text":"a\u{301}\u{65e5}"}})).unwrap();
        assert_eq!(encode(&term, &text).unwrap(), "a\u{301}\u{65e5}".as_bytes());
    }
    #[test]
    fn paste_normalizes_newlines_and_uses_only_negotiated_brackets() {
        let mut term = terminal();
        let paste = InputEvent::Paste {
            text: "one\r\ntwo".into(),
        };
        assert_eq!(encode(&term, &paste).unwrap(), b"one\rtwo");
        term.vt_write(b"\x1b[?2004h");
        assert_eq!(
            encode(&term, &paste).unwrap(),
            b"\x1b[200~one\ntwo\x1b[201~"
        );
    }
    #[test]
    fn focus_reports_are_sent_only_when_requested() {
        let mut term = terminal();
        assert!(encode(&term, &InputEvent::Focus { focused: true })
            .unwrap()
            .is_empty());
        term.vt_write(b"\x1b[?1004h");
        assert_eq!(
            encode(&term, &InputEvent::Focus { focused: true }).unwrap(),
            b"\x1b[I"
        );
        assert_eq!(
            encode(&term, &InputEvent::Focus { focused: false }).unwrap(),
            b"\x1b[O"
        );
    }
    #[test]
    fn actor_encoding_follows_accepted_output_and_stops_when_input_finishes() {
        use std::time::Duration;
        let engine = super::super::start(40, 5, Box::new(|_| true), Box::new(|_| {})).unwrap();
        assert!(engine.input.feed(b"\x1b[>4;2m".to_vec()));
        let encoded = engine
            .input
            .encode_input(key("Enter", 1))
            .unwrap()
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .unwrap();
        assert_eq!(encoded, b"\x1b[27;2;13~");
        engine
            .input
            .finish()
            .unwrap()
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .unwrap();
        assert!(engine.input.encode_input(key("Enter", 0)).is_err());
        assert!(engine
            .handle
            .read_text(5)
            .unwrap()
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .is_ok());
        engine.handle.request_stop();
        engine.thread.join().unwrap();
    }

    #[test]
    fn committed_text_larger_than_the_initial_encoder_buffer_is_not_rejected() {
        let term = terminal();
        for text in ["a".repeat(200), "\u{65e5}".repeat(100)] {
            let event: InputEvent = serde_json::from_value(
                serde_json::json!({"kind":"key","event":{"code":"Unidentified","text":text}}),
            )
            .unwrap();
            assert_eq!(encode(&term, &event).unwrap(), text.as_bytes());
        }
    }

    #[test]
    fn product_shift_enter_fallback_preserves_negotiated_native_sequences() {
        use std::time::Duration;
        let engine = super::super::start(40, 3, Box::new(|_| true), Box::new(|_| {})).unwrap();
        let event = || {
            serde_json::from_value(serde_json::json!({"kind":"key","event":{"code":"Enter","mods":1,"legacyShiftEnter":true}})).unwrap()
        };
        let encoded = || {
            engine
                .input
                .encode_input(event())
                .unwrap()
                .recv_timeout(Duration::from_secs(2))
                .unwrap()
                .unwrap()
        };
        assert_eq!(encoded(), b"\x1b\r");
        assert!(engine.input.feed(b"\x1b[>4;2m".to_vec()));
        assert_eq!(encoded(), b"\x1b[27;2;13~");
        assert!(engine.input.feed(b"\x1b[>1u".to_vec()));
        assert_eq!(encoded(), b"\x1b[13;2u");
        engine.handle.request_stop();
        engine.thread.join().unwrap();
    }

    #[test]
    fn key_release_is_reported_only_when_the_kitty_event_mode_requests_it() {
        let mut term = terminal();
        let event: InputEvent = serde_json::from_value(
            serde_json::json!({"kind":"key","event":{"code":"Enter","mods":1,"action":"release"}}),
        )
        .unwrap();
        assert!(encode(&term, &event).unwrap().is_empty());
        // The protocol exempts Enter/Backspace/Tab release until REPORT_ALL.
        term.vt_write(b"\x1b[>3u");
        assert!(encode(&term, &event).unwrap().is_empty());
        term.vt_write(b"\x1b[>11u");
        assert_eq!(encode(&term, &event).unwrap(), b"\x1b[13;2:3u");
    }

    #[test]
    fn unrecognized_codes_modifiers_and_oversized_text_are_rejected() {
        assert!(serde_json::from_value::<InputEvent>(
            serde_json::json!({"kind":"key","event":{"code":"arbitrary"}})
        )
        .is_err());
        assert!(key("Enter", 0x8000).validate().is_err());
        assert!(InputEvent::Paste {
            text: "x".repeat(MAX_PASTE_BYTES + 1)
        }
        .validate()
        .is_err());
    }
}
