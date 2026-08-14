//! Read-only reader for agent session transcripts, shared by pi and Claude Code.
//!
//! Complements `pisessions`, which measures token usage for scheduled runs. This
//! module feeds the session-graph panel instead: it locates a transcript from an
//! agent + session id and streams it back in a form the webview can lay out.
//!
//! Two deliberate constraints:
//!
//! 1. The webview never supplies a path. It supplies an agent and a session id
//!    that must match a conservative character set, and resolution happens
//!    inside that agent's own sessions directory only. Nothing here writes.
//!
//! 2. Entry payloads are truncated before they cross the IPC boundary. Observed
//!    real transcripts reach 3.4 MB across only 272 entries, because a single
//!    tool result can carry megabytes. The panel renders a 160-character
//!    preview per row, so shipping full bodies would waste three orders of
//!    magnitude of bandwidth. Truncation preserves JSON *shape*, so the
//!    TypeScript parser stays the single source of semantics.

use std::fs::File;
use std::io::{BufRead, BufReader, Read as _, Seek, SeekFrom};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Longest string kept inside an entry. The UI previews 160 characters; the
/// headroom keeps tool names and short bodies intact.
const MAX_STRING_CHARS: usize = 240;

/// Top-level fields the webview parser actually reads, across both agents.
///
/// Everything else is dropped in transport. Truncating strings alone was not
/// enough: it reduced a real 320 MB corpus only to 111 MB, because the weight
/// sits in fields nothing renders — reasoning bodies, tool-call arguments and
/// `toolUseResult` structures.
const KEPT_FIELDS: &[&str] = &[
    // identity and tree shape
    "type",
    "id",
    "parentId",
    "uuid",
    "parentUuid",
    "timestamp",
    "sessionId",
    "cwd",
    "version",
    "parentSession",
    "isSidechain",
    // rendered payloads
    "message",
    "content",
    "customType",
    "display",
    "summary",
    "firstKeptEntryId",
    "tokensBefore",
    "fromId",
    "provider",
    "modelId",
    "thinkingLevel",
    "name",
    "targetId",
    "label",
    // claude code-restore bookkeeping
    "messageId",
    "trackingPath",
    "snapshot",
];

/// Entry types that carry no rendered payload. They are still real tree nodes,
/// so a stub keeps their id and parent link: dropping them outright would
/// orphan their children and shatter the tree.
const STUB_ONLY_TYPES: &[&str] = &[
    "ai-title",
    "custom-title",
    "mode",
    "permission-mode",
    "last-prompt",
    "queue-operation",
    "frame-link",
    "pr-link",
    "attachment",
    "system",
    "custom",
];

/// Ceiling on a single response so a huge transcript cannot exhaust memory.
const MAX_SLICE_BYTES: u64 = 24 * 1024 * 1024;

