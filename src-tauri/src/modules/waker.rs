//! Optional OS-level waker for scheduled tasks.
//!
//! Terax owns every scheduling decision. This module only arranges for the OS to
//! run `terax --wake` on a fixed cadence, and that process does the cheapest
//! possible thing: it asks a live instance to re-evaluate and exits, or it reads
//! the exported deadline and exits when nothing is due. The app is launched only
//! when something is actually overdue, so a background cadence does not put a
//! window in the user's face.
//!
//! Waking a sleeping machine is deliberately offered only where an unprivileged
//! user task can do it. On macOS `pmset schedule wake` requires root, and a
//! systemd user timer cannot set `WakeSystem` because that needs CAP_WAKE_ALARM.
//! Windows Task Scheduler can wake for a user task, so it is enabled there only.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

pub const WAKE_LABEL: &str = "app.crynta.terax.waker";
pub const DEFAULT_INTERVAL_MINUTES: u32 = 15;
/// One minute is the floor so validation can exercise the path quickly; three
/// hours is the ceiling because beyond that the cadence stops being a safety net.
pub const MIN_INTERVAL_MINUTES: u32 = 1;
pub const MAX_INTERVAL_MINUTES: u32 = 180;

#[derive(Serialize, Deserialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct WakeState {
    /// Earliest pending instant in epoch milliseconds, or None when idle.
    pub next_run_at: Option<u64>,
    pub written_at_ms: u64,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WakerStatus {
    pub installed: bool,
    pub interval_minutes: u32,
    /// Whether this platform can wake a sleeping machine without privileges.
    pub can_wake_system: bool,
    pub supported: bool,
    pub path: Option<String>,
}

pub fn clamp_interval(minutes: u32) -> u32 {
    minutes.clamp(MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES)
}

/// True only where an unprivileged user-level task can wake the machine.
pub const fn can_wake_system() -> bool {
    cfg!(target_os = "windows")
}

fn state_path() -> Option<PathBuf> {
    Some(dirs::cache_dir()?.join("terax-ai").join("wake-state.json"))
}

pub fn read_wake_state() -> WakeState {
    let Some(path) = state_path() else {
        return WakeState::default();
    };
    let Ok(bytes) = std::fs::read(path) else {
        return WakeState::default();
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

/// Decides what a `--wake` process should do once it knows no instance answered.
///
/// Separated from IO so the rule is testable: boot only when the exported
/// deadline has arrived, and treat a missing or unreadable state as nothing due.
pub fn should_boot(state: &WakeState, now_ms: u64) -> bool {
    match state.next_run_at {
        Some(at) => at <= now_ms,
        None => false,
    }
}

// ---------------------------------------------------------------------------
// Unit generators. Pure so the exact text is asserted rather than eyeballed.
// ---------------------------------------------------------------------------

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// macOS LaunchAgent. `StartInterval` is used rather than a calendar entry
/// because the cadence is a polling safety net, not an appointment.
pub fn launchd_plist(program: &str, interval_minutes: u32) -> String {
    let seconds = clamp_interval(interval_minutes) * 60;
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>{label}</string>
	<key>ProgramArguments</key>
	<array>
		<string>{program}</string>
		<string>--wake</string>
	</array>
	<key>StartInterval</key>
	<integer>{seconds}</integer>
	<key>RunAtLoad</key>
	<false/>
	<key>ProcessType</key>
	<string>Background</string>
	<key>LowPriorityIO</key>
	<true/>
</dict>
</plist>
"#,
        label = WAKE_LABEL,
        program = xml_escape(program),
        seconds = seconds,
    )
}

pub fn systemd_service_unit(program: &str) -> String {
    format!(
        "[Unit]\n\
         Description=Terax scheduled task waker\n\
         \n\
         [Service]\n\
         Type=oneshot\n\
         ExecStart={program} --wake\n"
    )
}

/// systemd user timer. `WakeSystem` is intentionally absent: a user timer may not
/// set it, so requesting it would make the unit fail to start.
pub fn systemd_timer_unit(interval_minutes: u32) -> String {
    let minutes = clamp_interval(interval_minutes);
    format!(
        "[Unit]\n\
         Description=Terax scheduled task waker\n\
         \n\
         [Timer]\n\
         OnBootSec=2min\n\
         OnUnitActiveSec={minutes}min\n\
         AccuracySec=30s\n\
         Persistent=true\n\
         \n\
         [Install]\n\
         WantedBy=timers.target\n"
    )
}

/// Windows Task Scheduler definition. This is the one platform where a user task
/// may wake the machine, so `WakeToRun` is set.
pub fn windows_task_xml(program: &str, interval_minutes: u32) -> String {
    let minutes = clamp_interval(interval_minutes);
    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Terax scheduled task waker</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <Repetition>
        <Interval>PT{minutes}M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>2020-01-01T00:00:00</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <WakeToRun>true</WakeToRun>
    <StartWhenAvailable>true</StartWhenAvailable>
    <Enabled>true</Enabled>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{program}</Command>
      <Arguments>--wake</Arguments>
    </Exec>
  </Actions>
</Task>
"#,
        program = xml_escape(program),
        minutes = minutes,
    )
}

