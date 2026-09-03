//! Every path the feature owns, derived from one root.
//!
//! Nothing outside this root is ever written, so deleting the root returns the
//! machine to its prior state.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::engines::{Engine, Model};

/// Depth cap for the size walk. The HF cache nests
/// `models--org--name/snapshots/<rev>/<subdir>/...`; a symlink loop or a
/// pathological tree must not turn a status poll into an unbounded walk.
const MAX_WALK_DEPTH: usize = 12;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layout {
    root: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutPaths {
    pub root: String,
    pub runtime: String,
    pub engines: String,
    pub models: String,
    pub voices: String,
    pub logs: String,
}

impl Layout {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn runtime(&self) -> PathBuf {
        self.root.join("runtime")
    }

    pub fn uv_dir(&self) -> PathBuf {
        self.runtime().join("uv")
    }

    pub fn uv_bin(&self) -> PathBuf {
        self.uv_dir()
            .join(if cfg!(windows) { "uv.exe" } else { "uv" })
    }

    pub fn python_install_dir(&self) -> PathBuf {
        self.runtime().join("python")
    }

    pub fn uv_cache_dir(&self) -> PathBuf {
        self.runtime().join("cache")
    }

    pub fn runtime_state(&self) -> PathBuf {
        self.runtime().join("state.json")
    }

    pub fn downloads(&self) -> PathBuf {
        self.runtime().join("downloads")
    }

    pub fn engines(&self) -> PathBuf {
        self.root.join("engines")
    }

    pub fn engine_dir(&self, engine: Engine) -> PathBuf {
        self.engines().join(engine.id())
    }

    pub fn venv(&self, engine: Engine) -> PathBuf {
        self.engine_dir(engine).join("venv")
    }

    pub fn venv_python(&self, engine: Engine) -> PathBuf {
        let venv = self.venv(engine);
        if cfg!(windows) {
            venv.join("Scripts").join("python.exe")
        } else {
            venv.join("bin").join("python")
        }
    }

    pub fn engine_state(&self, engine: Engine) -> PathBuf {
        self.engine_dir(engine).join("state.json")
    }

    pub fn models(&self) -> PathBuf {
        self.root.join("models")
    }

    pub fn hf_home(&self) -> PathBuf {
        self.models().join("hf")
    }

    pub fn hf_hub(&self) -> PathBuf {
        self.hf_home().join("hub")
    }

    /// `PKUSEG_HOME`. The Chinese tokenizer chatterbox pulls in downloads its
    /// own corpus, and its default is `~/.pkuseg`: without this the engine
    /// leaves ~90 MB outside the root that a purge would never reclaim.
    pub fn pkuseg_home(&self) -> PathBuf {
        self.models().join("pkuseg")
    }

    pub fn model_dir(&self, model: Model) -> PathBuf {
        self.hf_hub().join(model.hf_dir_name())
    }

    pub fn voices(&self) -> PathBuf {
        self.root.join("voices")
    }

    pub fn samples(&self) -> PathBuf {
        self.voices().join("samples")
    }

    pub fn sample(&self, sample_id: &str) -> PathBuf {
        self.samples().join(format!("{sample_id}.wav"))
    }

    pub fn sample_meta(&self, sample_id: &str) -> PathBuf {
        self.samples().join(format!("{sample_id}.json"))
    }

    pub fn server(&self) -> PathBuf {
        self.root.join("server")
    }

    pub fn server_hash(&self) -> PathBuf {
        self.server().join(".hash")
    }

    pub fn server_entry(&self) -> PathBuf {
        self.server().join("server.py")
    }

    pub fn download_script(&self) -> PathBuf {
        self.server().join("download.py")
    }

    pub fn requirements(&self, engine: Engine) -> PathBuf {
        self.server().join(engine.requirements_file_name())
    }

    pub fn logs(&self) -> PathBuf {
        self.root.join("logs")
    }

    /// `TMPDIR` for every child. It lives directly under the root and keeps a
    /// short name because espeak-ng refuses a data path longer than 160 bytes
    /// and the Kokoro adapter stages its 19 MB data tree in here.
    pub fn tmp(&self) -> PathBuf {
        self.root.join("tmp")
    }

    pub fn install_log(&self, engine: Engine) -> PathBuf {
        self.logs().join(format!("install-{}.log", engine.id()))
    }

    pub fn runtime_install_log(&self) -> PathBuf {
        self.logs().join("install-runtime.log")
    }

    pub fn download_log(&self, model: Model) -> PathBuf {
        self.logs().join(format!("download-{}.log", model.id()))
    }

    pub fn server_log(&self, engine: Engine) -> PathBuf {
        self.logs().join(format!("server-{}.log", engine.id()))
    }

    pub fn paths(&self) -> LayoutPaths {
        LayoutPaths {
            root: display(&self.root),
            runtime: display(&self.runtime()),
            engines: display(&self.engines()),
            models: display(&self.models()),
            voices: display(&self.voices()),
            logs: display(&self.logs()),
        }
    }

    /// Creates the directory skeleton. Private on Unix, and re-applied on every
    /// call so a directory restored from a backup with loose bits is tightened.
    pub fn ensure(&self) -> io::Result<()> {
        for dir in [
            self.root.clone(),
            self.runtime(),
            self.downloads(),
            self.engines(),
            self.models(),
            self.hf_home(),
            self.voices(),
            self.samples(),
            self.server(),
            self.logs(),
            self.tmp(),
        ] {
            fs::create_dir_all(&dir)?;
            set_private(&dir);
        }
        Ok(())
    }
}

pub fn display(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

pub fn set_private(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = if path.is_dir() { 0o700 } else { 0o600 };
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(mode));
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

/// Bytes on disk under `path`, following no symlinks and bounded in depth.
/// Returns 0 for a missing path so callers can report sizes without probing
/// existence first.
pub fn dir_size(path: &Path) -> u64 {
    fn walk(path: &Path, depth: usize) -> u64 {
        let Ok(meta) = fs::symlink_metadata(path) else {
            return 0;
        };
        if meta.is_file() {
            return meta.len();
        }
        if !meta.is_dir() || depth >= MAX_WALK_DEPTH {
            return 0;
        }
        let Ok(entries) = fs::read_dir(path) else {
            return 0;
        };
        entries
            .flatten()
            .map(|entry| walk(&entry.path(), depth + 1))
            .fold(0_u64, |acc, size| acc.saturating_add(size))
    }
    walk(path, 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::tts::engines::{Engine, Model};

    fn layout() -> Layout {
        Layout::new(PathBuf::from("/data/tts"))
    }

    #[test]
    fn paths_follow_the_documented_tree() {
        let l = layout();
        assert_eq!(l.root(), Path::new("/data/tts"));
        assert_eq!(l.runtime(), Path::new("/data/tts/runtime"));
        assert_eq!(l.uv_dir(), Path::new("/data/tts/runtime/uv"));
        assert_eq!(
            l.python_install_dir(),
            Path::new("/data/tts/runtime/python")
        );
        assert_eq!(l.uv_cache_dir(), Path::new("/data/tts/runtime/cache"));
        assert_eq!(
            l.engine_dir(Engine::Kokoro),
            Path::new("/data/tts/engines/kokoro")
        );
        assert_eq!(
            l.venv(Engine::Chatterbox),
            Path::new("/data/tts/engines/chatterbox/venv")
        );
        assert_eq!(
            l.engine_state(Engine::Kokoro),
            Path::new("/data/tts/engines/kokoro/state.json")
        );
        assert_eq!(l.hf_home(), Path::new("/data/tts/models/hf"));
        assert_eq!(l.hf_hub(), Path::new("/data/tts/models/hf/hub"));
        assert_eq!(
            l.model_dir(Model::Kokoro82m),
            Path::new("/data/tts/models/hf/hub/models--hexgrad--Kokoro-82M")
        );
        assert_eq!(l.samples(), Path::new("/data/tts/voices/samples"));
        assert_eq!(
            l.sample("abc123"),
            Path::new("/data/tts/voices/samples/abc123.wav")
        );
        assert_eq!(l.server_entry(), Path::new("/data/tts/server/server.py"));
        assert_eq!(l.server_hash(), Path::new("/data/tts/server/.hash"));
        assert_eq!(
            l.requirements(Engine::Kokoro),
            Path::new("/data/tts/server/requirements-kokoro.txt")
        );
        assert_eq!(
            l.install_log(Engine::Chatterbox),
            Path::new("/data/tts/logs/install-chatterbox.log")
        );
        assert_eq!(
            l.server_log(Engine::Kokoro),
            Path::new("/data/tts/logs/server-kokoro.log")
        );
        assert_eq!(
            l.runtime_install_log(),
            Path::new("/data/tts/logs/install-runtime.log")
        );
        assert_eq!(
            l.download_log(Model::Kokoro82m),
            Path::new("/data/tts/logs/download-kokoro-82m.log")
        );
        assert_eq!(l.tmp(), Path::new("/data/tts/tmp"));
    }

    #[test]
    fn the_temp_directory_leaves_espeak_room_inside_its_path_limit() {
        // espeak-ng refuses a data path over 160 bytes, and the Kokoro adapter
        // appends `terax-espeak-<8 hex>/espeak-ng-data` to this directory.
        let root = PathBuf::from(
            "/Users/a-fairly-long-user-name/Library/Application Support/app.crynta.terax/tts",
        );
        let staged = Layout::new(root)
            .tmp()
            .join("terax-espeak-0123abcd")
            .join("espeak-ng-data");
        assert!(staged.as_os_str().len() < 159, "{staged:?}");
        assert_eq!(
            Layout::new("/r").tmp(),
            Path::new("/r/tmp"),
            "tmp must stay one flat segment under the root"
        );
    }

    #[test]
    fn every_path_stays_under_the_root() {
        let l = layout();
        let mut all = vec![
            l.runtime(),
            l.uv_dir(),
            l.uv_bin(),
            l.python_install_dir(),
            l.uv_cache_dir(),
            l.runtime_state(),
            l.downloads(),
            l.engines(),
            l.models(),
            l.hf_home(),
            l.hf_hub(),
            l.voices(),
            l.samples(),
            l.sample("id"),
            l.server(),
            l.server_hash(),
            l.server_entry(),
            l.download_script(),
            l.logs(),
            l.runtime_install_log(),
            l.tmp(),
        ];
        for engine in Engine::ALL {
            all.push(l.engine_dir(engine));
            all.push(l.venv(engine));
            all.push(l.venv_python(engine));
            all.push(l.engine_state(engine));
            all.push(l.requirements(engine));
            all.push(l.install_log(engine));
            all.push(l.server_log(engine));
        }
        for model in Model::ALL {
            all.push(l.model_dir(model));
            all.push(l.download_log(model));
        }
        for path in all {
            assert!(path.starts_with(l.root()), "{path:?} escaped the root");
        }
    }

    #[test]
    fn venv_python_is_platform_correct() {
        let l = layout();
        let python = l.venv_python(Engine::Kokoro);
        if cfg!(windows) {
            assert!(
                python.ends_with("Scripts/python.exe") || python.ends_with("Scripts\\python.exe")
            );
        } else {
            assert_eq!(
                python,
                Path::new("/data/tts/engines/kokoro/venv/bin/python")
            );
        }
    }

    #[test]
    fn ensure_creates_the_tree_privately() {
        let temp = tempfile::tempdir().unwrap();
        let l = Layout::new(temp.path().join("tts"));
        l.ensure().unwrap();
        for dir in [
            l.root().to_path_buf(),
            l.runtime(),
            l.engines(),
            l.models(),
            l.hf_home(),
            l.samples(),
            l.server(),
            l.logs(),
            l.tmp(),
        ] {
            assert!(dir.is_dir(), "{dir:?} was not created");
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(l.root()).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o700);
        }
        l.ensure().unwrap();
    }

    #[test]
    fn dir_size_sums_files_and_tolerates_a_missing_path() {
        let temp = tempfile::tempdir().unwrap();
        assert_eq!(dir_size(&temp.path().join("nope")), 0);
        fs::create_dir_all(temp.path().join("a/b")).unwrap();
        fs::write(temp.path().join("a/one"), vec![0_u8; 10]).unwrap();
        fs::write(temp.path().join("a/b/two"), vec![0_u8; 5]).unwrap();
        assert_eq!(dir_size(temp.path()), 15);
    }

    #[test]
    fn layout_paths_serialize_as_camel_case() {
        let json = serde_json::to_string(&layout().paths()).unwrap();
        assert!(json.contains("\"root\""));
        assert!(json.contains("\"runtime\""));
        assert!(json.contains("\"engines\""));
        assert!(json.contains("\"models\""));
        assert!(json.contains("\"voices\""));
        assert!(json.contains("\"logs\""));
    }
}
