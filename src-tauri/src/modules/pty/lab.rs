use std::io::Write;
use std::path::{Path, PathBuf};

pub const MAX_CAPTURE_BYTES: usize = 400_000;

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub mode: String,
    pub count: u16,
    pub hold_ms: u64,
}

pub fn config(mode: &str, count: &str, hold_seconds: &str) -> Result<Config, String> {
    if !matches!(mode, "bench" | "idle-engine" | "idle-xterm") {
        return Err("lab mode must be bench, idle-engine or idle-xterm".into());
    }
    let count: u16 = count.parse().map_err(|_| "invalid idle count")?;
    let seconds: u64 = hold_seconds.parse().map_err(|_| "invalid idle duration")?;
    if !(1..=12).contains(&count) || !(5..=120).contains(&seconds) {
        return Err("idle count must be 1..=12 and duration 5..=120 seconds".into());
    }
    Ok(Config {
        mode: mode.into(),
        count,
        hold_ms: seconds * 1000,
    })
}

pub fn authorize(label: &str, sandbox: bool, path: Option<PathBuf>) -> Result<PathBuf, String> {
    if label != "terminal-lab" || !sandbox {
        return Err("lab autorun requires the sandbox terminal-lab window".into());
    }
    path.filter(|p| p.is_absolute() && p.file_name().is_some())
        .ok_or_else(|| "not-autorun".into())
}

pub fn capture_path(report: &Path, pane: &str) -> Result<PathBuf, String> {
    if !matches!(pane, "engine" | "xterm") {
        return Err("invalid capture pane".into());
    }
    Ok(report.with_extension(format!("{pane}.png")))
}

pub fn write_capture(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() >= MAX_CAPTURE_BYTES {
        return Err("capture must be smaller than 400000 bytes".into());
    }
    let decoder = png::Decoder::new(bytes);
    let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
    if reader.info().width > 4096 || reader.info().height > 4096 {
        return Err("capture dimensions exceed 4096".into());
    }
    if reader.output_buffer_size() > 64 * 1024 * 1024 {
        return Err("decoded capture exceeds 64 MiB".into());
    }
    let mut decoded = vec![0; reader.output_buffer_size()];
    reader.next_frame(&mut decoded).map_err(|e| e.to_string())?;
    let parent = path.parent().ok_or("capture has no parent")?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(feature = "ghostty-engine")]
pub fn write_fixture(
    report: &Path,
    kind: &str,
    megabytes: u32,
    rows: u16,
) -> Result<serde_json::Value, String> {
    use super::super::engine::{bench, validate_size};
    let parsed = bench::PayloadKind::parse(kind).ok_or("invalid payload kind")?;
    bench::validate_megabytes(megabytes)?;
    validate_size(100, rows)?;
    let path = report.with_extension("payload.bin");
    let mut file = tempfile::NamedTempFile::new_in(path.parent().ok_or("fixture has no parent")?)
        .map_err(|e| e.to_string())?;
    let mut payload = bench::Payload::new(parsed, rows);
    let total = megabytes as usize * 1024 * 1024;
    let mut fed = 0;
    let mut block = Vec::with_capacity(256 * 1024 + 8192);
    while fed < total {
        block.clear();
        payload.fill(&mut block, (256 * 1024).min(total - fed));
        file.write_all(&block).map_err(|e| e.to_string())?;
        fed += block.len();
    }
    file.persist(&path).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "path": path, "bytes": fed }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn automation_requires_lab_sandbox_and_absolute_result() {
        let path = std::env::temp_dir().join("report.json");
        assert!(authorize("main", true, Some(path.clone())).is_err());
        assert!(authorize("terminal-lab", false, Some(path.clone())).is_err());
        assert!(authorize("terminal-lab", true, None).is_err());
        assert!(authorize("terminal-lab", true, Some("relative".into())).is_err());
        assert_eq!(
            authorize("terminal-lab", true, Some(path.clone())),
            Ok(path)
        );
    }

    #[test]
    fn mode_count_and_duration_are_bounded() {
        assert_eq!(config("idle-engine", "12", "60").unwrap().hold_ms, 60_000);
        for args in [
            ("other", "12", "60"),
            ("bench", "0", "60"),
            ("bench", "13", "60"),
            ("bench", "1", "121"),
            ("bench", "1", "4"),
            ("bench", "NaN", "60"),
        ] {
            assert!(config(args.0, args.1, args.2).is_err());
        }
    }

    #[test]
    fn capture_cannot_choose_a_path_or_write_non_png_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("report.json");
        assert!(capture_path(&path, "../escape").is_err());
        assert_eq!(
            capture_path(&path, "engine").unwrap(),
            dir.path().join("report.engine.png")
        );
        assert!(write_capture(&path, b"not a png").is_err());
        assert!(write_capture(&path, &vec![0; MAX_CAPTURE_BYTES]).is_err());
        assert!(!path.exists());
    }

    #[test]
    fn valid_png_is_written_without_a_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("capture.png");
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, 2, 1);
            encoder.set_color(png::ColorType::Rgb);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .unwrap()
                .write_image_data(&[255, 0, 0, 0, 255, 0])
                .unwrap();
        }
        write_capture(&path, &bytes).unwrap();
        assert_eq!(std::fs::read(path).unwrap(), bytes);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[cfg(feature = "ghostty-engine")]
    #[test]
    fn fixture_uses_the_benchmark_payload_and_bounds() {
        use super::super::super::engine::bench::{Payload, PayloadKind};
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("report.json");
        for kind in ["ascii", "sgr", "tui"] {
            let fixture = write_fixture(&path, kind, 1, 30).unwrap();
            let actual = std::fs::read(fixture["path"].as_str().unwrap()).unwrap();
            let mut payload = Payload::new(PayloadKind::parse(kind).unwrap(), 30);
            let mut expected = Vec::new();
            while expected.len() < 1024 * 1024 {
                let mut block = Vec::new();
                payload.fill(&mut block, (256 * 1024).min(1024 * 1024 - expected.len()));
                expected.extend(block);
            }
            assert_eq!(actual, expected);
            assert_eq!(fixture["bytes"].as_u64().unwrap(), actual.len() as u64);
        }
        assert!(write_fixture(&path, "../bad", 1, 30).is_err());
        assert!(write_fixture(&path, "ascii", 0, 30).is_err());
        assert!(write_fixture(&path, "ascii", 1, 0).is_err());
    }
}
