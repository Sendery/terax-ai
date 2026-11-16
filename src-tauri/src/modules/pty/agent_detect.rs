use super::terminal_signals::{Progress, TerminalSignals};
const ESC: u8 = 0x1b;
const BEL: u8 = 0x07;
const OSC_INTRO: u8 = b']';
const ST_FINAL: u8 = b'\\';

const OSC_MAX: usize = 8192;

const DEFAULT_AGENTS: &[&str] = &["claude", "codex", "pi"];

// OSC 777 marker our Claude Code hooks emit via `terminalSequence`.
const TERAX_MARKER: &[u8] = b"notify;Terax;";

/// Upper bound on the text an agent may attach to a signal. A notification
/// shows a line, not a transcript, and the payload arrives over a terminal
/// stream any process can write to.
pub const MAX_SIGNAL_TEXT: usize = 160;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum State {
    Ground,
    Esc,
    Osc,
    OscEsc,
    Ignore,
    IgnoreEsc,
    DiscardOsc,
    DiscardOscEsc,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Status {
    Working,
    Waiting,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Transition {
    Started {
        agent: String,
    },
    Working,
    /// The agent is blocked on the user. `text` is what it said it needs and
    /// `reason` which kind of block it is, when the hook could tell.
    Attention {
        text: Option<String>,
        reason: Option<&'static str>,
    },
    /// The agent ended a turn. `text` is its closing line, when it reported one.
    Finished {
        text: Option<String>,
    },
    /// A subagent the session launched came back. The session itself carries
    /// on, so this never changes whether it is working or waiting.
    Subagent {
        text: Option<String>,
    },
    /// The transcript this leaf is writing, as the agent itself reported it.
    /// Emitted once per change so the webview never has to guess which file
    /// belongs to which pane.
    Bound {
        session_id: String,
    },
    Notification {
        title: String,
        body: String,
    },
    Progress {
        progress: Progress,
    },
    Exited,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSignal {
    pub id: u32,
    pub kind: &'static str,
    pub agent: Option<String>,
    /// Line the agent attached to the event, already bounded and stripped of
    /// control characters. Absent when it reported none.
    pub text: Option<String>,
    /// Why an `attention` signal fired: `permission`, `question` or `idle`.
    pub reason: Option<&'static str>,
    /// Only set on `bound`, and always a safe id.
    pub session_id: Option<String>,
    pub title: Option<String>,
    pub progress: Option<Progress>,
}

impl Transition {
    pub fn into_signal(self, id: u32) -> AgentSignal {
        let signal = |kind: &'static str| AgentSignal {
            id,
            kind,
            agent: None,
            text: None,
            reason: None,
            session_id: None,
            title: None,
            progress: None,
        };
        match self {
            Transition::Started { agent } => AgentSignal {
                agent: Some(agent),
                ..signal("started")
            },
            Transition::Working => signal("working"),
            Transition::Attention { text, reason } => AgentSignal {
                text,
                reason,
                ..signal("attention")
            },
            Transition::Finished { text } => AgentSignal {
                text,
                ..signal("finished")
            },
            Transition::Subagent { text } => AgentSignal {
                text,
                ..signal("subagent")
            },
            Transition::Bound { session_id } => AgentSignal {
                session_id: Some(session_id),
                ..signal("bound")
            },
            Transition::Notification { title, body } => AgentSignal {
                title: Some(title),
                text: (!body.is_empty()).then_some(body),
                ..signal("notification")
            },
            Transition::Progress { progress } => AgentSignal {
                progress: Some(progress),
                ..signal("progress")
            },
            Transition::Exited => signal("exited"),
        }
    }
}

/// Bounds and strips the free text an agent attached to an event.
///
/// It arrives over a terminal stream any process can write to, so control
/// characters are removed and the length is capped before it reaches the UI.
fn clean_text(raw: &[u8]) -> Option<String> {
    let text: String = String::from_utf8_lossy(raw)
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_SIGNAL_TEXT)
        .collect();
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

/// One hook event after the agent name: `<event>[:<detail>][;sid=<id>][;<text>]`.
///
/// Hooks installed before the detail and session fields existed still write
/// `<event>[;<text>]` and parse to the same event without them. The text is
/// the rest of the payload, so it may contain the field separator.
#[derive(Debug, PartialEq, Eq)]
struct HookEvent<'a> {
    event: &'a [u8],
    detail: &'a [u8],
    session_id: Option<String>,
    text: Option<String>,
}

fn parse_hook_event(payload: &[u8]) -> HookEvent<'_> {
    let (head, mut rest) = match payload.iter().position(|b| *b == b';') {
        Some(i) => (&payload[..i], Some(&payload[i + 1..])),
        None => (payload, None),
    };
    let (event, detail) = match head.iter().position(|b| *b == b':') {
        Some(i) => (&head[..i], &head[i + 1..]),
        None => (head, &head[..0]),
    };
    let mut session_id = None;
    if let Some(after) = rest.and_then(|r| r.strip_prefix(b"sid=")) {
        let end = after.iter().position(|b| *b == b';').unwrap_or(after.len());
        let id = String::from_utf8_lossy(&after[..end]).into_owned();
        // The id is later used to resolve a file, so a crafted one is dropped
        // here rather than trusted downstream.
        if crate::modules::agentsessions::is_safe_session_id(&id) {
            session_id = Some(id);
        }
        rest = after.get(end + 1..);
    }
    HookEvent {
        event,
        detail,
        session_id,
        text: rest.and_then(clean_text),
    }
}

