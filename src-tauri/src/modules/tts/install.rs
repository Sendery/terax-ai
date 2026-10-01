//! Installation step sequences.
//!
//! Every step is one child process whose name is logged before its output, so
//! a job log reads as a transcript. A failed engine install removes the partial
//! venv and never writes `state.json`, which is the only record the rest of the
//! module treats as "installed".

use std::fs;
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::engines::{EmbeddedFile, Engine, Model, PYTHON_VERSION, SERVER_FILES};
use super::env::{apply_env, child_env, HostDirs};
use super::jobs::{now_ms, Job};
use super::layout::{set_private, Layout};
use super::runtime;

/// The uv archive is about 20 MB; the ceiling is generous but finite so a
/// redirect to something enormous cannot exhaust memory.
const MAX_ARCHIVE_BYTES: usize = 128 * 1024 * 1024;
const MAX_CHECKSUM_BYTES: usize = 64 * 1024;

/// Two engine installs may run at once and either may find the runtime absent,
/// so the bootstrap is serialised process-wide and re-checked under the lock.
/// Without this both would download and extract into `runtime/uv` together.
static RUNTIME_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStateFile {
    pub spec_version: u32,
    pub installed_at: u64,
    pub pins: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStateFile {
    pub uv_version: Option<String>,
    pub python_version: Option<String>,
    pub installed_at: u64,
}

pub fn read_engine_state(layout: &Layout, engine: Engine) -> Option<EngineStateFile> {
    let bytes = fs::read(layout.engine_state(engine)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub fn read_runtime_state(layout: &Layout) -> Option<RuntimeStateFile> {
    let bytes = fs::read(layout.runtime_state()).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub fn engine_installed(layout: &Layout, engine: Engine) -> bool {
    layout.venv_python(engine).is_file() && read_engine_state(layout, engine).is_some()
}

pub fn runtime_installed(layout: &Layout) -> bool {
    layout.uv_bin().is_file() && read_runtime_state(layout).is_some()
}

/// Identifies the embedded sidecar sources. Both the path and the length are
/// hashed so moving content between files changes the digest.
pub fn server_sources_hash() -> String {
    let mut hasher = Sha256::new();
    for EmbeddedFile { rel, body } in SERVER_FILES {
        hasher.update(rel.as_bytes());
        hasher.update([0_u8]);
        hasher.update(body.len().to_le_bytes());
        hasher.update([0_u8]);
        hasher.update(body.as_bytes());
        hasher.update([0_u8]);
    }
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Rewrites `server/` when the embedded sources differ from what is on disk.
/// Returns true when files were written.
pub fn write_server_sources(layout: &Layout) -> Result<bool, String> {
    let expected = server_sources_hash();
    let current = fs::read_to_string(layout.server_hash()).ok();
    let up_to_date = current.as_deref().map(str::trim) == Some(expected.as_str())
        && SERVER_FILES
            .iter()
            .all(|file| layout.server().join(file.rel).is_file());
    if up_to_date {
        return Ok(false);
    }
    let root = layout.server();
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    set_private(&root);
    for EmbeddedFile { rel, body } in SERVER_FILES {
        let dest = root.join(rel);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            set_private(parent);
        }
        fs::write(&dest, body).map_err(|e| format!("cannot write {rel}: {e}"))?;
        set_private(&dest);
    }
    fs::write(layout.server_hash(), &expected).map_err(|e| e.to_string())?;
    set_private(&layout.server_hash());
    Ok(true)
}

/// Every uv invocation carries `--no-config`: a `uv.toml` in the user's
/// configuration directory would otherwise redirect the index, the cache or the
/// Python source of a supposedly self-contained install.
fn uv_command(layout: &Layout) -> Command {
    let mut cmd = Command::new(layout.uv_bin());
    cmd.arg("--no-config").current_dir(layout.root());
    apply_env(&mut cmd, &child_env(layout, &HostDirs::resolve(), None));
    cmd
}

fn python_command(layout: &Layout, engine: Engine) -> Command {
    let mut cmd = Command::new(layout.venv_python(engine));
    cmd.current_dir(layout.server());
    apply_env(&mut cmd, &child_env(layout, &HostDirs::resolve(), None));
    cmd
}

fn tar_command(layout: &Layout) -> Command {
    let mut cmd = Command::new("tar");
    cmd.current_dir(layout.root());
    apply_env(&mut cmd, &child_env(layout, &HostDirs::resolve(), None));
    cmd
}

/// Captures a short line of output (a version string or a path) while still
/// logging it. A failure is not fatal: the version is cosmetic.
fn capture(job: &Job, mut cmd: Command) -> Option<String> {
    crate::modules::proc::hide_console(&mut cmd);
    let output = cmd.output().ok()?;
    job.log_bytes(&output.stdout);
    job.log_bytes(&output.stderr);
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .unwrap_or_default()
        .trim()
        .to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

pub fn install_runtime(job: &Job, layout: &Layout) -> Result<(), String> {
    let _serialised = RUNTIME_LOCK
        .lock()
        .map_err(|_| "the tts runtime lock is poisoned".to_string())?;
    install_runtime_locked(job, layout)
}

/// Installs the runtime only if it is missing. Shares the lock with
/// `install_runtime` so the check and the install cannot interleave.
pub fn ensure_runtime(job: &Job, layout: &Layout) -> Result<(), String> {
    let _serialised = RUNTIME_LOCK
        .lock()
        .map_err(|_| "the tts runtime lock is poisoned".to_string())?;
    if runtime_installed(layout) {
        return Ok(());
    }
    install_runtime_locked(job, layout)
}

fn install_runtime_locked(job: &Job, layout: &Layout) -> Result<(), String> {
    layout.ensure().map_err(|e| e.to_string())?;

    let asset = runtime::host_uv_asset()?;
    let archive = layout.downloads().join(asset);

    job.step(&format!("download uv {} ({asset})", runtime::UV_VERSION));
    let bytes = tauri::async_runtime::block_on(crate::modules::net::fetch_github_asset(
        &runtime::uv_asset_url(asset),
        MAX_ARCHIVE_BYTES,
    ))?;
    job.log(&format!("{} bytes\n", bytes.len()));
    if job.is_cancelled() {
        return Err("cancelled".into());
    }

    job.step("verify uv checksum");
    let checksum = tauri::async_runtime::block_on(crate::modules::net::fetch_github_asset(
        &runtime::uv_checksum_url(asset),
        MAX_CHECKSUM_BYTES,
    ))?;
    let expected = runtime::parse_sha256_file(&String::from_utf8_lossy(&checksum), asset)?;
    runtime::verify_sha256(&bytes, &expected)?;
    job.log(&format!("sha256 {expected}\n"));

    job.step("extract uv");
    fs::create_dir_all(layout.downloads()).map_err(|e| e.to_string())?;
    fs::write(&archive, &bytes).map_err(|e| e.to_string())?;
    set_private(&archive);
    let uv_dir = layout.uv_dir();
    if uv_dir.exists() {
        let _ = fs::remove_dir_all(&uv_dir);
    }
    fs::create_dir_all(&uv_dir).map_err(|e| e.to_string())?;
    set_private(&uv_dir);
    let mut tar = tar_command(layout);
    tar.args(runtime::extract_args(
        &archive.to_string_lossy(),
        &uv_dir.to_string_lossy(),
    ));
    let extracted = job.run("tar", tar);
    let _ = fs::remove_file(&archive);
    extracted?;
    if !layout.uv_bin().is_file() {
        return Err("the uv archive did not contain a uv binary".into());
    }
    set_private(&layout.uv_bin());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(layout.uv_bin(), fs::Permissions::from_mode(0o700));
    }

    job.step(&format!("uv python install {PYTHON_VERSION}"));
    let mut install = uv_command(layout);
    install.args(["python", "install", "--no-bin"]);
    #[cfg(windows)]
    install.arg("--no-registry");
    install.arg(PYTHON_VERSION);
    job.run("uv python install", install)?;

    job.step("record runtime versions");
    let mut version = uv_command(layout);
    version.arg("--version");
    let uv_version = capture(job, version);

    let mut find = uv_command(layout);
    find.args(["python", "find", PYTHON_VERSION]);
    let python_version = capture(job, find).and_then(|interpreter| {
        let mut probe = Command::new(interpreter);
        probe.arg("--version");
        apply_env(&mut probe, &child_env(layout, &HostDirs::resolve(), None));
        capture(job, probe)
    });
    let state = RuntimeStateFile {
        uv_version,
        python_version,
        installed_at: now_ms(),
    };
    write_json(&layout.runtime_state(), &state)?;
    Ok(())
}

pub fn install_engine(job: &Job, layout: &Layout, engine: Engine) -> Result<(), String> {
    job.step("ensure the runtime");
    ensure_runtime(job, layout)?;
    layout.ensure().map_err(|e| e.to_string())?;

    job.step("write sidecar sources");
    let written = write_server_sources(layout)?;
    job.log(if written {
        "sources updated\n"
    } else {
        "sources already current\n"
    });

    // The state file is the installed marker, so it goes away before the venv
    // is rebuilt: an interrupted install must not look complete.
    let state_path = layout.engine_state(engine);
    let _ = fs::remove_file(&state_path);

    let venv = layout.venv(engine);
    let outcome = (|| -> Result<(), String> {
        fs::create_dir_all(layout.engine_dir(engine)).map_err(|e| e.to_string())?;
        set_private(&layout.engine_dir(engine));
        if venv.exists() {
            fs::remove_dir_all(&venv).map_err(|e| e.to_string())?;
        }
        job.step(&format!("uv venv --python {PYTHON_VERSION}"));
        let mut create = uv_command(layout);
        create.args(["venv", "--python", PYTHON_VERSION]).arg(&venv);
        job.run("uv venv", create)?;

        job.step(&format!(
            "uv pip install -r {}",
            engine.requirements_file_name()
        ));
        let mut install = uv_command(layout);
        install
            .args(["pip", "install", "--python"])
            .arg(layout.venv_python(engine))
            .arg("-r")
            .arg(layout.requirements(engine));
        job.run("uv pip install", install)?;
        Ok(())
    })();

    if let Err(error) = outcome {
        job.step("remove the partial venv");
        let _ = fs::remove_dir_all(&venv);
        return Err(error);
    }

    job.step("record engine state");
    let state = EngineStateFile {
        spec_version: engine.spec_version(),
        installed_at: now_ms(),
        pins: engine.pins(),
    };
    write_json(&state_path, &state)?;
    Ok(())
}

pub fn remove_engine(job: &Job, layout: &Layout, engine: Engine) -> Result<(), String> {
    job.step(&format!("remove {}", engine.id()));
    let dir = layout.engine_dir(engine);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    job.log("removed\n");
    Ok(())
}

pub fn download_model(job: &Job, layout: &Layout, model: Model) -> Result<(), String> {
    let engine = model.engine();
    if !engine_installed(layout, engine) {
        return Err(format!(
            "install the {} engine before downloading {}",
            engine.id(),
            model.id()
        ));
    }
    write_server_sources(layout)?;
    fs::create_dir_all(layout.hf_home()).map_err(|e| e.to_string())?;
    set_private(&layout.hf_home());

    job.step(&format!("download {}", model.id()));
    let mut download = python_command(layout, engine);
    download
        .arg(layout.download_script())
        .arg("--model")
        .arg(model.id());
    job.run("download.py", download)
}

pub fn purge(job: &Job, layout: &Layout) -> Result<(), String> {
    job.step("delete the tts directory");
    let root = layout.root();
    if root.exists() {
        fs::remove_dir_all(root).map_err(|e| e.to_string())?;
    }
    job.log("deleted\n");
    Ok(())
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, body).map_err(|e| e.to_string())?;
    set_private(path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_sources_hash_is_stable_and_covers_every_embedded_file() {
        let hash = server_sources_hash();
        assert_eq!(hash.len(), 64);
        assert_eq!(hash, server_sources_hash());
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(SERVER_FILES.len() >= 9);
    }

    #[test]
    fn sources_are_written_once_and_rewritten_when_the_hash_file_is_stale() {
        let temp = tempfile::tempdir().unwrap();
        let layout = Layout::new(temp.path().join("tts"));
        layout.ensure().unwrap();
        assert!(write_server_sources(&layout).unwrap());
        for file in SERVER_FILES {
            assert!(
                layout.server().join(file.rel).is_file(),
                "{} was not written",
                file.rel
            );
        }
        assert!(!write_server_sources(&layout).unwrap());
        fs::write(layout.server_hash(), "stale").unwrap();
        assert!(write_server_sources(&layout).unwrap());
        assert_eq!(
            fs::read_to_string(layout.server_hash()).unwrap(),
            server_sources_hash()
        );
    }

    #[test]
    fn a_deleted_source_file_is_restored_even_when_the_hash_matches() {
        let temp = tempfile::tempdir().unwrap();
        let layout = Layout::new(temp.path().join("tts"));
        layout.ensure().unwrap();
        write_server_sources(&layout).unwrap();
        fs::remove_file(layout.server_entry()).unwrap();
        assert!(write_server_sources(&layout).unwrap());
        assert!(layout.server_entry().is_file());
    }

    #[test]
    fn installed_means_a_state_file_and_an_interpreter() {
        let temp = tempfile::tempdir().unwrap();
        let layout = Layout::new(temp.path().join("tts"));
        layout.ensure().unwrap();
        assert!(!runtime_installed(&layout));
        assert!(!engine_installed(&layout, Engine::Kokoro));

        write_json(
            &layout.engine_state(Engine::Kokoro),
            &EngineStateFile {
                spec_version: 1,
                installed_at: 1,
                pins: vec!["kokoro==0.9.4".into()],
            },
        )
        .unwrap();
        // A state file without an interpreter is not an installation.
        assert!(!engine_installed(&layout, Engine::Kokoro));

        let python = layout.venv_python(Engine::Kokoro);
        fs::create_dir_all(python.parent().unwrap()).unwrap();
        fs::write(&python, "").unwrap();
        assert!(engine_installed(&layout, Engine::Kokoro));
        assert_eq!(
            read_engine_state(&layout, Engine::Kokoro).unwrap().pins,
            vec!["kokoro==0.9.4".to_string()]
        );
    }

    #[test]
    fn a_corrupt_state_file_reads_as_not_installed() {
        let temp = tempfile::tempdir().unwrap();
        let layout = Layout::new(temp.path().join("tts"));
        layout.ensure().unwrap();
        fs::create_dir_all(layout.engine_dir(Engine::Kokoro)).unwrap();
        fs::write(layout.engine_state(Engine::Kokoro), "{ not json").unwrap();
        assert!(read_engine_state(&layout, Engine::Kokoro).is_none());
        fs::write(layout.runtime_state(), "[]").unwrap();
        assert!(read_runtime_state(&layout).is_none());
    }

    #[test]
    fn state_files_serialize_with_camel_case_keys() {
        let json = serde_json::to_string(&EngineStateFile {
            spec_version: 3,
            installed_at: 42,
            pins: vec!["a==1".into()],
        })
        .unwrap();
        assert!(json.contains("\"specVersion\":3"), "{json}");
        assert!(json.contains("\"installedAt\":42"), "{json}");
        assert!(json.contains("\"pins\""), "{json}");
    }

    #[test]
    fn download_refuses_a_model_whose_engine_is_absent() {
        let temp = tempfile::tempdir().unwrap();
        let layout = Layout::new(temp.path().join("tts"));
        layout.ensure().unwrap();
        let registry = super::super::jobs::JobRegistry::default();
        let job = registry
            .begin(
                super::super::jobs::JobKind::ModelDownload,
                Some(Engine::Kokoro),
                Some(Model::Kokoro82m),
            )
            .unwrap();
        let error = download_model(&job, &layout, Model::Kokoro82m).unwrap_err();
        assert!(error.contains("install the kokoro engine"), "{error}");
    }

    #[test]
    fn removing_an_engine_deletes_its_directory_and_is_idempotent() {
        let temp = tempfile::tempdir().unwrap();
        let layout = Layout::new(temp.path().join("tts"));
        layout.ensure().unwrap();
        fs::create_dir_all(layout.venv(Engine::Kokoro)).unwrap();
        let registry = super::super::jobs::JobRegistry::default();
        let job = registry
            .begin(
                super::super::jobs::JobKind::EngineRemove,
                Some(Engine::Kokoro),
                None,
            )
            .unwrap();
        remove_engine(&job, &layout, Engine::Kokoro).unwrap();
        assert!(!layout.engine_dir(Engine::Kokoro).exists());
        remove_engine(&job, &layout, Engine::Kokoro).unwrap();
    }

    #[test]
    fn purge_deletes_the_root_and_tolerates_an_absent_one() {
        let temp = tempfile::tempdir().unwrap();
        let layout = Layout::new(temp.path().join("tts"));
        layout.ensure().unwrap();
        fs::write(layout.logs().join("install-kokoro.log"), "x").unwrap();
        let registry = super::super::jobs::JobRegistry::default();
        let job = registry
            .begin(super::super::jobs::JobKind::Purge, None, None)
            .unwrap();
        purge(&job, &layout).unwrap();
        assert!(!layout.root().exists());
        purge(&job, &layout).unwrap();
    }
}
