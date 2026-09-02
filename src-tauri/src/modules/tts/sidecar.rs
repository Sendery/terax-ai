//! Sidecar process lifecycle.
//!
//! One process per engine, bound to loopback on a port it chooses, gated by a
//! per-launch token that only ever travels in the environment. The port is
//! learned from a single ready line on stdout rather than by probing, so a
//! sidecar that failed to load reports the failure instead of timing out.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use shared_child::SharedChild;

use super::engines::{Device, Engine};
use super::env::{apply_env, child_env, HostDirs};
use super::jobs::LogSink;
use super::layout::Layout;

pub const READY_TIMEOUT: Duration = Duration::from_secs(30);
pub const SHUTDOWN_GRACE: Duration = Duration::from_secs(2);
/// A ready line is a fixed-shape JSON object; anything longer is a runaway
/// print and must not be buffered without bound.
const MAX_READY_LINE: usize = 4096;
/// How much of the sidecar's own output is quoted back in a startup error.
const MAX_ERROR_TAIL: usize = 512;

#[derive(Deserialize)]
struct ReadyLine {
    ready: bool,
    port: u16,
}

/// Parses the one line the sidecar prints once it is listening.
pub fn parse_ready_line(line: &str) -> Result<u16, String> {
    let line = line.trim();
    if line.is_empty() || line.len() > MAX_READY_LINE {
        return Err("sidecar did not print a ready line".into());
    }
    let parsed: ReadyLine =
        serde_json::from_str(line).map_err(|_| "sidecar printed an unreadable ready line")?;
    if !parsed.ready {
        return Err("sidecar reported it is not ready".into());
    }
    if parsed.port == 0 {
        return Err("sidecar reported an invalid port".into());
    }
    Ok(parsed.port)
}

pub struct Sidecar {
    pub engine: Engine,
    pub device: Device,
    pub port: u16,
    pub token: String,
    pub pid: u32,
    child: Arc<SharedChild>,
    /// Held open and never written to. The sidecar also exits on stdin EOF, so
    /// dropping this pipe is a second, kernel-enforced way for the process to
    /// end when Terax goes away without running any handler.
    stdin: Mutex<Option<ChildStdin>>,
    #[cfg(windows)]
    _job: Option<crate::modules::pty::job::PtyJob>,
}

impl Sidecar {
    pub fn is_alive(&self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    /// Closing stdin asks the sidecar to exit without a signal.
    pub fn close_stdin(&self) {
        if let Ok(mut stdin) = self.stdin.lock() {
            *stdin = None;
        }
    }

    /// Kills and reaps. Without the wait the child lingers as a zombie for the
    /// lifetime of the Terax process, so restarting an engine repeatedly would
    /// accumulate defunct entries in the process table.
    pub fn kill(&self) {
        self.close_stdin();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }

    /// Polls rather than blocking on `wait`, because the caller also wants to
    /// give up and kill after the grace period.
    pub fn wait_for_exit(&self, grace: Duration) -> bool {
        let deadline = Instant::now() + grace;
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => return true,
                Err(_) => return true,
                Ok(None) => {}
            }
            if Instant::now() >= deadline {
                return false;
            }
            thread::sleep(Duration::from_millis(25));
        }
    }

    /// Graceful stop: close stdin, wait out the grace period, then kill
    /// whatever is left.
    pub fn stop(&self, grace: Duration) {
        self.close_stdin();
        if self.wait_for_exit(grace) {
            let _ = self.child.wait();
        } else {
            self.kill();
        }
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        self.kill();
    }
}

pub fn shutdown_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/shutdown")
}

