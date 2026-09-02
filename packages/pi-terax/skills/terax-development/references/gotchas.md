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

### Verify the base before creating a worktree

- **Trigger:** a feature depends on previous integration work.
- **Failure mode:** the experimental branch starts from a nearby branch that does not contain required APIs, causing duplicate implementations or misleading failures.
- **Prevention:** record the base branch and commit after checking cleanliness and recent history. Do not create from an uncommitted prerequisite tree.
- **Verification:** `git merge-base --is-ancestor <required-commit> HEAD` succeeds where a required commit is known, and the journal records `git rev-parse HEAD`.

### The intended base branch can move after the worktree is created

- **Trigger:** branching from a shared integration branch (for example `develop`) that other work keeps merging into.
- **Failure mode:** the branch is created correctly, but the base later fast-forwards to include prerequisites (for example a capture or visual-QA feature); the worktree silently lacks them and integration or QA behaves as if the feature were missing.
- **Prevention:** re-read the base tip before relying on it. When required work has since landed on the intended base, rebase the feature branch onto the current base after confirming a clean tree and user approval for history changes.
- **Verification:** `git merge-base --is-ancestor <required-commit> HEAD` succeeds after rebasing, and the run journal records the updated base commit.

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

### Hydration is an untrusted boundary

- **Trigger:** reading optional values from an older or user-editable store.
- **Failure mode:** casts admit arbitrary values into closed domain types, producing broken UI or unsafe style data.
- **Prevention:** validate with the public domain predicate. Ignore invalid optional values while preserving the rest of the entry.
- **Verification:** tests include valid, absent, legacy, invalid-string, and non-string values.

### A newly required field must be filled before the hydration guard runs

- **Trigger:** promoting a field to required in a persisted domain type, for example an agent, kind, or version discriminator.
- **Failure mode:** every entry written by an older build fails the type guard and is dropped, so the user silently loses stored data on the first launch of the new build.
- **Prevention:** migrate the raw record before validating it. Fill only absent fields with the documented legacy default, and keep rejecting records that carry a value the current build does not accept.
- **Verification:** tests hydrate a record with the field deleted (kept, defaulted) and a record with an unsupported value (dropped).

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

### Allowlist changes are atomic across layers

- **Trigger:** exposing a new command to Pi.
- **Failure mode:** frontend unit tests pass while Rust or the Pi client rejects the ID.
- **Prevention:** update the frontend registry, Rust allowlist, Pi package allowlist/schema, extension tests, E2E harness, and docs in one change.
- **Verification:** invoke the command through the installed Pi client and authenticated native bridge, not directly against the React handler.

### The compiled bridge artifact must ship with the app

- **Trigger:** changing `packages/pi-terax/src` (for example allowlisting a new command) and then building or releasing the app.
- **Failure mode:** `packages/pi-terax/dist` is git-ignored and only built on demand, and the app build never compiles it; a running Pi session loads a stale `dist`, so `terax_call` rejects a command whose source, Rust allowlist, and registry are all correct. The extension version also drifts from the app version.
- **Prevention:** the root `build` script runs `build:ext` (`pnpm --dir packages/pi-terax build`) before the frontend build, so `beforeBuildCommand`/`build:version`/`release:local` always recompile the extension; `scripts/set-version.mjs` bumps `packages/pi-terax/package.json` in lockstep with the app. After building, restart the Pi session so the freshly compiled `dist` is loaded (the `terax_call` tool schema is snapshotted at Pi startup).
- **Verification:** delete `packages/pi-terax/dist/commands.js`, run `pnpm build`, and confirm it is regenerated with the current command list; `scripts/set-version.test.mjs` asserts the lockstep version bump.

### Distributed extensions must carry runtime deps in `dependencies`

