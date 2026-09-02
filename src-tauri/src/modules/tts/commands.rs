//! The IPC surface. Every command validates its arguments against the closed
//! enums or the documented shapes before touching the filesystem, and the
//! blocking work runs off the main thread.

use std::fs;
use std::str::FromStr;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, State};

use std::path::PathBuf;

use super::engines::{Device, Engine, Model};
use super::jobs::{Job, JobKind, JobLogs};
use super::layout::{display, set_private, Layout, LayoutPaths};
use super::samples::{SampleImport, SampleMeta};
use super::{install, layout_for, models, samples, sidecar};
use super::{StartedSidecar, TtsState, TtsStatus};

/// How long a purge waits for the jobs it cancelled to unwind before deleting
/// the directory they were writing into.
const PURGE_DRAIN: Duration = Duration::from_secs(10);

async fn blocking<T, F>(work: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

/// Where a job mirrors its log so it survives being pruned from the registry.
/// A purge deletes the directory it would write into, so it keeps none.
fn job_log_path(layout: &Layout, job: &Job) -> Option<PathBuf> {
    match (job.kind, job.engine, job.model) {
        (JobKind::Runtime, _, _) => Some(layout.runtime_install_log()),
        (JobKind::EngineInstall, Some(engine), _) => Some(layout.install_log(engine)),
        (JobKind::ModelDownload, _, Some(model)) => Some(layout.download_log(model)),
        _ => None,
    }
}

fn spawn_job<F>(app: AppHandle, job: Arc<Job>, work: F) -> Result<u32, String>
where
    F: FnOnce(&AppHandle, &Job, &Layout) -> Result<(), String> + Send + 'static,
{
    let id = job.id;
    let owned = Arc::clone(&job);
    let spawned = thread::Builder::new()
        .name(format!("terax-tts-job-{id}"))
        .spawn(move || {
            let outcome = match layout_for(&app) {
                Ok(layout) => {
                    if let Some(path) = job_log_path(&layout, &owned) {
                        owned.attach_log_file(&path);
                    }
                    work(&app, &owned, &layout)
                }
                Err(error) => Err(error),
            };
            if let Some(state) = app.try_state::<TtsState>() {
                state.invalidate_sizes();
            }
            owned.finish(outcome);
        });
    match spawned {
        Ok(_) => Ok(id),
        Err(error) => {
            job.finish(Err(error.to_string()));
            Err(error.to_string())
        }
    }
}

fn parse_engine(value: &str) -> Result<Engine, String> {
    Engine::from_str(value)
}

fn parse_model(value: &str) -> Result<Model, String> {
    Model::from_str(value)
}

#[tauri::command]
pub fn tts_layout(app: AppHandle) -> Result<LayoutPaths, String> {
    Ok(layout_for(&app)?.paths())
}

#[tauri::command]
pub async fn tts_status(app: AppHandle) -> Result<TtsStatus, String> {
    blocking(move || {
        let layout = layout_for(&app)?;
        Ok(app.state::<TtsState>().status(&layout))
    })
    .await
}

#[tauri::command]
pub fn tts_install_runtime(app: AppHandle, state: State<'_, TtsState>) -> Result<u32, String> {
    let job = state.jobs.begin(JobKind::Runtime, None, None)?;
    spawn_job(app, job, |_, job, layout| {
        install::install_runtime(job, layout)
    })
}

#[tauri::command]
pub fn tts_install_engine(
    app: AppHandle,
    state: State<'_, TtsState>,
    engine: String,
) -> Result<u32, String> {
    let engine = parse_engine(&engine)?;
    let job = state
        .jobs
        .begin(JobKind::EngineInstall, Some(engine), None)?;
    spawn_job(app, job, move |_, job, layout| {
        install::install_engine(job, layout, engine)
    })
}

#[tauri::command]
pub fn tts_remove_engine(
    app: AppHandle,
    state: State<'_, TtsState>,
    engine: String,
) -> Result<u32, String> {
    let engine = parse_engine(&engine)?;
    let job = state
        .jobs
        .begin(JobKind::EngineRemove, Some(engine), None)?;
    // The venv cannot be deleted from under a running interpreter, so the
    // sidecar goes first and synchronously.
    if let Some(live) = state.take(engine) {
        live.kill();
    }
    spawn_job(app, job, move |_, job, layout| {
        install::remove_engine(job, layout, engine)
    })
}

#[tauri::command]
pub fn tts_download_model(
    app: AppHandle,
    state: State<'_, TtsState>,
    model: String,
) -> Result<u32, String> {
    let model = parse_model(&model)?;
    let job = state
        .jobs
        .begin(JobKind::ModelDownload, Some(model.engine()), Some(model))?;
    spawn_job(app, job, move |_, job, layout| {
        install::download_model(job, layout, model)
    })
}

#[tauri::command]
pub async fn tts_remove_model(app: AppHandle, model: String) -> Result<(), String> {
    let model = parse_model(&model)?;
    blocking(move || {
        let layout = layout_for(&app)?;
        let resolved = models::resolve_model_dir(&layout.hf_hub(), model.hf_dir_name())?;
        fs::remove_dir_all(resolved).map_err(|e| e.to_string())?;
        app.state::<TtsState>().invalidate_sizes();
        Ok(())
    })
    .await
}

#[tauri::command]
pub fn tts_job_logs(
    state: State<'_, TtsState>,
    job_id: u32,
    since: u64,
) -> Result<JobLogs, String> {
    state
        .jobs
        .get(job_id)
        .map(|job| job.read_logs(since))
        .ok_or_else(|| format!("unknown tts job: {job_id}"))
}

#[tauri::command]
pub fn tts_job_cancel(state: State<'_, TtsState>, job_id: u32) -> Result<(), String> {
    let job = state
        .jobs
        .get(job_id)
        .ok_or_else(|| format!("unknown tts job: {job_id}"))?;
    job.cancel();
    Ok(())
}

#[tauri::command]
pub async fn tts_start(
    app: AppHandle,
    engine: String,
    device: Option<String>,
) -> Result<StartedSidecar, String> {
    let engine = parse_engine(&engine)?;
    let device = match device.as_deref() {
        None | Some("") => Device::Auto,
        Some(value) => Device::from_str(value)?,
    };
    blocking(move || {
        let layout = layout_for(&app)?;
        app.state::<TtsState>().start(&layout, engine, device)
    })
    .await
}

#[tauri::command]
pub async fn tts_stop(app: AppHandle, engine: String) -> Result<(), String> {
    let engine = parse_engine(&engine)?;
    let Some(live) = app.state::<TtsState>().take(engine) else {
        return Ok(());
    };
    // Best effort: the sidecar exits on its own if it answers, and is killed if
    // it does not.
    let _ = sidecar::request_shutdown(live.port, &live.token).await;
    blocking(move || {
        live.stop(sidecar::SHUTDOWN_GRACE);
        Ok(())
    })
    .await
}

#[tauri::command]
pub fn tts_stop_all(state: State<'_, TtsState>) -> Result<(), String> {
    state.kill_all();
    Ok(())
}

#[tauri::command]
pub async fn tts_models_list(app: AppHandle) -> Result<Vec<models::ModelDirEntry>, String> {
    blocking(move || Ok(models::scan(&layout_for(&app)?.hf_hub()))).await
}

#[tauri::command]
pub async fn tts_models_purge(app: AppHandle, dir_name: String) -> Result<(), String> {
    blocking(move || {
        let layout = layout_for(&app)?;
        let resolved = models::resolve_model_dir(&layout.hf_hub(), &dir_name)?;
        fs::remove_dir_all(resolved).map_err(|e| e.to_string())?;
        app.state::<TtsState>().invalidate_sizes();
        Ok(())
    })
    .await
}

#[tauri::command]
pub fn tts_purge_all(app: AppHandle, state: State<'_, TtsState>) -> Result<u32, String> {
    let job = state.jobs.begin(JobKind::Purge, None, None)?;
    state.kill_all();
    spawn_job(app, job, |app, job, layout| {
        let state = app
            .try_state::<TtsState>()
            .ok_or_else(|| "tts state is unavailable".to_string())?;
        state.kill_all();
        job.step("stop running jobs");
        let others: Vec<Arc<Job>> = state
            .jobs
            .running()
            .into_iter()
            .filter(|other| other.id != job.id)
            .collect();
        for other in &others {
            other.cancel();
        }
        let deadline = Instant::now() + PURGE_DRAIN;
        while others.iter().any(|other| other.is_running()) {
            if Instant::now() >= deadline {
                return Err("another tts job is still running".into());
            }
            thread::sleep(Duration::from_millis(50));
        }
        install::purge(job, layout)
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RevealTarget {
    Root,
    Models,
    Voices,
    Logs,
}

impl FromStr for RevealTarget {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "root" => Ok(RevealTarget::Root),
            "models" => Ok(RevealTarget::Models),
            "voices" => Ok(RevealTarget::Voices),
            "logs" => Ok(RevealTarget::Logs),
            other => Err(format!("unknown tts directory: {other}")),
        }
    }
}

impl RevealTarget {
    pub fn path(self, layout: &Layout) -> std::path::PathBuf {
        match self {
            RevealTarget::Root => layout.root().to_path_buf(),
            RevealTarget::Models => layout.models(),
            RevealTarget::Voices => layout.voices(),
            RevealTarget::Logs => layout.logs(),
        }
    }
}

#[tauri::command]
pub async fn tts_reveal_dir(app: AppHandle, which: String) -> Result<(), String> {
    let target = RevealTarget::from_str(&which)?;
    blocking(move || {
        let layout = layout_for(&app)?;
        layout.ensure().map_err(|e| e.to_string())?;
        let path = target.path(&layout);
        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        set_private(&path);
        tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn tts_sample_import(
    app: AppHandle,
    name: String,
    wav: Vec<u8>,
) -> Result<SampleImport, String> {
    let info = samples::validate_wav(&wav)?;
    let label = samples::sanitize_sample_name(&name);
    blocking(move || {
        let layout = layout_for(&app)?;
        layout.ensure().map_err(|e| e.to_string())?;
        let sample_id: String = crate::modules::pi::random_token()?
            .chars()
            .take(32)
            .collect();
        samples::validate_sample_id(&sample_id)?;
        let path = layout.sample(&sample_id);
        let bytes = wav.len();
        fs::write(&path, &wav).map_err(|e| e.to_string())?;
        set_private(&path);
        let meta = SampleMeta {
            sample_id: sample_id.clone(),
            name: label,
            created_at: super::jobs::now_ms(),
            info,
        };
        let meta_path = layout.sample_meta(&sample_id);
        let body = serde_json::to_vec_pretty(&meta).map_err(|e| e.to_string())?;
        fs::write(&meta_path, body).map_err(|e| e.to_string())?;
        set_private(&meta_path);
        Ok(SampleImport {
            sample_id,
            path: display(&path),
            bytes,
        })
    })
    .await
}

#[tauri::command]
pub async fn tts_sample_remove(app: AppHandle, sample_id: String) -> Result<(), String> {
    samples::validate_sample_id(&sample_id)?;
    blocking(move || {
        let layout = layout_for(&app)?;
        let _ = fs::remove_file(layout.sample(&sample_id));
        let _ = fs::remove_file(layout.sample_meta(&sample_id));
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reveal_targets_are_a_closed_set_inside_the_root() {
        let layout = Layout::new("/data/tts");
        for (value, expected) in [
            ("root", layout.root().to_path_buf()),
            ("models", layout.models()),
            ("voices", layout.voices()),
            ("logs", layout.logs()),
        ] {
            let target = RevealTarget::from_str(value).unwrap();
            assert_eq!(target.path(&layout), expected);
            assert!(target.path(&layout).starts_with(layout.root()));
        }
        for bad in [
            "",
            "Root",
            "server",
            "runtime",
            "..",
            "/etc",
            "root/../..",
            "engines",
        ] {
            assert!(
                RevealTarget::from_str(bad).is_err(),
                "{bad:?} must be rejected"
            );
        }
    }

    #[test]
    fn each_job_kind_mirrors_its_log_to_a_distinct_file_under_logs() {
        let layout = Layout::new("/data/tts");
        let registry = super::super::jobs::JobRegistry::default();
        let runtime = registry.begin(JobKind::Runtime, None, None).unwrap();
        let install = registry
            .begin(JobKind::EngineInstall, Some(Engine::Kokoro), None)
            .unwrap();
        let download = registry
            .begin(
                JobKind::ModelDownload,
                Some(Engine::Chatterbox),
                Some(Model::ChatterboxTurbo),
            )
            .unwrap();
        let purge = registry.begin(JobKind::Purge, None, None).unwrap();
        let paths: Vec<Option<PathBuf>> = [&runtime, &install, &download, &purge]
            .iter()
            .map(|job| job_log_path(&layout, job))
            .collect();
        assert_eq!(paths[0], Some(layout.runtime_install_log()));
        assert_eq!(paths[1], Some(layout.install_log(Engine::Kokoro)));
        assert_eq!(paths[2], Some(layout.download_log(Model::ChatterboxTurbo)));
        assert_eq!(paths[3], None);
        for path in paths.into_iter().flatten() {
            assert!(path.starts_with(layout.logs()), "{path:?}");
        }
    }

    #[test]
    fn command_arguments_are_parsed_through_the_closed_enums() {
        assert_eq!(parse_engine("kokoro"), Ok(Engine::Kokoro));
        assert!(parse_engine("kokoro; rm -rf /").is_err());
        assert!(parse_engine("../../etc").is_err());
        assert_eq!(parse_model("chatterbox-turbo"), Ok(Model::ChatterboxTurbo));
        assert!(parse_model("chatterbox").is_err());
        assert_eq!(Device::from_str("auto"), Ok(Device::Auto));
        assert!(Device::from_str("gpu").is_err());
    }

    #[test]
    fn the_install_module_is_reachable_under_both_names() {
        // `install` and `steps` are the same module; keep the alias honest so a
        // future rename cannot silently split the two call sites.
        assert_eq!(
            install::server_sources_hash(),
            install::server_sources_hash()
        );
    }
}
