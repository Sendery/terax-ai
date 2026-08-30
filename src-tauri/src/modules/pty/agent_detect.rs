const ESC: u8 = 0x1b;
const BEL: u8 = 0x07;
const OSC_INTRO: u8 = b']';
const ST_FINAL: u8 = b'\\';

const OSC_MAX: usize = 2048;

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
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Status {
    Working,
    Waiting,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Transition {
    Started { agent: String },
    Working,
    /// The agent is blocked on the user. `text` is what it said it needs.
    Attention { text: Option<String> },
    /// The agent ended a turn. `text` is its closing line, when it reported one.
    Finished { text: Option<String> },
    Exited,
}

#[derive(Clone, serde::Serialize)]
pub struct AgentSignal {
    pub id: u32,
    pub kind: &'static str,
    pub agent: Option<String>,
    /// Line the agent attached to the event, already bounded and stripped of
    /// control characters. Absent when it reported none.
    pub text: Option<String>,
}

impl Transition {
    pub fn into_signal(self, id: u32) -> AgentSignal {
        match self {
            Transition::Started { agent } => AgentSignal {
                id,
                kind: "started",
                agent: Some(agent),
                text: None,
            },
            Transition::Working => AgentSignal {
                id,
                kind: "working",
                agent: None,
                text: None,
            },
            Transition::Attention { text } => AgentSignal {
                id,
                kind: "attention",
                agent: None,
                text,
            },
            Transition::Finished { text } => AgentSignal {
                id,
                kind: "finished",
                agent: None,
                text,
            },
            Transition::Exited => AgentSignal {
                id,
                kind: "exited",
                agent: None,
                text: None,
            },
        }
    }
}

/// Splits `<event>` from an optional `;<text>` tail.
///
/// The text is the rest of the payload, so it may contain the field separator.
/// It arrives over a terminal stream any process can write to, so it is
/// stripped of control characters and bounded before it reaches the UI.
fn split_event_text(payload: &[u8]) -> (&[u8], Option<String>) {
    let Some(index) = payload.iter().position(|byte| *byte == b';') else {
        return (payload, None);
    };
    let (event, rest) = (&payload[..index], &payload[index + 1..]);
    let text: String = String::from_utf8_lossy(rest)
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_SIGNAL_TEXT)
        .collect();
    let text = text.trim().to_string();
    (event, if text.is_empty() { None } else { Some(text) })
}

pub struct AgentDetector {
    agents: Vec<String>,
    state: State,
    osc: Vec<u8>,
    armed: bool,
    status: Status,
}

impl AgentDetector {
    pub fn new() -> Self {
        Self::with_agents(DEFAULT_AGENTS.iter().map(|s| s.to_string()).collect())
    }

