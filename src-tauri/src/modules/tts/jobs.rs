//! Background installation jobs with a live, bounded log.
//!
//! One job at a time per engine: two `uv pip install` runs against the same
//! venv corrupt it, and a remove racing an install leaves a half-registered
//! engine. The rule is enforced at registration so the caller gets an error
//! instead of a broken venv.

use std::collections::VecDeque;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use shared_child::SharedChild;

use super::engines::{Engine, Model};
use crate::modules::shell::ringbuffer::BoundedRingBuffer;

const LOG_CAP: usize = 1024 * 1024;
/// Ceiling for a log kept on disk. Truncating rather than rotating keeps one
/// predictable path for the reveal button and cannot fill the disk.
pub const MAX_LOG_FILE_BYTES: u64 = 4 * 1024 * 1024;
/// Finished jobs are kept so the UI can still read the log of the install that
/// just failed, but the list cannot grow without bound.
const MAX_RETAINED: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum JobKind {
    Runtime,
    EngineInstall,
    EngineRemove,
    ModelDownload,
    Purge,
}

impl JobKind {
    pub fn label(self) -> &'static str {
        match self {
            JobKind::Runtime => "runtime install",
            JobKind::EngineInstall => "engine install",
            JobKind::EngineRemove => "engine remove",
            JobKind::ModelDownload => "model download",
            JobKind::Purge => "purge",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum JobState {
    Running,
    Done,
    Failed,
    Cancelled,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobInfo {
    pub id: u32,
    pub kind: JobKind,
    pub engine: Option<Engine>,
    pub model: Option<Model>,
    pub state: JobState,
    pub started_at_ms: u64,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobLogs {
    pub bytes: String,
    pub next_offset: u64,
    pub dropped: u64,
    pub exited: bool,
    pub exit_code: Option<i32>,
}

/// Append-only log file with a hard ceiling, shared by installation jobs and by
/// the sidecar tail.
pub struct LogSink {
    file: File,
    written: u64,
}

impl LogSink {
    pub fn open(path: &Path) -> std::io::Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = OpenOptions::new().create(true).append(true).open(path)?;
        let written = file.metadata().map(|m| m.len()).unwrap_or(0);
        crate::modules::tts::layout::set_private(path);
        Ok(Self { file, written })
    }

    /// Replaces the file rather than appending once the ceiling is reached, so
    /// the most recent output is always the part that survives.
    pub fn truncating(path: &Path) -> std::io::Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(path)?;
        crate::modules::tts::layout::set_private(path);
        Ok(Self { file, written: 0 })
    }

    pub fn write(&mut self, bytes: &[u8]) {
        let over_cap = self.written.saturating_add(bytes.len() as u64) > MAX_LOG_FILE_BYTES;
        if over_cap && self.file.set_len(0).is_ok() {
            let _ = self.file.seek(SeekFrom::Start(0));
            let marker = b"== log truncated\n";
            self.written = 0;
            if self.file.write_all(marker).is_ok() {
                self.written = marker.len() as u64;
            }
        }
        if self.file.write_all(bytes).is_ok() {
            self.written = self.written.saturating_add(bytes.len() as u64);
        }
    }

    pub fn size(&self) -> u64 {
        self.written
    }
}

struct Progress {
    state: JobState,
    exit_code: Option<i32>,
}

pub struct Job {
    pub id: u32,
    pub kind: JobKind,
    pub engine: Option<Engine>,
    pub model: Option<Model>,
    pub started_at_ms: u64,
    progress: Mutex<Progress>,
    buffer: Arc<Mutex<BoundedRingBuffer>>,
    /// A copy of the log kept under `logs/`, so a user can still read what an
    /// install did after the job has been pruned from the registry.
    file: Arc<Mutex<Option<LogSink>>>,
    current: Mutex<Option<Arc<SharedChild>>>,
    cancelled: AtomicBool,
}

impl Job {
    fn new(id: u32, kind: JobKind, engine: Option<Engine>, model: Option<Model>) -> Self {
        Self {
            id,
            kind,
            engine,
            model,
            started_at_ms: now_ms(),
            progress: Mutex::new(Progress {
                state: JobState::Running,
                exit_code: None,
            }),
            buffer: Arc::new(Mutex::new(BoundedRingBuffer::new(LOG_CAP))),
            file: Arc::new(Mutex::new(None)),
            current: Mutex::new(None),
            cancelled: AtomicBool::new(false),
        }
    }

    pub fn state(&self) -> JobState {
        self.progress
            .lock()
            .map(|p| p.state)
            .unwrap_or(JobState::Failed)
    }

    pub fn is_running(&self) -> bool {
        self.state() == JobState::Running
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub fn info(&self) -> JobInfo {
        let (state, exit_code) = match self.progress.lock() {
            Ok(p) => (p.state, p.exit_code),
            Err(_) => (JobState::Failed, None),
        };
        JobInfo {
            id: self.id,
            kind: self.kind,
            engine: self.engine,
            model: self.model,
            state,
            started_at_ms: self.started_at_ms,
            exit_code,
        }
    }

    pub fn log(&self, text: &str) {
        self.log_bytes(text.as_bytes());
    }

    pub fn log_bytes(&self, bytes: &[u8]) {
        if let Ok(mut buffer) = self.buffer.lock() {
            buffer.push(bytes);
        }
        if let Ok(mut file) = self.file.lock() {
            if let Some(sink) = file.as_mut() {
                sink.write(bytes);
            }
        }
    }

    /// Mirrors the log to `path`. A failure is not fatal: the in-memory log is
    /// the one the UI tails.
    pub fn attach_log_file(&self, path: &Path) {
        if let Ok(sink) = LogSink::truncating(path) {
            if let Ok(mut file) = self.file.lock() {
                *file = Some(sink);
            }
        }
    }

    /// Every step announces itself before its output, so a log read mid-install
    /// always says what is happening.
    pub fn step(&self, name: &str) {
        self.log(&format!("== step: {name}\n"));
    }

    pub fn read_logs(&self, since: u64) -> JobLogs {
        let (bytes, next_offset, dropped) = match self.buffer.lock() {
            Ok(buffer) => buffer.read_from(since),
            Err(_) => (Vec::new(), since, 0),
        };
        let info = self.info();
        JobLogs {
            bytes: String::from_utf8_lossy(&bytes).into_owned(),
            next_offset,
            dropped,
            exited: info.state != JobState::Running,
            exit_code: info.exit_code,
        }
    }

    /// Marks the job cancelled and kills whatever child it is currently
    /// waiting on, which is what makes the running step return.
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        if let Ok(current) = self.current.lock() {
            if let Some(child) = current.as_ref() {
                let _ = child.kill();
            }
        }
    }

    pub fn finish(&self, outcome: Result<(), String>) {
        let cancelled = self.is_cancelled();
        if let Ok(mut progress) = self.progress.lock() {
            if progress.state != JobState::Running {
                return;
            }
            progress.state = match (&outcome, cancelled) {
                (_, true) => JobState::Cancelled,
                (Ok(()), false) => JobState::Done,
                (Err(_), false) => JobState::Failed,
            };
            if progress.exit_code.is_none() {
                progress.exit_code = Some(match progress.state {
                    JobState::Done => 0,
                    _ => 1,
                });
            }
        }
        match outcome {
            Ok(()) if cancelled => self.log("\n== cancelled\n"),
            Ok(()) => self.log("\n== done\n"),
            Err(message) if cancelled => self.log(&format!("\n== cancelled: {message}\n")),
            Err(message) => self.log(&format!("\n== failed: {message}\n")),
        }
    }

    fn set_exit_code(&self, code: Option<i32>) {
        if let Ok(mut progress) = self.progress.lock() {
            progress.exit_code = code;
        }
    }

    /// Runs one step to completion, streaming both pipes into the log. Returns
    /// an error for a non-zero exit so the caller can stop the job.
    pub fn run(&self, label: &str, mut cmd: Command) -> Result<(), String> {
        if self.is_cancelled() {
            return Err("cancelled".into());
        }
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        crate::modules::proc::hide_console(&mut cmd);

        let child = Arc::new(SharedChild::spawn(&mut cmd).map_err(|e| format!("{label}: {e}"))?);
        let stdout = child.take_stdout();
        let stderr = child.take_stderr();
        if let Ok(mut current) = self.current.lock() {
            *current = Some(child.clone());
        }
        // Cancellation may have landed between the check and the spawn.
        if self.is_cancelled() {
            let _ = child.kill();
        }

        let mut readers = Vec::new();
        if let Some(pipe) = stdout {
            readers.push(self.tail(pipe));
        }
        if let Some(pipe) = stderr {
            readers.push(self.tail(pipe));
        }

        let status = child.wait().map_err(|e| format!("{label}: {e}"));
        for reader in readers {
            let _ = reader.join();
        }
        if let Ok(mut current) = self.current.lock() {
            *current = None;
        }
        let status = status?;
        if self.is_cancelled() {
            return Err("cancelled".into());
        }
        match status.code() {
            Some(0) => Ok(()),
            Some(code) => {
                self.set_exit_code(Some(code));
                Err(format!("{label} exited with code {code}"))
            }
            None => {
                self.set_exit_code(Some(1));
                Err(format!("{label} was terminated"))
            }
        }
    }

    /// The tail owns a handle to the log rather than borrowing the job, so a
    /// pipe that stays open after `wait` returns cannot outlive a reference.
    fn tail<R: Read + Send + 'static>(&self, mut pipe: R) -> thread::JoinHandle<()> {
        let buffer = Arc::clone(&self.buffer);
        let file = Arc::clone(&self.file);
        thread::spawn(move || {
            let mut chunk = [0_u8; 8192];
            loop {
                match pipe.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => {
                        if let Ok(mut buffer) = buffer.lock() {
                            buffer.push(&chunk[..read]);
                        }
                        if let Ok(mut file) = file.lock() {
                            if let Some(sink) = file.as_mut() {
                                sink.write(&chunk[..read]);
                            }
                        }
                    }
                }
            }
        })
    }
}

