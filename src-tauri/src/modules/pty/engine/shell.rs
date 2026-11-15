use serde::Serialize;

pub const MAX_CWD_BYTES: usize = 128 * 1024;
const MAX_OSC_BYTES: usize = MAX_CWD_BYTES * 3 + 512;
const MAX_MARK_BYTES: usize = 4096;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellState {
    pub cwd: Option<String>,
    pub shell_ready: bool,
    pub command_running: bool,
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

pub struct ShellIntegration {
    token: Option<String>,
    state: ShellState,
    parse: ParseState,
    buffer: Vec<u8>,
    discard: bool,
    allow_cwd: bool,
    utf8_remaining: u8,
}
impl ShellIntegration {
    pub fn new(token: Option<String>) -> Self {
        Self {
            token,
            state: ShellState::default(),
            parse: ParseState::Ground,
            buffer: Vec::new(),
            discard: false,
            allow_cwd: false,
            utf8_remaining: 0,
        }
    }
    pub fn state(&self) -> &ShellState {
        &self.state
    }
    #[cfg(test)]
    fn buffered_bytes(&self) -> usize {
        self.buffer.len()
    }
    pub fn ingest(&mut self, bytes: &[u8]) {
        if self.token.is_none() {
            return;
        }
        for &byte in bytes {
            self.byte(byte);
        }
    }
    fn byte(&mut self, byte: u8) {
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
                0x1b => {}
                _ => self.parse = ParseState::Ground,
            },
            ParseState::Osc => match byte {
                0x07 => self.finish(),
                0x1b => self.parse = ParseState::OscEscape,
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
        if self.buffer.len() == MAX_OSC_BYTES
            || (self.buffer.starts_with(b"133;") && self.buffer.len() == MAX_MARK_BYTES)
        {
            self.discard = true;
            self.buffer.clear();
            return;
        }
        self.buffer.push(byte);
        if self.buffer.len() <= 4
            && ![b"7;".as_slice(), b"133;".as_slice()]
                .iter()
                .any(|prefix| prefix.starts_with(&self.buffer) || self.buffer.starts_with(prefix))
        {
            self.discard = true;
            self.buffer.clear();
        }
    }
    fn finish(&mut self) {
        self.parse = ParseState::Ground;
        if !self.discard {
            if let Some(data) = self
                .buffer
                .strip_prefix(b"133;")
                .and_then(|bytes| std::str::from_utf8(bytes).ok())
            {
                let mut parts = data.split(';');
                let action = parts.next().unwrap_or("");
                let mut aids = parts.clone().filter_map(|part| part.strip_prefix("aid="));
                if aids.next() == self.token.as_deref() && aids.next().is_none() {
                    match action {
                        "A" => {
                            self.allow_cwd = true;
                            self.state.command_running = false;
                        }
                        "D" if parts
                            .next()
                            .and_then(|value| value.parse::<i32>().ok())
                            .is_some() =>
                        {
                            self.allow_cwd = true;
                            self.state.command_running = false;
                        }
                        "B" => {
                            self.allow_cwd = false;
                            self.state.shell_ready = true;
                            self.state.command_running = false;
                        }
                        "C" => {
                            self.allow_cwd = false;
                            self.state.command_running = true;
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
