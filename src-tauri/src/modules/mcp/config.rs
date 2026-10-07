//! Registers `terax --mcp` with the coding-agent CLIs Terax drives, so their
//! sessions (in a terminal or in the chat panel) can control the app.
//!
//! Claude Code and Codex own their config through `mcp add`/`mcp remove`, so
//! Terax goes through those commands rather than editing files another
//! process may be writing. Cursor and OpenCode only have a JSON file; it is
//! edited atomically and never when it does not parse (a JSONC file with
//! comments stays untouched and the user gets the entry to paste).

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Map, Value};

use super::MCP_FLAG;
use crate::modules::agent_cli::{login_path, resolve_bin};

pub const SERVER_NAME: &str = "terax";
const CLI_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_CONFIG_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum TargetState {
    /// The agent CLI is not on this machine.
    NotInstalled,
    /// Installed, no `terax` server registered.
    Missing,
    /// Registered and pointing at this Terax binary.
    Current,
    /// Registered, but pointing at another binary or arguments.
    Stale,
    /// The config exists but cannot be read safely.
    Unreadable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetStatus {
    pub id: &'static str,
    pub label: &'static str,
    pub state: TargetState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub command: String,
    pub args: Vec<String>,
    pub targets: Vec<TargetStatus>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Target {
    Claude,
    Codex,
    Cursor,
    OpenCode,
}

const TARGETS: [Target; 4] = [
    Target::Claude,
    Target::Codex,
    Target::Cursor,
    Target::OpenCode,
];

impl Target {
    fn id(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Cursor => "cursor",
            Self::OpenCode => "opencode",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Claude => "Claude Code",
            Self::Codex => "Codex",
            Self::Cursor => "Cursor Agent",
            Self::OpenCode => "OpenCode",
        }
    }
}

/// `{ command, args }` as Claude, Codex and Cursor store a stdio server.
pub fn stdio_entry(command: &str) -> Value {
    json!({ "type": "stdio", "command": command, "args": [MCP_FLAG] })
}

/// OpenCode keeps the whole argv in `command` and needs `type: local`.
pub fn opencode_entry(command: &str) -> Value {
    json!({ "type": "local", "command": [command, MCP_FLAG], "enabled": true })
}

pub fn classify_stdio(entry: Option<&Value>, command: &str) -> TargetState {
    let Some(entry) = entry else {
        return TargetState::Missing;
    };
    let args_match = entry["args"]
        .as_array()
        .is_some_and(|a| a.len() == 1 && a[0] == MCP_FLAG);
    if entry["command"].as_str() == Some(command) && args_match {
        TargetState::Current
    } else {
        TargetState::Stale
    }
}

pub fn classify_opencode(entry: Option<&Value>, command: &str) -> TargetState {
    let Some(entry) = entry else {
        return TargetState::Missing;
    };
    let argv_match = entry["command"]
        .as_array()
        .is_some_and(|a| a.len() == 2 && a[0] == command && a[1] == MCP_FLAG);
    if argv_match && entry["enabled"] != Value::Bool(false) {
        TargetState::Current
    } else {
        TargetState::Stale
    }
}

/// Set `doc[path..][name] = entry`, creating objects on the way. Refuses to
/// replace anything that is not an object, so a surprising file is reported
/// rather than reshaped.
pub fn upsert_server(doc: Value, path: &[&str], name: &str, entry: Value) -> Result<Value, String> {
    let mut root = match doc {
        Value::Null => Value::Object(Map::new()),
        Value::Object(_) => doc,
        _ => return Err("the config file is not a JSON object".into()),
    };
    let mut cursor = &mut root;
    for key in path {
        let map = cursor.as_object_mut().ok_or("unexpected config shape")?;
        let next = map
            .entry(key.to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if !next.is_object() {
            return Err(format!("`{key}` in the config file is not an object"));
        }
        cursor = next;
    }
    cursor
        .as_object_mut()
        .ok_or("unexpected config shape")?
        .insert(name.to_string(), entry);
    Ok(root)
}

fn lookup<'a>(doc: &'a Value, path: &[&str]) -> Option<&'a Value> {
    path.iter()
        .try_fold(doc, |v, k| v.get(*k))
        .filter(|v| !v.is_null())
}

enum ConfigRead {
    Absent,
    Parsed(Value),
    Invalid(String),
}

