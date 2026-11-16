# Terax Development Gotchas

This catalog contains verified, reusable constraints for extending Terax. It is organized by trigger rather than discovery date. Temporary evidence and hypotheses belong in the implementation journal, not here.

## Entry Standard

Every durable entry should state:

- **Trigger:** when the constraint applies.
- **Failure mode:** what goes wrong if it is missed.
- **Prevention:** the preferred implementation rule.
- **Verification:** how to prove the rule was respected.

Merge overlapping entries. Rewrite stale entries instead of appending corrections beneath them. Do not include credentials, tokens, process IDs, local usernames, temporary paths, branch names, or commit hashes.

## Cross-Layer Change Matrix

For each implementation, mark every row as affected, not applicable, or deferred with explicit user approval.

- **Model:** tagged unions, domain types, defaults, validators.
- **Mutation:** public state transition or hook API.
- **UI:** rendering, controls, active/inactive states, empty/error states.
- **Transformation:** conversion between related tab or view types.
- **Persistence:** serialization, hydration, legacy data, corrupt data.
- **Settings:** schema, defaults, store synchronization, UI.
- **Shortcut:** registry metadata, default key, handler, override UI.
- **Semantic command:** ID, payload, registry, errors.
- **Observation:** structured snapshot and privacy redaction.
- **Native bridge:** Rust allowlist, event delivery, framing and timeout behavior.
- **Pi package:** command schema, allowlist, extension tests, docs.
- **End to end:** successful action, reset, invalid input, missing target, no mutation.
- **Visual QA:** exact window identity, interaction, screenshot or video, verdict.
- **Accessibility:** role, keyboard, focus, label, selected and status state.
- **Documentation:** product use, protocol, security and maintenance notes.

A row is complete only when implementation and verification evidence both exist.

## Isolation and Git

### Verify the base, then re-verify it before relying on it

- **Trigger:** a feature depends on previous integration work, or branches from a shared integration branch (for example `develop`) that other work keeps merging into.
- **Failure mode:** two variants. The branch starts from a nearby branch that lacks required APIs, causing duplicate implementations or misleading failures. Or it starts correctly and the base later fast-forwards to include prerequisites, so the worktree silently lacks them and integration or QA behaves as if the feature were missing.
- **Prevention:** record the base branch and commit after checking cleanliness and recent history; never create from an uncommitted prerequisite tree. Re-read the base tip before relying on it, and rebase onto the current base once required work has landed there — after confirming a clean tree and user approval for history changes.
- **Verification:** `git merge-base --is-ancestor <required-commit> HEAD` succeeds, and the journal records `git rev-parse HEAD` for the base actually used.

### Keep all commands inside the worktree

- **Trigger:** a sibling worktree is used for an experiment.
- **Failure mode:** edits, generated artifacts, or tests affect the main checkout and invalidate isolation.
- **Prevention:** use absolute worktree paths or set the working directory on every tool call. Record both branch and path.
- **Verification:** `git status --short --branch` is checked in both the worktree and main checkout before finalization.

### Permission does not propagate across Git actions

- **Trigger:** the user authorizes one of commit, merge, push, or cleanup.
- **Failure mode:** a local reviewable experiment is published or deleted unexpectedly.
- **Prevention:** treat commit, merge, push, worktree removal, and branch deletion as separate actions.
- **Verification:** final report lists each action and whether it occurred.

## State and Persistence

### New fields must survive every restoration path

- **Trigger:** adding optional metadata to tabs, spaces, settings, sessions, or other restored entities.
- **Failure mode:** behavior works during the current process but disappears after workspace or app restore.
- **Prevention:** update runtime types, serializers, hydrated types, hydration logic, and transformation paths together.
- **Verification:** round-trip tests cover every persisted variant and a real restart or restore is exercised when practical.

### Hydration is an untrusted boundary, and migration runs before validation

- **Trigger:** reading optional values from an older or user-editable store, or promoting a field to required in a persisted domain type (an agent, kind, or version discriminator).
- **Failure mode:** casts admit arbitrary values into closed domain types, producing broken UI or unsafe style data. Conversely, a newly required field makes every entry written by an older build fail the type guard and be dropped, so the user silently loses stored data on the first launch of the new build.
- **Prevention:** validate with the public domain predicate and ignore invalid optional values while preserving the rest of the entry. Migrate the raw record *before* validating it: fill only absent fields with the documented legacy default, and keep rejecting records carrying a value the current build does not accept.
- **Verification:** tests cover valid, absent, legacy, invalid-string, and non-string values, plus a record with the new field deleted (kept, defaulted) and one with an unsupported value (dropped).

### Transformations can silently drop metadata

- **Trigger:** switching a tab or document between rendered and editable representations, or converting one tagged-union variant to another.
- **Failure mode:** title, color, dirty state, or other optional metadata vanishes even though persistence tests pass.
- **Prevention:** enumerate preserved fields explicitly and add bidirectional transformation tests.
- **Verification:** toggle or conversion tests assert all intended metadata before and after both directions.

## Commands and the Pi Bridge

### The semantic registry is the contract

- **Trigger:** adding an action that can be invoked from the command palette, shortcuts, or Pi.
- **Failure mode:** presentation code becomes an unstable external API or bypasses domain validation.
- **Prevention:** define one typed semantic command and route every presentation surface to it or to the same domain mutation.
- **Verification:** registry tests exercise typed payloads and normalized errors without depending on palette labels.

### Exposing a command is one atomic change across every layer and every exact-list test

- **Trigger:** adding a semantic command, a shortcut, or a shortcut group.
- **Failure mode:** frontend unit tests pass while Rust or the Pi client rejects the ID. Or the feature works at runtime but a test asserting a whole registered list fails, or a settings section silently omits the item.
- **Prevention:** one change must cover the id union, payload map, schema, handler contract, validation, dispatch, the App handler, the Rust allowlist, the Pi package allowlist/schema, extension tests, the E2E harness and docs — plus the exact-list assertions in the registry tests (the command-id list and the Pi allowlist list). A new shortcut group must be added to both the group union and the ordered groups array that drives settings render order.
- **Verification:** run the registry and settings tests, not only type-checking; then invoke the command through the installed Pi client and authenticated native bridge, not directly against the React handler, and confirm the new item renders where it is listed.

### The compiled bridge artifact must ship with the app

- **Trigger:** changing `packages/pi-terax/src` (for example allowlisting a new command) and then building or releasing the app.
- **Failure mode:** `packages/pi-terax/dist` is git-ignored and built only on demand; a running Pi session loads a stale `dist`, so `terax_call` rejects a command whose source, Rust allowlist and registry are all correct. The extension version also drifts from the app version.
- **Prevention:** the root `build` script runs `build:ext` before the frontend build, so `beforeBuildCommand`/`build:version`/`release:local` always recompile the extension; `set-version.mjs` bumps `packages/pi-terax/package.json` in lockstep. After building, restart the Pi session — the `terax_call` tool schema is snapshotted at Pi startup.
- **Verification:** delete `packages/pi-terax/dist/commands.js`, run `pnpm build`, and confirm it is regenerated with the current command list; `scripts/set-version.test.mjs` asserts the lockstep version bump.

### Distributed extensions must carry runtime deps in `dependencies`

- **Trigger:** shipping the Pi extension outside the monorepo (git source, npm, or a release-asset tarball) so Pi installs it standalone.
- **Failure mode:** Pi installs git/tarball extensions with `npm install --omit=dev`, skipping `devDependencies` and `peerDependencies`; a runtime import declared only as a peer/dev dep (e.g. `typebox`) is absent in the installed clone and the extension throws on load. Pi also has no source type for GitHub release assets, so a release `.tgz` is not auto-consumed.
- **Prevention:** harden the published manifest (`scripts/publish-extension.mjs` / `pi-extension-lib.mjs`): promote every non-host runtime dep into `dependencies`, keep only host-provided packages (`@earendil-works/pi-coding-agent`) as peers, drop dev scripts/deps. Deliver release-asset extensions through a Terax-driven install into a local path Pi loads.
- **Verification:** `scripts/pi-extension-lib.test.mjs` asserts the hardened manifest; `node scripts/publish-extension.mjs <v> --no-upload --out-dir <dir>` then `tar tzf` confirms `dependencies.typebox` and the `pi` contract are present in the packed `package.json`.

### Numeric ids must have the same JSON type on both sides of `invoke`

- **Trigger:** a Tauri command returns or accepts an id, offset, port or count (for example a background job id typed `u32` in Rust).
- **Failure mode:** the TypeScript wrapper declares it as `string` (or passes a numeric string), everything type-checks and lints clean, and the call fails at runtime inside Tauri's argument deserializer with an opaque message. Nothing in the frontend build catches it, because the boundary is JSON, not types.
- **Prevention:** mirror the Rust type exactly in the `invoke<T>()` wrapper and in the command payload: an integer stays a number end to end, and only the display layer formats it. Keep every wrapper for one Rust module in a single typed `native.ts` so the mapping is reviewable in one place.
- **Verification:** call the command once from the running app (or an integration test) with a real id and assert the returned value's `typeof`, rather than trusting the declared type.

### Rejection must be side-effect free

- **Trigger:** invalid enum values, malformed payloads, or nonexistent target IDs.
- **Failure mode:** a command reports an error after partially changing state.
- **Prevention:** validate all payload fields and resolve the target before mutation.
- **Verification:** snapshot before rejection and snapshot after rejection are equivalent for the affected state.

### Tool payload schemas must be described objects, not Type.Any

- **Trigger:** exposing a Pi tool that forwards a free-form `payload` to a command (for example `terax_call`).
- **Failure mode:** `Type.Any()`/`Type.Unknown()` compile to an empty JSON schema `{}`; host argument sanitizers drop the value, so the command receives `null` and rejects with "requires an object payload" even though the client, bridge, and registry are correct.
- **Prevention:** describe the payload as a typed object (`Type.Object({}, { additionalProperties: true })`) so nested fields survive transport, and provide a read command (for example `app.commands`) that reports the exact per-command fields and enum values.
- **Verification:** assert the built tool schema exposes `payload.type === "object"` with `additionalProperties: true`; confirm a real payload reaches the registry by calling the authenticated bridge directly.

### Closed values beat arbitrary presentation input

- **Trigger:** a remote command selects a visual style, mode, layout, or behavior.
- **Failure mode:** arbitrary CSS, script-like strings, unsupported values, or forward-incompatible data reaches rendering code.
- **Prevention:** use a typed closed palette or enum and validate it at every external and persisted boundary.
- **Verification:** all allowed values pass; representative unknown, differently cased, empty, and non-string values fail.

### Command payloads must fit the schema's param types

- **Trigger:** exposing a command whose natural payload is a nested object, such as a recurrence rule or a structured filter.
- **Failure mode:** `CommandParamSchema` supports only `string`, `integer`, `boolean` and `enum`, so a nested object cannot be described. An undescribed payload is invisible to `app.commands`, which is how a caller discovers how to use the command.
- **Prevention:** give the structure a compact, parseable textual form and accept that single string, with a pure parser and formatter that round-trip. The parser doubles as the validator: reject anything it cannot parse rather than guessing. Document every accepted form in the param description.
- **Verification:** round-trip every supported form through parse and format, assert malformed specs are rejected, and assert each documented form is accepted by the real command validator.

## Timers and Background Work

### `tokio` here has no `time` feature, so `tokio::time` does not compile

- **Trigger:** adding any native timer, delay, or timeout in `src-tauri`.
- **Failure mode:** `tokio::time::sleep`/`interval`/`timeout` fail to compile. `Cargo.toml` declares `tokio` with `default-features = false, features = ["rt"]` to keep the bundle small; enabling `time` just to sleep widens the dependency for no product gain.
- **Prevention:** park a dedicated `std::thread` on `Condvar::wait_timeout` — no new dependency, no busy-loop, re-armable the instant state changes, zero cost when nothing is scheduled. Cap each wait hop (a minute is ample) so a suspended machine or clock adjustment re-evaluates the deadline instead of overshooting.
- **Verification:** unit-test the pure wait computation for the idle, overdue, near-deadline, and capped-long-wait cases; then confirm on a running app that the event fires unattended at the expected instant.

