use super::shell::ShellState;
use libghostty_vt::screen::Screen;
use libghostty_vt::terminal::Mode;
use libghostty_vt::Terminal;
use serde::Serialize;
use std::sync::{Arc, Mutex, PoisonError};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Modes {
    pub alternate_screen: bool,
    pub mouse_tracking: bool,
    pub bracketed_paste: bool,
    pub focus_tracking: bool,
    pub modify_other_keys: u32,
    pub kitty_flags: u8,
}
impl Modes {
    pub fn read(
        term: &Terminal<'_, '_>,
        modify_other_keys: u32,
    ) -> Result<Self, libghostty_vt::Error> {
        Ok(Self {
            alternate_screen: matches!(term.active_screen()?, Screen::Alternate),
            mouse_tracking: term.is_mouse_tracking()?,
            bracketed_paste: term.mode(Mode::BRACKETED_PASTE)?,
            focus_tracking: term.mode(Mode::FOCUS_EVENT)?,
            modify_other_keys,
            kitty_flags: term.kitty_keyboard_flags()?.bits(),
        })
    }
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineState {
    pub version: u64,
    #[serde(flatten)]
    pub modes: Modes,
    #[serde(flatten)]
    pub shell: ShellState,
    pub blocks_enabled: bool,
    pub blocks_metadata_version: u64,
}
type Listener = Arc<dyn Fn(EngineState) -> bool + Send + Sync>;
#[derive(Default)]
struct Inner {
    state: EngineState,
    listener: Option<Listener>,
}
#[derive(Default)]
pub struct StateStore(Mutex<Inner>);
fn notify(listener: Option<Listener>, state: EngineState) -> bool {
    listener.is_none_or(|listener| {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| listener(state))).unwrap_or(false)
    })
}
impl StateStore {
    pub fn snapshot(&self) -> EngineState {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .state
            .clone()
    }
    pub fn subscribe(&self, listener: Listener) -> bool {
        let state = {
            let mut inner = self.0.lock().unwrap_or_else(PoisonError::into_inner);
            inner.listener = Some(listener.clone());
            inner.state.clone()
        };
        notify(Some(listener), state)
    }
    pub fn publish(&self, modes: Modes, shell: &ShellState, blocks_version: Option<u64>) -> bool {
        let blocks_enabled = blocks_version.is_some();
        let blocks_metadata_version = blocks_version.unwrap_or_default();
        let (listener, state) = {
            let mut inner = self.0.lock().unwrap_or_else(PoisonError::into_inner);
            if inner.state.modes == modes
                && &inner.state.shell == shell
                && inner.state.blocks_enabled == blocks_enabled
                && inner.state.blocks_metadata_version == blocks_metadata_version
            {
                return true;
            }
            inner.state = EngineState {
                version: inner.state.version.saturating_add(1),
                modes,
                shell: shell.clone(),
                blocks_enabled,
                blocks_metadata_version,
            };
            (inner.listener.clone(), inner.state.clone())
        };
        notify(listener, state)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mode_changes_are_versioned_coalesced_and_observed_outside_the_lock() {
        let store = Arc::new(StateStore::default());
        let weak = Arc::downgrade(&store);
        let values = Arc::new(Mutex::new(Vec::new()));
        let output = values.clone();
        assert!(store.subscribe(Arc::new(move |value| {
            assert!(weak.upgrade().unwrap().snapshot().version >= value.version);
            output.lock().unwrap().push(value.version);
            true
        })));
        let modes = Modes {
            modify_other_keys: 2,
            ..Modes::default()
        };
        assert!(store.publish(modes, &ShellState::default(), None));
        assert!(store.publish(modes, &ShellState::default(), None));
        assert_eq!(*values.lock().unwrap(), [0, 1]);
    }
    #[test]
    fn native_modes_report_the_current_screen_and_negotiation() {
        let mut term = Terminal::new(libghostty_vt::TerminalOptions {
            cols: 20,
            rows: 3,
            max_scrollback: 1024 * 1024,
        })
        .unwrap();
        assert_eq!(Modes::read(&term, 0).unwrap(), Modes::default());
        term.vt_write(b"\x1b[?1049h\x1b[?1000h\x1b[?2004h\x1b[?1004h\x1b[>1u");
        assert_eq!(
            Modes::read(&term, 2).unwrap(),
            Modes {
                alternate_screen: true,
                mouse_tracking: true,
                bracketed_paste: true,
                focus_tracking: true,
                modify_other_keys: 2,
                kitty_flags: 1
            }
        );
    }
}
