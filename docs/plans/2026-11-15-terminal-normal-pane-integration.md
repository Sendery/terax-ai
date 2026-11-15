# Ordinary native terminal integration

The normal M2 sandbox can open, type into, split, focus, hide/show and close
native panes while preserving surviving shell processes. This integrates the
new engine into the application instead of proving it only in Terminal Lab.
The migration is incomplete and the production default remains xterm.

## Implemented behavior

- One shared renderer/canvas/atlas per window, live theme/font inputs, pane-local
  input/cursor geometry, and explicit native build opt-in.
- Persistent per-leaf native process ownership across view remounts and renderer
  replacement; awaited, sticky retirement before respawn.
- Native selection gestures, highlighted cells, bounded retained selection text,
  and versioned actual keyboard/paste/focus/alternate-screen modes.
- Existing IME/dead-key commit policy and clipboard helpers, native negotiated
  input, context-menu selection snapshots and app facade routing.
- Frozen, cropped pane capture with private guards and clear rejection of hidden
  or unavailable native pane capture. Shared-canvas pixels cannot hide dividers.

## Functional and visual evidence

All actions ran on the M2 using the provisional prebuilt wrapper and sandbox
identity. No Actions or protected-Mac native build ran. The authenticated Pi
client confirmed source provenance and structural snapshots. Normal OS keyboard
and mouse input exercised the actual UI. Native gterm open logs and shell PID
checks established that split panes had distinct native sessions, a split did
not respawn its original shell, and closing one left its neighbor alive.

Snapshots and inspected PNGs prove the shared normal-window surface, split
content and divider, isolated pane-area capture, and preserved output after tab
switches and renderer replacement. Private window/pane capture and invalid
focus payloads rejected without changing the structural snapshot. An explicit
inactive native-pane capture rejected instead of returning a blank success.
Machine-local commands, PIDs, PNG paths and failed intermediate artifacts are
recorded in the ignored normal-pane-runtime journal on M2.

Real QA found and corrected two hot-reload defects: a mixed component/context
refresh boundary and reuse of a canvas whose GPU context was intentionally
lost during disposal. A temporary first import of a diagnostic dependency made
Vite perform a full reload and reap fixture PTYs; those attempts are recorded
as failed evidence. The final component owns a new canvas per acquisition;
subsequent recovery preserved both fixture shells and displayed their content.

## Validation

The full floor is run on M2, with source fallback disabled. Exact commands:

```sh
pnpm lint
pnpm check-types
pnpm test
pnpm build
pnpm --dir packages/pi-terax test
node --test scripts/*.node-test.mjs scripts/libghostty/*.node-test.mjs
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
.terax/pi-development/m2/with-ghostty cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked --features ghostty-engine -- -D warnings
.terax/pi-development/m2/with-ghostty cargo test --manifest-path src-tauri/Cargo.toml --locked --features ghostty-engine
git diff --check
```

`pnpm build` includes the Pi package build. Focused native and frontend tests
cover gesture text/highlight failure handling, state versions, negotiated
Shift+Enter, composition, keyboard mapping, process/view ownership, retirement,
renderer transfer, stale selection/clipboard replies and capture races.
Independent Astra review drove regressions and corrections for engine choice
on remount, stale clipboard targets, failed reattach, callback isolation,
transactional renderer migration and capture availability across tab changes.
Final M2 source pass: every command above passed. Frontend: 2411 tests passed,
with one pre-existing skip. Pi: 101 passed. Node scripts: 43 passed. Rust:
590 unit plus 58 integration passed without the feature (one ignored), and
671 unit plus 58 integration passed with it (two ignored). Strict clippy passed
in both modes. An initial canvas accessibility error and byte-char-slices
clippy diagnostic were corrected without rule suppression; the full floor was
rerun. The final pane/active-pane capture regression is included in these totals.

## Open delivery requirements

This is an integration checkpoint. Native shell CWD and prompt/command
readiness, blocks and drafts, search, file/URL links, selection popup actions,
TUI mouse reporting, full grapheme rendering, setting/fallback parity, agent
restore/task scenarios and native platform acceptance still need implementation
or real validation. FPS remains optional and further measurements are deferred.
The objective remains a usable terminal replacement with the same or better
capabilities; this report does not redefine completion around this checkpoint.
