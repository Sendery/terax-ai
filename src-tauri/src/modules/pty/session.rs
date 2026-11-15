use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, Child, ChildKiller, MasterPty, PtySize};
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Emitter, Manager};

use super::agent_detect::AgentDetector;
use super::da_filter::DaFilter;
#[cfg(feature = "ghostty-engine")]
use super::engine;
#[cfg(feature = "ghostty-engine")]
use super::retained::{CoreSlot, ProcessCore};
use super::shell_init;
use crate::modules::workspace::WorkspaceEnv;

const AGENT_EVENT: &str = "terax:agent-signal";

// Flusher coalesces a short window after first-byte arrival so we send chunks,
// not single bytes. MAX_IDLE is only a safety net for missed signals.
const FLUSH_COALESCE: Duration = Duration::from_millis(4);
const FLUSH_MAX_IDLE: Duration = Duration::from_millis(50);
const READ_BUF: usize = 16 * 1024;
// Cap on buffered-but-not-yet-flushed bytes. On overflow we discard the
// entire pending buffer and emit an SGR-reset + notice in its place.
// Dropping a partial prefix would slice a CSI sequence in half and corrupt
// xterm's screen state. 4 MiB is ~1000 full 80x24 screens.
const MAX_PENDING: usize = 4 * 1024 * 1024;
// Hard reset (ESC c) + dim notice. Written verbatim into the stream when
// we're forced to discard backlog.
const OVERFLOW_NOTICE: &[u8] =
    b"\x1bc\x1b[2m[terax: dropped output due to backpressure]\x1b[0m\r\n";

pub struct Session {
    // Field drop order is intentional. Rust drops fields top-to-bottom:
    //   1. `_job` — on Windows, closing the Job HANDLE fires
    //      KILL_ON_JOB_CLOSE, terminating the pwsh tree before the master
    //      pipe drops. Without this, ClosePseudoConsole in `master`'s Drop
    //      can block waiting for conhost to drain pending output, freezing
    //      the Tauri worker thread that triggered the close.
    //   2. `killer` — best-effort kill (redundant on Windows once Job
    //      closed, but harmless and required on Unix where there is no Job).
    //   3. `writer` — closes the input side of the master pipe.
    //   4. `master` — last; ClosePseudoConsole on Windows. By now the child
    //      is dead and conhost has nothing left to drain.
    #[cfg(windows)]
    _job: Option<crate::modules::proc::job::ProcessJob>,
    /// PID of the shell process. 0 means unknown; callers must skip checks when 0.
    pub shell_pid: u32,
    pub killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub master: Mutex<Box<dyn MasterPty + Send>>,
    // Set once the child exits or its engine fails, so registration can reap
    // a session that became unusable before pty_open returned.
    pub(super) exited: Arc<AtomicBool>,
    #[cfg(feature = "ghostty-engine")]
    pub(super) engine: Option<engine::EngineHandle>,
}

impl Drop for Session {
    fn drop(&mut self) {
        // If the session Arc is dropped without an explicit pty_close (e.g.
        // frontend disconnected, window crashed, dev HMR), the reader/flusher
        // threads would otherwise stay alive forever holding the child. Kill
        // the child here so the reader hits EOF and the threads unwind.
        if let Ok(mut k) = self.killer.lock() {
            let _ = k.kill();
        }
    }
}
// Serializes ConPTY create and close: overlapping pseudoconsole lifecycle
// calls corrupt the new console so its shell never pumps output (issue #356).
#[cfg(windows)]
static CONPTY_LIFECYCLE_LOCK: Mutex<()> = Mutex::new(());

pub(super) fn drop_session(session: Arc<Session>) {
    #[cfg(windows)]
    let _guard = CONPTY_LIFECYCLE_LOCK.lock().unwrap();
    drop(session);
}

struct ChildKillGuard {
    killer: Option<Box<dyn ChildKiller + Send + Sync>>,
}

impl ChildKillGuard {
    fn new(killer: Box<dyn ChildKiller + Send + Sync>) -> Self {
        Self { killer: Some(killer) }
    }

    fn disarm(&mut self) {
        self.killer = None;
    }
}

impl Drop for ChildKillGuard {
    fn drop(&mut self) {
        if let Some(mut k) = self.killer.take() {
            let _ = k.kill();
        }
    }
}

/// Where a session's output goes: raw bytes to xterm.js through the flusher,
/// or into a terminal engine that sends frames.
pub enum OutputSink {
    Raw(Channel<Response>),
    #[cfg(feature = "ghostty-engine")]
    Engine {
        on_frame: Channel<Response>,
        colors: Option<super::colors::Colors>,
        cursor_blink: bool,
        scrollback_rows: u32,
        slot: Arc<CoreSlot>,
        on_failure: Channel<String>,
        on_state: Channel<engine::state::EngineState>,
        on_clipboard: Option<Channel<u8>>,
    },
}

enum Pipeline {
    Raw(Channel<Response>),
    #[cfg(feature = "ghostty-engine")]
    Engine(EnginePipeline),
}

