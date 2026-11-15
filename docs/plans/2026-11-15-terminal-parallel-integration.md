# Parallel native terminal integration

The user requested independent worktrees so validation overlaps coding. Three
blocks were implemented from db918d0 and reviewed while another was still being
developed. They are integrated additively in feat/native-terminal-renderer-fallback:

| Block | Original checkpoint | Integrated checkpoint |
| --- | --- | --- |
| Native Canvas2D/GPU fallback | 4c0e839 | 4c0e839 |
| Physical-coordinate file drop targeting | 6f541cf | 7c4a5d0 |
| Owner-bound agent restoration | 349b2c5 | ef3af8b |

All commits use Sendery. The only integration conflict was two independent test
appends in nativeLeafSession.test.ts; both regressions were retained. No Actions,
pushes, pull requests, merges, publication or protected-Mac builds occurred.

## Integrated checks

- pnpm exec vitest run src/modules/terminal/gl src/modules/terminal/lib/useTerminalFileDrop.test.ts src/modules/terminal/lib/quoteShellPath.test.ts src/modules/terminal/lib/sessionSubmission.test.ts src/modules/terminal/lib/sessionSubmissionFacade.test.ts src/modules/agents/lib/restore.test.ts src/modules/agents/lib/useAgentSessionRestore.test.ts: 366 passed, one existing skip.
- pnpm check-types: passed.
- pnpm lint: passed with unchanged 119 warnings and two infos.
- CARGO_TARGET_DIR=/Users/andres.rojo/Workspaces/terax-ai/src-tauri/target VITE_TERAX_TERMINAL_ENGINE=ghostty .terax/pi-development/m2/with-ghostty pnpm build:sandbox --debug --bundles app --no-sign --features ghostty-engine: passed.
- git diff --check: passed.
- Astra reviewed all three source blocks and directed corrections. No remaining concrete source blocker.

No Rust source changed in these three blocks; Cargo was only run by the root
coordinator for the integrated app build, with the explicit shared target and
pinned prebuilt. The other agents ran independent focused TypeScript checks.

## Real runtime status

The ef3af8b sandbox is frozen under .terax/qa-candidates/ef3af8b and authenticated
by discovery PID, app.buildInfo and mapped executable. PID94026 has the public
11-tab set with active tab35 and two idle zsh children94447/94449. A temporary
ZDOTDIR emitted only public image/Unicode fixtures; user profiles were not edited.

Settings opened through the supported settings.open command. No GPU preference
has been changed. The AX inspection refused to click because windows were not
exposed as expected. Diagnostics show AX trusted and on-console, but
CGSSessionScreenIsLocked=true. The user has been asked to unlock M2. Do not
weaken window/control matching to get around a locked screen.

GPU/software switching, physical drops and actual agent restore acceptance are
still pending. Source checks and compilation are not reported as runtime
acceptance. After graphical acceptance, close the public QA candidate through
its strict own-instance helper and relaunch the frozen app without ZDOTDIR.

## Continuing in parallel

The native-task-handoff worktree was created from ef3af8b. The restore agent is
checking the scheduled-task adapter for remaining stale owner/readiness/submit
gaps using the new internal API, without Cargo or UI work. The root retains
exclusive control of native builds and the live M2 UI.

The active goal remains a normal runnable Terax with the new terminal and the
same capabilities or better. Full migration and production default are open;
60 FPS is a later optional optimization.
