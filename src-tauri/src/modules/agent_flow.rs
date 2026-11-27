use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs::{self, File},
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    agentdigest::{
        claude_pending_task_id, claude_result_pending, claude_task_notices, codex_subagent, codex_thread_name,
        parse_rfc3339_ms,
    },
    agentsessions::{find_session_file, is_safe_session_id, sessions_root, AgentKind},
};

const READ_BYTES: u64 = 4 * 1024 * 1024;
const LINE_BYTES: usize = 512 * 1024;
const MAX_EVENTS: usize = 600;
const MAX_FILES: usize = 2_000;

#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Claude,
    Pi,
    Codex,
    Copilot,
    Agy,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySession {
    id: String,
    provider: Provider,
    cwd: String,
    modified_at: u64,
    created_at: Option<u64>,
    parent_id: Option<String>,
    name: Option<String>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Kind {
    User,
    Reply,
    Tool,
    Delegated,
    MonitorStarted,
    BackgroundStarted,
    TaskAlias,
    TaskActivity,
    Returned,
    TurnEnded,
    Error,
    Usage,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Usage {
    tokens: u64,
    cumulative: bool,
    key: Option<String>,
    cost: Option<f64>,
    output_only: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    includes_subagents: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    context: Option<ContextUsage>,
}

#[derive(Debug, Serialize)]
struct ContextUsage {
    input: u64,
    window: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Event {
    id: String,
    at: u64,
    kind: Kind,
    text: String,
    task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    usage: Option<Usage>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Trace {
    events: Vec<Event>,
    name: Option<String>,
    next_offset: u64,
    reset: bool,
    limited: bool,
}

fn text(value: &Value) -> String {
    value
        .as_str()
        .unwrap_or_default()
        .split_whitespace()
        .scan(180, |left, word| {
            let count = word.chars().count();
            if *left == 0 {
                return None;
            }
            let clipped: String = word.chars().take(*left).collect();
            *left = left.saturating_sub(count + 1);
            Some(clipped)
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn first_text<'a>(values: impl IntoIterator<Item = &'a Value>) -> String {
    values
        .into_iter()
        .map(text)
        .find(|s| !s.is_empty())
        .unwrap_or_default()
}

fn safe_key(v: &Value) -> Option<String> {
    v.as_str()
        .filter(|id| is_safe_session_id(id))
        .map(String::from)
}

fn usage_for(provider: Provider, row: &Value) -> Option<Usage> {
    let message = &row["message"];
    match provider {
        Provider::Claude
            if row["type"] == "assistant" && row["isSidechain"] != true =>
        {
            let usage = message["usage"].as_object()?;
            let tokens = ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]
                .into_iter()
                .filter_map(|key| usage.get(key)?.as_u64())
                .fold(0u64, u64::saturating_add);
            let key = safe_key(&message["id"]).or_else(|| safe_key(&row["uuid"]))?;
            Some(Usage { tokens, cumulative: false, key: Some(key), cost: None, output_only: false, includes_subagents: None, context: None })
        }
        Provider::Pi if message["role"] == "assistant" => {
            let usage = &message["usage"];
            Some(Usage {
                tokens: usage["totalTokens"].as_u64()?,
                cumulative: false,
                key: safe_key(&row["id"]),
                cost: usage["cost"]["total"].as_f64().filter(|cost| cost.is_finite() && *cost >= 0.0),
                output_only: false,
                includes_subagents: None,
                context: None,
            })
        }
        Provider::Codex
            if row["type"] == "event_msg" && row["payload"]["type"] == "token_count" =>
        {
            let info = &row["payload"]["info"];
            let context = info["last_token_usage"]["input_tokens"].as_u64()
                .zip(info["model_context_window"].as_u64().filter(|size| *size > 0))
                .map(|(input, window)| ContextUsage { input, window });
            Some(Usage {
                tokens: info["total_token_usage"]["total_tokens"].as_u64()?,
                cumulative: true,
                key: None,
                cost: None,
                output_only: false,
                includes_subagents: None,
                context,
            })
        }
        Provider::Copilot if row["type"] == "session.usage_record" => {
            let usage = &row["data"]["usage"];
            let input = usage["inputTokens"].as_u64()?;
            let output = usage["outputTokens"].as_u64()?;
            Some(Usage {
                tokens: input.saturating_add(output), cumulative: false,
                key: safe_key(&usage["apiCallId"]).or_else(|| safe_key(&row["id"])),
                cost: None, output_only: false, includes_subagents: None, context: None,
            })
        }
        Provider::Copilot if matches!(row["type"].as_str(), Some("session.shutdown" | "session.usage_checkpoint")) => {
            let data = &row["data"];
            let models = data["modelMetrics"].as_object().or_else(|| data["accountingSnapshot"]["modelMetrics"].as_object())?;
            let tokens = models.values().filter_map(|entry| {
                let usage = &entry["usage"];
                Some(usage["inputTokens"].as_u64()?.saturating_add(usage["outputTokens"].as_u64()?))
            }).reduce(u64::saturating_add)?;
            Some(Usage { tokens, cumulative: true, key: None, cost: None, output_only: false, includes_subagents: Some(true), context: None })
        }
        Provider::Copilot if row["type"] == "assistant.message" => {
            let data = &row["data"];
            let usage = data.get("usage").unwrap_or(data);
            let total = usage["totalTokens"].as_u64();
            let input = usage["inputTokens"].as_u64();
            let output = usage["outputTokens"].as_u64();
            Some(Usage {
                tokens: total.or_else(|| output.map(|value| value.saturating_add(input.unwrap_or(0))))?,
                cumulative: false, key: safe_key(&data["messageId"]).or_else(|| safe_key(&row["id"])),
                cost: None, output_only: total.is_none() && input.is_none(), includes_subagents: None, context: None,
            })
        }
        Provider::Agy if row["type"] == "PLANNER_RESPONSE" => Some(Usage {
            tokens: row["usage"]["total_tokens"].as_u64()?,
            cumulative: false, key: safe_key(&row["id"]), cost: None, output_only: false, includes_subagents: None, context: None,
        }),
        _ => None,
    }
}

fn explicit_file(args: &Value) -> Option<String> {
    ["file_path", "filePath", "path"].into_iter().find_map(|key| {
        let path = args[key].as_str()?.trim();
        if path.is_empty() || path.contains("://") || path.chars().any(char::is_control) {
            return None;
        }
        Some(path.chars().take(240).collect())
    })
}

fn tool_file(provider: Provider, row: &Value, name: &str, occurrence: usize) -> Option<String> {
    if !matches!(
        name.to_ascii_lowercase().as_str(),
        "read" | "write" | "edit" | "view" | "read_file" | "write_file" | "view_file" | "edit_file" | "replace"
    ) {
        return None;
    }
    match provider {
        Provider::Claude | Provider::Pi => {
            let block = row["message"]["content"]
                .as_array()?
                .iter()
                .filter(|block| block["name"] == name)
                .nth(occurrence)?;
            explicit_file(&block["input"]).or_else(|| explicit_file(&block["arguments"]))
        }
        Provider::Codex => {
            let payload = &row["payload"];
            if let Some(raw) = payload["arguments"].as_str() {
                explicit_file(&serde_json::from_str::<Value>(raw).ok()?)
            } else {
                explicit_file(&payload["item"]["arguments"])
            }
        }
        Provider::Copilot => explicit_file(&row["data"]["arguments"]),
        Provider::Agy => None,
    }
}

fn message_text(role: &str, value: &Value, emit: &mut impl FnMut(Kind, String, Option<String>)) {
    let raw = value.as_str().unwrap_or_default();
    if raw.contains("<task-notification>") {
        project_task_notices(raw, emit);
    } else if !raw.trim().is_empty() {
        emit(
            if role == "user" {
                Kind::User
            } else {
                Kind::Reply
            },
            text(value),
            None,
        );
    }
}

fn project_task_notices(raw: &str, emit: &mut impl FnMut(Kind, String, Option<String>)) {
    for (id, status) in claude_task_notices(raw).filter(|(id, _)| is_safe_session_id(id)) {
        let kind = match status {
            Some("failed" | "killed" | "timed_out") => Kind::Error,
            Some("completed" | "stopped" | "cancelled" | "canceled") => Kind::Returned,
            _ => Kind::TaskActivity,
        };
        emit(kind, String::new(), Some(id.to_string()));
    }
}

fn codex_tool_result(payload: &Value, emit: &mut impl FnMut(Kind, String, Option<String>)) {
    let output = &payload["output"];
    let parsed = output.as_str()
        .or_else(|| output.as_array()?.iter().find_map(|part| part["text"].as_str()))
        .and_then(|text| serde_json::from_str::<Value>(text).ok());
    let result = parsed.as_ref().unwrap_or(output);
    let child = safe_key(&result["agent_id"]).or_else(|| safe_key(&result["task_name"]));
    if let (Some(call), Some(child)) = (safe_key(&payload["call_id"]), child) {
        emit(Kind::TaskAlias, child, Some(call));
    }
    if !result["timed_out"].is_boolean() {
        return;
    }
    for (id, status) in result["status"].as_object().into_iter().flatten().take(32) {
        if !is_safe_session_id(id) {
            continue;
        }
        let kind = if status.get("errored").is_some() || status == "not_found" {
            Kind::Error
        } else if status.get("completed").is_some() || status == "shutdown" {
            Kind::Returned
        } else {
            continue;
        };
        emit(kind, String::new(), Some(id.clone()));
    }
}

fn codex_item(item: &Value, emit: &mut impl FnMut(Kind, String, Option<String>)) {
    match item["type"].as_str().unwrap_or_default() {
        "SubAgentActivity" => {
            let Some(thread) = safe_key(&item["agent_thread_id"]) else { return };
            let kind = item["kind"].as_str();
            if !matches!(kind, Some("started" | "completed" | "failed")) {
                return;
            }
            let name = item["agent_path"].as_str().and_then(|path| path.rsplit('/').next())
                .filter(|name| is_safe_session_id(name));
            if let Some(name) = name {
                emit(Kind::TaskAlias, thread.clone(), Some(name.to_owned()));
            }
            match kind {
                Some("started") => emit(Kind::Delegated, name.unwrap_or_default().to_owned(), Some(thread)),
                Some("completed") => emit(Kind::Returned, String::new(), Some(thread)),
                Some("failed") => emit(Kind::Error, String::new(), Some(thread)),
                _ => {}
            }
        }
        "CommandExecution" => emit(Kind::Tool, "Run shell".into(), None),
        "FileChange" => emit(Kind::Tool, "Apply patch".into(), None),
        "McpToolCall" => {
            let tool = text(&item["tool"]);
            if !tool.is_empty() {
                emit(Kind::Tool, tool, None);
            }
        }
        _ => {}
    }
}

fn project(provider: Provider, row: &Value, emit: &mut impl FnMut(Kind, String, Option<String>)) {
    let kind = row["type"].as_str().unwrap_or_default();
    match provider {
        Provider::Claude | Provider::Pi => {
            if provider == Provider::Claude && kind == "queue-operation" {
                if row["operation"] == "enqueue" {
                    project_task_notices(row["content"].as_str().unwrap_or_default(), emit);
                }
                return;
            }
            let message = &row["message"];
            let role = message["role"].as_str().unwrap_or(kind);
            if provider == Provider::Pi && role == "toolResult" {
                if let Some(id) = safe_key(&message["toolCallId"]) {
                    let kind = if message["isError"] == true { Kind::Error } else { Kind::Returned };
                    emit(kind, String::new(), Some(id));
                }
                return;
            }
            if !matches!(role, "user" | "assistant") || row["isSidechain"] == true {
                return;
            }
            let content = &message["content"];
            if content.is_string() {
                message_text(role, content, emit);
            }
            for block in content.as_array().into_iter().flatten() {
                match block["type"].as_str().unwrap_or_default() {
                    "text" => message_text(role, &block["text"], emit),
                    "tool_use" | "toolCall" => {
                        let name = text(&block["name"]);
                        if matches!(name.as_str(), "Agent" | "Task" | "subagent") {
                            emit(
                                Kind::Delegated,
                                first_text([
                                    &block["input"]["description"],
                                    &block["input"]["subagent_type"],
                                    &block["arguments"]["agent"],
                                    &block["arguments"]["description"],
                                ]),
                                safe_key(&block["id"]),
                            );
                        } else if provider == Provider::Claude
                            && (name == "Monitor" || (name == "Bash" && block["input"]["run_in_background"] == true))
                        {
                            if let Some(id) = safe_key(&block["id"]) {
                                let kind = if name == "Monitor" { Kind::MonitorStarted } else { Kind::BackgroundStarted };
                                emit(kind, text(&block["input"]["description"]), Some(id));
                            }
                        } else {
                            emit(Kind::Tool, name, None);
                        }
                    }
                    "tool_result" => {
                        if let Some(id) = safe_key(&block["tool_use_id"]) {
                            if claude_result_pending(block) {
                                if let Some(alias) = claude_pending_task_id(block) {
                                    emit(Kind::TaskAlias, alias, Some(id));
                                }
                            } else {
                                let kind = if block["is_error"] == true { Kind::Error } else { Kind::Returned };
                                emit(kind, String::new(), Some(id));
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        Provider::Codex => {
            let p = &row["payload"];
            match (kind, p["type"].as_str().unwrap_or_default()) {
                ("event_msg", "user_message") => emit(Kind::User, text(&p["message"]), None),
                ("event_msg", "agent_message") => emit(Kind::Reply, text(&p["message"]), None),
                ("event_msg", "item_completed") => codex_item(&p["item"], emit),
                ("event_msg", "task_complete" | "turn_complete") => {
                    emit(Kind::TurnEnded, String::new(), None)
                }
                ("event_msg", "error") => emit(Kind::Error, String::new(), None),
                ("response_item", "function_call" | "custom_tool_call") => {
                    let name = text(&p["name"]);
                    if matches!(name.as_str(), "spawn_agent" | "spawn_agents") {
                        let args: Value = p["arguments"]
                            .as_str()
                            .and_then(|s| serde_json::from_str(s).ok())
                            .unwrap_or_default();
                        emit(
                            Kind::Delegated,
                            first_text([&args["agent_type"], &args["nickname"], &args["task_name"]]),
                            safe_key(&p["call_id"]),
                        );
                    } else if !name.is_empty() {
                        emit(Kind::Tool, name, None);
                    }
                }
                ("response_item", "function_call_output" | "custom_tool_call_output") => {
                    codex_tool_result(p, emit)
                }
                ("response_item", "web_search_call" | "web_search_tool_call") => {
                    emit(Kind::Tool, "Web search".into(), None)
                }
                ("response_item", "local_shell_call") => emit(Kind::Tool, "Run shell".into(), None),
                ("response_item", "tool_search_call") => emit(Kind::Tool, "Find tools".into(), None),
                _ => {}
            }
        }
        Provider::Copilot => {
            let p = &row["data"];
            match kind {
                "user.message" => emit(Kind::User, text(&p["content"]), None),
                "assistant.message" => emit(Kind::Reply, text(&p["content"]), safe_key(&p["parentToolCallId"])),
                "tool.execution_start" => emit(Kind::Tool, text(&p["toolName"]), safe_key(&p["parentToolCallId"])),
                "assistant.turn_end" => emit(Kind::TurnEnded, String::new(), None),
                "session.error" => emit(Kind::Error, String::new(), None),
                "subagent.started" => emit(
                    Kind::Delegated,
                    first_text([&p["agentDisplayName"], &p["agentName"]]),
                    safe_key(&p["toolCallId"]),
                ),
                "subagent.completed" => {
                    emit(Kind::Returned, String::new(), safe_key(&p["toolCallId"]))
                }
                "subagent.failed" => emit(Kind::Error, String::new(), safe_key(&p["toolCallId"])),
                _ => {}
            }
        }
        Provider::Agy => match kind {
            "USER_INPUT" => emit(Kind::User, text(&row["content"]), None),
            "PLANNER_RESPONSE" => emit(Kind::Reply, text(&row["content"]), None),
            "ERROR_MESSAGE" => emit(Kind::Error, text(&row["content"]), None),
            "RUN_COMMAND" | "VIEW_FILE" | "LIST_DIRECTORY" | "GREP_SEARCH" | "CODE_ACTION" => {
                emit(
                    Kind::Tool,
                    kind.replace('_', " ").to_ascii_lowercase(),
                    None,
                );
            }
            _ => {}
        },
    }
}

fn session_name(provider: Provider, row: &Value) -> String {
    match (provider, row["type"].as_str().unwrap_or_default()) {
        (Provider::Claude, "custom-title") => text(&row["customTitle"]),
        (Provider::Claude, "ai-title") => text(&row["aiTitle"]),
        (Provider::Pi, "session_info") => text(&row["name"]),
        (Provider::Copilot, "session.info") => {
            first_text([&row["data"]["name"], &row["data"]["summary"]])
        }
        _ => String::new(),
    }
}

fn read_first(path: &Path) -> Option<Value> {
    let mut bytes = Vec::new();
    BufReader::new(File::open(path).ok()?.take(LINE_BYTES as u64))
        .read_until(b'\n', &mut bytes)
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn collect(dir: &Path, depth: usize, files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_cached_key(|entry| std::cmp::Reverse(entry.file_name()));
    for entry in entries {
        if files.len() >= MAX_FILES {
            break;
        }
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if kind.is_dir() && depth > 0 {
            collect(&path, depth - 1, files);
        } else if kind.is_file() && path.extension().is_some_and(|ext| ext == "jsonl") {
            files.push(path);
        }
    }
}

fn integrations(provider: Provider) -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let mut files = Vec::new();
    match provider {
        Provider::Codex => {
            let root = std::env::var_os("CODEX_HOME")
                .map(PathBuf::from)
                .filter(|dir| dir.is_absolute())
                .unwrap_or_else(|| home.join(".codex"));
            collect(&root.join("sessions"), 3, &mut files);
            files.retain(|path| {
                path.file_name()
                    .is_some_and(|s| s.to_string_lossy().starts_with("rollout-"))
            });
        }
        Provider::Copilot => {
            collect(&home.join(".copilot/session-state"), 1, &mut files);
            files.retain(|path| path.file_name().is_some_and(|s| s == "events.jsonl"));
        }
        _ => {}
    }
    files
}

fn metadata(path: &Path, provider: Provider) -> Option<HistorySession> {
    let row = read_first(path)?;
    let (id, cwd) = match (provider, row["type"].as_str()?) {
        (Provider::Codex, "session_meta") => (&row["payload"]["id"], &row["payload"]["cwd"]),
        (Provider::Copilot, "session.start") => {
            (&row["data"]["sessionId"], &row["data"]["context"]["cwd"])
        }
        _ => return None,
    };
    let payload = &row["payload"];
    let spawn = &payload["source"]["subagent"]["thread_spawn"];
    let parent_id = safe_key(&spawn["parent_thread_id"]).or_else(|| {
        codex_subagent(payload).then(|| safe_key(&payload["parent_thread_id"])).flatten()
    });
    if provider == Provider::Codex && codex_subagent(payload) && parent_id.is_none() {
        return None;
    }
    let modified_at = path
        .metadata()
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis() as u64;
    Some(HistorySession {
        id: safe_key(id)?,
        provider,
        cwd: cwd.as_str()?.to_string(),
        modified_at,
        created_at: payload["timestamp"].as_str().or_else(|| row["timestamp"].as_str()).and_then(parse_rfc3339_ms),
        parent_id,
        name: {
            let name = first_text([&spawn["agent_nickname"], &payload["agent_nickname"], &spawn["agent_role"]]);
            (!name.is_empty()).then_some(name)
        },
    })
}

fn resolve(provider: Provider, id: &str) -> Option<PathBuf> {
    match provider {
        Provider::Claude | Provider::Pi => {
            let agent = if matches!(provider, Provider::Claude) {
                AgentKind::Claude
            } else {
                AgentKind::Pi
            };
            let root = sessions_root(agent)?.canonicalize().ok()?;
            let path = find_session_file(agent, id)?.canonicalize().ok()?;
            path.starts_with(root).then_some(path)
        }
        Provider::Codex | Provider::Copilot => integrations(provider).into_iter().find(|path| {
            let hint = match provider {
                Provider::Codex => path
                    .file_stem()
                    .is_some_and(|name| name.to_string_lossy().ends_with(id)),
                Provider::Copilot => path
                    .parent()
                    .and_then(Path::file_name)
                    .is_some_and(|name| name == id),
                _ => false,
            };
            hint && if provider == Provider::Codex {
                read_first(path).is_some_and(|row| row["type"] == "session_meta" && row["payload"]["id"] == id)
            } else {
                metadata(path, provider).is_some_and(|meta| meta.id == id)
            }
        }),
        Provider::Agy => agy_transcript(&agy_root()?, id),
    }
}

fn agy_root() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(".gemini/antigravity-cli"))
}

fn agy_transcript(root: &Path, id: &str) -> Option<PathBuf> {
    let brain = root.join("brain").canonicalize().ok()?;
    let path = brain
        .join(id)
        .join("transcript.jsonl")
        .canonicalize()
        .ok()?;
    (path.starts_with(brain) && path.is_file()).then_some(path)
}

fn agy_history(cwds: &HashSet<String>) -> Vec<HistorySession> {
    let Some(root) = agy_root() else {
        return Vec::new();
    };
    let Some(cache) = File::open(root.join("cache/conversation_metadata.json"))
        .ok()
        .and_then(|file| serde_json::from_reader::<_, Value>(file.take(1024 * 1024)).ok())
    else {
        return Vec::new();
    };
    cache
        .as_object()
        .into_iter()
        .flat_map(|sections| sections.values())
        .filter_map(Value::as_object)
        .flat_map(|entries| entries.iter())
        .filter_map(|(id, record)| {
            let summary = &record["summary"];
            if !is_safe_session_id(id)
                || record["is_internal"] == true
                || summary["Internal"] == true
                || summary["Cloud"] == true
                || summary["ID"].as_str() != Some(id)
            {
                return None;
            }
            let cwd = summary["WorkspaceURIs"]
                .as_array()?
                .iter()
                .find_map(|uri| {
                    let path = tauri::Url::parse(uri.as_str()?).ok()?.to_file_path().ok()?;
                    let path = path.to_str()?;
                    cwds.contains(path).then(|| path.to_string())
                })?;
            let path = agy_transcript(&root, id)?;
            let created_at = read_first(&path)
                .and_then(|row| row["created_at"].as_str().and_then(parse_rfc3339_ms));
            let modified_at = record["last_modified_time"]
                .as_str()
                .and_then(parse_rfc3339_ms)?;
            let name = text(&summary["Title"]);
            Some(HistorySession {
                id: id.clone(),
                provider: Provider::Agy,
                cwd,
                modified_at,
                created_at,
                parent_id: None,
                name: (!name.is_empty()).then_some(name),
            })
        })
        .collect()
}

type CachedPaths = VecDeque<(Provider, String, PathBuf)>;
static PATHS: Mutex<CachedPaths> = Mutex::new(VecDeque::new());

fn trace_path(provider: Provider, id: &str) -> Option<PathBuf> {
    let cached = PATHS
        .lock()
        .ok()?
        .iter()
        .find(|entry| entry.0 == provider && entry.1 == id)
        .map(|entry| entry.2.clone());
    if let Some(path) =
        cached.filter(|path| path.canonicalize().is_ok_and(|resolved| resolved == *path))
    {
        return Some(path);
    }
    let path = resolve(provider, id)?.canonicalize().ok()?;
    let mut paths = PATHS.lock().ok()?;
    paths.retain(|(p, key, _)| *p != provider || key != id);
    if paths.len() >= 256 {
        paths.pop_front();
    }
    paths.push_back((provider, id.to_string(), path.clone()));
    Some(path)
}

fn read_trace(file: File, provider: Provider, offset: u64) -> std::io::Result<Trace> {
    let size = file.metadata()?.len();
    let reset = offset == 0 || offset > size || size.saturating_sub(offset) > READ_BYTES;
    let mut next_offset = if reset {
        size.saturating_sub(READ_BYTES)
    } else {
        offset
    };
    let mut limited = reset && next_offset > 0;
    let mut reader = BufReader::new(file);
    reader.seek(SeekFrom::Start(
        next_offset.saturating_sub(u64::from(limited)),
    ))?;
    if limited {
        let align_budget = size - next_offset + 1;
        next_offset = next_offset - 1 + (&mut reader).take(align_budget).skip_until(b'\n')? as u64;
    }
    let mut events = VecDeque::new();
    let mut line = Vec::new();
    let mut name = None;
    let mut reader = reader.take(size.saturating_sub(next_offset));
    while next_offset < size {
        line.clear();
        let bytes = reader.read_until(b'\n', &mut line)?;
        if line.last() != Some(&b'\n') {
            break;
        }
        let line_offset = next_offset;
        next_offset += bytes as u64;
        if line.len() > LINE_BYTES {
            limited = true;
            continue;
        }
        let Ok(row) = serde_json::from_slice::<Value>(&line) else {
            continue;
        };
        let label = session_name(provider, &row);
        if !label.is_empty() {
            name = Some(label);
        }
        let timestamp = if provider == Provider::Agy {
            &row["created_at"]
        } else {
            &row["timestamp"]
        };
        let Some(at) = timestamp.as_str().and_then(parse_rfc3339_ms) else {
            continue;
        };
        let mut index = 0;
        let mut tool_occurrences = HashMap::new();
        project(provider, &row, &mut |kind, text, task_id| {
            if events.len() == MAX_EVENTS {
                events.pop_front();
                limited = true;
            }
            let file = if kind == Kind::Tool {
                let occurrence = tool_occurrences.entry(text.clone()).or_insert(0);
                let file = tool_file(provider, &row, &text, *occurrence);
                *occurrence += 1;
                file
            } else {
                None
            };
            let id = if kind == Kind::Tool && provider == Provider::Codex {
                safe_key(&row["payload"]["call_id"]).or_else(|| safe_key(&row["payload"]["item"]["id"]))
                    .map(|id| format!("tool:{id}"))
            } else {
                None
            };
            events.push_back(Event {
                id: id.unwrap_or_else(|| format!("{line_offset}:{index}")),
                at,
                file,
                kind,
                text,
                task_id,
                usage: None,
            });
            index += 1;
        });
        if let Some(usage) = usage_for(provider, &row) {
            if events.len() == MAX_EVENTS {
                events.pop_front();
                limited = true;
            }
            events.push_back(Event {
                id: format!("{line_offset}:usage"),
                at,
                kind: Kind::Usage,
                text: String::new(),
                task_id: if provider == Provider::Copilot { safe_key(&row["data"]["parentToolCallId"]) } else { None },
                file: None,
                usage: Some(usage),
            });
        }
    }
    Ok(Trace {
        events: events.into(),
        name,
        next_offset,
        reset,
        limited,
    })
}

#[tauri::command]
pub async fn agent_flow_history(cwds: Vec<String>, excluded_cwds: Option<Vec<String>>) -> Result<Vec<HistorySession>, String> {
    let cwds: HashSet<_> = cwds
        .into_iter()
        .take(100)
        .filter(|cwd| !cwd.is_empty() && cwd.len() <= 4096)
        .collect();
    if cwds.is_empty() {
        return Ok(Vec::new());
    }
    let excluded: HashSet<_> = excluded_cwds.unwrap_or_default().into_iter().take(100).collect();
    tauri::async_runtime::spawn_blocking(move || {
        let mut found = Vec::new();
        for provider in [Provider::Codex, Provider::Copilot] {
            let mut files = integrations(provider);
            files.sort_by_cached_key(|path| {
                std::cmp::Reverse(path.metadata().and_then(|m| m.modified()).ok())
            });
            let sessions = files.into_iter()
                .filter_map(|path| metadata(&path, provider))
                .filter(|session| !excluded.contains(&session.cwd));
            if provider == Provider::Codex {
                found.extend(codex_history(sessions.collect(), &cwds));
            } else {
                found.extend(sessions.filter(|session| cwds.contains(&session.cwd)).take(120));
            }
        }
        let mut agy = agy_history(&cwds);
        agy.sort_by_key(|session| std::cmp::Reverse(session.modified_at));
        found.extend(agy.into_iter().take(120));
        found.sort_by_key(|session| std::cmp::Reverse(session.modified_at));
        found
    })
    .await
    .map_err(|error| error.to_string())
}

fn codex_history(sessions: Vec<HistorySession>, cwds: &HashSet<String>) -> Vec<HistorySession> {
    let mut descendants = HashMap::<&str, Vec<&str>>::new();
    let mut selected: HashSet<_> = sessions.iter()
        .filter(|session| session.parent_id.is_none() && cwds.contains(&session.cwd))
        .take(120).map(|session| session.id.as_str()).collect();
    for session in &sessions {
        if let Some(parent) = &session.parent_id {
            descendants.entry(parent).or_default().push(&session.id);
        }
    }
    let mut queue: VecDeque<_> = selected.iter().copied().collect();
    while let Some(parent) = queue.pop_front() {
        if let Some(children) = descendants.get(parent) {
            for &child in children {
                if selected.len() >= 360 {
                    break;
                }
                if selected.insert(child) {
                    queue.push_back(child);
                }
            }
        }
    }
    let selected: HashSet<_> = selected.into_iter().map(str::to_owned).collect();
    let mut retained = HashSet::new();
    sessions.into_iter().filter(|session| {
        retained.insert(session.id.clone()) && selected.contains(session.id.as_str())
    }).collect()
}

#[tauri::command]
pub async fn agent_flow_trace(
    provider: Provider,
    id: String,
    offset: u64,
) -> Result<Trace, String> {
    if !is_safe_session_id(&id) {
        return Err("Invalid session id".to_owned());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let path = trace_path(provider, &id).ok_or("Transcript unavailable")?;
        let file = File::open(path).map_err(|error| error.to_string())?;
        let mut trace = read_trace(file, provider, offset).map_err(|error| error.to_string())?;
        if offset == 0 && provider == Provider::Codex {
            trace.name = codex_thread_name(&id);
        }
        Ok(trace)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn codex_links_tool_call_to_child_and_projects_final_status_without_output() {
        let mut events = Vec::new();
        let mut emit = |kind, text, id| events.push((kind, text, id));
        for row in [
            serde_json::json!({"type":"response_item","payload":{"type":"function_call","name":"spawn_agent","call_id":"call","arguments":"{\"agent_type\":\"reviewer\"}"}}),
            serde_json::json!({"type":"response_item","payload":{"type":"function_call_output","call_id":"call","output":[{"type":"input_text","text":"{\"agent_id\":\"child\"}"}]}}),
            serde_json::json!({"type":"response_item","payload":{"type":"web_search_call","query":"not retained"}}),
            serde_json::json!({"type":"response_item","payload":{"type":"function_call_output","call_id":"wait","output":"{\"status\":{\"child\":{\"completed\":\"not retained\"}},\"timed_out\":false}"}}),
        ] {
            project(Provider::Codex, &row, &mut emit);
        }
        assert_eq!(events, [
            (Kind::Delegated, "reviewer".into(), Some("call".into())),
            (Kind::TaskAlias, "child".into(), Some("call".into())),
            (Kind::Tool, "Web search".into(), None),
            (Kind::Returned, String::new(), Some("child".into())),
        ]);
    }

    #[test]
    fn codex_v2_projects_task_names_and_subagent_activity_items() {
        let mut events = Vec::new();
        let mut emit = |kind, text, id| events.push((kind, text, id));
        for row in [
            serde_json::json!({"type":"response_item","payload":{"type":"function_call_output","call_id":"call","output":"{\"task_name\":\"reviewer\"}"}}),
            serde_json::json!({"type":"event_msg","payload":{"type":"item_completed","item":{"type":"SubAgentActivity","kind":"started","agent_thread_id":"child","agent_path":"/root/reviewer"}}}),
            serde_json::json!({"type":"event_msg","payload":{"type":"item_completed","item":{"type":"SubAgentActivity","kind":"completed","agent_thread_id":"child","agent_path":"/root/reviewer"}}}),
        ] {
            project(Provider::Codex, &row, &mut emit);
        }
        assert_eq!(events, [
            (Kind::TaskAlias, "reviewer".into(), Some("call".into())),
            (Kind::TaskAlias, "child".into(), Some("reviewer".into())),
            (Kind::Delegated, "reviewer".into(), Some("child".into())),
            (Kind::TaskAlias, "child".into(), Some("reviewer".into())),
            (Kind::Returned, String::new(), Some("child".into())),
        ]);
    }

    #[test]
    fn codex_history_joins_children_by_parent_across_worktrees() {
        let session = |id: &str, cwd: &str, parent: Option<&str>| HistorySession {
            id: id.into(), provider: Provider::Codex, cwd: cwd.into(), modified_at: 1,
            created_at: None, parent_id: parent.map(str::to_owned), name: None,
        };
        let found = codex_history(vec![
            session("nested", "/nested", Some("child")),
            session("other_child", "/repo", Some("other_root")),
            session("child", "/other-worktree", Some("root")),
            session("root", "/repo", None),
            session("other_root", "/unrelated", None),
        ], &HashSet::from(["/repo".to_owned()]));
        assert_eq!(found.iter().map(|entry| entry.id.as_str()).collect::<Vec<_>>(), ["nested", "child", "root"]);
    }

    #[test]
    fn copilot_attributes_tools_and_output_counts_to_subagents() {
        let mut file = tempfile::tempfile().unwrap();
        for row in [
            serde_json::json!({"type":"tool.execution_start","timestamp":"2026-11-22T10:00:00Z","data":{"toolName":"view","parentToolCallId":"child"}}),
            serde_json::json!({"type":"assistant.message","timestamp":"2026-11-22T10:00:01Z","data":{"messageId":"answer","content":"Done","outputTokens":32,"parentToolCallId":"child"}}),
            serde_json::json!({"type":"session.shutdown","timestamp":"2026-11-22T10:00:02Z","data":{"modelMetrics":{"model":{"usage":{"inputTokens":80,"outputTokens":32}}}}}),
        ] {
            writeln!(file, "{row}").unwrap();
        }
        let trace = read_trace(file, Provider::Copilot, 0).unwrap();
        assert_eq!(trace.events.len(), 4);
        assert_eq!(trace.events[0].kind, Kind::Tool);
        assert_eq!(trace.events[0].task_id.as_deref(), Some("child"));
        assert_eq!(trace.events[1].kind, Kind::Reply);
        assert_eq!(trace.events[1].task_id.as_deref(), Some("child"));
        assert_eq!(trace.events[2].task_id.as_deref(), Some("child"));
        let usage = trace.events[2].usage.as_ref().unwrap();
        assert_eq!(usage.tokens, 32);
        assert!(usage.output_only);
        let checkpoint = trace.events[3].usage.as_ref().unwrap();
        assert_eq!(checkpoint.tokens, 112);
        assert_eq!(checkpoint.includes_subagents, Some(true));
    }

    #[test]
    fn projects_background_tools_and_monitor_notifications_without_command_output() {
        let mut events = Vec::new();
        let mut emit = |kind, text, id| events.push((kind, text, id));
        project(Provider::Claude, &serde_json::json!({
            "type": "assistant", "message": { "role": "assistant", "content": [
                { "type": "tool_use", "id": "m", "name": "Monitor", "input": { "description": "PR status" } },
                { "type": "tool_use", "id": "b", "name": "Bash", "input": { "command": "opaque", "run_in_background": true } },
            ] },
        }), &mut emit);
        for (id, state) in [("m", "running"), ("b", "failed")] {
            project(Provider::Claude, &serde_json::json!({
                "type": "queue-operation", "operation": "enqueue",
                "content": format!("<task-notification><tool-use-id>{id}</tool-use-id><status>{state}</status><event>opaque</event></task-notification>"),
            }), &mut emit);
        }
        assert_eq!(events, [
            (Kind::MonitorStarted, "PR status".into(), Some("m".into())),
            (Kind::BackgroundStarted, String::new(), Some("b".into())),
            (Kind::TaskActivity, String::new(), Some("m".into())),
            (Kind::Error, String::new(), Some("b".into())),
        ]);
    }

    #[test]
    fn projects_claude_task_aliases_and_pi_tool_results() {
        let mut events = Vec::new();
        let mut emit = |kind, text, id| events.push((kind, text, id));
        project(Provider::Claude, &serde_json::json!({
            "type": "user", "message": { "role": "user", "content": [
                { "type": "tool_result", "tool_use_id": "b", "content": "Command running in background with ID: b4." },
            ] },
        }), &mut emit);
        project(Provider::Claude, &serde_json::json!({
            "type": "queue-operation", "operation": "enqueue",
            "content": "<task-notification><task-id>b4</task-id><status>completed</status></task-notification>",
        }), &mut emit);
        project(Provider::Pi, &serde_json::json!({
            "type": "message", "message": { "role": "toolResult", "toolCallId": "p", "isError": true },
        }), &mut emit);
        assert_eq!(events, [
            (Kind::TaskAlias, "b4".into(), Some("b".into())),
            (Kind::Returned, String::new(), Some("b4".into())),
            (Kind::Error, String::new(), Some("p".into())),
        ]);
    }

    #[test]
    fn projects_usage_and_explicit_file_paths_without_tool_arguments() {
        let mut file = tempfile::tempfile().unwrap();
        writeln!(file, "{}", serde_json::json!({
            "type": "assistant", "timestamp": "2026-11-23T10:00:00Z",
            "message": {
                "id": "msg_1", "usage": {"input_tokens": 3, "output_tokens": 4, "cache_read_input_tokens": 20},
                "content": [
                    {"type": "tool_use", "name": "Read", "input": {"file_path": "src/scene.ts"}},
                    {"type": "tool_use", "name": "Read", "input": {"file_path": "src/canvas.ts"}},
                    {"type": "tool_use", "name": "Bash", "input": {"command": "hidden", "path": "hidden"}}
                ]
            }
        })).unwrap();
        let trace = read_trace(file, Provider::Claude, 0).unwrap();
        assert_eq!(trace.events[0].file.as_deref(), Some("src/scene.ts"));
        assert_eq!(trace.events[1].file.as_deref(), Some("src/canvas.ts"));
        assert_eq!(trace.events[2].file, None);
        assert_eq!(trace.events[3].usage.as_ref().unwrap().tokens, 27);
        let rollup = usage_for(Provider::Codex, &serde_json::json!({
            "type":"event_msg", "payload":{"type":"token_count","info":{
                "total_token_usage":{"total_tokens":123},
                "last_token_usage":{"input_tokens":80},
                "model_context_window":256
            }}
        })).unwrap();
        assert!(rollup.cumulative);
        assert_eq!(rollup.tokens, 123);
        let context = rollup.context.unwrap();
        assert_eq!((context.input, context.window), (80, 256));
    }

    #[test]
    fn incremental_trace_retries_partial_lines_and_links_claude_delegation() {
        let mut file = tempfile::tempfile().unwrap();
        writeln!(
            file,
            "{}",
            serde_json::json!({
                "type": "assistant", "timestamp": "2026-11-22T10:00:00Z",
                "message": {"content": [{"type": "tool_use", "id": "task1", "name": "Agent",
                    "input": {"description": "Check compatibility", "prompt": "private input"}}]}
            })
        )
        .unwrap();
        write!(file, "{{\"type\":\"user\"").unwrap();
        let first = read_trace(file.try_clone().unwrap(), Provider::Claude, 0).unwrap();
        assert_eq!(first.events.len(), 1);
        assert_eq!(first.events[0].kind, Kind::Delegated);
        assert_eq!(first.events[0].text, "Check compatibility");
        file.seek(SeekFrom::End(0)).unwrap();
        writeln!(file, ",\"timestamp\":\"2026-11-22T10:01:00Z\",\"message\":{{\"content\":[{{\"type\":\"tool_result\",\"tool_use_id\":\"task1\"}}]}}}}").unwrap();
        let second = read_trace(file, Provider::Claude, first.next_offset).unwrap();
        assert!(!second.reset);
        assert_eq!(second.events.len(), 1);
        assert_eq!(second.events[0].kind, Kind::Returned);
        assert_eq!(second.events[0].task_id, first.events[0].task_id);
    }

    #[test]
    fn structured_providers_emit_real_delegations_without_tool_arguments() {
        let mut events = Vec::new();
        let mut add = |kind, label, id| events.push((kind, label, id));
        project(
            Provider::Codex,
            &serde_json::json!({"type":"response_item", "payload":{
                "type":"function_call", "name":"spawn_agent", "call_id":"call_1",
                "arguments":"{\"agent_type\":\"explorer\",\"prompt\":\"hidden\"}"
            }}),
            &mut add,
        );
        project(
            Provider::Copilot,
            &serde_json::json!({"type":"subagent.started", "data":{
                "toolCallId":"call_2", "agentDisplayName":"Researcher"
            }}),
            &mut add,
        );
        assert_eq!(
            events,
            vec![
                (Kind::Delegated, "explorer".into(), Some("call_1".into())),
                (Kind::Delegated, "Researcher".into(), Some("call_2".into())),
            ]
        );
    }

    #[test]
    fn antigravity_projects_steps_with_the_native_timestamp() {
        let mut file = tempfile::tempfile().unwrap();
        writeln!(file, "{}", serde_json::json!({
            "step_index": 1,
            "type": "PLANNER_RESPONSE",
            "created_at": "2026-11-23T10:00:00Z",
            "content": "Checked the replay fixture.",
            "thinking": "omitted"
        })).unwrap();
        let trace = read_trace(file, Provider::Agy, 0).unwrap();
        assert_eq!(trace.events.len(), 1);
        assert_eq!(trace.events[0].kind, Kind::Reply);
        assert_eq!(trace.events[0].text, "Checked the replay fixture.");
    }
}