- **Trigger:** shipping the Pi extension outside the monorepo (git source, npm, or a release-asset tarball) so Pi installs it standalone.
- **Failure mode:** Pi installs git/tarball extensions with `npm install --omit=dev`, which skips `devDependencies` and `peerDependencies`; a runtime import declared only as a peer/dev dep (e.g. `typebox`) is absent in the installed clone and the extension throws on load. Pi also has no source type for GitHub release assets, so a `.tgz` uploaded to a release is not auto-consumed by Pi's package manager.
- **Prevention:** harden the published manifest (`scripts/publish-extension.mjs` / `pi-extension-lib.mjs`): promote every non-host runtime dep into `dependencies`, keep only host-provided packages (`@earendil-works/pi-coding-agent`) as peers, and drop dev scripts/deps. Deliver release-asset extensions through a Terax-driven install into a local path that Pi loads, not through Pi's git/npm auto-resolution.
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

### Registered lists carry exact-list tests in more than one place

- **Trigger:** adding a semantic command, a shortcut, or a shortcut group.
- **Failure mode:** the feature works at runtime but a test that asserts a whole registered list (or allowlist) fails, or a settings section silently omits the item.
- **Prevention:** a new command spans the id union, payload map, schema, handler contract, validation, dispatch, the App handler, the Rust allowlist and the Pi package allowlist — plus the exact-list assertions in the registry tests (the command-id list and the Pi allowlist list). A new shortcut group must be added to both the group union and the ordered groups array that drives the settings render order.
- **Verification:** run the registry and settings tests, not only type-checking, and confirm the new item renders where it is listed.

## Timers and Background Work

### `tokio` here has no `time` feature, so `tokio::time` does not compile

- **Trigger:** adding any native timer, delay, or timeout in `src-tauri`.
- **Failure mode:** `tokio::time::sleep`/`interval`/`timeout` fail to compile. `Cargo.toml` declares `tokio` with `default-features = false, features = ["rt"]` to keep the bundle small, and enabling `time` just to sleep widens the dependency for no product gain.
- **Prevention:** park a dedicated `std::thread` on `Condvar::wait_timeout`. It needs no new dependency, never busy-loops, is re-armable the instant state changes, and parks at zero cost when there is nothing scheduled. Cap each wait hop (a minute is ample) so a suspended machine or a clock adjustment re-evaluates the deadline rather than overshooting it.
- **Verification:** unit-test the pure wait computation for the idle, overdue, near-deadline, and capped-long-wait cases; then confirm on a running app that the event fires unattended at the expected instant.

### A webview timer cannot be trusted to fire on time

- **Trigger:** any feature that must act at a wall-clock instant, such as a scheduler, poller, or reminder.
- **Failure mode:** `setTimeout`/`setInterval` are throttled and coalesced while the window is backgrounded or occluded (WKWebView on macOS, Chromium elsewhere), so the action lands late or not at all. The bug is invisible in a focused dev window.
- **Prevention:** keep the schedule maths in the frontend domain, where it is pure and testable, but let Rust own the clock: hand it one absolute deadline and have it emit an event. The frontend decides what is due; the native side only sleeps and knocks. Use a coarse UI interval purely to refresh countdown text.
- **Verification:** background the window and confirm the action still fires at its instant; assert the native side is the only component holding the deadline.

## Synthesized Terminal Input

### A prompt and its submitting Enter must be separate writes

- **Trigger:** typing text into a TUI running in a PTY (for example sending a prompt to a coding agent already running in a tab).
- **Failure mode:** two distinct bugs. A raw `\n` between lines submits the text truncated at the first line break. And when the whole payload including a trailing carriage return arrives as one burst, the TUI reads it as a paste and leaves it sitting in the composer unsent, which looks like the feature silently doing nothing.
- **Prevention:** join lines with the Shift+Enter sequence the foreground program negotiated (`terminal/lib/keyboardProtocol.ts`: `CSI 27;2;13~` once modifyOtherKeys is active, `ESC CR` otherwise) and never a raw newline; return the body without a trailing carriage return, then write the submitting `\r` in a separate, slightly later write. Allow the program time to boot before typing at all.
- **Verification:** capture the pane and confirm both that the prompt shows as multiple lines and that the program actually answered. A screenshot of text in the composer is not proof it was sent.

