# Terminal agent notifications

The bell lists notification history. Its badge and header count the unread
rows. The agent monitor still shows live working and waiting states. In a
focused window, events about the active tab are suppressed. Private panes
never publish alerts. An alert about a terminal targets its original pane.

| Provider | Permission request and waiting for input | Turn finished | Error |
| --- | --- | --- | --- |
| Claude Code | Terax installs hooks in Claude Code. Notification and question hooks emit typed OSC 777 attention events. | The Stop hook emits a finished event. | Nonzero shell exit. |
| Codex | TUI approval and question alerts reach the bell when Codex sends an OSC message. The message is preserved. A Terax-format attention adapter can supply a reason. | A TUI turn-complete message or a named Terax-format finished marker. | Nonzero shell exit. |
| Pi | Standard terminal alerts when emitted. The installed Pi-Terax extension does not report approval or question events. | The extension emits a named OSC 777 finished event when the TUI agent settles. | Nonzero shell exit. |
| Copilot CLI | Terminal-owned OSC 777 alerts when enabled and emitted, attributed to the session started by `copilot`. | A CLI completion alert or successful process exit. | Nonzero shell exit. |
| Antigravity | Terminal alerts when emitted, attributed to the session started by `agy`. | A terminal alert when emitted, or successful CLI process exit. | Nonzero shell exit. |
| Grok | Terminal alerts when emitted, attributed to the session started by `grok`. | Successful CLI process exit. | Nonzero shell exit. |

OSC 133 command metadata associates the supported executable names with
their PTY. This requires a shell that supplies the command in its pre-exec
mark. The Bash integration does not supply that metadata. Claude and Pi
hooks can identify their provider even without it. A shell's signed OSC 133
command-end marker carries the exit status. If the PTY closes without that
marker, the status is unknown. An ordinary terminal alert carries its
original title and message, with a provider icon when the provider is known.
Terax does not infer a permission prompt or an in-process error from TUI text.

Codex can select `notification_method = "osc9"` under `[tui]`. In auto mode,
Codex chooses BEL for terminals it does not recognize, and BEL carries no
message. [Codex terminal notification backend](https://github.com/openai/codex/blob/main/codex-rs/tui/src/notifications/mod.rs)

Copilot CLI's `terminalNotifications` option requests OSC 777 on terminals
recognized by Copilot when desktop notifications are enabled. Alerts sent
directly to the OS do not pass through the Terax bell. Copilot hooks expose
additional events, including turn stop and in-process errors. Terax leaves
those hooks to the user's configuration.
[Copilot CLI configuration](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference)
[Copilot hooks](https://docs.github.com/en/copilot/reference/hooks-reference)

Antigravity's `notifications` setting enables its own desktop notifications
and terminal bell. Antigravity and Grok also expose separate hook systems.
Terax does not install or alter hooks for either provider.
[Antigravity CLI settings](https://antigravity.google/docs/cli/reference)
[Antigravity hooks](https://antigravity.google/docs/hooks)
[Grok hooks](https://docs.x.ai/build/features/skills-plugins-marketplaces)

The Rust PTY detector parses signals and the frontend routes them to the bell.
The agent session monitor tracks the active pane and reads supported transcripts
for context such as session names or last replies. Transcript polling does not
send alerts. The same events can go to native notifications through
`src-tauri/src/modules/notify.rs`, with the platform notification plugin as a
fallback.
