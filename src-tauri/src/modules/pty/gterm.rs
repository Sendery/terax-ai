//! `gterm_*` commands: the IPC surface of the terminal engine. They are always
//! registered, because Tauri's handler list cannot gate single entries; built
//! without `ghostty-engine`, `gterm_available` is false and every other command
//! answers `engine-unavailable`.

use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, State};

use super::colors::TerminalColors;
use super::PtyState;
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

#[path = "credit_batch.rs"]
pub mod credit_batch;

pub const ENGINE_UNAVAILABLE: &str = "engine-unavailable";
pub const NOT_AUTORUN: &str = "not-autorun";
pub const AUTORUN_ENV: &str = "TERAX_TERMINAL_LAB_AUTORUN";

#[cfg(any(test, feature = "ghostty-engine"))]
#[path = "lab.rs"]
mod automation;

#[cfg(feature = "ghostty-engine")]
static AUTORUN: std::sync::Mutex<automation::RunState> =
    std::sync::Mutex::new(automation::RunState::new());

#[cfg(feature = "ghostty-engine")]
fn autorun_for(window: &tauri::WebviewWindow) -> Result<std::path::PathBuf, String> {
    automation::authorize(
        window.label(),
        crate::modules::profile::is_sandbox(),
        lab::autorun_path(std::env::var_os(AUTORUN_ENV)),
    )
}

#[cfg(feature = "ghostty-engine")]
type Stats = super::engine::EngineStats;
#[cfg(not(feature = "ghostty-engine"))]
type Stats = ();

#[cfg(feature = "ghostty-engine")]
type InputState = super::engine::state::EngineState;
#[cfg(not(feature = "ghostty-engine"))]
type InputState = ();

#[tauri::command]
pub fn gterm_state(state: State<'_, PtyState>, id: u32) -> Result<InputState, String> {
    #[cfg(feature = "ghostty-engine")]
    {
        imp::engine(&state, id).map(|engine| engine.input_state())
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = (state, id);
        Err(ENGINE_UNAVAILABLE.into())
    }
}

