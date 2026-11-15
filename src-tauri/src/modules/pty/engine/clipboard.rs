use std::sync::{Arc, Mutex, PoisonError};

pub const MAX_CLIPBOARD_BYTES: usize = 1024 * 1024;
const MAX_ENCODED_UNITS: usize = (MAX_CLIPBOARD_BYTES * 4).div_ceil(3) + 4;
pub const MAX_CLIPBOARD_OSC_BYTES: usize = MAX_ENCODED_UNITS * 3 + 4096 + 4;

fn js_whitespace(value: char) -> bool {
    (value.is_whitespace() && value != '\u{85}') || value == '\u{feff}'
}

fn decode(data: &[u8]) -> Option<String> {
    let data = std::str::from_utf8(data).ok()?;
    let (selection, encoded) = data.split_once(';')?;
    if selection.len() > 4096
        || (!selection.is_empty() && !selection.contains('c'))
        || encoded.is_empty()
        || encoded == "?"
        || encoded.encode_utf16().take(MAX_ENCODED_UNITS + 1).count() > MAX_ENCODED_UNITS
    {
        return None;
    }
    let compact: Vec<u8> = encoded
        .chars()
        .filter(|value| !js_whitespace(*value))
        .map(|value| u8::try_from(value as u32).ok())
        .collect::<Option<_>>()?;
    let padding = compact
        .iter()
        .rev()
        .take_while(|&&value| value == b'=')
        .count();
    if padding > 2 || (padding > 0 && !compact.len().is_multiple_of(4)) {
        return None;
    }
    let digits = compact.len() - padding;
    if digits % 4 == 1 {
        return None;
    }
    let mut bytes = Vec::with_capacity((digits * 3 / 4).min(MAX_CLIPBOARD_BYTES));
    let mut value = 0u32;
    let mut bits = 0;
    for &byte in &compact[..digits] {
        let digit = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        };
        value = value << 6 | u32::from(digit);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            if bytes.len() == MAX_CLIPBOARD_BYTES {
                return None;
            }
            bytes.push((value >> bits) as u8);
        }
        value &= (1 << bits) - 1;
    }
    let mut text = String::from_utf8(bytes).ok()?;
    if text.starts_with('\u{feff}') {
        text.drain(..3);
    }
    Some(text)
}

type Listener = Arc<dyn Fn() -> bool + Send + Sync>;

#[derive(Default)]
struct Pending {
    text: Option<String>,
    listener: Option<Listener>,
    notified: bool,
    closed: bool,
    disabled: bool,
}

#[derive(Default)]
pub struct ClipboardMailbox {
    pending: Mutex<Pending>,
}

impl Pending {
    fn notification(&mut self) -> Option<Listener> {
        if self.closed || self.disabled || self.notified || self.text.is_none() {
            return None;
        }
        let listener = self.listener.clone()?;
        self.notified = true;
        Some(listener)
    }
}

impl ClipboardMailbox {
    pub fn record(&self, data: &[u8]) {
        {
            let pending = self.pending.lock().unwrap_or_else(PoisonError::into_inner);
            if pending.closed || pending.disabled {
                return;
            }
        }
        if let Some(text) = decode(data) {
            self.offer_owned(text);
        }
    }

    #[cfg(test)]
    fn offer(&self, text: &str) {
        self.offer_owned(text.to_owned());
    }

    fn offer_owned(&self, text: String) {
        if text.len() > MAX_CLIPBOARD_BYTES {
            return;
        }
        let listener = {
            let mut pending = self.pending.lock().unwrap_or_else(PoisonError::into_inner);
            if pending.closed || pending.disabled {
                return;
            }
            pending.text = Some(text);
            pending.notification()
        };
        self.notify(listener);
    }

    pub fn subscribe(&self, listener: impl Fn() -> bool + Send + Sync + 'static) {
        let listener = {
            let mut pending = self.pending.lock().unwrap_or_else(PoisonError::into_inner);
            if pending.closed {
                return;
            }
            pending.disabled = false;
            pending.listener = Some(Arc::new(listener));
            pending.notified = false;
            pending.notification()
        };
        self.notify(listener);
    }

    fn notify(&self, listener: Option<Listener>) {
        let Some(listener) = listener else {
            return;
        };
        if listener() {
            return;
        }
        let mut pending = self.pending.lock().unwrap_or_else(PoisonError::into_inner);
        if pending
            .listener
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, &listener))
        {
            pending.listener = None;
            pending.text = None;
            pending.notified = false;
            pending.disabled = true;
        }
    }

    pub fn take(&self) -> Option<String> {
        let mut pending = self.pending.lock().unwrap_or_else(PoisonError::into_inner);
        pending.notified = false;
        pending.text.take()
    }

    pub fn close(&self) {
        let mut pending = self.pending.lock().unwrap_or_else(PoisonError::into_inner);
        pending.closed = true;
        pending.listener = None;
        pending.text = None;
        pending.notified = false;
    }
}

