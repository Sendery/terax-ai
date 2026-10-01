//! The environment every spawned child receives.
//!
//! The parent environment is never inherited. `PYTHONPATH`, `VIRTUAL_ENV`,
//! `CONDA_*` and `PIP_*` in the user's shell would otherwise redirect an
//! install into a system prefix or make a venv import foreign packages, which
//! is exactly the promise this feature makes: nothing outside the private root
//! is read or written.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::layout::Layout;

pub const TOKEN_VAR: &str = "TERAX_TTS_TOKEN";

#[cfg(unix)]
const SYSTEM_PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";

#[cfg(unix)]
pub fn default_path(uv_dir: &Path) -> String {
    format!("{}:{SYSTEM_PATH}", uv_dir.to_string_lossy())
}

/// The system PATH is rebuilt from `SystemRoot` rather than inherited, so a
/// shim earlier on the user's PATH cannot intercept `tar` or `python`.
#[cfg(windows)]
pub fn default_path(uv_dir: &Path) -> String {
    let system_root = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("C:\\Windows"));
    let parts = [
        uv_dir.to_path_buf(),
        system_root.join("system32"),
        system_root.clone(),
        system_root.join("System32").join("Wbem"),
        system_root
            .join("System32")
            .join("WindowsPowerShell")
            .join("v1.0"),
    ];
    parts
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join(";")
}

/// The host directories a child legitimately needs. Resolved through `dirs` so
/// the raw `HOME` / `%USERPROFILE%` variable is never read back out of the
/// parent environment. The temporary directory is deliberately absent: children
/// get one inside the private root instead.
#[derive(Debug, Clone)]
pub struct HostDirs {
    pub home: PathBuf,
}

impl HostDirs {
    pub fn resolve() -> Self {
        Self {
            home: dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")),
        }
    }
}

/// The complete, sanitised environment for a child process. `token` is only
/// passed for the sidecar; installation steps get none.
pub fn child_env(
    layout: &Layout,
    host: &HostDirs,
    token: Option<&str>,
) -> BTreeMap<String, String> {
    let mut env = BTreeMap::new();
    let mut set = |key: &str, value: String| {
        env.insert(key.to_string(), value);
    };
    let s = |path: PathBuf| path.to_string_lossy().into_owned();

    set("PATH", default_path(&layout.uv_dir()));

    // All three spellings on every platform: the temporary directory is part of
    // the private root, so a child that reads the other name must not fall back
    // to the system one. The Kokoro adapter stages espeak-ng data here.
    let tmp = s(layout.tmp());
    set("TMPDIR", tmp.clone());
    set("TEMP", tmp.clone());
    set("TMP", tmp);

    if cfg!(windows) {
        set("USERPROFILE", s(host.home.clone()));
        set("HF_HUB_DISABLE_SYMLINKS", "1".to_string());
        // Registering a managed Python writes outside the private root.
        set("UV_PYTHON_INSTALL_REGISTRY", "0".to_string());
        // Rebuilt rather than inherited, but Python and the CRT cannot locate
        // their DLLs without these.
        for key in ["SystemRoot", "SystemDrive", "PATHEXT", "ComSpec"] {
            if let Some(value) = std::env::var_os(key) {
                set(key, value.to_string_lossy().into_owned());
            }
        }
    } else {
        set("HOME", s(host.home.clone()));
    }

    set("UV_INSTALL_DIR", s(layout.uv_dir()));
    set("UV_UNMANAGED_INSTALL", s(layout.uv_dir()));
    set("UV_PYTHON_INSTALL_DIR", s(layout.python_install_dir()));
    set("UV_CACHE_DIR", s(layout.uv_cache_dir()));
    set("UV_NO_MODIFY_PATH", "1".to_string());
    set("UV_PYTHON_DOWNLOADS", "automatic".to_string());
    // A managed Python otherwise gets an executable shim in `~/.local/bin`,
    // and a user-level `uv.toml` would otherwise steer the private install.
    set("UV_PYTHON_INSTALL_BIN", "0".to_string());
    set("UV_NO_CONFIG", "1".to_string());

    set("HF_HOME", s(layout.hf_home()));
    set("HF_HUB_CACHE", s(layout.hf_hub()));
    set("HF_HUB_DISABLE_TELEMETRY", "1".to_string());
    set("PKUSEG_HOME", s(layout.pkuseg_home()));

    set("PYTHONNOUSERSITE", "1".to_string());
    set("PYTHONDONTWRITEBYTECODE", "1".to_string());
    set("PYTHONUNBUFFERED", "1".to_string());
    set("TOKENIZERS_PARALLELISM", "false".to_string());
    set("PYTORCH_ENABLE_MPS_FALLBACK", "1".to_string());

    if let Some(token) = token {
        set(TOKEN_VAR, token.to_string());
    }
    env
}