### A webview timer cannot be trusted to fire on time

- **Trigger:** any feature that must act at a wall-clock instant, such as a scheduler, poller, or reminder.
- **Failure mode:** `setTimeout`/`setInterval` are throttled and coalesced while the window is backgrounded or occluded (WKWebView on macOS, Chromium elsewhere), so the action lands late or not at all. The bug is invisible in a focused dev window.
- **Prevention:** keep the schedule maths in the frontend domain, where it is pure and testable, but let Rust own the clock: hand it one absolute deadline and have it emit an event. The frontend decides what is due; the native side only sleeps and knocks. Use a coarse UI interval purely to refresh countdown text.
- **Verification:** background the window and confirm the action still fires at its instant; assert the native side is the only component holding the deadline.

## Synthesized Terminal Input

### A prompt and its submitting Enter must be separate writes

- **Trigger:** typing text into a TUI running in a PTY (for example sending a prompt to a coding agent already running in a tab).
- **Failure mode:** two distinct bugs. A raw `\n` between lines submits the text truncated at the first line break. And when the whole payload including a trailing carriage return arrives as one burst, the TUI reads it as a paste and leaves it in the composer unsent — which looks like the feature silently doing nothing.
- **Prevention:** join lines with the Shift+Enter sequence the foreground program negotiated (`terminal/lib/keyboardProtocol.ts`: `CSI 27;2;13~` once modifyOtherKeys is active, `ESC CR` otherwise), never a raw newline. Return the body without a trailing carriage return, then write the submitting `\r` in a separate, slightly later write. Allow the program time to boot before typing.
- **Verification:** capture the pane and confirm both that the prompt shows as multiple lines and that the program actually answered. A screenshot of text in the composer is not proof it was sent.

## Scheduled Background Invocation

### An OS-scheduled invocation must be cheap and must not start a second app

- **Trigger:** registering a LaunchAgent, systemd user timer, or Task Scheduler task that runs the app binary on a cadence.
- **Failure mode:** running the binary while an instance is alive starts a second one (see the discovery-file entry above), and launching a GUI on a cadence puts a window in the user's face for nothing.
- **Prevention:** handle the flag before building the app and exit early. Ping the running instance over the existing authenticated bridge rather than inventing a second IPC path, and treat only an explicit `ok` as confirmation. With no instance, read the small state file the app exports with its next deadline and exit unless something is overdue; boot minimized when it really is. Keep the guard scoped to the scheduled flag so ordinary launches are unchanged.
- **Verification:** time the invocation with an instance alive, with a stale discovery file, and with a future and a past deadline — a stale file must degrade to the file check rather than hang. Confirm no extra process appears, and note that a process matcher anchored on the binary name stops matching once the flag is appended.

### Prove the generated unit by registering it, not by reading it

- **Trigger:** generating a launchd plist, a systemd unit, or a Task Scheduler XML.
- **Failure mode:** the text looks right, the platform rejects it or silently never fires, and the feature appears to work until someone waits for a real trigger.
- **Prevention:** generate the unit from the same pure function the product uses, point it at a throwaway script, register it at a one-minute cadence, and wait for a real firing. Validate the file first where the platform offers it, for example `plutil -lint`. Always unregister and delete afterwards.
- **Verification:** the platform's own view confirms the registration and cadence, the script's log shows it fired with the expected arguments, and the exit code is zero. Then confirm it is gone.

### Machine wake is privileged almost everywhere

- **Trigger:** promising that a scheduled task will wake a sleeping computer.
- **Failure mode:** the promise is only keepable on Windows. `pmset schedule` refuses without root, and a systemd user timer may not set `WakeSystem` because it needs `CAP_WAKE_ALARM`, so the unit fails to start rather than degrading.
- **Prevention:** advertise the capability per platform and let the UI say plainly that elsewhere the task runs on the next wake. Never request a privileged wake from an unprivileged unit.
- **Verification:** assert the capability flag matches the target platform, and assert the generated user unit does not contain the privileged key.

## Native Networking

### The AI-proxy HTTP client blocks cross-host redirects

- **Trigger:** adding a native `reqwest` fetch/download in `src-tauri/src/modules/net.rs` that reuses `build_safe_client`.
- **Failure mode:** the request fails silently on any endpoint that redirects to a different host (a GitHub release URL redirecting `github.com` -> `*.githubusercontent.com`, or any CDN hand-off), because `build_safe_client`'s SSRF policy pins to one host's resolved IPs and blocks cross-host redirects by design.
- **Prevention:** build a purpose-specific download client whose redirect policy follows only `https` and only an explicit host allowlist (e.g. `github.com` plus `*.githubusercontent.com`); derive the saved filename from the original URL, not the redirect target, and reject path separators and `..`.
- **Verification:** exercise the real endpoint (a temporary, uncommitted integration test that downloads the actual asset confirms the redirect is followed and the full body arrives), plus unit tests for the host allowlist and filename guard.

## Local Sidecars and Python Runtimes

### espeak-ng aborts the process when its data path is too long

- **Trigger:** driving espeak-ng (through `phonemizer-fork` / `espeakng-loader`, as the Kokoro adapter does) from a directory inside the app's local data dir.
- **Failure mode:** espeak-ng caps its data path at 159 characters and does not report an error: it aborts the process. The sidecar dies mid-request with no Python traceback, which reads like a crash in the model rather than a path-length limit.
- **Prevention:** copy the espeak data into a short path under the private root (`<root>/tmp`) and point `EspeakWrapper.set_data_path` at the copy; give every child process a `TMPDIR` inside that same short root so nothing derives a longer path at runtime. Keep the private root itself short.
- **Verification:** synthesize one Spanish sentence (the language that needs G2P) from a deeply nested install path and confirm the sidecar survives and returns audio.

### `uv` writes outside its install dir unless told not to

- **Trigger:** bootstrapping a private Python with `uv python install`.
- **Failure mode:** `uv` drops a `python` shim into `~/.local/bin`, which is a mutation of the user's machine the feature promised not to make, and a user-level `uv.toml` can redirect the package index so the pinned requirements resolve from somewhere unexpected.
- **Prevention:** pass `--no-bin` (or `UV_PYTHON_INSTALL_BIN=0`) and `--no-config` on every `uv` invocation, and set `UV_PYTHON_INSTALL_DIR`, `UV_CACHE_DIR` and `HF_HOME` into the private root. Sanitize the child environment: keep `PATH`, `HOME` and the explicit `UV_*`/`HF_*` variables, drop `PYTHONPATH`, `VIRTUAL_ENV`, `CONDA_*` and `PIP_*`.
- **Verification:** install into a scratch root and confirm `~/.local/bin` gained nothing and the private root holds the interpreter; re-run with a hostile `uv.toml` in place and confirm the resolved index is unchanged.

### A model that pip-installs at first use raises `SystemExit` in a handler thread

- **Trigger:** a Python dependency that fetches something on demand at first use (misaki downloads a spaCy model through pip the first time it phonemizes English).
- **Failure mode:** the download runs inside the uv-managed virtual environment where pip is not the installer of record, fails, and calls `sys.exit`, which raises `SystemExit`. `SystemExit` is not an `Exception`, so an `except Exception` handler does not catch it and the request thread dies without a response.
- **Prevention:** pin the model wheel in the engine's requirements so nothing is fetched at request time, and catch `SystemExit` (or `BaseException` narrowed deliberately) in the request handler so a library that exits becomes a 500 with a message instead of a hung connection.
- **Verification:** run the first English synthesis in a fresh venv with the network blocked and confirm the handler answers with an error instead of hanging.

### An engine that prints to stdout corrupts the sidecar handshake

- **Trigger:** a sidecar whose parent reads a single ready line from the child's stdout, wrapping libraries that log freely (torch, transformers, huggingface_hub progress bars).
- **Failure mode:** a library banner lands on stdout before or after the ready line, so the parent's line parse fails or reads a banner as the handshake, and the start times out with no useful log.
- **Prevention:** print the one ready line (`{"ready":true,"port":N}`), flush it, then rebind `sys.stdout` to `sys.stderr` for the rest of the process so every later print is captured as a log without touching the protocol channel.
- **Verification:** start the sidecar with a library that prints a banner and confirm the parent still parses the ready line and the banner shows up in the log file.

### Killing a child without reaping it leaves a zombie for the app's lifetime

- **Trigger:** stopping a spawned sidecar on Unix, whether from a stop command, a drop implementation or app exit.
- **Failure mode:** `kill` only sends the signal. Without a `wait`, the child stays a zombie in the process table for as long as the app lives, so repeated start and stop cycles accumulate defunct processes and the app looks like it leaks processes.
- **Prevention:** kill and then wait for the child in the same path, including the `Drop` implementation, and treat an already-exited child as success.
- **Verification:** start and stop an engine several times and confirm no defunct child of the app remains.

### HTTP keep-alive with an unread request body corrupts the next request

- **Trigger:** a small standard-library HTTP server that answers a request with an error before reading the body (a 400 on a bad payload, a 401 on a bad token).
- **Failure mode:** the unread body stays in the socket buffer, and with HTTP/1.1 keep-alive the next request on that connection starts parsing at the leftover bytes. The following request fails with a nonsense parse error that looks unrelated to the request that caused it.
- **Prevention:** either drain the body before answering, or close the connection on every error response (`Connection: close` plus `close_connection = True`). Cap the body size before reading it so a large body cannot be used to stall the server.
- **Verification:** send a rejected request followed immediately by a valid one on the same connection and assert the second answer is correct.

### The bridge's 15 s UI timeout bounds every command, including slow native work

- **Trigger:** exposing a command that starts a process, loads a model, or otherwise runs for tens of seconds (engine start, first synthesis, a large download).
- **Failure mode:** the Pi bridge only waits 15 seconds for the UI to answer, so the caller gets a `timeout` error while the work is still running and succeeds later. Retrying starts the work twice.
- **Prevention:** make such commands return as soon as the work is accepted (`{ starting: true }`, `{ jobId }`, `{ started: true }`), keep the failure path observable through a status command, and let the caller poll. Do not raise the bridge timeout to accommodate slow work.
- **Verification:** call the command on a cold machine and confirm it answers well inside the timeout, and that the status command reports both the in-progress state and the eventual failure message.

## Reading Another Tool's Data

### Read a cooperating tool's own store instead of instrumenting it

- **Trigger:** needing metrics about a process Terax spawned, such as tokens, cost, model, or stop reason from a Pi run.
- **Failure mode:** parsing the child's stdout is brittle, changes with its output format, and misses anything it does not print. Reimplementing the accounting is worse.
- **Prevention:** read the tool's own append-only store. Pi session files (`~/.pi/agent/sessions/<project>/<ts>_<id>.jsonl`) carry a `usage` block per assistant message with `input`, `output`, `cacheRead`, `cacheWrite`, `reasoning`, `totalTokens`, `cost.total`, plus `stopReason` and `model`. Record the file's byte length before dispatching and read forward afterwards so figures describe that one trigger, not the whole session. Skip unparseable lines — the file is appended live and the tail can be partial.
- **Verification:** run the same task twice and assert the per-trigger figures sum to the accumulated total, and that the session file grew rather than being replaced.

### Expose such a reader by identifier, never by path

- **Trigger:** adding a Tauri command that reads files outside the authorized workspace, for example another tool's state directory.
- **Failure mode:** accepting a path from the webview turns a narrow reader into arbitrary file read, bypassing workspace authorization and the secret deny-list.
- **Prevention:** accept only an identifier, validate it against a conservative character set (alphanumerics plus `-` and `_`, length-bounded), and resolve it yourself inside the one directory the feature owns. Keep the command read-only and bound the bytes it will consume.
- **Verification:** unit-test that traversal, separators, spaces, and shell metacharacters are rejected before the filesystem is touched.

