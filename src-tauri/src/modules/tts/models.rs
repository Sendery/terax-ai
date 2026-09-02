//! Hugging Face cache inspection and purging.
//!
//! A directory name arrives from the webview, so it is matched against the
//! exact shape `huggingface_hub` produces and then re-resolved inside the hub
//! directory before anything is deleted.

use std::fs;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::UNIX_EPOCH;

use serde::Serialize;

use super::engines::Model;
use super::layout::dir_size;

const DIR_PREFIX: &str = "models--";
const MAX_DIR_NAME: usize = 200;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDirEntry {
    pub dir_name: String,
    pub repo: String,
    pub size_bytes: u64,
    pub modified_ms: u64,
    pub model: Option<Model>,
}

/// `^models--[A-Za-z0-9._-]+--[A-Za-z0-9._-]+$`, spelled out so no regex
/// dependency is needed and so the reason for each rejection is explicit. The
/// character class admits no separator, so the name can never traverse.
pub fn validate_model_dir_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > MAX_DIR_NAME {
        return Err("invalid model directory name".into());
    }
    let Some(rest) = name.strip_prefix(DIR_PREFIX) else {
        return Err("invalid model directory name".into());
    };
    let Some((org, repo)) = rest.split_once("--") else {
        return Err("invalid model directory name".into());
    };
    let ok = |part: &str| {
        !part.is_empty()
            && part != "."
            && part != ".."
            && !part.contains("--")
            && part
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    };
    if !ok(org) || !ok(repo) {
        return Err("invalid model directory name".into());
    }
    Ok(())
}

pub fn repo_from_dir_name(name: &str) -> Option<String> {
    let rest = name.strip_prefix(DIR_PREFIX)?;
    let (org, repo) = rest.split_once("--")?;
    Some(format!("{org}/{repo}"))
}

pub fn model_for_dir_name(name: &str) -> Option<Model> {
    Model::ALL.into_iter().find(|m| m.hf_dir_name() == name)
}

/// Resolves a webview-supplied directory name to a real path inside `hub`.
/// Both sides are canonicalised because the hub path itself may contain a
/// symlinked prefix (`/var` on macOS).
pub fn resolve_model_dir(hub: &Path, dir_name: &str) -> Result<PathBuf, String> {
    validate_model_dir_name(dir_name)?;
    let candidate = hub.join(dir_name);
    let resolved =
        fs::canonicalize(&candidate).map_err(|_| "model is not downloaded".to_string())?;
    let hub_resolved = fs::canonicalize(hub).map_err(|e| e.to_string())?;
    if !resolved.starts_with(&hub_resolved) {
        return Err("model directory resolves outside the cache".into());
    }
    if !resolved.is_dir() {
        return Err("model directory is not a directory".into());
    }
    Ok(resolved)
}

pub fn scan(hub: &Path) -> Vec<ModelDirEntry> {
    let Ok(entries) = fs::read_dir(hub) else {
        return Vec::new();
    };
    let mut out: Vec<ModelDirEntry> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if validate_model_dir_name(&name).is_err() {
                return None;
            }
            let meta = entry.metadata().ok()?;
            if !meta.is_dir() {
                return None;
            }
            let modified_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            Some(ModelDirEntry {
                repo: repo_from_dir_name(&name).unwrap_or_else(|| name.clone()),
                size_bytes: dir_size(&entry.path()),
                modified_ms,
                model: model_for_dir_name(&name),
                dir_name: name,
            })
        })
        .collect();
    out.sort_by(|a, b| a.dir_name.cmp(&b.dir_name));
    out
}