pub fn apply_env(cmd: &mut Command, env: &BTreeMap<String, String>) {
    cmd.env_clear();
    for (key, value) in env {
        cmd.env(key, value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (Layout, HostDirs) {
        (
            Layout::new(PathBuf::from("/data/tts")),
            HostDirs {
                home: PathBuf::from("/home/tester"),
            },
        )
    }

    #[test]
    fn inherited_python_and_packaging_variables_are_absent() {
        let (layout, host) = fixture();
        let env = child_env(&layout, &host, None);
        for leaked in [
            "PYTHONPATH",
            "PYTHONHOME",
            "VIRTUAL_ENV",
            "CONDA_PREFIX",
            "CONDA_DEFAULT_ENV",
            "PIP_INDEX_URL",
            "PIP_TARGET",
            "LD_PRELOAD",
            "DYLD_INSERT_LIBRARIES",
        ] {
            assert!(!env.contains_key(leaked), "{leaked} must not be set");
        }
    }

    #[test]
    fn caches_live_under_the_private_root() {
        let (layout, host) = fixture();
        let env = child_env(&layout, &host, None);
        for key in [
            "UV_INSTALL_DIR",
            "UV_UNMANAGED_INSTALL",
            "UV_PYTHON_INSTALL_DIR",
            "UV_CACHE_DIR",
            "HF_HOME",
            "HF_HUB_CACHE",
            "PKUSEG_HOME",
            "TMPDIR",
            "TEMP",
            "TMP",
        ] {
            let value = env.get(key).unwrap_or_else(|| panic!("{key} must be set"));
            assert!(
                value.starts_with("/data/tts"),
                "{key} = {value} escaped the root"
            );
        }
        assert_eq!(env.get("HF_HOME").unwrap(), "/data/tts/models/hf");
        assert_eq!(env.get("HF_HUB_CACHE").unwrap(), "/data/tts/models/hf/hub");
    }

    #[test]
    fn the_temporary_directory_is_private_under_every_name_a_child_may_read() {
        let (layout, host) = fixture();
        let env = child_env(&layout, &host, None);
        for key in ["TMPDIR", "TEMP", "TMP"] {
            assert_eq!(env.get(key).map(String::as_str), Some("/data/tts/tmp"));
        }
        // The system temporary directory must not leak in under any name.
        let system_tmp = std::env::temp_dir().to_string_lossy().into_owned();
        assert!(!env.values().any(|value| *value == system_tmp));
    }

    #[test]
    fn nothing_outside_the_root_is_written_by_a_python_install() {
        let (layout, host) = fixture();
        let env = child_env(&layout, &host, None);
        assert_eq!(env.get("UV_PYTHON_INSTALL_BIN").unwrap(), "0");
        assert_eq!(env.get("UV_NO_MODIFY_PATH").unwrap(), "1");
        assert_eq!(env.get("UV_NO_CONFIG").unwrap(), "1");
        if cfg!(windows) {
            assert_eq!(env.get("UV_PYTHON_INSTALL_REGISTRY").unwrap(), "0");
        }
    }

    #[test]
    fn fixed_flags_are_always_set() {
        let (layout, host) = fixture();
        let env = child_env(&layout, &host, None);
        assert_eq!(env.get("UV_NO_MODIFY_PATH").unwrap(), "1");
        assert_eq!(env.get("UV_PYTHON_DOWNLOADS").unwrap(), "automatic");
        assert_eq!(env.get("HF_HUB_DISABLE_TELEMETRY").unwrap(), "1");
        assert_eq!(env.get("PYTHONNOUSERSITE").unwrap(), "1");
        assert_eq!(env.get("PYTHONDONTWRITEBYTECODE").unwrap(), "1");
        assert_eq!(env.get("PYTHONUNBUFFERED").unwrap(), "1");
        assert_eq!(env.get("TOKENIZERS_PARALLELISM").unwrap(), "false");
        assert_eq!(env.get("PYTORCH_ENABLE_MPS_FALLBACK").unwrap(), "1");
    }

    #[test]
    fn the_token_is_only_present_for_the_sidecar() {
        let (layout, host) = fixture();
        assert!(!child_env(&layout, &host, None).contains_key(TOKEN_VAR));
        let env = child_env(&layout, &host, Some("deadbeef"));
        assert_eq!(env.get(TOKEN_VAR).unwrap(), "deadbeef");
    }

    #[test]
    fn path_starts_with_the_private_uv_directory() {
        let (layout, host) = fixture();
        let env = child_env(&layout, &host, None);
        let path = env.get("PATH").unwrap();
        assert!(path.starts_with("/data/tts/runtime/uv"), "{path}");
    }

    #[cfg(unix)]
    #[test]
    fn unix_path_is_the_system_default_plus_uv_and_home_is_the_host_home() {
        let (layout, host) = fixture();
        let env = child_env(&layout, &host, None);
        assert_eq!(
            env.get("PATH").unwrap(),
            "/data/tts/runtime/uv:/usr/bin:/bin:/usr/sbin:/sbin"
        );
        assert_eq!(env.get("HOME").unwrap(), "/home/tester");
        assert!(!env.contains_key("USERPROFILE"));
        assert!(!env.contains_key("HF_HUB_DISABLE_SYMLINKS"));
    }

    #[cfg(windows)]
    #[test]
    fn windows_uses_userprofile_temp_and_disables_symlinks() {
        let (layout, host) = fixture();
        let env = child_env(&layout, &host, None);
        assert_eq!(env.get("USERPROFILE").unwrap(), "/home/tester");
        assert_eq!(env.get("HF_HUB_DISABLE_SYMLINKS").unwrap(), "1");
        assert!(!env.contains_key("HOME"));
    }
}