#[cfg(test)]
mod tests {
    use super::super::shell::ShellIntegration;
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn native_observer_preserves_existing_clipboard_policy_at_every_boundary() {
        let cases = [
            ("c", "Y2Fmw6k=", Some("caf\u{e9}")),
            ("", "Y2Fmw6k=", Some("caf\u{e9}")),
            ("pc", "Y2Fmw6k=", Some("caf\u{e9}")),
            ("c", "Y2Fm w6k=", Some("caf\u{e9}")),
            ("c", "AA==", Some("\0")),
            ("c", "//4=", None),
            ("c", "!!!!", None),
            ("c", "?", None),
            ("c", "", None),
            ("p", "Y2Fmw6k=", None),
            ("s", "Y2Fmw6k=", None),
        ];
        let mut failures = Vec::new();
        for (selection, payload, expected) in cases {
            let command = format!("\x1b]52;{selection};{payload}\x07");
            for split in 0..=command.len() {
                let mailbox = Arc::new(ClipboardMailbox::default());
                let callback = mailbox.clone();
                let mut shell = ShellIntegration::new(None);
                shell.on_clipboard(move |data| callback.record(data));
                shell.ingest(&command.as_bytes()[..split]);
                shell.ingest(&command.as_bytes()[split..]);
                let observed = mailbox.take();
                if observed.as_deref() != expected {
                    failures.push(format!("selector {selection:?}, payload {payload:?}, split {split}: got {observed:?}, expected {expected:?}"));
                }
                assert_eq!(mailbox.take(), None);
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    #[test]
    fn mailbox_coalesces_and_notifies_once_until_taken() {
        let mailbox = ClipboardMailbox::default();
        let notices = Arc::new(AtomicUsize::new(0));
        mailbox.offer("before");
        let count = notices.clone();
        mailbox.subscribe(move || {
            count.fetch_add(1, Ordering::Relaxed);
            true
        });
        for _ in 0..1000 {
            mailbox.offer("latest");
        }
        assert_eq!(notices.load(Ordering::Relaxed), 1);
        assert_eq!(mailbox.take().as_deref(), Some("latest"));
        mailbox.offer("next");
        assert_eq!(notices.load(Ordering::Relaxed), 2);
        assert_eq!(mailbox.take().as_deref(), Some("next"));
        mailbox.close();
        mailbox.offer("closed");
        assert_eq!(mailbox.take(), None);
        assert_eq!(notices.load(Ordering::Relaxed), 2);
    }

    #[test]
    fn bounds_and_listener_failure_never_accumulate_or_block_new_subscribers() {
        let mailbox = ClipboardMailbox::default();
        mailbox.offer(&"a".repeat(MAX_CLIPBOARD_BYTES));
        assert_eq!(mailbox.take().unwrap().len(), MAX_CLIPBOARD_BYTES);
        mailbox.offer("retained");
        mailbox.offer(&"b".repeat(MAX_CLIPBOARD_BYTES + 1));
        assert_eq!(mailbox.take().as_deref(), Some("retained"));
        mailbox.subscribe(|| false);
        mailbox.offer("unavailable");
        assert_eq!(mailbox.take(), None);
        mailbox.offer("disabled");
        assert_eq!(mailbox.take(), None);
        mailbox.subscribe(|| true);
        mailbox.offer("reconnected");
        assert_eq!(mailbox.take().as_deref(), Some("reconnected"));
    }

    #[test]
    fn listener_can_take_and_replace_itself_without_a_lock_deadlock() {
        let mailbox = Arc::new(ClipboardMailbox::default());
        let callback = mailbox.clone();
        mailbox.subscribe(move || {
            assert_eq!(callback.take().as_deref(), Some("value"));
            callback.subscribe(|| true);
            true
        });
        mailbox.offer("value");
        mailbox.offer("another");
        assert_eq!(mailbox.take().as_deref(), Some("another"));
        mailbox.close();
    }
    #[test]
    fn replacing_an_unconsumed_failed_listener_notifies_the_new_owner() {
        let mailbox = Arc::new(ClipboardMailbox::default());
        let new_notices = Arc::new(AtomicUsize::new(0));
        let callback = mailbox.clone();
        let count = new_notices.clone();
        mailbox.subscribe(move || {
            let count = count.clone();
            callback.subscribe(move || {
                count.fetch_add(1, Ordering::Relaxed);
                true
            });
            false
        });
        mailbox.offer("pending");
        assert_eq!(new_notices.load(Ordering::Relaxed), 1);
        assert_eq!(mailbox.take().as_deref(), Some("pending"));
        mailbox.close();
    }
    #[test]
    fn malformed_or_unsupported_requests_do_not_replace_a_valid_pending_copy() {
        let mailbox = ClipboardMailbox::default();
        mailbox.record(b"c;cmV0YWluZWQ=");
        for data in [b"c;?".as_slice(), b"p;YQ==", b"c;!!!!", b"c;//4="] {
            mailbox.record(data);
        }
        assert_eq!(mailbox.take().as_deref(), Some("retained"));
        assert_eq!(decode(b"c;Zh==").as_deref(), Some("f"));
        assert_eq!(decode(b"c;Zg").as_deref(), Some("f"));
        assert_eq!(decode(b"c;Zg=").as_deref(), None);
        assert_eq!(decode(b"c; \t ").as_deref(), Some(""));
        assert_eq!(decode(b"c;77u/YQ==").as_deref(), Some("a"));
        assert_eq!(decode("c;\u{feff}YQ==".as_bytes()).as_deref(), Some("a"));
        assert_eq!(decode("c;\u{85}YQ==".as_bytes()), None);
    }

    #[test]
    fn clipboard_framing_preserves_shell_trust_and_ignores_opaque_or_cancelled_data() {
        let mailbox = Arc::new(ClipboardMailbox::default());
        let callback = mailbox.clone();
        let mut shell = ShellIntegration::new(None);
        shell.on_clipboard(move |data| callback.record(data));
        let bytes = b"\x1b]133;A\x07\x1b]7;file:///forged\x07\x1b]133;B\x07\
            \x1bPopaque\x1b]52;c;YmFk\x07\x1b\\\
            \x1b]52;c;YmFk\x18\
            \x1b]52;pc;Z29vZA==\x1b\\";
        for byte in bytes {
            shell.ingest(&[*byte]);
        }
        assert_eq!(mailbox.take().as_deref(), Some("good"));
        assert!(!shell.state().shell_ready);
        assert!(shell.state().cwd.is_none());
        assert_eq!(shell.state().prompt_version, 0);
    }

    #[test]
    fn decoder_enforces_encoded_and_decoded_bounds_without_losing_pending_text() {
        let mailbox = ClipboardMailbox::default();
        let payload = format!("c;{}YQ==", "YWFh".repeat(MAX_CLIPBOARD_BYTES / 3));
        mailbox.record(payload.as_bytes());
        let text = mailbox.take().unwrap();
        assert_eq!(text.len(), MAX_CLIPBOARD_BYTES);
        assert!(text.bytes().all(|value| value == b'a'));
        mailbox.record(b"c;cmV0YWluZWQ=");
        let over = format!("c;{}YWE=", "YWFh".repeat(MAX_CLIPBOARD_BYTES / 3));
        mailbox.record(over.as_bytes());
        mailbox.record(format!("c;{}", " ".repeat(MAX_ENCODED_UNITS + 1)).as_bytes());
        mailbox.record(format!("{};YQ==", "c".repeat(4097)).as_bytes());
        assert_eq!(mailbox.take().as_deref(), Some("retained"));
        assert!(decode(format!("{};YQ==", "c".repeat(4096)).as_bytes()).is_some());
    }
    #[test]
    fn framing_matches_installed_xterm_reference_at_every_utf8_boundary() {
        let cases: serde_json::Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../src/modules/terminal/gl/fixtures/clipboard-policy.json"
        )))
        .unwrap();
        let mut failures = Vec::new();
        for case in cases.as_array().unwrap() {
            let input = case["input"].as_str().unwrap().as_bytes();
            let expected = case["expected"].as_str();
            for split in 0..=input.len() {
                let mailbox = Arc::new(ClipboardMailbox::default());
                let callback = mailbox.clone();
                let mut shell = ShellIntegration::new(None);
                shell.on_clipboard(move |data| callback.record(data));
                shell.ingest(&input[..split]);
                shell.ingest(&input[split..]);
                let observed = mailbox.take();
                if observed.as_deref() != expected {
                    failures.push(format!("{} split {split}: {observed:?}", case["name"]));
                }
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }
    #[test]
    fn clipboard_control_compatibility_does_not_authorize_shell_markers() {
        let token = "1234567890abcdef1234567890abcdef";
        for input in [
            format!("\x1b\0]133;B;aid={token}\x07"),
            format!("\x1b]133;B;aid={token}\0\x07"),
            format!("\u{9d}133;B;aid={token}\u{9c}"),
            format!("\x1b]133;B;aid={token}\u{9c}"),
        ] {
            let mut shell = ShellIntegration::new(Some(token.into()));
            shell.on_clipboard(|_| {});
            for byte in input.as_bytes() {
                shell.ingest(&[*byte]);
            }
            assert!(!shell.state().shell_ready);
            assert_eq!(shell.state().prompt_version, 0);
        }
    }
}
