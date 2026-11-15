# Native block input and frame-projection foundation

The native leaf now owns block input readiness, per-leaf drafts, editor focus
and submission acceptance across view changes and process replacement. Internal
block queries can resolve immutable metadata for the frame actually presented.
This prepares the shared blocks UI; ordinary blocks still route to the legacy
engine. This change does not complete A02 or the terminal replacement.

## Behavior

NativeBlockInput is allocated only for an explicit blocks owner. It retains full
in-memory drafts independently from React views and through respawn, matching
the existing persistence scope. The startup and submit-to-marker gaps do not
give the grid direct keyboard input. Authenticated running/alternate state
does. Policy notifications distinguish a busy submission gap from an actual
program even when both have the public running mode.

Each authenticated prompt-end B increments promptVersion. A shell comment can
therefore return to a new prompt without C/D block metadata and release the
submission gap. The new scalar remains internal native state; no command text
or token is added to Pi snapshots.

After native submission resolves, the leaf revalidates owner, generation,
process identity and lifecycle before accepting it. Acceptance settles that
owner's draft by token and edit revision, independently from the current editor.
Every edit is saved immediately; cleanup cannot write an old accepted value
back. The shared ShellInput/CodeMirror path preserves rejected async submissions
and invalidates late current-view completions after retarget/destruction.
Owner draft notifications also update a remounted editor safely. An identical
draft in another leaf or a draft edited away and back is not cleared.

The native binding disables its textarea when the editor owns the prompt, gates
text/key/paste commits and restores editor focus. Parent pointer capture
activates a leaf before child preventDefault can suppress compatible mouse
events. Keyboard/programmatic onFocus activation remains available.

gterm_blocks accepts an optional seq. The actor retains up to three immutable
projections within a 16 MiB snapshot budget plus bounded container overhead.
Identical snapshots share storage. Metadata-only changes force a frame.
Unavailable/oversized projections do not fall back to live grid coordinates.
Output bodies are not cached. Existing headless queries without seq still
resolve current native anchors.

EngineSession validates canonical bounded block IDs, exact frame sequence,
viewport dimensions, row ranges and metadata/output budgets. Block metadata and
reads share 32 client admissions; the actor retains its shared 32-query admission
with text/selection/search/links. Closed or replaced replies are rejected.
NativeBlockProjection coalesces one in-flight query plus the latest pending
frame, discards stale/disposed replies and recomputes geometry for changed cell
metrics. Its lifetime must follow the process because seq can repeat after
respawn. This model is not yet mounted by the ordinary blocks router.

## Verification

Isolated M2 worktree: /Users/andres.rojo/Workspaces/terax-worktrees/native-block-ui.
Branch: feat/native-terminal-block-ui. Clean base: 8fc7ebd.
All execution, build and UI work stays on M2. The protected Mac and the unrelated
pending plan in the main M2 checkout remain unchanged. Sendery is the local
commit identity; no Actions, push, PR, merge or performance lab was run.
FPS remains optional and does not gate functional migration.

The provisional prebuilt remains libghostty-vt 0.2.2 at Ghostty
a887df42c56f6de86c0fe6da9c4eeca37931e083, archive SHA-256
fd8ca44691ced7b1fa368666fb5546ba8bf4318b717b356ea0a36a2aada49fe0.
No archive/core-library patch or Zig source fallback was used.

Clean full baseline and final block-ui-foundation-pointer-final floor passed.
Frontend: 2476 passed plus one existing skip; Pi: 101; Node: 43.
Plain Rust: 602 unit plus 58 integration, one existing ignored.
Native Rust: 722 unit plus 58 integration, two existing ignored.
Strict clippy passed in both configurations. Lint retains exactly the baseline
120 warnings and two infos: full JSON diagnostic comparison by path, category,
message and severity found no additions or removals.

Exact final commands (all passed):

```sh
pnpm lint
pnpm check-types
pnpm test
pnpm build
pnpm --dir packages/pi-terax test
node --test scripts/*.node-test.mjs scripts/libghostty/*.node-test.mjs
cargo clippy --manifest-path src-tauri/Cargo.toml --target-dir /Users/andres.rojo/Workspaces/terax-ai/src-tauri/target --all-targets --locked -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --target-dir /Users/andres.rojo/Workspaces/terax-ai/src-tauri/target --locked
.terax/pi-development/m2/with-ghostty cargo clippy --manifest-path src-tauri/Cargo.toml --target-dir /Users/andres.rojo/Workspaces/terax-ai/src-tauri/target --all-targets --locked --features ghostty-engine -- -D warnings
.terax/pi-development/m2/with-ghostty cargo test --manifest-path src-tauri/Cargo.toml --target-dir /Users/andres.rojo/Workspaces/terax-ai/src-tauri/target --locked --features ghostty-engine
git diff --check
```