## Snapshots and Privacy

### Snapshots carry coordination state, never content

- **Trigger:** adding any observable field to `app.snapshot` — persisted user-authored content (a prompt, a note body, a message), or anything added for test convenience because Pi needs to verify an action.
- **Failure mode:** the snapshot is ambient context handed to an external caller on every poll, so free text, terminal buffers, diff content, AI approval internals or secrets quietly leave the app forever after.
- **Prevention:** expose only IDs, kinds, selected state, safe labels, schedule, enabled, counters, run state and bounded structural metadata. Expose text through a dedicated command whose call is an explicit request, and build the snapshot from a serializer that *cannot see* the text field rather than deleting it afterwards.
- **Verification:** assert the serialized snapshot string does not contain a distinctive sample of the stored text and that the field is absent from the object rather than merely empty; security review inspects the serialized shape and tests forbidden fields.

### Redact complete private entities

- **Trigger:** adding observable metadata to app snapshots.
- **Failure mode:** terminal text remains hidden but new title, color, cwd, or status fields reveal private-terminal information.
- **Prevention:** branch on privacy before constructing the public snapshot and expose only the minimal private placeholder. Redacting one newly added field is not enough.
- **Verification:** snapshot tests add metadata to a private terminal and assert none of it appears.

## Accessibility and UI

### Parent accessible labels replace descendant announcements

- **Trigger:** setting `aria-label` on a tab or composite control to include new metadata.
- **Failure mode:** screen readers stop announcing descendant dirty, error, or status indicators.
- **Prevention:** construct the complete parent label in a pure helper, including every state previously announced by descendants. Keep unlabelled behavior compatible when no override is needed.
- **Verification:** tests cover title-only, title plus color, dirty plus color, and clean plus color combinations.

### Color cannot be the only signal

- **Trigger:** adding tab colors, status colors, or selection swatches.
- **Failure mode:** the feature is unusable for screen-reader, color-vision, or keyboard-only users.
- **Prevention:** include visible names, semantic selected state, keyboard navigation, and a reset action.
- **Verification:** inspect the accessibility tree and operate the full menu without a pointer.

### Preserve active and inactive readability

- **Trigger:** introducing visual accents on tabs or panels.
- **Failure mode:** active state overwhelms content or inactive state becomes indistinguishable.
- **Prevention:** use restrained accents with deliberate active/inactive opacity and existing theme tokens where possible.
- **Verification:** capture both states across representative light and dark themes or explain the narrower supported scope.

### Two collapsible sibling panels cannot both stay collapsed

- **Trigger:** adding a second collapsible `ResizablePanel` beside an existing one, for example a second dock on the right edge.
- **Failure mode:** collapsing both is impossible. The group must still fill its axis, so the solver re-expands the neighbour and ignores that panel's own `maxSize` while doing it. `collapse()` reports success and the panel visibly stays open at the wrong width.
- **Prevention:** make visibility mount and unmount the panel and its handle rather than collapsing it. Visibility then lives in React state, the hook needs no panel ref to hide, and the solver only ever sees panels that should occupy space.
- **Verification:** exercise all four combinations of the two panels, including neither, and confirm the remaining space goes to the main area rather than to a neighbour that exceeds its maximum.

### Non-wrapping flex children need `min-w-0` or they blow out the container

- **Trigger:** placing a `whitespace-pre`/`overflow-x-auto` block (a code `<pre>`, a long URL, a monospaced command) or any long unbreakable text inside a flex row, especially within a width-capped dialog (`sm:max-w-[440px]`).
- **Failure mode:** a flex item defaults to `min-width: auto` and refuses to shrink below its content width; the long line expands the row past the dialog/panel max-width and sibling buttons and the footer render outside the card. `overflow-x-auto` never engages because the box grew instead of scrolling.
- **Prevention:** add `min-w-0` to the growing flex child (plus `min-w-0` on any intermediate flex column and `shrink-0` on adjacent buttons). **Grid caveat:** `shadcn` `DialogContent` is a CSS `grid`, and a grid item's default `min-width: auto` resolves to min-content, so `min-w-0` must also be on the *direct grid item*, not only the inner `<pre>`. A `flex flex-col` parent hides this because its children are bounded by the container width — hence the same code overflows in a dialog grid but not in a settings column.
- **Verification:** render the longest realistic content (a full release-asset URL on one line) in the narrowest layout (a width-capped dialog) and confirm the box scrolls horizontally while every button and the footer stay inside the card.

### Drag and reorder interactions must use pointer events in WKWebView

- **Trigger:** implementing drag-to-reorder or any custom drag inside the Tauri webview on macOS.
- **Failure mode:** HTML5 drag-and-drop is unreliable in WKWebView — `dragstart` fires (the row grabs and dims) but `dragover`/`drop` never anchor to a target, so nothing reorders. Custom `dataTransfer` MIME types are absent from `dataTransfer.types` during `dragover`, and `getData()` for them is unreliable on `drop`.
- **Prevention:** drive the interaction with pointer events and `setPointerCapture`: capture on `pointerdown` (skipping interactive controls via `closest("button, a, input, textarea, select, [contenteditable=true]")`), start past a small move threshold, resolve the target by comparing the pointer coordinate to each row's `getBoundingClientRect` midpoint, apply on `pointerup`. Mark rows `select-none`/`touch-none` while draggable.
- **Verification:** exercise a reorder in a running WKWebView build; unit-test the pure move/reorder function separately.

## Driving External Agent CLIs

### A bare model pattern can be ambiguous across configured providers

- **Trigger:** offering model presets, or defaulting a model, for a CLI that resolves `--model` as a pattern rather than an exact id.
- **Failure mode:** the pattern matches the same model under several configured providers and the run dies immediately with "is ambiguous across providers". On a single-provider development machine the same preset looks fine, so the failure only appears for users with more than one provider.
- **Prevention:** qualify the preset with its provider (`provider/pattern`), which stays version agnostic while resolving to one model. Keep a custom free-text value available for anything the presets do not cover.
- **Verification:** run one real non-interactive invocation per preset shape and confirm the CLI resolved a model instead of rejecting the pattern.

### Session pinning differs per agent CLI and cannot be assumed

- **Trigger:** launching pi, claude, or codex on behalf of a scheduled or automated run and expecting the same session to continue.
- **Failure mode:** one shared argv shape breaks two of the three. `pi --session-id` creates the session if missing and is idempotent; `claude --session-id <uuid>` requires a UUID and fails with "Session ID is already in use" on the second run, so continuation needs `--resume`; codex mints its own ids with no way to pin one, so the only continuation is `resume --last`, scoped to the directory.
- **Prevention:** declare each CLI's session capability in one module and branch the argv builder on it. Record the session a run actually created, and use that record — not a timestamp or a guess — to decide between creating and resuming.
- **Verification:** unit-test the argv for each agent in both modes and both first-run and resume states, and confirm the flags against the installed CLI's `--help` before encoding them.

## Native and Visual Validation

### Only one Terax dev server can run at a time, across every worktree

- **Trigger:** starting `tauri dev` from a second worktree while another one is already running.
- **Failure mode:** the Vite dev server is pinned to a single port with `strictPort`, so the second run aborts in `beforeDevCommand` and the native build appears to fail for an unrelated reason.
- **Prevention:** check who owns the dev port before starting, and stop the other instance rather than editing the port in a worktree that will be committed.
- **Verification:** the dev log reports the real cause, and the port is confirmed free before the run.

### A pinned `RUSTUP_TOOLCHAIN` in the environment overrides the project toolchain

- **Trigger:** running a native build from an agent session that exports `RUSTUP_TOOLCHAIN`.
- **Failure mode:** cargo resolves an older compiler than the project expects and a dependency refuses to build with a `requires rustc <newer>` error that looks like a dependency problem.
- **Prevention:** run native builds with the variable cleared so the project's own toolchain selection applies.
- **Verification:** the failing command succeeds unchanged once the variable is removed from the environment.

### Two live instances fight over one bridge discovery file

- **Trigger:** iterating on Rust in `tauri dev` (a file change restarts the app), or running `pnpm tauri dev` while a release Terax is open and a Pi session is bridged to it.
- **Failure mode:** both instances share the persisted store and only one owns the single per-user discovery file, so semantic commands quietly land on the instance whose window you are not looking at and evidence stops matching state. After the dev app exits, the file points at a dead process and the release app is unreachable until it is restarted.
- **Prevention:** before trusting an observation, confirm exactly one app process is running. Copy the discovery file before starting a dev instance and restore it after cleanup. When restarting deliberately, kill the previous instance and the dev runner, then wait for a fresh discovery file.
- **Verification:** count the running app processes and compare the discovery file's pid against them; the restored file's pid matches the still-running release process and a bridge call reaches it.

### A dev build shares persisted state with the installed app

- **Trigger:** running `tauri dev` for a feature that persists anything.
- **Failure mode:** the dev instance uses the same bundle identifier, so it reads and writes the real store and the real session directories. Test data created during validation survives into the user's actual app, and destructive experiments are not sandboxed.
- **Prevention:** treat validation data as production data. Name probe records obviously, keep them few, and delete every one when finished, including any artefacts the spawned tool created outside the app's own store.
- **Verification:** after cleanup, read the store back through the app and confirm the collection is empty, and check the external tool's directory for leftovers.

### New native windows must own their geometry and their focus behaviour

- **Trigger:** adding a labeled Tauri window while `tauri-plugin-window-state` is enabled, especially one meant to float beside the main window while the user keeps typing (notes, inspector).
- **Failure mode:** the plugin restores a stale saved size or position for the label, overriding the builder's `inner_size`/position, so the window appears blank, off-screen or at a default size. Opening or reusing it also pulls keyboard focus and interrupts the terminal or editor.
- **Prevention:** exclude the label from the state plugin (`with_denylist(&["<label>"])`) and set explicit on-screen geometry after build (`set_size` then `center`). For floating helpers, build with `focused(false)` and `always_on_top(true)` and never call `set_focus()` on open or reuse.
- **Verification:** open the window on a fresh profile and confirm size and position match the builder, not a previous run; open and reopen it and confirm the main window keeps keyboard focus.

### A close-requested listener needs an explicit destroy, and destroy needs its own capability

- **Trigger:** a secondary window registers `onCloseRequested` (for example to notify the main window when it closes), or the frontend calls `getCurrentWindow().destroy()`.
- **Failure mode:** the native close button and any `close()` emit close-requested but the window never disappears — the default destroy does not run while a listener is attached, so content can reappear elsewhere while the window stays open. And the `destroy()` call is then silently denied, because granting `core:window:allow-close` does not grant destroy.
- **Prevention:** in the handler call `preventDefault()`, run teardown, then `destroy()` explicitly, and add `core:window:allow-destroy` to the window's capability. For an authoritative close initiated from another window, call `destroy()` from Rust — it needs no capability and does not depend on the target window's JS.
- **Verification:** count real windows before and after every close path (native button, in-window dock, other-window dock); the destroy path closes the window with the capability present and fails without it.

### One window owns the state; the others are synced views

- **Trigger:** a panel can be detached into a separate native window while both show the same data.
- **Failure mode:** two windows write the same store, causing lost updates, divergent state, or double persistence.
- **Prevention:** keep the main window as the single source of truth and only writer; the secondary window emits validated, sanitized action events and renders the state pushed to it. Validate every inbound cross-window payload at the boundary.
- **Verification:** mutate from the secondary window and confirm the change round-trips through the owner and its persistence exactly once.

### Prefer in-app capture; never OS screen capture for QA

