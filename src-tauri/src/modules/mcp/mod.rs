//! MCP server over stdio, run as `terax --mcp` before any Tauri state exists.
//!
//! It is a thin, data-driven relay: `surface.json` (generated from the
//! frontend command registry by `src/modules/commands/lib/mcpSurface.ts`)
//! groups the registry commands into a few tools, and each call is forwarded
//! to the running instance over the same authenticated loopback bridge Pi
//! uses. Nothing here knows a command by name, so a new registry command only
//! needs the manifest regenerated.

pub mod config;

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Map, Value};

pub const MCP_FLAG: &str = "--mcp";

const SURFACE_JSON: &str = include_str!("surface.json");
/// Newest first; an unknown client version is answered with the newest.
const PROTOCOL_VERSIONS: &[&str] = &["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_MESSAGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_BRIDGE_RESPONSE_BYTES: u64 = 16 * 1024 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
/// The bridge itself gives the UI 15 s to answer.
const BRIDGE_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_WAIT_MS: u64 = 30_000;
const DISCOVERY_FILE: &str = "pi-bridge.json";

static REQUEST_SEQ: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Deserialize)]
pub struct Surface {
    pub server: ServerInfo,
    pub tools: Vec<SurfaceTool>,
}

#[derive(Debug, Deserialize)]
pub struct ServerInfo {
    pub name: String,
    pub title: String,
    pub instructions: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceTool {
    pub name: String,
    pub title: String,
    pub description: String,
    pub annotations: Value,
    pub input_schema: Value,
    pub actions: BTreeMap<String, SurfaceAction>,
}

#[derive(Debug, Deserialize)]
pub struct SurfaceAction {
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub local: Option<String>,
    pub params: Vec<String>,
}

pub fn surface() -> &'static Surface {
    static SURFACE: OnceLock<Surface> = OnceLock::new();
    // The manifest is compiled in and parsed by a unit test, so a bad file
    // fails the build's tests rather than a user's session.
    SURFACE.get_or_init(|| serde_json::from_str(SURFACE_JSON).expect("embedded MCP surface"))
}

pub fn is_mcp_invocation() -> bool {
    std::env::args().skip(1).any(|arg| arg == MCP_FLAG)
}

#[derive(Debug, Clone, PartialEq)]
pub struct BridgeError {
    pub code: String,
    pub message: String,
}

impl BridgeError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
        }
    }
}

/// What the server needs from a running Terax. A trait so the protocol layer
/// is tested without sockets.
pub trait Bridge {
    fn call(&self, command: &str, payload: Value) -> Result<Value, BridgeError>;
    fn status(&self) -> Value;
}

pub struct TcpBridge {
    discovery: PathBuf,
}

impl TcpBridge {
    /// The instance a Terax terminal advertises, else this profile's own.
    pub fn from_env() -> Option<Self> {
        let advertised = std::env::var_os("TERAX_PI_DISCOVERY").map(PathBuf::from);
        let discovery = advertised
            .filter(|p| is_discovery_path(p))
            .or_else(|| crate::modules::pi::cache_file_path().ok())?;
        Some(Self { discovery })
    }
}

fn is_discovery_path(path: &Path) -> bool {
    path.is_absolute() && path.file_name().is_some_and(|n| n == DISCOVERY_FILE)
}

impl Bridge for TcpBridge {
    fn call(&self, command: &str, payload: Value) -> Result<Value, BridgeError> {
        let not_running = || {
            BridgeError::new(
                "not_running",
                "Terax is not running, or its bridge is unreachable. Ask the user to open Terax, then retry.",
            )
        };
        let instance =
            crate::modules::pi::read_instance_at(&self.discovery).ok_or_else(not_running)?;
        let address = SocketAddr::from(([127, 0, 0, 1], instance.port));
        let mut stream =
            TcpStream::connect_timeout(&address, CONNECT_TIMEOUT).map_err(|_| not_running())?;
        let _ = stream.set_read_timeout(Some(BRIDGE_TIMEOUT));
        let _ = stream.set_write_timeout(Some(BRIDGE_TIMEOUT));
        let frame = json!({
            "version": 1,
            "id": format!("mcp-{}", REQUEST_SEQ.fetch_add(1, Ordering::Relaxed)),
            "token": instance.token,
            "command": command,
            "payload": payload,
        });
        writeln!(stream, "{frame}").map_err(|_| not_running())?;
        let mut line = String::new();
        BufReader::new(stream.take(MAX_BRIDGE_RESPONSE_BYTES))
            .read_line(&mut line)
            .map_err(|e| BridgeError::new("timeout", format!("No answer from Terax: {e}")))?;
        parse_bridge_response(&line)
    }

