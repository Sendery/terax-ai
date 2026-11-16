# Use an installed CLI in the AI composer

Terax can open its AI composer and **Ask Terax** selection action when a supported
CLI is installed, without an SDK API key, subscription connection or local model
endpoint. Supported CLI providers are Claude Code, Codex, Cursor Agent, OpenCode
and Pi. They retain their own authentication, tool loop and permission setting.
Detection establishes that the binary is installed; it does not verify login or
start an agent.

In **Settings > Models > Local CLI agents**, check the Installed badge and choose
the corresponding CLI model as your default, or choose it in the composer model
menu. Terax preserves your selected default and never switches you to a detected
CLI automatically. If an existing default points to an unconfigured provider,
choose the CLI explicitly before sending. No placeholder API key is required.

Missing CLI models remain visible but open Settings when selected. Their picker
trigger reports CLI unavailable. Pi's model list only loads when its installed
provider section is opened. When no CLI is installed and there is no other
configured provider, the existing connect-provider view remains.

Use **Refresh** in the Local CLI agents section after installing or removing a
binary, or to retry a detection failure. It also refreshes the main window through
the existing provider-change notification. Checking and unavailable states are
shown separately from Not installed. The native detector caches the login PATH,
so a change to PATH itself requires restarting Terax; Refresh checks the
directories already known to the running app.

## Cost and lifecycle

Availability lives only in memory, once per webview. It uses the existing binary
lookup at startup after preferences hydrate, on provider/default changes, when
Settings Models mounts, and when the model menu opens. Concurrent requests and
StrictMode mounts share one lookup. Explicit invalidation during an older lookup
waits for a new scan before publishing the result. Unmounted UI consumers receive
no late state updates; the shared cache may finish normally.

There is no interval, background agent, authentication probe or model execution.
The existing native login-shell PATH probe is cached; no new permanent process
is introduced. The bootstrap path imports binary metadata, not CLI runner parsers.
CLI permissions, transcript serialization, model IDs, public commands and SDK
tools are unchanged. API-key, local endpoint and OAuth access keep their existing
behavior.

## Verification

Focused tests cover the credential-free composer gate, unavailable CLI providers,
existing provider paths, preference hydration/default preservation, concurrent
requests, deferred cross-window invalidation, errors/retry and observer disposal.
No CLI, model, authentication check or credential file is used by these tests.
Packaged-app acceptance remains separate: with an already authenticated CLI,
select its model, open the composer and attach a public terminal selection with
Ask Terax. Verify the chosen default and confirm missing CLI entries lead to
Settings. This implementation pass does not execute that UI or a model request.
