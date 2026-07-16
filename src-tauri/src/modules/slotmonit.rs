//! Read-only probe for the user's `slot-monit` shell helper.
//!
//! `slot-monit` is a shell function sourced from the user's rc files, not a
//! binary on PATH, so we must run their login+interactive shell to make it
//! resolvable. We only ever run a fixed script (an availability probe plus
//! `slot-monit all --json`); no caller input is interpolated into the shell.
//! When the helper is absent the feature is reported unavailable and the UI
//! hides itself.

use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use shared_child::SharedChild;

const TIMEOUT_SECS: u64 = 8;
const MAX_OUTPUT_BYTES: usize = 256 * 1024;
/// Non-standard exit code the probe uses to signal "command not found".
const MISSING_CODE: i32 = 66;

#[cfg(unix)]
const PROBE_SCRIPT: &str =
    "command -v slot-monit >/dev/null 2>&1 || exit 66\nslot-monit all --json 2>/dev/null";

#[derive(Serialize)]
pub struct SlotMonitResult {
    pub available: bool,
    pub raw: String,
}

fn interpret(timed_out: bool, exit_code: Option<i32>, stdout: String) -> SlotMonitResult {
    if timed_out {
        return SlotMonitResult {
            available: false,
            raw: String::new(),
        };
    }
    match exit_code {
        Some(code) if code == MISSING_CODE => SlotMonitResult {
            available: false,
            raw: String::new(),
        },
        _ => SlotMonitResult {
            available: true,
            raw: stdout,
        },
    }
}

#[cfg(unix)]
fn login_shell() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "/bin/sh".to_string())
}

#[cfg(unix)]
fn run_probe() -> SlotMonitResult {
    let mut cmd = Command::new(login_shell());
    cmd.arg("-lic").arg(PROBE_SCRIPT);
    if let Some(home) = dirs::home_dir() {
        cmd.current_dir(home);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::modules::proc::hide_console(&mut cmd);

    let child = match SharedChild::spawn(&mut cmd) {
        Ok(c) => Arc::new(c),
        Err(_) => {
            return SlotMonitResult {
                available: false,
                raw: String::new(),
            }
        }
    };

    let mut stdout_pipe = match child.take_stdout() {
        Some(p) => p,
        None => {
            let _ = child.kill();
            return SlotMonitResult {
                available: false,
                raw: String::new(),
            };
        }
    };
    let reader = thread::spawn(move || drain(&mut stdout_pipe));

    let (tx, rx) = mpsc::channel();
    let waiter = Arc::clone(&child);
    thread::spawn(move || {
        let _ = tx.send(waiter.wait());
    });

    let (exit_code, timed_out) = match rx.recv_timeout(Duration::from_secs(TIMEOUT_SECS)) {
        Ok(Ok(status)) => (status.code(), false),
        Ok(Err(_)) => (None, false),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            let _ = child.kill();
            let _ = child.wait();
            (None, true)
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => (None, false),
    };

    let stdout_bytes = reader.join().unwrap_or_default();
    interpret(
        timed_out,
        exit_code,
        String::from_utf8_lossy(&stdout_bytes).into_owned(),
    )
}

#[cfg(not(unix))]
fn run_probe() -> SlotMonitResult {
    SlotMonitResult {
        available: false,
        raw: String::new(),
    }
}

#[cfg(unix)]
fn drain(reader: &mut impl Read) -> Vec<u8> {
    let mut out = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if out.len() >= MAX_OUTPUT_BYTES {
                    continue;
                }
                let take = (MAX_OUTPUT_BYTES - out.len()).min(n);
                out.extend_from_slice(&buf[..take]);
            }
            Err(_) => break,
        }
    }
    out
}

#[tauri::command]
pub async fn slot_monit_query() -> Result<SlotMonitResult, String> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let _ = tx.send(run_probe());
    });
    rx.recv().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interpret_missing_code_reports_unavailable() {
        let r = interpret(false, Some(MISSING_CODE), String::new());
        assert!(!r.available);
        assert!(r.raw.is_empty());
    }

    #[test]
    fn interpret_timeout_reports_unavailable() {
        let r = interpret(true, None, "[]".into());
        assert!(!r.available);
    }

    #[test]
    fn interpret_success_keeps_stdout() {
        let r = interpret(false, Some(0), "[{\"slot\":1}]".into());
        assert!(r.available);
        assert_eq!(r.raw, "[{\"slot\":1}]");
    }

    #[test]
    fn interpret_nonzero_but_present_is_available_with_output() {
        let r = interpret(false, Some(1), String::new());
        assert!(r.available);
    }
}