    fn status(&self) -> Value {
        let instance = crate::modules::pi::read_instance_at(&self.discovery);
        let reachable = instance.is_some() && self.call("app.buildInfo", Value::Null).is_ok();
        json!({
            "running": reachable,
            "pid": instance.as_ref().map(|i| i.pid),
            "discovery": self.discovery.to_string_lossy(),
            "server": env!("CARGO_PKG_VERSION"),
        })
    }
}

pub fn parse_bridge_response(line: &str) -> Result<Value, BridgeError> {
    let response: Value = serde_json::from_str(line.trim())
        .map_err(|_| BridgeError::new("invalid_response", "Terax sent an unreadable answer"))?;
    if response["ok"] == Value::Bool(true) {
        return Ok(response.get("value").cloned().unwrap_or(Value::Null));
    }
    let error = &response["error"];
    Err(BridgeError::new(
        error["code"].as_str().unwrap_or("command_failed"),
        error["message"].as_str().unwrap_or("Command failed"),
    ))
}

fn recovery_hint(code: &str) -> &'static str {
    match code {
        "invalid_payload" | "unknown_command" => {
            " Call terax_inspect with action list_commands for the exact arguments."
        }
        "unauthorized" | "unsupported_version" => {
            " The bridge file is stale or from another version; restarting Terax refreshes it."
        }
        "timeout" | "ui_unavailable" => {
            " Terax did not answer in time; it may be busy or minimized. Retry, or check terax_inspect status."
        }
        _ => "",
    }
}

fn tool_success(value: Value) -> Value {
    let text = serde_json::to_string(&value).unwrap_or_default();
    let structured = if value.is_object() {
        value
    } else {
        json!({ "result": value })
    };
    json!({
        "content": [{ "type": "text", "text": text }],
        "structuredContent": structured,
        "isError": false,
    })
}

fn tool_failure(message: String) -> Value {
    json!({
        "content": [{ "type": "text", "text": message }],
        "isError": true,
    })
}

fn action_list(tool: &SurfaceTool) -> String {
    tool.actions.keys().cloned().collect::<Vec<_>>().join(", ")
}

/// Run one tool call. Problems an agent can fix (wrong action, stray
/// argument, Terax closed) come back as tool errors with the fix spelled out,
/// never as protocol errors, so the model can recover on its own.
pub fn call_tool(tool: &SurfaceTool, arguments: &Map<String, Value>, bridge: &dyn Bridge) -> Value {
    let Some(action_name) = arguments.get("action").and_then(Value::as_str) else {
        return tool_failure(format!(
            "{} needs an action: one of {}.",
            tool.name,
            action_list(tool)
        ));
    };
    let Some(action) = tool.actions.get(action_name) else {
        return tool_failure(format!(
            "{} has no action {action_name}. Use one of {}.",
            tool.name,
            action_list(tool)
        ));
    };

    let stray: Vec<&str> = arguments
        .keys()
        .map(String::as_str)
        .filter(|k| *k != "action" && !action.params.iter().any(|p| p == k))
        .collect();
    if !stray.is_empty() {
        let takes = if action.params.is_empty() {
            "no arguments".to_string()
        } else {
            action.params.join(", ")
        };
        return tool_failure(format!(
            "{action_name} does not take {}; it takes {takes}.",
            stray.join(", ")
        ));
    }

    match (action.command.as_deref(), action.local.as_deref()) {
        (Some(command), _) => {
            let payload: Map<String, Value> = arguments
                .iter()
                .filter(|(k, _)| *k != "action")
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();
            let payload = if payload.is_empty() {
                Value::Null
            } else {
                Value::Object(payload)
            };
            match bridge.call(command, payload) {
                Ok(value) => tool_success(value),
                Err(e) => tool_failure(format!(
                    "{}: {}.{}",
                    e.code,
                    e.message.trim_end_matches('.'),
                    recovery_hint(&e.code)
                )),
            }
        }
        (None, Some("status")) => tool_success(bridge.status()),
        (None, Some("wait")) => {
            let Some(ms) = arguments.get("ms").and_then(Value::as_u64) else {
                return tool_failure("wait needs ms, a whole number from 0 to 30000.".into());
            };
            let ms = ms.min(MAX_WAIT_MS);
            std::thread::sleep(Duration::from_millis(ms));
            tool_success(json!({ "waitedMs": ms }))
        }
        _ => tool_failure(format!("{action_name} is not available in this build.")),
    }
}

fn negotiate_version(requested: Option<&str>) -> &'static str {
    requested
        .and_then(|v| PROTOCOL_VERSIONS.iter().find(|known| **known == v).copied())
        .unwrap_or(PROTOCOL_VERSIONS[0])
}