The build includes the Pi package build. Native checks ran sequentially with
the verified owned dev watcher stopped; Node policy tests used worktree cwd
without global CARGO_TARGET_DIR.

Observed red-before-production cases cover input ownership, prompt revision,
open option/state boundaries, late registry ownership, rejected/stale editor
completion, accepted owner drafts, confirmed queued submit then respawn,
presented-frame retention and allocation limits, typed query admission,
coalesced geometry, prompt/direct input policy and pointer-capture activation.
The actor test proves exact retained-frame metadata after EOF.
The decoder and DOM/component tests use bounded fixtures; they do not establish
the unmounted native blocks UI.

Independent source review found and resolved owner/draft acceptance races and
the inactive-pane activation path. No remaining source blocker was found in
this foundation. No assertion, rule or check was weakened or suppressed.
Helper quoting and fixture-ack corrections are recorded in the ignored journal;
the zero-test helper run is not counted as red evidence. Tests gained the
driver's real scroll method rather than changing behavioral expectations.

Run journal: .terax/pi-development/normal-block-ui/journal.md.
Logs: .terax/pi-development/m2/logs.
Reusable lessons are merged into the development gotcha catalog.

## Real M2 acceptance and limits

The same authenticated sandbox process remained live throughout this smoke.
Both ordinary native panes accepted their first pointer click and keyboard
command, wrote distinct left/right acknowledgements and returned to their
prompts. The inspected app-owned capture is
.terax/visual-qa/20261115T082120.473Z-block-ui-native-panes-K4yMiI/screenshot.png.

The shared ShellInput/CodeMirror component was exercised in ordinary legacy
blocks tabs, as routing is intentionally unchanged. Two tabs retained identical
commands independently. Accepting A cleared A and preserved B; each command ran
exactly once, returning to A showed the empty editor, and Enter in empty A did
not repeat its command. The guarded sequence passed with both 42-character
relative commands and 149-character absolute commands, using exact AX editor
receipts before retarget and public filesystem acknowledgements after Enter.
The inspected B-preserved capture is
.terax/visual-qa/20261115T082948.291Z-block-ui-shared-draft-b-preserved-geLqLy/screenshot.png.
Only the four created test tabs were closed; earlier panes were preserved.

An initial unguarded long synthetic typing/bridge-retarget sequence produced
duplicated text and no expected acknowledgement. It is not a passing run or a
confirmed app defect: text receipt before retarget was not established.
Guarded repeats passed without a production change. Its underlying cause
remains unproven; integrated native acceptance must still include input/focus
timing. The harness now checks known editor text rather than equating return
from simulated typing with application consumption. Empty CodeMirror AXValue
can include its known placeholder; nonempty fixture text is matched exactly.

Initial captures timed out and System Events briefly exposed no window despite
a responsive bridge. Read-only diagnostics confirmed the console was unlocked,
Accessibility was trusted and the existing process owned a window. Raising and
unminimizing that window through the granted Accessibility API recovered it
without a restart or permission change. Capture pixels and OS gesture points
have different scales; gestures used verified logical window bounds. The
pre-existing optional SDK profile read errors were left untouched.

This smoke proves ordinary native input and the shared editor path with the
current legacy blocks renderer. It does not prove the combined native blocks
UI, asynchronous native acceptance through that UI, or other-platform runtime.

## Remaining integration

Ordinary blocks remain legacy. Mount the per-process projection and existing
BlockOverlay with asynchronous bounded reads/search/actions; preserve output
selection, navigation, rerun, AI/private guards and stale-owner rejection.
Carry the full submitted command beyond current shell metadata truncation.
Validate completed-cell overwrite/erase behavior independently from row lifetime.

Before rollout, exercise the combined native ShellInput/CodeMirror path:
A to B with identical drafts, accept A, return without restoring the executed
command, reject/respawn while queued, then two prompt panes with first-click
activation and real foreground/alternate input. Pure tests of the pieces do
not prove that integration.

Other parity rows remain active: full graphemes, TUI mouse/readline, OSC
consumers, preferences, selection actions, offscreen/overlay capture,
agent/task/restore acceptance, graphics/HiDPI, platform runtime validation,
default rollout and soak. No performance target replaces those requirements.
