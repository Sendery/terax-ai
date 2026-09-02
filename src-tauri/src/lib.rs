pub mod modules;

use modules::{
    agent, agent_cli, agentsessions, capture, fs, git, history, net, pi, pisessions, pty,
    scheduler, secrets, shell, slotmonit, tts, waker, workspace,
};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
#[cfg(target_os = "macos")]
use tauri::{PhysicalPosition, WindowEvent};
use tauri_plugin_window_state::StateFlags;

/// Drained on first read so HMR / re-mounts can't replay the launch dir.
#[derive(Default)]
struct LaunchDir(Mutex<Option<String>>);

#[tauri::command]
fn get_launch_dir(state: State<'_, LaunchDir>) -> Option<String> {
    state.0.lock().expect("LaunchDir mutex poisoned").take()
}

fn parse_launch_dir() -> Option<String> {
    for arg in std::env::args().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        let Ok(canon) = std::fs::canonicalize(&arg) else {
            continue;
        };
        if !canon.is_dir() {
            continue;
        }
        return Some(crate::modules::fs::to_canon(&canon));
    }
    None
}

#[tauri::command]
async fn open_settings_window(app: tauri::AppHandle, tab: Option<String>) -> Result<(), String> {
    let url_path = match tab.as_deref() {
        Some(t) if !t.is_empty() => format!("settings.html?tab={}", t),
        _ => "settings.html".to_string(),
    };

    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.set_always_on_top(true);
        let _ = window.show();
        let _ = window.set_focus();
        if let Some(t) = tab.as_deref().filter(|s| !s.is_empty()) {
            // emit() serializes via JSON — no string-escape footgun, unlike
            // eval() with format!(). Frontend listens via Tauri event API.
            let _ = window.emit("terax:settings-tab", t);
        }
        return Ok(());
    }

    let builder = WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App(url_path.into()))
        .title("Settings")
        .inner_size(900.0, 700.0)
        .min_inner_size(820.0, 620.0)
        .resizable(true)
        .visible(false)
        // Keep settings above the main app window so it doesn't get hidden
        // when the user clicks back into the editor or terminal (#33).
        .always_on_top(true);

    // Tie lifecycle to the main window so settings minimizes/closes with it.
    // macOS: skip parent() — child + always_on_top leaves the settings webview
    // behind the main window except while the parent is being dragged (#33).
    #[cfg(not(target_os = "macos"))]
    let builder = if let Some(main) = app.get_webview_window("main") {
        builder.parent(&main).map_err(|e| e.to_string())?
    } else {
        builder
    };

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    // On Linux/Windows we render our own titlebar, so drop native chrome
    // and make the window transparent.
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    let builder = builder.decorations(false).transparent(true);

    let window = builder.build().map_err(|e| e.to_string())?;
    let _ = &window;

    // Some Linux compositors (GNOME/Mutter with CSD-by-default) ignore the
    // builder-time decorations flag — re-assert it after realize.
    #[cfg(target_os = "linux")]
    {
        let _ = window.set_decorations(false);
    }

    #[cfg(target_os = "macos")]
    if let Some(main) = app.get_webview_window("main") {
        if let (Ok(main_pos), Ok(main_size), Ok(settings_size)) = (
            main.outer_position(),
            main.outer_size(),
            window.outer_size(),
        ) {
            let x = main_pos.x
                + ((main_size.width as i32).saturating_sub(settings_size.width as i32)) / 2;
            let y = main_pos.y
                + ((main_size.height as i32).saturating_sub(settings_size.height as i32)) / 2;
            let _ = window.set_position(PhysicalPosition::new(x, y));
        } else {
            let _ = window.center();
        }
    }

    Ok(())
}