#[allow(clippy::too_many_arguments)]
pub fn spawn(
    id: u32,
    app: AppHandle,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    workspace: WorkspaceEnv,
    blocks: bool,
    sink: OutputSink,
    on_exit: Channel<i32>,
) -> Result<(Arc<Session>, PtySize), String> {
    #[cfg(windows)]
    let _spawn_guard = CONPTY_LIFECYCLE_LOCK.lock().unwrap();

    let pty_system = native_pty_system();
    let size = PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = pty_system.openpty(size).map_err(|e| e.to_string())?;

    #[cfg(feature = "ghostty-engine")]
    let mut shell_token = if matches!(&sink, OutputSink::Engine { .. }) { Some(engine::shell::ShellToken::generate()?) } else { None };
    let cmd = shell_init::build_command(cwd, workspace, blocks)?;
    #[cfg(feature = "ghostty-engine")]
    let cmd = {
        let mut cmd = cmd;
        if let Some(token) = &shell_token {
            cmd.env(shell_init::SHELL_MARKER_ENV, token.as_str());
            #[cfg(windows)]
            {
                let inherited = cmd.get_env("WSLENV").and_then(|value| value.to_str()).unwrap_or("").to_owned();
                let mut names: Vec<&str> = inherited.split(':').filter(|name| !name.is_empty() && name.split('/').next()!=Some(shell_init::SHELL_MARKER_ENV)).collect();
                names.push(shell_init::SHELL_MARKER_ENV);
                cmd.env("WSLENV", names.join(":"));
            }
        }
        cmd
    };
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    // Kill the child if any of the pipe setup below fails so the spawned shell
    // can't outlive an aborted pty_open.
    let mut guard = ChildKillGuard::new(child.clone_killer());
    let killer = child.clone_killer();
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer: Arc<Mutex<Box<dyn Write + Send>>> = Arc::new(Mutex::new(
        pair.master.take_writer().map_err(|e| e.to_string())?,
    ));
    let pipeline = match sink {
        OutputSink::Raw(on_data) => Pipeline::Raw(on_data),
        #[cfg(feature = "ghostty-engine")]
        OutputSink::Engine { on_frame, colors, cursor_blink, scrollback_rows, slot, on_failure, on_state, on_clipboard } => {
            let engine = start_engine(cols, rows, engine::EngineOptions { appearance: engine::Appearance { colors, cursor_blink }, scrollback_rows: Some(scrollback_rows) }, engine::ShellConfig { token: shell_token.take().ok_or("native shell marker is missing")?, blocks }, on_frame, on_state, writer.clone())?;
            if let Some(channel) = on_clipboard {
                engine.handle.on_clipboard(move || channel.send(1).is_ok());
            }
            Pipeline::Engine(EnginePipeline {
                core: slot.install(engine)?,
                slot,
                on_failure: Arc::new(move |message| { let _ = on_failure.send(message); }),
            })
        }
    };
    guard.disarm();

    let shell_pid = child.process_id().unwrap_or(0);

    #[cfg(windows)]
    let job = match child.process_id() {
        Some(pid) => match crate::modules::proc::job::ProcessJob::create_for(pid) {
            Ok(j) => Some(j),
            Err(e) => {
                log::warn!("pty job-object setup failed for pid={pid}: {e}");
                None
            }
        },
        None => None,
    };

    let exited = Arc::new(AtomicBool::new(false));

    let session = Arc::new(Session {
        #[cfg(windows)]
        _job: job,
        shell_pid,
        killer: Mutex::new(killer),
        writer: writer.clone(),
        master: Mutex::new(pair.master),
        exited: exited.clone(),
        #[cfg(feature = "ghostty-engine")]
        engine: match &pipeline {
            Pipeline::Engine(e) => Some(e.core.handle.clone()),
            Pipeline::Raw(_) => None,
        },
    });

    match pipeline {
        Pipeline::Raw(on_data) => {
            spawn_raw_threads(id, app, reader, writer, on_data, on_exit, child, exited)
        }
        #[cfg(feature = "ghostty-engine")]
        Pipeline::Engine(engine) => {
            spawn_engine_threads(id, app, reader, engine, on_exit, child, exited)
        }
    }

    Ok((session, size))
}

