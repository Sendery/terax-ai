use serde_json::{json, Value};

/// One Claude Code hook Terax owns.
///
/// `reason` is fixed when the event alone says why the agent is blocked (a
/// question it asked); otherwise it is read from `notification_type`.
struct HookSpec {
    event: &'static str,
    marker: &'static str,
    matcher: Option<&'static str>,
    reason: Option<&'static str>,
}

const HOOKS: [HookSpec; 5] = [
    HookSpec { event: "UserPromptSubmit", marker: "working", matcher: None, reason: None },
    HookSpec { event: "Notification", marker: "attention", matcher: None, reason: None },
    HookSpec { event: "Stop", marker: "finished", matcher: None, reason: None },
    // Background subagents report back through this, not through Stop.
    HookSpec { event: "SubagentStop", marker: "subagent", matcher: None, reason: None },
    // A question dialog blocks the session at once; the Notification hook only
    // fires later, once Claude has been idle for a while.
    HookSpec {
        event: "PreToolUse",
        marker: "attention",
        matcher: Some("AskUserQuestion"),
        reason: Some("question"),
    },
];

// Includes the pre-v2.1.139 /dev/tty variant so re-running migrates it.
const OWNED_MARKERS: [&str; 2] = ["notify;Terax;", "terax;notify"];

// Gated on TERAX_TERMINAL; no-op outside Terax. Returns the sequence via
// `terminalSequence` because hooks lost /dev/tty access in v2.1.139.
//
// The payload arrives on stdin as JSON and is read once. `message` says why
// the agent stopped, `session_id` names the transcript so the webview never
// has to guess which file a pane is writing, and `notification_type` tells a
// permission prompt from an idle one. Extraction is plain sed/tr/cut rather
// than jq, which a user's shell is not guaranteed to have, and each miss
// degrades to an empty field. The message pattern steps over escaped quotes;
// stopping at the first `\"` cut a quoted tool name out of the prompt.
//
// Everything captured is spliced into a JSON string and then into an OSC
// payload. The message loses quotes, backslashes and control bytes, and the id
// and type are matched against closed character sets, so both layers are safe
// without a second round of escaping.
//
// Wire format: `notify;Terax;<marker>:<reason>;sid=<id>;<message>`.
fn hook_cmd(marker: &str, reason: Option<&str>) -> String {
    let reason = match reason {
        Some(fixed) => fixed.to_string(),
        None => r#"$(printf %s "$p" | sed -n 's/.*"notification_type"[[:space:]]*:[[:space:]]*"\([a-z_]*\)".*/\1/p' | cut -c1-32)"#.to_string(),
    };
    format!(
        r#"[ -n "$TERAX_TERMINAL" ] && p=$(cat) && m=$(printf %s "$p" | sed -nE 's/.*"message"[[:space:]]*:[[:space:]]*"(([^"\\]|\\.)*)".*/\1/p' | tr -d '\000-\037\\"' | cut -c1-160) && s=$(printf %s "$p" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([A-Za-z0-9_-]*\)".*/\1/p' | cut -c1-128) && r={reason} && printf '{{"terminalSequence":"\\u001b]777;notify;Terax;{marker}:%s;sid=%s;%s\\u0007"}}' "$r" "$s" "$m" || true"#
    )
}

fn hook_group(spec: &HookSpec) -> Value {
    let hooks = json!([{ "type": "command", "command": hook_cmd(spec.marker, spec.reason) }]);
    match spec.matcher {
        Some(matcher) => json!({ "matcher": matcher, "hooks": hooks }),
        None => json!({ "hooks": hooks }),
    }
}

fn is_ours(group: &Value) -> bool {
    group
        .get("hooks")
        .and_then(Value::as_array)
        .is_some_and(|hs| {
            hs.iter().any(|h| {
                h.get("command")
                    .and_then(Value::as_str)
                    .is_some_and(|c| OWNED_MARKERS.iter().any(|m| c.contains(m)))
            })
        })
}