    pub fn with_agents(agents: Vec<String>) -> Self {
        Self {
            agents,
            state: State::Ground,
            osc: Vec::new(),
            armed: false,
            status: Status::Working,
        }
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
                    _ => self.state = State::Ground,
                },
                State::Osc => match b {
                    BEL => {
                        self.finish_osc(&mut emit);
                        self.state = State::Ground;
                    }
                    ESC => self.state = State::OscEsc,
                    _ => {
                        if self.osc.len() < OSC_MAX {
                            self.osc.push(b);
                        } else {
                            self.osc.clear();
                            self.state = State::Ground;
                        }
                    }
                },
                State::OscEsc => match b {
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

    /// Called when the underlying PTY closes. Reports the agent as exited so the
    /// UI doesn't leave a stale entry if the shell died mid-command.
    pub fn finish<F: FnMut(Transition)>(&mut self, mut emit: F) {
        if self.armed {
            self.disarm();
            emit(Transition::Exited);
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
        self.status = Status::Working;
    }

    fn finish_osc<F: FnMut(Transition)>(&mut self, emit: &mut F) {
        let body = std::mem::take(&mut self.osc);
        let (ps, pt) = match body.iter().position(|&c| c == b';') {
            Some(i) => (&body[..i], &body[i + 1..]),
            None => (&body[..], &body[0..0]),
        };
        match ps {
            b"133" => self.handle_osc133(pt, emit),
            // OSC 9;4 is taskbar progress, not a notification.
            b"9" if !pt.starts_with(b"4;") && pt != b"4" => self.generic_attention(emit),
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
            let (event, text) = split_event_text(event);
            match event {
                b"working" => {
                    self.ensure_armed_as(agent, emit);
                    self.set_working(emit);
                }
                b"attention" => {
                    self.ensure_armed_as(agent, emit);
                    self.status = Status::Waiting;
                    emit(Transition::Attention { text });
                }
                b"finished" => {
                    self.ensure_armed_as(agent, emit);
                    self.status = Status::Waiting;
                    emit(Transition::Finished { text });
                }
                _ => {}
            }
            return;
        }
        self.generic_attention(emit);
    }

    fn handle_osc133<F: FnMut(Transition)>(&mut self, pt: &[u8], emit: &mut F) {
        match pt.first() {
            Some(b'C') => {
                if self.armed {
                    return;
                }
                let cmd = pt.strip_prefix(b"C;").unwrap_or(b"");
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
            emit(Transition::Attention { text: None });
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
        Transition::Started { agent: agent.into() }
    }

    #[test]
    fn arms_on_agent_command() {
        let mut d = AgentDetector::new();
        assert_eq!(run(&mut d, &osc("133;C;claude -p hello")), vec![started("claude")]);
    }

    #[test]
    fn arms_on_pathed_and_wrapped_command() {
        let mut d = AgentDetector::new();
        assert_eq!(
            run(&mut d, &osc("133;C;/usr/local/bin/codex exec")),
            vec![started("codex")]
        );
        let mut d2 = AgentDetector::new();
        assert_eq!(run(&mut d2, &osc("133;C;npx claude")), vec![started("claude")]);
    }

    #[test]
    fn arms_on_dash_suffixed_alias() {
        let mut d = AgentDetector::new();
        assert_eq!(run(&mut d, &osc("133;C;claude-enigma")), vec![started("claude")]);
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
        assert_eq!(run(&mut d, &osc("777;notify;Terax;attention")), vec![Transition::Attention { text: None }]);
        assert_eq!(run(&mut d, &osc("777;notify;Terax;working")), vec![Transition::Working]);
        assert!(run(&mut d, &osc("777;notify;Terax;working")).is_empty());
        assert_eq!(run(&mut d, &osc("777;notify;Terax;finished")), vec![Transition::Finished { text: None }]);
    }

    #[test]
    fn terax_marker_auto_arms_without_preexec() {
        let mut d = AgentDetector::new();
        assert_eq!(
            run(&mut d, &osc("777;notify;Terax;attention")),
            vec![started("claude"), Transition::Attention { text: None }]
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
    fn generic_osc777_and_osc9_attention_only_when_armed() {
        let mut d = AgentDetector::new();
        assert!(run(&mut d, &osc("777;notify;Other;ready")).is_empty());
        run(&mut d, &osc("133;C;codex"));
        assert_eq!(run(&mut d, &osc("777;notify;Codex;ready")), vec![Transition::Attention { text: None }]);
        assert_eq!(run(&mut d, &osc("9;needs you")), vec![Transition::Attention { text: None }]);
        assert!(run(&mut d, &osc("9;4;1;50")).is_empty());
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
        assert_eq!(run(&mut d, &osc("777;notify;Terax;attention")), vec![Transition::Attention { text: None }]);
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
                Transition::Started { agent: "claude".into() },
                Transition::Attention {
                    text: Some("Claude needs your permission to use Bash".into())
                }
            ]
        );
    }

    #[test]
    fn keeps_semicolons_inside_the_text() {
        // The message is the rest of the payload, so it may contain the field
        // separator without being cut short.
        let mut d = AgentDetector::new();

        let out = feed(&mut d, &osc_seq("777;notify;Terax;finished;built; ran tests"));

        assert_eq!(
            out.last(),
            Some(&Transition::Finished { text: Some("built; ran tests".into()) })
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

        let out = feed(&mut d, &osc_seq("777;notify;Terax;pi;attention;pick a branch"));

        assert_eq!(
            out,
            vec![
                Transition::Started { agent: "pi".into() },
                Transition::Attention { text: Some("pick a branch".into()) }
            ]
        );
    }

    #[test]
    fn bounds_a_long_message() {
        let mut d = AgentDetector::new();
        let long = "x".repeat(400);

        let out = feed(&mut d, &osc_seq(&format!("777;notify;Terax;attention;{long}")));

        let Some(Transition::Attention { text: Some(text) }) = out.last() else {
            panic!("expected attention with text");
        };
        assert_eq!(text.chars().count(), MAX_SIGNAL_TEXT);
    }
}