fn read_json(path: &Path) -> ConfigRead {
    let Ok(meta) = std::fs::metadata(path) else {
        return ConfigRead::Absent;
    };
    if !meta.is_file() || meta.len() > MAX_CONFIG_BYTES {
        return ConfigRead::Invalid("not a regular file of reasonable size".into());
    }
    match std::fs::read_to_string(path) {
        Ok(text) if text.trim().is_empty() => ConfigRead::Parsed(Value::Null),
        Ok(text) => match serde_json::from_str(&text) {
            Ok(value) => ConfigRead::Parsed(value),
            Err(_) => ConfigRead::Invalid(
                "it is not plain JSON (comments or trailing commas?); add the entry by hand".into(),
            ),
        },
        Err(e) => ConfigRead::Invalid(e.to_string()),
    }
}

fn write_json_atomic(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    text.push('\n');
    let tmp = path.with_extension("terax-tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("replace {}: {e}", path.display())
    })
}

struct CliOutput {
    success: bool,
    stdout: String,
    stderr: String,
}

/// Run an agent CLI with the login PATH, no stdin and a deadline, so a CLI
/// waiting on input can never hang the settings flow.
fn run_cli(program: &Path, args: &[&str]) -> Result<CliOutput, String> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .env("PATH", login_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::modules::proc::hide_console(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let deadline = Instant::now() + CLI_TIMEOUT;
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            break;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("{} did not finish in time", program.display()));
        }
        std::thread::sleep(Duration::from_millis(40));
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    Ok(CliOutput {
        success: out.status.success(),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    })
}

fn last_line(text: &str) -> String {
    text.lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim()
        .to_string()
}

fn home() -> Option<PathBuf> {
    dirs::home_dir()
}

fn claude_config_path() -> Option<PathBuf> {
    match std::env::var_os("CLAUDE_CONFIG_DIR").filter(|d| !d.is_empty()) {
        Some(dir) => Some(PathBuf::from(dir).join(".claude.json")),
        None => Some(home()?.join(".claude.json")),
    }
}

fn cursor_config_path() -> Option<PathBuf> {
    Some(home()?.join(".cursor").join("mcp.json"))
}

fn opencode_config_path() -> Option<PathBuf> {
    let base = match std::env::var_os("XDG_CONFIG_HOME").filter(|d| !d.is_empty()) {
        Some(dir) => PathBuf::from(dir),
        None => home()?.join(".config"),
    };
    let dir = base.join("opencode");
    let jsonc = dir.join("opencode.jsonc");
    let json = dir.join("opencode.json");
    Some(if !json.exists() && jsonc.exists() {
        jsonc
    } else {
        json
    })
}

fn status_of(target: Target, command: &str) -> TargetStatus {
    let mut status = TargetStatus {
        id: target.id(),
        label: target.label(),
        state: TargetState::NotInstalled,
        location: None,
        detail: None,
    };
    let from_file =
        |status: &mut TargetStatus, path: Option<PathBuf>, keys: &[&str], opencode: bool| {
            let Some(path) = path else {
                status.state = TargetState::Unreadable;
                status.detail = Some("home directory not found".into());
                return;
            };
            status.location = Some(path.to_string_lossy().into_owned());
            match read_json(&path) {
                ConfigRead::Absent => status.state = TargetState::Missing,
                ConfigRead::Invalid(why) => {
                    status.state = TargetState::Unreadable;
                    status.detail = Some(why);
                }
                ConfigRead::Parsed(doc) => {
                    let entry = lookup(&doc, keys);
                    status.state = if opencode {
                        classify_opencode(entry, command)
                    } else {
                        classify_stdio(entry, command)
                    };
                    if status.state == TargetState::Stale {
                        status.detail = Some(describe_other(entry));
                    }
                }
            }
        };

    match target {
        Target::Claude => {
            if resolve_bin("claude").is_none() {
                return status;
            }
            from_file(
                &mut status,
                claude_config_path(),
                &["mcpServers", SERVER_NAME],
                false,
            );
        }
        Target::Codex => {
            let Some(codex) = resolve_bin("codex") else {
                return status;
            };
            status.location =
                home().map(|h| h.join(".codex/config.toml").to_string_lossy().into_owned());
            match run_cli(&codex, &["mcp", "get", SERVER_NAME, "--json"]) {
                Ok(out) if out.success => {
                    let parsed: Value = serde_json::from_str(&out.stdout).unwrap_or(Value::Null);
                    let transport = parsed.get("transport");
                    status.state = classify_stdio(transport, command);
                    if status.state == TargetState::Stale {
                        status.detail = Some(describe_other(transport));
                    }
                }
                Ok(_) => status.state = TargetState::Missing,
                Err(e) => {
                    status.state = TargetState::Unreadable;
                    status.detail = Some(e);
                }
            }
        }
        Target::Cursor => {
            let has_cursor = resolve_bin("cursor-agent").is_some()
                || home().is_some_and(|h| h.join(".cursor").is_dir());
            if !has_cursor {
                return status;
            }
            from_file(
                &mut status,
                cursor_config_path(),
                &["mcpServers", SERVER_NAME],
                false,
            );
        }
        Target::OpenCode => {
            if resolve_bin("opencode").is_none() {
                return status;
            }
            from_file(
                &mut status,
                opencode_config_path(),
                &["mcp", SERVER_NAME],
                true,
            );
        }
    }
    status
}