// A group with no hooks is inert cruft (e.g. left behind when someone deletes
// our command but not its wrapper). Drop it so the file stays clean.
fn is_empty_group(group: &Value) -> bool {
    group
        .get("hooks")
        .and_then(Value::as_array)
        .is_none_or(|hs| hs.is_empty())
}

fn merge_hooks(mut root: Value) -> Value {
    if !root.is_object() {
        root = json!({});
    }
    let obj = root.as_object_mut().unwrap();
    let hooks = obj.entry("hooks").or_insert_with(|| json!({}));
    if !hooks.is_object() {
        *hooks = json!({});
    }
    let hooks = hooks.as_object_mut().unwrap();

    for event in HOOKS.iter().map(|spec| spec.event) {
        let arr = hooks.entry(event).or_insert_with(|| json!([]));
        if !arr.is_array() {
            *arr = json!([]);
        }
        let arr = arr.as_array_mut().unwrap();
        arr.retain(|group| !is_ours(group) && !is_empty_group(group));
        for spec in HOOKS.iter().filter(|spec| spec.event == event) {
            arr.push(hook_group(spec));
        }
    }
    root
}

fn existing_config(contents: Option<&str>, path: &std::path::Path) -> Result<Value, String> {
    match contents {
        Some(s) if !s.trim().is_empty() => serde_json::from_str::<Value>(s).map_err(|e| {
            format!("{} is not valid JSON ({e}); refusing to overwrite", path.display())
        }),
        _ => Ok(json!({})),
    }
}

fn settings_path() -> Result<std::path::PathBuf, String> {
    Ok(dirs::home_dir()
        .ok_or_else(|| "could not resolve home dir".to_string())?
        .join(".claude")
        .join("settings.json"))
}

#[tauri::command]
pub fn agent_enable_claude_hooks() -> Result<(), String> {
    let path = settings_path()?;
    let dir = path.parent().unwrap();
    std::fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;

    let existing = match std::fs::read_to_string(&path) {
        Ok(s) => existing_config(Some(&s), &path)?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(e) => return Err(format!("read {}: {e}", path.display())),
    };

    let merged = merge_hooks(existing);
    let out = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())?;

    // Write to a sibling temp file then rename so a crash mid-write can't leave
    // a truncated settings.json.
    let tmp = path.with_extension("json.terax-tmp");
    std::fs::write(&tmp, out).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("rename into {}: {e}", path.display())
    })?;
    Ok(())
}

/// True only when every hook Terax owns is installed in its current form.
///
/// Comparing the exact command rather than looking for a marker means a hook
/// written by an older Terax reads as missing, so the panel offers to update
/// it instead of silently running without the session id and reason.
fn hooks_are_current(root: &Value) -> bool {
    HOOKS.iter().all(|spec| {
        root["hooks"][spec.event]
            .as_array()
            .is_some_and(|groups| groups.iter().any(|group| *group == hook_group(spec)))
    })
}

#[tauri::command]
pub fn agent_claude_hooks_status() -> bool {
    settings_path()
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|content| serde_json::from_str::<Value>(&content).ok())
        .is_some_and(|root| hooks_are_current(&root))
}

#[cfg(test)]
mod message_tests {
    use super::*;

    #[test]
    fn the_notification_hook_forwards_what_claude_said() {
        let cmd = hook_cmd("attention", None);

        // Claude puts the reason it stopped in `message`; without it a
        // notification can only say that something happened.
        assert!(cmd.contains("message"));
        assert!(cmd.contains("notify;Terax;attention:"));
    }

    #[test]
    fn strips_what_would_break_the_json_or_the_escape_sequence() {
        let cmd = hook_cmd("attention", None);

        // The text is spliced into a JSON string and then into an OSC payload.
        // Removing quotes, backslashes and control bytes is what makes both
        // safe without a second layer of escaping.
        assert!(cmd.contains("tr -d"));
        assert!(cmd.contains("cut -c1-"));
    }