/// Claude's `notification_type`, reduced to the three blocks the UI names.
/// First-party adapters may send the short form directly.
fn attention_reason(detail: &[u8]) -> Option<&'static str> {
    match detail {
        b"permission_prompt" | b"permission" => Some("permission"),
        b"elicitation_dialog" | b"question" => Some("question"),
        b"idle_prompt" | b"idle" => Some("idle"),
        _ => None,
    }
}

pub struct AgentDetector {
    agents: Vec<String>,
    #[cfg(any(test, feature = "ghostty-engine"))]
    shell_token: Option<String>,
    state: State,
    osc: Vec<u8>,
    armed: bool,
    status: Status,
    session_id: Option<String>,
    terminal_signals: TerminalSignals,
}

impl AgentDetector {
    pub fn new() -> Self {
        Self::with_agents(DEFAULT_AGENTS.iter().map(|s| s.to_string()).collect())
    }

    pub fn with_agents(agents: Vec<String>) -> Self {
        Self {
            agents,
            #[cfg(any(test, feature = "ghostty-engine"))]
            shell_token: None,
            state: State::Ground,
            osc: Vec::new(),
            armed: false,
            status: Status::Working,
            session_id: None,
            terminal_signals: TerminalSignals::default(),
        }
    }

    #[cfg(any(test, feature = "ghostty-engine"))]
    pub fn with_shell_token(token: String) -> Self {
        let mut detector = Self::new();
        detector.shell_token = Some(token);
        detector
    }

    /// Feed a chunk of raw PTY output. Transitions come only from OSC sequences
    /// (`133` prompt boundaries, our `777` hook marker), never from raw output,
    /// so a TUI agent that repaints continuously never flaps working/waiting.
    pub fn process<F: FnMut(Transition)>(&mut self, input: &[u8], mut emit: F) {
        if self.state == State::Ground && !input.contains(&ESC) {
            return;
        }

        for &b in input {
            match self.state {
                State::Ground => {
                    if b == ESC {
                        self.state = State::Esc;
                    }
                }
                State::Esc => match b {
                    OSC_INTRO => {
                        self.state = State::Osc;
                        self.osc.clear();
                    }
                    ESC => {}
                    b'P' | b'_' | b'^' | b'X' => self.state = State::Ignore,
                    _ => self.state = State::Ground,
                },
                State::Osc => match b {
                    0x18 | 0x1a => {
                        self.osc.clear();
                        self.state = State::Ground;
                    }
                    BEL => {
                        self.finish_osc(&mut emit);
                        self.state = State::Ground;
                    }
                    ESC => self.state = State::OscEsc,
                    _ => {
                        let limit = self.osc_limit();
                        if self.osc.len() < limit {
                            if self.osc.len() == self.osc.capacity() {
                                let growth =
                                    self.osc.capacity().max(8).min(limit - self.osc.capacity());
                                self.osc.reserve_exact(growth);
                            }
                            self.osc.push(b);
                        } else {
                            self.osc.clear();
                            self.state = State::DiscardOsc;
                        }
                    }
                },
                State::Ignore => match b {
                    ESC => self.state = State::IgnoreEsc,
                    0x18 | 0x1a => self.state = State::Ground,
                    _ => {}
                },
                State::IgnoreEsc => match b {
                    ST_FINAL => self.state = State::Ground,
                    ESC => {}
                    _ => self.state = State::Ignore,
                },
                State::DiscardOsc => match b {
                    ESC => self.state = State::DiscardOscEsc,
                    BEL | 0x18 | 0x1a => self.state = State::Ground,
                    _ => {}
                },
                State::DiscardOscEsc => match b {
                    ST_FINAL | BEL | 0x18 | 0x1a => self.state = State::Ground,
                    ESC => {}
                    _ => self.state = State::DiscardOsc,
                },
                State::OscEsc => match b {
                    0x18 | 0x1a => {
                        self.osc.clear();
                        self.state = State::Ground;
                    }
                    ST_FINAL => {
                        self.finish_osc(&mut emit);
                        self.state = State::Ground;
                    }
                    ESC => {}
                    _ => {
                        self.osc.clear();
                        self.state = State::Ground;
                    }
                },
            }
        }
    }

    fn osc_limit(&self) -> usize {
        #[cfg(any(test, feature = "ghostty-engine"))]
        if self.shell_token.is_some() && self.osc.starts_with(b"133;") {
            return super::engine::shell::MAX_MARK_BYTES;
        }
        OSC_MAX
    }