## Scheduled Background Invocation

### An OS-scheduled invocation must be cheap and must not start a second app

- **Trigger:** registering a LaunchAgent, systemd user timer, or Task Scheduler task that runs the app binary on a cadence.
- **Failure mode:** running the binary while an instance is alive starts a second one. Both share the persisted store and only one owns the bridge discovery file, so state diverges and evidence stops matching. Launching a GUI on a cadence also puts a window in the user's face for nothing.
- **Prevention:** handle the flag before building the app and exit early. Ping the running instance over the existing authenticated bridge instead of inventing a second IPC path, and treat only an explicit `ok` as a confirmation. With no instance, read a small state file the app exports with its next deadline and exit unless something is overdue. Boot minimized when it really is. Keep this guard scoped to the scheduled flag so ordinary launches are unchanged.
- **Verification:** time the invocation with an instance alive, with a stale discovery file, and with a future and a past deadline. A stale discovery file must degrade to the file check rather than hang. Confirm no extra process appears, and note that a process matcher anchored on the binary name will not match once the flag is appended.

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
- **Failure mode:** the request fails silently on any endpoint that redirects to a different host (for example a GitHub release URL redirecting `github.com` -> `*.githubusercontent.com`, or any CDN hand-off), because `build_safe_client`'s SSRF policy pins to one host's resolved IPs and stops cross-host redirects by design.
- **Prevention:** build a purpose-specific client for downloads whose redirect policy follows only `https` and only an explicit host allowlist (e.g. `github.com` plus `*.githubusercontent.com`); derive the saved filename from the original URL, not the redirect target, and reject path separators/`..`.
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
- **Prevention:** read the tool's own append-only store. Pi session files (`~/.pi/agent/sessions/<project>/<ts>_<id>.jsonl`) carry a `usage` block per assistant message with `input`, `output`, `cacheRead`, `cacheWrite`, `reasoning`, `totalTokens` and `cost.total`, plus `stopReason` and `model`. Record the file's byte length before dispatching and read forward afterwards so the figures describe that one trigger rather than the whole session. Skip unparseable lines: the file is appended to live and the tail can be a partial line.
- **Verification:** run the same task twice and assert the per-trigger figures sum to the accumulated total, and that the session file grew rather than being replaced.

### Expose such a reader by identifier, never by path

- **Trigger:** adding a Tauri command that reads files outside the authorized workspace, for example another tool's state directory.
- **Failure mode:** accepting a path from the webview turns a narrow reader into arbitrary file read, bypassing workspace authorization and the secret deny-list.
- **Prevention:** accept only an identifier, validate it against a conservative character set (alphanumerics plus `-` and `_`, length-bounded), and resolve it yourself inside the one directory the feature owns. Keep the command read-only and bound the bytes it will consume.
- **Verification:** unit-test that traversal, separators, spaces, and shell metacharacters are rejected before the filesystem is touched.

## Snapshots and Privacy

### Stored user text is not coordination state

- **Trigger:** adding persisted user-authored content (a prompt, a note body, a message) to a feature that also appears in `app.snapshot`.
- **Failure mode:** the snapshot is ambient context handed to an external caller on every poll, so free text quietly leaves the app forever after.
- **Prevention:** put only coordination state in the snapshot (identity, schedule, enabled, counters, run state) and expose the text through a dedicated command whose call is an explicit request. Build the snapshot from a serializer that cannot see the text field, rather than deleting it afterwards.
- **Verification:** assert the serialized snapshot string does not contain a distinctive sample of the stored text, and that the field is absent from the object rather than merely empty.

### Redact complete private entities

- **Trigger:** adding observable metadata to app snapshots.
- **Failure mode:** terminal text remains hidden but new title, color, cwd, or status fields reveal private-terminal information.
- **Prevention:** branch on privacy before constructing the public snapshot and expose only the minimal private placeholder.
- **Verification:** snapshot tests add metadata to a private terminal and assert none of it appears.