    #[test]
    fn stays_a_no_op_outside_terax() {
        assert!(hook_cmd("finished", None).contains("TERAX_TERMINAL"));
        assert!(hook_cmd("finished", None).ends_with("|| true"));
    }
}

#[cfg(all(test, unix))]
mod shell_tests {
    use super::*;
    use std::io::Write;
    use std::process::{Command, Stdio};

    /// Runs a hook command the way Claude Code does: stdin carries the event
    /// JSON and stdout must be the hook's JSON reply.
    fn run_hook(cmd: &str, stdin: &str) -> Value {
        let mut child = Command::new("sh")
            .arg("-c")
            .arg(cmd)
            .env("TERAX_TERMINAL", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("sh");
        child.stdin.take().unwrap().write_all(stdin.as_bytes()).unwrap();
        let out = child.wait_with_output().unwrap();
        serde_json::from_slice(&out.stdout).expect("hook reply must be JSON")
    }

    fn sequence(reply: &Value) -> String {
        reply["terminalSequence"].as_str().unwrap().to_string()
    }

    #[test]
    fn a_permission_prompt_carries_its_reason_session_and_message() {
        let reply = run_hook(
            &hook_cmd("attention", None),
            r#"{"session_id":"9f1c-4d2e","hook_event_name":"Notification","notification_type":"permission_prompt","message":"Claude needs your permission to use \"Bash\""}"#,
        );
        assert_eq!(
            sequence(&reply),
            "\u{1b}]777;notify;Terax;attention:permission_prompt;sid=9f1c-4d2e;Claude needs your permission to use Bash\u{7}"
        );
    }

    #[test]
    fn a_fixed_reason_wins_over_the_payload() {
        let reply = run_hook(
            &hook_cmd("attention", Some("question")),
            r#"{"session_id":"abc","tool_name":"AskUserQuestion"}"#,
        );
        assert_eq!(
            sequence(&reply),
            "\u{1b}]777;notify;Terax;attention:question;sid=abc;\u{7}"
        );
    }

    #[test]
    fn a_crafted_session_id_cannot_leave_its_character_set() {
        let reply = run_hook(
            &hook_cmd("finished", None),
            r#"{"session_id":"../../etc/passwd"}"#,
        );
        assert!(sequence(&reply).contains(";sid=;"));
    }

    #[test]
    fn prints_nothing_outside_terax() {
        let out = Command::new("sh")
            .arg("-c")
            .arg(hook_cmd("finished", None))
            .env_remove("TERAX_TERMINAL")
            .stdin(Stdio::null())
            .output()
            .unwrap();
        assert!(out.stdout.is_empty());
        assert!(out.status.success());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hook_count(root: &Value, event: &str) -> usize {
        root["hooks"][event].as_array().map_or(0, Vec::len)
    }

    fn command(root: &Value, event: &str, idx: usize) -> String {
        root["hooks"][event][idx]["hooks"][0]["command"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn adds_all_event_hooks_to_empty_config() {
        let out = merge_hooks(json!({}));
        assert_eq!(hook_count(&out, "UserPromptSubmit"), 1);
        assert_eq!(hook_count(&out, "Notification"), 1);
        assert_eq!(hook_count(&out, "Stop"), 1);
        assert!(command(&out, "Notification", 0).contains("notify;Terax;attention"));
        assert!(command(&out, "Stop", 0).contains("notify;Terax;finished"));
        assert!(command(&out, "UserPromptSubmit", 0).contains("notify;Terax;working"));
        assert!(command(&out, "Stop", 0).contains("terminalSequence"));
        assert!(!command(&out, "Stop", 0).contains("/dev/tty"));
    }

    #[test]
    fn installs_subagent_and_question_hooks() {
        let out = merge_hooks(json!({}));
        assert!(command(&out, "SubagentStop", 0).contains("notify;Terax;subagent"));
        assert_eq!(out["hooks"]["PreToolUse"][0]["matcher"], "AskUserQuestion");
        assert!(command(&out, "PreToolUse", 0).contains("attention:%s"));
    }

    #[test]
    fn keeps_a_foreign_pre_tool_use_hook_next_to_ours() {
        let input = json!({ "hooks": { "PreToolUse": [
            { "matcher": "Bash", "hooks": [ { "type": "command", "command": "audit" } ] }
        ] } });
        let out = merge_hooks(input);
        assert_eq!(hook_count(&out, "PreToolUse"), 2);
        assert_eq!(out["hooks"]["PreToolUse"][0]["matcher"], "Bash");
    }

    #[test]
    fn reports_hooks_from_an_older_terax_as_out_of_date() {
        let legacy = json!({ "hooks": {
            "Stop": [ { "hooks": [ { "type": "command", "command":
                "[ -n \"$TERAX_TERMINAL\" ] && printf '{\"terminalSequence\":\"\\u001b]777;notify;Terax;finished\\u0007\"}' || true" } ] } ]
        } });
        assert!(!hooks_are_current(&legacy));
        assert!(hooks_are_current(&merge_hooks(legacy)));
    }

    #[test]
    fn is_idempotent() {
        let once = merge_hooks(json!({}));
        let twice = merge_hooks(once.clone());
        assert_eq!(once, twice);
        assert_eq!(hook_count(&twice, "Notification"), 1);
    }

    #[test]
    fn migrates_legacy_dev_tty_hook() {
        let legacy = json!({
            "hooks": {
                "Notification": [
                    { "hooks": [ {
                        "type": "command",
                        "command": "[ -n \"$TERAX_TERMINAL\" ] && printf '\\033]777;terax;notify\\033\\\\' > /dev/tty || true"
                    } ] }
                ]
            }
        });
        let out = merge_hooks(legacy);
        assert_eq!(hook_count(&out, "Notification"), 1);
        assert!(command(&out, "Notification", 0).contains("terminalSequence"));
        assert!(!command(&out, "Notification", 0).contains("/dev/tty"));
    }

    #[test]
    fn preserves_unrelated_settings_and_foreign_hooks() {
        let input = json!({
            "permissions": { "allow": ["Bash"] },
            "hooks": {
                "Notification": [
                    { "hooks": [ { "type": "command", "command": "say hi" } ] }
                ]
            }
        });
        let out = merge_hooks(input);
        assert_eq!(out["permissions"]["allow"][0], "Bash");
        assert_eq!(hook_count(&out, "Notification"), 2);
        assert_eq!(command(&out, "Notification", 0), "say hi");
    }

    #[test]
    fn replaces_non_object_root() {
        let out = merge_hooks(json!("garbage"));
        assert_eq!(hook_count(&out, "Notification"), 1);
    }

    #[test]
    fn prunes_empty_groups_and_collapses_duplicates() {
        let input = json!({
            "hooks": {
                "Notification": [
                    { "hooks": [] },
                    { "hooks": [ { "type": "command", "command": hook_cmd("attention", None) } ] }
                ]
            }
        });
        let out = merge_hooks(input);
        assert_eq!(hook_count(&out, "Notification"), 1);
        assert!(command(&out, "Notification", 0).contains("notify;Terax;attention"));
    }

    #[test]
    fn existing_config_absent_or_empty_starts_fresh() {
        let p = std::path::Path::new("/x/settings.json");
        assert_eq!(existing_config(None, p).unwrap(), json!({}));
        assert_eq!(existing_config(Some("   \n"), p).unwrap(), json!({}));
    }

    #[test]
    fn existing_config_refuses_to_clobber_invalid_json() {
        let p = std::path::Path::new("/x/settings.json");
        assert!(existing_config(Some("{ not json,"), p).is_err());
        assert_eq!(
            existing_config(Some(r#"{"permissions":{}}"#), p).unwrap(),
            json!({ "permissions": {} })
        );
    }
}
