//! Read-only view over the Pi CLI's own session store, used by scheduled tasks
//! to report what a run cost and to offer existing sessions to wake.
//!
//! Deliberately narrow: the webview never supplies a path. It supplies a session
//! id that must match a conservative character set, and this module resolves it
//! inside the Pi sessions directory only. Nothing here writes.

use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde::Serialize;

/// Bounds a single line so a corrupt or hostile session file cannot make the
/// reader allocate without limit.
const MAX_LINE_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Default, Clone, Copy, Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionUsage {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub reasoning: u64,
    pub total_tokens: u64,
    pub cost_total: f64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionUsageReport {
    pub usage: SessionUsage,
    pub next_offset: u64,
    pub assistant_messages: u64,
    pub stop_reason: Option<String>,
    pub model: Option<String>,
    pub path: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub cwd: Option<String>,
    pub path: String,
    pub modified_ms: u64,
    pub size_bytes: u64,
}

/// A session id may only contain characters the Pi CLI itself accepts in
/// `--session-id`. Anything else could escape the sessions directory.
pub fn is_safe_session_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn sessions_root() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(".pi").join("agent").join("sessions"))
}

/// Accumulates the `usage` blocks a slice of session JSONL carries. Unknown or
/// malformed lines are skipped rather than failing the whole read: the file is
/// appended to live and the tail can be a partial line.
pub fn accumulate_usage(reader: impl BufRead) -> (SessionUsage, u64, Option<String>, Option<String>) {
    let mut usage = SessionUsage::default();
    let mut messages = 0_u64;
    let mut stop_reason = None;
    let mut model = None;

    for line in reader.lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        let message = &value["message"];
        let block = &message["usage"];
        if !block.is_object() {
            continue;
        }
        messages += 1;
        usage.input += block["input"].as_u64().unwrap_or(0);
        usage.output += block["output"].as_u64().unwrap_or(0);
        usage.cache_read += block["cacheRead"].as_u64().unwrap_or(0);
        usage.cache_write += block["cacheWrite"].as_u64().unwrap_or(0);
        usage.reasoning += block["reasoning"].as_u64().unwrap_or(0);
        usage.total_tokens += block["totalTokens"].as_u64().unwrap_or(0);
        usage.cost_total += block["cost"]["total"].as_f64().unwrap_or(0.0);
        if let Some(reason) = message["stopReason"].as_str() {
            stop_reason = Some(reason.to_string());
        }
        if let Some(name) = message["model"].as_str() {
            model = Some(name.to_string());
        }
    }

    (usage, messages, stop_reason, model)
}

fn find_session_file(id: &str) -> Option<PathBuf> {
    let root = sessions_root()?;
    let suffix = format!("_{id}.jsonl");
    let exact = format!("{id}.jsonl");
    for project in std::fs::read_dir(root).ok()?.flatten() {
        let dir = project.path();
        if !dir.is_dir() {
            continue;
        }
        for entry in std::fs::read_dir(&dir).ok()?.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if name.ends_with(&suffix) || name == exact {
                return Some(path);
            }
        }
    }
    None
}

fn read_header_cwd(path: &Path) -> Option<String> {
    let file = File::open(path).ok()?;
    let mut first = String::new();
    BufReader::new(file).read_line(&mut first).ok()?;
    let value = serde_json::from_str::<serde_json::Value>(&first).ok()?;
    value["cwd"].as_str().map(|s| s.to_string())
}