pub fn parse_model(value: &str) -> Result<Model, String> {
    Model::from_str(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_shapes_huggingface_hub_produces() {
        for name in [
            "models--hexgrad--Kokoro-82M",
            "models--ResembleAI--chatterbox",
            "models--ResembleAI--chatterbox-turbo",
            "models--ResembleAI--chatterbox-nano",
            "models--org--repo.v2",
            "models--org_name--repo_name",
        ] {
            assert!(
                validate_model_dir_name(name).is_ok(),
                "{name} must be accepted"
            );
        }
        for model in Model::ALL {
            assert!(validate_model_dir_name(model.hf_dir_name()).is_ok());
            assert_eq!(model_for_dir_name(model.hf_dir_name()), Some(model));
        }
    }

    #[test]
    fn rejects_traversal_separators_and_absolute_paths() {
        for name in [
            "",
            "..",
            ".",
            "models--..--..",
            "models--..--x",
            "models--x--..",
            "models--../..--x",
            "models--org--repo/../../etc",
            "models--org--repo/",
            "models--org--repo\\x",
            "/models--org--repo",
            "/etc/passwd",
            "C:\\Windows",
            "models--org--repo\0",
            "models--org--",
            "models----repo",
            "models--org",
            "modelsx--org--repo",
            "blobs",
            "models--org--repo--extra",
            "models--org--re po",
            "models--org--repo;rm -rf /",
            "models--org--$(id)",
        ] {
            assert!(
                validate_model_dir_name(name).is_err(),
                "{name:?} must be rejected"
            );
        }
        let long = format!("models--org--{}", "a".repeat(MAX_DIR_NAME));
        assert!(validate_model_dir_name(&long).is_err());
    }

    #[test]
    fn repo_is_derived_from_the_directory_name() {
        assert_eq!(
            repo_from_dir_name("models--hexgrad--Kokoro-82M").as_deref(),
            Some("hexgrad/Kokoro-82M")
        );
        assert_eq!(repo_from_dir_name("blobs"), None);
        assert_eq!(model_for_dir_name("models--org--repo"), None);
    }

    #[test]
    fn resolve_refuses_a_name_that_is_not_present_and_accepts_a_real_one() {
        let temp = tempfile::tempdir().unwrap();
        let hub = temp.path().join("hub");
        fs::create_dir_all(hub.join("models--org--repo")).unwrap();
        let resolved = resolve_model_dir(&hub, "models--org--repo").unwrap();
        assert!(resolved.ends_with("models--org--repo"));
        assert!(resolve_model_dir(&hub, "models--org--absent").is_err());
        assert!(resolve_model_dir(&hub, "../../etc").is_err());
    }

    #[test]
    fn resolve_refuses_a_symlink_pointing_out_of_the_cache() {
        let temp = tempfile::tempdir().unwrap();
        let hub = temp.path().join("hub");
        let outside = temp.path().join("outside");
        fs::create_dir_all(&hub).unwrap();
        fs::create_dir_all(&outside).unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, hub.join("models--org--evil")).unwrap();
            assert!(resolve_model_dir(&hub, "models--org--evil").is_err());
        }
        #[cfg(not(unix))]
        {
            let _ = outside;
        }
    }

    #[test]
    fn scan_lists_unknown_repos_so_they_can_be_purged() {
        let temp = tempfile::tempdir().unwrap();
        let hub = temp.path();
        fs::create_dir_all(hub.join("models--hexgrad--Kokoro-82M")).unwrap();
        fs::write(hub.join("models--hexgrad--Kokoro-82M/w.bin"), vec![0_u8; 7]).unwrap();
        fs::create_dir_all(hub.join("models--someone--else")).unwrap();
        fs::create_dir_all(hub.join("blobs")).unwrap();
        fs::write(hub.join("version.txt"), "1").unwrap();
        let found = scan(hub);
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].dir_name, "models--hexgrad--Kokoro-82M");
        assert_eq!(found[0].model, Some(Model::Kokoro82m));
        assert_eq!(found[0].size_bytes, 7);
        assert_eq!(found[1].dir_name, "models--someone--else");
        assert_eq!(found[1].model, None);
        assert_eq!(found[1].repo, "someone/else");
    }

    #[test]
    fn scan_of_a_missing_hub_is_empty() {
        let temp = tempfile::tempdir().unwrap();
        assert!(scan(&temp.path().join("absent")).is_empty());
    }
}