- **Trigger:** collecting visual evidence during development, especially on macOS.
- **Failure mode:** OS screen capture (for example `screencapture`) triggers a screen-recording permission prompt or firewall block and can include non-Terax content.
- **Prevention:** use the in-app capture command (`app.capture`, DOM rasterization) only. It captures the main webview surface, so a separate native window cannot be captured this way on macOS — validate secondary windows through shared components plus a functional bridge round-trip. `CGWindowListCopyWindowInfo` is metadata-only, needs no screen-recording permission, and is safe for asserting window lifecycle (open/close counts).
- **Verification:** evidence is produced with no screen-recording prompt, and secondary-window behavior is proven by state/round-trip plus window-count checks.

### Classify outcomes by lifecycle evidence, never by exit code

- **Trigger:** a native `cargo run` or packaged app compiles and launches, and later a long-running development app is stopped after tests.
- **Failure mode:** completion is claimed before discovery, authentication, event delivery or React handling works. In the other direction, signal-derived exit codes such as `-15` or `143` from deliberate cleanup are misreported as compilation or feature failures.
- **Prevention:** wait for app readiness, discover the authenticated instance, invoke the command and verify the resulting snapshot. Record lifecycle milestones and whether termination was deliberate; do not infer success *or* failure from the code alone.
- **Verification:** evidence shows compile completion, readiness, test completion and explicit cleanup order, with E2E summary output tied to the tested executable and run.

### Bind visual evidence to authenticated window identity

- **Trigger:** capturing native Terax screenshots or videos from Windows or another desktop OS.
- **Failure mode:** desktop, cursor, another app, or a similarly titled window appears in evidence.
- **Prevention:** bind capture to the authenticated process ID and exact expected Terax window identity. Handle dynamic main-window titles and singleton secondary-window labels explicitly.
- **Verification:** inspect every delivered frame or representative frames and confirm no foreign surface appears.

### Capture privacy is scoped per target and enforced for the whole run

- **Trigger:** adding or changing a capture target, or recording more than one frame.
- **Failure mode:** a target leaks private-terminal information indirectly (tab titles in the tab strip, cwd in the status bar) even though the private pane itself is excluded; or a terminal becomes private *after* the initial guard and leaks into later frames.
- **Prevention:** classify each target by what it can reveal — any private tab blocks whole-window targets (`window`, `tabstrip`); the targeted tab blocks `pane`; an active private tab blocks active-scoped targets (`header`, `sidebar`, `statusbar`, `active-pane`, `overlay`). Run the private-terminal guard throughout capture and delete the entire run if any guard fails.
- **Verification:** with a private terminal open and active, every affected target is rejected over the real bridge and the snapshot is unchanged afterward; tests simulate a mid-recording guard failure and assert evidence removal.

### Cross-environment paths need explicit encoding and normalization

- **Trigger:** WSL starts or discovers a Windows build, especially under a user path containing non-ASCII characters.
- **Failure mode:** source copy, Cargo invocation, discovery parsing, or executable lookup fails despite valid files.
- **Prevention:** use literal-safe Windows commands, UTF-8 decoding, explicit path conversion, and a dedicated Windows target directory. Never assume ASCII usernames or Unix separators.
- **Verification:** exercise at least one path with spaces or non-ASCII characters and confirm discovery identifies the intended executable.

## In-App Rasterization Capture

### Canvas pixels must be composited live, from a readable buffer

- **Trigger:** rendering a DOM clone through SVG foreignObject onto a canvas, and compositing WebGL-backed canvases (the xterm webgl renderer) into that capture.
- **Failure mode:** two causes of the same blank/black region. WebKit rasterizes the SVG before nested data-URL `<img>` content loads, so inlined pixels never appear (Chromium hides this). And `drawImage`/`toDataURL` from a WebGL canvas yields transparent pixels because the drawing buffer is cleared after compositing.
- **Prevention:** never inline canvas pixels into the clone — record each source canvas rect before cloning, strip canvases from the clone, and composite the *live* canvases onto the output 2D canvas after drawing the SVG. Create the WebGL context with `preserveDrawingBuffer` (WebglAddon constructor flag), or register a snapshot provider through the capture module for surfaces that cannot preserve their buffer.
- **Verification:** capture a window containing a running terminal and inspect the PNG for actual glyph pixels, not just chrome; confirm the flag is set where the addon is constructed in the renderer pool.

### Inlining computed styles bakes inherited hiding into every node

- **Trigger:** capturing a surface that is mounted but hidden (inactive tabs use `visibility: hidden` and stay mounted).
- **Failure mode:** `getComputedStyle` reports `visibility: hidden` on every descendant, so inlining styles freezes the hidden state into the clone and overriding the root has no effect. The capture renders blank.
- **Prevention:** when the capture root is hidden, coerce `visibility: hidden` to `visible` during style inlining for the whole subtree.
- **Verification:** capture a hidden mounted pane (open a second tab first) and confirm full content renders.

### Neutralize positioning on the clone root

- **Trigger:** capturing positioned or popper-managed elements (context menus, dialogs, floating overlays).
- **Failure mode:** the element's `transform: translate(...)` or absolute insets are baked into the clone and re-apply inside the capture viewport, shifting content out of frame.
- **Prevention:** the capture viewport already equals the element's bounding rect, so set `transform: none`, `position: static`, and `inset: auto` on the clone root.
- **Verification:** capture an open context menu and confirm the content fills the artifact without offset bands.

### Capture is CPU-bound and can exceed the bridge's UI response timeout

- **Trigger:** requesting a capture while the machine is heavily loaded, for example with several dev servers, a Rust build, or a second app instance running.
- **Failure mode:** every capture request fails with the bridge's `timeout` error, including tiny targets such as the header, which looks exactly like a broken capture path. Rasterizing a retina window is genuinely expensive and the bridge only waits 15 seconds for the UI to answer.
- **Prevention:** treat a blanket capture timeout as an environment symptom first. Check the load average before concluding the feature is at fault, and collect visual evidence when the machine is not saturated. Do not raise the bridge timeout to paper over it.
- **Verification:** reproduce the same failing capture against a build that does not contain the change under test. If both fail, the timeout is environmental and must be reported as a baseline condition, not as a regression.
### Some surfaces are structurally uncapturable

- **Trigger:** capturing a preview tab (or any surface embedding an `<iframe>`), or the pane of a hidden terminal tab with no foreground job.
- **Failure mode:** the artifact shows pane chrome with a blank body, which reads as a broken page. Both causes are structural, not bugs: the DOM clone cannot rasterize another document's content, and the renderer pool releases the canvas slot for idle hidden leaves (the buffer lives serialized in the dormant ring).
- **Prevention:** for hidden terminals, focus the tab (`tab.focus`), capture, then restore focus — never force slot rebinding from the capture path. For preview panes, treat them as functionally verifiable only: prove the embedded app through its own surface (health endpoint, websocket client count, an API round-trip such as an image export) plus the semantic snapshot showing tab id, url and title.
- **Verification:** the focus workaround produces terminal pixels; the snapshot lists the preview tab with the expected url and title and an action routed through the embedded client returns real data. Direct hidden/iframe captures are documented as chrome-only.

## Testing and Review

### Never run a formatter with `--write` over existing files

- **Trigger:** fixing lint or format findings on a file you touched (for example `biome check --write src/app/App.tsx`).
- **Failure mode:** files that are not formatted at baseline get hundreds of lines of unrelated reformatting, which buries the real change and breaks diff review.
- **Prevention:** format only new files. On existing files, apply the edit by hand in the surrounding style, then compare diagnostics with the base branch and require parity rather than zero.
- **Verification:** `git diff --stat` shows only intended files and line counts, and `biome check <changed files>` reports the same findings as the base checkout.

### Visual-QA evidence lands in the Pi project, not in the Terax worktree

- **Trigger:** running `terax_visual_qa` while the Pi session's working directory is a different repository than the Terax checkout under development.
- **Failure mode:** artifacts are written to `<pi-project>/.terax/visual-qa/`, where `.terax/` is usually not ignored, so screenshots and videos appear as untracked files in an unrelated repository and can be committed by accident.
- **Prevention:** after capturing, move the run into the feature worktree's ignored evidence path (`.terax/pi-development/<run>/evidence/`) and remove the directory created in the Pi project.
- **Verification:** `git status --short` is clean of `.terax` in the Pi project, and `git status` in the worktree does not list the evidence because `.terax/pi-development/` is ignored.

### Separate baseline failures from introduced failures

- **Trigger:** a repository-wide lint or test gate already fails on the base branch.
- **Failure mode:** new diagnostics are excused as baseline, or the full gate is falsely reported as passing.
- **Prevention:** capture base output, run focused checks on modified files, and fix every new diagnostic.
- **Verification:** report full-gate status and changed-file status separately with exact counts.

### Independent review must inspect the final diff

- **Trigger:** review finds issues and implementation changes afterward.
- **Failure mode:** the reviewed version is not the version declared ready.
- **Prevention:** rerun affected tests and review the final diff after fixes.
- **Verification:** review evidence identifies the final worktree state, and `git diff --check` passes afterward.

### A Zustand hook rendered to static markup reads the store's initial state

- **Trigger:** asserting a component's markup with `renderToStaticMarkup` after seeding a store with `useSomeStore.setState(...)`.
- **Failure mode:** `useSyncExternalStore` takes the server snapshot on that path, which Zustand serves from `getInitialState`, so the component renders as if the store were empty. The test fails against correct production code, and "fixing" it invites reshaping the component around the test.
- **Prevention:** split the store read from the presentation. Keep the store-connected container thin and export the presentational part as a pure component taking its data as props; assert that. Test the container's projection as a pure function instead.
- **Verification:** the presentational test passes with no store setup at all, and the projection has its own unit test covering the same inputs.

### macOS temp paths need realpath before path equality

- **Trigger:** a test compares a path returned by code that canonicalizes with `realpath` against a path built from `os.tmpdir()`/`mkdtemp`.
- **Failure mode:** on macOS `/var` is a symlink to `/private/var`, so the two paths differ and the assertion fails only on macOS.
- **Prevention:** `realpath` the temporary root before deriving expected paths, or canonicalize both sides before comparing.
- **Verification:** the path-equality test passes on both macOS and Linux.

## Release Packaging

### The Tauri updater has no universal-target fallback

- **Trigger:** shipping a `universal-apple-darwin` macOS build and describing it in `latest.json` with a single `darwin-universal` platform key.
- **Failure mode:** `tauri-plugin-updater` builds its lookup key from the **compile-time** architecture (`darwin-aarch64` or `darwin-x86_64`) and does a plain map lookup with no universal fallback, so every installed Mac client fails with `TargetNotFound` and silently stops updating.
- **Prevention:** a universal build publishes **both** macOS keys, pointing at the same universal archive URL and signature. `updaterKeysFor("darwin-universal")` in `scripts/local-release-lib.mjs` owns that expansion.
- **Verification:** the merged `latest.json` contains `darwin-aarch64` and `darwin-x86_64`; `scripts/local-release.test.mjs` asserts both keys resolve to one asset name.

### A universal target can silently produce a thin binary

- **Trigger:** building with `--target universal-apple-darwin` when one of the two Rust targets is not installed.
- **Failure mode:** a Mac download that only runs natively for half the users, indistinguishable from a correct build by file name or exit code.
- **Prevention:** install `aarch64-apple-darwin` and `x86_64-apple-darwin` before building, then assert the shipped binary is fat.
- **Verification:** `lipo -archs <bundle>/Contents/MacOS/<binary>` reports both `arm64` and `x86_64`. The release workflow and `scripts/release-dev-macos.sh` fail the build when a slice is missing.

### Architecture jargon in download names makes users install the wrong build