    /// Called when the underlying PTY closes. Reports the agent as exited so the
    /// UI doesn't leave a stale entry if the shell died mid-command.
    pub fn finish<F: FnMut(Transition)>(&mut self, mut emit: F) {
        if let Some(progress) = self.terminal_signals.reset() {
            emit(progress);
        }
        if self.armed {
            self.disarm();
            emit(Transition::Exited);
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
        self.status = Status::Working;
        // A new process in this pane may well write a different transcript.
        self.session_id = None;
    }

    fn finish_osc<F: FnMut(Transition)>(&mut self, emit: &mut F) {
        let body = std::mem::take(&mut self.osc);
        let (ps, pt) = match body.iter().position(|&c| c == b';') {
            Some(i) => (&body[..i], &body[i + 1..]),
            None => (&body[..], &body[0..0]),
        };
        match ps {
            b"133" => {
                if pt.starts_with(b"D") {
                    if let Some(progress) = self.terminal_signals.reset() {
                        emit(progress);
                    }
                }
                self.handle_osc133(pt, emit);
            }
            b"9" | b"99" => {
                if let Some(event) = self.terminal_signals.process(ps, pt) {
                    emit(event);
                }
            }
            b"777" => self.handle_osc777(pt, emit),
            _ => {}
        }
    }

    fn handle_osc777<F: FnMut(Transition)>(&mut self, pt: &[u8], emit: &mut F) {
        if let Some(marker) = pt.strip_prefix(TERAX_MARKER) {
            // The default marker belongs to Claude Code. First-party adapters
            // name themselves so hook-only sessions retain their own identity.
            let (agent, event) = marker
                .iter()
                .position(|byte| *byte == b';')
                .and_then(|index| match &marker[..index] {
                    b"pi" => Some(("pi", &marker[index + 1..])),
                    b"codex" => Some(("codex", &marker[index + 1..])),
                    _ => None,
                })
                .unwrap_or(("claude", marker));
            let hook = parse_hook_event(event);
            let known = matches!(
                hook.event,
                b"working" | b"attention" | b"finished" | b"subagent"
            );
            // A successful login is reported through the same hook, but it
            // asks nothing of the user.
            if !known || (hook.event == b"attention" && hook.detail == b"auth_success") {
                return;
            }
            self.ensure_armed_as(agent, emit);
            if let Some(id) = hook.session_id {
                if self.session_id.as_deref() != Some(id.as_str()) {
                    self.session_id = Some(id.clone());
                    emit(Transition::Bound { session_id: id });
                }
            }
            match hook.event {
                b"working" => self.set_working(emit),
                b"attention" => {
                    self.status = Status::Waiting;
                    emit(Transition::Attention {
                        text: hook.text,
                        reason: attention_reason(hook.detail),
                    });
                }
                b"finished" => {
                    self.status = Status::Waiting;
                    emit(Transition::Finished { text: hook.text });
                }
                _ => emit(Transition::Subagent { text: hook.text }),
            }
            return;
        }
        self.generic_attention(emit);
    }

    fn handle_osc133<F: FnMut(Transition)>(&mut self, pt: &[u8], emit: &mut F) {
        #[cfg(any(test, feature = "ghostty-engine"))]
        let native_command = if let Some(token) = self.shell_token.as_deref() {
            let Ok(payload) = std::str::from_utf8(pt) else {
                return;
            };
            let mut parts = payload.split(';');
            let action = parts.next().unwrap_or("");
            if !matches!(action, "C" | "D") {
                return;
            }
            let mut aids = parts.clone().filter_map(|part| part.strip_prefix("aid="));
            if aids.next() != Some(token) || aids.next().is_some() {
                return;
            }
            if action == "D"
                && parts
                    .clone()
                    .next()
                    .and_then(|code| code.parse::<i32>().ok())
                    .is_none()
            {
                return;
            }
            Some(super::engine::shell::parse_command(parts))
        } else {
            None
        };
        match pt.first() {
            Some(b'C') => {
                if self.armed {
                    return;
                }
                let cmd = pt.strip_prefix(b"C;").unwrap_or(b"");
                #[cfg(any(test, feature = "ghostty-engine"))]
                let cmd = native_command.as_deref().map_or(cmd, str::as_bytes);
                if let Some(agent) = self.match_agent(cmd) {
                    self.armed = true;
                    self.status = Status::Working;
                    emit(Transition::Started { agent });
                }
            }
            Some(b'D') if self.armed => {
                self.disarm();
                emit(Transition::Exited);
            }
            _ => {}
        }
    }

    fn ensure_armed_as<F: FnMut(Transition)>(&mut self, agent: &str, emit: &mut F) {
        if !self.armed {
            self.armed = true;
            self.status = Status::Working;
            emit(Transition::Started {
                agent: agent.to_string(),
            });
        }
    }

    fn set_working<F: FnMut(Transition)>(&mut self, emit: &mut F) {
        if self.status != Status::Working {
            self.status = Status::Working;
            emit(Transition::Working);
        }
    }

    fn generic_attention<F: FnMut(Transition)>(&mut self, emit: &mut F) {
        if self.armed {
            self.status = Status::Waiting;
            emit(Transition::Attention {
                text: None,
                reason: None,
            });
        }
    }

    fn match_agent(&self, cmd: &[u8]) -> Option<String> {
        let cmd = std::str::from_utf8(cmd).ok()?;
        for token in cmd.split_whitespace() {
            if token.starts_with('-') {
                continue;
            }
            let base = token.rsplit(['/', '\\']).next().unwrap_or(token);
            if let Some(agent) = self.agents.iter().find(|a| {
                base.strip_prefix(a.as_str())
                    .is_some_and(|rest| rest.is_empty() || rest.starts_with('-'))
            }) {
                return Some(agent.clone());
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(d: &mut AgentDetector, input: &[u8]) -> Vec<Transition> {
        let mut out = Vec::new();
        d.process(input, |t| out.push(t));
        out
    }

    fn osc(body: &str) -> Vec<u8> {
        let mut v = vec![ESC, OSC_INTRO];
        v.extend_from_slice(body.as_bytes());
        v.extend_from_slice(&[ESC, ST_FINAL]);
        v
    }

    fn started(agent: &str) -> Transition {
        Transition::Started {
            agent: agent.into(),
        }
    }

    #[test]
    fn terminal_notifications_survive_fragmentation_but_not_opaque_control_strings() {
        let payload = osc("99;i=build:d=0;Compile");
        let completion = osc("99;i=build:p=body;finished");
        for split in 0..=payload.len() {
            let mut detector = AgentDetector::new();
            assert!(run(&mut detector, &payload[..split]).is_empty());
            assert!(run(&mut detector, &payload[split..]).is_empty());
            assert_eq!(
                run(&mut detector, &completion),
                vec![Transition::Notification {
                    title: "Compile".into(),
                    body: "finished".into()
                }]
            );
        }
        let mut detector = AgentDetector::new();
        assert!(run(&mut detector, b"\x1bPopaque\x07\x1b]99;;forged\x07\x1b\\").is_empty());
        assert_eq!(
            run(&mut detector, &osc("9;ready")),
            vec![Transition::Notification {
                title: "ready".into(),
                body: String::new()
            }]
        );
    }

    const SHELL_TOKEN: &str = "1234567890abcdef1234567890abcdef";

    #[cfg(target_os = "macos")]
    #[test]
    fn real_zsh_profile_detects_codex_before_any_agent_turn() {
        for blocks in [false, true] {
            let root = tempfile::tempdir().unwrap();
            let profile = root.path().join("zshrc");
            std::fs::write(&profile, include_str!("scripts/zshrc.zsh")).unwrap();
            let output = std::process::Command::new("/bin/zsh")
                .args([
                    "-f",
                    "-c",
                    r#"source "$1"; _terax_preexec "$2"; printf 'TERAX_AGENT_READY\n'; _terax_precmd"#,
                    "terax-agent-test",
                ])
                .arg(&profile)
                .arg("codex -s read-only -a never")
                .env("TERAX_USER_ZDOTDIR", root.path())
                .env("TERAX_SHELL_INTEGRATION_TOKEN", SHELL_TOKEN)
                .env("TERAX_BLOCKS", if blocks { "1" } else { "" })
                .current_dir(root.path())
                .output()
                .unwrap();
            assert!(output.status.success());
            let mut detector = AgentDetector::with_shell_token(SHELL_TOKEN.into());
            assert_eq!(
                run(&mut detector, &output.stdout),
                vec![started("codex"), Transition::Exited],
                "blocks={blocks}",
            );
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn native_encoded_instructions_preserve_legacy_agent_detection() {
        use super::super::engine::shell::{ShellEvent, ShellIntegration};

        let root = tempfile::tempdir().unwrap();
        let profile = root.path().join("zshrc");
        std::fs::write(&profile, include_str!("scripts/zshrc.zsh")).unwrap();
        let command = format!("codex -c instructions='{}'", "?!;".repeat(1000));
        let legacy = osc(&format!("133;C;{command}"));
        assert!(legacy.len() < OSC_MAX);
        assert_eq!(
            run(&mut AgentDetector::new(), &legacy),
            vec![started("codex")]
        );
        let output = std::process::Command::new("/bin/zsh")
            .args([
                "-f",
                "-c",
                r#"source "$1"; _terax_preexec "$2""#,
                "terax-agent-test",
            ])
            .arg(&profile)
            .arg(&command)
            .env("TERAX_USER_ZDOTDIR", root.path())
            .env("TERAX_SHELL_INTEGRATION_TOKEN", SHELL_TOKEN)
            .env("TERAX_BLOCKS", "1")
            .current_dir(root.path())
            .output()
            .unwrap();
        assert!(output.status.success());
        let begin = output
            .stdout
            .windows(7)
            .position(|bytes| bytes == b"\x1b]133;C")
            .unwrap();
        assert!(output.stdout.len() - begin > OSC_MAX);
        let mut shell = ShellIntegration::new(Some(SHELL_TOKEN.into()));
        let mut commands = Vec::new();
        shell
            .ingest_segments(&output.stdout, |_, event| {
                if let Some(ShellEvent::CommandStart { command, .. }) = event {
                    commands.push(command);
                }
                Ok(())
            })
            .unwrap();
        assert_eq!(commands, vec![command]);
        let mut detector = AgentDetector::with_shell_token(SHELL_TOKEN.into());
        assert_eq!(run(&mut detector, &output.stdout), vec![started("codex")]);
    }

    #[test]
    fn expanded_native_marker_waits_for_the_complete_token() {
        let prefix = format!("\x1b]133;C;cmdline_url=codex%20{}", "%3F".repeat(3000));
        assert!(prefix.len() > OSC_MAX);
        for token in ["wrong", SHELL_TOKEN] {
            let mut detector = AgentDetector::with_shell_token(SHELL_TOKEN.into());
            assert!(run(&mut detector, prefix.as_bytes()).is_empty());
            let tail = format!(";aid={token}\x07");
            let expected = if token == SHELL_TOKEN {
                vec![started("codex")]
            } else {
                vec![]
            };
            assert_eq!(run(&mut detector, tail.as_bytes()), expected);
        }
    }

    #[test]
    fn oversized_native_marker_is_discarded_whole_before_recovery() {
        use super::super::engine::shell::MAX_MARK_BYTES;
        let mut detector = AgentDetector::with_shell_token(SHELL_TOKEN.into());
        let input = osc(&format!(
            "133;C;cmdline_url=codex%20{};aid={SHELL_TOKEN}",
            "x".repeat(MAX_MARK_BYTES)
        ));
        for chunk in input.chunks(4096) {
            assert!(run(&mut detector, chunk).is_empty());
            assert!(detector.osc.capacity() <= MAX_MARK_BYTES);
        }
        assert_eq!(
            run(
                &mut detector,
                &osc(&format!("133;C;aid={SHELL_TOKEN};cmdline_url=codex"))
            ),
            vec![started("codex")]
        );
    }

    #[test]
    fn native_budget_does_not_accept_a_truncated_overlong_decoded_command() {
        use super::super::engine::shell::MAX_COMMAND_BYTES;
        let mut detector = AgentDetector::with_shell_token(SHELL_TOKEN.into());
        let input = osc(&format!(
            "133;C;aid={SHELL_TOKEN};cmdline_url=codex%20{}",
            "x".repeat(MAX_COMMAND_BYTES)
        ));
        assert!(run(&mut detector, &input).is_empty());
    }

    #[test]
    fn legacy_and_other_native_osc_keep_the_eight_kib_limit() {
        let mut legacy = AgentDetector::new();
        assert!(run(
            &mut legacy,
            &osc(&format!("133;C;codex {}", "x".repeat(OSC_MAX)))
        )
        .is_empty());
        assert_eq!(
            run(&mut legacy, &osc("133;C;codex")),
            vec![started("codex")]
        );
        let mut native = AgentDetector::with_shell_token(SHELL_TOKEN.into());
        assert!(run(
            &mut native,
            &osc(&format!(
                "777;notify;Terax;codex;finished;{}",
                "x".repeat(OSC_MAX)
            ))
        )
        .is_empty());
        assert_eq!(
            run(&mut native, &osc("777;notify;Terax;codex;working")),
            vec![started("codex")]
        );
    }

    #[test]
    fn native_command_metadata_survives_every_chunk_boundary_once() {
        let marker = osc(&format!(
            "133;C;aid={SHELL_TOKEN};cmdline_url=/opt/tools/codex%20-s%20read-only%20-a%20never"
        ));
        for split in 0..=marker.len() {
            let mut detector = AgentDetector::with_shell_token(SHELL_TOKEN.into());
            let mut events = run(&mut detector, &marker[..split]);
            events.extend(run(&mut detector, &marker[split..]));
            assert_eq!(events, vec![started("codex")], "split={split}");
            assert!(run(&mut detector, &marker).is_empty());
            assert_eq!(
                run(&mut detector, &osc(&format!("133;D;0;aid={SHELL_TOKEN}"))),
                vec![Transition::Exited]
            );
        }
    }

    #[test]
    fn native_detection_rejects_unowned_or_malformed_command_metadata() {
        let payloads = [
            "133;C;codex".to_string(),
            "133;C;cmdline_url=codex".to_string(),
            "133;C;aid=wrong;cmdline_url=codex".to_string(),
            format!("133;C;aid={SHELL_TOKEN};aid={SHELL_TOKEN};cmdline_url=codex"),
            format!("133;C;aid={SHELL_TOKEN};cmdline_url=codex;cmdline_url=pi"),
            format!("133;C;aid={SHELL_TOKEN};cmdline_url=codex%GG"),
            format!("133;C;aid={SHELL_TOKEN};cmdline_url=codex%20%FF"),
            format!("133;C;aid={SHELL_TOKEN};cmdline_url=codex%00"),
            format!("133;C;aid={SHELL_TOKEN};cmdline_url=printf%20hello"),
            format!("133;Cat;aid={SHELL_TOKEN};cmdline_url=codex"),
        ];
        for payload in payloads {
            let mut detector = AgentDetector::with_shell_token(SHELL_TOKEN.into());
            assert!(run(&mut detector, &osc(&payload)).is_empty(), "{payload}");
        }
    }

    #[test]
    fn native_detection_requires_the_owned_command_end() {
        let mut detector = AgentDetector::with_shell_token(SHELL_TOKEN.into());
        assert_eq!(
            run(
                &mut detector,
                &osc(&format!("133;C;cmdline_url=codex;aid={SHELL_TOKEN}"))
            ),
            vec![started("codex")]
        );
        for payload in [
            "133;D;0".to_string(),
            "133;D;0;aid=wrong".to_string(),
            format!("133;D;0;aid={SHELL_TOKEN};aid={SHELL_TOKEN}"),
            format!("133;Done;0;aid={SHELL_TOKEN}"),
            format!("133;D;invalid;aid={SHELL_TOKEN}"),
        ] {
            assert!(run(&mut detector, &osc(&payload)).is_empty());
        }
        assert_eq!(
            run(&mut detector, &osc(&format!("133;D;0;aid={SHELL_TOKEN}"))),
            vec![Transition::Exited]
        );
        assert!(run(&mut detector, &osc(&format!("133;D;0;aid={SHELL_TOKEN}"))).is_empty());
    }

    #[test]
    fn native_mode_preserves_explicit_agent_hooks_without_shell_metadata() {
        let mut detector = AgentDetector::with_shell_token(SHELL_TOKEN.into());
        assert_eq!(
            run(&mut detector, &osc("777;notify;Terax;codex;working")),
            vec![started("codex")]
        );
        assert_eq!(
            run(&mut detector, &osc("777;notify;Terax;codex;finished")),
            vec![Transition::Finished { text: None }]
        );
    }

    #[test]
    fn arms_on_agent_command() {
        let mut d = AgentDetector::new();
        assert_eq!(
            run(&mut d, &osc("133;C;claude -p hello")),
            vec![started("claude")]
        );
    }

    #[test]
    fn arms_on_pathed_and_wrapped_command() {
        let mut d = AgentDetector::new();
        assert_eq!(
            run(&mut d, &osc("133;C;/usr/local/bin/codex exec")),
            vec![started("codex")]
        );
        let mut d2 = AgentDetector::new();
        assert_eq!(
            run(&mut d2, &osc("133;C;npx claude")),
            vec![started("claude")]
        );
    }

    #[test]
    fn arms_on_dash_suffixed_alias() {
        let mut d = AgentDetector::new();
        assert_eq!(
            run(&mut d, &osc("133;C;claude-enigma")),
            vec![started("claude")]
        );
    }

    #[test]
    fn arms_on_pi() {
        let mut d = AgentDetector::new();
        assert_eq!(run(&mut d, &osc("133;C;pi")), vec![started("pi")]);
        let mut d2 = AgentDetector::new();
        assert_eq!(
            run(&mut d2, &osc("133;C;pi --session-id terax-st-1")),
            vec![started("pi")]
        );
    }

    // `pi` is two characters, so the prefix rule must not swallow every command
    // that merely starts with those letters.
    #[test]
    fn does_not_arm_on_commands_merely_starting_with_pi() {
        for cmd in [
            "133;C;ping example.com",
            "133;C;pip install ruff",
            "133;C;pipx run black",
            "133;C;pixi shell",
        ] {
            let mut d = AgentDetector::new();
            assert!(run(&mut d, &osc(cmd)).is_empty(), "{cmd} must not arm");
        }
    }

    #[test]
    fn does_not_arm_on_other_commands() {
        let mut d = AgentDetector::new();
        assert!(run(&mut d, &osc("133;C;vim src/main.rs")).is_empty());
        assert!(run(&mut d, &osc("133;C;cat claude.txt")).is_empty());
        assert!(run(&mut d, &osc("133;C;claudexyz")).is_empty());
    }

    #[test]
    fn ignores_bell_and_plain_output() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        assert!(run(&mut d, &[BEL]).is_empty());
        assert!(run(&mut d, b"thinking...\x07more").is_empty());
    }

    #[test]
    fn terax_marker_drives_status() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;attention")),
            vec![Transition::Attention {
                text: None,
                reason: None
            }]
        );
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;working")),
            vec![Transition::Working]
        );
        assert!(run(&mut d, &osc("777;notify;Terax;working")).is_empty());
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;finished")),
            vec![Transition::Finished { text: None }]
        );
    }

    #[test]
    fn terax_marker_auto_arms_without_preexec() {
        let mut d = AgentDetector::new();
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;attention")),
            vec![
                started("claude"),
                Transition::Attention {
                    text: None,
                    reason: None
                }
            ]
        );
    }

