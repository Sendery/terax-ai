use super::config::{
    classify_opencode, classify_stdio, opencode_entry, stdio_entry, upsert_server, TargetState,
};
use super::*;
use std::cell::RefCell;

struct FakeBridge {
    calls: RefCell<Vec<(String, Value)>>,
    reply: Result<Value, BridgeError>,
}

impl FakeBridge {
    fn ok(value: Value) -> Self {
        Self {
            calls: RefCell::new(Vec::new()),
            reply: Ok(value),
        }
    }

    fn failing(code: &str, message: &str) -> Self {
        Self {
            calls: RefCell::new(Vec::new()),
            reply: Err(BridgeError::new(code, message)),
        }
    }
}

impl Bridge for FakeBridge {
    fn call(&self, command: &str, payload: Value) -> Result<Value, BridgeError> {
        self.calls.borrow_mut().push((command.to_string(), payload));
        self.reply.clone()
    }

    fn status(&self) -> Value {
        json!({ "running": true })
    }
}

fn request(method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": 7, "method": method, "params": params })
}

fn call(bridge: &FakeBridge, tool: &str, arguments: Value) -> Value {
    let msg = request(
        "tools/call",
        json!({ "name": tool, "arguments": arguments }),
    );
    handle_message(&msg, surface(), bridge).expect("response")["result"].clone()
}

#[test]
fn embedded_surface_parses_and_every_action_dispatches_somewhere() {
    let surface = surface();
    assert!(surface.tools.len() >= 5 && surface.tools.len() <= 15);
    for tool in &surface.tools {
        assert!(tool.name.starts_with("terax_"));
        assert_eq!(tool.input_schema["type"], "object");
        assert_eq!(tool.input_schema["required"], json!(["action"]));
        for (name, action) in &tool.actions {
            assert!(
                action.command.is_some() != action.local.is_some(),
                "{}.{name} must be a command or a local action",
                tool.name
            );
        }
    }
}

#[test]
fn every_surface_command_is_allowed_by_the_bridge() {
    for tool in &surface().tools {
        for action in tool.actions.values() {
            if let Some(command) = &action.command {
                let frame = json!({
                    "version": 1, "id": "t", "token": "k", "command": command, "payload": null
                });
                assert!(
                    crate::modules::pi::decode_request_line(frame.to_string().as_bytes(), "k")
                        .is_ok(),
                    "{command} is served over MCP but the bridge rejects it"
                );
            }
        }
    }
}

#[test]
fn initialize_negotiates_the_protocol_and_describes_the_server() {
    let bridge = FakeBridge::ok(Value::Null);
    let known = handle_message(
        &request(
            "initialize",
            json!({ "protocolVersion": "2025-06-18", "capabilities": {} }),
        ),
        surface(),
        &bridge,
    )
    .unwrap();
    assert_eq!(known["result"]["protocolVersion"], "2025-06-18");
    assert_eq!(known["result"]["serverInfo"]["name"], "terax");
    assert!(known["result"]["capabilities"]["tools"].is_object());
    assert!(known["result"]["instructions"]
        .as_str()
        .unwrap()
        .contains("terax_inspect"));

    let unknown = handle_message(
        &request("initialize", json!({ "protocolVersion": "1999-01-01" })),
        surface(),
        &bridge,
    )
    .unwrap();
    assert_eq!(unknown["result"]["protocolVersion"], PROTOCOL_VERSIONS[0]);
}

#[test]
fn notifications_get_no_reply_and_unknown_methods_an_error() {
    let bridge = FakeBridge::ok(Value::Null);
    let note = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
    assert!(handle_message(&note, surface(), &bridge).is_none());
    let unknown =
        handle_message(&request("resources/list", json!({})), surface(), &bridge).unwrap();
    assert_eq!(unknown["error"]["code"], -32601);
    let ping = handle_message(&request("ping", json!({})), surface(), &bridge).unwrap();
    assert_eq!(ping["result"], json!({}));
}

#[test]
fn tools_list_hides_the_dispatch_table() {
    let bridge = FakeBridge::ok(Value::Null);
    let list = handle_message(&request("tools/list", json!({})), surface(), &bridge).unwrap();
    let tools = list["result"]["tools"].as_array().unwrap();
    assert_eq!(tools.len(), surface().tools.len());
    for tool in tools {
        assert!(tool.get("actions").is_none());
        assert!(tool["annotations"]["readOnlyHint"].is_boolean());
        assert!(tool["inputSchema"]["properties"]["action"]["enum"].is_array());
    }
}