- **Trigger:** publishing macOS assets named `_aarch64` and `_x64` side by side.
- **Failure mode:** users download the Intel build onto an Apple Silicon Mac, it runs under Rosetta, and macOS reports the app as "Intel" — which reads as a broken build rather than a wrong download.
- **Prevention:** label user-facing macOS downloads with the hardware names the Apple menu shows (`apple_silicon_intel`, `apple_silicon`, `intel`). Updater keys and the fixed Nix aliases keep Apple's architecture names because those are machine-read contracts.
- **Verification:** `lipo -archs` on the installed bundle, plus the naming tests in `scripts/local-release.test.mjs` and `scripts/release-dev.test.mjs`.

### A temporary version bump must restore every file it wrote, in place

- **Trigger:** bumping the version for a build — either adding a file to `scripts/set-version.mjs`, or rewriting a version with `JSON.parse` + `JSON.stringify`.
- **Failure mode:** a file written but not snapshotted stays dirty after the build, and the next `pnpm release:local` aborts on its clean-tree precondition for an apparently unrelated reason. Separately, re-serializing the document reformats unrelated lines (the formatter keeps short arrays inline, `JSON.stringify` always expands them), so a one-line bump produces a large diff that hides the real change.
- **Prevention:** `set-version.mjs` exports `VERSION_FILES` as the single source of truth and `build-version.mjs` restores exactly that list — never duplicate it. Replace the top-level `"version"` field textually and re-parse to confirm the result.
- **Verification:** `scripts/set-version.test.mjs` fails if `build-version.mjs` hardcodes any versioned path; after a build `git status --porcelain` is empty, and a bump shows one changed line per versioned file in `git diff --stat`.

## Catalog Maintenance

### A compiler PATH guard does not disable dependency source fallback

- **Trigger:** a native dependency falls back from pkg-config discovery to a source build.
- **Failure mode:** the build script may clone sources before invoking the compiler; intermediate package managers may also change PATH. A rejection executable cannot prove that the source path was never entered.
- **Prevention:** enforce explicit source opt-in at entry to the dependency's source-build function, before filesystem or process work. Apply the patched dependency in every Cargo workspace, including smoke consumers. Keep generated bindings and upstream notices intact.
- **Verification:** run the actual build script with failing pkg-config and process spies. Missing or invalid opt-in and source-directory overrides must fail before git or Zig starts. Check lockfile resolution to the local patched dependency. Test the wrapper's separate archive integrity and cache policy too.

At the end of each implementation:

1. Read the run journal's gotcha candidates.
2. Discard environment noise that has no recurrence value.
3. Merge candidates with existing entries when triggers overlap.
4. Promote only lessons with reproduced behavior, tests, or reliable tool evidence.
5. Move universal architecture invariants into `TERAX.md` if every contributor needs them.
6. Add or strengthen regression tests for code invariants.
7. Rewrite or remove entries invalidated by architectural changes.
8. Ensure no entry contains secrets, local identities, temporary paths, branch names, process IDs, or soon-stale results.

A catalog update is complete when each candidate is promoted, merged, deferred with a reason, or discarded, and no two active entries prescribe conflicting actions for the same trigger.

### WKWebView termination can silently restart an unattended benchmark

- **Trigger:** a webview process terminates during an autorun, including memory-limit termination.
- **Failure mode:** the runtime's default reload creates a fresh JavaScript world; refs reset and autorun repeats, overwriting status while a parent runner waits for apparent progress.
- **Prevention:** keep bootstrap ownership and failure state in the native process, persist bounded checkpoints and sample streams, and reject a second bootstrap while preserving the first run's evidence.
- **Verification:** duplicate-bootstrap tests must preserve checkpoints and fail the process; sample logs must survive a missing final report. Confirm actual termination reasons from system evidence instead of inferring them from RSS or a generic JavaScript error.

### Detailed lab reports cross native byte limits when pretty-printed

- Trigger: adding per-frame event histories to bounded native report commands.
- Failure: indentation multiplies payload size; a rejected checkpoint leaves old status, while a rejected final report can leave an idle app waiting for the runner timeout.
- Prevention: serialize compact JSON, check UTF-8 bytes against the unchanged native bound before IPC, bound native-write waits, and persist a small failed status on rejection. Stop further large writes after the first failure.
- Verification: compare compact and indented sizes, preserve ordered events, test multibyte input and hung writes, and inspect final native files after a sustained run.

### Throwing from a Tauri Channel handler can stop later deliveries

- Trigger: an xterm flood exceeds its pending write watermark and `Terminal.write` throws inside `Channel.onmessage`.
- Failure: the installed Channel increments its sequence index after the handler returns, so an escaping exception prevents later messages from reaching the handler. A byte counter can stop far below the fixture length while animation frames continue.
- Prevention: catch parser/write failures at the lab callback boundary, reject the measurement explicitly and close its sessions. Do not silently drop bytes or add an unreported pacing scheme.
- Verification: exercise an actual write overflow with the installed packages and regress the orchestration path so the callback returns normally, the report fails and resources close.

### A post-run drain can contaminate benchmark counters

- Trigger: waiting for asynchronous replies after the benchmark's final draw and timer stop.
- Failure: reading draw counts after the drain includes later cursor redraws outside the measured interval.
- Prevention: freeze interval-based counters with the wall timer and rAF sampler, report drain duration separately, and retain pending/failed reply counts.
- Verification: a regression injects redraws during the drain and checks that they do not increase the benchmark counter; missing replies fail after a bounded wait.

### A locked macOS console can invalidate an unattended webview run

- Trigger: SSH remains usable while the graphical console is locked or unavailable.
- Failure: a native app and its workers can start without establishing valid visible-webview animation/timer evidence. A process-alive check is insufficient.
- Prevention: validate matching console user, completed login and explicit unlock before and during collection. Fail on ambiguous state. Keep any awake assertion process-scoped and bounded; it does not unlock the session. Clean its resources in independent steps so an app-cleanup failure cannot skip assertion cleanup.
- Verification: exercise normalized locked/unlocked/unknown fixtures, parse real IORegistry plist shapes without retaining private fields, and repeat the same binary after an actual unlock. An observed lock alone does not prove the cause of an earlier stall.


### Native generated FFI layouts do not transfer to wasm32

- **Trigger:** reusing generated 64-bit bindings when linking a native C/Zig core into a Rust wasm32 module.
- **Failure:** correct compile-time layout assertions reject pointer-sized structs; disabling them hides an ABI mismatch.
- **Prevention:** regenerate a separate target-specific binding file from the exact pinned headers and original generator, keep native assertions intact and route only the isolated target to the new file. Use an explicit target pkg-config directory and a consistent allocator for terminal and helper objects.
- **Verification:** first observe native ABI assertions reject wasm32. Compare the regenerated size/alignment assertions with the compiled core metadata, then execute create/feed/snapshot/drop and byte-for-byte shared golden checks. Stable smoke-test memory does not establish general leak freedom or Worker performance.


### Batched command profiles must distinguish enqueue from dispatch

- **Trigger:** replacing immediate IPC calls with a microtask or another queue while retaining a command round-trip profile.
- **Failure:** an old pre-call timestamp now marks enqueue, so command percentiles include queue delay and cease to describe the same stage as the control variant.
- **Prevention:** preserve the real draw time, notify each sequence from the actual dispatch path and record queue and draw delay separately. A successful command reply means registration, not native acceptance.
- **Verification:** assert no sent event at enqueue, a per-sequence sent event before the actual invocation, and unchanged callback semantics on the direct path. Cover delayed open ids, rejection, bounded pending work and cleanup without dropping pairs.


### Feeding all bytes does not prove a final frame reached its consumer

- **Trigger:** declaring terminal/benchmark success from producer byte totals and the child's status while frame delivery or a worker can fail.
- **Failure:** a rejected final send leaves receiver counts internally consistent but omits the final screen, and a swallowed thread error can still report exit 0.
- **Prevention:** retain sticky pipeline health, return it from join, require confirmed producer drain and make failure observable before cleanup. Late subscribers and opening ids must see the same failed state. Panic conversion requires an unwind build; an abort profile is a separate acceptance scope.
- **Verification:** reject only the final frame after an accepted initial frame on a real PTY and synthetic bench; both must fail despite child exit 0 or full byte input. Keep the healthy final-frame-before-exit regression. An uncertain Windows reader drain must not count as native Windows success.

### Failure observers can run on the engine thread or during subscription

- **Trigger:** notifying a sticky engine failure, including one recorded before the caller subscribed.
- **Failure:** holding health/exit/registry locks during callbacks can deadlock reentry; synchronously dropping ConPTY on the engine can wait for a reader blocked on that same engine.
- **Prevention:** resolve subscription atomically, invoke outside locks, latch unusable state first and consume the exit callback once. Remove the session, notify failure, then schedule normal teardown away from the engine; cleanup scheduling must not hide the notification. Keep the receiver owned outside the unwind boundary until failure is recorded.
- **Verification:** cover subscription/failure races, late subscription, callback reentry/exception, failure before another PTY byte, rejected deferred credits and pending-open cleanup. Native ConPTY and OS resource-exhaustion cleanup require their own evidence.

### An unlocked macOS console can omit its per-session lock key

- **Trigger:** treating missing `CGSSessionScreenIsLocked` as the only possible source of lock state.
- **Failure:** a valid unlocked console is rejected as unknown, even while the root explicitly reports `IOConsoleLocked=false`.
- **Prevention:** use the root's typed lock boolean for a valid active console when per-session evidence is absent. A true signal wins; absence alone or malformed evidence must never imply unlocked. Preserve UID/login/ambiguity checks.
- **Verification:** cover actual missing-session-key/root-false output, root/session true conflicts, missing or malformed evidence and another user's console. Do not store account names, UUIDs or OS lock timestamps.


### Browser scheduler methods retain their native receiver

- **Trigger:** storing a browser scheduling method as a class property or passing it as a callback.
- **Failure mode:** WebKit rejects a detached `Window.queueMicrotask` call when it is later invoked with the class instance as receiver. Node or an injected unbranded scheduler can pass while real WKWebView fails. A Promise executor converts a thrown schedule call to rejection without cleaning the application's pending queue.
- **Prevention:** wrap native scheduling calls as `task => globalThis.queueMicrotask(task)`. If scheduling throws, invalidate the owner, clear and reject pending work, and suppress retained callbacks and new submissions.
- **Verification:** construct the default scheduler under a branded global function that requires `this === globalThis`; test a scheduler that retains its callback before throwing, then exercise the actual WKWebView path. Invalid measurements stay invalid even if native parsing and exit complete.


### Async terminal adapters must report real operation completion

- **Trigger:** adapting a native engine to a shared session lifecycle, especially an API that starts an asynchronous invoke but returns void.
- **Failure mode:** a resize loop finishes before the native resize, new input overtakes buffered startup input, or a failed initialization leaves its acquired PTY open. A close promise that resolves before a pending open can also hide failed late teardown.
- **Prevention:** require adapters to return the real operation promise. Keep acquisition separate from initialization, serialize/coalesce resize independently of writes, retain the startup input phase through awaited initialization, and share one retirement promise for every acquired resource. Closing waits acquisition and actual retirement; preserve the first cause while reporting cleanup failures separately. Connection initialization is not shell or TUI readiness.
- **Verification:** use deferred invokes on the actual adapter, request another size while the first is pending, type during startup resize, close before acquisition, reject initial resize, and reject late cleanup. Assert input order, no concurrent resize, exactly one resource close and observable failures.


### The pinned formatter size wrapper rejects valid empty output

- **Trigger:** sizing plain terminal text with libghostty-vt 0.2.2 `Formatter.format_len`.
- **Failure mode:** the wrapper assumes the zero-space probe always returns OutOfSpace and maps a valid SUCCESS/0 to InvalidValue. Its general format_buf also loses the required-length field on OutOfSpace. A new empty terminal can therefore fail context reads even though nonempty text works.
- **Prevention:** use Terminal.format_selection_buf with an explicit temporary selection, preserving the required length from the wrapper. Accept only Some(0) as valid empty sizing; preserve None and other errors. Bound the required size before allocating and validate the second result and UTF-8. Do not reinterpret arbitrary InvalidValue as empty output or mutate the user's selection.
- **Verification:** test an empty terminal, Unicode/combining text, history/alternate screen and insufficient space. Re-evaluate this workaround when the dependency pin changes, and retire it once its size wrapper handles empty success correctly.