    #[test]
    fn pi_marker_auto_arms_as_pi() {
        let mut d = AgentDetector::new();
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;pi;working")),
            vec![started("pi")]
        );
    }

    #[test]
    fn codex_session_hook_marker_auto_arms_as_codex() {
        let mut d = AgentDetector::new();
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;codex;working")),
            vec![started("codex")]
        );
    }

    #[test]
    fn generic_agent_attention_and_explicit_notifications_remain_distinct() {
        let mut d = AgentDetector::new();
        assert!(run(&mut d, &osc("777;notify;Other;ready")).is_empty());
        run(&mut d, &osc("133;C;codex"));
        assert_eq!(
            run(&mut d, &osc("777;notify;Codex;ready")),
            vec![Transition::Attention {
                text: None,
                reason: None
            }]
        );
        assert_eq!(
            run(&mut d, &osc("9;needs you")),
            vec![Transition::Notification {
                title: "needs you".into(),
                body: String::new()
            }]
        );
        assert_eq!(
            run(&mut d, &osc("9;4;1;50")),
            vec![Transition::Progress {
                progress: Progress {
                    state: 1,
                    percent: Some(50)
                }
            }]
        );
    }

    #[test]
    fn exits_on_133d() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        assert_eq!(run(&mut d, &osc("133;D;0")), vec![Transition::Exited]);
        assert!(run(&mut d, &osc("133;D;0")).is_empty());
    }

    #[test]
    fn bel_terminator_inside_osc_is_not_attention() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        let mut seq = vec![ESC, OSC_INTRO];
        seq.extend_from_slice(b"0;set title");
        seq.push(BEL);
        assert!(run(&mut d, &seq).is_empty());
    }

    #[test]
    fn started_split_across_chunks() {
        let mut d = AgentDetector::new();
        assert!(run(&mut d, &[ESC, OSC_INTRO]).is_empty());
        assert!(run(&mut d, b"133;C;cla").is_empty());
        let mut out = run(&mut d, b"ude");
        out.extend(run(&mut d, &[ESC, ST_FINAL]));
        assert_eq!(out, vec![started("claude")]);
    }

    #[test]
    fn finish_reports_exited_when_armed() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        let mut out = Vec::new();
        d.finish(|t| out.push(t));
        assert_eq!(out, vec![Transition::Exited]);
        let mut out2 = Vec::new();
        d.finish(|t| out2.push(t));
        assert!(out2.is_empty());
    }

    #[test]
    fn oversized_osc_does_not_panic() {
        let mut d = AgentDetector::new();
        run(&mut d, &osc("133;C;claude"));
        let mut seq = vec![ESC, OSC_INTRO];
        seq.extend(std::iter::repeat_n(b'x', OSC_MAX + 100));
        seq.extend_from_slice(&[ESC, ST_FINAL]);
        assert!(run(&mut d, &seq).is_empty());
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;attention")),
            vec![Transition::Attention {
                text: None,
                reason: None
            }]
        );
    }
}