fn session_id_from_name(name: &str) -> Option<String> {
    let stem = name.strip_suffix(".jsonl")?;
    Some(match stem.rsplit_once('_') {
        Some((_, id)) => id.to_string(),
        None => stem.to_string(),
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

/// Byte length of a session file, used as the "before" mark of a run so the
/// tokens a single trigger spent can be measured without instrumenting pi.
#[tauri::command]
pub fn pi_session_offset(session_id: String) -> Result<u64, String> {
    if !is_safe_session_id(&session_id) {
        return Err("Invalid session id".to_string());
    }
    let Some(path) = find_session_file(&session_id) else {
        return Ok(0);
    };
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    Ok(metadata.len())
}

#[tauri::command]
pub fn pi_session_usage(session_id: String, from_offset: u64) -> Result<SessionUsageReport, String> {
    if !is_safe_session_id(&session_id) {
        return Err("Invalid session id".to_string());
    }
    let Some(path) = find_session_file(&session_id) else {
        return Ok(SessionUsageReport {
            usage: SessionUsage::default(),
            next_offset: from_offset,
            assistant_messages: 0,
            stop_reason: None,
            model: None,
            path: None,
        });
    };
    let mut file = File::open(&path).map_err(|e| e.to_string())?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    let start = from_offset.min(len);
    file.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file.take(MAX_LINE_BYTES.saturating_mul(4096)));
    let (usage, assistant_messages, stop_reason, model) = accumulate_usage(reader);
    Ok(SessionUsageReport {
        usage,
        next_offset: len,
        assistant_messages,
        stop_reason,
        model,
        path: Some(path.to_string_lossy().to_string()),
    })
}

#[tauri::command]
pub fn pi_sessions_list(limit: Option<usize>) -> Result<Vec<SessionInfo>, String> {
    let Some(root) = sessions_root() else {
        return Ok(Vec::new());
    };
    let Ok(projects) = std::fs::read_dir(root) else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for project in projects.flatten() {
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
            if !name.ends_with(".jsonl") {
                continue;
            }
            let Some(id) = session_id_from_name(name) else {
                continue;
            };
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            out.push(SessionInfo {
                id,
                cwd: read_header_cwd(&path),
                path: path.to_string_lossy().to_string(),
                modified_ms: modified_ms(&metadata),
                size_bytes: metadata.len(),
            });
        }
    }
    out.sort_by_key(|info| std::cmp::Reverse(info.modified_ms));
    out.truncate(limit.unwrap_or(50).min(500));
    Ok(out)
}

use std::io::Read as _;

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn accepts_the_session_ids_pi_accepts() {
        assert!(is_safe_session_id("019fc4f0-9d22-71c6-a161-ec17c05eb692"));
        assert!(is_safe_session_id("terax-st-abc"));
        assert!(is_safe_session_id("heartbeat"));
        assert!(is_safe_session_id("a_b-1"));
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
    }

    #[test]
    fn sums_usage_across_assistant_messages() {
        let jsonl = r#"{"type":"session","id":"s","cwd":"/tmp"}
{"type":"message","message":{"role":"user","content":[]}}
{"type":"message","message":{"role":"assistant","model":"claude-opus-5","stopReason":"toolUse","usage":{"input":2,"output":10,"cacheRead":30,"cacheWrite":4,"reasoning":5,"totalTokens":46,"cost":{"total":0.25}}}}
{"type":"message","message":{"role":"assistant","model":"claude-opus-5","stopReason":"endTurn","usage":{"input":1,"output":20,"cacheRead":0,"cacheWrite":0,"reasoning":0,"totalTokens":21,"cost":{"total":0.1}}}}
"#;
        let (usage, messages, stop_reason, model) = accumulate_usage(Cursor::new(jsonl));

        assert_eq!(messages, 2);
        assert_eq!(usage.input, 3);
        assert_eq!(usage.output, 30);
        assert_eq!(usage.cache_read, 30);
        assert_eq!(usage.total_tokens, 67);
        assert!((usage.cost_total - 0.35).abs() < 1e-9);
        assert_eq!(stop_reason.as_deref(), Some("endTurn"));
        assert_eq!(model.as_deref(), Some("claude-opus-5"));
    }

    #[test]
    fn skips_lines_without_usage_and_survives_a_partial_tail() {
        let jsonl = "{\"type\":\"model_change\"}\n\
             not json at all\n\
             {\"type\":\"message\",\"message\":{\"usage\":{\"totalTokens\":5,\"cost\":{\"total\":0.01}}}}\n\
             {\"type\":\"message\",\"message\":{\"usa";
        let (usage, messages, _, _) = accumulate_usage(Cursor::new(jsonl));

        assert_eq!(messages, 1);
        assert_eq!(usage.total_tokens, 5);
    }

    #[test]
    fn reports_zero_for_an_empty_slice() {
        let (usage, messages, stop_reason, model) = accumulate_usage(Cursor::new(""));

        assert_eq!(usage, SessionUsage::default());
        assert_eq!(messages, 0);
        assert!(stop_reason.is_none());
        assert!(model.is_none());
    }

    #[test]
    fn tolerates_a_missing_cost_object() {
        let jsonl = r#"{"type":"message","message":{"usage":{"totalTokens":7}}}"#;
        let (usage, _, _, _) = accumulate_usage(Cursor::new(jsonl));

        assert_eq!(usage.total_tokens, 7);
        assert_eq!(usage.cost_total, 0.0);
    }

    #[test]
    fn derives_the_session_id_from_both_file_name_shapes() {
        assert_eq!(
            session_id_from_name("2026-08-03T00-05-31-043Z_019fc4f0-9d22.jsonl").as_deref(),
            Some("019fc4f0-9d22")
        );
        assert_eq!(
            session_id_from_name("heartbeat.jsonl").as_deref(),
            Some("heartbeat")
        );
        assert!(session_id_from_name("notes.txt").is_none());
    }

    #[test]
    fn rejects_an_unsafe_id_before_touching_the_filesystem() {
        assert!(pi_session_offset("../../etc/passwd".to_string()).is_err());
        assert!(pi_session_usage("../../etc/passwd".to_string(), 0).is_err());
    }
}