/// Best-effort graceful shutdown. A failure here is not an error for the
/// caller: the process is killed next.
pub async fn request_shutdown(port: u16, token: &str) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(SHUTDOWN_GRACE)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    client
        .post(shutdown_url(port))
        .bearer_auth(token)
        .send()
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub fn spawn(
    layout: &Layout,
    engine: Engine,
    device: Device,
    token: String,
) -> Result<Sidecar, String> {
    let python = layout.venv_python(engine);
    if !python.is_file() {
        return Err(format!("{} is not installed", engine.id()));
    }
    let entry = layout.server_entry();
    if !entry.is_file() {
        return Err("the sidecar sources are missing; reinstall the engine".into());
    }
    layout.ensure().map_err(|e| e.to_string())?;

    let mut cmd = Command::new(&python);
    cmd.arg("-u")
        .arg(&entry)
        .arg("--engine")
        .arg(engine.id())
        .arg("--device")
        .arg(device.id())
        .arg("--samples-dir")
        .arg(layout.samples())
        .current_dir(layout.server())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_env(
        &mut cmd,
        &child_env(layout, &HostDirs::resolve(), Some(&token)),
    );
    crate::modules::proc::hide_console(&mut cmd);

    let child = Arc::new(SharedChild::spawn(&mut cmd).map_err(|e| e.to_string())?);
    let pid = child.id();
    let Some(stdin) = child.take_stdin() else {
        let _ = child.kill();
        return Err("sidecar has no stdin pipe".into());
    };

    #[cfg(windows)]
    let job = crate::modules::pty::job::PtyJob::create_for(pid).ok();

    let sink = match LogSink::open(&layout.server_log(engine)) {
        Ok(sink) => Arc::new(Mutex::new(sink)),
        Err(error) => {
            let _ = child.kill();
            return Err(format!("cannot open the sidecar log: {error}"));
        }
    };

    let Some(stdout) = child.take_stdout() else {
        let _ = child.kill();
        return Err("sidecar has no stdout pipe".into());
    };
    let stderr_tail = child
        .take_stderr()
        .map(|stderr| tail(stderr, Arc::clone(&sink), format!("[{}] ", engine.id())));

    let (ready_tx, ready_rx) = mpsc::channel::<Result<u16, String>>();
    {
        let sink = Arc::clone(&sink);
        let prefix = format!("[{}] ", engine.id());
        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut first = String::new();
            let outcome = match reader.read_line(&mut first) {
                Ok(0) => Err("sidecar exited before reporting a port".to_string()),
                Ok(_) => parse_ready_line(&first),
                Err(error) => Err(error.to_string()),
            };
            if !first.trim().is_empty() {
                if let Ok(mut sink) = sink.lock() {
                    sink.write(prefix.as_bytes());
                    sink.write(first.as_bytes());
                    if !first.ends_with('\n') {
                        sink.write(b"\n");
                    }
                }
            }
            let _ = ready_tx.send(outcome);
            tail_reader(reader, sink, prefix);
        });
    }

    let ready = match ready_rx.recv_timeout(READY_TIMEOUT) {
        Ok(Ok(port)) => port,
        Ok(Err(error)) => {
            return Err(fail(&child, stderr_tail, layout, engine, error));
        }
        Err(_) => {
            let error = format!(
                "{} did not become ready within {}s",
                engine.id(),
                READY_TIMEOUT.as_secs()
            );
            return Err(fail(&child, stderr_tail, layout, engine, error));
        }
    };

    Ok(Sidecar {
        engine,
        device,
        port: ready,
        token,
        pid,
        child,
        stdin: Mutex::new(Some(stdin)),
        #[cfg(windows)]
        _job: job,
    })
}

/// Kills the child and returns `error` with the tail of what the sidecar
/// actually printed. Without this the caller only ever sees "exited before
/// reporting a port", which says nothing about a bad token or a failed import.
fn fail(
    child: &Arc<SharedChild>,
    stderr_tail: Option<thread::JoinHandle<()>>,
    layout: &Layout,
    engine: Engine,
    error: String,
) -> String {
    let _ = child.kill();
    let _ = child.wait();
    if let Some(handle) = stderr_tail {
        let _ = handle.join();
    }
    match log_tail(&layout.server_log(engine), MAX_ERROR_TAIL) {
        tail if tail.is_empty() => error,
        tail => format!("{error}: {tail}"),
    }
}