#[cfg(test)]
mod message_tests {
    use super::*;

    fn osc_seq(body: &str) -> Vec<u8> {
        let mut v = vec![ESC, OSC_INTRO];
        v.extend_from_slice(body.as_bytes());
        v.push(BEL);
        v
    }

    fn feed(d: &mut AgentDetector, bytes: &[u8]) -> Vec<Transition> {
        let mut out = Vec::new();
        d.process(bytes, |t| out.push(t));
        out
    }

    #[test]
    fn carries_the_text_a_hook_reported() {
        let mut d = AgentDetector::new();

        let out = feed(
            &mut d,
            &osc_seq("777;notify;Terax;attention;Claude needs your permission to use Bash"),
        );

        assert_eq!(
            out,
            vec![
                Transition::Started {
                    agent: "claude".into()
                },
                Transition::Attention {
                    text: Some("Claude needs your permission to use Bash".into()),
                    reason: None,
                }
            ]
        );
    }

    #[test]
    fn keeps_semicolons_inside_the_text() {
        // The message is the rest of the payload, so it may contain the field
        // separator without being cut short.
        let mut d = AgentDetector::new();

        let out = feed(
            &mut d,
            &osc_seq("777;notify;Terax;finished;built; ran tests"),
        );

        assert_eq!(
            out.last(),
            Some(&Transition::Finished {
                text: Some("built; ran tests".into())
            })
        );
    }