#[allow(clippy::too_many_arguments)]
fn spawn_raw_threads(
    id: u32,
    app: AppHandle,
    mut reader: Box<dyn Read + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
    mut child: Box<dyn Child + Send + Sync>,
    exited: Arc<AtomicBool>,
) {
    let pending: Arc<(Mutex<Vec<u8>>, Condvar)> = Arc::new((
        Mutex::new(Vec::with_capacity(READ_BUF)),
        Condvar::new(),
    ));
    let done = Arc::new(AtomicBool::new(false));
    let spawn_at = Instant::now();

    let first_byte = Arc::new(AtomicBool::new(false));

    let pending_r = pending.clone();
    let writer_for_da = writer.clone();
    let app_reader = app.clone();
    let first_byte_r = first_byte;
    let reader_thread = thread::Builder::new()
        .name("terax-pty-reader".into())
        .spawn(move || {
            let mut buf = [0u8; READ_BUF];
            let mut filtered: Vec<u8> = Vec::with_capacity(READ_BUF);
            let mut da_filter = DaFilter::new();
            let mut agent_detect = AgentDetector::new();
            let mut dropped_bytes: u64 = 0;
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if !first_byte_r.load(Ordering::Relaxed) {
                            first_byte_r.store(true, Ordering::Release);
                            log::debug!("pty first byte after {}ms", spawn_at.elapsed().as_millis());
                        }
                        agent_detect.process(&buf[..n], |t| {
                            let _ = app_reader.emit(AGENT_EVENT, t.into_signal(id));
                        });
                        filtered.clear();
                        da_filter.process(&buf[..n], &mut filtered, |reply| {
                            if let Ok(mut w) = writer_for_da.lock() {
                                let _ = w.write_all(reply);
                            }
                        });
                        if filtered.is_empty() {
                            continue;
                        }
                        let (lock, cv) = &*pending_r;
                        let mut g = lock.lock().unwrap();
                        if g.len() + filtered.len() > MAX_PENDING {
                            dropped_bytes += g.len() as u64;
                            g.clear();
                            g.extend_from_slice(OVERFLOW_NOTICE);
                        }
                        g.extend_from_slice(&filtered);
                        cv.notify_one();
                    }
                    Err(e) => {
                        log::debug!("pty reader ended: {e}");
                        break;
                    }
                }
            }
            agent_detect.finish(|t| {
                let _ = app_reader.emit(AGENT_EVENT, t.into_signal(id));
            });
            pending_r.1.notify_one();
            if dropped_bytes > 0 {
                log::warn!("pty backpressure: dropped {dropped_bytes} bytes (cap {MAX_PENDING})");
            }
        })
        .expect("spawn pty reader thread");

    let on_data_flush = on_data.clone();
    let pending_f = pending.clone();
    let done_f = done.clone();
    thread::Builder::new()
        .name("terax-pty-flusher".into())
        .spawn(move || {
            let (lock, cv) = &*pending_f;
            loop {
                {
                    let mut g = lock.lock().unwrap();
                    while g.is_empty() {
                        if done_f.load(Ordering::Acquire) {
                            return;
                        }
                        let (next, _) = cv.wait_timeout(g, FLUSH_MAX_IDLE).unwrap();
                        g = next;
                    }
                }
                // Coalesce a short window so a burst flushes as one chunk.
                thread::sleep(FLUSH_COALESCE);
                let chunk = std::mem::take(&mut *lock.lock().unwrap());
                if chunk.is_empty() {
                    continue;
                }
                if let Err(e) = on_data_flush.send(Response::new(chunk)) {
                    log::debug!("pty flusher exiting, channel closed: {e}");
                    break;
                }
            }
        })
        .expect("spawn pty flusher thread");

    let on_data_exit = on_data;
    let pending_e = pending;
    let done_e = done;
    let app_waiter = app;
    let exited_w = exited;
    thread::Builder::new()
        .name("terax-pty-waiter".into())
        .spawn(move || {
            let code = match child.wait() {
                Ok(status) => status.exit_code() as i32,
                Err(e) => {
                    log::warn!("pty child wait failed: {e}");
                    -1
                }
            };
            exited_w.store(true, Ordering::Release);
            // Wait for the reader to hit EOF before taking a final snapshot of
            // `pending`, so the last line of output never races the Exit event.
            #[cfg(windows)]
            {
                let deadline = Instant::now() + Duration::from_millis(50);
                while Instant::now() < deadline && !reader_thread.is_finished() {
                    thread::sleep(Duration::from_millis(5));
                }
            }
            #[cfg(not(windows))]
            if let Err(e) = reader_thread.join() {
                log::error!("pty reader thread panicked: {e:?}");
            }
            let (lock, cv) = &*pending_e;
            let tail = std::mem::take(&mut *lock.lock().unwrap());
            if !tail.is_empty() {
                if let Err(e) = on_data_exit.send(Response::new(tail)) {
                    log::debug!("pty final-data send failed (channel closed): {e}");
                }
            }
            done_e.store(true, Ordering::Release);
            cv.notify_all();
            if let Err(e) = on_exit.send(code) {
                log::debug!("pty exit send failed (channel closed): {e}");
            }
            if let Some(state) = app_waiter.try_state::<super::PtyState>() {
                if let Some(s) = state.take(id) {
                    drop_session(s);
                }
            }
        })
        .expect("spawn pty waiter thread");
}

#[cfg(feature = "ghostty-engine")]
fn start_engine(
    cols: u16,
    rows: u16,
    options: engine::EngineOptions,
    shell_config: engine::ShellConfig,
    on_frame: Channel<Response>,
    on_state: Channel<engine::state::EngineState>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
) -> Result<engine::Engine, String> {
    let frames: engine::FrameSink =
        Box::new(move |frame| on_frame.send(Response::new(frame)).is_ok());
    let engine = engine::start_with_shell_options(cols, rows, options, shell_config, frames, reply_sink(writer))?;
    engine.handle.on_state(move |state| on_state.send(state).is_ok());
    Ok(engine)
}

