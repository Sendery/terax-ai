//! Which Terax this process is: the installed one, or a sandbox that validates
//! a build against a copy of its data.
//!
//! A sandbox is built with its own bundle identifier (`<id>.sandbox`, see
//! `scripts/sandbox.mjs`), and that alone separates everything Tauri
//! derives from the identifier: the persisted stores, window state, the
//! notification identity and macOS permissions. What is not derived from it is
//! scoped here, so a sandbox can run beside the installed Terax without
//! touching it:
//!
//! - the cache root, which holds the Pi bridge discovery file (the newest
//!   instance to start owns it) and the waker's exported deadline;
//! - the label of the OS unit the waker installs, which is otherwise fixed, so
//!   installing it from a sandbox replaced the installed app's unit;
//! - the keychain service secrets are written to. Reads fall back to the
//!   installed app's entries, so a sandbox starts with working keys and never
//!   changes them.
//!
//! On first launch a sandbox is seeded with a copy of the installed app's
//! stores, and it keeps its own copy from then on. The copy is a dry run of the
//! installed app, so nothing in it may act outside Terax on its own: scheduled
//! tasks arrive paused and the live agent sessions are not offered for resume.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub const SANDBOX_SUFFIX: &str = ".sandbox";
const CACHE_DIR: &str = "terax-ai";
/// Stores are small JSON documents; anything larger is not ours to copy.
const MAX_SEED_FILE_BYTES: u64 = 16 * 1024 * 1024;

static SANDBOX: OnceLock<bool> = OnceLock::new();

/// Fixes the profile for the life of the process. The first call wins, so the
/// profile cannot change under code that already scoped a path with it.
pub fn init(identifier: &str) {
    let _ = SANDBOX.set(identifier.ends_with(SANDBOX_SUFFIX));
}

pub fn is_sandbox() -> bool {
    SANDBOX.get().copied().unwrap_or(false)
}

pub fn cache_dir_name(sandbox: bool) -> String {
    if sandbox {
        format!("{CACHE_DIR}{}", SANDBOX_SUFFIX.replace('.', "-"))
    } else {
        CACHE_DIR.to_string()
    }
}

/// This profile's directory under the user cache dir.
pub fn cache_root() -> Option<PathBuf> {
    Some(dirs::cache_dir()?.join(cache_dir_name(is_sandbox())))
}

/// Scopes a reverse-DNS label (`app.crynta.terax.waker`) or a plain name
/// (`terax-waker`) to this profile, so a sandbox registers units of its own.
pub fn scoped_name(base: &str, sandbox: bool) -> String {
    if !sandbox {
        return base.to_string();
    }
    match base.strip_prefix("app.crynta.terax") {
        Some(rest) => format!("app.crynta.terax{SANDBOX_SUFFIX}{rest}"),
        None => match base.strip_prefix("terax-") {
            Some(rest) => format!("terax-sandbox-{rest}"),
            None => format!("{base}{SANDBOX_SUFFIX}"),
        },
    }
}

pub fn scoped(base: &str) -> String {
    scoped_name(base, is_sandbox())
}

/// The keychain service a sandbox writes to.
pub fn scoped_service(service: &str, sandbox: bool) -> String {
    if sandbox {
        format!("{service}{SANDBOX_SUFFIX}")
    } else {
        service.to_string()
    }
}

/// A deleted secret in a sandbox is stored as this, so a read does not fall
/// back to the installed app's value and resurrect it.
pub const DELETED_SECRET: &str = "";

/// Resolves a sandbox read: its own entry wins, a tombstone hides the
/// installed app's value, and a missing entry falls back to it.
pub fn overlay_secret(own: Option<String>, installed: impl FnOnce() -> Option<String>) -> Option<String> {
    match own {
        Some(value) if value == DELETED_SECRET => None,
        Some(value) => Some(value),
        None => installed(),
    }
}

/// The installed app's data directory, next to the sandbox's own.
pub fn installed_data_dir(sandbox_data_dir: &Path, sandbox_identifier: &str) -> Option<PathBuf> {
    let installed = sandbox_identifier.strip_suffix(SANDBOX_SUFFIX)?;
    Some(sandbox_data_dir.parent()?.join(installed))
}

/// What seeding does with one store. Isolating files is not enough for a dry
/// run: a copied store can still make the sandbox act on the outside world.
#[derive(Debug, PartialEq, Eq)]
pub enum SeedPolicy {
    Copy,
    /// Would offer to resume the installed app's live agent sessions, putting
    /// two processes on one transcript.
    Skip,
    /// Scheduled tasks would run a second time from the sandbox, repeating
    /// whatever they do outside Terax, so they arrive paused.
    PauseTasks,
}