fn describe_other(entry: Option<&Value>) -> String {
    let command = entry
        .map(|e| match &e["command"] {
            Value::String(s) => s.clone(),
            Value::Array(a) => a
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" "),
            _ => String::new(),
        })
        .unwrap_or_default();
    if command.is_empty() {
        "Registered with an unexpected shape".into()
    } else {
        format!("Points at {command}")
    }
}

fn configure_target(target: Target, current: &TargetStatus, command: &str) -> Result<(), String> {
    let replacing = current.state == TargetState::Stale;
    match target {
        Target::Claude => {
            let claude = resolve_bin("claude").ok_or("claude is not installed")?;
            if replacing {
                let _ = run_cli(&claude, &["mcp", "remove", SERVER_NAME, "-s", "user"]);
            }
            let entry = stdio_entry(command).to_string();
            let out = run_cli(
                &claude,
                &["mcp", "add-json", SERVER_NAME, &entry, "-s", "user"],
            )?;
            out.success
                .then_some(())
                .ok_or_else(|| last_line(&format!("{}\n{}", out.stdout, out.stderr)))
        }
        Target::Codex => {
            let codex = resolve_bin("codex").ok_or("codex is not installed")?;
            if replacing {
                let _ = run_cli(&codex, &["mcp", "remove", SERVER_NAME]);
            }
            let out = run_cli(
                &codex,
                &["mcp", "add", SERVER_NAME, "--", command, MCP_FLAG],
            )?;
            out.success
                .then_some(())
                .ok_or_else(|| last_line(&format!("{}\n{}", out.stdout, out.stderr)))
        }
        Target::Cursor => {
            let path = cursor_config_path().ok_or("home directory not found")?;
            edit_json(&path, &["mcpServers"], stdio_entry(command))
        }
        Target::OpenCode => {
            let path = opencode_config_path().ok_or("home directory not found")?;
            edit_json(&path, &["mcp"], opencode_entry(command))
        }
    }
}

fn edit_json(path: &Path, parent: &[&str], entry: Value) -> Result<(), String> {
    let doc = match read_json(path) {
        ConfigRead::Absent => Value::Null,
        ConfigRead::Parsed(doc) => doc,
        ConfigRead::Invalid(why) => return Err(why),
    };
    let updated = upsert_server(doc, parent, SERVER_NAME, entry)?;
    write_json_atomic(path, &updated)
}

/// The command agents should launch: this very binary, so a sandbox build
/// registers itself and reaches its own instance.
pub fn server_command() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe = std::fs::canonicalize(&exe).unwrap_or(exe);
    Ok(exe.to_string_lossy().into_owned())
}

pub fn collect_status() -> Result<McpStatus, String> {
    let command = server_command()?;
    let targets = TARGETS.iter().map(|t| status_of(*t, &command)).collect();
    Ok(McpStatus {
        command,
        args: vec![MCP_FLAG.to_string()],
        targets,
    })
}

/// Register or repair the server on every installed CLI that lacks a current
/// entry. Per-target failures are reported in that target's `detail`.
pub fn configure_all() -> Result<McpStatus, String> {
    let command = server_command()?;
    let mut failures: Vec<(&'static str, String)> = Vec::new();
    for target in TARGETS {
        let current = status_of(target, &command);
        if matches!(current.state, TargetState::Missing | TargetState::Stale) {
            if let Err(e) = configure_target(target, &current, &command) {
                failures.push((target.id(), e));
            }
        }
    }
    let mut status = collect_status()?;
    for target in &mut status.targets {
        if let Some((_, why)) = failures.iter().find(|(id, _)| *id == target.id) {
            target.detail = Some(why.clone());
        }
    }
    Ok(status)
}

#[tauri::command]
pub async fn mcp_status() -> Result<McpStatus, String> {
    tauri::async_runtime::spawn_blocking(collect_status)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mcp_configure() -> Result<McpStatus, String> {
    tauri::async_runtime::spawn_blocking(configure_all)
        .await
        .map_err(|e| e.to_string())?
}