/// The last `max` bytes of a log, whitespace-collapsed onto one line so it fits
/// in an error string.
fn log_tail(path: &Path, max: usize) -> String {
    let Ok(bytes) = std::fs::read(path) else {
        return String::new();
    };
    let from = bytes.len().saturating_sub(max);
    String::from_utf8_lossy(&bytes[from..])
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn tail<R: std::io::Read + Send + 'static>(
    pipe: R,
    sink: Arc<Mutex<LogSink>>,
    prefix: String,
) -> thread::JoinHandle<()> {
    thread::spawn(move || tail_reader(BufReader::new(pipe), sink, prefix))
}

fn tail_reader<R: std::io::Read>(
    mut reader: BufReader<R>,
    sink: Arc<Mutex<LogSink>>,
    prefix: String,
) {
    let mut line = Vec::new();
    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                if line.iter().all(|b| b.is_ascii_whitespace()) {
                    continue;
                }
                if let Ok(mut sink) = sink.lock() {
                    sink.write(prefix.as_bytes());
                    sink.write(&line);
                    if !line.ends_with(b"\n") {
                        sink.write(b"\n");
                    }
                }
            }
        }
    }
}

pub fn log_path(layout: &Layout, engine: Engine) -> PathBuf {
    layout.server_log(engine)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_documented_ready_line() {
        assert_eq!(
            parse_ready_line("{\"ready\":true,\"port\":54321}"),
            Ok(54321)
        );
        assert_eq!(
            parse_ready_line("  {\"ready\": true, \"port\": 1}\n"),
            Ok(1)
        );
        assert_eq!(
            parse_ready_line("{\"port\":8080,\"ready\":true,\"engine\":\"kokoro\"}"),
            Ok(8080)
        );
        assert_eq!(
            parse_ready_line("{\"ready\":true,\"port\":65535}"),
            Ok(65535)
        );
    }

    #[test]
    fn rejects_garbage() {
        for line in [
            "",
            "   ",
            "\n",
            "loading kokoro...",
            "Traceback (most recent call last):",
            "{",
            "{\"ready\":true,",
            "null",
            "[]",
            "\"ready\"",
        ] {
            assert!(parse_ready_line(line).is_err(), "{line:?} must be rejected");
        }
        let long = format!(
            "{{\"ready\":true,\"port\":1,\"pad\":\"{}\"}}",
            "x".repeat(5000)
        );
        assert!(parse_ready_line(&long).is_err());
    }

    #[test]
    fn rejects_the_wrong_shape() {
        for line in [
            "{\"ready\":false,\"port\":8080}",
            "{\"ready\":true}",
            "{\"port\":8080}",
            "{\"ready\":true,\"port\":0}",
            "{\"ready\":true,\"port\":-1}",
            "{\"ready\":true,\"port\":70000}",
            "{\"ready\":true,\"port\":\"8080\"}",
            "{\"ready\":\"true\",\"port\":8080}",
            "{\"ready\":1,\"port\":8080}",
            "{\"ready\":true,\"port\":8080.5}",
        ] {
            assert!(parse_ready_line(line).is_err(), "{line} must be rejected");
        }
    }

    #[test]
    fn the_shutdown_endpoint_is_loopback_only() {
        assert_eq!(shutdown_url(4242), "http://127.0.0.1:4242/shutdown");
        let url = reqwest::Url::parse(&shutdown_url(1)).unwrap();
        assert_eq!(url.host_str(), Some("127.0.0.1"));
        assert_eq!(url.scheme(), "http");
    }

    #[test]
    fn spawn_refuses_when_the_engine_is_not_installed() {
        let temp = tempfile::tempdir().unwrap();
        let layout = Layout::new(temp.path().join("tts"));
        layout.ensure().unwrap();
        let error = spawn(&layout, Engine::Kokoro, Device::Cpu, "token".into())
            .err()
            .expect("an uninstalled engine must not spawn");
        assert!(error.contains("not installed"), "{error}");
    }
}
