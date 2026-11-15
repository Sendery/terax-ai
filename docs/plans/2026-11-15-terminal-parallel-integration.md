# Parallel native terminal integration

Independent M2 worktrees allow implementation and validation to overlap.
Seven source blocks are integrated additively in
feat/native-terminal-renderer-fallback. The runnable source checkpoint is
cea3fa6d2fbc9878645dc6bcea7004de0aa9f75b.

| Block | Original checkpoint | Integrated checkpoint |
| --- | --- | --- |
| Native Canvas2D/GPU fallback | 4c0e839 | 4c0e839 |
| Physical-coordinate file drop targeting | 6f541cf | 7c4a5d0 |
| Owner-bound agent restoration | 349b2c5 | ef3af8b |
| Image-background foreground contrast | 72d8fdf | 46059a5 |
| Live cursor preference and header-only frames | 029e9b8, 4dba9aa | 97d40a8, 3eb87f3 |
| Owner-bound scheduled task handoff | 6473e8b | a27ea8f |
| Focused native Clear Active shortcut | 76dd863 | cea3fa6 |

All checkpoints use Sendery. Independent appended tests conflicted during
integration; both sets were retained. Production changes merged additively.
No Actions, pushes, pull requests, merge commits, publication or protected-Mac
project operations occurred.

## Behavior covered by the latest blocks

The contrast block follows the existing background setting: ratio 4.5 for a
configured image and 1 otherwise, with bounded shared foreground resolution
for GPU and software rendering. Faint/inverse and decorative exclusions follow
the legacy behavior. It does not alter SurfaceLayer composition.

The cursor block applies the current preference before the first frame, on
live changes and after respawn. Later VT modes processed after that preference
remain authoritative. Setter acknowledgement confirms admission, not actor
application. A native dirty-clean correction sends changed header metadata
without rereading rows, preserving cursor-only mode updates.

Task handoff binds all deferred reads and writes to the original owner, tab,
leaf, privacy, space, cwd and seed. Readiness failure writes nothing. An
uncertain attempted delivery cannot automatically submit the prompt again.
A queued recovery checks the seed again when its timer actually fires.
Visual readiness remains a bounded heuristic, not an agent acknowledgement.

See the individual native appearance, cursor preference and task handoff
reports for scope, review findings and focused checks.

## Integrated checks

The first integrated a27ea8f source passed these checks on M2:

- pnpm exec vitest run src/modules/terminal/gl src/modules/terminal/lib/useTerminalFileDrop.test.ts src/modules/terminal/lib/quoteShellPath.test.ts src/modules/terminal/lib/sessionSubmission.test.ts src/modules/terminal/lib/sessionSubmissionFacade.test.ts src/modules/agents/lib/restore.test.ts src/modules/agents/lib/useAgentSessionRestore.test.ts src/modules/tasks/lib: 691 passed, one existing skip, 55 files.
- pnpm check-types: passed.
- pnpm lint: passed with unchanged 119 warnings and two infos.
- CARGO_TARGET_DIR=/Users/andres.rojo/Workspaces/terax-ai/src-tauri/target VITE_TERAX_TERMINAL_ENGINE=ghostty .terax/pi-development/m2/with-ghostty pnpm build:sandbox --debug --bundles app --no-sign --features ghostty-engine: passed.
- git diff --check: passed.

The cursor source block separately passed 203 native tests with one existing
ignored test, 62 plain tests and strict Clippy using the pinned prebuilt. The
subsequent contrast and task blocks changed no Rust source. These are focused
block checks and an integrated build, not a new whole-repository test claim.

Astra reviewed each completed source block and directed concrete corrections.
The root verified the final seed guard for the already-scheduled retry.
Native builds sharing the explicit target directory were serialized; agents
did not compete for Cargo or the live UI.

## Clear Active and Bash follow-up

The cea3fa6 checkpoint adds native ownership and actual DOM-focus guards to
terminal.clearActive (Mod+;), preserving its formfeed payload. The guards
remain valid through the final owned PTY write. Editor, hidden pane, replaced
owner and blocks-prompt input do not receive that shortcut. Cmd+K host
scrollback clearing is a separate existing behavior and remains pending.

