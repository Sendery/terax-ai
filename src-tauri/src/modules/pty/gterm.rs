//! `gterm_*` commands: the IPC surface of the terminal engine. They are always
//! registered, because Tauri's handler list cannot gate single entries; built
//! without `ghostty-engine`, `gterm_available` is false and every other command
//! answers `engine-unavailable`.

use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, State};

use super::colors::TerminalColors;
use super::PtyState;
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

pub const ENGINE_UNAVAILABLE: &str = "engine-unavailable";
pub const NOT_AUTORUN: &str = "not-autorun";
pub const AUTORUN_ENV: &str = "TERAX_TERMINAL_LAB_AUTORUN";

#[cfg(any(test, feature = "ghostty-engine"))]
#[path = "lab.rs"]
mod automation;

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
    on_frame: Channel<Response>,
    on_exit: Channel<i32>,
) -> Result<u32, String> {
    #[cfg(feature = "ghostty-engine")]
    {
        imp::open(
            app, &state, &registry, cols, rows, cwd, workspace, colors, on_frame, on_exit,
        )
        .await
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = (
            app, state, registry, cols, rows, cwd, workspace, colors, on_frame, on_exit,
        );
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
pub fn gterm_lab_autorun(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    #[cfg(feature = "ghostty-engine")]
    {
        if std::env::var_os(AUTORUN_ENV).is_none() {
            return Ok(None);
        }
        autorun_for(&window).map(|p| Some(p.to_string_lossy().into_owned()))
    }
    #[cfg(not(feature = "ghostty-engine"))]
    {
        let _ = window;
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
        lab::write_report(&path, &json)?;
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
        lab::write_report(&autorun_for(&window)?.with_extension("status.json"), &json)
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
    use super::TerminalColors;
    use crate::modules::workspace::{user_spawn_cwd_or_home, WorkspaceEnv, WorkspaceRegistry};

    pub struct BenchSession {
        handle: EngineHandle,
        cancel: Arc<AtomicBool>,
    }

    pub fn engine(state: &PtyState, id: u32) -> Result<EngineHandle, String> {
        if let Some(session) = state.get(id) {
            if let Some(engine) = &session.engine {
                return Ok(engine.clone());
            }
        } else if let Some(bench) = state
            .bench
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&id)
        {
            return Ok(bench.handle.clone());
        }
        Err("no session".into())
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
        on_frame: Channel<Response>,
        on_exit: Channel<i32>,
    ) -> Result<u32, String> {
        engine::validate_size(cols, rows)?;
        let workspace = WorkspaceEnv::from_option(workspace);
        let cwd = user_spawn_cwd_or_home(registry, cwd.as_deref(), &workspace);
        let id = state.allocate_id();
        let colors = colors
            .map(super::super::colors::Colors::try_from)
            .transpose()?;
        let sink = OutputSink::Engine(on_frame, colors);
        let session = tauri::async_runtime::spawn_blocking(move || {
            session::spawn(id, app, cols, rows, cwd, workspace, false, sink, on_exit)
                .map(|(s, _)| s)
        })
        .await
        .map_err(|e| {
            log::error!("gterm_open join failed: {e}");
            e.to_string()
        })?
        .map_err(|e| {
            log::error!("gterm_open failed: {e}");
            e
        })?;
        state.register(id, session);
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

    const MAX_REPORT_BYTES: usize = 16 * 1024 * 1024;

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