// Terminal replies (device attributes, cursor reports) go back to the child.
#[cfg(feature = "ghostty-engine")]
fn reply_sink(writer: Arc<Mutex<Box<dyn Write + Send>>>) -> engine::ReplySink {
    Box::new(move |reply| {
        if let Ok(mut w) = writer.lock() {
            let _ = w.write_all(reply);
        }
    })
}

#[cfg(feature = "ghostty-engine")]
fn spawn_engine_threads(
    id: u32,
    app: AppHandle,
    reader: Box<dyn Read + Send>,
    engine: EnginePipeline,
    on_exit: Channel<i32>,
    child: Box<dyn Child + Send + Sync>,
    exited: Arc<AtomicBool>,
) {
    let app_signals = app.clone();
    run_engine_pipeline(
        id,
        reader,
        engine,
        child,
        exited,
        move |t| {
            let _ = app_signals.emit(AGENT_EVENT, t.into_signal(id));
        },
        move |code| {
            let removed = app.try_state::<super::PtyState>().and_then(|state| state.take(id));
            if let Err(e) = on_exit.send(code) {
                log::debug!("pty exit send failed (channel closed): {e}");
            }
            if let Some(s) = removed {
                if let Err(error) = thread::Builder::new()
                    .name(format!("terax-pty-drop-{id}"))
                    .spawn(move || drop_session(s))
                {
                    log::error!("pty id={id}: could not schedule teardown: {error}");
                }
            }
        },
    );
}

#[cfg(feature = "ghostty-engine")]
type EngineFailureObserver = Arc<dyn Fn(String) + Send + Sync>;

#[cfg(feature = "ghostty-engine")]
fn notify_engine_failure(observer: &EngineFailureObserver, message: String) {
    if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| observer(message))).is_err() {
        log::error!("terminal engine failure observer panicked");
    }
}

#[cfg(feature = "ghostty-engine")]
struct EnginePipeline {
    core: ProcessCore,
    slot: Arc<CoreSlot>,
    on_failure: EngineFailureObserver,
}

#[cfg(feature = "ghostty-engine")]
type EngineExitCallback = Box<dyn FnOnce(i32) + Send>;

#[cfg(feature = "ghostty-engine")]
struct EngineExit {
    exited: Arc<AtomicBool>,
    callback: Mutex<Option<EngineExitCallback>>,
}

#[cfg(feature = "ghostty-engine")]
impl EngineExit {
    fn report(&self, code: i32) {
        self.exited.store(true, Ordering::Release);
        let callback = self.callback.lock().unwrap_or_else(std::sync::PoisonError::into_inner).take();
        if let Some(callback) = callback {
            if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| callback(code))).is_err() {
                log::error!("terminal engine exit observer panicked");
            }
        }
    }
}