#[test]
fn a_grouped_action_reaches_its_registry_command_with_only_its_arguments() {
    let bridge = FakeBridge::ok(json!({ "renamed": true }));
    let result = call(
        &bridge,
        "terax_manage_tabs",
        json!({ "action": "rename_tab", "tabId": 4, "title": "API" }),
    );
    assert_eq!(result["isError"], false);
    assert_eq!(result["structuredContent"], json!({ "renamed": true }));
    let calls = bridge.calls.borrow();
    assert_eq!(
        calls[0],
        (
            "tab.rename".to_string(),
            json!({ "tabId": 4, "title": "API" })
        )
    );
}

#[test]
fn an_action_without_arguments_sends_a_null_payload() {
    let bridge = FakeBridge::ok(json!([1, 2]));
    let result = call(&bridge, "terax_inspect", json!({ "action": "snapshot" }));
    assert_eq!(
        bridge.calls.borrow()[0],
        ("app.snapshot".to_string(), Value::Null)
    );
    assert_eq!(result["structuredContent"], json!({ "result": [1, 2] }));
}

#[test]
fn mistakes_come_back_as_tool_errors_that_say_how_to_fix_them() {
    let bridge = FakeBridge::ok(Value::Null);
    let missing = call(&bridge, "terax_manage_tabs", json!({}));
    assert_eq!(missing["isError"], true);
    assert!(missing["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("rename_tab"));

    let wrong = call(&bridge, "terax_manage_tabs", json!({ "action": "explode" }));
    assert!(wrong["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("no action explode"));

    let stray = call(
        &bridge,
        "terax_manage_tabs",
        json!({ "action": "focus_tab", "tabId": 1, "color": "red" }),
    );
    let text = stray["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("does not take color") && text.contains("tabId"));
    assert!(bridge.calls.borrow().is_empty());
}

#[test]
fn bridge_failures_carry_a_recovery_hint() {
    let bridge = FakeBridge::failing("invalid_payload", "tabId is required.");
    let result = call(
        &bridge,
        "terax_manage_tabs",
        json!({ "action": "focus_tab" }),
    );
    assert_eq!(result["isError"], true);
    let text = result["content"][0]["text"].as_str().unwrap();
    assert!(text.starts_with("invalid_payload: tabId is required."));
    assert!(text.contains("list_commands"));
}

#[test]
fn unknown_tools_are_protocol_errors() {
    let bridge = FakeBridge::ok(Value::Null);
    let msg = request("tools/call", json!({ "name": "nope", "arguments": {} }));
    let response = handle_message(&msg, surface(), &bridge).unwrap();
    assert_eq!(response["error"]["code"], -32602);
}

#[test]
fn local_actions_run_in_the_server() {
    let bridge = FakeBridge::ok(Value::Null);
    let status = call(&bridge, "terax_inspect", json!({ "action": "status" }));
    assert_eq!(status["structuredContent"]["running"], true);
    let waited = call(
        &bridge,
        "terax_inspect",
        json!({ "action": "wait", "ms": 1 }),
    );
    assert_eq!(waited["structuredContent"]["waitedMs"], 1);
    let bad = call(
        &bridge,
        "terax_inspect",
        json!({ "action": "wait", "ms": -5 }),
    );
    assert_eq!(bad["isError"], true);
    assert!(bridge.calls.borrow().is_empty());
}

#[test]
fn bridge_responses_are_decoded() {
    assert_eq!(
        parse_bridge_response(r#"{"version":1,"id":"x","ok":true,"value":{"a":1}}"#),
        Ok(json!({ "a": 1 }))
    );
    let err = parse_bridge_response(r#"{"ok":false,"error":{"code":"timeout","message":"slow"}}"#)
        .unwrap_err();
    assert_eq!(err.code, "timeout");
    assert_eq!(
        parse_bridge_response("garbage").unwrap_err().code,
        "invalid_response"
    );
}

#[test]
fn serve_answers_line_by_line_and_survives_bad_input() {
    let input = [
        r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#,
        "",
        "not json",
        r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
        r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#,
    ]
    .join("\n");
    let mut out = Vec::new();
    serve(input.as_bytes(), &mut out, &FakeBridge::ok(Value::Null)).unwrap();
    let lines: Vec<Value> = String::from_utf8(out)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(lines.len(), 3);
    assert_eq!(lines[0]["id"], 1);
    assert_eq!(lines[1]["error"]["code"], -32700);
    assert_eq!(lines[2]["id"], 2);
}

#[test]
fn oversized_lines_are_skipped_whole() {
    let big = "x".repeat(64);
    let input = format!("{big}\nok\n");
    let mut reader = std::io::BufReader::with_capacity(8, input.as_bytes());
    assert_eq!(read_line_bounded(&mut reader, 16).unwrap(), Some(Err(())));
    assert_eq!(
        read_line_bounded(&mut reader, 16).unwrap(),
        Some(Ok(b"ok".to_vec()))
    );
    assert_eq!(read_line_bounded(&mut reader, 16).unwrap(), None);
}

#[test]
fn discovery_paths_must_name_the_bridge_file() {
    assert!(is_discovery_path(Path::new("/tmp/terax-ai/pi-bridge.json")));
    assert!(!is_discovery_path(Path::new("relative/pi-bridge.json")));
    assert!(!is_discovery_path(Path::new("/etc/passwd")));
}

#[test]
fn stdio_entries_are_classified() {
    let cmd = "/Applications/Terax.app/Contents/MacOS/terax";
    assert_eq!(classify_stdio(None, cmd), TargetState::Missing);
    assert_eq!(
        classify_stdio(Some(&stdio_entry(cmd)), cmd),
        TargetState::Current
    );
    assert_eq!(
        classify_stdio(Some(&stdio_entry("/other/terax")), cmd),
        TargetState::Stale
    );
    let no_flag = json!({ "command": cmd, "args": [] });
    assert_eq!(classify_stdio(Some(&no_flag), cmd), TargetState::Stale);
}

#[test]
fn opencode_entries_are_classified() {
    let cmd = "/opt/terax";
    assert_eq!(
        classify_opencode(Some(&opencode_entry(cmd)), cmd),
        TargetState::Current
    );
    let disabled = json!({ "type": "local", "command": [cmd, "--mcp"], "enabled": false });
    assert_eq!(classify_opencode(Some(&disabled), cmd), TargetState::Stale);
    assert_eq!(classify_opencode(None, cmd), TargetState::Missing);
}

#[test]
fn upsert_keeps_other_servers_and_refuses_odd_shapes() {
    let doc = json!({ "theme": "dark", "mcpServers": { "other": { "command": "x" } } });
    let out = upsert_server(doc, &["mcpServers"], "terax", stdio_entry("/t")).unwrap();
    assert_eq!(out["theme"], "dark");
    assert_eq!(out["mcpServers"]["other"]["command"], "x");
    assert_eq!(out["mcpServers"]["terax"]["command"], "/t");
    assert_eq!(out.as_object().unwrap().len(), 2);

    let fresh = upsert_server(Value::Null, &["mcp"], "terax", opencode_entry("/t")).unwrap();
    assert_eq!(fresh["mcp"]["terax"]["type"], "local");

    assert!(upsert_server(json!([1]), &["mcp"], "terax", json!({})).is_err());
    assert!(upsert_server(json!({ "mcp": 3 }), &["mcp"], "terax", json!({})).is_err());
}

/// Drives the real agent CLIs against a throwaway HOME:
/// `cargo test --lib live_configure_in_a_temp_home -- --ignored --nocapture`.
#[test]
#[ignore = "runs the installed agent CLIs"]
fn live_configure_in_a_temp_home() {
    // Resolve the login PATH while HOME is still the real one.
    let _ = crate::modules::agent_cli::resolve_bin("sh");
    let home = tempfile::tempdir().unwrap();
    std::env::set_var("HOME", home.path());
    std::env::remove_var("XDG_CONFIG_HOME");
    std::env::remove_var("CLAUDE_CONFIG_DIR");
    std::env::remove_var("CODEX_HOME");

    let before = super::config::collect_status().unwrap();
    println!("before: {before:#?}");
    let after = super::config::configure_all().unwrap();
    println!("after: {after:#?}");
    for t in &after.targets {
        assert!(
            matches!(t.state, TargetState::Current | TargetState::NotInstalled),
            "{} ended {:?}: {:?}",
            t.id,
            t.state,
            t.detail
        );
    }
    let again = super::config::configure_all().unwrap();
    assert_eq!(
        format!("{:?}", again.targets.iter().map(|t| t.state).collect::<Vec<_>>()),
        format!("{:?}", after.targets.iter().map(|t| t.state).collect::<Vec<_>>()),
    );
}
