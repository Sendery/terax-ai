use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::{AppHandle, Manager};

pub const MAX_CAPTURE_BYTES: usize = 64 * 1024 * 1024;
pub const RETAIN_MAX_AGE: Duration = Duration::from_secs(60 * 60);
pub const RETAIN_MAX_TOTAL_BYTES: u64 = 512 * 1024 * 1024;

const PNG_MAGIC: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

#[derive(Serialize)]
pub struct CapturePersistResult {
    pub path: String,
    pub bytes: usize,
}

pub fn validate_png(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < PNG_MAGIC.len() {
        return Err("Capture payload is not a PNG".to_string());
    }
    if bytes[..PNG_MAGIC.len()] != PNG_MAGIC {
        return Err("Capture payload is not a PNG".to_string());
    }
    if bytes.len() > MAX_CAPTURE_BYTES {
        return Err("Capture payload exceeds the size limit".to_string());
    }
    Ok(())
}

pub fn prune_captures(dir: &Path, now: SystemTime) -> std::io::Result<()> {
    let mut entries: Vec<(PathBuf, SystemTime, u64)> = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        if !meta.is_file() {
            continue;
        }
        let modified = meta.modified().unwrap_or(now);
        entries.push((entry.path(), modified, meta.len()));
    }
    entries.sort_by_key(|(_, modified, _)| std::cmp::Reverse(*modified));
    let mut total: u64 = 0;
    for (path, modified, len) in entries {
        let expired = now
            .duration_since(modified)
            .map(|age| age > RETAIN_MAX_AGE)
            .unwrap_or(false);
        total = total.saturating_add(len);
        if expired || total > RETAIN_MAX_TOTAL_BYTES {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}

fn captures_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("visual-captures");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
    }
    Ok(dir)
}

fn unique_file_name() -> String {
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    format!(
        "capture-{}-{:09}-{}.png",
        now.as_secs(),
        now.subsec_nanos(),
        std::process::id()
    )
}

#[tauri::command]
pub fn capture_persist(
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<CapturePersistResult, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Capture payload must be raw bytes".to_string());
    };
    validate_png(bytes)?;
    let dir = captures_dir(&app)?;
    let _ = prune_captures(&dir, SystemTime::now());
    let path = dir.join(unique_file_name());
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(CapturePersistResult {
        path: path.to_string_lossy().into_owned(),
        bytes: bytes.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_png_accepts_png_magic() {
        let mut bytes = PNG_MAGIC.to_vec();
        bytes.extend_from_slice(&[0_u8; 16]);
        assert!(validate_png(&bytes).is_ok());
    }

    #[test]
    fn validate_png_rejects_non_png_and_short_payloads() {
        assert!(validate_png(b"GIF89a").is_err());
        assert!(validate_png(&[]).is_err());
        assert!(validate_png(b"\x89PN").is_err());
    }

    #[test]
    fn prune_removes_expired_files_and_keeps_recent_ones() {
        let dir = std::env::temp_dir().join(format!(
            "terax-capture-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let old = dir.join("old.png");
        let recent = dir.join("recent.png");
        fs::write(&old, b"old").unwrap();
        fs::write(&recent, b"recent").unwrap();
        let future = SystemTime::now() + RETAIN_MAX_AGE + Duration::from_secs(10);
        let modified = fs::metadata(&recent).unwrap().modified().unwrap();
        // Both files carry a now() mtime; prune against a far-future clock
        // expires both, then a current clock keeps both.
        prune_captures(&dir, future).unwrap();
        assert!(!old.exists());
        assert!(!recent.exists());
        fs::write(&recent, b"recent").unwrap();
        prune_captures(&dir, modified + Duration::from_secs(1)).unwrap();
        assert!(recent.exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