## Retained terminal cores and process-exit observers

- **Trigger:** a terminal actor outlives the child process so its history remains readable.
- **Failure mode:** storing its owner in the live PTY session destroys history at process exit. A health listener holding its slot strongly forms an ownership cycle; a throwing observer can also skip kill, retirement or exit publication. Blocking shutdown or join from an actor callback can deadlock the actor itself.
- **Prevention:** reserve core ownership separately before spawn; serialize publication against pane close; finish accepted input and release OS writers before retaining a healthy grid. Use weak ownership in health listeners, nonblocking actor stop, off-actor join outside locks, and exception isolation around notification alone. Keep process exit and post-exit core failure separate. Allow retained presentation changes while continuing to reject both new and already queued input after process exit.
- **Verification:** real-PTY final-output/reply and retained-text tests; post-exit fault with one unchanged process exit; slot drop with the real subscription; throwing observers during live failure and finalization; queued-write and post-exit resize regressions. A successful actor join alone does not prove asynchronous OS pseudoconsole disposal.

## Deferred terminal text and agent readiness

- **Trigger:** switching a terminal reader from immediate JS state to a native query.
- **Failure mode:** a Promise is sliced or compared as text; a pending result crosses a pane/privacy change; or a valid empty screen becomes unavailable and prematurely aborts agent startup.
- **Prevention:** await at every consumer, capture and revalidate pane/handle/privacy and managed-agent ownership after await, then redact accepted AI text. Preserve empty text separately from unavailable. Submission confirmation needs both real baseline and current buffers.
- **Verification:** async AI tail slicing, identity/privacy changes during a query, managed-agent reassociation, failed-query handoff, empty-screen-to-banner readiness and unavailable/timeout regressions.

## Native key encoding buffers and admission

- **Trigger:** encoding negotiated keys with the pinned native binding, especially committed text longer than the initial buffer.
- **Failure mode:** its encode_to_vec helper reserves relative to length using a remaining-capacity calculation, so valid text can still fail OutOfSpace. A bounded actor queue alone also leaves an unbounded number of blocking workers waiting to enqueue.
- **Prevention:** use explicit encode, validate the required byte count and resize/retry within a fixed output cap. Reserve per-core RAII admission before worker spawn and keep it through the receipt. Include encode-only requests in the frontend budget and queue. Keep stop independent from the producer gate, and describe receipt timeout scope precisely.
- **Verification:** literal ASCII and Unicode above 128 bytes; FIFO mode negotiation; admission at capacity with drop/error release; encode-only budget, invalid reply and close/exit races. Kitty Enter/Backspace/Tab releases need REPORT_ALL as well as REPORT_EVENTS; empty output is valid and must not trigger fallback input.


### Terminal process ownership must outlive a React pane view

- **Trigger:** splitting, moving or reparenting a terminal leaf, or changing a display preference before a remount.
- **Failure mode:** a mount-owned controller closes a running shell during layout changes; a mount-only engine choice can create both native and legacy owners for one leaf. A persistent owner identity alone also fails to detect a delayed clipboard read crossing respawn.
- **Prevention:** keep process/controller ownership in the logical leaf registry; view cleanup only detaches input and geometry. Consult existing owners before engine choice on remount. Explicit disposal removes the owner; respawn awaits shared sticky retirement. Guard delayed input with process generation/session identity as well as leaf identity. View observer exceptions must not prevent resource cleanup.
- **Verification:** test detach/reattach identity, replacement view cleanup, failed retirement, throwing callbacks and delayed clipboard across respawn. Exercise split/hide/show/close in the real normal window and compare native IDs and live shell PIDs.

### A disposed WebGL context cannot back a replacement renderer

- **Trigger:** hot-reloading a component that owns a renderer whose destructor intentionally loses its GPU context.
- **Failure mode:** React reuses the canvas element, and the replacement renderer reports shader compilation failure on its lost context. Mixing context/hook exports with components also invalidates the refresh boundary and can strand consumers.
- **Prevention:** keep the context/hook in a non-component module and acquire a fresh canvas DOM element with each renderer; cleanup frees GPU resources and removes only that owned canvas. Reattach persistent terminal cores to the new renderer and request full state. Clear prior initialization errors when retrying.
- **Verification:** refresh only the surface component without adding dependencies that force a full webview reload; inspect actual content and unchanged shell PIDs, not just a successful screenshot response.

### Shared-canvas capture needs frozen pane crops

- **Trigger:** rasterizing a pane whose canvas lives outside its DOM subtree, or changing tabs during asynchronous font/image work.
- **Failure mode:** the shared canvas covers DOM dividers, a lost provider silently falls back to a transparent proxy, or a delayed read takes a different tab's pixels. Compositing the crop after the DOM clone also covers native DOM hover/preedit overlays in the artifact, even when those overlays display correctly.
- **Prevention:** exclude the shared source from compositing, provide exact per-pane crop proxies, require valid providers and freeze their data URLs before awaits. Revalidate a requested native pane after capture preparation. Reject unsupported hidden-pane capture clearly; preserve private guards. OS gesture points can differ from capture device pixels; derive gestures from the actual window bounds and scale rather than copying bitmap coordinates.
- **Verification:** regress source exclusion, crop coordinates, unavailable required providers and tab-switch timing; inspect whole-window and pane captures with multiple panes and a visible divider. Restore frozen visible foreground DOM over native pixels, preserving computed visibility and each ancestor overflow clip; bound count/area and deduplicate nested roots. Freeze before any await. Successful interaction or paint mocks alone do not prove captured appearance.


### Shell state is not engine acquisition or arbitrary OSC output

- **Trigger:** native terminals need CWD/readiness or a process is replaced while state delivery is pending.
- **Failure mode:** accepting bare OSC 7 or trusting any printed A/D allows untrusted output to change app CWD. Treating engine open as ready loses restoration input. A late ready message can re-arm global readiness after retirement reset.
- **Prevention:** observe ordered, bounded metadata on the actor and correlate the injected shell's prompt markers per session. A repeated authenticated prompt-end needs its own revision: comments may return a prompt without C/D block metadata. Keep token/command text out of public state and logs; the token is not isolation from a local process that reads its environment. Feed the original bytes to the core unchanged. Block boundaries need the exact authenticated marker terminator within each PTY batch, not its final cursor; preserve all remaining bytes even after metadata failure, then report that failure. Reset readiness on lifecycle transitions and invalidate generation before awaits; ignore late state after closing, exit or failure. Isolate observer errors from teardown.
- **Verification:** fragment/cancel/oversize/opaque-string tests, multiple C/D markers in one batch, tail bytes after metadata failure, real shell script output and actor ordering, deferred open/respawn and post-exit state tests, and actual two-pane CWD plus forged-output rejection. Check native target cfg branches; M2 gates do not compile Windows. Canonicalize temporary directory fixtures before comparing physical shell PWD, per the existing macOS path lesson.


### Native search normalization and overlays must share cell meaning

- **Trigger:** replacing a JS search addon with native history search and frame colors.
- **Failure mode:** non-overlapping Rust matches miss results such as banana/ana; a later ordinary match overwrites active color. Per-character lowercase loses contextual Greek sigma, and viewport-only casing can disagree with a successful full-history search when case-ignorable text continues beyond the viewport. Clearing failed overlays without a full repaint leaves cached colors on unchanged rows.
- **Prevention:** traverse overlapping matches on UTF-8 boundaries and preserve active priority. Normalize joined logical text, retain transformed byte offsets and map through native grapheme/wide cells. Preserve complete logical-line context when sigma casing needs it. Keep search independent from selection and use tracked native endpoints across reflow. Force full repaint after overlay failure. Serialize native queries, coalesce only adjacent incremental text, and bind adapters to process generations.
- **Verification:** failing-then-passing overlap, wrapped Unicode, case expansion, long sigma context, erased-anchor and retained post-exit frame tests; stale replies after close/respawn; full gates and real header shortcuts/history captures on M2. Do not infer full rendering grapheme parity from a successful search.


### Compact search refocus and literal text input

- **Trigger:** Cmd+F when a compact search field is already mounted, or Escape immediately after typing.
- **Failure mode:** opening an already open field does not refocus it, and clearing pendingFocus because its ref exists loses the focus request. A native text-field interaction can also consume a first Escape; assuming a tab title is prompt readiness makes the UI harness wait incorrectly.
- **Prevention:** always focus an existing input and keep pending focus until an absent one mounts. Disable correction/suggestion attributes for literal search. Prove readiness with an explicit public program acknowledgement, and bind each run to fresh markers and authenticated tab/process identity. Before retargeting after simulated typing, verify the known editor value was consumed; the input tool returning is not that acknowledgement. An empty CodeMirror AXValue may contain its known placeholder, so match that known UI state explicitly while keeping nonempty fixture matching exact. Do not attribute internal OS behavior without evidence. Confirm small highlight spans with color-only pixels before treating an image interpretation as a source bug. For Radix modal menus, open/focus the search from onCloseAutoFocus after its FocusScope closes. Closing an already-mounted search must restore editor focus after React commits removal; guard menu-close and search-close restoration by owner/visibility. Use an explicit repeated-focus request for an existing same-block field.
- **Verification:** pre-fix AXTextArea after Cmd+F versus post-fix AXTextField; one Escape returns AXTextArea, then a public shell program writes its acknowledgement. Split tests require distinct PIDs and the unchanged original PID. Use exact inspected captures and remove temporary diagnostics before final gates.

### Native link activation must retain presented, bounded metadata

- **Trigger:** resolving a link asynchronously while PTY output, ownership, CWD or workspace can change.
- **Failure mode:** current core cells resolve a different URI than the user clicked; a clipped suffix becomes another path; stale metadata opens after owner or scope replacement.
- **Prevention:** retain immutable metadata for bounded actually drawn frames and guard activation by generation and source identity. Share unchanged rows and collect metadata in the dirty-row traversal. Preserve clipped provenance across unavailable rows and validate raw token bounds before punctuation cleanup. An unsupported OSC 8 URI must not fall back to its label. Metadata existence is not authorization.
- **Verification:** old-frame URI mutation, eviction, UTF-16/wide-cell ranges, internal gaps and raw clipped-token regressions; deferred source replacement; actual URL, OSC 8, file location and soft-wrap activation.

### Geometry-only redraws need a presentation notification

- **Trigger:** pane position or sub-cell dimensions change without new PTY output.
- **Failure mode:** hit testing is disabled until another frame arrives, even though the renderer already redrew the pane.
- **Prevention:** request markUndrawn with geometry changes and resume hit testing only on onDrawn; preserve the last real frame sequence on a content-free redraw. Block metadata revisions do not version viewport, reflow, alternate-screen state or live endpoints; update their projection on relevant frame/resize changes.
- **Verification:** move a pane with a constant drawn sequence and verify hover/activation resumes. Exercise a small divider move with a static program in the real app.

### React tab mutations cannot depend on eager state updaters

- **Trigger:** a tab operation returns an allocated ID or disposes sessions outside a functional React state setter.
- **Failure mode:** deferred updates return null, fail to activate an editor, or discard earlier queued mutations. Updater replay can duplicate side effects.
- **Prevention:** serialize tab mutations once against a write-through ref and commit replacement values to React. Every tab mutation uses that path; a committed-state effect must not overwrite newer pending ref state. Explicit ref writers still need to commit.
- **Verification:** defer React commits and open two files, reopen the same file, and mutate a tab before opening. Assert IDs, activation, uniqueness and preservation of earlier mutations.