    #[test]
    fn tolerates_an_event_with_no_text() {
        let mut d = AgentDetector::new();

        let out = feed(&mut d, &osc_seq("777;notify;Terax;finished"));

        assert_eq!(out.last(), Some(&Transition::Finished { text: None }));
    }

    #[test]
    fn treats_an_empty_text_as_none() {
        // A hook whose extraction found nothing still emits the trailing
        // separator; that must not surface as an empty line in the UI.
        let mut d = AgentDetector::new();

        let out = feed(&mut d, &osc_seq("777;notify;Terax;finished;"));

        assert_eq!(out.last(), Some(&Transition::Finished { text: None }));
    }

    #[test]
    fn reads_text_for_a_named_adapter() {
        let mut d = AgentDetector::new();

        let out = feed(
            &mut d,
            &osc_seq("777;notify;Terax;pi;attention;pick a branch"),
        );

        assert_eq!(
            out,
            vec![
                Transition::Started { agent: "pi".into() },
                Transition::Attention {
                    text: Some("pick a branch".into()),
                    reason: None
                }
            ]
        );
    }

    #[test]
    fn bounds_a_long_message() {
        let mut d = AgentDetector::new();
        let long = "x".repeat(400);

        let out = feed(
            &mut d,
            &osc_seq(&format!("777;notify;Terax;attention;{long}")),
        );

        let Some(Transition::Attention {
            text: Some(text),
            reason: None,
        }) = out.last()
        else {
            panic!("expected attention with text");
        };
        assert_eq!(text.chars().count(), MAX_SIGNAL_TEXT);
    }