/// Bounds one line, matching the guard in `pisessions`.
const MAX_LINE_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentKind {
    Pi,
    Claude,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSlice {
    /// Reduced JSONL: same shape as on disk, long strings truncated.
    pub jsonl: String,
    /// Byte offset to resume from, for following a live transcript.
    pub next_offset: u64,
    pub total_bytes: u64,
    /// True when the slice stopped at the size ceiling rather than at EOF.
    pub truncated: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionInfo {
    pub id: String,
    pub agent: AgentKind,
    pub cwd: Option<String>,
    pub modified_ms: u64,
    pub size_bytes: u64,
    /// Session this one was forked from, as an id rather than a path.
    pub parent_session_id: Option<String>,
}

/// Session ids may only contain characters both CLIs accept, so a crafted id
/// cannot escape the sessions directory.
pub fn is_safe_session_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn sessions_root(agent: AgentKind) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    Some(match agent {
        AgentKind::Pi => home.join(".pi").join("agent").join("sessions"),
        AgentKind::Claude => home.join(".claude").join("projects"),
    })
}

/// Each agent derives its project directory from the cwd differently, and the
/// two are not interchangeable:
///
/// ```text
/// /Users/ana.ruiz/code   pi      --Users-ana.ruiz-code--   dots kept
/// /Users/ana.ruiz/code   claude  -Users-ana-ruiz-code      dots collapsed
/// ```
///
/// Claude's form is lossy, so it is only ever used to *find* candidates, never
/// to reconstruct a path.
pub fn project_dir_name(cwd: &str, agent: AgentKind) -> String {
    let trimmed = cwd.trim_end_matches(['/', '\\']);
    match agent {
        AgentKind::Pi => {
            let body: String = trimmed
                .trim_start_matches(['/', '\\'])
                .chars()
                .map(|c| if matches!(c, '/' | '\\' | ':') { '-' } else { c })
                .collect();
            format!("--{body}--")
        }
        AgentKind::Claude => trimmed
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect(),
    }
}

/// Derives the session id from a transcript file name.
///
/// pi writes `<timestamp>_<id>.jsonl`; Claude writes `<uuid>.jsonl`.
fn session_id_from_name(name: &str, agent: AgentKind) -> Option<String> {
    let stem = name.strip_suffix(".jsonl")?;
    if stem.is_empty() {
        return None;
    }
    Some(match agent {
        AgentKind::Claude => stem.to_string(),
        AgentKind::Pi => match stem.rsplit_once('_') {
            Some((_, id)) => id.to_string(),
            None => stem.to_string(),
        },
    })
}

fn modified_ms(metadata: &std::fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Reads the header facts of a transcript: the cwd it belongs to and the
/// session it was forked from. pi records both on the header line, Claude
/// repeats the cwd on every entry, so the first line answers both.
fn read_header(path: &std::path::Path, agent: AgentKind) -> (Option<String>, Option<String>) {
    let Ok(file) = File::open(path) else {
        return (None, None);
    };
    let mut first = String::new();
    if BufReader::new(file.take(MAX_LINE_BYTES))
        .read_line(&mut first)
        .is_err()
    {
        return (None, None);
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&first) else {
        return (None, None);
    };

    let cwd = value["cwd"].as_str().map(|s| s.to_string());
    // `parentSession` is an absolute path; the webview only ever handles ids, so
    // it is reduced to one here.
    let parent = value["parentSession"]
        .as_str()
        .and_then(|p| std::path::Path::new(p).file_name()?.to_str().map(String::from))
        .and_then(|name| session_id_from_name(&name, agent))
        .filter(|id| is_safe_session_id(id));

    (cwd, parent)
}

fn find_session_file(agent: AgentKind, session_id: &str) -> Option<PathBuf> {
    let root = sessions_root(agent)?;
    let exact = format!("{session_id}.jsonl");
    let suffix = format!("_{session_id}.jsonl");

    for project in std::fs::read_dir(root).ok()?.flatten() {
        let dir = project.path();
        if !dir.is_dir() {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if name == exact || (agent == AgentKind::Pi && name.ends_with(&suffix)) {
                return Some(path);
            }
        }
    }
    None
}

/// Collapses whitespace runs, then truncates.
///
/// The webview collapses whitespace before previewing, so doing it here first is
/// semantically identical and strictly better: truncating raw text meant a
/// whitespace-heavy body lost trailing preview characters once collapsed (57
/// previews drifted across a real corpus), and the removed whitespace also
/// shrinks the payload.
fn truncate(text: &str) -> serde_json::Value {
    let mut collapsed = String::with_capacity(text.len().min(MAX_STRING_CHARS * 4));
    let mut in_space = false;
    let mut kept = 0usize;
    let mut overflowed = false;

    for ch in text.chars() {
        if ch.is_whitespace() {
            in_space = true;
            continue;
        }
        // Leading whitespace is dropped, interior runs become one space.
        if in_space && kept > 0 {
            if kept >= MAX_STRING_CHARS {
                overflowed = true;
                break;
            }
            collapsed.push(' ');
            kept += 1;
        }
        in_space = false;
        if kept >= MAX_STRING_CHARS {
            overflowed = true;
            break;
        }
        collapsed.push(ch);
        kept += 1;
    }

    if overflowed {
        collapsed.push('…');
    }
    serde_json::Value::String(collapsed)
}

/// Projects one content block down to what the row renderer needs: the block
/// type, a tool name, and a short text preview.
///
/// Reasoning bodies and tool-call arguments are dropped entirely — the parser
/// never previews them — but the block itself is kept so block counts and
/// ordering stay faithful.
fn project_block(block: &serde_json::Value) -> serde_json::Value {
    let mut out = serde_json::Map::new();
    if let Some(kind) = block.get("type").and_then(|v| v.as_str()) {
        out.insert("type".into(), serde_json::Value::String(kind.into()));
    }
    for field in ["name", "toolName"] {
        if let Some(name) = block.get(field).and_then(|v| v.as_str()) {
            out.insert(field.into(), serde_json::Value::String(name.into()));
        }
    }
    if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
        out.insert("text".into(), truncate(text));
    }
    // A claude tool_result carries its body under `content`, sometimes a bare
    // string. Keep a preview so the row is not blank.
    if let Some(text) = block.get("content").and_then(|v| v.as_str()) {
        out.insert("content".into(), truncate(text));
    }
    serde_json::Value::Object(out)
}

fn project_content(content: &serde_json::Value) -> serde_json::Value {
    match content {
        serde_json::Value::String(text) => truncate(text),
        serde_json::Value::Array(blocks) => {
            serde_json::Value::Array(blocks.iter().map(project_block).collect())
        }
        _ => serde_json::Value::Null,
    }
}

/// Keeps only the tracked file *paths*, discarding backup metadata. The panel
/// lists which files a restore point covers; versions and hashes are re-read
/// from disk when a restore actually runs.
fn project_snapshot(snapshot: &serde_json::Value) -> serde_json::Value {
    let mut out = serde_json::Map::new();
    if let Some(message_id) = snapshot.get("messageId").and_then(|v| v.as_str()) {
        out.insert("messageId".into(), serde_json::Value::String(message_id.into()));
    }
    if let Some(backups) = snapshot.get("trackedFileBackups").and_then(|v| v.as_object()) {
        let paths = backups
            .keys()
            .map(|path| (path.clone(), serde_json::Value::Object(Default::default())))
            .collect::<serde_json::Map<_, _>>();
        out.insert("trackedFileBackups".into(), serde_json::Value::Object(paths));
    }
    serde_json::Value::Object(out)
}

/// Emits the id, parent link and timestamp of an entry and nothing else.
fn stub_entry(raw: &serde_json::Map<String, serde_json::Value>) -> serde_json::Value {
    let mut out = serde_json::Map::new();
    for field in ["type", "id", "parentId", "uuid", "parentUuid", "timestamp"] {
        if let Some(value) = raw.get(field) {
            out.insert(field.into(), value.clone());
        }
    }
    serde_json::Value::Object(out)
}

fn project_entry(raw: &serde_json::Map<String, serde_json::Value>) -> serde_json::Value {
    let kind = raw.get("type").and_then(|v| v.as_str()).unwrap_or_default();
    if STUB_ONLY_TYPES.contains(&kind) {
        return stub_entry(raw);
    }

    let mut out = serde_json::Map::new();
    for (key, value) in raw {
        if !KEPT_FIELDS.contains(&key.as_str()) {
            continue;
        }
        let projected = match key.as_str() {
            "message" => {
                // Keep the role and the projected content; drop usage, ids and
                // provider bookkeeping the panel never shows.
                let mut message = serde_json::Map::new();
                if let Some(role) = value.get("role").and_then(|v| v.as_str()) {
                    message.insert("role".into(), serde_json::Value::String(role.into()));
                }
                if let Some(content) = value.get("content") {
                    message.insert("content".into(), project_content(content));
                }
                serde_json::Value::Object(message)
            }
            "content" => project_content(value),
            "snapshot" => project_snapshot(value),
            "summary" => match value.as_str() {
                Some(text) => truncate(text),
                None => value.clone(),
            },
            _ => value.clone(),
        };
        out.insert(key.clone(), projected);
    }
    serde_json::Value::Object(out)
}

/// Reduces a transcript slice for transport: projects each entry down to the
/// fields the webview renders. A corrupt or partially written line is dropped
/// rather than failing the read, because the file is appended to while an agent
/// runs.
pub fn reduce_jsonl(reader: impl BufRead) -> String {
    let mut out = String::new();
    for line in reader.lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        let Some(raw) = value.as_object() else {
            continue;
        };
        let Ok(encoded) = serde_json::to_string(&project_entry(raw)) else {
            continue;
        };
        out.push_str(&encoded);
        out.push('\n');
    }
    out
}

