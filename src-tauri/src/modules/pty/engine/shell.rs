use serde::Serialize;

pub const MAX_CWD_BYTES: usize = 128 * 1024;
const MAX_OSC_BYTES: usize = MAX_CWD_BYTES * 3 + 512;
pub const MAX_COMMAND_BYTES: usize = 1024 * 1024;
pub(crate) const MAX_MARK_BYTES: usize = MAX_COMMAND_BYTES * 3 + 512;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellState {
    pub cwd: Option<String>,
    pub shell_ready: bool,
    pub command_running: bool,
    pub prompt_version: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ShellEvent {
    /// `OSC 133;A`. `redraws` is the shell's promise (`terax_redraw=1`) that
    /// on a window size change it repaints its prompt from the row of the
    /// last `A` or `P` mark; see prompt_redraw.rs.
    PromptStart {
        redraws: bool,
    },
    /// `OSC 133;P`: a prompt line starts on the cursor row.
    PromptLine,
    PromptEnd,
    CommandStart {
        command: String,
        cwd: Option<String>,
    },
    CommandEnd {
        exit_code: i32,
    },
}

#[cfg(feature = "ghostty-engine")]
pub struct ShellToken(String);
#[cfg(feature = "ghostty-engine")]
impl ShellToken {
    pub fn generate() -> Result<Self, String> {
        let mut bytes = [0u8; 16];
        getrandom::fill(&mut bytes)
            .map_err(|error| format!("shell marker randomness failed: {error}"))?;
        Ok(Self(
            bytes.iter().map(|byte| format!("{byte:02x}")).collect(),
        ))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
    pub(super) fn into_string(self) -> String {
        self.0
    }
    #[cfg(test)]
    pub fn for_test() -> Self {
        Self("1234567890abcdef1234567890abcdef".into())
    }
}

#[derive(Clone, Copy, Default)]
enum ParseState {
    #[default]
    Ground,
    Escape,
    Osc,
    OscEscape,
    Opaque,
    OpaqueEscape,
}

type ClipboardHandler = Box<dyn FnMut(&[u8]) + Send>;

pub struct ShellIntegration {
    token: Option<String>,
    clipboard: Option<ClipboardHandler>,
    clipboard_only: bool,
    pending_c2: bool,
    state: ShellState,
    parse: ParseState,
    buffer: Vec<u8>,
    discard: bool,
    allow_cwd: bool,
    utf8_remaining: u8,
    capture_events: bool,
    event: Option<ShellEvent>,
}
impl ShellIntegration {
    pub fn new(token: Option<String>) -> Self {
        Self {
            token,
            clipboard: None,
            clipboard_only: false,
            pending_c2: false,
            state: ShellState::default(),
            parse: ParseState::Ground,
            buffer: Vec::new(),
            discard: false,
            allow_cwd: false,
            utf8_remaining: 0,
            capture_events: false,
            event: None,
        }
    }
    pub fn on_clipboard(&mut self, handler: impl FnMut(&[u8]) + Send + 'static) {
        self.clipboard = Some(Box::new(handler));
    }
    pub fn state(&self) -> &ShellState {
        &self.state
    }
    #[cfg(test)]
    fn buffered_bytes(&self) -> usize {
        self.buffer.len()
    }
    pub fn ingest(&mut self, bytes: &[u8]) {
        if self.token.is_none() && self.clipboard.is_none() {
            return;
        }
        for &byte in bytes {
            self.byte(byte);
        }
    }
    pub fn ingest_segments(
        &mut self,
        bytes: &[u8],
        mut consume: impl FnMut(&[u8], Option<ShellEvent>) -> Result<(), String>,
    ) -> Result<(), String> {
        if self.token.is_none() && self.clipboard.is_none() {
            return consume(bytes, None);
        }
        self.capture_events = true;
        let result = (|| {
            let mut start = 0;
            for (index, &byte) in bytes.iter().enumerate() {
                self.byte(byte);
                if let Some(event) = self.event.take() {
                    let end = index + 1;
                    consume(&bytes[start..end], Some(event))?;
                    start = end;
                }
            }
            if start < bytes.len() {
                consume(&bytes[start..], None)?;
            }
            Ok(())
        })();
        self.capture_events = false;
        self.event = None;
        result
    }

    fn byte(&mut self, byte: u8) {
        if self.clipboard.is_some() {
            if std::mem::take(&mut self.pending_c2) {
                if (0x80..=0x9f).contains(&byte) {
                    self.clipboard_c1(byte);
                    return;
                }
                self.framed_byte(0xc2);
            }
            if byte == 0xc2 {
                self.pending_c2 = true;
                return;
            }
        }
        self.framed_byte(byte);
    }

    fn clipboard_c1(&mut self, byte: u8) {
        self.utf8_remaining = 0;
        if matches!(self.parse, ParseState::Opaque | ParseState::OpaqueEscape) {
            if byte == 0x9c {
                self.parse = ParseState::Ground;
            }
            return;
        }
        self.clipboard_only = true;
        match byte {
            0x9d => {
                self.buffer.clear();
                self.discard = false;
                self.parse = ParseState::Osc;
            }
            0x9c if matches!(self.parse, ParseState::Osc | ParseState::OscEscape) => self.finish(),
            0x90 | 0x98 | 0x9e | 0x9f => {
                self.buffer.clear();
                self.parse = ParseState::Opaque;
            }
            _ => {
                self.buffer.clear();
                self.parse = ParseState::Ground;
            }
        }
    }

    fn framed_byte(&mut self, byte: u8) {
        let continuation = self.utf8_remaining > 0 && (0x80..=0xbf).contains(&byte);
        self.utf8_remaining = if continuation {
            self.utf8_remaining - 1
        } else {
            match byte {
                0xc2..=0xdf => 1,
                0xe0..=0xef => 2,
                0xf0..=0xf4 => 3,
                _ => 0,
            }
        };
        let c1 = !continuation && (0x80..=0x9f).contains(&byte);
        if byte == 0x18 || byte == 0x1a {
            self.parse = ParseState::Ground;
            self.buffer.clear();
            return;
        }
        match self.parse {
            ParseState::Ground => {
                if byte == 0x1b {
                    self.clipboard_only = false;
                    self.parse = ParseState::Escape;
                } else if c1 && matches!(byte, 0x90 | 0x98 | 0x9d | 0x9e | 0x9f) {
                    self.parse = ParseState::Opaque;
                }
            }
            ParseState::Escape => match byte {
                b']' => {
                    self.buffer.clear();
                    self.discard = false;
                    self.parse = ParseState::Osc;
                }
                b'P' | b'X' | b'^' | b'_' => self.parse = ParseState::Opaque,
                0x1b => self.clipboard_only = false,
                0x00..=0x1f | 0x7f if self.clipboard.is_some() => self.clipboard_only = true,
                _ => self.parse = ParseState::Ground,
            },
            ParseState::Osc => match byte {
                0x07 => self.finish(),
                0x1b if self.clipboard.is_some() && self.buffer.starts_with(b"52;") => {
                    self.finish();
                    self.clipboard_only = false;
                    self.parse = ParseState::Escape;
                }
                0x1b => self.parse = ParseState::OscEscape,
                0x00..=0x1f if self.clipboard.is_some() => self.clipboard_only = true,
                _ if c1 && byte == 0x9c => {
                    self.buffer.clear();
                    self.parse = ParseState::Ground;
                }
                _ => self.push(byte),
            },
            ParseState::OscEscape => {
                if byte == b'\\' {
                    self.finish();
                } else {
                    self.buffer.clear();
                    self.parse = ParseState::Escape;
                    self.byte(byte);
                }
            }
            ParseState::Opaque => {
                if byte == 0x1b {
                    self.parse = ParseState::OpaqueEscape;
                } else if c1 && byte == 0x9c {
                    self.parse = ParseState::Ground;
                }
            }
            ParseState::OpaqueEscape => {
                self.parse = if byte == b'\\' {
                    ParseState::Ground
                } else if byte == 0x1b {
                    ParseState::OpaqueEscape
                } else {
                    ParseState::Opaque
                };
            }
        }
    }
    fn push(&mut self, byte: u8) {
        if self.discard {
            return;
        }
        let limit = if self.clipboard.is_some() && self.buffer.starts_with(b"52;") {
            super::clipboard::MAX_CLIPBOARD_OSC_BYTES
        } else if self.buffer.starts_with(b"133;") {
            MAX_MARK_BYTES
        } else {
            MAX_OSC_BYTES
        };
        if self.buffer.len() == limit {
            self.discard = true;
            self.buffer.clear();
            return;
        }
        if self.buffer.len() == self.buffer.capacity() {
            let growth = self
                .buffer
                .capacity()
                .max(4096)
                .min(limit - self.buffer.capacity());
            self.buffer.reserve_exact(growth);
        }
        self.buffer.push(byte);
        if self.buffer.len() <= 4
            && ![b"7;".as_slice(), b"133;".as_slice(), b"52;".as_slice()]
                .iter()
                .filter(|&&prefix| prefix != b"52;" || self.clipboard.is_some())
                .any(|prefix| prefix.starts_with(&self.buffer) || self.buffer.starts_with(prefix))
        {
            self.discard = true;
            self.buffer.clear();
        }
    }
    fn finish(&mut self) {
        self.parse = ParseState::Ground;
        if self.clipboard_only && !self.buffer.starts_with(b"52;") {
            self.buffer.clear();
            return;
        }
        if !self.discard {
            if let Some(data) = self.buffer.strip_prefix(b"52;") {
                if let Some(handler) = &mut self.clipboard {
                    handler(data);
                }
            } else if let Some(data) = self
                .buffer
                .strip_prefix(b"133;")
                .and_then(|bytes| std::str::from_utf8(bytes).ok())
            {
                let mut parts = data.split(';');
                let action = parts.next().unwrap_or("");
                let mut aids = parts.clone().filter_map(|part| part.strip_prefix("aid="));
                if self
                    .token
                    .as_deref()
                    .is_some_and(|token| aids.next() == Some(token))
                    && aids.next().is_none()
                {
                    match action {
                        "A" => {
                            if self.capture_events {
                                self.event = Some(ShellEvent::PromptStart {
                                    redraws: parts.any(|part| part == "terax_redraw=1"),
                                });
                            }
                            self.allow_cwd = true;
                            self.state.command_running = false;
                        }
                        "P" => {
                            if self.capture_events {
                                self.event = Some(ShellEvent::PromptLine);
                            }
                        }
                        "D" => {
                            if let Some(exit_code) =
                                parts.next().and_then(|value| value.parse::<i32>().ok())
                            {
                                self.allow_cwd = true;
                                self.state.command_running = false;
                                if self.capture_events {
                                    self.event = Some(ShellEvent::CommandEnd { exit_code });
                                }
                            }
                        }
                        "B" => {
                            if self.capture_events {
                                self.event = Some(ShellEvent::PromptEnd);
                            }
                            self.state.prompt_version = self.state.prompt_version.saturating_add(1);
                            self.allow_cwd = false;
                            self.state.shell_ready = true;
                            self.state.command_running = false;
                        }
                        "C" => {
                            self.allow_cwd = false;
                            self.state.command_running = true;
                            if self.capture_events {
                                self.event = Some(ShellEvent::CommandStart {
                                    command: parse_command(parts),
                                    cwd: self.state.cwd.clone(),
                                });
                            }
                        }
                        _ => {}
                    }
                }
            } else if let Some(data) = self.buffer.strip_prefix(b"7;") {
                if self.allow_cwd {
                    self.allow_cwd = false;
                    if let Some(cwd) = parse_cwd(data) {
                        self.state.cwd = Some(cwd);
                        self.state.shell_ready = true;
                    }
                }
            }
        }
        self.buffer.clear();
    }
}
pub(crate) fn parse_command<'a>(parts: impl Iterator<Item = &'a str>) -> String {
    let mut commands = parts.filter_map(|part| part.strip_prefix("cmdline_url="));
    let Some(encoded) = commands.next() else {
        return String::new();
    };
    if commands.next().is_some() {
        return String::new();
    }
    let decode = || -> Option<String> {
        let mut bytes = encoded.as_bytes();
        let mut decoded = Vec::with_capacity(bytes.len().min(MAX_COMMAND_BYTES));
        while let Some((&byte, rest)) = bytes.split_first() {
            if decoded.len() == MAX_COMMAND_BYTES {
                return None;
            }
            if byte == b'%' {
                let high = (*rest.first()? as char).to_digit(16)? as u8;
                let low = (*rest.get(1)? as char).to_digit(16)? as u8;
                decoded.push((high << 4) | low);
                bytes = &rest[2..];
            } else {
                decoded.push(byte);
                bytes = rest;
            }
        }
        let command = String::from_utf8(decoded).ok()?;
        if command
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
        {
            return None;
        }
        Some(command)
    };
    decode().unwrap_or_default()
}

fn parse_cwd(data: &[u8]) -> Option<String> {
    let uri = std::str::from_utf8(data).ok()?.strip_prefix("file://")?;
    if uri.chars().any(char::is_control) || uri.contains(['?', '#']) {
        return None;
    }
    let mut path = uri.get(uri.find('/')?..)?.as_bytes();
    let mut decoded = Vec::with_capacity(path.len().min(MAX_CWD_BYTES));
    while let Some((&byte, rest)) = path.split_first() {
        if decoded.len() == MAX_CWD_BYTES {
            return None;
        }
        if byte == b'%' {
            let high = (*rest.first()? as char).to_digit(16)? as u8;
            let low = (*rest.get(1)? as char).to_digit(16)? as u8;
            decoded.push((high << 4) | low);
            path = &rest[2..];
        } else {
            decoded.push(byte);
            path = rest;
        }
    }
    let path = String::from_utf8(decoded).ok()?;
    if path.chars().any(char::is_control) {
        return None;
    }
    if path.as_bytes().get(1).is_some_and(u8::is_ascii_alphabetic)
        && path.as_bytes().get(2) == Some(&b':')
        && path.as_bytes().get(3) == Some(&b'/')
    {
        Some(path[1..].into())
    } else {
        Some(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const TOKEN: &str = "1234567890abcdef1234567890abcdef";
    fn mark(action: &str) -> String {
        format!("\x1b]133;{action};aid={TOKEN}\x1b\\")
    }
    fn prompt(uri: &str) -> String {
        format!("{}\x1b]7;{uri}\x07{}{}", mark("D;0"), mark("A"), mark("B"))
    }
    #[test]
    fn trusted_prompt_and_commands_survive_every_byte_boundary() {
        let bytes = prompt("file://host/tmp/na%C3%AFve%20folder");
        for split in 0..=bytes.len() {
            let mut shell = ShellIntegration::new(Some(TOKEN.into()));
            shell.ingest(&bytes.as_bytes()[..split]);
            shell.ingest(&bytes.as_bytes()[split..]);
            assert_eq!(shell.state().cwd.as_deref(), Some("/tmp/naïve folder"));
            assert!(shell.state().shell_ready);
            assert!(!shell.state().command_running);
            shell.ingest(mark("C").as_bytes());
            assert!(shell.state().command_running);
            shell.ingest(b"\x1b]133;D;0\x07\x1b]7;file://remote/forged\x07\x1b]133;A\x07");
            assert_eq!(shell.state().cwd.as_deref(), Some("/tmp/naïve folder"));
            assert!(shell.state().command_running);
            shell.ingest(prompt("file://host/C:/Users/Test%20User").as_bytes());
            assert_eq!(shell.state().cwd.as_deref(), Some("C:/Users/Test User"));
            assert!(!shell.state().command_running);
        }
    }
    #[test]
    fn unsigned_wrong_duplicate_or_embedded_markers_cannot_claim_shell_state() {
        for input in [
            prompt("file://host/ignored").replace(TOKEN, "ffffffffffffffffffffffffffffffff"),
            format!(
                "\x1bP{}\x1b\\",
                prompt("file://host/ignored").replace("\x1b\\", "\x07")
            ),
            format!(
                "\x1b_{}\x1b\\",
                prompt("file://host/ignored").replace("\x1b\\", "\x07")
            ),
            format!("\x1b]133;A;aid={TOKEN};aid={TOKEN}\x07\x1b]7;file://host/ignored\x07"),
            "\x1b]133;A\x07\x1b]7;file://host/ignored\x07".to_string(),
        ] {
            let mut shell = ShellIntegration::new(Some(TOKEN.into()));
            shell.ingest(input.as_bytes());
            assert_eq!(shell.state(), &ShellState::default());
        }
        let mut disabled = ShellIntegration::new(None);
        disabled.ingest(prompt("file://host/ignored").as_bytes());
        assert_eq!(disabled.state(), &ShellState::default());
    }
    #[test]
    fn only_prompt_window_accepts_a_valid_bounded_absolute_cwd() {
        for uri in [
            "/relative",
            "file://host/has%00nul",
            "file://host/bad%FF",
            "file://host/bad%G0",
            "file://host/has%0Anewline",
            "file://host/path?query",
        ] {
            let mut shell = ShellIntegration::new(Some(TOKEN.into()));
            shell.ingest(prompt(uri).as_bytes());
            assert_eq!(shell.state().cwd, None, "{uri}");
            assert!(shell.state().shell_ready);
        }
        let mut shell = ShellIntegration::new(Some(TOKEN.into()));
        shell.ingest(b"\x1b]7;file://host/early\x07");
        shell.ingest(mark("B").as_bytes());
        shell.ingest(b"\x1b]7;file://host/late\x07");
        assert_eq!(shell.state().cwd, None);
    }
    #[test]
    fn canceled_oversized_and_opaque_controls_recover_without_unbounded_buffers() {
        let mut shell = ShellIntegration::new(Some(TOKEN.into()));
        shell.ingest(mark("A").as_bytes());
        shell.ingest(b"\x1b]7;file://host/canceled\x18");
        assert_eq!(shell.state().cwd, None);
        shell.ingest(b"\x1b]7;");
        shell.ingest(&vec![b'x'; MAX_OSC_BYTES + 1]);
        assert!(shell.buffered_bytes() <= MAX_OSC_BYTES);
        shell.ingest(b"\x07");
        shell.ingest(prompt("file://host/recovered").as_bytes());
        assert_eq!(shell.state().cwd.as_deref(), Some("/recovered"));
        shell.ingest("word \u{75d1} ".as_bytes());
        shell.ingest(prompt("file://host/utf8").as_bytes());
        assert_eq!(shell.state().cwd.as_deref(), Some("/utf8"));
    }
}

#[cfg(all(test, target_os = "macos"))]
mod script_tests {
    use super::*;
    use std::process::Command;
    const TOKEN: &str = "1234567890abcdef1234567890abcdef";
    #[test]
    fn installed_zsh_and_bash_scripts_emit_trusted_native_but_unchanged_unsigned_raw_markers() {
        let home = tempfile::tempdir().unwrap();
        let home_path = home.path().canonicalize().unwrap();
        for (shell, script, tail) in [
            (
                "/bin/zsh",
                include_str!("../scripts/zshrc.zsh"),
                "_terax_precmd; print -rn -- \"$_terax_prompt_end\"",
            ),
            (
                "/bin/bash",
                include_str!("../scripts/bashrc.bash"),
                "_terax_precmd; printf '%b' \"$PS1\"",
            ),
        ] {
            let path = home_path.join("integration");
            std::fs::write(&path, script).unwrap();
            for native in [false, true] {
                let mut cmd = Command::new(shell);
                cmd.args([
                    "-f",
                    "-c",
                    &format!("source \"$1\"; {tail}"),
                    "terax-test",
                    path.to_str().unwrap(),
                ])
                .env("HOME", home.path())
                .current_dir(home.path())
                .env_remove("TERAX_SHELL_INTEGRATION_TOKEN");
                if native {
                    cmd.env("TERAX_SHELL_INTEGRATION_TOKEN", TOKEN);
                }
                let output = cmd.output().unwrap();
                assert!(
                    output.status.success(),
                    "{shell}: {}",
                    String::from_utf8_lossy(&output.stderr)
                );
                let mut integration = ShellIntegration::new(Some(TOKEN.into()));
                integration.ingest(&output.stdout);
                if native {
                    assert!(
                        integration.state().shell_ready,
                        "{shell}: missing genuine native readiness"
                    );
                    assert_eq!(
                        integration.state().cwd.as_deref(),
                        home_path.to_str(),
                        "{shell}"
                    );
                } else {
                    assert_eq!(
                        integration.state(),
                        &ShellState::default(),
                        "raw markers cannot authenticate a native shell"
                    );
                    assert!(!output
                        .stdout
                        .windows(TOKEN.len())
                        .any(|bytes| bytes == TOKEN.as_bytes()));
                }
            }
        }
    }
}

#[cfg(test)]
mod block_event_tests {
    use super::*;
    const TOKEN: &str = "1234567890abcdef1234567890abcdef";
    fn collect(parts: &[&[u8]]) -> (Vec<u8>, Vec<ShellEvent>) {
        let mut shell = ShellIntegration::new(Some(TOKEN.into()));
        let mut copied = Vec::new();
        let mut events = Vec::new();
        for bytes in parts {
            shell
                .ingest_segments(bytes, |segment, event| {
                    copied.extend_from_slice(segment);
                    if let Some(event) = event {
                        events.push(event);
                    }
                    Ok(())
                })
                .unwrap();
        }
        (copied, events)
    }
    #[test]
    fn signed_block_events_split_original_bytes_at_the_marker_not_the_batch_end() {
        let input = format!("\x1b]133;A;aid={TOKEN}\x07\x1b]7;file://host/tmp/na%C3%AFve\x07prompt\r\n\x1b]133;C;aid={TOKEN};cmdline_url=echo%20%E9%9B%AA%0Anext\x1b\\first\r\nsecond\x1b]133;D;7;aid={TOKEN}\x07tail");
        let mut shell = ShellIntegration::new(Some(TOKEN.into()));
        let mut segments = Vec::new();
        shell
            .ingest_segments(input.as_bytes(), |bytes, event| {
                segments.push((bytes.to_vec(), event));
                Ok(())
            })
            .unwrap();
        assert_eq!(
            segments
                .iter()
                .flat_map(|(b, _)| b.iter().copied())
                .collect::<Vec<_>>(),
            input.as_bytes()
        );
        let start = segments
            .iter()
            .find(|(_, event)| matches!(event, Some(ShellEvent::CommandStart { .. })))
            .unwrap();
        assert!(start.0.ends_with(b"\x1b\\"));
        assert!(!start.0.windows(5).any(|b| b == b"first"));
        assert_eq!(
            start.1,
            Some(ShellEvent::CommandStart {
                command: "echo 雪\nnext".into(),
                cwd: Some("/tmp/naïve".into())
            })
        );
        let end = segments
            .iter()
            .find(|(_, event)| matches!(event, Some(ShellEvent::CommandEnd { .. })))
            .unwrap();
        assert!(end.0.starts_with(b"first\r\nsecond"));
        assert_eq!(end.1, Some(ShellEvent::CommandEnd { exit_code: 7 }));
        assert_eq!(segments.last().unwrap().0, b"tail");
    }
    #[test]
    fn every_fragment_boundary_preserves_bytes_and_authenticated_metadata() {
        let input=format!("before\x1b]133;C;cmdline_url=printf%20ok;aid={TOKEN}\x07output\x1b]133;D;0;aid={TOKEN}\x1b\\after").into_bytes();
        let expected = collect(&[&input]);
        for cut in 0..=input.len() {
            assert_eq!(
                collect(&[&input[..cut], &input[cut..]]),
                expected,
                "cut {cut}"
            );
        }
    }
    #[test]
    fn unsigned_duplicate_aid_and_opaque_markers_cannot_create_blocks() {
        let input=format!("\x1b]133;C;evil\x07\x1b]133;D;0\x07\x1b]133;C;aid={TOKEN};aid={TOKEN}\x07\x1bP\x1b]133;C;aid={TOKEN}\x07\x1b\\");
        let (bytes, events) = collect(&[input.as_bytes()]);
        assert_eq!(bytes, input.as_bytes());
        assert!(events.is_empty());
    }
    #[test]
    fn malformed_command_metadata_is_empty_and_never_changes_the_bytes() {
        for command in [
            "cmdline_url=%GG",
            "cmdline_url=%FF",
            "cmdline_url=%00",
            "cmdline_url=one;cmdline_url=two",
        ] {
            let input = format!("\x1b]133;C;aid={TOKEN};{command}\x07");
            let (bytes, events) = collect(&[input.as_bytes()]);
            assert_eq!(bytes, input.as_bytes());
            assert_eq!(
                events,
                [ShellEvent::CommandStart {
                    command: String::new(),
                    cwd: None
                }]
            );
        }
    }
}

#[cfg(test)]
mod prompt_revision_tests {
    use super::*;
    #[test]
    fn repeated_authenticated_prompt_end_is_observable_without_a_command() {
        let mut shell = ShellIntegration::new(Some("prompt-test-token".into()));
        let bytes = b"\x1b]133;B;aid=prompt-test-token\x1b\\";
        shell.ingest(bytes);
        assert_eq!(shell.state().prompt_version, 1);
        shell.ingest(b"\x1b]133;B\x1b\\");
        shell.ingest(b"\x1b]133;B;aid=wrong\x1b\\");
        assert_eq!(shell.state().prompt_version, 1);
        for byte in bytes {
            shell.ingest(&[*byte]);
        }
        assert_eq!(shell.state().prompt_version, 2);
        assert!(shell.state().shell_ready);
        assert!(!shell.state().command_running);
    }
    fn events(bytes: &str) -> Vec<ShellEvent> {
        let mut shell = ShellIntegration::new(Some("prompt-test-token".into()));
        let mut events = Vec::new();
        shell
            .ingest_segments(bytes.as_bytes(), |_, event| {
                events.extend(event);
                Ok(())
            })
            .unwrap();
        events
    }
    #[test]
    fn prompt_start_carries_the_redraw_promise_only_when_signed_and_exact() {
        let start = |redraws| vec![ShellEvent::PromptStart { redraws }];
        assert_eq!(
            events("\x1b]133;A;aid=prompt-test-token;terax_redraw=1\x1b\\"),
            start(true)
        );
        assert_eq!(
            events("\x1b]133;A;terax_redraw=1;aid=prompt-test-token\x07"),
            start(true)
        );
        for plain in [
            "\x1b]133;A;aid=prompt-test-token\x1b\\",
            "\x1b]133;A;aid=prompt-test-token;terax_redraw=0\x1b\\",
            "\x1b]133;A;aid=prompt-test-token;redraw=1\x1b\\",
        ] {
            assert_eq!(events(plain), start(false), "{plain:?}");
        }
        assert_eq!(events("\x1b]133;A;terax_redraw=1\x1b\\"), vec![]);
        assert_eq!(events("\x1b]133;A;aid=wrong;terax_redraw=1\x1b\\"), vec![]);
    }
    #[test]
    fn signed_prompt_line_marks_are_events_and_change_no_state() {
        let mut shell = ShellIntegration::new(Some("prompt-test-token".into()));
        let before = shell.state().clone();
        let mut seen = Vec::new();
        shell
            .ingest_segments(
                b"\x1b]133;P;k=i;aid=prompt-test-token\x1b\\\x1b]133;P;k=s\x1b\\\x1b]133;P;k=s;aid=prompt-test-token\x07",
                |_, event| {
                    seen.extend(event);
                    Ok(())
                },
            )
            .unwrap();
        assert_eq!(seen, vec![ShellEvent::PromptLine, ShellEvent::PromptLine]);
        assert_eq!(shell.state(), &before);
    }
}

#[cfg(test)]
mod full_command_tests {
    use super::*;
    const TOKEN: &str = "1234567890abcdef1234567890abcdef";
    fn commands(bytes: &[u8]) -> Vec<String> {
        let mut shell = ShellIntegration::new(Some(TOKEN.into()));
        let mut result = Vec::new();
        shell
            .ingest_segments(bytes, |_, event| {
                if let Some(ShellEvent::CommandStart { command, .. }) = event {
                    result.push(command);
                }
                Ok(())
            })
            .unwrap();
        result
    }
    #[test]
    fn complete_commands_preserve_multiline_unicode_beyond_the_old_marker_limit() {
        let command = format!("printf '{}'\n\tprintf end", "雪%20;".repeat(1200));
        let encoded = command
            .replace('%', "%25")
            .replace(';', "%3B")
            .replace('\n', "%0A")
            .replace('\t', "%09");
        let marker = format!("\x1b]133;C;aid={TOKEN};cmdline_url={encoded}\x1b\\");
        assert_eq!(commands(marker.as_bytes()), vec![command]);
    }
    #[test]
    fn command_bound_rejects_the_entire_value_instead_of_publishing_a_prefix() {
        for command in [
            "x".repeat(MAX_COMMAND_BYTES + 1),
            "雪".repeat(MAX_COMMAND_BYTES / 3 + 1),
        ] {
            let marker = format!("\x1b]133;C;aid={TOKEN};cmdline_url={command}\x07");
            assert_eq!(commands(marker.as_bytes()), vec![String::new()]);
        }
        let command = "x".repeat(MAX_COMMAND_BYTES);
        let marker = format!("\x1b]133;C;aid={TOKEN};cmdline_url={command}\x07");
        assert_eq!(commands(marker.as_bytes()), vec![command]);
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn actual_zsh_native_block_hook_keeps_the_full_original_command() {
        let home = tempfile::tempdir().unwrap();
        let script = home.path().join("zsh-integration");
        std::fs::write(&script, include_str!("../scripts/zshrc.zsh")).unwrap();
        let command = format!("printf '{}'\n\tprintf tail", "e\u{301}界;".repeat(900));
        let output = std::process::Command::new("/bin/zsh")
            .args([
                "-f",
                "-c",
                "source \"$1\"; _terax_preexec \"$2\"",
                "terax-test",
            ])
            .arg(&script)
            .arg(&command)
            .env("HOME", home.path())
            .env("TERAX_USER_ZDOTDIR", home.path())
            .env("TERAX_SHELL_INTEGRATION_TOKEN", TOKEN)
            .env("TERAX_BLOCKS", "1")
            .current_dir(home.path())
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(commands(&output.stdout), vec![command]);
    }
}

#[cfg(all(test, target_os = "macos"))]
mod interactive_command_tests {
    use super::*;
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::io::{Read, Write};
    use std::sync::mpsc;
    use std::time::{Duration, Instant};
    #[test]
    fn real_interactive_zsh_hook_receives_the_complete_accepted_multiline_command() {
        const TOKEN: &str = "1234567890abcdef1234567890abcdef";
        let home = tempfile::tempdir().unwrap();
        let root = home.path().canonicalize().unwrap();
        std::fs::write(root.join(".zshrc"), include_str!("../scripts/zshrc.zsh")).unwrap();
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 8,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut builder = CommandBuilder::new("/bin/zsh");
        builder.args(["-d", "-i"]);
        builder.cwd(&root);
        builder.env("HOME", &root);
        builder.env("ZDOTDIR", &root);
        builder.env("TERAX_USER_ZDOTDIR", root.join("empty-user-profile"));
        builder.env("TERAX_BLOCKS", "1");
        builder.env("TERAX_SHELL_INTEGRATION_TOKEN", TOKEN);
        builder.env("TERM", "xterm-256color");
        builder.env("LC_ALL", "en_US.UTF-8");
        let mut child = pair.slave.spawn_command(builder).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        let (tx, rx) = mpsc::sync_channel(32);
        let thread = std::thread::spawn(move || {
            let mut bytes = [0u8; 16 * 1024];
            loop {
                match reader.read(&mut bytes) {
                    Ok(0) | Err(_) => break,
                    Ok(count) => {
                        if tx.send(bytes[..count].to_vec()).is_err() {
                            break;
                        }
                    }
                }
            }
        });
        let command = format!(
            "printf '%s\\n' '{}'\nprintf 'fixture-complete\\n'",
            "e\u{301}界;".repeat(900)
        );
        let mut shell = ShellIntegration::new(Some(TOKEN.into()));
        let mut commands = Vec::new();
        let result = (|| -> Result<(), String> {
            let deadline = Instant::now() + Duration::from_secs(10);
            let mut submitted_at = None;
            loop {
                let bytes = rx
                    .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                    .map_err(|_| "interactive zsh did not complete the public fixture")?;
                shell.ingest_segments(&bytes, |_, event| {
                    if let Some(ShellEvent::CommandStart { command, .. }) = event {
                        commands.push(command);
                    }
                    Ok(())
                })?;
                if let Some(version) = submitted_at {
                    if !commands.is_empty() && shell.state().prompt_version > version {
                        break;
                    }
                } else if shell.state().prompt_version > 0 {
                    submitted_at = Some(shell.state().prompt_version);
                    writer
                        .write_all(format!("\x1b[200~{command}\x1b[201~\r").as_bytes())
                        .map_err(|e| e.to_string())?;
                    writer.flush().map_err(|e| e.to_string())?;
                }
            }
            Ok(())
        })();
        drop(rx);
        let _ = child.kill();
        let _ = child.wait();
        drop(writer);
        drop(pair.master);
        thread.join().unwrap();
        assert!(result.is_ok(), "{result:?}");
        assert_eq!(commands, vec![command]);
    }
}