    fn armed_claude() -> AgentDetector {
        let mut d = AgentDetector::new();
        feed(&mut d, &osc_seq("133;C;claude"));
        d
    }

    #[test]
    fn names_why_the_agent_is_blocked() {
        let mut d = armed_claude();
        assert_eq!(
            feed(&mut d, &osc_seq("777;notify;Terax;attention:permission_prompt;sid=;Claude needs your permission to use Bash")),
            vec![Transition::Attention {
                text: Some("Claude needs your permission to use Bash".into()),
                reason: Some("permission"),
            }]
        );
        assert_eq!(
            feed(
                &mut d,
                &osc_seq("777;notify;Terax;attention:question;sid=;")
            ),
            vec![Transition::Attention {
                text: None,
                reason: Some("question")
            }]
        );
        assert_eq!(
            feed(&mut d, &osc_seq("777;notify;Terax;attention:idle_prompt")),
            vec![Transition::Attention {
                text: None,
                reason: Some("idle")
            }]
        );
    }

    #[test]
    fn binds_the_session_once_and_again_only_when_it_changes() {
        let mut d = armed_claude();
        assert_eq!(
            feed(&mut d, &osc_seq("777;notify;Terax;working:;sid=abc-123;")),
            // Already working since the command started, so only the binding is new.
            vec![Transition::Bound {
                session_id: "abc-123".into()
            }]
        );
        assert_eq!(
            feed(
                &mut d,
                &osc_seq("777;notify;Terax;finished:;sid=abc-123;done")
            ),
            vec![Transition::Finished {
                text: Some("done".into())
            }]
        );
        assert_eq!(
            feed(&mut d, &osc_seq("777;notify;Terax;working:;sid=def;")),
            vec![
                Transition::Bound {
                    session_id: "def".into()
                },
                Transition::Working
            ]
        );
    }

