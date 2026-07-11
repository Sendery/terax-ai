use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

pub const MAX_FRAME_BYTES: usize = 64 * 1024;
const FRAME_TIMEOUT: Duration = Duration::from_secs(5);
const UI_RESPONSE_TIMEOUT: Duration = Duration::from_secs(15);
const EVENT_EXTERNAL_COMMAND: &str = "terax:external-command";
const PROTOCOL_VERSION: u8 = 1;

static REQUEST_SEQ: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
pub struct PiBridgeState {
    pending: Mutex<HashMap<String, mpsc::Sender<UiCommandResult>>>,
    discovery_path: Mutex<Option<PathBuf>>,
}

impl Drop for PiBridgeState {
    fn drop(&mut self) {
        let Ok(path) = self.discovery_path.get_mut() else {
            return;
        };
        if let Some(path) = path.take() {
            let _ = fs::remove_file(path);
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct ClientRequest {
    pub version: u8,
    pub id: String,
    pub token: String,
    pub command: String,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UiCommandRequest {
    request_id: String,
    command: String,
    payload: Value,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct UiCommandResult {
    pub ok: bool,
    #[serde(default)]
    pub value: Option<Value>,
    #[serde(default)]
    pub error: Option<CommandError>,
}

#[derive(Debug, Serialize)]
struct ClientResponse<'a> {
    version: u8,
    id: &'a str,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<CommandError>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveryFile {
    version: u8,
    pid: u32,
    port: u16,
    token: String,
    started_at_ms: u128,
}

#[derive(Debug)]
pub enum ProtocolError {
    Io(String),
    FrameTooLarge,
    InvalidJson,
    UnsupportedVersion,
    Unauthorized,
    UnknownCommand,
    UiUnavailable,
    Timeout,
}

impl ProtocolError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Io(_) => "io_error",
            Self::FrameTooLarge => "frame_too_large",
            Self::InvalidJson => "invalid_json",
            Self::UnsupportedVersion => "unsupported_version",
            Self::Unauthorized => "unauthorized",
            Self::UnknownCommand => "unknown_command",
            Self::UiUnavailable => "ui_unavailable",
            Self::Timeout => "timeout",
        }
    }

    fn message(&self) -> String {
        match self {
            Self::Io(message) => message.clone(),
            Self::FrameTooLarge => "Frame exceeds maximum size".to_string(),
            Self::InvalidJson => "Frame is not valid JSON".to_string(),
            Self::UnsupportedVersion => "Unsupported protocol version".to_string(),
            Self::Unauthorized => "Invalid bridge token".to_string(),
            Self::UnknownCommand => "Command is not allowlisted".to_string(),
            Self::UiUnavailable => "Terax UI is unavailable".to_string(),
            Self::Timeout => "Bridge request timed out".to_string(),
        }
    }
}

fn is_allowed_command(command: &str) -> bool {
    matches!(
        command,
        "app.snapshot"
            | "sidebar.show"
            | "sidebar.hide"
            | "tab.openFile"
            | "tab.focus"
            | "tab.close"
            | "tab.rename"
            | "tab.resetTitle"
            | "git.diff.open"
            | "settings.open"
    )
}

pub fn read_frame<R: Read>(reader: &mut R) -> Result<Vec<u8>, ProtocolError> {
    let mut frame = Vec::new();
    let mut byte = [0_u8; 1];
    loop {
        match reader.read(&mut byte) {
            Ok(0) => {
                if frame.is_empty() {
                    return Err(ProtocolError::Io("Connection closed".to_string()));
                }
                break;
            }
            Ok(_) => {
                if byte[0] == b'\n' {
                    break;
                }
                frame.push(byte[0]);
                if frame.len() > MAX_FRAME_BYTES {
                    return Err(ProtocolError::FrameTooLarge);
                }
            }
            Err(err) => return Err(ProtocolError::Io(err.to_string())),
        }
    }
    Ok(frame)
}

pub fn decode_request_line(line: &[u8], token: &str) -> Result<ClientRequest, ProtocolError> {
    let request: ClientRequest =
        serde_json::from_slice(line).map_err(|_| ProtocolError::InvalidJson)?;
    if request.version != PROTOCOL_VERSION {
        return Err(ProtocolError::UnsupportedVersion);
    }
    if request.token != token {
        return Err(ProtocolError::Unauthorized);
    }
    if !is_allowed_command(&request.command) {
        return Err(ProtocolError::UnknownCommand);
    }
    Ok(request)
}

fn cache_file_path() -> Result<PathBuf, String> {
    let base = dirs::cache_dir().ok_or_else(|| "Unable to resolve cache directory".to_string())?;
    Ok(base.join("terax-ai").join("pi-bridge.json"))
}

fn random_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    fill_random(&mut bytes)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

#[cfg(unix)]
fn fill_random(bytes: &mut [u8]) -> Result<(), String> {
    use std::io::Read;
    let mut file = fs::File::open("/dev/urandom").map_err(|e| e.to_string())?;
    file.read_exact(bytes).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn fill_random(bytes: &mut [u8]) -> Result<(), String> {
    use windows_sys::Win32::Security::Cryptography::{
        BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
    };
    let status = unsafe {
        BCryptGenRandom(
            0,
            bytes.as_mut_ptr(),
            bytes.len() as u32,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    };
    if status == 0 {
        Ok(())
    } else {
        Err(format!("BCryptGenRandom failed with status {status}"))
    }
}

fn write_discovery(path: &PathBuf, port: u16, token: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let _ = fs::remove_file(path);
    let discovery = DiscoveryFile {
        version: PROTOCOL_VERSION,
        pid: std::process::id(),
        port,
        token: token.to_string(),
        started_at_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis(),
    };
    let tmp = path.with_extension(format!("json.tmp.{}", std::process::id()));
    let bytes = serde_json::to_vec_pretty(&discovery).map_err(|e| e.to_string())?;
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600));
    }
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

fn next_request_id() -> String {
    let seq = REQUEST_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("pi-{seq}")
}

fn send_error(stream: &mut TcpStream, id: &str, error: ProtocolError) {
    let response = ClientResponse {
        version: PROTOCOL_VERSION,
        id,
        ok: false,
        value: None,
        error: Some(CommandError {
            code: error.code().to_string(),
            message: error.message(),
        }),
    };
    let _ = serde_json::to_writer(&mut *stream, &response);
    let _ = stream.write_all(b"\n");
}

fn send_result(stream: &mut TcpStream, id: &str, result: UiCommandResult) {
    let response = ClientResponse {
        version: PROTOCOL_VERSION,
        id,
        ok: result.ok,
        value: result.value,
        error: result.error,
    };
    let _ = serde_json::to_writer(&mut *stream, &response);
    let _ = stream.write_all(b"\n");
}

fn handle_client(app: AppHandle, mut stream: TcpStream, token: String) {
    let _ = stream.set_read_timeout(Some(FRAME_TIMEOUT));
    let _ = stream.set_write_timeout(Some(FRAME_TIMEOUT));

    let frame = match read_frame(&mut stream) {
        Ok(frame) => frame,
        Err(err) => {
            send_error(&mut stream, "", err);
            return;
        }
    };

    let request = match decode_request_line(&frame, &token) {
        Ok(request) => request,
        Err(err) => {
            let id = serde_json::from_slice::<Value>(&frame)
                .ok()
                .and_then(|v| v.get("id").and_then(Value::as_str).map(str::to_string))
                .unwrap_or_default();
            send_error(&mut stream, &id, err);
            return;
        }
    };

    let bridge_id = next_request_id();
    let (tx, rx) = mpsc::channel();
    let state = app.state::<PiBridgeState>();
    if let Ok(mut pending) = state.pending.lock() {
        pending.insert(bridge_id.clone(), tx);
    } else {
        send_error(&mut stream, &request.id, ProtocolError::UiUnavailable);
        return;
    }

    let payload = UiCommandRequest {
        request_id: bridge_id.clone(),
        command: request.command,
        payload: request.payload,
    };

    if app
        .emit_to("main", EVENT_EXTERNAL_COMMAND, payload)
        .is_err()
    {
        let _ = state.pending.lock().map(|mut p| p.remove(&bridge_id));
        send_error(&mut stream, &request.id, ProtocolError::UiUnavailable);
        return;
    }

    match rx.recv_timeout(UI_RESPONSE_TIMEOUT) {
        Ok(result) => send_result(&mut stream, &request.id, result),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            let _ = state.pending.lock().map(|mut p| p.remove(&bridge_id));
            send_error(&mut stream, &request.id, ProtocolError::Timeout);
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            send_error(&mut stream, &request.id, ProtocolError::UiUnavailable);
        }
    }
}