// The reader keeps agent detection on the raw stream and hands every chunk to
// the engine, blocking while its queue is full. The terminal itself answers
// device queries, so there is no DaFilter and no flusher on this path.
#[cfg(feature = "ghostty-engine")]
fn run_engine_pipeline(
    id: u32,
    mut reader: Box<dyn Read + Send>,
    engine: EnginePipeline,
    mut child: Box<dyn Child + Send + Sync>,
    exited: Arc<AtomicBool>,
    mut signal: impl FnMut(super::agent_detect::Transition) + Send + 'static,
    on_exit: impl FnOnce(i32) + Send + 'static,
) -> thread::JoinHandle<()> {
    let EnginePipeline { core, slot, on_failure } = engine;
    let ProcessCore { input, handle } = &core;
    let exit = Arc::new(EngineExit { exited: exited.clone(), callback: Mutex::new(Some(Box::new(on_exit))) });
    let failure_exit = exit.clone();
    let failure_slot = Arc::downgrade(&slot);
    let failure_observer = on_failure.clone();
    handle.on_failure(move |failure| {
        log::warn!("pty id={id}: terminal engine failed: {failure:?}");
        if let Some(slot) = failure_slot.upgrade() {
            let action = slot.record_failure();
            if action.notify { notify_engine_failure(&failure_observer, format!("terminal engine failed: {failure:?}")); }
            // This callback may run on the actor. Drop only requests stop;
            // joining here would wait for the current thread itself.
            if action.retire { drop(slot.close()); }
        }
        failure_exit.report(engine::ENGINE_FAILED_EXIT);
    });
    let reader_exit = exit.clone();
    let spawn_at = Instant::now();
    let reader_input = input.clone();
    let reader_thread = thread::Builder::new()
        .name("terax-pty-reader".into())
        .spawn(move || {
            let mut buf = [0u8; READ_BUF];
            let mut agent_detect = AgentDetector::new();
            let mut first_byte = true;
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if first_byte {
                            first_byte = false;
                            log::debug!(
                                "pty first byte after {}ms",
                                spawn_at.elapsed().as_millis()
                            );
                        }
                        agent_detect.process(&buf[..n], &mut signal);
                        if !reader_input.feed(buf[..n].to_vec()) {
                            reader_exit.report(engine::ENGINE_FAILED_EXIT);
                            break;
                        }
                    }
                    Err(e) => {
                        log::debug!("pty reader ended: {e}");
                        break;
                    }
                }
            }
            agent_detect.finish(&mut signal);
        })
        .expect("spawn pty reader thread");

    thread::Builder::new()
        .name("terax-pty-waiter".into())
        .spawn(move || {
            let code = match child.wait() {
                Ok(status) => status.exit_code() as i32,
                Err(e) => {
                    log::warn!("pty child wait failed: {e}");
                    -1
                }
            };
            exited.store(true, Ordering::Release);
            #[cfg(windows)]
            let reader_drained = {
                let deadline = Instant::now() + Duration::from_millis(50);
                while Instant::now() < deadline && !reader_thread.is_finished() {
                    thread::sleep(Duration::from_millis(5));
                }
                if reader_thread.is_finished() {
                    reader_thread.join().is_ok()
                } else {
                    log::warn!("pty id={id}: final PTY drain was not confirmed before shutdown");
                    false
                }
            };
            #[cfg(not(windows))]
            let reader_drained = match reader_thread.join() {
                Ok(()) => true,
                Err(_) => {
                    log::error!("pty reader thread panicked");
                    false
                }
            };
            let finished = core.finish().is_ok() && core.handle.failure().is_none();
            let healthy = reader_drained && finished;
            let action = slot.finish_process(healthy);
            if action.notify { notify_engine_failure(&on_failure, "terminal engine input finalization failed".into()); }
            if action.retire {
                if let Some(owner) = slot.close() { let _ = owner.join(); }
            }
            let code = engine::final_exit_code(code, reader_drained, finished);
            exit.report(code);
        })
        .expect("spawn pty waiter thread")
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use portable_pty::CommandBuilder;

    #[test]
    fn drop_kills_child_process() {
        let pty_system = native_pty_system();
        let size = PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = pty_system.openpty(size).expect("openpty");

        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.arg("-c");
        cmd.arg("sleep 30");
        let mut child = pair.slave.spawn_command(cmd).expect("spawn");
        drop(pair.slave);

        let killer = child.clone_killer();
        let writer: Arc<Mutex<Box<dyn Write + Send>>> =
            Arc::new(Mutex::new(pair.master.take_writer().expect("writer")));

        let session = Arc::new(Session {
            shell_pid: child.process_id().unwrap_or(0),
            killer: Mutex::new(killer),
            writer,
            master: Mutex::new(pair.master),
            exited: Arc::new(AtomicBool::new(false)),
            #[cfg(feature = "ghostty-engine")]
            engine: None,
        });

        assert!(
            child.try_wait().unwrap().is_none(),
            "child must be alive before drop",
        );

        drop(session);

        let deadline = Instant::now() + Duration::from_secs(2);
        let mut exited = false;
        while Instant::now() < deadline {
            if child.try_wait().unwrap().is_some() {
                exited = true;
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        assert!(exited, "child still running 2s after Session drop");
    }

    #[test]
    fn drop_session_succeeds_after_child_already_exited() {
        let pty_system = native_pty_system();
        let size = PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = pty_system.openpty(size).expect("openpty");

        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.arg("-c");
        cmd.arg("exit 0");
        let mut child = pair.slave.spawn_command(cmd).expect("spawn");
        drop(pair.slave);
        let _ = child.wait();

        let killer = child.clone_killer();
        let writer: Arc<Mutex<Box<dyn Write + Send>>> =
            Arc::new(Mutex::new(pair.master.take_writer().expect("writer")));

        let session = Arc::new(Session {
            shell_pid: 0,
            killer: Mutex::new(killer),
            writer,
            master: Mutex::new(pair.master),
            exited: Arc::new(AtomicBool::new(false)),
            #[cfg(feature = "ghostty-engine")]
            engine: None,
        });

        drop_session(session);
    }
}

#[cfg(all(test, unix, feature = "ghostty-engine"))]
mod engine_pipeline_tests {
    use std::sync::mpsc;

    use portable_pty::CommandBuilder;

    use super::*;
    use crate::modules::pty::engine::frame::decode::decode;

    enum Event {
        Frame(Vec<u8>),
        Exit(i32),
    }

    fn pipeline(engine: engine::Engine) -> EnginePipeline {
        let slot = CoreSlot::new();
        EnginePipeline { core: slot.install(engine).unwrap(), slot, on_failure: Arc::new(|_| {}) }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn real_zsh_block_profile_retains_exact_outputs_and_status_after_pty_exit() {
        let home = tempfile::tempdir().unwrap();
        let root = home.path().canonicalize().unwrap();
        let profile = root.join("zshrc");
        std::fs::write(&profile, include_str!("scripts/zshrc.zsh")).unwrap();
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 8,
                cols: 60,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut cmd = CommandBuilder::new("/bin/zsh");
        cmd.args(["-f","-c",r#"source "$1"; print -P -n -- "$PS1"; _terax_preexec 'printf first'; printf 'first\n'; _terax_precmd; print -P -n -- "$PS1"; _terax_preexec 'false'; printf 'second\n'; (exit 7); _terax_precmd; print -P -n -- "$PS1"; exit 0"#,"terax-test",profile.to_str().unwrap()]);
        cmd.cwd(&root);
        cmd.env("HOME", &root);
        cmd.env("TERAX_USER_ZDOTDIR", &root);
        cmd.env("TERAX_BLOCKS", "1");
        cmd.env(
            shell_init::SHELL_MARKER_ENV,
            "1234567890abcdef1234567890abcdef",
        );
        let child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let reader = pair.master.try_clone_reader().unwrap();
        let writer: Arc<Mutex<Box<dyn Write + Send>>> =
            Arc::new(Mutex::new(pair.master.take_writer().unwrap()));
        let (tx, rx) = mpsc::channel();
        let frames = tx.clone();
        let native = engine::start_with_shell(
            60,
            8,
            None,
            engine::ShellConfig {
                token: engine::shell::ShellToken::for_test(),
                blocks: true,
            },
            Box::new(move |frame| frames.send(Event::Frame(frame)).is_ok()),
            reply_sink(writer),
        )
        .unwrap();
        let pipeline = pipeline(native);
        let retained = pipeline.slot.clone();
        run_engine_pipeline(
            2,
            reader,
            pipeline,
            child,
            Arc::new(AtomicBool::new(false)),
            |_| {},
            move |code| {
                let _ = tx.send(Event::Exit(code));
            },
        )
        .join()
        .unwrap();
        drop(pair.master);
        let handle = retained.handle().unwrap();
        let blocks = handle
            .blocks()
            .unwrap()
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .unwrap();
        assert_eq!(blocks.blocks.len(), 2);
        assert_eq!(
            blocks
                .blocks
                .iter()
                .map(|b| (b.command.as_str(), b.exit_code))
                .collect::<Vec<_>>(),
            [("printf first", Some(0)), ("false", Some(7))]
        );
        for (id, expected) in [("b1", "first"), ("b2", "second")] {
            let block = handle
                .read_block(id.into())
                .unwrap()
                .recv_timeout(Duration::from_secs(2))
                .unwrap()
                .unwrap()
                .unwrap();
            assert_eq!(block.output, expected);
            assert_eq!(block.cwd, root.to_str().unwrap());
        }
        retained.close().unwrap().join().unwrap();
        assert!(handle.blocks().is_err());
        assert!(matches!(rx.try_iter().last(), Some(Event::Exit(0))));
    }
    // A real shell on a real PTY: its output reaches the terminal, the
    // terminal's answer to a device query reaches the shell through the PTY
    // writer, and the last frame arrives before the exit code.
    #[test]
    fn output_replies_and_the_final_frame_flow_through_a_real_pty() {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 5,
                cols: 40,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty");
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.arg("-c");
        cmd.arg(concat!(
            "stty -icanon -echo min 7 time 30; ",
            "printf 'hello\\033[c'; ",
            "r=$(dd bs=7 count=1 2>/dev/null | tr -d '\\033'); ",
            "printf '\\r\\nreply:%s' \"$r\"; exit 3",
        ));
        let child = pair.slave.spawn_command(cmd).expect("spawn");
        drop(pair.slave);
        let reader = pair.master.try_clone_reader().expect("reader");
        let writer: Arc<Mutex<Box<dyn Write + Send>>> =
            Arc::new(Mutex::new(pair.master.take_writer().expect("writer")));

        let (tx, rx) = mpsc::channel();
        let frames_tx = tx.clone();
        let engine = engine::start(
            40,
            5,
            Box::new(move |frame| frames_tx.send(Event::Frame(frame)).is_ok()),
            reply_sink(writer.clone()),
        )
        .expect("engine");
        let engine = pipeline(engine);
        let retained = engine.slot.clone();
        let waiter = run_engine_pipeline(
            1,
            reader,
            engine,
            child,
            Arc::new(AtomicBool::new(false)),
            |_| {},
            move |code| {
                let _ = tx.send(Event::Exit(code));
            },
        );
        waiter.join().expect("waiter");
        drop(pair.master);
        let handle = retained.handle().expect("grid survives the process");
        let text = handle.read_text(5).unwrap().recv_timeout(Duration::from_secs(2)).unwrap().unwrap();
        assert!(text.contains("reply:[?1;2c"), "{text:?}");
        handle.resize(60, 6);
        assert!(handle.read_text(6).unwrap().recv_timeout(Duration::from_secs(2)).unwrap().is_ok());
        retained.close().unwrap().join().unwrap();

        let events: Vec<Event> = rx.try_iter().collect();
        let exit_at = events
            .iter()
            .position(|e| matches!(e, Event::Exit(_)))
            .expect("exit reported");
        assert_eq!(exit_at, events.len() - 1, "the exit code comes last");
        assert!(matches!(events[exit_at], Event::Exit(3)));
        let Event::Frame(last) = &events[exit_at - 1] else {
            panic!("a frame precedes the exit");
        };
        let frame = decode(last);
        let text: Vec<String> = frame.row_records.iter().map(|r| r.text()).collect();
        assert!(text.iter().any(|t| t == "hello"), "{text:?}");
        assert!(text.iter().any(|t| t == "reply:[?1;2c"), "{text:?}");
    }

    #[test]
    fn a_retained_core_reports_failure_after_the_process_exit_without_a_second_exit() {
        let pair = native_pty_system().openpty(PtySize { rows: 3, cols: 20, pixel_width: 0, pixel_height: 0 }).unwrap();
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.arg("-c"); cmd.arg("printf retained; exit 0");
        let child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let reader = pair.master.try_clone_reader().unwrap();
        let fail = Arc::new(AtomicBool::new(false));
        let should_fail = fail.clone();
        let (frames_tx, frames_rx) = mpsc::channel();
        let actor = engine::start(20, 3, Box::new(move |frame| {
            frames_tx.send(frame).unwrap();
            !should_fail.load(Ordering::Acquire)
        }), Box::new(|_| {})).unwrap();
        let mut pipeline = pipeline(actor);
        let slot = pipeline.slot.clone();
        let (failure_tx, failure_rx) = mpsc::channel();
        pipeline.on_failure = Arc::new(move |message| { failure_tx.send(message).unwrap(); });
        let (exit_tx, exit_rx) = mpsc::channel();
        run_engine_pipeline(1, reader, pipeline, child, Arc::new(AtomicBool::new(false)), |_| {}, move |code| {
            exit_tx.send(code).unwrap();
        }).join().unwrap();
        assert_eq!(exit_rx.recv_timeout(Duration::from_secs(2)).unwrap(), 0);
        assert!(failure_rx.try_recv().is_err());
        let last = frames_rx.try_iter().last().unwrap();
        let handle = slot.handle().unwrap();
        fail.store(true, Ordering::Release);
        handle.credit(decode(&last).seq);
        handle.request_full();
        assert!(failure_rx.recv_timeout(Duration::from_secs(2)).unwrap().contains("failed"));
        assert!(slot.handle().is_err());
        assert!(exit_rx.try_recv().is_err(), "process exit is never rewritten");
        assert!(failure_rx.try_recv().is_err());
    }

    #[test]
    fn dropping_a_finished_pipeline_slot_stops_its_subscribed_actor() {
        let pair = native_pty_system().openpty(PtySize { rows: 3, cols: 20, pixel_width: 0, pixel_height: 0 }).unwrap();
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.arg("-c"); cmd.arg("exit 0");
        let child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let reader = pair.master.try_clone_reader().unwrap();
        let pipeline = pipeline(engine::start(20, 3, Box::new(|_| true), Box::new(|_| {})).unwrap());
        let slot = pipeline.slot.clone();
        let weak = Arc::downgrade(&slot);
        let handle = slot.handle().unwrap();
        run_engine_pipeline(1, reader, pipeline, child, Arc::new(AtomicBool::new(false)), |_| {}, |_| {}).join().unwrap();
        drop(slot);
        assert!(weak.upgrade().is_none(), "failure subscription cannot own its slot");
        if let Ok(reply) = handle.read_text(3) {
            assert!(reply.recv_timeout(Duration::from_secs(2)).map(|result| result.is_err()).unwrap_or(true));
        }
    }

    #[test]
    fn a_rejected_final_frame_invalidates_even_a_zero_exit_shell() {
        use std::sync::atomic::AtomicUsize;
        let pair = native_pty_system().openpty(PtySize { rows: 5, cols: 40, pixel_width: 0, pixel_height: 0 }).expect("openpty");
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.arg("-c");
        cmd.arg("printf 'undelivered last output'; exit 0");
        let child = pair.slave.spawn_command(cmd).expect("spawn");
        drop(pair.slave);
        let reader = pair.master.try_clone_reader().expect("reader");
        let calls = Arc::new(AtomicUsize::new(0));
        let sink_calls = calls.clone();
        let engine = engine::start(40, 5, Box::new(move |_| sink_calls.fetch_add(1, Ordering::SeqCst) == 0), Box::new(|_| {})).expect("engine");
        let (tx, rx) = mpsc::channel();
        let waiter = run_engine_pipeline(1, reader, pipeline(engine), child, Arc::new(AtomicBool::new(false)), |_| {}, move |code| { tx.send(code).unwrap(); });
        waiter.join().expect("waiter");
        let code = rx.recv_timeout(Duration::from_secs(2)).expect("session exit");
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_ne!(code, 0, "a dead frame sink cannot leave a successful session");
        assert!(rx.try_recv().is_err(), "exit is emitted once");
    }


    #[test]
    fn a_failed_engine_is_reported_before_any_more_pty_bytes_or_child_exit() {
        let pair = native_pty_system().openpty(PtySize { rows: 5, cols: 40, pixel_width: 0, pixel_height: 0 }).unwrap();
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.arg("-c");
        cmd.arg("stty -echo; read value; exit 0");
        let child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let reader = pair.master.try_clone_reader().unwrap();
        let cleanup = Arc::new(Mutex::new(Some(child.clone_killer())));
        let (failed_tx, failed_rx) = mpsc::channel();
        let engine = engine::start(40, 5, Box::new(|_| false), Box::new(|_| {})).unwrap();
        engine.handle.on_failure(move |_| { failed_tx.send(()).unwrap(); });
        failed_rx.recv_timeout(Duration::from_secs(2)).expect("failure exists before pipeline subscribes");
        let (tx, rx) = mpsc::channel();
        let kill_on_exit = cleanup.clone();
        let exited = Arc::new(AtomicBool::new(false));
        let waiter = run_engine_pipeline(1, reader, pipeline(engine), child, exited.clone(), |_| {}, move |code| {
            if let Some(mut killer) = kill_on_exit.lock().unwrap().take() { let _ = killer.kill(); }
            tx.send(code).unwrap();
        });
        let code = rx.recv_timeout(Duration::from_secs(2));
        if let Some(mut killer) = cleanup.lock().unwrap().take() { let _ = killer.kill(); }
        let deadline = Instant::now() + Duration::from_secs(2);
        while !waiter.is_finished() && Instant::now() < deadline { thread::sleep(Duration::from_millis(5)); }
        assert!(waiter.is_finished(), "owned test child/reader/waiter must finish");
        waiter.join().unwrap();
        assert_eq!(code.unwrap(), engine::ENGINE_FAILED_EXIT);
        assert!(exited.load(Ordering::Acquire));
        assert!(rx.try_recv().is_err(), "exit is reported only once");
    }

    #[test]
    fn a_panicking_failure_observer_cannot_prevent_killing_a_live_child() {
        let pair = native_pty_system().openpty(PtySize { rows: 3, cols: 20, pixel_width: 0, pixel_height: 0 }).unwrap();
        let mut cmd = CommandBuilder::new("/bin/sh"); cmd.arg("-c"); cmd.arg("read value; exit 0");
        let child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let reader = pair.master.try_clone_reader().unwrap();
        let cleanup = Arc::new(Mutex::new(Some(child.clone_killer())));
        let actor = engine::start(20, 3, Box::new(|_| false), Box::new(|_| {})).unwrap();
        let mut pipeline = pipeline(actor);
        pipeline.on_failure = Arc::new(|_| panic!("injected observer panic"));
        let (tx, rx) = mpsc::channel();
        let kill = cleanup.clone();
        let waiter = run_engine_pipeline(1, reader, pipeline, child, Arc::new(AtomicBool::new(false)), |_| {}, move |code| {
            if let Some(mut killer) = kill.lock().unwrap().take() { let _ = killer.kill(); }
            tx.send(code).unwrap();
        });
        let result = rx.recv_timeout(Duration::from_secs(2));
        if let Some(mut killer) = cleanup.lock().unwrap().take() { let _ = killer.kill(); }
        waiter.join().unwrap();
        assert_eq!(result.unwrap(), engine::ENGINE_FAILED_EXIT);
    }

    #[test]
    fn a_panicking_finalization_observer_cannot_abandon_the_owner_or_exit() {
        struct PanickingReader;
        impl Read for PanickingReader {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> { panic!("injected reader panic"); }
        }
        let pair = native_pty_system().openpty(PtySize { rows: 3, cols: 20, pixel_width: 0, pixel_height: 0 }).unwrap();
        let mut cmd = CommandBuilder::new("/bin/sh"); cmd.arg("-c"); cmd.arg("exit 0");
        let child = pair.slave.spawn_command(cmd).unwrap(); drop(pair.slave);
        let mut pipeline = pipeline(engine::start(20, 3, Box::new(|_| true), Box::new(|_| {})).unwrap());
        let slot = pipeline.slot.clone();
        pipeline.on_failure = Arc::new(|_| panic!("injected finalization observer panic"));
        let (tx, rx) = mpsc::channel();
        run_engine_pipeline(1, Box::new(PanickingReader), pipeline, child, Arc::new(AtomicBool::new(false)), |_| {}, move |code| {
            tx.send(code).unwrap();
        }).join().expect("observer must not panic the waiter");
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), engine::ENGINE_FAILED_EXIT);
        assert!(slot.handle().is_err());
        assert!(slot.close().is_none(), "failed owner must already be retired");
    }

    #[test]
    fn a_panicking_engine_is_reported_even_after_all_producers_are_done() {
        let engine = engine::start(20, 5, Box::new(|_| panic!("injected frame sink panic")), Box::new(|_| {})).unwrap();
        let (tx, rx) = mpsc::channel();
        engine.handle.on_failure(move |failure| { tx.send(failure).unwrap(); });
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), engine::EngineFailure::Panicked);
        assert_eq!(engine.thread.join(), Err(engine::EngineFailure::Panicked));
    }


    #[test]
    fn an_exit_callback_can_reenter_without_deadlock_and_cannot_report_twice() {
        let exited = Arc::new(AtomicBool::new(false));
        let count = Arc::new(Mutex::new(Vec::new()));
        let output = count.clone();
        let observed = exited.clone();
        let exit: Arc<EngineExit> = Arc::new_cyclic(|weak: &std::sync::Weak<EngineExit>| {
            let weak = weak.clone();
            EngineExit {
                exited: exited.clone(),
                callback: Mutex::new(Some(Box::new(move |code| {
                    assert!(observed.load(Ordering::Acquire));
                    output.lock().unwrap().push(code);
                    weak.upgrade().unwrap().report(0);
                }))),
            }
        });
        exit.report(engine::ENGINE_FAILED_EXIT);
        exit.report(0);
        assert_eq!(*count.lock().unwrap(), vec![engine::ENGINE_FAILED_EXIT]);
    }

}