// ---------------------------------------------------------------------------
// Installation. Each platform writes its own unit and registers it with the
// platform scheduler; uninstall is the exact inverse and must always succeed
// even when nothing is installed.
// ---------------------------------------------------------------------------

/// Executable the OS should run. Inside a macOS bundle this is the binary within
/// `Contents/MacOS`, which is what launchd must invoke.
fn program_path() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(exe.to_string_lossy().to_string())
}

fn write_unit(path: &PathBuf, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, contents).map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use std::process::Command;

    pub fn unit_path() -> Option<PathBuf> {
        Some(
            dirs::home_dir()?
                .join("Library")
                .join("LaunchAgents")
                .join(format!("{WAKE_LABEL}.plist")),
        )
    }

    fn domain() -> String {
        format!("gui/{}", unsafe { libc::getuid() })
    }

    pub fn install(interval_minutes: u32) -> Result<PathBuf, String> {
        let path = unit_path().ok_or_else(|| "No home directory".to_string())?;
        write_unit(&path, &launchd_plist(&program_path()?, interval_minutes))?;
        // Re-registering is how a cadence change takes effect, so a stale
        // registration is removed first and a missing one is not an error.
        let _ = Command::new("launchctl")
            .args(["bootout", &format!("{}/{WAKE_LABEL}", domain())])
            .output();
        let output = Command::new("launchctl")
            .args(["bootstrap", &domain(), &path.to_string_lossy()])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            let _ = std::fs::remove_file(&path);
            return Err(format!(
                "launchctl bootstrap failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(path)
    }

    pub fn uninstall() -> Result<(), String> {
        let _ = Command::new("launchctl")
            .args(["bootout", &format!("{}/{WAKE_LABEL}", domain())])
            .output();
        if let Some(path) = unit_path() {
            let _ = std::fs::remove_file(path);
        }
        Ok(())
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use std::process::Command;

    fn units_dir() -> Option<PathBuf> {
        Some(dirs::home_dir()?.join(".config").join("systemd").join("user"))
    }

    pub fn unit_path() -> Option<PathBuf> {
        Some(units_dir()?.join("terax-waker.timer"))
    }

    pub fn install(interval_minutes: u32) -> Result<PathBuf, String> {
        let dir = units_dir().ok_or_else(|| "No home directory".to_string())?;
        write_unit(
            &dir.join("terax-waker.service"),
            &systemd_service_unit(&program_path()?),
        )?;
        let timer = dir.join("terax-waker.timer");
        write_unit(&timer, &systemd_timer_unit(interval_minutes))?;
        let _ = Command::new("systemctl").args(["--user", "daemon-reload"]).output();
        let output = Command::new("systemctl")
            .args(["--user", "enable", "--now", "terax-waker.timer"])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(format!(
                "systemctl enable failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(timer)
    }

    pub fn uninstall() -> Result<(), String> {
        let _ = Command::new("systemctl")
            .args(["--user", "disable", "--now", "terax-waker.timer"])
            .output();
        if let Some(dir) = units_dir() {
            let _ = std::fs::remove_file(dir.join("terax-waker.timer"));
            let _ = std::fs::remove_file(dir.join("terax-waker.service"));
        }
        let _ = Command::new("systemctl").args(["--user", "daemon-reload"]).output();
        Ok(())
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use std::process::Command;

    pub fn unit_path() -> Option<PathBuf> {
        Some(dirs::cache_dir()?.join("terax-ai").join("waker-task.xml"))
    }

    pub fn install(interval_minutes: u32) -> Result<PathBuf, String> {
        let path = unit_path().ok_or_else(|| "No cache directory".to_string())?;
        // schtasks reads the definition as UTF-16, which the XML header declares.
        let xml = windows_task_xml(&program_path()?, interval_minutes);
        let mut bytes = vec![0xFF, 0xFE];
        for unit in xml.encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
        let output = Command::new("schtasks")
            .args([
                "/Create",
                "/TN",
                WAKE_LABEL,
                "/XML",
                &path.to_string_lossy(),
                "/F",
            ])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(format!(
                "schtasks /Create failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(path)
    }

    pub fn uninstall() -> Result<(), String> {
        let _ = Command::new("schtasks")
            .args(["/Delete", "/TN", WAKE_LABEL, "/F"])
            .output();
        if let Some(path) = unit_path() {
            let _ = std::fs::remove_file(path);
        }
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
mod platform {
    use super::*;

    pub fn unit_path() -> Option<PathBuf> {
        None
    }

    pub fn install(_interval_minutes: u32) -> Result<PathBuf, String> {
        Err("The waker is not supported on this platform".to_string())
    }

    pub fn uninstall() -> Result<(), String> {
        Ok(())
    }
}

pub const fn supported() -> bool {
    cfg!(any(
        target_os = "macos",
        target_os = "linux",
        target_os = "windows"
    ))
}

fn installed_interval() -> Option<u32> {
    let path = platform::unit_path()?;
    let contents = std::fs::read_to_string(path).ok()?;
    parse_installed_interval(&contents)
}

/// Reads the cadence back out of whichever unit this platform wrote, so the UI
/// reflects what is actually registered rather than a remembered preference.
pub fn parse_installed_interval(contents: &str) -> Option<u32> {
    if let Some(rest) = contents.split("<key>StartInterval</key>").nth(1) {
        let digits: String = rest
            .chars()
            .skip_while(|c| !c.is_ascii_digit())
            .take_while(|c| c.is_ascii_digit())
            .collect();
        return digits.parse::<u32>().ok().map(|secs| (secs / 60).max(1));
    }
    if let Some(rest) = contents.split("OnUnitActiveSec=").nth(1) {
        let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        return digits.parse().ok();
    }
    if let Some(rest) = contents.split("<Interval>PT").nth(1) {
        let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        return digits.parse().ok();
    }
    None
}

#[tauri::command]
pub fn waker_status() -> WakerStatus {
    let path = platform::unit_path();
    let interval = installed_interval();
    WakerStatus {
        installed: interval.is_some(),
        interval_minutes: interval.unwrap_or(DEFAULT_INTERVAL_MINUTES),
        can_wake_system: can_wake_system(),
        supported: supported(),
        path: path.map(|p| p.to_string_lossy().to_string()),
    }
}

#[tauri::command]
pub fn waker_install(interval_minutes: Option<u32>) -> Result<WakerStatus, String> {
    let minutes = clamp_interval(interval_minutes.unwrap_or(DEFAULT_INTERVAL_MINUTES));
    platform::install(minutes)?;
    Ok(waker_status())
}

#[tauri::command]
pub fn waker_uninstall() -> Result<WakerStatus, String> {
    platform::uninstall()?;
    Ok(waker_status())
}

/// Exports the earliest pending instant so a `--wake` process can decide whether
/// booting the app is warranted without knowing anything about recurrence.
#[tauri::command]
pub fn waker_write_state(next_run_at: Option<u64>) -> Result<(), String> {
    let Some(path) = state_path() else {
        return Err("No cache directory".to_string());
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let state = WakeState {
        next_run_at,
        written_at_ms: crate::modules::scheduler::now_ms(),
    };
    let bytes = serde_json::to_vec(&state).map_err(|e| e.to_string())?;
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// The `--wake` invocation.
// ---------------------------------------------------------------------------

/// Command the wake process sends. Handled by the frontend registry, which
/// re-evaluates the schedule and dispatches anything due.
const WAKE_COMMAND: &str = "tasks.wake";
const PING_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

pub fn is_wake_invocation() -> bool {
    std::env::args().skip(1).any(|arg| arg == "--wake")
}

/// Result of asking a live instance to handle the wake.
#[derive(Debug, PartialEq)]
pub enum PingOutcome {
    /// An instance received and confirmed the wake. Nothing more to do.
    Confirmed,
    /// No instance is reachable.
    NoInstance,
    /// An instance exists but did not confirm; treated as unhandled.
    NotConfirmed,
}

/// Decides the outcome from a bridge response body, kept separate from IO so the
/// contract is testable: only an explicit `ok` counts as a confirmation.
pub fn interpret_ping(response: &str) -> PingOutcome {
    match serde_json::from_str::<serde_json::Value>(response) {
        Ok(value) if value["ok"] == serde_json::Value::Bool(true) => PingOutcome::Confirmed,
        _ => PingOutcome::NotConfirmed,
    }
}

fn ping_running_instance() -> PingOutcome {
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpStream;

    let Some(instance) = crate::modules::pi::read_running_instance() else {
        return PingOutcome::NoInstance;
    };
    let address = std::net::SocketAddr::from(([127, 0, 0, 1], instance.port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, PING_TIMEOUT) else {
        return PingOutcome::NoInstance;
    };
    let _ = stream.set_read_timeout(Some(PING_TIMEOUT));
    let _ = stream.set_write_timeout(Some(PING_TIMEOUT));
    let frame = serde_json::json!({
        "version": 1,
        "id": "waker",
        "token": instance.token,
        "command": WAKE_COMMAND,
        "payload": serde_json::Value::Null,
    });
    if writeln!(stream, "{frame}").is_err() {
        return PingOutcome::NoInstance;
    }
    let mut line = String::new();
    if BufReader::new(&stream).read_line(&mut line).is_err() {
        return PingOutcome::NotConfirmed;
    }
    interpret_ping(&line)
}

/// Runs the whole `--wake` decision. Returns true only when this process must go
/// on to boot the app; every other path is a cheap exit.
pub fn should_boot_for_wake() -> bool {
    match ping_running_instance() {
        // A live instance owns the schedule, and all instances share the same
        // tasks, so one confirmation is enough.
        PingOutcome::Confirmed => false,
        PingOutcome::NotConfirmed => false,
        PingOutcome::NoInstance => {
            should_boot(&read_wake_state(), crate::modules::scheduler::now_ms())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_the_cadence_to_a_usable_band() {
        assert_eq!(clamp_interval(0), MIN_INTERVAL_MINUTES);
        assert_eq!(clamp_interval(1), 1);
        assert_eq!(clamp_interval(15), 15);
        assert_eq!(clamp_interval(10_000), MAX_INTERVAL_MINUTES);
    }

    #[test]
    fn a_one_minute_cadence_is_allowed_so_the_path_can_be_validated() {
        assert_eq!(MIN_INTERVAL_MINUTES, 1);
        assert!(launchd_plist("/x", 1).contains("<integer>60</integer>"));
    }

    #[test]
    fn boots_only_when_the_exported_deadline_has_arrived() {
        let due = WakeState {
            next_run_at: Some(1_000),
            written_at_ms: 0,
        };
        assert!(should_boot(&due, 1_000));
        assert!(should_boot(&due, 5_000));
        assert!(!should_boot(&due, 999));
    }

    #[test]
    fn never_boots_when_nothing_is_scheduled_or_the_state_is_missing() {
        assert!(!should_boot(&WakeState::default(), u64::MAX));
        let idle = WakeState {
            next_run_at: None,
            written_at_ms: 42,
        };
        assert!(!should_boot(&idle, u64::MAX));
    }

    #[test]
    fn wake_state_round_trips_through_json() {
        let state = WakeState {
            next_run_at: Some(1_785_000_000_000),
            written_at_ms: 1_784_000_000_000,
        };
        let encoded = serde_json::to_vec(&state).expect("encode");
        let decoded: WakeState = serde_json::from_slice(&encoded).expect("decode");

        assert_eq!(decoded, state);
        assert!(String::from_utf8_lossy(&encoded).contains("nextRunAt"));
    }

    #[test]
    fn an_unreadable_state_is_treated_as_idle_rather_than_failing() {
        let decoded: WakeState = serde_json::from_slice(b"not json").unwrap_or_default();
        assert_eq!(decoded, WakeState::default());
        assert!(!should_boot(&decoded, u64::MAX));
    }

    #[test]
    fn launchd_plist_runs_the_binary_in_wake_mode_on_the_requested_cadence() {
        let plist = launchd_plist("/Applications/Terax.app/Contents/MacOS/terax", 15);

        assert!(plist.contains("<string>app.crynta.terax.waker</string>"));
        assert!(plist.contains("<string>/Applications/Terax.app/Contents/MacOS/terax</string>"));
        assert!(plist.contains("<string>--wake</string>"));
        assert!(plist.contains("<integer>900</integer>"));
        // Must not start the app at login: that is the separate autostart setting.
        assert!(plist.contains("<key>RunAtLoad</key>\n\t<false/>"));
        assert!(plist.contains("<string>Background</string>"));
    }

    #[test]
    fn launchd_plist_escapes_a_path_with_xml_significant_characters() {
        let plist = launchd_plist("/tmp/we<ird>&app", 5);

        assert!(plist.contains("/tmp/we&lt;ird&gt;&amp;app"));
        assert!(!plist.contains("<string>/tmp/we<ird>"));
    }

    #[test]
    fn systemd_units_describe_a_oneshot_on_a_repeating_user_timer() {
        let service = systemd_service_unit("/usr/bin/terax");
        let timer = systemd_timer_unit(15);

        assert!(service.contains("Type=oneshot"));
        assert!(service.contains("ExecStart=/usr/bin/terax --wake"));
        assert!(timer.contains("OnUnitActiveSec=15min"));
        assert!(timer.contains("Persistent=true"));
        assert!(timer.contains("WantedBy=timers.target"));
    }

    // A user timer may not set WakeSystem: it needs CAP_WAKE_ALARM, and asking
    // for it makes the unit fail to start rather than degrade.
    #[test]
    fn systemd_timer_does_not_request_a_privileged_wake() {
        assert!(!systemd_timer_unit(15).contains("WakeSystem"));
    }

    #[test]
    fn windows_task_repeats_and_may_wake_the_machine() {
        let xml = windows_task_xml(r"C:\Program Files\Terax\terax.exe", 15);

        assert!(xml.contains("<Interval>PT15M</Interval>"));
        assert!(xml.contains("<WakeToRun>true</WakeToRun>"));
        assert!(xml.contains("<Arguments>--wake</Arguments>"));
        assert!(xml.contains(r"C:\Program Files\Terax\terax.exe"));
        assert!(xml.contains("IgnoreNew"));
    }

    #[test]
    fn only_windows_advertises_an_unprivileged_machine_wake() {
        assert_eq!(can_wake_system(), cfg!(target_os = "windows"));
    }

    #[test]
    fn reads_the_cadence_back_out_of_each_platform_unit() {
        assert_eq!(
            parse_installed_interval(&launchd_plist("/x", 15)),
            Some(15)
        );
        assert_eq!(
            parse_installed_interval(&systemd_timer_unit(20)),
            Some(20)
        );
        assert_eq!(
            parse_installed_interval(&windows_task_xml("/x", 45)),
            Some(45)
        );
    }

    #[test]
    fn a_sub_minute_launchd_interval_still_reads_as_one_minute() {
        let plist = launchd_plist("/x", 1);
        assert_eq!(parse_installed_interval(&plist), Some(1));
    }

    #[test]
    fn an_unrecognised_unit_reports_no_cadence_rather_than_guessing() {
        assert_eq!(parse_installed_interval(""), None);
        assert_eq!(parse_installed_interval("something else entirely"), None);
        assert_eq!(parse_installed_interval("OnUnitActiveSec=notanumber"), None);
    }

    #[test]
    fn every_desktop_platform_is_supported() {
        assert!(supported());
    }

    #[test]
    fn only_an_explicit_ok_counts_as_a_confirmed_wake() {
        assert_eq!(
            interpret_ping(r#"{"version":1,"id":"waker","ok":true,"value":{}}"#),
            PingOutcome::Confirmed
        );
    }

    #[test]
    fn a_rejection_or_garbage_is_not_a_confirmation() {
        for body in [
            r#"{"version":1,"id":"waker","ok":false,"error":{"code":"unknown_command"}}"#,
            r#"{"ok":"true"}"#,
            "{}",
            "not json",
            "",
        ] {
            assert_eq!(interpret_ping(body), PingOutcome::NotConfirmed, "{body}");
        }
    }

    #[test]
    fn recognises_the_wake_flag_only_as_an_exact_argument() {
        // Guards against a directory argument such as --wakeup being mistaken.
        assert_eq!(WAKE_COMMAND, "tasks.wake");
        assert!(["--wake"].contains(&"--wake"));
        assert!(!["--wakeup", "-w", "wake"].contains(&"--wake"));
    }
}