    #[test]
    fn forgets_the_session_when_the_process_exits() {
        let mut d = armed_claude();
        feed(&mut d, &osc_seq("777;notify;Terax;working:;sid=abc;"));
        feed(&mut d, &osc_seq("133;D;0"));
        feed(&mut d, &osc_seq("133;C;claude"));
        assert_eq!(
            feed(&mut d, &osc_seq("777;notify;Terax;working:;sid=abc;")),
            vec![Transition::Bound {
                session_id: "abc".into()
            }]
        );
    }

    #[test]
    fn drops_a_session_id_that_could_escape_the_sessions_directory() {
        let mut d = armed_claude();
        assert_eq!(
            feed(
                &mut d,
                &osc_seq("777;notify;Terax;finished:;sid=../../etc;")
            ),
            vec![Transition::Finished { text: None }]
        );
    }

    #[test]
    fn reports_a_subagent_without_touching_the_session_status() {
        let mut d = armed_claude();
        feed(&mut d, &osc_seq("777;notify;Terax;working"));
        assert_eq!(
            feed(&mut d, &osc_seq("777;notify;Terax;subagent:;sid=;")),
            vec![Transition::Subagent { text: None }]
        );
        // Still working: the next working marker is a no-op.
        assert!(feed(&mut d, &osc_seq("777;notify;Terax;working")).is_empty());
    }

    #[test]
    fn a_login_notice_asks_nothing_of_the_user() {
        let mut d = armed_claude();
        assert!(feed(
            &mut d,
            &osc_seq("777;notify;Terax;attention:auth_success;sid=;")
        )
        .is_empty());
    }

    #[test]
    fn hooks_installed_before_the_new_fields_still_parse() {
        let mut d = armed_claude();
        assert_eq!(
            feed(
                &mut d,
                &osc_seq("777;notify;Terax;attention;Claude is waiting")
            ),
            vec![Transition::Attention {
                text: Some("Claude is waiting".into()),
                reason: None
            }]
        );
    }

    #[test]
    fn the_signal_carries_reason_and_session_to_the_webview() {
        let json = serde_json::to_value(
            Transition::Attention {
                text: None,
                reason: Some("question"),
            }
            .into_signal(7),
        )
        .unwrap();
        assert_eq!(json["kind"], "attention");
        assert_eq!(json["reason"], "question");
        let bound = serde_json::to_value(
            Transition::Bound {
                session_id: "abc".into(),
            }
            .into_signal(7),
        )
        .unwrap();
        assert_eq!(bound["sessionId"], "abc");
    }
}
