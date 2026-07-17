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

## Snapshots and Privacy

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

## Native and Visual Validation

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