### Editor locations require content, view creation and committed visibility

- **Trigger:** a terminal link or content-search result opens a new or hidden editor with a pending location.
- **Failure mode:** content-ready precedes CodeMirror view creation, leaving the request stranded; focusing a hidden view consumes the location without giving the user keyboard focus. A bridge's optimistic active-ID ref can precede the DOM commit.
- **Prevention:** retain pending locations through readiness and onCreateEditor, using the created view directly. Deliver hidden-editor requests after activation commits; distinguish optimistic and committed IDs. Consume only for the active matching path and clear on close.
- **Verification:** a new editor and a reused hidden editor must each accept a typed/saved public marker at the requested line/column. Test batched tab opening separately; offset-unit tests alone do not prove mounting or focus.

### Primary pointer default can steal hidden-textarea focus

- **Trigger:** native pointerdown focuses the terminal's hidden textarea.
- **Failure mode:** subsequent browser default processing focuses the non-focusable host/body, so clicks appear to work but typing is lost.
- **Prevention:** prevent only the primary pointer default and retain native selection/pointer capture. Activate the leaf during parent pointer capture and preserve keyboard onFocus plus secondary/context-menu handling. A prompt-disabled textarea cannot provide the focus event that previously activated an inactive leaf, and cancelling pointerdown can suppress the compatible mousedown.
- **Verification:** simulate browser default processing after pointerdown, assert textarea focus and untouched secondary default, then click and type in the real app.


### Native block endpoints and row lifetime need separate evidence

- **Trigger:** saving completed output ranges using native tracked references.
- **Failure mode:** an inclusive column-zero endpoint reads the following prompt; empty output reads a prompt as output; a prune fixture assumes requested history bytes imply actual reclamation. Stable row references alone do not guarantee completed cells were never overwritten.
- **Prevention:** distinguish empty output and anchor the last output cell before the prompt. Preserve carriage-return overwrite semantics. Test actual history reclamation, accounting for the native minimum page count, and reject unavailable references without offset fallback. Verify cell overwrite/erase damage before exposing completed output as stable.
- **Verification:** immediate prompt after CRLF and empty output, carriage-return overwrite, reflow, actual reclamation, reset, alternate screen and post-exit reads. Inspect pinned native reference garbage semantics before changing the library or inventing a hash workaround.

### Metadata limits must charge retained allocations

- **Trigger:** bounding native metadata stored in owned strings.
- **Failure mode:** charging only string length accepts short strings with large retained allocations, exceeding the claimed memory bound.
- **Prevention:** charge allocated capacity and entry storage, evict bounded completed entries and reject an oversized live entry. Bound output formatting before allocation and keep it independent from user selection.
- **Verification:** pass a short string with excess reserved capacity, exceed entry/output budgets, and verify no selection mutation.

### Explicit shell modes must override inherited environment

- **Trigger:** spawning a normal or blocks PTY from an environment that already contains mode flags.
- **Failure mode:** the shell hides its prompt while the actor disables blocks; a WSL launch silently loses its explicit mode or inherits a stale forwarded value.
- **Prevention:** clear inherited mode values before applying the explicit option, pass that option to both profile and actor, and remove case/flag variants of the corresponding WSLENV key while preserving unrelated entries. Forward only for an explicit WSL mode.
- **Verification:** builder-only fixtures cover both options without process-global environment mutation, all mode/WSL combinations, mixed-case forwarding flags and empty WSLENV; exercise the actual profile/PTY path on each target OS.


### Asynchronous command acceptance belongs to the draft owner

- **Trigger:** a submit reply arrives after tab retarget, process exit/respawn or a new edit.
- **Failure mode:** a skipped native write resolves as if accepted and clears unsent text; cleanup restores a command already accepted; an identical draft in another leaf is cleared.
- **Prevention:** revalidate owner, process identity, generation and lifecycle after awaiting submission. Settle the owning draft by token and edit revision separately from current-view clearing. Persist edits immediately, notify owner draft changes, and do not write a stale editor value back during cleanup. Invalidate current-view completions on retarget/destruction while still settling a valid owner acceptance. Keep the draft after rejection.
- **Verification:** deferred submit after confirmed enqueue then respawn, independent A/B identical drafts, A-to-other-to-A edits, accepted owner notifications and rejected async editor submissions. Exercise CodeMirror retarget and return through the real native blocks UI before rollout; pure component tests do not establish that combined path.

### A block input mode can hide two different keyboard owners

- **Trigger:** startup, the submit-to-marker gap and a foreground program all display the public running mode.
- **Failure mode:** deriving keyboard permission from that mode alone lets the grid steal prompt input or prevents a newly running program from receiving keys.
- **Prevention:** use authenticated native running/alternate state for direct input, gate key/text/paste commits, disable the helper textarea at the prompt and restore focus to the bound editor. Notify policy changes even if the public mode remains running. Keep selection and pointer behavior available.
- **Verification:** readiness and comment-return revisions, same-mode gap-to-program transition, DOM binding guards for late input, editor focus, ordinary native input and real block-program interaction.

### Block geometry must belong to the frame the user sees

- **Trigger:** asynchronous block projections while output, scrolling, resize or process identity changes.
- **Failure mode:** metadata revisions deduplicate changing geometry, an old projection paints over a new frame, or a reused seq attaches old blocks after respawn.
- **Prevention:** retain bounded immutable projections keyed by frame, force presentation for metadata-only changes and reject unavailable frames without a live-grid fallback. Coalesce to one in-flight plus the latest query, validate rows/text/IDs before rendering, and dispose the projection model on process replacement. Recompute pixel geometry when cell metrics change. A hidden view can discard an in-flight result: re-present the actual drawn sequence on visibility even when the number is unchanged. Bind pointer/key handlers only to the native grid host, while focus ownership includes sibling overlay controls.
- **Verification:** old/new viewport with identical metadata revision, cache count/allocation limits, actual actor frame query after EOF, stale/closed replies, coalescing and layout-only projection tests. Check real scroll/reflow and process replacement when connecting the UI.

### An expired receipt does not cancel an accepted native selection

- **Trigger:** an internal block selection is accepted while the actor is retained, its IPC receiver times out, then a manual selection arrives.
- **Failure mode:** frontend promise ordering is released at timeout; separate actor queues can apply the manual selection first and then overwrite it with the older block selection, disagreeing with the frontend selection snapshot.
- **Prevention:** queue manual selection and block requests under one mutex into one FIFO with shared bounded admission and shutdown rejection. Preserve that arrival order even when a receipt receiver is abandoned. Keep frontend revision guards for late replies.
- **Verification:** hold the actual actor on a credited output frame, enqueue block Select, abandon its receiver, enqueue manual Clear, release the actor and assert final native selection remains empty. Include native post-exit actions and shared quota tests.

### Stable native rows do not prove immutable completed cell content

- **Trigger:** cursor addressing, erase, insert or delete rewrites a completed command range while its native row references remain valid.
- **Failure mode:** copying or selecting the old block returns cells belonging to a later command. An empty range searched as a point reads a later prompt.
- **Prevention:** retain native endpoint references and a bounded canonical unwrapped content digest at completion; revalidate both for explicit reads/actions and visible retirement. The digest is a cell-content guard, not a replacement for reference lifetime. Retire damaged visible metadata without changing the command acceptance revision. Represent a valid empty output as an absent search scope, separately from an unavailable block.
- **Verification:** native overwrite/ED2/DCH/ICH rejection preserves an existing manual selection; retirement does not advance command metadata; Find -> Unicode soft-wrap reflow -> Reveal paints the exact native cells; empty and wide-endpoint output excludes a following prompt.


### Deferred block copy must retain the WebKit user gesture

- **Trigger:** Copy output reads native block text asynchronously before writing the clipboard in WKWebView.
- **Failure mode:** starting write after the read loses the gesture and is rejected; an old owner can publish replaced output or a misleading success toast.
- **Prevention:** begin ClipboardItem/write synchronously with a promised text Blob, validate the bound session before and after reading, and report success only after acknowledged write while still current. Distinguish unavailable output from a valid empty string. Preserve the Linux native clipboard path. Revalidate private-terminal eligibility before attaching an async body to AI chat.
- **Verification:** deferred clipboard and unavailable/stale-owner tests; actual M2 Copy output then paste into the owned editor matches the known Unicode fixture exactly. Primary WebKit reference: https://webkit.org/blog/10855/async-clipboard-api/ .

### A delayed block click must not overtake a newer selection

- **Trigger:** the native pointer-release reply resolves after another pointer press or selection mutation.
- **Failure mode:** the old click selects a block over the user's newer selection.
- **Prevention:** retain the original presented sequence/row, compare both local gesture generation and the shared EngineSession selection revision after release, and reject drag/cancel/modifier cases. Never recover missing presented geometry from live coordinates.
- **Verification:** deferred release regression yields a complete event-loop turn before checking; a few microtasks plus disposal can hide the late callback. The old release must not invoke block selection after the new press.

### UI acknowledgements and current window bounds are authoritative

- **Trigger:** HMR or window state changes the sandbox size while automation reuses a screenshot coordinate; a sent key returns before the shell accepts it.
- **Failure mode:** clicks miss real controls, or an immediate missing-file read is misclassified as a terminal failure.
- **Prevention:** resolve known controls within the authenticated Terax PID and current AX window bounds. Poll the same owned public acknowledgement without resending the command. Verify the actual editor value before retargeting. Read the existing tab capabilities before attempting a split; blocks intentionally retain their single-leaf baseline.
- **Verification:** actual menu/search controls, two independent native block drafts, foreground read reply and separate ordinary split cwd acknowledgements on M2. Capture only Terax surfaces and inspect private-capture rejection without recording private pixels.


### A header anchor must still identify a reserved row

- **Trigger:** a long echoed command wraps across several rows, or a program uses cursor addressing above its own output.
- **Failure mode:** positioning a toolbar at a fixed distance above output overlays a wrapped command. A tracked header reference can also survive after the program writes text into its reserved row, while the output integrity stamp remains valid.
- **Prevention:** capture the native reserved row at authenticated prompt-end, invalidate pending anchors at prompt-start and transfer ownership at authenticated command-start. Retain nullable anchors with each presented snapshot and let native reflow/collection decide their lifetime. Check visible reserved rows for native text before publishing; suppress only an overwritten or unavailable header, without moving it to a guessed row or rejecting intact output.
- **Verification:** native wrapped echo/reflow, missing/unsigned/invalidated prompt and CUP overwrite regressions; client rejects invalid anchors and preserves long multiline metadata. Directly invoking preexec verifies encoding only; exercise an interactive PTY to prove how the shell actually delivers the accepted command.


### Atomic profile replacement needs a unique temporary per writer

- **Trigger:** several panes start while a cached shell profile needs updating.
- **Failure mode:** a shared destination.tmp lets one rename consume another writer's temporary, producing ENOENT and silently disabling shell integration for a pane; overlapping open/write operations can also expose partial contents.
- **Prevention:** share one write-if-changed installer across platform paths. Create a unique temporary in the destination directory, finish writing before atomic persist, and retain RAII cleanup on failure. Preserve the unchanged-file fast path.
- **Verification:** actual two-pane startup exposed the failed rename; concurrent publishers assert every observed target is a complete known profile and no temporary remains. Check failed-publication cleanup and unchanged-file identity. Native Windows path acceptance remains separate from common helper tests.


### Full graphemes need text identity across the frame and atlas

