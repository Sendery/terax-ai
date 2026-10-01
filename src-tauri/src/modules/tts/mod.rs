//! Local text-to-speech: private runtime, installation jobs and sidecar
//! lifecycle.
//!
//! Everything the feature writes lives under `app_local_data_dir()/tts`, and
//! every child process runs with a rebuilt environment, so the user's shell,
//! PATH, caches and system Python are never touched. Deleting that one
//! directory returns the machine to its prior state.
//!
//! Nothing here runs until the user asks for it: no thread is started, no
//! sidecar is spawned and no directory is created by merely managing the state.

pub mod commands;
pub mod engines;
pub mod env;
pub mod install;
pub mod jobs;
pub mod layout;
pub mod models;
pub mod runtime;
pub mod samples;
pub mod sidecar;

use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use engines::{Device, Engine, Model};
use jobs::{JobInfo, JobRegistry};
use layout::{dir_size, Layout};
use sidecar::Sidecar;

/// Sizes are walked from disk, so a poll-driven status call reuses the last
/// answer for a moment rather than re-walking a multi-gigabyte model cache.
const SIZE_CACHE_MS: u64 = 5_000;

pub fn layout_for(app: &AppHandle) -> Result<Layout, String> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("tts");
    Ok(Layout::new(root))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub installed: bool,
    pub uv_version: Option<String>,
    pub python_version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub id: Engine,
    pub installed: bool,
    pub spec_version: Option<u32>,
    /// What an install would write today; a lower `specVersion` means the
    /// installed venv is stale.
    pub latest_spec_version: u32,
    pub installed_at: Option<u64>,
    pub running: bool,
    pub port: Option<u16>,
    pub token: Option<String>,
    pub device: Option<Device>,
    pub pid: Option<u32>,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub id: Model,
    pub engine: Engine,
    pub downloaded: bool,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsStatus {
    pub runtime: RuntimeStatus,
    pub engines: Vec<EngineStatus>,
    pub models: Vec<ModelStatus>,
    pub jobs: Vec<JobInfo>,
    pub disk_usage_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartedSidecar {
    pub port: u16,
    pub token: String,
}

#[derive(Clone)]
struct SizeCache {
    at_ms: u64,
    disk_usage: u64,
    engines: HashMap<Engine, u64>,
    models: HashMap<Model, u64>,
}

#[derive(Default)]
pub struct TtsState {
    pub jobs: JobRegistry,
    sidecars: RwLock<HashMap<Engine, Arc<Sidecar>>>,
    /// Serialises `start` so two concurrent calls cannot spawn two sidecars for
    /// the same engine; the map itself stays readable meanwhile.
    start_lock: Mutex<()>,
    sizes: Mutex<Option<SizeCache>>,
}

impl TtsState {
    /// The live sidecar for an engine, dropping the record when the process has
    /// exited on its own.
    pub fn sidecar(&self, engine: Engine) -> Option<Arc<Sidecar>> {
        let found = self.sidecars.read().ok()?.get(&engine).cloned();
        match found {
            Some(sidecar) if sidecar.is_alive() => Some(sidecar),
            Some(_) => {
                self.take(engine);
                None
            }
            None => None,
        }
    }

    pub fn take(&self, engine: Engine) -> Option<Arc<Sidecar>> {
        self.sidecars.write().ok()?.remove(&engine)
    }

    pub fn start(
        &self,
        layout: &Layout,
        engine: Engine,
        device: Device,
    ) -> Result<StartedSidecar, String> {
        let _serialised = self
            .start_lock
            .lock()
            .map_err(|_| "tts start lock is poisoned".to_string())?;
        if let Some(live) = self.sidecar(engine) {
            return Ok(StartedSidecar {
                port: live.port,
                token: live.token.clone(),
            });
        }
        // The sidecar refuses a token shorter than 16 characters; `random_token`
        // returns 64 hex characters.
        let token = crate::modules::pi::random_token()?;
        let spawned = sidecar::spawn(layout, engine, device, token)?;
        let started = StartedSidecar {
            port: spawned.port,
            token: spawned.token.clone(),
        };
        self.sidecars
            .write()
            .map_err(|_| "tts sidecar map is poisoned".to_string())?
            .insert(engine, Arc::new(spawned));
        Ok(started)
    }

    /// Kills every sidecar without asking. Used by `Drop` and by the app exit
    /// hook, where nothing may block or await.
    pub fn kill_all(&self) {
        let drained: Vec<Arc<Sidecar>> = match self.sidecars.write() {
            Ok(mut map) => map.drain().map(|(_, sidecar)| sidecar).collect(),
            Err(_) => Vec::new(),
        };
        for sidecar in drained {
            sidecar.kill();
        }
    }

    pub fn running_engines(&self) -> Vec<Engine> {
        match self.sidecars.read() {
            Ok(map) => {
                let mut ids: Vec<Engine> = map
                    .iter()
                    .filter(|(_, sidecar)| sidecar.is_alive())
                    .map(|(engine, _)| *engine)
                    .collect();
                ids.sort();
                ids
            }
            Err(_) => Vec::new(),
        }
    }

    fn sizes(&self, layout: &Layout) -> SizeCache {
        let now = jobs::now_ms();
        if let Ok(cache) = self.sizes.lock() {
            if let Some(cached) = cache.as_ref() {
                if now.saturating_sub(cached.at_ms) < SIZE_CACHE_MS {
                    return cached.clone();
                }
            }
        }
        let fresh = SizeCache {
            at_ms: now,
            disk_usage: dir_size(layout.root()),
            engines: Engine::ALL
                .into_iter()
                .map(|engine| (engine, dir_size(&layout.engine_dir(engine))))
                .collect(),
            models: Model::ALL
                .into_iter()
                .map(|model| (model, dir_size(&layout.model_dir(model))))
                .collect(),
        };
        if let Ok(mut cache) = self.sizes.lock() {
            *cache = Some(fresh.clone());
        }
        fresh
    }

    pub fn invalidate_sizes(&self) {
        if let Ok(mut cache) = self.sizes.lock() {
            *cache = None;
        }
    }

    pub fn status(&self, layout: &Layout) -> TtsStatus {
        let sizes = self.sizes(layout);
        let runtime_state = install::read_runtime_state(layout);
        let runtime = RuntimeStatus {
            installed: install::runtime_installed(layout),
            uv_version: runtime_state.as_ref().and_then(|s| s.uv_version.clone()),
            python_version: runtime_state
                .as_ref()
                .and_then(|s| s.python_version.clone()),
        };

        let engines = Engine::ALL
            .into_iter()
            .map(|engine| {
                let state = install::read_engine_state(layout, engine);
                let live = self.sidecar(engine);
                EngineStatus {
                    id: engine,
                    installed: install::engine_installed(layout, engine),
                    spec_version: state.as_ref().map(|s| s.spec_version),
                    latest_spec_version: engine.spec_version(),
                    installed_at: state.as_ref().map(|s| s.installed_at),
                    running: live.is_some(),
                    port: live.as_ref().map(|s| s.port),
                    token: live.as_ref().map(|s| s.token.clone()),
                    device: live.as_ref().map(|s| s.device),
                    pid: live.as_ref().map(|s| s.pid),
                    size_bytes: sizes.engines.get(&engine).copied().unwrap_or(0),
                }
            })
            .collect();

        let models = Model::ALL
            .into_iter()
            .map(|model| {
                let size = sizes.models.get(&model).copied().unwrap_or(0);
                ModelStatus {
                    id: model,
                    engine: model.engine(),
                    downloaded: size > 0 && layout.model_dir(model).is_dir(),
                    size_bytes: size,
                }
            })
            .collect();

        TtsStatus {
            runtime,
            engines,
            models,
            jobs: self.jobs.list(),
            disk_usage_bytes: sizes.disk_usage,
        }
    }
}

impl Drop for TtsState {
    fn drop(&mut self) {
        self.jobs.cancel_all();
        self.kill_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_state_reports_nothing_installed_and_nothing_running() {
        let temp = tempfile::tempdir().unwrap();
        let layout = Layout::new(temp.path().join("tts"));
        let state = TtsState::default();
        let status = state.status(&layout);
        assert!(!status.runtime.installed);
        assert_eq!(status.runtime.uv_version, None);
        assert_eq!(status.engines.len(), 2);
        assert_eq!(status.models.len(), 4);
        assert_eq!(status.disk_usage_bytes, 0);
        assert!(status.jobs.is_empty());
        for engine in status.engines {
            assert!(!engine.installed);
            assert!(!engine.running);
            assert_eq!(engine.port, None);
            assert_eq!(engine.token, None);
            assert_eq!(engine.spec_version, None);
            assert_eq!(engine.latest_spec_version, engine.id.spec_version());
        }
        for model in status.models {
            assert!(!model.downloaded);
            assert_eq!(model.size_bytes, 0);
            assert_eq!(model.engine, model.id.engine());
        }
        assert!(state.running_engines().is_empty());
        assert!(state.sidecar(Engine::Kokoro).is_none());
    }

    #[test]
    fn status_reports_sizes_and_reuses_them_within_the_cache_window() {
        let temp = tempfile::tempdir().unwrap();
        let layout = Layout::new(temp.path().join("tts"));
        layout.ensure().unwrap();
        std::fs::create_dir_all(layout.model_dir(Model::Kokoro82m)).unwrap();
        std::fs::write(
            layout.model_dir(Model::Kokoro82m).join("weights.bin"),
            vec![0_u8; 2048],
        )
        .unwrap();
        let state = TtsState::default();
        let first = state.status(&layout);
        let kokoro = first
            .models
            .iter()
            .find(|m| m.id == Model::Kokoro82m)
            .unwrap();
        assert!(kokoro.downloaded);
        assert_eq!(kokoro.size_bytes, 2048);
        assert_eq!(first.disk_usage_bytes, 2048);

        std::fs::write(
            layout.model_dir(Model::Kokoro82m).join("more.bin"),
            vec![0_u8; 1024],
        )
        .unwrap();
        let cached = state.status(&layout);
        assert_eq!(cached.disk_usage_bytes, 2048);
        state.invalidate_sizes();
        assert_eq!(state.status(&layout).disk_usage_bytes, 3072);
    }

    #[test]
    fn status_serializes_the_shape_the_frontend_contract_names() {
        let temp = tempfile::tempdir().unwrap();
        let layout = Layout::new(temp.path().join("tts"));
        let json = serde_json::to_string(&TtsState::default().status(&layout)).unwrap();
        for key in [
            "\"runtime\"",
            "\"uvVersion\"",
            "\"pythonVersion\"",
            "\"engines\"",
            "\"specVersion\"",
            "\"latestSpecVersion\"",
            "\"installedAt\"",
            "\"sizeBytes\"",
            "\"models\"",
            "\"downloaded\"",
            "\"jobs\"",
            "\"diskUsageBytes\"",
        ] {
            assert!(json.contains(key), "{key} missing from {json}");
        }
        assert!(json.contains("\"id\":\"kokoro\""), "{json}");
        assert!(json.contains("\"id\":\"kokoro-82m\""), "{json}");
    }

    #[test]
    fn start_refuses_before_the_engine_is_installed() {
        let temp = tempfile::tempdir().unwrap();
        let layout = Layout::new(temp.path().join("tts"));
        layout.ensure().unwrap();
        let state = TtsState::default();
        assert!(state.start(&layout, Engine::Kokoro, Device::Cpu).is_err());
        assert!(state.running_engines().is_empty());
    }

    #[test]
    fn kill_all_is_safe_with_nothing_running() {
        let state = TtsState::default();
        state.kill_all();
        state.kill_all();
        assert!(state.running_engines().is_empty());
    }
}