pub fn start_bridge(app: AppHandle) -> Result<(), String> {
    let token = random_token()?;
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let discovery_path = cache_file_path()?;
    write_discovery(&discovery_path, port, &token)?;
    if let Ok(mut path) = app.state::<PiBridgeState>().discovery_path.lock() {
        *path = Some(discovery_path);
    }

    thread::Builder::new()
        .name("pi-bridge".to_string())
        .spawn(move || {
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => {
                        let app = app.clone();
                        let token = token.clone();
                        let _ = thread::Builder::new()
                            .name("pi-bridge-client".to_string())
                            .spawn(move || handle_client(app, stream, token));
                    }
                    Err(err) => {
                        log::warn!("pi bridge accept failed: {err}");
                    }
                }
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn external_command_respond(
    state: State<'_, PiBridgeState>,
    request_id: String,
    result: UiCommandResult,
) -> Result<(), String> {
    let sender = state
        .pending
        .lock()
        .map_err(|_| "Pi bridge pending map poisoned".to_string())?
        .remove(&request_id)
        .ok_or_else(|| "Unknown external command request".to_string())?;
    sender.send(result).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_authenticated_request_frame() {
        let line =
            br#"{"version":1,"id":"r1","token":"tok","command":"app.snapshot","payload":null}"#;
        let request = decode_request_line(line, "tok").expect("valid frame");

        assert_eq!(request.id, "r1");
        assert_eq!(request.command, "app.snapshot");
        assert_eq!(request.payload, serde_json::Value::Null);
    }

    #[test]
    fn rejects_wrong_token() {
        let line = br#"{"version":1,"id":"r1","token":"bad","command":"app.snapshot"}"#;
        let err = decode_request_line(line, "tok").expect_err("auth failure");

        assert_eq!(err.code(), "unauthorized");
    }

    #[test]
    fn rejects_oversized_frames() {
        let mut input = vec![b'a'; MAX_FRAME_BYTES + 1];
        input.push(b'\n');
        let err = read_frame(&mut &input[..]).expect_err("frame cap");

        assert_eq!(err.code(), "frame_too_large");
    }
}