- **Trigger:** the core retains combining marks, variation selectors or ZWJ sequences but the renderer sends only a base scalar.
- **Failure mode:** copied text remains correct while pixels lose accents/emoji composition; caching by a frame-local ID or the first scalar draws another cluster after a partial update. A default UTF-8 decoder can also strip leading U+FEFF.
- **Prevention:** retain the native negotiated cluster boundaries and width. Default compatibility mode can split emoji sequences; programs request DEC mode 2027 for complete Unicode clusters. Do not merge neighboring cells in the renderer. Assert cluster boundaries, not only concatenated row text. Encode exact full clusters in an optional bounded frame-local UTF-8 table and distinguish table tags from scalar cells. Validate flag/ID/padding/scalars and use fatal UTF-8 with BOM preservation. Key the bounded atlas by complete text, face and width; rasterize the full string. Keep ordinary scalar frames identical.
- **Verification:** real-core full/partial fixtures decoded by TypeScript, exact accent/ZWJ/skin-tone/flag text, invalid flag/ID/UTF-8/padding regressions, distinct accent cache keys and device-font rebuild. Mock fillText checks arguments, not real WebKit font pixels; record actual visual acceptance separately.

### Shared atlas capacity recovery must include every active participant

- **Trigger:** valid frames from several panes exceed the shared atlas text or texture budget.
- **Failure mode:** returning glyph0 hides text, and unrestricted reset/full requests can loop. Tracking only visible panes while hidden panes still populate the atlas lets a hidden failure obtain a new first attempt after every visible success.
- **Prevention:** report capacity explicitly, allow bounded automatic recovery per visible participant and renew only after all rebuild fully. A blocked view returns credits without requesting repeated full frames; invalidate presented IDs until actual rendering resumes. Defer hidden glyph work entirely and request full reconstruction on reveal. Explicit Redraw/font changes retry after the working set changes.
- **Verification:** shared text-key exhaustion, two-pane bounded retries, successful epoch renewal, hidden frame/visible rebuild/hidden frame/reveal, and credit/geometry tests. Never treat pure tests as hardware or user-led visual QA.

### Native graphics policy must survive screen initialization and reset

- **Trigger:** a program initializes an alternate screen or sends RIS, then sends Kitty graphics in the same PTY chunk.
- **Failure mode:** the pinned core restores its default screen storage quota after initial configuration. Enforcing a quota only at spawn, or after a whole chunk, leaves an image-processing interval using defaults.
- **Prevention:** use one shared feed for ordinary and blocks terminals. Enforce storage/media/APC limits before and after feeding, and split conservatively after possible APC introducer-final bytes so limits are restored before the native decoder sees image data, including C0/DEL interleaving. Preserve every byte and parser state, including introducers split across calls. Refuse file, temporary-file and shared-memory media.
- **Verification:** query limits and media after primary/alternate/RIS transitions, then send reset plus inline RGBA at every byte boundary and query quota within the native image reply, before final restoration. Preserve the complete engine regression suite. Keep image generations distinct from geometry, and rebuild full pixels after a client loses its cache.

### Native image pixels belong to a bounded cache, not retained frame metadata

- **Trigger:** binary frames carry RGBA uploads and the renderer makes owned copies for context-independent storage.
- **Failure mode:** retaining frame.images also retains the complete incoming IPC buffer, doubling resident pixel memory outside the cache counter. Initializing shaders from rAF can also throw before onDrawn returns credits.
- **Prevention:** validate bounds before copying; retain owned pixel slices and compact placements without upload views. Initialize resources within the guarded frame-apply path. Defer all GPU work during context loss and reconstruct from full native frames; hidden panes release graphic caches.
- **Verification:** mutate an input upload after applying it; retain exact raster pixels, reuse stable generations, replace changed generations, and cover shader failure, hidden/reveal and loss/full recovery. Real WebKit pixels remain a separate acceptance step.

### Image crops must constrain sampling and reject empty render areas

- **Trigger:** a source crop is magnified, or the requested rectangle has an empty intersection with the image.
- **Failure mode:** linear filtering mixes texels outside the requested crop; a zero-area native placement can also produce a packet the client correctly rejects, causing repeated full requests.
- **Prevention:** clamp image lookup to the crop's texel centers and skip zero source/pixel areas before tracking visible placements or image generations. Compare cell/default backgrounds using exact RGB integers, preserving cursor exceptions.
- **Verification:** native empty-intersection and crop/scroll/resize/history/full regressions, one-pixel sampler bounds and exact-background uniforms. Inspect actual crop-edge pixels in WebKit before claiming visual acceptance.

### Terminal clipboard normalization and async ownership need separate guards

- **Trigger:** replace a legacy OSC52 handler with a normalized core callback, or defer a native plugin import before writing clipboard text.
- **Failure mode:** normalized pc loses the clipboard destination, whitespace base64 is rejected, and retired sessions can write after an async import even when ownership was checked before calling the helper.
- **Prevention:** preserve the product decoder and bounded existing framing, and validate ownership immediately before every actual platform write and fallback. Keep tolerant clipboard framing separate from authenticated shell marker acceptance. Represent optional Tauri channels using JavaScriptChannelId on the invoking Webview, rather than Option<Channel<T>>.
- **Verification:** compare shared fixtures against the installed legacy parser and native observer at every UTF8 boundary; block a plugin import, retire the owner, then resolve it and assert zero writes. Test valid shell tokens through tolerant clipboard-only paths. Prove actual system clipboard writes using a public seed and expected values without exposing previous contents.

### Software presentation must bound transient resources and failed draw credits

- **Trigger:** changing a crop aspect ratio, allocating a bitmap, or failing inside nested canvas save/translate/clip while several native panes await display.
- **Failure mode:** sequential width/height writes multiply unrelated dimensions into a much larger transient bitmap; an unregistered allocation escapes deterministic cleanup; unbalanced nested context state corrupts the next pane and an uncaught paint failure holds credits.
- **Prevention:** reduce dimensions before growing, register resources before fallible initialization, balance every canvas state level with finally, and isolate capacity failures per pane. Invalidate presented metadata and return credit with rendered=false; do not restart the PTY. Renew failed capacity on explicit redraw, font and DPR changes.
- **Verification:** opposite thin crop aspect ratios record every allocated area, failed upload releases the new bitmap, paint failure balances state and preserves another pane position, and the real session callback returns credit while input remains usable. Actual software WebKit pixels remain separate acceptance.

### A locked graphical session can masquerade as a broken AX locator

- **Trigger:** a previously valid own-app window locator sees AXApplication elements where AXWindow objects should be.
- **Failure mode:** retrying broad selectors or guessed clicks risks selecting the wrong surface; repeated permission requests do not address the current screen state.
- **Prevention:** inspect the current session lock state separately from AX trust and console ownership. Keep strict own-instance/window guards and wait for an actual unlock when locked.
- **Verification:** M2 reported trusted AX and on-console, but CGSSessionScreenIsLocked=true. No click or GPU preference mutation was attempted. Recheck the same instance after unlock before claiming graphical acceptance.

### Restored commands need caller ownership until the final write

- **Trigger:** readiness or native input encoding waits while a pane is replaced, dismissed, made private or moved to another context.
- **Failure mode:** a leaf ID can be reused, readiness timeout can look successful, and checking only before submit permits an obsolete command after encoding. Marking restore settled before deleting its snapshot can also delete a new capture.
- **Prevention:** capture an internal owner-bound submitter, distinguish timeout from shell readiness, pass caller guards through the last async boundary to pty_write, and await snapshot cleanup before capture resumes.
- **Verification:** deferred read/encoding/write/cleanup tests cover dismiss, private, CWD, space, replacement and empty submission. No new public bridge input or buffer-reading API is required.

### Match existing background composition before changing terminal opacity

- **Trigger:** a native renderer misses the legacy readability improvement when an image background is active.
- **Failure mode:** treating a global image overlay as an image behind the canvas leads to unnecessary alpha/context changes and inconsistent text or inline-image backgrounds.
- **Prevention:** inspect SurfaceLayer and the actual legacy renderer policy first. Share foreground contrast resolution across native backends, preserve exact backgrounds and explicit underlines, retain faint semantics and exclude decorative box/block/Powerline glyphs.
- **Verification:** native cell tests preserve default packed output, invisible and decorative cells, validate adjusted foregrounds and bound the cache; both backends request full refresh without replacing the process. Keep actual WebKit background-preference acceptance distinct from source tests.


## Terminal presentation and native input

### Global shortcut ownership must recognize both terminal input hosts

- **Trigger:** deciding whether an app shortcut should yield to focused terminal input.
- **Failure mode:** checking only the legacy xterm class lets global capture handlers steal native terminal keys before the encoder receives them. Checking the whole native leaf also claims its sibling block draft and action controls.
- **Prevention:** use the shared shortcut context policy for legacy xterm and the native grid host. Preserve selection-dependent actions and explicit Shift overrides without broadening terminal focus to overlays.
- **Verification:** native and legacy cases preserve plain Mod+B and selection-free Mod+J, selected output still opens the selection action, Mod+Shift+B still toggles the explorer, and block drafts/nonterminal targets keep app shortcuts. Exercise actual native Terminal input through the real app.

### Fractional image slices need nonzero scratch surfaces

- **Trigger:** a native image is distributed across terminal placeholder rows.
- **Failure mode:** integer source crops drop slices smaller than one image
  pixel; assigning a fractional crop size to canvas dimensions truncates to zero.
- **Prevention:** preserve bounded fractional source geometry in the frame
  contract, round scratch dimensions up, and scale the whole scratch surface.
  Keep GPU sample bounds ordered for slices smaller than one pixel.
- **Verification:** a one-pixel native virtual image spread across two rows
  yields two half-pixel source slices; GPU/Canvas2D crop invariants and an actual
  native snapshot cover reconstruction and erasure.

### Retained terminal output still needs keyboard focus after process exit

- **Trigger:** a terminal process ends while its native grid remains retained.
- **Failure mode:** disabling the input textarea also disables keyboard copy
  and history navigation over the surviving output.
- **Prevention:** separate focus/selection ownership from permission to write.
  Retained panes stay focusable; PTY input, mouse and focus reports stop at exit.
- **Verification:** exercise selection/copy/history after healthy exit and
  assert that no new PTY write or mouse report is attempted.

### Native selection popups require completion and gesture ownership

- **Trigger:** adapting a synchronous mouseup selection popup to a native terminal actor.
- **Failure mode:** primary pointer cancellation suppresses compatibility mouse events, a zero-delay timer races the actual selection, or a late reply revives dismissed UI and acts on a different selection.
- **Prevention:** propagate the real selection completion promise from pointer release, including block selection. Bind it to session, semantic selection mutation revision, visibility and privacy scope. Keep read-only query/cache sequencing separate: a normal frame refresh can reread unchanged selected text without invalidating the gesture. Invalidate pending popup work on later pointer interaction and revalidate the original text before every action. A stale completion or rejection must not clear a newer popup.
- **Verification:** defer release and block selection, dismiss or retire the owner before completion, deliver older success/failure after a newer popup, change selected text before an action, and retain the legacy/editor path plus healthy exited-pane selection.

### Format complete syntax units

- **Trigger:** formatting inserted regions in a file containing repeated JSX or hook bodies.
- **Failure mode:** selecting a subset of line-diff formatter edits can align repeated blocks across distant regions, drop siblings or duplicate surrounding declarations.
- **Prevention:** format complete syntax units or complete files; never apply selected sequence-matcher opcodes as formatting edits. Review unexpected deletions before running the app.
- **Verification:** typecheck, lint and affected behavior tests after formatting; inspect the complete diff for unchanged sibling views.

### Graph renderer lifetime is separate from document lifetime

- **Trigger:** embedding an engine whose destroy method does not cancel every internal animation timer.
- **Failure mode:** updating a graph can retain old renderer closures or allow a late reply to affect a new document.
- **Prevention:** persist the document outside the renderer; key the sandbox frame by immutable document incarnation, revision and theme. Validate actual frame identity and its session token on replies. Compare both incarnation and revision before source mutation.
- **Verification:** stale revision and close/recreate tests reject writes; the standalone browser check completes layout in two separate frame lifetimes while blocking parent access, network and inline script.