fn rpc_result(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn tools_list(surface: &Surface) -> Value {
    let tools: Vec<Value> = surface
        .tools
        .iter()
        .map(|t| {
            json!({
                "name": t.name,
                "title": t.title,
                "description": t.description,
                "inputSchema": t.input_schema,
                "annotations": t.annotations,
            })
        })
        .collect();
    json!({ "tools": tools })
}

/// Answer one JSON-RPC message. `None` for notifications, which get no reply.
pub fn handle_message(message: &Value, surface: &Surface, bridge: &dyn Bridge) -> Option<Value> {
    let Some(obj) = message.as_object() else {
        return Some(rpc_error(Value::Null, -32600, "Expected a JSON-RPC object"));
    };
    let id = obj.get("id").cloned();
    let method = obj.get("method").and_then(Value::as_str);
    let (Some(id), Some(method)) = (id, method) else {
        // Notifications (initialized, cancelled) and stray responses.
        return None;
    };
    let params = obj.get("params").cloned().unwrap_or(Value::Null);

    let response = match method {
        "initialize" => rpc_result(
            id,
            json!({
                "protocolVersion": negotiate_version(params["protocolVersion"].as_str()),
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": {
                    "name": surface.server.name,
                    "title": surface.server.title,
                    "version": env!("CARGO_PKG_VERSION"),
                },
                "instructions": surface.server.instructions,
            }),
        ),
        "ping" => rpc_result(id, json!({})),
        "tools/list" => rpc_result(id, tools_list(surface)),
        "tools/call" => {
            let name = params["name"].as_str().unwrap_or_default();
            match surface.tools.iter().find(|t| t.name == name) {
                None => rpc_error(id, -32602, &format!("Unknown tool: {name}")),
                Some(tool) => {
                    let empty = Map::new();
                    let arguments = params["arguments"].as_object().unwrap_or(&empty);
                    rpc_result(id, call_tool(tool, arguments, bridge))
                }
            }
        }
        _ => rpc_error(id, -32601, &format!("Method not found: {method}")),
    };
    Some(response)
}

type BoundedLine = Result<Vec<u8>, ()>;

/// Read one LF-terminated line, refusing lines over `max` bytes. `Ok(None)`
/// at end of input; an oversized line is consumed whole and reported as `Err`.
fn read_line_bounded<R: BufRead>(
    reader: &mut R,
    max: usize,
) -> std::io::Result<Option<BoundedLine>> {
    let mut line = Vec::new();
    let mut oversized = false;
    let mut read_any = false;
    loop {
        let buf = reader.fill_buf()?;
        if buf.is_empty() {
            if !read_any {
                return Ok(None);
            }
            break;
        }
        read_any = true;
        let newline = buf.iter().position(|b| *b == b'\n');
        let end = newline.unwrap_or(buf.len());
        if !oversized {
            if line.len() + end > max {
                oversized = true;
                line = Vec::new();
            } else {
                line.extend_from_slice(&buf[..end]);
            }
        }
        reader.consume(newline.map_or(end, |i| i + 1));
        if newline.is_some() {
            break;
        }
    }
    Ok(Some(if oversized { Err(()) } else { Ok(line) }))
}

/// Serve MCP on stdin/stdout until the client closes stdin. Stdout carries
/// only protocol messages; diagnostics go to stderr.
pub fn serve<R: BufRead, W: Write>(
    mut input: R,
    mut output: W,
    bridge: &dyn Bridge,
) -> std::io::Result<()> {
    let surface = surface();
    while let Some(line) = read_line_bounded(&mut input, MAX_MESSAGE_BYTES)? {
        let response = match line {
            Err(()) => Some(rpc_error(Value::Null, -32600, "Message too large")),
            Ok(bytes) => {
                let text = String::from_utf8_lossy(&bytes);
                let text = text.trim();
                if text.is_empty() {
                    continue;
                }
                match serde_json::from_str::<Value>(text) {
                    Ok(message) => handle_message(&message, surface, bridge),
                    Err(_) => Some(rpc_error(Value::Null, -32700, "Parse error")),
                }
            }
        };
        if let Some(response) = response {
            serde_json::to_writer(&mut output, &response)?;
            output.write_all(b"\n")?;
            output.flush()?;
        }
    }
    Ok(())
}

/// Entry point for `terax --mcp`. Returns the process exit code.
pub fn run_stdio() -> i32 {
    let Some(bridge) = TcpBridge::from_env() else {
        eprintln!("terax --mcp: cannot resolve the Terax cache directory");
        return 1;
    };
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    match serve(stdin.lock(), stdout.lock(), &bridge) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("terax --mcp: {e}");
            1
        }
    }
}

#[cfg(test)]
mod tests;