### Snapshots are coordination state, not content extraction

- **Trigger:** Pi needs to verify an action.
- **Failure mode:** terminal buffers, diff content, AI approval internals, or secrets are added for test convenience.
- **Prevention:** expose IDs, kinds, selected state, safe labels, and bounded structural metadata only.
- **Verification:** security review inspects the serialized shape and tests forbidden fields.

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
- **Failure mode:** collapsing both is impossible. The group still has to fill its axis, so the solver re-expands the neighbour and, worse, ignores that panel's own `maxSize` while doing it. The imperative `collapse()` call reports success and the panel visibly stays open at the wrong width.
- **Prevention:** make visibility mount and unmount the panel and its handle rather than collapsing it. Visibility then lives in React state, the hook no longer needs a panel ref to hide, and the solver only ever sees panels that should occupy space.
- **Verification:** exercise all four combinations of the two panels, including neither, and confirm the remaining space goes to the main area rather than to a neighbour that exceeds its maximum.

### Non-wrapping flex children need `min-w-0` or they blow out the container

- **Trigger:** placing a `whitespace-pre`/`overflow-x-auto` block (a code `<pre>`, a long URL, a monospaced command) or any long unbreakable text inside a flex row, especially within a width-capped dialog (`sm:max-w-[440px]`).
- **Failure mode:** a flex item defaults to `min-width: auto`, so it refuses to shrink below its content width; the long line expands the flex row past the dialog/panel max-width, and sibling buttons and the footer render outside the card. `overflow-x-auto` never engages because the box grew instead of scrolling.
- **Prevention:** add `min-w-0` to the growing flex child (and `min-w-0` to any intermediate flex column, `shrink-0` to adjacent buttons). Then `overflow-x-auto` scrolls the content inside its box and the container keeps its intended width. **Grid caveat:** `shadcn` `DialogContent` is a CSS `grid`, and a grid item's default `min-width: auto` resolves to its content's min-content, so a long `whitespace-pre` line expands the item past the dialog's `max-w` even when the inner `<pre>` already has `min-w-0` — the `min-w-0` must also be on the direct grid item (the block placed straight inside `DialogContent`). A `flex flex-col` parent does not show this because its children stretch to (are bounded by) the container width, which is why the same code overflows inside a dialog grid but not inside a settings flex column.
- **Verification:** render the longest realistic content (a full release-asset URL on one line) in the narrowest layout (a width-capped dialog) and confirm the box scrolls horizontally while every button and the footer stay inside the card.

### Drag and reorder interactions must use pointer events in WKWebView

- **Trigger:** implementing drag-to-reorder or any custom drag inside the Tauri webview on macOS.
- **Failure mode:** HTML5 drag-and-drop is unreliable in WKWebView — `dragstart` fires (the row can grab and dim) but `dragover`/`drop` never anchor to a target, so nothing reorders. Custom `dataTransfer` MIME types are not exposed in `dataTransfer.types` during `dragover`, and `getData()` for them is unreliable on `drop`.
- **Prevention:** drive the interaction with pointer events and `setPointerCapture`. Capture on `pointerdown` (skip when the target is an interactive control via `closest("button, a, input, textarea, select, [contenteditable=true]")`), start past a small move threshold, resolve the target by comparing the pointer coordinate to each row's `getBoundingClientRect` midpoint, and apply the change on `pointerup`. Mark rows `select-none`/`touch-none` while draggable.
- **Verification:** exercise a reorder in a running WKWebView build; unit-test the pure move/reorder function separately.

## Driving External Agent CLIs

### A bare model pattern can be ambiguous across configured providers

- **Trigger:** offering model presets, or defaulting a model, for a CLI that resolves `--model` as a pattern rather than an exact id.
- **Failure mode:** the pattern matches the same model under several configured providers and the run dies immediately with "is ambiguous across providers". On a single-provider development machine the same preset looks fine, so the failure only appears for users with more than one provider.
- **Prevention:** qualify the preset with its provider (`provider/pattern`), which stays version agnostic while resolving to one model. Keep a custom free-text value available for anything the presets do not cover.
- **Verification:** run one real non-interactive invocation per preset shape and confirm the CLI resolved a model instead of rejecting the pattern.