pub struct JobRegistry {
    jobs: RwLock<VecDeque<Arc<Job>>>,
    next_id: AtomicU32,
}

impl Default for JobRegistry {
    fn default() -> Self {
        Self {
            jobs: RwLock::new(VecDeque::new()),
            next_id: AtomicU32::new(1),
        }
    }
}

impl JobRegistry {
    /// Registers a job, refusing a second one for the same engine.
    pub fn begin(
        &self,
        kind: JobKind,
        engine: Option<Engine>,
        model: Option<Model>,
    ) -> Result<Arc<Job>, String> {
        let mut jobs = self
            .jobs
            .write()
            .map_err(|_| "tts job registry is poisoned".to_string())?;
        if let Some(running) = jobs
            .iter()
            .find(|job| job.is_running() && conflicts((job.kind, job.engine), (kind, engine)))
        {
            return Err(match running.engine {
                Some(engine) => format!(
                    "a {} job is already running for {}",
                    running.kind.label(),
                    engine.id()
                ),
                None => format!("a {} job is already running", running.kind.label()),
            });
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let job = Arc::new(Job::new(id, kind, engine, model));
        jobs.push_back(job.clone());
        while jobs.len() > MAX_RETAINED {
            let oldest_finished = jobs.iter().position(|job| !job.is_running());
            match oldest_finished {
                Some(index) => {
                    jobs.remove(index);
                }
                None => break,
            }
        }
        Ok(job)
    }

    pub fn get(&self, id: u32) -> Option<Arc<Job>> {
        self.jobs
            .read()
            .ok()?
            .iter()
            .find(|job| job.id == id)
            .cloned()
    }

    pub fn list(&self) -> Vec<JobInfo> {
        match self.jobs.read() {
            Ok(jobs) => jobs.iter().map(|job| job.info()).collect(),
            Err(_) => Vec::new(),
        }
    }

    pub fn running(&self) -> Vec<Arc<Job>> {
        match self.jobs.read() {
            Ok(jobs) => jobs
                .iter()
                .filter(|job| job.is_running())
                .cloned()
                .collect(),
            Err(_) => Vec::new(),
        }
    }

    pub fn cancel_all(&self) {
        for job in self.running() {
            job.cancel();
        }
    }
}

/// A purge preempts everything by cancelling it, so it is allowed to start
/// while other jobs run; nothing else may start while a purge runs. Otherwise
/// two jobs conflict when they target the same engine, and the two engineless
/// kinds (runtime bootstrap and purge) share one slot.
fn conflicts(existing: (JobKind, Option<Engine>), incoming: (JobKind, Option<Engine>)) -> bool {
    match (existing.0, incoming.0) {
        (JobKind::Purge, _) => true,
        (_, JobKind::Purge) => false,
        _ => existing.1 == incoming.1,
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_job_is_running_with_no_exit_code() {
        let registry = JobRegistry::default();
        let job = registry
            .begin(JobKind::EngineInstall, Some(Engine::Kokoro), None)
            .unwrap();
        let info = job.info();
        assert_eq!(info.id, 1);
        assert_eq!(info.kind, JobKind::EngineInstall);
        assert_eq!(info.engine, Some(Engine::Kokoro));
        assert_eq!(info.model, None);
        assert_eq!(info.state, JobState::Running);
        assert_eq!(info.exit_code, None);
        assert!(info.started_at_ms > 0);
    }

    #[test]
    fn success_failure_and_cancellation_are_terminal_states() {
        let registry = JobRegistry::default();
        let done = registry.begin(JobKind::Runtime, None, None).unwrap();
        done.finish(Ok(()));
        assert_eq!(done.state(), JobState::Done);
        assert_eq!(done.info().exit_code, Some(0));
        // A finished job never moves again.
        done.finish(Err("late".into()));
        assert_eq!(done.state(), JobState::Done);

        let failed = registry
            .begin(JobKind::EngineInstall, Some(Engine::Kokoro), None)
            .unwrap();
        failed.finish(Err("uv pip install exited with code 2".into()));
        assert_eq!(failed.state(), JobState::Failed);
        assert_eq!(failed.info().exit_code, Some(1));

        let cancelled = registry
            .begin(JobKind::EngineInstall, Some(Engine::Chatterbox), None)
            .unwrap();
        cancelled.cancel();
        assert!(cancelled.is_cancelled());
        cancelled.finish(Err("cancelled".into()));
        assert_eq!(cancelled.state(), JobState::Cancelled);
    }

    #[test]
    fn a_cancelled_job_that_still_reports_success_is_recorded_as_cancelled() {
        let registry = JobRegistry::default();
        let job = registry.begin(JobKind::Purge, None, None).unwrap();
        job.cancel();
        job.finish(Ok(()));
        assert_eq!(job.state(), JobState::Cancelled);
    }

    #[test]
    fn only_one_job_per_engine_may_run() {
        let registry = JobRegistry::default();
        let first = registry
            .begin(JobKind::EngineInstall, Some(Engine::Kokoro), None)
            .unwrap();
        let clash = registry.begin(JobKind::EngineRemove, Some(Engine::Kokoro), None);
        let message = clash.err().expect("a second kokoro job must be refused");
        assert!(message.contains("kokoro"), "{message}");
        assert!(message.contains("already running"), "{message}");
        // A model download resolves to its engine, so it clashes too.
        assert!(registry
            .begin(
                JobKind::ModelDownload,
                Some(Engine::Kokoro),
                Some(Model::Kokoro82m)
            )
            .is_err());
        // A different engine is unaffected.
        assert!(registry
            .begin(JobKind::EngineInstall, Some(Engine::Chatterbox), None)
            .is_ok());
        first.finish(Ok(()));
        assert!(registry
            .begin(JobKind::EngineRemove, Some(Engine::Kokoro), None)
            .is_ok());
    }

    #[test]
    fn a_second_runtime_bootstrap_is_refused() {
        let registry = JobRegistry::default();
        let runtime = registry.begin(JobKind::Runtime, None, None).unwrap();
        assert!(registry.begin(JobKind::Runtime, None, None).is_err());
        runtime.finish(Ok(()));
        assert!(registry.begin(JobKind::Runtime, None, None).is_ok());
    }

    #[test]
    fn a_purge_preempts_but_nothing_starts_while_it_runs() {
        let registry = JobRegistry::default();
        let runtime = registry.begin(JobKind::Runtime, None, None).unwrap();
        let purge = registry.begin(JobKind::Purge, None, None).unwrap();
        assert!(registry.begin(JobKind::Runtime, None, None).is_err());
        assert!(registry
            .begin(JobKind::EngineInstall, Some(Engine::Kokoro), None)
            .is_err());
        assert!(registry.begin(JobKind::Purge, None, None).is_err());
        runtime.finish(Err("cancelled".into()));
        assert!(registry.begin(JobKind::Runtime, None, None).is_err());
        purge.finish(Ok(()));
        assert!(registry.begin(JobKind::Runtime, None, None).is_ok());
    }

    #[test]
    fn the_conflict_rule_is_symmetric_where_it_must_be() {
        let kokoro = (JobKind::EngineInstall, Some(Engine::Kokoro));
        let chatterbox = (JobKind::EngineInstall, Some(Engine::Chatterbox));
        let runtime = (JobKind::Runtime, None);
        let purge = (JobKind::Purge, None);
        assert!(conflicts(kokoro, kokoro));
        assert!(!conflicts(kokoro, chatterbox));
        assert!(!conflicts(kokoro, runtime));
        assert!(conflicts(runtime, runtime));
        assert!(!conflicts(kokoro, purge));
        assert!(conflicts(purge, kokoro));
        assert!(conflicts(purge, purge));
    }

    #[test]
    fn steps_are_announced_before_their_output() {
        let registry = JobRegistry::default();
        let job = registry.begin(JobKind::Runtime, None, None).unwrap();
        job.step("download uv");
        job.log_bytes(b"downloading\n");
        job.step("extract uv");
        let logs = job.read_logs(0);
        assert_eq!(
            logs.bytes,
            "== step: download uv\ndownloading\n== step: extract uv\n"
        );
        assert_eq!(logs.dropped, 0);
        assert!(!logs.exited);
        let tail = job.read_logs(logs.next_offset);
        assert!(tail.bytes.is_empty());
        job.finish(Ok(()));
        assert!(job.read_logs(0).exited);
    }

    #[test]
    fn ids_are_unique_and_lookups_resolve() {
        let registry = JobRegistry::default();
        let a = registry.begin(JobKind::Runtime, None, None).unwrap();
        a.finish(Ok(()));
        let b = registry
            .begin(JobKind::EngineInstall, Some(Engine::Kokoro), None)
            .unwrap();
        assert_ne!(a.id, b.id);
        assert_eq!(registry.get(b.id).map(|job| job.id), Some(b.id));
        assert!(registry.get(9999).is_none());
        assert_eq!(registry.list().len(), 2);
        assert_eq!(registry.running().len(), 1);
    }

    #[test]
    fn finished_jobs_are_pruned_but_running_ones_are_kept() {
        let registry = JobRegistry::default();
        for _ in 0..(MAX_RETAINED + 8) {
            let job = registry.begin(JobKind::Runtime, None, None).unwrap();
            job.finish(Ok(()));
        }
        assert_eq!(registry.list().len(), MAX_RETAINED);
        let running = registry
            .begin(JobKind::EngineInstall, Some(Engine::Kokoro), None)
            .unwrap();
        for _ in 0..MAX_RETAINED {
            let job = registry.begin(JobKind::Runtime, None, None).unwrap();
            job.finish(Ok(()));
        }
        assert!(registry.list().iter().any(|info| info.id == running.id));
    }

    #[test]
    fn cancel_all_only_touches_running_jobs() {
        let registry = JobRegistry::default();
        let done = registry.begin(JobKind::Runtime, None, None).unwrap();
        done.finish(Ok(()));
        let live = registry
            .begin(JobKind::EngineInstall, Some(Engine::Kokoro), None)
            .unwrap();
        registry.cancel_all();
        assert!(live.is_cancelled());
        assert!(!done.is_cancelled());
        assert_eq!(done.state(), JobState::Done);
    }

    #[test]
    fn job_kinds_and_states_serialize_as_the_contract_spells_them() {
        let json = serde_json::to_string(&[
            JobKind::Runtime,
            JobKind::EngineInstall,
            JobKind::EngineRemove,
            JobKind::ModelDownload,
            JobKind::Purge,
        ])
        .unwrap();
        assert_eq!(
            json,
            "[\"runtime\",\"engine-install\",\"engine-remove\",\"model-download\",\"purge\"]"
        );
        let json = serde_json::to_string(&[
            JobState::Running,
            JobState::Done,
            JobState::Failed,
            JobState::Cancelled,
        ])
        .unwrap();
        assert_eq!(json, "[\"running\",\"done\",\"failed\",\"cancelled\"]");
    }

    #[test]
    fn job_info_serializes_with_camel_case_keys() {
        let registry = JobRegistry::default();
        let job = registry
            .begin(
                JobKind::ModelDownload,
                Some(Engine::Kokoro),
                Some(Model::Kokoro82m),
            )
            .unwrap();
        let json = serde_json::to_string(&job.info()).unwrap();
        assert!(json.contains("\"startedAtMs\""), "{json}");
        assert!(json.contains("\"exitCode\""), "{json}");
        assert!(json.contains("\"kind\":\"model-download\""), "{json}");
        assert!(json.contains("\"model\":\"kokoro-82m\""), "{json}");
    }

    #[test]
    fn a_failing_step_records_the_child_exit_code() {
        let registry = JobRegistry::default();
        let job = registry.begin(JobKind::Runtime, None, None).unwrap();
        let mut cmd = if cfg!(windows) {
            let mut cmd = Command::new("cmd.exe");
            cmd.args(["/C", "echo hello && exit 3"]);
            cmd
        } else {
            let mut cmd = Command::new("/bin/sh");
            cmd.args(["-c", "echo hello; exit 3"]);
            cmd
        };
        cmd.env_clear();
        let error = job.run("probe", cmd).unwrap_err();
        assert!(error.contains("code 3"), "{error}");
        assert_eq!(job.info().exit_code, Some(3));
        assert!(job.read_logs(0).bytes.contains("hello"));
        job.finish(Err(error));
        assert_eq!(job.state(), JobState::Failed);
        assert_eq!(job.info().exit_code, Some(3));
    }

    #[test]
    fn the_log_sink_truncates_instead_of_growing_without_bound() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("logs").join("server-kokoro.log");
        let mut sink = LogSink::open(&path).unwrap();
        let chunk = vec![b'x'; 1024 * 1024];
        for _ in 0..6 {
            sink.write(&chunk);
        }
        let size = std::fs::metadata(&path).unwrap().len();
        assert!(size <= MAX_LOG_FILE_BYTES + chunk.len() as u64, "{size}");
        assert!(size > 0);
        drop(sink);
        assert_eq!(LogSink::open(&path).unwrap().size(), size);
        assert_eq!(LogSink::truncating(&path).unwrap().size(), 0);
        assert_eq!(std::fs::metadata(&path).unwrap().len(), 0);
    }

    #[test]
    fn an_attached_log_file_mirrors_the_ring_buffer() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("logs").join("install-kokoro.log");
        let registry = JobRegistry::default();
        let job = registry
            .begin(JobKind::EngineInstall, Some(Engine::Kokoro), None)
            .unwrap();
        job.log("before attach\n");
        job.attach_log_file(&path);
        job.step("uv venv");
        job.finish(Ok(()));
        let on_disk = std::fs::read_to_string(&path).unwrap();
        assert!(on_disk.contains("== step: uv venv"), "{on_disk}");
        assert!(on_disk.contains("== done"), "{on_disk}");
        assert!(!on_disk.contains("before attach"), "{on_disk}");
        assert!(job.read_logs(0).bytes.contains("before attach"));
    }

    #[test]
    fn a_cancelled_job_refuses_to_start_another_step() {
        let registry = JobRegistry::default();
        let job = registry.begin(JobKind::Runtime, None, None).unwrap();
        job.cancel();
        let mut cmd = Command::new(if cfg!(windows) { "cmd.exe" } else { "/bin/sh" });
        cmd.args(if cfg!(windows) {
            ["/C", "exit 0"]
        } else {
            ["-c", "exit 0"]
        });
        assert_eq!(job.run("probe", cmd).unwrap_err(), "cancelled");
    }
}