/// Streams a transcript from `from_offset`, reduced for transport.
///
/// `from_offset` must sit on a line boundary; pass the `next_offset` of the
/// previous call to follow a live transcript.
#[tauri::command]
pub fn agent_session_read(
    agent: AgentKind,
    session_id: String,
    from_offset: u64,
) -> Result<SessionSlice, String> {
    if !is_safe_session_id(&session_id) {
        return Err("Invalid session id".to_string());
    }
    let Some(path) = find_session_file(agent, &session_id) else {
        return Err("Session not found".to_string());
    };

    let mut file = File::open(&path).map_err(|e| e.to_string())?;
    let total_bytes = file.metadata().map_err(|e| e.to_string())?.len();
    // A rewritten (shorter) file invalidates the caller's offset; restart.
    let start = if from_offset > total_bytes { 0 } else { from_offset };
    file.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;

    let budget = total_bytes.saturating_sub(start).min(MAX_SLICE_BYTES);
    let truncated = total_bytes.saturating_sub(start) > budget;
    let jsonl = reduce_jsonl(BufReader::new(file.take(budget)));

    Ok(SessionSlice {
        jsonl,
        next_offset: start.saturating_add(budget),
        total_bytes,
        truncated,
    })
}

/// Lists transcripts for one agent, newest first, optionally limited to the
/// project directory a cwd maps to.
#[tauri::command]
pub fn agent_sessions_list(
    agent: AgentKind,
    cwd: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<AgentSessionInfo>, String> {
    let Some(root) = sessions_root(agent) else {
        return Ok(Vec::new());
    };
    let wanted_dir = cwd.as_deref().map(|c| project_dir_name(c, agent));

    let Ok(projects) = std::fs::read_dir(root) else {
        return Ok(Vec::new());
    };

    let mut out = Vec::new();
    for project in projects.flatten() {
        let dir = project.path();
        if !dir.is_dir() {
            continue;
        }
        if let Some(wanted) = wanted_dir.as_deref() {
            let matches = dir
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|name| name == wanted);
            if !matches {
                continue;
            }
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if !name.ends_with(".jsonl") {
                continue;
            }
            let Some(id) = session_id_from_name(name, agent) else {
                continue;
            };
            if !is_safe_session_id(&id) {
                continue;
            }
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            let (cwd, parent_session_id) = read_header(&path, agent);
            out.push(AgentSessionInfo {
                id,
                agent,
                cwd,
                modified_ms: modified_ms(&metadata),
                size_bytes: metadata.len(),
                parent_session_id,
            });
        }
    }

    out.sort_by_key(|info| std::cmp::Reverse(info.modified_ms));
    out.truncate(limit.unwrap_or(50).min(500));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn encodes_the_project_directory_the_way_each_agent_does() {
        // Verified against real directories: pi keeps dots, claude collapses them.
        assert_eq!(
            project_dir_name("/Users/ana.ruiz/Workspaces/terax-ai", AgentKind::Pi),
            "--Users-ana.ruiz-Workspaces-terax-ai--"
        );
        assert_eq!(
            project_dir_name("/Users/ana.ruiz/code/agents-pool", AgentKind::Claude),
            "-Users-ana-ruiz-code-agents-pool"
        );
    }

    #[test]
    fn ignores_a_trailing_separator_so_both_forms_of_a_cwd_agree() {
        assert_eq!(
            project_dir_name("/private/tmp/", AgentKind::Pi),
            project_dir_name("/private/tmp", AgentKind::Pi)
        );
        assert_eq!(
            project_dir_name("/private/tmp/", AgentKind::Claude),
            project_dir_name("/private/tmp", AgentKind::Claude)
        );
    }

    #[test]
    fn rejects_ids_that_could_escape_the_sessions_directory() {
        for id in [
            "",
            "../secrets",
            "a/b",
            "a\\b",
            "a.jsonl",
            "with space",
            "tilde~",
            "$HOME",
        ] {
            assert!(!is_safe_session_id(id), "{id} must be rejected");
        }
        assert!(!is_safe_session_id(&"x".repeat(129)));
        assert!(is_safe_session_id("019fc4f0-9d22-71c6-a161-ec17c05eb692"));
        assert!(is_safe_session_id("terax-st-abc_1"));
    }

    #[test]
    fn refuses_an_unsafe_id_before_touching_the_filesystem() {
        assert!(agent_session_read(AgentKind::Pi, "../../etc/passwd".into(), 0).is_err());
        assert!(agent_session_read(AgentKind::Claude, "a/b".into(), 0).is_err());
    }

    #[test]
    fn derives_the_session_id_from_each_agents_file_name() {
        assert_eq!(
            session_id_from_name("2026-08-03T00-05-31-043Z_019fc4f0-9d22.jsonl", AgentKind::Pi)
                .as_deref(),
            Some("019fc4f0-9d22")
        );
        assert_eq!(
            session_id_from_name("heartbeat.jsonl", AgentKind::Pi).as_deref(),
            Some("heartbeat")
        );
        // A claude uuid contains no underscore, and must survive verbatim.
        assert_eq!(
            session_id_from_name("de6eef26-ec8e-4957-9900-2a1a46090fef.jsonl", AgentKind::Claude)
                .as_deref(),
            Some("de6eef26-ec8e-4957-9900-2a1a46090fef")
        );
        assert!(session_id_from_name("notes.txt", AgentKind::Pi).is_none());
        assert!(session_id_from_name(".jsonl", AgentKind::Pi).is_none());
    }

    #[test]
    fn truncates_long_payloads_but_keeps_the_entry_shape() {
        let body = "x".repeat(5000);
        let jsonl = format!(
            r#"{{"type":"message","id":"a1","parentId":null,"message":{{"role":"toolResult","content":[{{"type":"text","text":"{body}"}}]}}}}"#
        );

        let reduced = reduce_jsonl(Cursor::new(jsonl));
        let value: serde_json::Value = serde_json::from_str(reduced.trim()).unwrap();

        assert_eq!(value["type"], "message");
        assert_eq!(value["id"], "a1");
        assert_eq!(value["parentId"], serde_json::Value::Null);
        assert_eq!(value["message"]["role"], "toolResult");
        assert_eq!(value["message"]["content"][0]["type"], "text");
        let text = value["message"]["content"][0]["text"].as_str().unwrap();
        assert_eq!(text.chars().count(), MAX_STRING_CHARS + 1, "kept preview + ellipsis");
        assert!(reduced.len() < 1000, "payload must shrink, got {}", reduced.len());
    }

    #[test]
    fn collapses_whitespace_so_the_preview_matches_what_the_webview_computes() {
        let jsonl = r#"{"type":"message","id":"a1","parentId":null,"message":{"role":"user","content":[{"type":"text","text":"  add   a\n\n\tpanel  "}]}}"#;

        let reduced = reduce_jsonl(Cursor::new(jsonl));
        let value: serde_json::Value = serde_json::from_str(reduced.trim()).unwrap();

        assert_eq!(value["message"]["content"][0]["text"], "add a panel");
    }

    #[test]
    fn counts_the_budget_after_collapsing_not_before() {
        // Whitespace-heavy text must still yield a full-length preview, which is
        // what truncating raw text got wrong.
        let spaced = "ab ".repeat(400);
        let jsonl = format!(
            r#"{{"type":"message","id":"a1","parentId":null,"message":{{"role":"user","content":[{{"type":"text","text":"{spaced}"}}]}}}}"#
        );

        let reduced = reduce_jsonl(Cursor::new(jsonl));
        let value: serde_json::Value = serde_json::from_str(reduced.trim()).unwrap();
        let text = value["message"]["content"][0]["text"].as_str().unwrap();

        assert_eq!(text.chars().count(), MAX_STRING_CHARS + 1);
        assert!(!text.contains("  "), "no double spaces survive");
    }

    #[test]
    fn drops_reasoning_bodies_and_tool_arguments_but_keeps_the_block_shape() {
        let thinking = "t".repeat(20_000);
        let args = "a".repeat(20_000);
        let jsonl = format!(
            r#"{{"type":"message","id":"a1","parentId":null,"message":{{"role":"assistant","content":[{{"type":"thinking","thinking":"{thinking}"}},{{"type":"text","text":"on it"}},{{"type":"toolCall","name":"read","args":{{"path":"{args}"}}}}]}}}}"#
        );

        let reduced = reduce_jsonl(Cursor::new(jsonl));
        let value: serde_json::Value = serde_json::from_str(reduced.trim()).unwrap();
        let content = value["message"]["content"].as_array().unwrap();

        // Order and block count must survive, so previews stay faithful.
        assert_eq!(content.len(), 3);
        assert_eq!(content[0]["type"], "thinking");
        assert!(content[0].get("thinking").is_none(), "reasoning body dropped");
        assert_eq!(content[1]["text"], "on it");
        assert_eq!(content[2]["name"], "read");
        assert!(content[2].get("args").is_none(), "tool arguments dropped");
        assert!(reduced.len() < 300, "got {}", reduced.len());
    }

    #[test]
    fn keeps_the_tree_link_of_entries_that_carry_no_payload() {
        // These types are real tree nodes. Dropping them outright would orphan
        // their children and shatter one conversation into false roots, so a
        // stub must still carry id, parent and timestamp.
        let jsonl = r#"{"type":"system","uuid":"x2","parentUuid":"x1","timestamp":"2026-07-17T11:44:38.000Z","content":"a very long system notice","toolUseResult":{"big":true}}"#;

        let reduced = reduce_jsonl(Cursor::new(jsonl));
        let value: serde_json::Value = serde_json::from_str(reduced.trim()).unwrap();

        assert_eq!(value["uuid"], "x2");
        assert_eq!(value["parentUuid"], "x1");
        assert_eq!(value["type"], "system");
        assert!(value.get("content").is_none());
        assert!(value.get("toolUseResult").is_none());
    }

    #[test]
    fn drops_fields_no_row_renders() {
        let jsonl = r#"{"type":"assistant","uuid":"u1","parentUuid":null,"requestId":"req_1","promptId":"p1","effort":"high","toolUseResult":{"stdout":"lots"},"message":{"role":"assistant","usage":{"input":10},"content":[]}}"#;

        let reduced = reduce_jsonl(Cursor::new(jsonl));
        let value: serde_json::Value = serde_json::from_str(reduced.trim()).unwrap();

        for dropped in ["requestId", "promptId", "effort", "toolUseResult"] {
            assert!(value.get(dropped).is_none(), "{dropped} must not cross IPC");
        }
        assert!(value["message"].get("usage").is_none());
        assert_eq!(value["message"]["role"], "assistant");
    }

    #[test]
    fn keeps_a_bare_string_tool_result_as_a_preview() {
        let body = "r".repeat(9000);
        let jsonl = format!(
            r#"{{"type":"user","uuid":"u3","parentUuid":"u2","message":{{"role":"user","content":[{{"type":"tool_result","content":"{body}"}}]}}}}"#
        );

        let reduced = reduce_jsonl(Cursor::new(jsonl));
        let value: serde_json::Value = serde_json::from_str(reduced.trim()).unwrap();
        let block = &value["message"]["content"][0];

        assert_eq!(block["type"], "tool_result");
        assert_eq!(
            block["content"].as_str().unwrap().chars().count(),
            MAX_STRING_CHARS + 1
        );
    }

    #[test]
    fn leaves_short_strings_and_numbers_untouched() {
        let jsonl = r#"{"type":"compaction","id":"d1","parentId":null,"summary":"short","firstKeptEntryId":"x9","tokensBefore":530692}"#;

        let reduced = reduce_jsonl(Cursor::new(jsonl));
        let value: serde_json::Value = serde_json::from_str(reduced.trim()).unwrap();

        assert_eq!(value["summary"], "short");
        assert_eq!(value["firstKeptEntryId"], "x9");
        assert_eq!(value["tokensBefore"], 530692);
    }

    #[test]
    fn preserves_object_keys_that_carry_meaning() {
        // Claude keys trackedFileBackups by file path; truncating keys would
        // corrupt the restore target.
        let path = format!("packages/{}/a.ts", "deep/".repeat(120));
        let jsonl = format!(
            r#"{{"type":"file-history-snapshot","messageId":"u1","snapshot":{{"messageId":"u1","trackedFileBackups":{{"{path}":{{"version":2}}}}}}}}"#
        );

        let reduced = reduce_jsonl(Cursor::new(jsonl));
        let value: serde_json::Value = serde_json::from_str(reduced.trim()).unwrap();

        assert!(value["snapshot"]["trackedFileBackups"][&path].is_object());
        assert_eq!(value["messageId"], "u1");
    }

    #[test]
    fn skips_corrupt_lines_and_a_partially_written_tail() {
        let jsonl = "{\"type\":\"model_change\",\"id\":\"a1\"}\n\
             not json at all\n\
             \n\
             {\"type\":\"message\",\"id\":\"a2\"}\n\
             {\"type\":\"message\",\"id\":\"a3\",\"messa";

        let reduced = reduce_jsonl(Cursor::new(jsonl));

        let ids: Vec<String> = reduced
            .lines()
            .map(|l| serde_json::from_str::<serde_json::Value>(l).unwrap()["id"].to_string())
            .collect();
        assert_eq!(ids, vec!["\"a1\"", "\"a2\""]);
    }

    #[test]
    fn reduces_a_fork_pointer_to_a_session_id() {
        // pi records `parentSession` as an absolute path. The webview only ever
        // handles ids, so the path must never cross the boundary.
        let dir = std::env::temp_dir().join(format!("terax-fork-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("2026-07-29T10-44-07-994Z_019fad79-7cba.jsonl");
        std::fs::write(
            &path,
            "{\"type\":\"session\",\"version\":3,\"id\":\"019fad79-7cba\",\"cwd\":\"/w\",\"parentSession\":\"/home/ana/.pi/agent/sessions/--w--/2026-07-27T00-29-02-232Z_019fa0f9-9d22.jsonl\"}\n",
        )
        .unwrap();

        let (cwd, parent) = read_header(&path, AgentKind::Pi);

        assert_eq!(cwd.as_deref(), Some("/w"));
        assert_eq!(parent.as_deref(), Some("019fa0f9-9d22"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn refuses_a_fork_pointer_that_is_not_a_safe_id() {
        let dir = std::env::temp_dir().join(format!("terax-fork-bad-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.jsonl");
        // A crafted header must not smuggle a traversal through the fork link.
        std::fs::write(
            &path,
            "{\"type\":\"session\",\"id\":\"s\",\"cwd\":\"/w\",\"parentSession\":\"/etc/pa sswd\"}\n",
        )
        .unwrap();

        let (_, parent) = read_header(&path, AgentKind::Pi);

        assert_eq!(parent, None);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reports_no_fork_pointer_when_the_session_is_a_root() {
        let dir = std::env::temp_dir().join(format!("terax-fork-root-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.jsonl");
        std::fs::write(&path, "{\"type\":\"session\",\"id\":\"s\",\"cwd\":\"/w\"}\n").unwrap();

        let (cwd, parent) = read_header(&path, AgentKind::Pi);

        assert_eq!(cwd.as_deref(), Some("/w"));
        assert_eq!(parent, None);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reports_an_empty_slice_for_empty_input() {
        assert_eq!(reduce_jsonl(Cursor::new("")), "");
    }

    #[test]
    fn reports_a_missing_session_instead_of_an_empty_transcript() {
        // A silent empty read would look like "session with no history", which
        // hides a resolution bug from the panel.
        let result = agent_session_read(AgentKind::Pi, "definitely-not-a-session-xyz".into(), 0);

        assert!(result.is_err());
    }
}