### Session pinning differs per agent CLI and cannot be assumed

- **Trigger:** launching pi, claude, or codex on behalf of a scheduled or automated run and expecting the same session to continue.
- **Failure mode:** one shared argv shape breaks two of the three. `pi --session-id` creates the session if missing and is idempotent; `claude --session-id <uuid>` requires a UUID and fails with "Session ID is already in use" on the second run, so continuation needs `--resume`; codex mints its own ids and offers no way to pin one, so the only continuation is `resume --last`, scoped to the directory.
- **Prevention:** declare each CLI's session capability in one module and branch the argv builder on it. Record the session a run actually created on the task, and use that record — not a timestamp or a guess — to decide between creating and resuming.
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

### A rebuild can leave the previous app instance running

- **Trigger:** iterating on Rust in `tauri dev`, where a file change restarts the app.
- **Failure mode:** two instances end up alive. Both share the persisted store and only one owns the single bridge discovery file, so semantic commands can quietly land on the instance whose window you are not looking at, and evidence stops matching state.
- **Prevention:** before trusting an observation, confirm exactly one app process is running. When restarting deliberately, kill the previous instance and the dev runner, then wait for a fresh discovery file.
- **Verification:** count the running app processes and compare the discovery file's pid against it.

### A dev build shares persisted state with the installed app

- **Trigger:** running `tauri dev` for a feature that persists anything.
- **Failure mode:** the dev instance uses the same bundle identifier, so it reads and writes the real store and the real session directories. Test data created during validation survives into the user's actual app, and destructive experiments are not sandboxed.
- **Prevention:** treat validation data as production data. Name probe records obviously, keep them few, and delete every one when finished, including any artefacts the spawned tool created outside the app's own store.
- **Verification:** after cleanup, read the store back through the app and confirm the collection is empty, and check the external tool's directory for leftovers.

### New native windows must own their geometry

- **Trigger:** adding a labeled Tauri window while `tauri-plugin-window-state` is enabled.
- **Failure mode:** the plugin restores a stale saved size or position for the window label, overriding the builder's `inner_size`/position; the window appears blank, off-screen, or at a default size.
- **Prevention:** exclude the label from the state plugin (`with_denylist(&["<label>"])`) and set an explicit on-screen geometry after build (`set_size` then `center`).
- **Verification:** open the window on a fresh profile and confirm its size and on-screen position match the builder, not a previous run.

### Floating helper windows must not steal focus

- **Trigger:** a window is meant to float beside the main window while the user keeps typing (for example a notes or inspector window).
- **Failure mode:** opening or reusing the window pulls keyboard focus and interrupts the terminal or editor.
- **Prevention:** build with `focused(false)` and `always_on_top(true)`, and never call `set_focus()` on open or reuse.
- **Verification:** open and reopen the window and confirm the main window keeps keyboard focus.

### A window with a close-requested listener needs an explicit destroy

- **Trigger:** a secondary window registers `onCloseRequested` (for example to notify the main window when it closes).
- **Failure mode:** the native close button and any `close()` (including a Rust-initiated one) emit close-requested but the window never disappears — the default destroy does not run while a listener is attached, so content can re-appear elsewhere while the window stays open.
- **Prevention:** in the handler call `preventDefault()`, run the teardown work, then `destroy()` explicitly. For an authoritative close initiated from another window, call `destroy()` from Rust so it does not depend on the target window's JS.
- **Verification:** count real windows before and after every close path (native button, in-window dock, other-window dock) and confirm the window is gone.

### JS window.destroy() requires its own capability

