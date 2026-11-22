use std::io::Write;
use std::path::{Path, PathBuf};

pub const MAX_CAPTURE_BYTES: usize = 400_000;

pub struct RunState {
    started: bool,
    failed: bool,
    sequence: Option<u64>,
}

impl RunState {
    pub const fn new() -> Self {
        Self {
            started: false,
            failed: false,
            sequence: None,
        }
    }

    pub fn claim(&mut self, report: &Path) -> Result<(), String> {
        if !self.started {
            self.started = true;
            return Ok(());
        }
        self.failed = true;
        let error = "webview-restarted: autorun bootstrapped more than once in this process";
        let failure = serde_json::json!({
            "status": "failed", "reason": "webview-restarted", "error": error,
            "pid": std::process::id(),
        })
        .to_string();
        super::lab::write_report(&report.with_extension("failure.json"), &failure)?;
        super::lab::write_report(&report.with_extension("status.json"), &failure)?;
        Err(error.into())
    }

    fn ensure_active(&self) -> Result<(), String> {
        if !self.started || self.failed {
            return Err("autorun is not active or already failed".into());
        }
        Ok(())
    }

    pub fn write_report(&self, report: &Path, json: &str) -> Result<(), String> {
        self.ensure_active()?;
        super::lab::write_report(report, json)
    }

    pub fn write_status(&mut self, report: &Path, json: &str) -> Result<(), String> {
        self.ensure_active()?;
        if json.len() > super::lab::MAX_REPORT_BYTES {
            return Err("status and checkpoint exceed the report byte limit".into());
        }
        let mut status: serde_json::Value =
            serde_json::from_str(json).map_err(|e| e.to_string())?;
        let object = status.as_object_mut().ok_or("status must be an object")?;
        let sequence = object
            .get("sequence")
            .map(|value| value.as_u64().ok_or("invalid status sequence"))
            .transpose()?;
        if sequence
            .zip(self.sequence)
            .is_some_and(|(next, previous)| next <= previous)
        {
            return Ok(());
        }
        if let Some(checkpoint) = object.remove("checkpoint") {
            if !checkpoint.is_object() {
                return Err("checkpoint must be an object".into());
            }
            super::lab::write_report(
                &report.with_extension("checkpoint.json"),
                &checkpoint.to_string(),
            )?;
        }
        super::lab::write_report(&report.with_extension("status.json"), &status.to_string())?;
        if let Some(sequence) = sequence {
            self.sequence = Some(sequence);
        }
        Ok(())
    }
}

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub mode: String,
    pub count: u16,
    pub hold_ms: u64,
}

pub fn config(mode: &str, count: &str, hold_seconds: &str) -> Result<Config, String> {
    if !matches!(mode, "bench" | "gate-engine" | "gate-engine-profile" | "gate-engine-batched" | "gate-engine-profile-batched" | "idle-engine") {
        return Err("lab mode must be bench, gate-engine, gate-engine-profile, gate-engine-batched, gate-engine-profile-batched or idle-engine".into());
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
    if pane != "engine" {
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
    fn sustained_engine_gate_is_a_closed_autorun_mode() {
        assert_eq!(config("gate-engine", "12", "30").unwrap().mode, "gate-engine");
        assert_eq!(config("gate-engine-batched", "12", "30").unwrap().mode, "gate-engine-batched");
        assert_eq!(config("gate-engine-profile-batched", "12", "30").unwrap().mode, "gate-engine-profile-batched");
        assert!(config("gate-engine:32", "12", "30").is_err());
        assert_eq!(config("gate-engine-profile", "12", "30").unwrap().mode, "gate-engine-profile");
    }

    #[test]
    fn reloaded_autorun_fails_and_preserves_the_last_checkpoint() {
        let dir = tempfile::tempdir().unwrap();
        let report = dir.path().join("report.json");
        let mut run = RunState::new();
        run.claim(&report).unwrap();
        run.write_status(&report, r#"{"status":"running","sequence":1,"checkpoint":{"bench":[{"frames":12}],"errors":[]}}"#).unwrap();
        let before = std::fs::read(report.with_extension("checkpoint.json")).unwrap();
        assert!(run
            .claim(&report)
            .unwrap_err()
            .contains("webview-restarted"));
        assert!(run
            .write_status(&report, r#"{"status":"starting","checkpoint":{}}"#)
            .is_err());
        assert!(run.write_report(&report, r#"{"errors":[]}"#).is_err());
        assert_eq!(
            std::fs::read(report.with_extension("checkpoint.json")).unwrap(),
            before
        );
        assert!(!report.exists());
        let failure: serde_json::Value =
            serde_json::from_slice(&std::fs::read(report.with_extension("failure.json")).unwrap())
                .unwrap();
        assert_eq!(failure["reason"], "webview-restarted");
        let status: serde_json::Value =
            serde_json::from_slice(&std::fs::read(report.with_extension("status.json")).unwrap())
                .unwrap();
        assert_eq!(status["status"], "failed");
    }

    #[test]
    fn checkpoints_use_a_fixed_path_and_stale_progress_cannot_replace_them() {
        let dir = tempfile::tempdir().unwrap();
        let report = dir.path().join("report.json");
        let mut run = RunState::new();
        run.claim(&report).unwrap();
        run.write_status(
            &report,
            r#"{"status":"running","step":"second","sequence":2,"checkpoint":{"bench":[2]}}"#,
        )
        .unwrap();
        run.write_status(
            &report,
            r#"{"status":"running","step":"first","sequence":1,"checkpoint":{"bench":[1]}}"#,
        )
        .unwrap();
        let saved: serde_json::Value = serde_json::from_slice(
            &std::fs::read(report.with_extension("checkpoint.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(saved["bench"], serde_json::json!([2]));
        let status: serde_json::Value =
            serde_json::from_slice(&std::fs::read(report.with_extension("status.json")).unwrap())
                .unwrap();
        assert_eq!(status["step"], "second");
        assert!(status.get("checkpoint").is_none());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
    }

    #[test]
    fn invalid_and_oversized_status_cannot_replace_a_checkpoint() {
        let dir = tempfile::tempdir().unwrap();
        let report = dir.path().join("report.json");
        let mut run = RunState::new();
        run.claim(&report).unwrap();
        run.write_status(&report, r#"{"status":"running","checkpoint":{"ok":true}}"#)
            .unwrap();
        let before = std::fs::read(report.with_extension("checkpoint.json")).unwrap();
        for invalid in [
            "invalid".to_owned(),
            "[]".to_owned(),
            r#"{"checkpoint":[]}"#.to_owned(),
            format!("{{\"padding\":\"{}\"}}", "x".repeat(16 * 1024 * 1024)),
        ] {
            assert!(run.write_status(&report, &invalid).is_err());
        }
        assert_eq!(
            std::fs::read(report.with_extension("checkpoint.json")).unwrap(),
            before
        );
    }

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