/// Detachable floating notes window. Always-on-top but deliberately NOT focused
/// on open/reuse, so the user keeps interacting with the terminal in the main
/// window. Singleton by the stable "notes" label.
#[tauri::command]
async fn open_notes_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("notes") {
        let _ = window.set_always_on_top(true);
        let _ = window.show();
        // No set_focus(): the main window keeps keyboard focus.
        return Ok(());
    }

    let builder = WebviewWindowBuilder::new(&app, "notes", WebviewUrl::App("notes.html".into()))
        .title("Notes")
        .inner_size(340.0, 620.0)
        .min_inner_size(300.0, 360.0)
        .resizable(true)
        .visible(false)
        .focused(false)
        .always_on_top(true);

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    #[cfg(any(target_os = "linux", target_os = "windows"))]
    let builder = builder.decorations(false).transparent(true);

    let window = builder.build().map_err(|e| e.to_string())?;

    #[cfg(target_os = "linux")]
    {
        let _ = window.set_decorations(false);
    }

    // Guarantee an on-screen geometry regardless of any earlier saved state.
    let _ = window.set_size(tauri::LogicalSize::new(360.0, 640.0));
    let _ = window.center();
    let _ = &window;

    Ok(())
}

/// Close the floating notes window if it exists (used when docking back from the
/// main window). No-op when the window is already closed.
#[tauri::command]
async fn close_notes_window(app: tauri::AppHandle) -> Result<(), String> {
    // destroy() force-closes without the close-requested round-trip; the window's
    // own JS onCloseRequested handler otherwise swallows a Rust-initiated close().
    if let Some(window) = app.get_webview_window("notes") {
        let _ = window.destroy();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // A waker invocation is meant to be almost free. Ask a live instance to
    // handle it, or read the exported deadline, and exit before building an app
    // when there is nothing to do. This is the only single-instance guard: normal
    // launches keep their existing behaviour.
    let wake_mode = waker::is_wake_invocation();
    if wake_mode && !waker::should_boot_for_wake() {
        return;
    }

    let cli_dir = parse_launch_dir();
    workspace::init_launch_cwd(cli_dir.as_deref());

    let builder = tauri::Builder::default();
    #[cfg(target_os = "linux")]
    let builder = builder.plugin(tauri_plugin_clipboard_manager::init());
    builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Skip restoring VISIBLE — frontend calls window.show() after first
        // paint so the user never sees a transparent window-shadow flash on
        // Windows/Linux.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                // The floating notes window manages its own geometry; don't let
                // the state plugin restore a stale/off-screen size or position.
                .with_denylist(&["notes"])
                .build(),
        )
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .manage(pi::PiBridgeState::default())
        .setup(move |_app| {
            // macOS skips parent() for the settings window, so tie its lifecycle
            // to the main window here instead. Other platforms keep parent().
            #[cfg(target_os = "macos")]
            if let Some(main) = _app.get_webview_window("main") {
                let handle = _app.handle().clone();
                main.on_window_event(move |event| {
                    if matches!(
                        event,
                        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
                    ) {
                        if let Some(settings) = handle.get_webview_window("settings") {
                            let _ = settings.close();
                        }
                        if let Some(notes) = handle.get_webview_window("notes") {
                            let _ = notes.close();
                        }
                    }
                });
            }
            if let Err(err) = pi::start_bridge(_app.handle().clone()) {
                log::warn!("pi bridge failed to start: {err}");
            }
            // Launched by the OS waker rather than by the user, so come up out of
            // the way. The app stays resident and the internal clock takes over.
            if wake_mode {
                if let Some(main) = _app.get_webview_window("main") {
                    let _ = main.minimize();
                }
            }
            Ok(())
        })
        .manage(pty::PtyState::default())
        .manage(shell::ShellState::default())
        .manage(secrets::SecretsState::default())
        .manage(fs::watch::FsWatchState::default())
        .manage(agent_cli::AgentCliState::default())
        .manage(history::HistoryState::default())
        .manage(scheduler::SchedulerState::default())
        .manage(fs::grep::ContentSearchState::default())
        .manage(tts::TtsState::default())
        .manage({
            let registry = workspace::WorkspaceRegistry::default();
            workspace::bootstrap_registry(&registry);
            if let Some(ref launch_dir) = cli_dir {
                let _ = registry.authorize(launch_dir);
            }
            registry
        })
        .manage(LaunchDir(Mutex::new(cli_dir)))
        .invoke_handler(tauri::generate_handler![
            capture::capture_persist,
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            pty::pty_close_all,
            pty::pty_has_foreground_process,
            pty::pty_has_foreground_job,
            pty::pty_shell_name,
            fs::tree::list_subdirs,
            fs::tree::fs_read_dir,
            fs::file::fs_read_file,
            fs::file::fs_write_file,
            fs::file::fs_stat,
            fs::file::fs_canonicalize,
            fs::mutate::fs_create_file,
            fs::mutate::fs_create_dir,
            fs::mutate::fs_rename,
            fs::mutate::fs_delete,
            fs::mutate::fs_copy,
            fs::watch::fs_watch_add,
            fs::watch::fs_watch_remove,
            fs::search::fs_search,
            fs::search::fs_list_files,
            fs::grep::fs_grep,
            fs::grep::fs_grep_interactive,
            fs::grep::fs_glob,
            git::commands::git_resolve_repo,
            git::commands::git_panel_snapshot,
            git::commands::git_status,
            git::commands::git_diff,
            git::commands::git_diff_content,
            git::commands::git_stage,
            git::commands::git_unstage,
            git::commands::git_discard,
            git::commands::git_commit,
            git::commands::git_fetch,
            git::commands::git_pull_ff_only,
            git::commands::git_push,
            git::commands::git_log,
            git::commands::git_show_commit,
            git::commands::git_commit_files,
            git::commands::git_commit_file_diff,
            git::commands::git_branches,
            git::commands::git_range_summary,
            git::commands::git_range_file_diff,
            git::commands::git_remote_url,
            shell::shell_run_command,
            shell::shell_session_open,
            shell::shell_session_run,
            shell::shell_session_close,
            shell::shell_bg_spawn,
            shell::shell_bg_logs,
            shell::shell_bg_kill,
            shell::shell_bg_list,
            scheduler::scheduler_arm,
            waker::waker_status,
            waker::waker_install,
            waker::waker_uninstall,
            waker::waker_write_state,
            pisessions::pi_session_offset,
            pisessions::pi_session_usage,
            pisessions::pi_sessions_list,
            agentsessions::agent_session_read,
            agentsessions::agent_sessions_list,
            agentsessions::agent_session_branch,
            slotmonit::slot_monit_query,
            workspace::wsl_list_distros,
            workspace::wsl_default_distro,
            workspace::wsl_home,
            workspace::workspace_authorize,
            workspace::workspace_current_dir,
            get_launch_dir,
            open_settings_window,
            open_notes_window,
            close_notes_window,
            pi::external_command_respond,
            agent::agent_enable_claude_hooks,
            agent::agent_claude_hooks_status,
            agent_cli::agent_cli_which,
            agent_cli::agent_cli_spawn,
            agent_cli::agent_cli_kill,
            secrets::secrets_get,
            secrets::secrets_set,
            secrets::secrets_delete,
            secrets::secrets_get_all,
            net::lm_ping,
            net::ai_http_request,
            net::ai_http_stream,
            net::download_release_asset,
            history::history_suggest,
            history::history_commands,
            history::history_record,
            history::history_list,
            tts::commands::tts_layout,
            tts::commands::tts_status,
            tts::commands::tts_install_runtime,
            tts::commands::tts_install_engine,
            tts::commands::tts_remove_engine,
            tts::commands::tts_download_model,
            tts::commands::tts_remove_model,
            tts::commands::tts_job_logs,
            tts::commands::tts_job_cancel,
            tts::commands::tts_start,
            tts::commands::tts_stop,
            tts::commands::tts_stop_all,
            tts::commands::tts_models_list,
            tts::commands::tts_models_purge,
            tts::commands::tts_purge_all,
            tts::commands::tts_reveal_dir,
            tts::commands::tts_sample_import,
            tts::commands::tts_sample_remove,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // A TTS sidecar is a Python process holding a loaded model; unlike a
            // PTY it has no window event of its own, so it is killed from the
            // app's own exit path as well as from `Drop for TtsState`.
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                if let Some(state) = app.try_state::<tts::TtsState>() {
                    state.kill_all();
                }
            }
        });
}