On the integrated cea3fa6 source, the five affected input/session/shortcut
test files pass 145 cases and pnpm check-types passes. The sandbox build also
passes with the same explicit target and verified prebuilt command above.
Astra and root reviewed the source; actual shortcut interaction remains open.
These focused checks do not imply a rerun of the earlier 691-test set.

The Bash evidence block is integrated as ab5f336. Six cases using real Bash 3.2
and 5.3 pass on the integrated worktree. They protect command execution, status,
DEBUG/PS0 hooks and shell marker origin without changing production. Complete
command metadata was already missing from legacy Bash; it is an improvement
opportunity rather than a regression introduced by native migration. See the
[native Bash report](2026-11-15-terminal-native-bash-metadata.md).

## Real runtime status

The successful bundle was frozen at
.terax/qa-candidates/cea3fa6/Pi-Terax Sandbox.app. Discovery PID93366,
app.buildInfo and the mapped executable confirm that exact sandbox. It has
the same public clean 11-tab set, active tab 35 and two idle zsh children93803
and93805. It was launched without the temporary ZDOTDIR fixture override.

The previous ef3af8b QA and a27ea8f normal candidates were retired through
their strict own-instance helpers. No user profile was modified. No GPU preference has been changed.

The M2 remains on-console and Accessibility is trusted, but
CGSSessionScreenIsLocked=true. The existing unlock question remains pending.
Do not relax AX window matching to operate a locked desktop.

GPU/software switching with preserved shell identity, physical drops,
restoration, live appearance/cursor changes and actual task delivery still
need graphical acceptance. Source checks, a successful build and authenticated
startup are not reported as acceptance of those interactions.

## Remaining parity and parallel lanes

The active source audit found Cmd+K host clearing still routed through
legacy sessions, a fixed byte budget instead of the configured history-row
limit, and rejection of inactive native pane capture. Existing native selection actions, PTY-to-leaf mapping and AI
terminal text adapters are present; they need scenario acceptance rather than
another duplicate implementation.

The native-history worktree has a source-reviewed exact-row extension and
separate explicit producer recipe. Seven Node policy tests and independent
verification of seven upstream blobs, patch application and before/after
hashes pass. Eleven native tests are written but zero have executed. The
producer fails while linking Zig 0.15.2's own build runner with the real SDK 27,
before compiling project tests. An untouched upstream checkout reproduces
the same failure with SDKROOT pointing at that SDK. Apple Clang links a
minimal arm64/libc probe successfully. No new native artifact exists.

SDK 26.5 is also installed with Apple receipt/BOM evidence but lacks an explicit
arm64 target in its libSystem stub. SDK 15.2 advertises arm64, though its local
installation origin remains unaccredited. Compatible official SDK acquisition
or provenance is being investigated without a shim, SDK substitute or silent
compiler upgrade. The native lease is free after the failed producer and
successful Clear app build. Normal app builds continue to use the unchanged
verified prebuilt. No consumer pin or Cargo dependency changed.

Explicit producer maintenance on M2 remains distinct from a consumer source
fallback and retains patch provenance, licenses and exact pins.

Inactive capture is being implemented in the independent native-inactive-capture
worktree. It needs a one-shot full frame rendered offscreen with the
existing CanvasRenderer, owner/privacy checks and coherent block projection.
Removing its rejection would allow blank or stale captures. It must preserve
the main renderer, viewport, terminal and PTY.

OSC99 and OSC9;4 are requested new capabilities from Phase 4, not lost legacy
features: the legacy handlers and installed xterm do not implement them.
The shared agent detector already preserves generic armed-agent OSC9
attention. Track new capabilities separately from existing-parity defects;
their original contract item is not claimed complete.

The active objective remains a normal runnable Terax with the new terminal
and the same capabilities or better. Default rollout, scenario acceptance and
applicable real-workload validation remain open. No further FPS laboratory
work is planned; 60 FPS remains an optional later optimization.
