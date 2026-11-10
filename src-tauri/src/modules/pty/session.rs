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
    // Set by the waiter once the child exits, so pty_open can reap a shell
    // that died before it was registered.
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
    Engine(Channel<Response>, Option<super::colors::Colors>),
}

enum Pipeline {
    Raw(Channel<Response>),
    #[cfg(feature = "ghostty-engine")]
    Engine(engine::Engine),
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

    let cmd = shell_init::build_command(cwd, workspace, blocks)?;
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
        OutputSink::Engine(on_frame, colors) => {
            Pipeline::Engine(start_engine(cols, rows, colors, on_frame, writer.clone())?)
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
            Pipeline::Engine(e) => Some(e.handle.clone()),
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
    colors: Option<super::colors::Colors>,
    on_frame: Channel<Response>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
) -> Result<engine::Engine, String> {
    let frames: engine::FrameSink =
        Box::new(move |frame| on_frame.send(Response::new(frame)).is_ok());
    engine::start_with_colors(cols, rows, colors, frames, reply_sink(writer))
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
    engine: engine::Engine,
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
            if let Err(e) = on_exit.send(code) {
                log::debug!("pty exit send failed (channel closed): {e}");
            }
            if let Some(state) = app.try_state::<super::PtyState>() {
                if let Some(s) = state.take(id) {
                    drop_session(s);
                }
            }
        },
    );
}

// The reader keeps agent detection on the raw stream and hands every chunk to
// the engine, blocking while its queue is full. The terminal itself answers
// device queries, so there is no DaFilter and no flusher on this path.
#[cfg(feature = "ghostty-engine")]
fn run_engine_pipeline(
    id: u32,
    mut reader: Box<dyn Read + Send>,
    engine: engine::Engine,
    mut child: Box<dyn Child + Send + Sync>,
    exited: Arc<AtomicBool>,
    mut signal: impl FnMut(super::agent_detect::Transition) + Send + 'static,
    on_exit: impl FnOnce(i32) + Send + 'static,
) -> thread::JoinHandle<()> {
    let engine::Engine {
        input,
        thread: engine_thread,
        ..
    } = engine;
    let spawn_at = Instant::now();
    let reader_input = input.clone();
    let reader_thread = thread::Builder::new()
        .name("terax-pty-reader".into())
        .spawn(move || {
            let mut buf = [0u8; READ_BUF];
            let mut agent_detect = AgentDetector::new();
            let mut first_byte = true;
            let mut engine_gone = false;
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
                        // Without an engine nothing renders, but draining keeps
                        // the child from wedging on a full PTY until it is closed.
                        if !engine_gone && !reader_input.feed(buf[..n].to_vec()) {
                            engine_gone = true;
                            log::warn!("pty id={id}: terminal engine gone, discarding output");
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
            // Queued behind the last output, so the final frame shows it and
            // goes out before the exit code.
            input.shutdown();
            engine_thread.join();
            on_exit(code);
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
}