- **Trigger:** calling `getCurrentWindow().destroy()` (or another window's `destroy()`) from the frontend.
- **Failure mode:** the call is silently denied and the window stays open even though `close()` is allowed, because only `core:window:allow-close` was granted.
- **Prevention:** add `core:window:allow-destroy` to the window's capability. A Rust-side `destroy()` needs no capability.
- **Verification:** the destroy path closes the window with the capability present and fails without it.

### One window owns the state; the others are synced views

- **Trigger:** a panel can be detached into a separate native window while both show the same data.
- **Failure mode:** two windows write the same store, causing lost updates, divergent state, or double persistence.
- **Prevention:** keep the main window as the single source of truth and only writer; the secondary window emits validated, sanitized action events and renders the state pushed to it. Validate every inbound cross-window payload at the boundary.
- **Verification:** mutate from the secondary window and confirm the change round-trips through the owner and its persistence exactly once.

### Prefer in-app capture; never OS screen capture for QA

- **Trigger:** collecting visual evidence during development, especially on macOS.
- **Failure mode:** OS screen capture (for example `screencapture`) triggers a screen-recording permission prompt or firewall block and can include non-Terax content.
- **Prevention:** use the in-app capture command (`app.capture`, DOM rasterization) only. It captures the main webview surface, so a separate native window cannot be captured this way on macOS — validate secondary windows through shared components plus a functional bridge round-trip. Window metadata via `CGWindowListCopyWindowInfo` is metadata-only and needs no screen-recording permission, so it is safe for asserting window lifecycle (open/close counts).
- **Verification:** evidence is produced with no screen-recording prompt, and secondary-window behavior is proven by state/round-trip plus window-count checks.

### Build success is not integration success

- **Trigger:** a native `cargo run` or packaged app compiles and launches.
- **Failure mode:** completion is claimed before discovery, authentication, event delivery, or React handling works.
- **Prevention:** wait for app readiness, discover the authenticated instance, invoke the command, and verify the resulting snapshot.
- **Verification:** retain E2E summary output tied to the tested executable and run.

### Cleanup exit codes require context

- **Trigger:** a long-running development app is stopped after tests.
- **Failure mode:** signal-derived exit codes such as `-15` or `143` are misreported as compilation or feature failures.
- **Prevention:** record lifecycle milestones and whether termination was deliberate. Do not infer success from the code either.
- **Verification:** evidence shows compile completion, readiness, test completion, and explicit cleanup order.

### Bind visual evidence to authenticated window identity

- **Trigger:** capturing native Terax screenshots or videos from Windows or another desktop OS.
- **Failure mode:** desktop, cursor, another app, or a similarly titled window appears in evidence.
- **Prevention:** bind capture to the authenticated process ID and exact expected Terax window identity. Handle dynamic main-window titles and singleton secondary-window labels explicitly.
- **Verification:** inspect every delivered frame or representative frames and confirm no foreign surface appears.

### Privacy guards must remain active through recording

- **Trigger:** recording more than one frame.
- **Failure mode:** a terminal becomes private after the initial guard and leaks into later frames.
- **Prevention:** run the private-terminal guard throughout capture and delete the entire run if any guard fails.
- **Verification:** tests simulate a mid-recording guard failure and assert evidence removal.

### Cross-environment paths need explicit encoding and normalization

- **Trigger:** WSL starts or discovers a Windows build, especially under a user path containing non-ASCII characters.
- **Failure mode:** source copy, Cargo invocation, discovery parsing, or executable lookup fails despite valid files.
- **Prevention:** use literal-safe Windows commands, UTF-8 decoding, explicit path conversion, and a dedicated Windows target directory. Never assume ASCII usernames or Unix separators.
- **Verification:** exercise at least one path with spaces or non-ASCII characters and confirm discovery identifies the intended executable.

## In-App Rasterization Capture

### Nested data-URL images do not survive foreignObject rasterization

- **Trigger:** rendering a DOM clone through SVG foreignObject onto a canvas while any pixel content is inlined as a nested data-URL `<img>` (canvas snapshots, embedded bitmaps).
- **Failure mode:** WebKit rasterizes the SVG before nested images load, producing blank regions (black terminals) even though the same approach appears to work in Chromium.
- **Prevention:** never inline canvas pixels into the clone. Record each source canvas rect before cloning, strip canvases from the clone, and composite the live canvases directly onto the output 2D canvas after drawing the SVG.
- **Verification:** capture a window containing a running terminal and inspect the PNG for actual glyph pixels, not just chrome.

### Readable canvas buffers are a prerequisite, not a given

- **Trigger:** compositing WebGL-backed canvases (xterm webgl renderer) into a capture.
- **Failure mode:** `drawImage`/`toDataURL` from a WebGL canvas yields transparent pixels because the drawing buffer is cleared after compositing.
- **Prevention:** create the WebGL context with `preserveDrawingBuffer` (WebglAddon constructor flag) or register a snapshot provider through the capture module for surfaces that cannot preserve their buffer.
- **Verification:** terminal pixels appear in a real capture; the flag is set where the addon is constructed in the renderer pool.

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
### Iframe content is invisible to in-app capture

- **Trigger:** capturing a preview tab (or any surface embedding an `<iframe>`).
- **Failure mode:** the artifact shows the pane chrome and address bar with a blank body, which reads as a broken page even when the embedded app is running and interactive. The DOM clone cannot rasterize another document's content.
- **Prevention:** treat preview panes as functionally verifiable only. Prove the embedded app works through its own surface (health endpoint, websocket client count, an API round-trip such as an image export) plus the semantic snapshot showing the tab id, url, and title.
- **Verification:** the snapshot lists the preview tab with the expected url and title, and an action routed through the embedded client returns real data.

### Hidden idle terminals have no pixels to capture

- **Trigger:** capturing the pane of a terminal tab that is hidden and has no foreground job.
- **Failure mode:** the renderer pool releases the slot for idle hidden leaves, so no canvas exists; the buffer lives serialized in the dormant ring and the capture shows only pane chrome. This is structural, not a bug.
- **Prevention:** for QA flows, focus the tab (`tab.focus`), capture, then restore focus. Do not attempt to force slot rebinding from the capture path.
- **Verification:** the documented workaround produces terminal pixels; the direct hidden capture is documented as chrome-only.

### Capture scope must map to privacy scope

- **Trigger:** adding or changing a capture target.
- **Failure mode:** a target leaks private-terminal information indirectly (tab titles in the tab strip, cwd in the status bar) even though the private pane itself is excluded.
- **Prevention:** classify each target by what it can reveal: any private tab blocks whole-window targets (`window`, `tabstrip`); the targeted tab blocks `pane`; an active private tab blocks active-scoped targets (`header`, `sidebar`, `statusbar`, `active-pane`, `overlay`).
- **Verification:** with a private terminal open and active, every affected target is rejected over the real bridge and the snapshot is unchanged afterward.

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

### A development instance hijacks the Pi discovery file

- **Trigger:** running `pnpm tauri dev` while a release Terax is open and a Pi session is bridged to it.
- **Failure mode:** both apps write the same per-user discovery file, so Pi tools silently target the dev instance; after the dev app exits, the file points at a dead process and the release app is unreachable until it is restarted.
- **Prevention:** copy the discovery file before starting a dev instance and restore it after cleanup. Re-read it whenever bridge results look like they came from the wrong window.
- **Verification:** the restored file's pid matches the still-running release process, and a bridge call reaches it.

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

### macOS temp paths need realpath before path equality

- **Trigger:** a test compares a path returned by code that canonicalizes with `realpath` against a path built from `os.tmpdir()`/`mkdtemp`.
- **Failure mode:** on macOS `/var` is a symlink to `/private/var`, so the two paths differ and the assertion fails only on macOS.
- **Prevention:** `realpath` the temporary root before deriving expected paths, or canonicalize both sides before comparing.
- **Verification:** the path-equality test passes on both macOS and Linux.

## Catalog Maintenance

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
