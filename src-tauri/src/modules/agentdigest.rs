//! Live digest of one agent session, for the agent monitor and notifications.
//!
//! The hook signals say *when* something happened; the transcript says *what*
//! the session is: its name, its latest recap, the question it is blocked on,
//! the subagents and monitors it still has running, and the PRs and artifacts
//! it produced. Every supported agent already writes that to disk, so this
//! reads it back instead of inventing a second channel.
//!
//! Transcripts reach tens of megabytes, so reading is incremental: each file
//! keeps its byte offset and folded state, and a call parses only what was
//! appended since the last one. Lines are screened by substring before any
//! JSON parse, because the entries that matter are a small share of a file.
//!
//! As with `agentsessions`, the webview never supplies a path: it names an
//! agent plus a safe session id or a cwd, and resolution stays inside that
//! agent's own sessions directory.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Read as _, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

use super::agentsessions::{find_session_file, is_safe_session_id, project_dir_name, AgentKind};

/// A recap is a paragraph, not a transcript.
const MAX_TEXT_CHARS: usize = 600;
const MAX_LABEL_CHARS: usize = 120;
const MAX_LINKS: usize = 20;
/// Open tasks are bounded so a pathological transcript cannot grow the state.
const MAX_OPEN_TASKS: usize = 128;
/// One call reads at most this much; a huge first read finishes on later calls.
const MAX_READ_PER_CALL: u64 = 64 * 1024 * 1024;
const CACHE_CAP: usize = 32;
/// How many recent codex rollouts are checked to find the one for a cwd.
const CODEX_SCAN_FILES: usize = 300;
const CODEX_RESOLVE_TTL: Duration = Duration::from_secs(10);
/// A monitor without a timeout runs for the tool's default.
const MONITOR_DEFAULT_MS: u64 = 300_000;
const MONITOR_MAX_MS: u64 = 3_600_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DigestAgent {
    Claude,
    Pi,
    Codex,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrLink {
    pub number: u64,
    pub url: String,
    pub repo: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactLink {
    pub url: String,
    pub title: String,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TaskKind {
    Subagent,
    Monitor,
    Background,
    Loop,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActiveTask {
    pub kind: TaskKind,
    pub label: String,
    /// Epoch milliseconds, so the webview can drop tasks older than the
    /// process now running in the pane: a resumed session inherits entries
    /// whose completion the previous process never lived to write.
    pub started_at: u64,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionDigest {
    pub session_id: Option<String>,
    /// What the user named the session, else what the agent named it.
    pub name: Option<String>,
    /// The agent's own summary of where things stand, when it wrote one.
    pub recap: Option<String>,
    pub recap_at: Option<u64>,
    /// The last thing the agent said, the fallback when there is no recap.
    pub last_reply: Option<String>,
    pub last_reply_at: Option<u64>,
    pub goal: Option<String>,
    /// The question the session is blocked on right now.
    pub pending_question: Option<String>,
    pub prs: Vec<PrLink>,
    pub artifacts: Vec<ArtifactLink>,
    pub tasks: Vec<ActiveTask>,
}

#[derive(Clone, Debug)]
struct OpenTask {
    id: String,
    kind: TaskKind,
    label: String,
    started_at: u64,
    expires_at: Option<u64>,
}

/// Folds transcript lines into a digest. Pure: it never touches the disk, so
/// the rules for each agent are tested against literal lines.
#[derive(Debug)]
pub struct DigestBuilder {
    agent: DigestAgent,
    session_id: Option<String>,
    custom_title: Option<String>,
    auto_title: Option<String>,
    recap: Option<String>,
    recap_at: Option<u64>,
    last_reply: Option<String>,
    last_reply_at: Option<u64>,
    goal: Option<String>,
    pending: Option<(String, String)>,
    prs: Vec<PrLink>,
    artifacts: Vec<ArtifactLink>,
    open: Vec<OpenTask>,
    /// pi reports a loop's id only in the tool result, so the call waits here.
    loop_calls: HashMap<String, (String, u64)>,
    /// Calls that open a pull request; only their output is scanned for links.
    pr_calls: std::collections::HashSet<String>,
}

const CLAUDE_KEYS: &[&str] = &[
    "custom-title",
    "ai-title",
    "away_summary",
    "pr-link",
    "frame-link",
    "tool_use",
    "tool_result",
    "task-notification",
    "\"text\"",
];
const PI_KEYS: &[&str] = &[
    "session_info",
    "compaction",
    "\"assistant\"",
    "toolResult",
];
const CODEX_KEYS: &[&str] = &[
    "session_meta",
    "task_complete",
    "thread_goal_updated",
    "\"assistant\"",
    "request_user_input",
    "_output",
    "gh pr create",
    "create_pull_request",
];

const TERMINAL_TASK_STATES: &[&str] = &["completed", "failed", "killed", "stopped"];
/// What a tool result says when the work it started keeps running.
const ASYNC_MARKERS: &[&str] = &["Async agent launched", "running in background", "Monitor started"];

impl DigestBuilder {
    pub fn new(agent: DigestAgent) -> Self {
        Self {
            agent,
            session_id: None,
            custom_title: None,
            auto_title: None,
            recap: None,
            recap_at: None,
            last_reply: None,
            last_reply_at: None,
            goal: None,
            pending: None,
            prs: Vec::new(),
            artifacts: Vec::new(),
            open: Vec::new(),
            loop_calls: HashMap::new(),
            pr_calls: std::collections::HashSet::new(),
        }
    }

    pub fn ingest_line(&mut self, line: &str) {
        let keys = match self.agent {
            DigestAgent::Claude => CLAUDE_KEYS,
            DigestAgent::Pi => PI_KEYS,
            DigestAgent::Codex => CODEX_KEYS,
        };
        if !keys.iter().any(|key| line.contains(key)) {
            return;
        }
        // Claude delivers a finished task through a queue operation, a queued
        // command attachment or a user message depending on timing, so the
        // notification is found in the raw line rather than in one envelope.
        if self.agent == DigestAgent::Claude && line.contains("<task-notification>") {
            self.close_notified(line);
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return;
        };
        match self.agent {
            DigestAgent::Claude => self.claude(&value),
            DigestAgent::Pi => self.pi(&value),
            DigestAgent::Codex => self.codex(&value),
        }
    }

    pub fn snapshot(&self, now_ms: u64) -> SessionDigest {
        SessionDigest {
            session_id: self.session_id.clone(),
            name: self.custom_title.clone().or_else(|| self.auto_title.clone()),
            recap: self.recap.clone(),
            recap_at: self.recap_at,
            last_reply: self.last_reply.clone(),
            last_reply_at: self.last_reply_at,
            goal: self.goal.clone(),
            pending_question: self.pending.as_ref().map(|(_, question)| question.clone()),
            prs: self.prs.clone(),
            artifacts: self.artifacts.clone(),
            tasks: self
                .open
                .iter()
                .filter(|task| task.expires_at.is_none_or(|at| at > now_ms))
                .map(|task| ActiveTask {
                    kind: task.kind,
                    label: task.label.clone(),
                    started_at: task.started_at,
                })
                .collect(),
        }
    }

    fn claude(&mut self, v: &Value) {
        let at = timestamp_ms(v);
        match v["type"].as_str().unwrap_or("") {
            "custom-title" => {
                set_text(&mut self.custom_title, &v["customTitle"], MAX_LABEL_CHARS);
            }
            "ai-title" => {
                set_text(&mut self.auto_title, &v["aiTitle"], MAX_LABEL_CHARS);
            }
            "pr-link" => {
                if let (Some(number), Some(url)) = (v["prNumber"].as_u64(), v["prUrl"].as_str()) {
                    let repo = v["prRepository"].as_str().unwrap_or("").to_string();
                    push_pr(&mut self.prs, PrLink { number, url: url.to_string(), repo });
                }
            }
            "frame-link" => {
                if let Some(url) = v["frameUrl"].as_str() {
                    let title = clip(v["title"].as_str().unwrap_or(""), MAX_LABEL_CHARS);
                    push_artifact(&mut self.artifacts, ArtifactLink { url: url.to_string(), title });
                }
            }
            "system" if v["subtype"] == "away_summary" => {
                if set_text(&mut self.recap, &v["content"], MAX_TEXT_CHARS) {
                    self.recap_at = at;
                }
            }
            role @ ("assistant" | "user") if v["isSidechain"] != true => {
                let content = &v["message"]["content"];
                if content.is_string() {
                    return;
                }
                for block in content.as_array().into_iter().flatten() {
                    match (role, block["type"].as_str().unwrap_or("")) {
                        ("assistant", "text") => {
                            if set_text(&mut self.last_reply, &block["text"], MAX_TEXT_CHARS) {
                                self.last_reply_at = at;
                            }
                        }
                        ("assistant", "tool_use") => self.claude_tool_use(block, at.unwrap_or(0)),
                        ("user", "tool_result") => self.claude_tool_result(block),
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }

    fn claude_tool_use(&mut self, block: &Value, at: u64) {
        let Some(id) = block["id"].as_str() else {
            return;
        };
        let input = &block["input"];
        let label_of = |keys: &[&str]| {
            keys.iter()
                .find_map(|key| input[*key].as_str().filter(|s| !s.trim().is_empty()))
                .map(|s| clip(s, MAX_LABEL_CHARS))
                .unwrap_or_default()
        };
        match block["name"].as_str().unwrap_or("") {
            "Agent" | "Task" => {
                self.open_task(id, TaskKind::Subagent, label_of(&["description", "subagent_type"]), at, None)
            }
            "Monitor" => {
                let timeout = input["timeout_ms"]
                    .as_u64()
                    .or_else(|| input["timeout_ms"].as_str().and_then(|s| s.parse().ok()))
                    .unwrap_or(MONITOR_DEFAULT_MS)
                    .min(MONITOR_MAX_MS);
                self.open_task(id, TaskKind::Monitor, label_of(&["description"]), at, Some(at + timeout))
            }
            "Bash" if input["run_in_background"] == true => {
                self.open_task(id, TaskKind::Background, label_of(&["description", "command"]), at, None)
            }
            "AskUserQuestion" => {
                let first = &input["questions"][0];
                let question = first["question"]
                    .as_str()
                    .or_else(|| first["header"].as_str())
                    .unwrap_or("");
                self.pending = Some((id.to_string(), clip(question, MAX_TEXT_CHARS)));
            }
            _ => {}
        }
    }

    fn claude_tool_result(&mut self, block: &Value) {
        let Some(id) = block["tool_use_id"].as_str() else {
            return;
        };
        if self.pending.as_ref().is_some_and(|(pending, _)| pending == id) {
            self.pending = None;
        }
        let Some(index) = self.open.iter().position(|task| task.id == id) else {
            return;
        };
        // A foreground subagent returns its answer here; one that runs on
        // reports back later through a task notification.
        let text = flatten_text(&block["content"]);
        let still_running =
            block["is_error"] != true && ASYNC_MARKERS.iter().any(|marker| text.contains(marker));
        if !still_running {
            self.open.remove(index);
        }
    }

    /// Closes every task a `<task-notification>` reports as finished. The
    /// notification names the tool use that started it, which is the key the
    /// task was opened under.
    fn close_notified(&mut self, text: &str) {
        for block in text.split("<task-notification>").skip(1) {
            let (Some(id), Some(status)) = (tag(block, "tool-use-id"), tag(block, "status")) else {
                continue;
            };
            if TERMINAL_TASK_STATES.contains(&status) {
                self.open.retain(|task| task.id != id);
            }
        }
    }

    fn pi(&mut self, v: &Value) {
        let at = timestamp_ms(v);
        match v["type"].as_str().unwrap_or("") {
            "session_info" => {
                set_text(&mut self.custom_title, &v["name"], MAX_LABEL_CHARS);
            }
            "compaction" => {
                if set_text(&mut self.recap, &v["summary"], MAX_TEXT_CHARS) {
                    self.recap_at = at;
                }
            }
            "message" => {
                let message = &v["message"];
                match message["role"].as_str().unwrap_or("") {
                    "assistant" => {
                        for block in message["content"].as_array().into_iter().flatten() {
                            match block["type"].as_str().unwrap_or("") {
                                "text" => {
                                    if set_text(&mut self.last_reply, &block["text"], MAX_TEXT_CHARS) {
                                        self.last_reply_at = at;
                                    }
                                }
                                "toolCall" => self.pi_tool_call(block, at.unwrap_or(0)),
                                _ => {}
                            }
                        }
                    }
                    "toolResult" => {
                        let text = flatten_text(&message["content"]);
                        let call = message["toolCallId"].as_str().unwrap_or("");
                        if self.pr_calls.remove(call) {
                            scan_pr_links(&text, &mut self.prs);
                        }
                        if let Some((label, started)) = self.loop_calls.remove(call) {
                            if let Some(loop_id) = created_loop_id(&text) {
                                self.open_task(&format!("loop:{loop_id}"), TaskKind::Loop, label, started, None);
                            }
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }

    fn pi_tool_call(&mut self, block: &Value, at: u64) {
        let args = &block["arguments"];
        if let Some(call) = block["id"].as_str() {
            if opens_pull_request(block["name"].as_str().unwrap_or(""), &args.to_string()) {
                self.pr_calls.insert(call.to_string());
            }
        }
        match block["name"].as_str().unwrap_or("") {
            "LoopCreate" => {
                if let Some(call) = block["id"].as_str() {
                    let label = clip(args["prompt"].as_str().unwrap_or("loop"), MAX_LABEL_CHARS);
                    self.loop_calls.insert(call.to_string(), (label, at));
                }
            }
            "LoopDelete" => {
                if let Some(id) = args["id"].as_str() {
                    let key = format!("loop:{id}");
                    self.open.retain(|task| task.id != key);
                }
            }
            _ => {}
        }
    }

    fn codex(&mut self, v: &Value) {
        let at = timestamp_ms(v);
        let payload = &v["payload"];
        match (v["type"].as_str().unwrap_or(""), payload["type"].as_str().unwrap_or("")) {
            ("session_meta", _) => {
                if let Some(id) = payload["id"].as_str().filter(|id| is_safe_session_id(id)) {
                    self.session_id = Some(id.to_string());
                }
            }
            ("event_msg", "task_complete") => {
                if set_text(&mut self.recap, &payload["last_agent_message"], MAX_TEXT_CHARS) {
                    self.recap_at = at;
                }
                // A finished turn is no longer waiting on the question.
                self.pending = None;
            }
            ("event_msg", "thread_goal_updated") => {
                set_text(&mut self.goal, &payload["goal"]["objective"], MAX_TEXT_CHARS);
            }
            ("response_item", "message") if payload["role"] == "assistant" => {
                let text = flatten_text(&payload["content"]);
                if set_text(&mut self.last_reply, &Value::String(text), MAX_TEXT_CHARS) {
                    self.last_reply_at = at;
                }
            }
            ("response_item", "function_call" | "custom_tool_call")
                if opens_pull_request(
                    payload["name"].as_str().unwrap_or(""),
                    &format!("{}{}", payload["arguments"], payload["input"]),
                ) =>
            {
                if let Some(call) = payload["call_id"].as_str() {
                    self.pr_calls.insert(call.to_string());
                }
            }
            ("response_item", "function_call") if payload["name"] == "request_user_input_async" => {
                if let Some(call) = payload["call_id"].as_str() {
                    let question = payload["arguments"]
                        .as_str()
                        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
                        .and_then(|args| first_text(&args))
                        .unwrap_or_default();
                    self.pending = Some((call.to_string(), clip(&question, MAX_TEXT_CHARS)));
                }
            }
            ("response_item", "function_call_output" | "custom_tool_call_output") => {
                if let Some(call) = payload["call_id"].as_str() {
                    if self.pending.as_ref().is_some_and(|(pending, _)| pending == call) {
                        self.pending = None;
                    }
                    if self.pr_calls.remove(call) {
                        scan_pr_links(&flatten_text(&payload["output"]), &mut self.prs);
                    }
                }
            }
            _ => {}
        }
    }

    fn open_task(&mut self, id: &str, kind: TaskKind, label: String, started_at: u64, expires_at: Option<u64>) {
        if self.open.iter().any(|task| task.id == id) {
            return;
        }
        if self.open.len() >= MAX_OPEN_TASKS {
            self.open.remove(0);
        }
        self.open.push(OpenTask { id: id.to_string(), kind, label, started_at, expires_at });
    }
}

fn set_text(slot: &mut Option<String>, value: &Value, limit: usize) -> bool {
    match value.as_str().map(str::trim).filter(|s| !s.is_empty()) {
        Some(text) => {
            *slot = Some(clip(text, limit));
            true
        }
        None => false,
    }
}

/// Collapses whitespace and bounds the length on a character boundary.
fn clip(text: &str, limit: usize) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= limit {
        return collapsed;
    }
    let mut out: String = collapsed.chars().take(limit.saturating_sub(1)).collect();
    out.push('\u{2026}');
    out
}

/// Concatenates every string found in a tool result or message content,
/// whichever of the agents' shapes it arrives in.
fn flatten_text(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Array(items) => items.iter().map(flatten_text).collect::<Vec<_>>().join("\n"),
        Value::Object(map) => ["text", "content", "output"]
            .iter()
            .filter_map(|key| map.get(*key))
            .map(flatten_text)
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn first_text(value: &Value) -> Option<String> {
    match value {
        Value::String(s) if !s.trim().is_empty() => Some(s.clone()),
        Value::Array(items) => items.iter().find_map(first_text),
        Value::Object(map) => ["question", "prompt", "questions", "message", "text"]
            .iter()
            .filter_map(|key| map.get(*key))
            .find_map(first_text),
        _ => None,
    }
}

fn tag<'a>(block: &'a str, name: &str) -> Option<&'a str> {
    let open = format!("<{name}>");
    let close = format!("</{name}>");
    let start = block.find(&open)? + open.len();
    let end = block[start..].find(&close)? + start;
    Some(block[start..end].trim())
}

fn created_loop_id(text: &str) -> Option<&str> {
    let rest = text.split("Loop #").nth(1)?;
    let id: &str = rest.split(|c: char| !c.is_ascii_alphanumeric()).next()?;
    (!id.is_empty() && rest[id.len()..].trim_start().starts_with("created")).then_some(id)
}

/// Whether a tool call opens a pull request: `gh pr create` in a shell, or a
/// GitHub tool named for it. A review session reads dozens of PRs, and only
/// the ones it opened belong to it.
fn opens_pull_request(tool: &str, arguments: &str) -> bool {
    tool.contains("create_pull_request") || arguments.contains("gh pr create")
}

/// Keeps the newest links: once full, the oldest one gives way.
fn push_pr(prs: &mut Vec<PrLink>, pr: PrLink) {
    if prs.iter().any(|known| known.url == pr.url) {
        return;
    }
    if prs.len() >= MAX_LINKS {
        prs.remove(0);
    }
    prs.push(pr);
}

fn push_artifact(artifacts: &mut Vec<ArtifactLink>, artifact: ArtifactLink) {
    if let Some(known) = artifacts.iter_mut().find(|known| known.url == artifact.url) {
        // A republish may carry a better title; the link stays where it was.
        if !artifact.title.is_empty() {
            known.title = artifact.title;
        }
        return;
    }
    if artifacts.len() >= MAX_LINKS {
        artifacts.remove(0);
    }
    artifacts.push(artifact);
}

/// Finds `github.com/<owner>/<repo>/pull/<n>` links in free text.
///
/// Agents that record no PR entry still print the URL `gh pr create`
/// returned, so the text is the only place those PRs exist.
pub fn scan_pr_links(text: &str, out: &mut Vec<PrLink>) {
    let is_name = |c: char| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.');
    for (index, _) in text.match_indices("github.com/") {
        let rest = &text[index + "github.com/".len()..];
        let owner_len = rest.find(|c: char| !is_name(c)).unwrap_or(rest.len());
        let (owner, rest) = rest.split_at(owner_len);
        let Some(rest) = rest.strip_prefix('/') else { continue };
        let repo_len = rest.find(|c: char| !is_name(c)).unwrap_or(rest.len());
        let (repo, rest) = rest.split_at(repo_len);
        let Some(rest) = rest.strip_prefix("/pull/") else { continue };
        let digits_len = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
        let Ok(number) = rest[..digits_len].parse::<u64>() else { continue };
        if owner.is_empty() || repo.is_empty() {
            continue;
        }
        push_pr(
            out,
            PrLink {
                number,
                url: format!("https://github.com/{owner}/{repo}/pull/{number}"),
                repo: format!("{owner}/{repo}"),
            },
        );
    }
}

fn timestamp_ms(v: &Value) -> Option<u64> {
    v["timestamp"].as_str().and_then(parse_rfc3339_ms)
}

/// Parses the UTC timestamps agents write (`2026-09-22T17:29:49.395Z`), with an
/// optional fraction and a `Z` or `+hh:mm` offset.
pub fn parse_rfc3339_ms(text: &str) -> Option<u64> {
    let b = text.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let num = |range: std::ops::Range<usize>| -> Option<i64> { text.get(range)?.parse().ok() };
    let (year, month, day) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (hour, minute, second) = (num(11..13)?, num(14..16)?, num(17..19)?);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    let mut rest = &text[19..];
    let mut millis = 0i64;
    if let Some(fraction) = rest.strip_prefix('.') {
        let digits = fraction.find(|c: char| !c.is_ascii_digit()).unwrap_or(fraction.len());
        let padded: String = fraction[..digits].chars().chain("000".chars()).take(3).collect();
        millis = padded.parse().ok()?;
        rest = &fraction[digits..];
    }
    let offset_minutes = match rest {
        "Z" | "z" => 0,
        _ if rest.len() == 6 && (rest.starts_with('+') || rest.starts_with('-')) && &rest[3..4] == ":" => {
            let sign = if rest.starts_with('-') { -1 } else { 1 };
            sign * (rest[1..3].parse::<i64>().ok()? * 60 + rest[4..6].parse::<i64>().ok()?)
        }
        _ => return None,
    };
    // Days from the civil calendar (Howard Hinnant's algorithm).
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let secs = days * 86_400 + hour * 3_600 + minute * 60 + second - offset_minutes * 60;
    u64::try_from(secs * 1_000 + millis).ok()
}

struct Cached {
    offset: u64,
    builder: DigestBuilder,
    used: u64,
}

static CACHE: Mutex<Option<HashMap<PathBuf, Cached>>> = Mutex::new(None);
static USE_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Advances the cached fold of `path` to the current end of the file and
/// returns its digest. Only complete lines are consumed; a line still being
/// written is picked up on the next call.
fn digest_file(path: &Path, agent: DigestAgent) -> std::io::Result<SessionDigest> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();

    let mut guard = CACHE.lock().unwrap_or_else(|poison| poison.into_inner());
    let cache = guard.get_or_insert_with(HashMap::new);
    let used = USE_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let entry = cache.entry(path.to_path_buf()).or_insert_with(|| Cached {
        offset: 0,
        builder: DigestBuilder::new(agent),
        used,
    });
    entry.used = used;
    if len < entry.offset {
        // Rewritten or truncated: the fold no longer describes this file.
        entry.offset = 0;
        entry.builder = DigestBuilder::new(agent);
    }

    if len > entry.offset {
        file.seek(SeekFrom::Start(entry.offset))?;
        let mut reader = BufReader::new(file.take(MAX_READ_PER_CALL));
        let mut line = Vec::new();
        loop {
            line.clear();
            let read = reader.read_until(b'\n', &mut line)?;
            if read == 0 || line.last() != Some(&b'\n') {
                break;
            }
            entry.offset += read as u64;
            if let Ok(text) = std::str::from_utf8(&line) {
                entry.builder.ingest_line(text.trim_end());
            }
        }
    }

    let mut digest = entry.builder.snapshot(now_ms());
    if digest.session_id.is_none() {
        digest.session_id = session_id_of(path, agent);
    }

    if cache.len() > CACHE_CAP {
        if let Some(oldest) = cache
            .iter()
            .min_by_key(|(_, cached)| cached.used)
            .map(|(key, _)| key.clone())
        {
            cache.remove(&oldest);
        }
    }
    Ok(digest)
}

fn session_id_of(path: &Path, agent: DigestAgent) -> Option<String> {
    let stem = path.file_stem()?.to_str()?;
    let id = match agent {
        DigestAgent::Claude => stem,
        DigestAgent::Pi => stem.rsplit_once('_').map_or(stem, |(_, id)| id),
        DigestAgent::Codex => return None,
    };
    is_safe_session_id(id).then(|| id.to_string())
}

fn newest_jsonl(dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "jsonl"))
        .filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path())))
        .max_by_key(|(modified, _)| *modified)
        .map(|(_, path)| path)
}

fn sessions_root(agent: DigestAgent) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    Some(match agent {
        DigestAgent::Claude => home.join(".claude").join("projects"),
        DigestAgent::Pi => home.join(".pi").join("agent").join("sessions"),
        DigestAgent::Codex => home.join(".codex").join("sessions"),
    })
}

/// cwd -> when it was resolved and the rollout it resolved to.
type CodexResolutions = HashMap<String, (Instant, Option<PathBuf>)>;

static CODEX_RESOLVED: Mutex<Option<CodexResolutions>> = Mutex::new(None);

/// The newest codex rollout recorded for `cwd`.
///
/// Codex mints its own ids and the restore feature already resumes it by
/// directory, so the pane is matched the same way. Only the most recent
/// rollouts are opened, and only their first line, which is `session_meta`.
fn resolve_codex(cwd: &str) -> Option<PathBuf> {
    let key = cwd.trim_end_matches('/').to_string();
    {
        let guard = CODEX_RESOLVED.lock().unwrap_or_else(|p| p.into_inner());
        if let Some((at, path)) = guard.as_ref().and_then(|map| map.get(&key)) {
            if at.elapsed() < CODEX_RESOLVE_TTL {
                return path.clone();
            }
        }
    }
    let mut files = Vec::new();
    collect_jsonl(&sessions_root(DigestAgent::Codex)?, 3, &mut files);
    files.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
    let found = files.into_iter().take(CODEX_SCAN_FILES).map(|(_, path)| path).find(|path| {
        first_line(path)
            .and_then(|line| serde_json::from_str::<Value>(&line).ok())
            .and_then(|v| v["payload"]["cwd"].as_str().map(|c| c.trim_end_matches('/') == key))
            .unwrap_or(false)
    });
    let mut guard = CODEX_RESOLVED.lock().unwrap_or_else(|p| p.into_inner());
    guard.get_or_insert_with(HashMap::new).insert(key, (Instant::now(), found.clone()));
    found
}

fn collect_jsonl(dir: &Path, depth: usize, out: &mut Vec<(std::time::SystemTime, PathBuf)>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if depth > 0 {
                collect_jsonl(&path, depth - 1, out);
            }
        } else if path.extension().is_some_and(|ext| ext == "jsonl") {
            if let Some(modified) = entry.metadata().ok().and_then(|m| m.modified().ok()) {
                out.push((modified, path));
            }
        }
    }
}

fn first_line(path: &Path) -> Option<String> {
    let mut line = String::new();
    BufReader::new(File::open(path).ok()?.take(1024 * 1024))
        .read_line(&mut line)
        .ok()?;
    Some(line)
}

/// Codex keeps thread names in an index next to its rollouts; the last line
/// for an id is its current name.
fn codex_thread_name(session_id: &str) -> Option<String> {
    let index = dirs::home_dir()?.join(".codex").join("session_index.jsonl");
    let mut text = String::new();
    File::open(index).ok()?.take(8 * 1024 * 1024).read_to_string(&mut text).ok()?;
    text.lines()
        .rev()
        .filter(|line| line.contains(session_id))
        .find_map(|line| {
            let v: Value = serde_json::from_str(line).ok()?;
            (v["id"] == session_id)
                .then(|| v["thread_name"].as_str().map(|name| clip(name, MAX_LABEL_CHARS)))
                .flatten()
        })
}

fn resolve(agent: DigestAgent, session_id: Option<&str>, cwd: Option<&str>) -> Option<PathBuf> {
    match agent {
        DigestAgent::Codex => resolve_codex(cwd?),
        DigestAgent::Claude | DigestAgent::Pi => {
            let kind = if agent == DigestAgent::Claude { AgentKind::Claude } else { AgentKind::Pi };
            let dir = cwd.and_then(|cwd| Some(sessions_root(agent)?.join(project_dir_name(cwd, kind))));
            if let Some(id) = session_id {
                // Every signal and monitor tick resolves again, so the pane's own
                // project is tried before walking every project on disk.
                if let Some(path) = dir.as_deref().and_then(|dir| session_in_dir(dir, kind, id)) {
                    return Some(path);
                }
                if let Some(path) = find_session_file(kind, id) {
                    return Some(path);
                }
            }
            // Before the pane is bound, the newest transcript for its directory
            // is the best guess, and the same one restore would pick.
            newest_jsonl(&dir?)
        }
    }
}

/// The transcript for `id` inside one project directory, named the way
/// `find_session_file` matches it.
fn session_in_dir(dir: &Path, kind: AgentKind, id: &str) -> Option<PathBuf> {
    let exact = dir.join(format!("{id}.jsonl"));
    if exact.is_file() {
        return Some(exact);
    }
    if kind != AgentKind::Pi {
        return None;
    }
    let suffix = format!("_{id}.jsonl");
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.ends_with(&suffix)))
}

#[tauri::command]
pub async fn agent_session_digest(
    agent: DigestAgent,
    session_id: Option<String>,
    cwd: Option<String>,
) -> Result<Option<SessionDigest>, String> {
    if session_id.as_deref().is_some_and(|id| !is_safe_session_id(id)) {
        return Err("unsafe session id".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = resolve(agent, session_id.as_deref(), cwd.as_deref()) else {
            return Ok(None);
        };
        let mut digest = digest_file(&path, agent).map_err(|e| e.to_string())?;
        if agent == DigestAgent::Codex && digest.name.is_none() {
            digest.name = digest.session_id.as_deref().and_then(codex_thread_name);
        }
        Ok(Some(digest))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fold(agent: DigestAgent, lines: &[&str]) -> SessionDigest {
        let mut builder = DigestBuilder::new(agent);
        for line in lines {
            builder.ingest_line(line);
        }
        builder.snapshot(parse_rfc3339_ms("2026-09-29T10:00:00Z").unwrap())
    }

    #[test]
    fn parses_the_timestamps_agents_write() {
        assert_eq!(parse_rfc3339_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_rfc3339_ms("1970-01-01T00:00:01.5Z"), Some(1_500));
        assert_eq!(parse_rfc3339_ms("2026-09-22T17:29:49.395Z"), Some(1_790_098_189_395));
        assert_eq!(parse_rfc3339_ms("2026-09-22T19:29:49.395+02:00"), Some(1_790_098_189_395));
        assert_eq!(parse_rfc3339_ms("not a date"), None);
        assert_eq!(parse_rfc3339_ms("2026-13-01T00:00:00Z"), None);
    }

    #[test]
    fn a_user_title_wins_over_the_generated_one() {
        let d = fold(DigestAgent::Claude, &[
            r#"{"type":"ai-title","aiTitle":"Pull request 116744 cambios","sessionId":"s"}"#,
            r#"{"type":"custom-title","customTitle":"PREGUNTA-INGESTRO","sessionId":"s"}"#,
            r#"{"type":"ai-title","aiTitle":"Something newer","sessionId":"s"}"#,
        ]);
        assert_eq!(d.name.as_deref(), Some("PREGUNTA-INGESTRO"));
    }

    #[test]
    fn falls_back_to_the_generated_title() {
        let d = fold(DigestAgent::Claude, &[r#"{"type":"ai-title","aiTitle":"Disk cleanup","sessionId":"s"}"#]);
        assert_eq!(d.name.as_deref(), Some("Disk cleanup"));
    }

    #[test]
    fn keeps_the_latest_recap_and_reply() {
        let d = fold(DigestAgent::Claude, &[
            r#"{"type":"assistant","isSidechain":false,"timestamp":"2026-09-28T17:00:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"first"}]}}"#,
            r#"{"type":"system","subtype":"away_summary","timestamp":"2026-09-28T17:24:41.209Z","content":"Reviewed the mock.  Next step: confirm it."}"#,
            r#"{"type":"assistant","isSidechain":false,"timestamp":"2026-09-28T17:30:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"latest reply"}]}}"#,
        ]);
        assert_eq!(d.recap.as_deref(), Some("Reviewed the mock. Next step: confirm it."));
        assert_eq!(d.last_reply.as_deref(), Some("latest reply"));
        assert!(d.last_reply_at > d.recap_at);
    }

    #[test]
    fn ignores_what_subagents_say_inside_their_sidechain() {
        let d = fold(DigestAgent::Claude, &[
            r#"{"type":"assistant","isSidechain":true,"message":{"role":"assistant","content":[{"type":"text","text":"subagent chatter"}]}}"#,
        ]);
        assert_eq!(d.last_reply, None);
    }

    #[test]
    fn collects_prs_and_artifacts_once_each() {
        let d = fold(DigestAgent::Claude, &[
            r#"{"type":"pr-link","prNumber":112955,"prUrl":"https://github.com/factorialco/factorial/pull/112955","prRepository":"factorialco/factorial"}"#,
            r#"{"type":"pr-link","prNumber":112955,"prUrl":"https://github.com/factorialco/factorial/pull/112955","prRepository":"factorialco/factorial"}"#,
            r#"{"type":"frame-link","frameUrl":"https://claude.ai/code/artifact/a5cd","title":"Purga de Disco"}"#,
            r#"{"type":"frame-link","frameUrl":"https://claude.ai/code/artifact/a5cd","title":"Purga de Disco v2"}"#,
        ]);
        assert_eq!(d.prs.len(), 1);
        assert_eq!(d.prs[0].number, 112955);
        assert_eq!(d.artifacts, vec![ArtifactLink { url: "https://claude.ai/code/artifact/a5cd".into(), title: "Purga de Disco v2".into() }]);
    }

    const MONITOR_USE: &str = r#"{"type":"assistant","timestamp":"2026-09-29T09:50:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_m","name":"Monitor","input":{"description":"PR state","timeout_ms":1800000}}]}}"#;
    const MONITOR_STARTED: &str = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_m","content":"Monitor started (task bw, expires in 30m)"}]}}"#;
    const AGENT_USE: &str = r#"{"type":"assistant","timestamp":"2026-09-29T09:55:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_a","name":"Agent","input":{"description":"Deep disk analysis","prompt":"..."}}]}}"#;
    const AGENT_LAUNCHED: &str = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_a","content":[{"type":"text","text":"Async agent launched successfully."}]}]}}"#;

    #[test]
    fn counts_the_subagents_and_monitors_still_running() {
        let d = fold(DigestAgent::Claude, &[MONITOR_USE, MONITOR_STARTED, AGENT_USE, AGENT_LAUNCHED]);
        let kinds: Vec<_> = d.tasks.iter().map(|t| t.kind).collect();
        assert_eq!(kinds, vec![TaskKind::Monitor, TaskKind::Subagent]);
        assert_eq!(d.tasks[1].label, "Deep disk analysis");
    }

    #[test]
    fn a_task_notification_closes_the_task_it_names() {
        let d = fold(DigestAgent::Claude, &[
            AGENT_USE,
            AGENT_LAUNCHED,
            r#"{"type":"queue-operation","operation":"enqueue","content":"<task-notification>\n<task-id>x</task-id>\n<tool-use-id>toolu_a</tool-use-id>\n<status>completed</status>\n</task-notification>"}"#,
        ]);
        assert!(d.tasks.is_empty());
    }

    #[test]
    fn a_non_terminal_notification_keeps_the_task_open() {
        let d = fold(DigestAgent::Claude, &[
            MONITOR_USE,
            MONITOR_STARTED,
            r#"{"type":"user","message":{"role":"user","content":"<task-notification><tool-use-id>toolu_m</tool-use-id><event>PR 1 merged</event></task-notification>"}}"#,
        ]);
        assert_eq!(d.tasks.len(), 1);
    }

    #[test]
    fn a_foreground_subagent_is_done_when_its_result_arrives() {
        let d = fold(DigestAgent::Claude, &[
            AGENT_USE,
            r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_a","content":"Here is the analysis you asked for."}]}}"#,
        ]);
        assert!(d.tasks.is_empty());
    }

    #[test]
    fn an_expired_monitor_is_no_longer_active() {
        let use_line = MONITOR_USE.replace("1800000", "60000");
        let d = fold(DigestAgent::Claude, &[&use_line, MONITOR_STARTED]);
        assert!(d.tasks.is_empty());
    }

    #[test]
    fn tracks_background_shell_commands() {
        let d = fold(DigestAgent::Claude, &[
            r#"{"type":"assistant","timestamp":"2026-09-29T09:59:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_b","name":"Bash","input":{"command":"pnpm tauri build","description":"Build the app","run_in_background":true}}]}}"#,
            r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_b","content":"Command running in background with ID: b4."}]}}"#,
        ]);
        assert_eq!(d.tasks.len(), 1);
        assert_eq!(d.tasks[0].kind, TaskKind::Background);
    }

    #[test]
    fn a_question_is_pending_until_it_is_answered() {
        let ask = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_q","name":"AskUserQuestion","input":{"questions":[{"question":"Which layout?","header":"Layout"}]}}]}}"#;
        assert_eq!(fold(DigestAgent::Claude, &[ask]).pending_question.as_deref(), Some("Which layout?"));
        let answered = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_q","content":"User chose A"}]}}"#;
        assert_eq!(fold(DigestAgent::Claude, &[ask, answered]).pending_question, None);
    }

    #[test]
    fn skips_lines_that_cannot_matter_or_cannot_parse() {
        let d = fold(DigestAgent::Claude, &[
            r#"{"type":"attachment","attachment":{}}"#,
            r#"{"type":"custom-title","customTitle":"#,
            r#"{"type":"custom-title","customTitle":"   "}"#,
        ]);
        assert_eq!(d, SessionDigest::default());
    }

    #[test]
    fn reads_the_name_recap_and_loops_of_a_pi_session() {
        let d = fold(DigestAgent::Pi, &[
            r#"{"type":"session_info","name":"SLOT-3-SIDEQUEST"}"#,
            r#"{"type":"message","timestamp":"2026-09-29T09:00:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Done with phase one."},{"type":"toolCall","id":"c1","name":"LoopCreate","arguments":{"prompt":"Check slot-4 review","trigger":"20m"}}]}}"#,
            r#"{"type":"message","message":{"role":"toolResult","toolCallId":"c1","content":[{"type":"text","text":"Loop #1 created - cron: */15 * * * *"}]}}"#,
            r#"{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","id":"c2","name":"bash","arguments":{"command":"gh pr create --fill"}}]}}"#,
            r#"{"type":"message","message":{"role":"toolResult","toolCallId":"c2","content":[{"type":"text","text":"https://github.com/Sendery/terax-ai/pull/42"}]}}"#,
        ]);
        assert_eq!(d.name.as_deref(), Some("SLOT-3-SIDEQUEST"));
        assert_eq!(d.last_reply.as_deref(), Some("Done with phase one."));
        assert_eq!(d.tasks.len(), 1);
        assert_eq!(d.tasks[0].kind, TaskKind::Loop);
        assert_eq!(d.prs[0].repo, "Sendery/terax-ai");
    }

    #[test]
    fn a_deleted_pi_loop_is_no_longer_active() {
        let d = fold(DigestAgent::Pi, &[
            r#"{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","id":"c1","name":"LoopCreate","arguments":{"prompt":"p"}}]}}"#,
            r#"{"type":"message","message":{"role":"toolResult","toolCallId":"c1","content":[{"type":"text","text":"Loop #1 created"}]}}"#,
            r#"{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","id":"c2","name":"LoopDelete","arguments":{"id":"1"}}]}}"#,
        ]);
        assert!(d.tasks.is_empty());
    }

    #[test]
    fn reads_the_recap_goal_and_question_of_a_codex_session() {
        let d = fold(DigestAgent::Codex, &[
            r#"{"type":"session_meta","payload":{"id":"01a0b4f5-0ccb","cwd":"/w"}}"#,
            r#"{"type":"event_msg","payload":{"type":"thread_goal_updated","goal":{"objective":"Pass the load test plan"}}}"#,
            r#"{"type":"response_item","payload":{"type":"function_call","name":"request_user_input_async","call_id":"k1","arguments":"{\"questions\":[{\"question\":\"Which slot?\"}]}"}}"#,
        ]);
        assert_eq!(d.session_id.as_deref(), Some("01a0b4f5-0ccb"));
        assert_eq!(d.goal.as_deref(), Some("Pass the load test plan"));
        assert_eq!(d.pending_question.as_deref(), Some("Which slot?"));

        let done = fold(DigestAgent::Codex, &[
            r#"{"type":"response_item","payload":{"type":"function_call","name":"request_user_input_async","call_id":"k1","arguments":"{}"}}"#,
            r#"{"type":"event_msg","timestamp":"2026-09-19T00:54:02.133Z","payload":{"type":"task_complete","last_agent_message":"Slot 3 tested with one user."}}"#,
        ]);
        assert_eq!(done.pending_question, None);
        assert_eq!(done.recap.as_deref(), Some("Slot 3 tested with one user."));
    }

    #[test]
    fn a_pr_the_session_only_read_is_not_its_pr() {
        let d = fold(DigestAgent::Pi, &[
            r#"{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","id":"c1","name":"bash","arguments":{"command":"gh pr view 7"}}]}}"#,
            r#"{"type":"message","message":{"role":"toolResult","toolCallId":"c1","content":[{"type":"text","text":"https://github.com/a/b/pull/7"}]}}"#,
        ]);
        assert!(d.prs.is_empty());

        let codex = fold(DigestAgent::Codex, &[
            r#"{"type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"k2","arguments":"{\"cmd\":\"gh pr create --draft\"}"}}"#,
            r#"{"type":"response_item","payload":{"type":"function_call_output","call_id":"k2","output":"https://github.com/a/b/pull/9"}}"#,
        ]);
        assert_eq!(codex.prs.iter().map(|p| p.number).collect::<Vec<_>>(), vec![9]);
    }

    #[test]
    fn closes_a_task_whose_notification_arrives_as_a_queued_command() {
        let d = fold(DigestAgent::Claude, &[
            AGENT_USE,
            AGENT_LAUNCHED,
            r#"{"type":"attachment","attachment":{"type":"queued_command","prompt":"<task-notification> <task-id>a4</task-id> <tool-use-id>toolu_a</tool-use-id> <status>completed</status> </task-notification>"}}"#,
        ]);
        assert!(d.tasks.is_empty());
    }

    #[test]
    fn keeps_the_newest_links_once_the_list_is_full() {
        let mut prs = Vec::new();
        for n in 1..=(MAX_LINKS as u64 + 3) {
            scan_pr_links(&format!("https://github.com/a/b/pull/{n}"), &mut prs);
        }
        assert_eq!(prs.len(), MAX_LINKS);
        assert_eq!(prs.last().unwrap().number, MAX_LINKS as u64 + 3);
        assert_eq!(prs.first().unwrap().number, 4);
    }

    #[test]
    fn finds_pr_links_in_free_text_without_false_positives() {
        let mut prs = Vec::new();
        scan_pr_links(
            "see https://github.com/a/b/pull/7, https://github.com/a/b/issues/8 and github.com/org/repo.name/pull/12)",
            &mut prs,
        );
        let urls: Vec<_> = prs.iter().map(|p| p.url.as_str()).collect();
        assert_eq!(urls, vec!["https://github.com/a/b/pull/7", "https://github.com/org/repo.name/pull/12"]);
    }

    #[test]
    fn clips_on_a_character_boundary() {
        assert_eq!(clip("ñandú ñandú", 6), "ñandú\u{2026}");
        assert_eq!(clip("  a \n b  ", 10), "a b");
    }

    #[test]
    fn reading_is_incremental_and_ignores_a_line_still_being_written() {
        let dir = std::env::temp_dir().join(format!("terax-digest-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("0000-incremental.jsonl");
        std::fs::write(&path, "{\"type\":\"ai-title\",\"aiTitle\":\"One\"}\n{\"type\":\"custom-title\",\"customTitle\":\"Tw").unwrap();
        assert_eq!(digest_file(&path, DigestAgent::Claude).unwrap().name.as_deref(), Some("One"));

        let mut file = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        std::io::Write::write_all(&mut file, b"o\"}\n").unwrap();
        assert_eq!(digest_file(&path, DigestAgent::Claude).unwrap().name.as_deref(), Some("Two"));

        std::fs::write(&path, "{\"type\":\"ai-title\",\"aiTitle\":\"Fresh\"}\n").unwrap();
        assert_eq!(digest_file(&path, DigestAgent::Claude).unwrap().name.as_deref(), Some("Fresh"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn finds_a_session_in_its_project_directory_by_each_agents_naming() {
        let dir = std::env::temp_dir().join(format!("terax-digest-dir-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("abc.jsonl"), "").unwrap();
        std::fs::write(dir.join("2026-09-29T10-00-00-000Z_def.jsonl"), "").unwrap();

        assert_eq!(session_in_dir(&dir, AgentKind::Claude, "abc"), Some(dir.join("abc.jsonl")));
        assert_eq!(session_in_dir(&dir, AgentKind::Claude, "def"), None);
        assert_eq!(
            session_in_dir(&dir, AgentKind::Pi, "def"),
            Some(dir.join("2026-09-29T10-00-00-000Z_def.jsonl"))
        );
        assert_eq!(session_in_dir(&dir, AgentKind::Pi, "missing"), None);
        std::fs::remove_dir_all(&dir).ok();
    }
}