#[tauri::command]
pub fn gterm_available() -> bool {
    cfg!(feature = "ghostty-engine")
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn gterm_open(
    app: AppHandle,
    state: State<'_, PtyState>,
    registry: State<'_, WorkspaceRegistry>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    workspace: Option<WorkspaceEnv>,
    colors: Option<TerminalColors>,
    blocks: Option<bool>,
    on_frame: Channel<Response>,
    on_exit: Channel<i32>,
    on_failure: Channel<String>,
    on_state: Channel<InputState>,
) -> Result<u32, String> {
    #[cfg(feature = "ghostty-engine")]
    {
        imp::open(
            app,
            &state,
            &registry,
            cols,
            rows,
            cwd,
            workspace,
            colors,
            blocks.unwrap_or(false),
            on_frame,
            on_exit,
            on_failure,
            on_state,
        )
        .await
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = (
            app, state, registry, cols, rows, cwd, workspace, colors, blocks, on_frame, on_exit,
            on_failure, on_state,
        );
        Err(ENGINE_UNAVAILABLE.into())
    }
}

#[cfg(feature = "ghostty-engine")]
type InputEvent = super::engine::input::InputEvent;
#[cfg(not(feature = "ghostty-engine"))]
type InputEvent = serde_json::Value;

#[tauri::command]
pub async fn gterm_encode_input(
    state: State<'_, PtyState>,
    id: u32,
    event: InputEvent,
) -> Result<Vec<u8>, String> {
    #[cfg(feature = "ghostty-engine")]
    {
        event.validate()?;
        let permit = state.core(id).ok_or("no terminal core")?.reserve_input()?;
        tauri::async_runtime::spawn_blocking(move || permit.encode(event))
            .await
            .map_err(|error| format!("terminal input task failed: {error}"))?
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = (state, id, event);
        Err(ENGINE_UNAVAILABLE.into())
    }
}

#[cfg(feature = "ghostty-engine")]
type SelectionCommand = super::engine::selection::SelectionCommand;
#[cfg(not(feature = "ghostty-engine"))]
type SelectionCommand = serde_json::Value;

#[tauri::command]
pub async fn gterm_selection(
    state: State<'_, PtyState>,
    id: u32,
    command: SelectionCommand,
) -> Result<Option<String>, String> {
    #[cfg(feature = "ghostty-engine")]
    {
        let reply = imp::engine(&state, id)?.selection(command)?;
        tauri::async_runtime::spawn_blocking(move || {
            reply
                .recv_timeout(std::time::Duration::from_secs(2))
                .map_err(|error| format!("terminal selection query failed: {error}"))?
        })
        .await
        .map_err(|error| format!("terminal selection task failed: {error}"))?
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = (state, id, command);
        Err(ENGINE_UNAVAILABLE.into())
    }
}

#[cfg(feature = "ghostty-engine")]
type SearchCommand = super::engine::search::SearchCommand;
#[cfg(not(feature = "ghostty-engine"))]
type SearchCommand = serde_json::Value;

#[tauri::command]
pub async fn gterm_search(
    state: State<'_, PtyState>,
    id: u32,
    command: SearchCommand,
) -> Result<bool, String> {
    #[cfg(feature = "ghostty-engine")]
    {
        let reply = imp::engine(&state, id)?.search(command)?;
        tauri::async_runtime::spawn_blocking(move || {
            reply
                .recv_timeout(std::time::Duration::from_secs(10))
                .map_err(|error| format!("terminal search query failed: {error}"))?
        })
        .await
        .map_err(|error| format!("terminal search task failed: {error}"))?
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = (state, id, command);
        Err(ENGINE_UNAVAILABLE.into())
    }
}

#[cfg(feature = "ghostty-engine")]
type BlockCommand = super::engine::block_actions::BlockCommand;
#[cfg(not(feature = "ghostty-engine"))]
type BlockCommand = serde_json::Value;
#[cfg(feature = "ghostty-engine")]
type BlockReply = super::engine::block_actions::BlockReply;
#[cfg(not(feature = "ghostty-engine"))]
type BlockReply = serde_json::Value;

#[tauri::command]
pub async fn gterm_block_action(
    state: State<'_, PtyState>,
    id: u32,
    command: BlockCommand,
) -> Result<BlockReply, String> {
    #[cfg(feature = "ghostty-engine")]
    {
        let reply = imp::engine(&state, id)?.block_action(command)?;
        tauri::async_runtime::spawn_blocking(move || {
            reply
                .recv_timeout(std::time::Duration::from_secs(2))
                .map_err(|error| format!("terminal block action failed: {error}"))?
        })
        .await
        .map_err(|error| format!("terminal block action task failed: {error}"))?
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = (state, id, command);
        Err(ENGINE_UNAVAILABLE.into())
    }
}

#[cfg(feature = "ghostty-engine")]
type BlockSnapshot = super::engine::blocks::BlockSnapshot;
#[cfg(not(feature = "ghostty-engine"))]
type BlockSnapshot = serde_json::Value;
#[cfg(feature = "ghostty-engine")]
type BlockOutput = super::engine::blocks::BlockOutput;
#[cfg(not(feature = "ghostty-engine"))]
type BlockOutput = serde_json::Value;

#[tauri::command]
pub async fn gterm_blocks(
    state: State<'_, PtyState>,
    id: u32,
    seq: Option<u32>,
) -> Result<BlockSnapshot, String> {
    #[cfg(feature = "ghostty-engine")]
    {
        let engine = imp::engine(&state, id)?;
        let reply = match seq {
            Some(seq) => engine.blocks_for_frame(seq)?,
            None => engine.blocks()?,
        };
        tauri::async_runtime::spawn_blocking(move || {
            reply
                .recv_timeout(std::time::Duration::from_secs(2))
                .map_err(|error| format!("terminal blocks query failed: {error}"))?
        })
        .await
        .map_err(|error| format!("terminal blocks task failed: {error}"))?
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = (state, id, seq);
        Err(ENGINE_UNAVAILABLE.into())
    }
}
#[tauri::command]
pub async fn gterm_read_block(
    state: State<'_, PtyState>,
    id: u32,
    block_id: String,
) -> Result<Option<BlockOutput>, String> {
    #[cfg(feature = "ghostty-engine")]
    {
        let reply = imp::engine(&state, id)?.read_block(block_id)?;
        tauri::async_runtime::spawn_blocking(move || {
            reply
                .recv_timeout(std::time::Duration::from_secs(2))
                .map_err(|error| format!("terminal block read failed: {error}"))?
        })
        .await
        .map_err(|error| format!("terminal block read task failed: {error}"))?
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = (state, id, block_id);
        Err(ENGINE_UNAVAILABLE.into())
    }
}

#[cfg(feature = "ghostty-engine")]
type LinkContext = super::engine::links::LinkContext;
#[cfg(not(feature = "ghostty-engine"))]
type LinkContext = serde_json::Value;

#[tauri::command]
pub async fn gterm_link_context(
    state: State<'_, PtyState>,
    id: u32,
    seq: u32,
    col: u16,
    row: u16,
) -> Result<Option<LinkContext>, String> {
    #[cfg(feature = "ghostty-engine")]
    {
        let reply = imp::engine(&state, id)?.link_context(seq, col, row)?;
        tauri::async_runtime::spawn_blocking(move || {
            reply
                .recv_timeout(std::time::Duration::from_secs(2))
                .map_err(|error| format!("terminal link query failed: {error}"))?
        })
        .await
        .map_err(|error| format!("terminal link task failed: {error}"))?
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = (state, id, seq, col, row);
        Err(ENGINE_UNAVAILABLE.into())
    }
}

#[tauri::command]
pub fn gterm_set_colors(
    state: State<'_, PtyState>,
    id: u32,
    colors: TerminalColors,
) -> Result<(), String> {
    #[cfg(feature = "ghostty-engine")]
    {
        let colors = super::colors::Colors::try_from(colors)?;
        imp::engine(&state, id).map(|e| e.set_colors(colors))
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = (state, id, colors);
        Err(ENGINE_UNAVAILABLE.into())
    }
}

#[tauri::command]
pub fn gterm_resize(
    state: State<'_, PtyState>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    #[cfg(feature = "ghostty-engine")]
    {
        use std::sync::atomic::Ordering;
        super::engine::validate_size(cols, rows)?;
        let slot = state.core(id).ok_or("no terminal core")?;
        let engine = slot.handle()?;
        let session = state.sessions.read().unwrap().get(&id).cloned();
        if let Some(session) = session {
            if !session.exited.load(Ordering::Acquire) {
                let result = session
                    .master
                    .lock()
                    .unwrap()
                    .resize(portable_pty::PtySize {
                        rows,
                        cols,
                        pixel_width: 0,
                        pixel_height: 0,
                    });
                if let Err(error) = result {
                    if !session.exited.load(Ordering::Acquire) {
                        return Err(error.to_string());
                    }
                }
            }
        }
        // Revalidate after the kernel operation; close must not revive a core.
        slot.handle()?;
        engine.resize(cols, rows);
        Ok(())
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = (state, id, cols, rows);
        Err(ENGINE_UNAVAILABLE.into())
    }
}

#[tauri::command]
pub fn gterm_credit(state: State<'_, PtyState>, id: u32, seq: u32) -> Result<(), String> {
    #[cfg(feature = "ghostty-engine")]
    {
        imp::engine(&state, id).map(|e| e.credit(seq))
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = (state, id, seq);
        Err(ENGINE_UNAVAILABLE.into())
    }
}

#[tauri::command]
pub fn gterm_lab_credits(
    window: tauri::WebviewWindow,
    state: State<'_, PtyState>,
    credits: credit_batch::CreditBatch,
) -> Result<(), String> {
    #[cfg(feature = "ghostty-engine")]
    {
        autorun_for(&window)?;
        imp::bench_credits(&state, &credits)
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = (window, state, credits);
        Err(ENGINE_UNAVAILABLE.into())
    }
}

#[tauri::command]
pub fn gterm_scroll(state: State<'_, PtyState>, id: u32, delta: i32) -> Result<(), String> {
    #[cfg(feature = "ghostty-engine")]
    {
        imp::engine(&state, id).map(|e| e.scroll(delta))
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = (state, id, delta);
        Err(ENGINE_UNAVAILABLE.into())
    }
}

#[tauri::command]
pub fn gterm_request_full(state: State<'_, PtyState>, id: u32) -> Result<(), String> {
    #[cfg(feature = "ghostty-engine")]
    {
        imp::engine(&state, id).map(|e| e.request_full())
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = (state, id);
        Err(ENGINE_UNAVAILABLE.into())
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn gterm_bench_open(
    state: State<'_, PtyState>,
    kind: String,
    megabytes: u32,
    cols: u16,
    rows: u16,
    colors: Option<TerminalColors>,
    on_frame: Channel<Response>,
    on_exit: Channel<i32>,
) -> Result<u32, String> {
    #[cfg(feature = "ghostty-engine")]
    {
        imp::bench_open(
            &state, &kind, megabytes, cols, rows, colors, on_frame, on_exit,
        )
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = (
            state, kind, megabytes, cols, rows, colors, on_frame, on_exit,
        );
        Err(ENGINE_UNAVAILABLE.into())
    }
}

#[tauri::command]
pub fn gterm_bench_stats(state: State<'_, PtyState>, id: u32) -> Result<Stats, String> {
    #[cfg(feature = "ghostty-engine")]
    {
        imp::engine(&state, id).map(|e| e.stats())
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = (state, id);
        Err(ENGINE_UNAVAILABLE.into())
    }
}

#[tauri::command]
pub async fn gterm_read_text(
    state: State<'_, PtyState>,
    id: u32,
    max_lines: u16,
) -> Result<String, String> {
    #[cfg(feature = "ghostty-engine")]
    {
        let receiver = imp::engine(&state, id)?.read_text(max_lines)?;
        tauri::async_runtime::spawn_blocking(move || {
            receiver
                .recv_timeout(std::time::Duration::from_secs(2))
                .map_err(|error| format!("terminal text query failed: {error}"))?
        })
        .await
        .map_err(|error| format!("terminal text query task failed: {error}"))?
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = (state, id, max_lines);
        Err(ENGINE_UNAVAILABLE.into())
    }
}

#[tauri::command]
pub fn gterm_lab_autorun(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, PtyState>,
) -> Result<Option<String>, String> {
    #[cfg(feature = "ghostty-engine")]
    {
        if std::env::var_os(AUTORUN_ENV).is_none() {
            return Ok(None);
        }
        let path = autorun_for(&window)?;
        let claimed = AUTORUN
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .claim(&path);
        if let Err(error) = claimed {
            log::error!("terminal lab bootstrap failed: {error}");
            if let Err(close_error) = super::pty_close_all(state) {
                log::error!("terminal lab cleanup failed: {close_error}");
            }
            app.exit(1);
            return Err(error);
        }
        Ok(Some(path.to_string_lossy().into_owned()))
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = (app, window, state);
        Err(ENGINE_UNAVAILABLE.into())
    }
}

/// Writes the lab's result to the autorun path and exits. The path only ever
/// comes from the environment of the process, never from the webview.
#[tauri::command]
pub fn gterm_lab_report(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, PtyState>,
    json: String,
) -> Result<(), String> {
    #[cfg(feature = "ghostty-engine")]
    {
        let path = autorun_for(&window)?;
        AUTORUN
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .write_report(&path, &json)?;
        super::pty_close_all(state)?;
        log::info!("terminal lab report written to {}; exiting", path.display());
        app.exit(0);
        Ok(())
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = (app, window, state, json);
        Err(ENGINE_UNAVAILABLE.into())
    }
}

#[tauri::command]
pub fn gterm_lab_config(window: tauri::WebviewWindow) -> Result<serde_json::Value, String> {
    #[cfg(feature = "ghostty-engine")]
    {
        autorun_for(&window)?;
        let config = automation::config(
            &std::env::var("TERAX_TERMINAL_LAB_MODE").unwrap_or_else(|_| "bench".into()),
            &std::env::var("TERAX_TERMINAL_LAB_IDLE_COUNT").unwrap_or_else(|_| "12".into()),
            &std::env::var("TERAX_TERMINAL_LAB_HOLD_SECONDS").unwrap_or_else(|_| "60".into()),
        )?;
        serde_json::to_value(config).map_err(|e| e.to_string())
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = window;
        Err(ENGINE_UNAVAILABLE.into())
    }
}

#[tauri::command]
pub fn gterm_lab_status(window: tauri::WebviewWindow, json: String) -> Result<(), String> {
    #[cfg(feature = "ghostty-engine")]
    {
        let path = autorun_for(&window)?;
        AUTORUN
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .write_status(&path, &json)
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = (window, json);
        Err(ENGINE_UNAVAILABLE.into())
    }
}

#[tauri::command]
pub fn gterm_lab_capture(
    window: tauri::WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    #[cfg(feature = "ghostty-engine")]
    {
        let report = autorun_for(&window)?;
        let pane = request
            .headers()
            .get("x-lab-pane")
            .and_then(|h| h.to_str().ok())
            .ok_or("missing pane")?;
        let path = automation::capture_path(&report, pane)?;
        let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
            return Err("capture requires raw PNG bytes".into());
        };
        automation::write_capture(&path, bytes)
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = (window, request);
        Err(ENGINE_UNAVAILABLE.into())
    }
}

#[tauri::command]
pub async fn gterm_lab_fixture(
    window: tauri::WebviewWindow,
    kind: String,
    megabytes: u32,
    rows: u16,
) -> Result<serde_json::Value, String> {
    #[cfg(feature = "ghostty-engine")]
    {
        let report = autorun_for(&window)?;
        tauri::async_runtime::spawn_blocking(move || {
            automation::write_fixture(&report, &kind, megabytes, rows)
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = (window, kind, megabytes, rows);
        Err(ENGINE_UNAVAILABLE.into())
    }
}

/// Whether startup should open the Terminal Lab for an autorun.
pub fn lab_autorun_requested() -> bool {
    let value = std::env::var_os(AUTORUN_ENV);
    #[cfg(feature = "ghostty-engine")]
    {
        let path = lab::autorun_path(value.clone());
        if path.is_none() && value.is_some() {
            log::warn!("{AUTORUN_ENV} must be an absolute file path; ignoring it");
        }
        path.is_some() && crate::modules::profile::is_sandbox()
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        if value.is_some() {
            log::warn!("{AUTORUN_ENV} ignored: this build has no ghostty-engine feature");
        }
        false
    }
}

pub(super) fn close_bench(state: &PtyState, id: u32) -> bool {
    #[cfg(feature = "ghostty-engine")]
    {
        imp::close_bench(state, id)
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = (state, id);
        false
    }
}

pub(super) fn close_all_bench(state: &PtyState) -> usize {
    #[cfg(feature = "ghostty-engine")]
    {
        imp::close_all_bench(state)
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = state;
        0
    }
}

#[cfg(feature = "ghostty-engine")]
pub(super) use imp::BenchSession;

#[cfg(feature = "ghostty-engine")]
mod imp {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, PoisonError};

    use tauri::ipc::{Channel, Response};
    use tauri::AppHandle;

    use super::super::engine::{self, bench, EngineHandle};
    use super::super::session::{self, OutputSink};
    use super::super::PtyState;
    use super::{InputState, TerminalColors};
    use crate::modules::workspace::{user_spawn_cwd_or_home, WorkspaceEnv, WorkspaceRegistry};

    pub struct BenchSession {
        handle: EngineHandle,
        cancel: Arc<AtomicBool>,
    }

    pub fn engine(state: &PtyState, id: u32) -> Result<EngineHandle, String> {
        if let Some(slot) = state.core(id) {
            return slot.handle();
        }
        if let Some(bench) = state
            .bench
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&id)
        {
            return Ok(bench.handle.clone());
        }
        Err("no session".into())
    }

    pub fn bench_credits(
        state: &PtyState,
        credits: &super::credit_batch::CreditBatch,
    ) -> Result<(), String> {
        let benches = state.bench.lock().unwrap_or_else(PoisonError::into_inner);
        super::credit_batch::register(
            credits,
            |id| benches.get(&id).map(|session| session.handle.clone()),
            |handle, seq| handle.credit(seq),
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn open(
        app: AppHandle,
        state: &PtyState,
        registry: &WorkspaceRegistry,
        cols: u16,
        rows: u16,
        cwd: Option<String>,
        workspace: Option<WorkspaceEnv>,
        colors: Option<TerminalColors>,
        blocks: bool,
        on_frame: Channel<Response>,
        on_exit: Channel<i32>,
        on_failure: Channel<String>,
        on_state: Channel<InputState>,
    ) -> Result<u32, String> {
        engine::validate_size(cols, rows)?;
        let workspace = WorkspaceEnv::from_option(workspace);
        let cwd = user_spawn_cwd_or_home(registry, cwd.as_deref(), &workspace);
        let id = state.allocate_id();
        let colors = colors
            .map(super::super::colors::Colors::try_from)
            .transpose()?;
        let slot = state.reserve_core(id);
        let sink = OutputSink::Engine {
            on_frame,
            colors,
            slot: slot.clone(),
            on_failure,
            on_state,
        };
        let spawned = tauri::async_runtime::spawn_blocking(move || {
            session::spawn(id, app, cols, rows, cwd, workspace, blocks, sink, on_exit)
                .map(|(s, _)| s)
        })
        .await
        .map_err(|error| format!("gterm_open join failed: {error}"))
        .and_then(|result| result);
        let session = match spawned {
            Ok(session) => session,
            Err(error) => {
                drop(state.close_core(id));
                return Err(error);
            }
        };
        if !slot.publish(|| state.register(id, session.clone())) {
            drop(state.close_core(id));
            std::thread::spawn(move || session::drop_session(session));
            return Err("terminal closed or failed while opening".into());
        }
        log::info!("gterm opened id={id} cols={cols} rows={rows}");
        Ok(id)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn bench_open(
        state: &PtyState,
        kind: &str,
        megabytes: u32,
        cols: u16,
        rows: u16,
        colors: Option<TerminalColors>,
        on_frame: Channel<Response>,
        on_exit: Channel<i32>,
    ) -> Result<u32, String> {
        let kind = bench::PayloadKind::parse(kind)
            .ok_or_else(|| format!("unknown bench kind {kind:?}"))?;
        bench::validate_megabytes(megabytes)?;
        let colors = colors
            .map(super::super::colors::Colors::try_from)
            .transpose()?;
        let engine = engine::start_with_colors(
            cols,
            rows,
            colors,
            Box::new(move |frame| on_frame.send(Response::new(frame)).is_ok()),
            Box::new(|_| {}),
        )?;
        let id = state.allocate_id();
        let cancel = Arc::new(AtomicBool::new(false));
        state
            .bench
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(
                id,
                BenchSession {
                    handle: engine.handle.clone(),
                    cancel: cancel.clone(),
                },
            );
        if let Err(e) = bench::run(engine, kind, megabytes, rows, cancel, move |code| {
            let _ = on_exit.send(code);
        }) {
            state
                .bench
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .remove(&id);
            return Err(e);
        }
        log::info!("gterm bench opened id={id} kind={kind:?} megabytes={megabytes} cols={cols} rows={rows}");
        Ok(id)
    }

    pub fn close_bench(state: &PtyState, id: u32) -> bool {
        let removed = state
            .bench
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&id);
        match removed {
            Some(bench) => {
                bench.cancel.store(true, Ordering::Relaxed);
                log::info!("gterm bench closed id={id}");
                true
            }
            None => false,
        }
    }

    pub fn close_all_bench(state: &PtyState) -> usize {
        let drained: Vec<BenchSession> = state
            .bench
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .drain()
            .map(|(_, b)| b)
            .collect();
        for bench in &drained {
            bench.cancel.store(true, Ordering::Relaxed);
        }
        drained.len()
    }
}

#[cfg(any(test, feature = "ghostty-engine"))]
mod lab {
    use std::ffi::OsString;
    use std::io::Write;
    use std::path::{Path, PathBuf};

    pub(super) const MAX_REPORT_BYTES: usize = 16 * 1024 * 1024;

    pub fn autorun_path(value: Option<OsString>) -> Option<PathBuf> {
        let path = PathBuf::from(value?);
        (!path.as_os_str().is_empty() && path.is_absolute()).then_some(path)
    }

    pub fn write_report(path: &Path, json: &str) -> Result<(), String> {
        if json.len() > MAX_REPORT_BYTES {
            return Err(format!("report exceeds {MAX_REPORT_BYTES} bytes"));
        }
        serde_json::from_str::<serde_json::Value>(json)
            .map_err(|e| format!("invalid report JSON: {e}"))?;
        let dir = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .ok_or_else(|| format!("{} has no parent directory", path.display()))?;
        let mut tmp = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
        tmp.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
        tmp.as_file().sync_all().map_err(|e| e.to_string())?;
        tmp.persist(path).map_err(|e| e.error.to_string())?;
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn autorun_needs_an_absolute_path() {
            assert_eq!(autorun_path(None), None);
            assert_eq!(autorun_path(Some(OsString::new())), None);
            assert_eq!(autorun_path(Some("result.json".into())), None);
            assert_eq!(autorun_path(Some("./x/result.json".into())), None);
            let abs = std::env::temp_dir().join("result.json");
            assert_eq!(autorun_path(Some(abs.clone().into_os_string())), Some(abs));
        }

        #[test]
        fn report_is_written_whole_and_replaces_the_file() {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("result.json");
            std::fs::write(&path, "stale").unwrap();
            write_report(&path, "{\"ok\":true}").unwrap();
            assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"ok\":true}");
            let leftovers = std::fs::read_dir(dir.path()).unwrap().count();
            assert_eq!(leftovers, 1, "no temp file left behind");
        }

        #[test]
        fn oversized_reports_are_refused() {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("result.json");
            let big = "x".repeat(MAX_REPORT_BYTES + 1);
            assert!(write_report(&path, &big).is_err());
            assert!(!path.exists());
        }

        #[test]
        fn a_missing_directory_is_an_error() {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("missing").join("result.json");
            assert!(write_report(&path, "{}").is_err());
        }

        #[test]
        fn malformed_json_is_refused_without_writing() {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("result.json");
            assert!(write_report(&path, "not JSON").is_err());
            assert!(!path.exists());
        }
    }
}
