//! macOS privacy grants that are worth settling once.
//!
//! macOS asks per protected folder (Documents, Desktop, Downloads, removable
//! and network volumes, other apps' data), and attributes every request made
//! by a shell or an agent to the app that started it. Full Disk Access covers
//! all of them with one grant, which every process inside Terax inherits. It
//! cannot be requested from code: the user turns it on in System Settings, so
//! all this does is detect it and open the right pane.

use serde::Serialize;

/// System Settings > Privacy & Security > Full Disk Access.
pub const FULL_DISK_ACCESS_SETTINGS_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FullDiskAccess {
    Granted,
    Denied,
    /// No probe could tell either way (none of the probed paths exist).
    Unknown,
    /// Not macOS.
    NotApplicable,
}

/// Reads the outcome of opening paths only Full Disk Access unlocks. One that
/// opens proves the grant; a refusal on one that exists proves its absence.
pub fn classify(probes: impl IntoIterator<Item = std::io::Result<()>>) -> FullDiskAccess {
    let mut denied = false;
    for probe in probes {
        match probe {
            Ok(()) => return FullDiskAccess::Granted,
            Err(err) if err.kind() == std::io::ErrorKind::PermissionDenied => denied = true,
            Err(_) => {}
        }
    }
    if denied {
        FullDiskAccess::Denied
    } else {
        FullDiskAccess::Unknown
    }
}

/// Opening these never raises a prompt: without the grant the read is refused
/// outright. The privacy database itself is the usual probe, and is left out
/// because endpoint security tools treat reading it as an attack.
#[cfg(target_os = "macos")]
fn probe() -> FullDiskAccess {
    let time_machine = std::fs::File::open("/Library/Preferences/com.apple.TimeMachine.plist").map(|_| ());
    if time_machine.is_ok() {
        return FullDiskAccess::Granted;
    }
    // Not another app's container: since macOS 14 that raises a prompt of its own.
    let safari = match dirs::home_dir() {
        Some(home) => std::fs::read_dir(home.join("Library/Safari")).map(|_| ()),
        None => Err(std::io::ErrorKind::NotFound.into()),
    };
    classify([time_machine, safari])
}

#[tauri::command]
pub fn privacy_full_disk_access() -> FullDiskAccess {
    #[cfg(target_os = "macos")]
    {
        probe()
    }
    #[cfg(not(target_os = "macos"))]
    {
        FullDiskAccess::NotApplicable
    }
}

#[tauri::command]
pub fn privacy_open_full_disk_access() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        tauri_plugin_opener::open_url(FULL_DISK_ACCESS_SETTINGS_URL, None::<&str>).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Full Disk Access is a macOS setting".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Error, ErrorKind};

    #[test]
    fn one_readable_path_proves_the_grant() {
        assert_eq!(classify([Ok(())]), FullDiskAccess::Granted);
        assert_eq!(
            classify([Err(Error::from(ErrorKind::PermissionDenied)), Ok(())]),
            FullDiskAccess::Granted
        );
    }

    #[test]
    fn a_refusal_means_denied_and_a_missing_path_proves_nothing() {
        assert_eq!(
            classify([Err(Error::from(ErrorKind::NotFound)), Err(Error::from(ErrorKind::PermissionDenied))]),
            FullDiskAccess::Denied
        );
        assert_eq!(classify([Err(Error::from(ErrorKind::NotFound))]), FullDiskAccess::Unknown);
        assert_eq!(classify(Vec::new()), FullDiskAccess::Unknown);
    }

    #[cfg(unix)]
    #[test]
    fn the_refusal_macos_reports_is_a_permission_error() {
        // TCC refuses with EPERM (1); a plain mode mismatch is EACCES (13).
        for errno in [1, 13] {
            assert_eq!(classify([Err(Error::from_raw_os_error(errno))]), FullDiskAccess::Denied);
        }
    }

    #[test]
    fn status_is_serialized_for_the_frontend_in_kebab_case() {
        assert_eq!(serde_json::to_string(&FullDiskAccess::NotApplicable).unwrap(), "\"not-applicable\"");
        assert_eq!(serde_json::to_string(&FullDiskAccess::Granted).unwrap(), "\"granted\"");
        assert!(FULL_DISK_ACCESS_SETTINGS_URL.ends_with("Privacy_AllFiles"));
    }
}