pub fn seed_policy(name: &str) -> SeedPolicy {
    match name {
        "terax-agent-restore.json" => SeedPolicy::Skip,
        "terax-scheduled-tasks.json" => SeedPolicy::PauseTasks,
        _ => SeedPolicy::Copy,
    }
}

/// The tasks store with every task disabled, or None when it cannot be read.
/// An unreadable store is not copied: copying it as-is could leave tasks live.
pub fn pause_scheduled_tasks(raw: &str) -> Option<String> {
    let mut store: serde_json::Value = serde_json::from_str(raw).ok()?;
    for task in store.get_mut("tasks")?.as_array_mut()? {
        if let Some(task) = task.as_object_mut() {
            task.insert("enabled".into(), serde_json::Value::Bool(false));
        }
    }
    serde_json::to_string(&store).ok()
}

/// Copies the installed app's stores into the sandbox, following `seed_policy`.
///
/// Only top-level `terax-*.json` files are considered, each written beside its
/// target and renamed so a store is never read half-written. With `overwrite`
/// false a sandbox that already has a store keeps it, which is what first-run
/// seeding needs; a reset passes true.
pub fn seed_stores(from: &Path, to: &Path, overwrite: bool) -> std::io::Result<Vec<String>> {
    let mut copied = Vec::new();
    let Ok(entries) = std::fs::read_dir(from) else {
        return Ok(copied);
    };
    std::fs::create_dir_all(to)?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_store = name.starts_with("terax-") && name.ends_with(".json");
        let Ok(meta) = entry.metadata() else { continue };
        if !is_store || !meta.is_file() || meta.len() > MAX_SEED_FILE_BYTES {
            continue;
        }
        let target = to.join(&name);
        if !overwrite && target.exists() {
            continue;
        }
        let tmp = to.join(format!(".{name}.seed-tmp"));
        match seed_policy(&name) {
            SeedPolicy::Skip => continue,
            SeedPolicy::Copy => {
                std::fs::copy(entry.path(), &tmp)?;
            }
            SeedPolicy::PauseTasks => {
                let raw = std::fs::read_to_string(entry.path())?;
                let Some(paused) = pause_scheduled_tasks(&raw) else {
                    continue;
                };
                std::fs::write(&tmp, paused)?;
            }
        }
        std::fs::rename(&tmp, &target)?;
        copied.push(name);
    }
    copied.sort();
    Ok(copied)
}

#[tauri::command]
pub fn app_profile() -> &'static str {
    if is_sandbox() {
        "sandbox"
    } else {
        "production"
    }
}

/// Left in the sandbox's data dir to ask the next launch for a fresh copy.
const RESET_MARKER: &str = ".reset-from-installed";

/// Asks for the sandbox's stores to be replaced by a fresh copy of the
/// installed app's on the next launch, and the webview then relaunches.
///
/// The copy cannot happen now: every store is loaded and the store plugin saves
/// them all on exit, which would write the old state straight back over the
/// fresh copy. The next launch copies before any store is read.
#[tauri::command]
pub fn sandbox_reset_from_installed(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if !is_sandbox() {
        return Err("only a sandbox can be reset from the installed app".into());
    }
    let own = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&own).map_err(|e| e.to_string())?;
    std::fs::write(own.join(RESET_MARKER), b"").map_err(|e| e.to_string())
}

