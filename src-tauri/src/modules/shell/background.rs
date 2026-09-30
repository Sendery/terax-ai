use std::io::Read;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::SystemTime;

use serde::Serialize;
use shared_child::SharedChild;

use super::ringbuffer::BoundedRingBuffer;
use crate::modules::workspace::{resolve_path, WorkspaceEnv};

const RING_CAP: usize = 4 * 1024 * 1024;

/// Exited processes kept around so their logs can still be read. Every
/// headless task run and every `bash_background` call used to stay in the map
/// for the life of the app, each holding up to `RING_CAP` of captured output.
pub const MAX_EXITED_RETAINED: usize = 8;

/// Handles to drop so that no more than `keep` exited processes remain.
///
/// Handles are minted monotonically, so the lowest ones are the oldest; the
/// newest exited entries survive because a caller normally reads a process's
/// final logs right after it ends. Running processes are never retired.
pub fn handles_to_retire(procs: &[(u32, bool)], keep: usize) -> Vec<u32> {
    let mut exited: Vec<u32> = procs
        .iter()
        .filter(|(_, exited)| *exited)
        .map(|(handle, _)| *handle)
        .collect();
    if exited.len() <= keep {
        return Vec::new();
    }
    exited.sort_unstable();
    exited.truncate(exited.len() - keep);
    exited
}

pub struct BackgroundProc {
    pub command: String,
    pub cwd: Option<String>,
    pub started_at_ms: u64,
    pub child: Arc<SharedChild>,
    pub buffer: Mutex<BoundedRingBuffer>,
    pub exited: AtomicBool,
    pub exit_code: AtomicI32,
    pub exit_unknown: AtomicBool,
}

#[derive(Serialize)]
pub struct BackgroundLogResponse {
    pub bytes: String,
    pub next_offset: u64,
    pub dropped: u64,
    pub exited: bool,
    pub exit_code: Option<i32>,
}

#[derive(Serialize)]
pub struct BackgroundProcInfo {
    pub handle: u32,
    pub command: String,
    pub cwd: Option<String>,
    pub started_at_ms: u64,
    pub exited: bool,
    pub exit_code: Option<i32>,
}

impl BackgroundProc {
    pub fn read_logs(&self, since: u64) -> BackgroundLogResponse {
        let (bytes, next_offset, dropped) = self.buffer.lock().unwrap().read_from(since);
        let exited = self.exited.load(Ordering::Acquire);
        let exit_code = if exited && !self.exit_unknown.load(Ordering::Acquire) {
            Some(self.exit_code.load(Ordering::Acquire))
        } else {
            None
        };
        BackgroundLogResponse {
            bytes: String::from_utf8_lossy(&bytes).into_owned(),
            next_offset,
            dropped,
            exited,
            exit_code,
        }
    }

    pub fn kill(&self) {
        let _ = self.child.kill();
    }

    pub fn info(&self, handle: u32) -> BackgroundProcInfo {
        let exited = self.exited.load(Ordering::Acquire);
        let exit_code = if exited && !self.exit_unknown.load(Ordering::Acquire) {
            Some(self.exit_code.load(Ordering::Acquire))
        } else {
            None
        };
        BackgroundProcInfo {
            handle,
            command: self.command.clone(),
            cwd: self.cwd.clone(),
            started_at_ms: self.started_at_ms,
            exited,
            exit_code,
        }
    }
}

impl Drop for BackgroundProc {
    fn drop(&mut self) {
        self.kill();
    }
}

pub fn spawn(
    command: String,
    cwd: Option<String>,
    workspace: WorkspaceEnv,
) -> Result<Arc<BackgroundProc>, String> {
    let trimmed = command.trim().to_string();
    if trimmed.is_empty() {
        return Err("empty command".into());
    }
    if let Some(ref dir) = cwd {
        if !resolve_path(dir, &workspace).is_dir() {
            return Err(format!("cwd is not a directory: {dir}"));
        }
    }

    let mut cmd = super::build_oneshot_command(&trimmed, &workspace, cwd.as_deref())?;
    if let (WorkspaceEnv::Local, Some(ref dir)) = (&workspace, &cwd) {
        cmd.current_dir(dir);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::modules::proc::hide_console(&mut cmd);

    let shared = Arc::new(SharedChild::spawn(&mut cmd).map_err(|e| e.to_string())?);
    let kill_on_fail = || {
        let _ = shared.kill();
    };
    let stdout_pipe = shared.take_stdout().ok_or_else(|| {
        kill_on_fail();
        "no stdout pipe".to_string()
    })?;
    let stderr_pipe = shared.take_stderr().ok_or_else(|| {
        kill_on_fail();
        "no stderr pipe".to_string()
    })?;
    let child = shared;

    let started_at_ms = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let proc = Arc::new(BackgroundProc {
        command: trimmed,
        cwd,
        started_at_ms,
        child,
        buffer: Mutex::new(BoundedRingBuffer::new(RING_CAP)),
        exited: AtomicBool::new(false),
        exit_code: AtomicI32::new(0),
        exit_unknown: AtomicBool::new(false),
    });

    {
        let proc_ref = proc.clone();
        let mut pipe = stdout_pipe;
        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match pipe.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => proc_ref.buffer.lock().unwrap().push(&buf[..n]),
                    Err(_) => break,
                }
            }
        });
    }
    {
        let proc_ref = proc.clone();
        let mut pipe = stderr_pipe;
        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match pipe.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => proc_ref.buffer.lock().unwrap().push(&buf[..n]),
                    Err(_) => break,
                }
            }
        });
    }
    {
        let proc_ref = proc.clone();
        let child_for_wait = proc.child.clone();
        thread::spawn(move || {
            match child_for_wait.wait() {
                Ok(status) => match status.code() {
                    Some(code) => proc_ref.exit_code.store(code, Ordering::Release),
                    None => proc_ref.exit_unknown.store(true, Ordering::Release),
                },
                Err(_) => proc_ref.exit_unknown.store(true, Ordering::Release),
            }
            proc_ref.exited.store(true, Ordering::Release);
        });
    }

    Ok(proc)
}

#[cfg(test)]
mod tests {
    use super::handles_to_retire;

    #[test]
    fn keeps_every_running_process_and_the_newest_exited_ones() {
        let procs = [(1, true), (2, false), (3, true), (4, true), (5, false), (6, true)];
        assert_eq!(handles_to_retire(&procs, 2), vec![1, 3]);
    }

    #[test]
    fn retires_nothing_while_within_the_cap() {
        let procs = [(1, true), (2, true), (3, false)];
        assert!(handles_to_retire(&procs, 2).is_empty());
        assert!(handles_to_retire(&[], 0).is_empty());
    }

    #[test]
    fn a_zero_cap_retires_every_exited_process() {
        let procs = [(7, true), (8, false), (9, true)];
        assert_eq!(handles_to_retire(&procs, 0), vec![7, 9]);
    }
}