/// Seeds the sandbox at launch: once on first run, and again after a reset was
/// asked for. Runs in `setup`, before the webview can read a store.
pub fn seed_on_launch(app: &tauri::AppHandle) {
    use tauri::Manager;
    if !is_sandbox() {
        return;
    }
    let Ok(own) = app.path().app_data_dir() else {
        return;
    };
    let Some(installed) = installed_data_dir(&own, &app.config().identifier) else {
        return;
    };
    let marker = own.join(RESET_MARKER);
    let reset = marker.exists();
    match seed_stores(&installed, &own, reset) {
        Ok(copied) => {
            if !copied.is_empty() {
                log::info!("sandbox seeded from the installed app: {}", copied.join(", "));
            }
            if reset {
                let _ = std::fs::remove_file(&marker);
            }
        }
        // The marker stays, so the next launch tries again.
        Err(err) => log::warn!("sandbox seeding failed: {err}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scopes_names_only_for_a_sandbox() {
        assert_eq!(scoped_name("app.crynta.terax.waker", false), "app.crynta.terax.waker");
        assert_eq!(scoped_name("app.crynta.terax.waker", true), "app.crynta.terax.sandbox.waker");
        assert_eq!(scoped_name("terax-waker.timer", true), "terax-sandbox-waker.timer");
        assert_eq!(scoped_name("TeraxWaker", true), "TeraxWaker.sandbox");
        assert_eq!(cache_dir_name(false), "terax-ai");
        assert_eq!(cache_dir_name(true), "terax-ai-sandbox");
        assert_eq!(scoped_service("terax-ai", true), "terax-ai.sandbox");
        assert_eq!(scoped_service("terax-ai", false), "terax-ai");
    }

    #[test]
    fn a_sandbox_read_falls_back_but_never_resurrects_a_deletion() {
        let installed = || Some("sk-installed".to_string());
        assert_eq!(overlay_secret(None, installed).as_deref(), Some("sk-installed"));
        assert_eq!(overlay_secret(Some("sk-own".into()), installed).as_deref(), Some("sk-own"));
        assert_eq!(overlay_secret(Some(DELETED_SECRET.into()), installed), None);
    }

    #[test]
    fn finds_the_installed_data_next_to_the_sandbox() {
        let own = Path::new("/Users/x/Library/Application Support/app.crynta.terax.sandbox");
        assert_eq!(
            installed_data_dir(own, "app.crynta.terax.sandbox").unwrap(),
            Path::new("/Users/x/Library/Application Support/app.crynta.terax")
        );
        assert!(installed_data_dir(own, "app.crynta.terax").is_none());
    }

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("terax-profile-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn seeds_only_stores_and_keeps_what_the_sandbox_already_has() {
        let from = temp("from");
        let to = temp("to");
        std::fs::write(from.join("terax-settings.json"), "{\"theme\":\"installed\"}").unwrap();
        std::fs::write(from.join("terax-spaces.json"), "{}").unwrap();
        std::fs::write(from.join("unrelated.json"), "{}").unwrap();
        std::fs::create_dir_all(from.join("terax-dir.json")).unwrap();
        std::fs::write(to.join("terax-settings.json"), "{\"theme\":\"sandbox\"}").unwrap();

        let copied = seed_stores(&from, &to, false).unwrap();
        assert_eq!(copied, vec!["terax-spaces.json"]);
        assert_eq!(
            std::fs::read_to_string(to.join("terax-settings.json")).unwrap(),
            "{\"theme\":\"sandbox\"}"
        );
        assert!(!to.join("unrelated.json").exists());

        let reset = seed_stores(&from, &to, true).unwrap();
        assert_eq!(reset, vec!["terax-settings.json", "terax-spaces.json"]);
        assert_eq!(
            std::fs::read_to_string(to.join("terax-settings.json")).unwrap(),
            "{\"theme\":\"installed\"}"
        );
        // Nothing is left half-written beside the stores.
        assert!(std::fs::read_dir(&to).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().ends_with("seed-tmp")));
        let _ = std::fs::remove_dir_all(&from);
        let _ = std::fs::remove_dir_all(&to);
    }

    #[test]
    fn a_dry_run_never_acts_on_the_outside_world() {
        let from = temp("dry-from");
        let to = temp("dry-to");
        std::fs::write(
            from.join("terax-scheduled-tasks.json"),
            r#"{"runs":{},"tasks":[{"id":"a","enabled":true},{"id":"b","enabled":false}]}"#,
        )
        .unwrap();
        std::fs::write(from.join("terax-agent-restore.json"), r#"{"version":1,"sessions":[]}"#).unwrap();

        let copied = seed_stores(&from, &to, false).unwrap();
        assert_eq!(copied, vec!["terax-scheduled-tasks.json"]);
        assert!(!to.join("terax-agent-restore.json").exists());
        let tasks: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(to.join("terax-scheduled-tasks.json")).unwrap()).unwrap();
        assert!(tasks["tasks"].as_array().unwrap().iter().all(|t| t["enabled"] == false));
        // The source is only read.
        assert!(std::fs::read_to_string(from.join("terax-scheduled-tasks.json")).unwrap().contains("\"enabled\":true"));
        let _ = std::fs::remove_dir_all(&from);
        let _ = std::fs::remove_dir_all(&to);
    }

    #[test]
    fn an_unreadable_tasks_store_is_not_copied_live() {
        assert_eq!(pause_scheduled_tasks("{not json"), None);
        assert_eq!(pause_scheduled_tasks(r#"{"tasks":"nope"}"#), None);
        assert_eq!(pause_scheduled_tasks(r#"{"runs":{}}"#), None);
    }

    #[test]
    fn seeding_from_a_missing_installed_app_is_a_no_op() {
        let to = temp("empty");
        assert!(seed_stores(Path::new("/definitely/not/here"), &to, false).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&to);
    }
}
