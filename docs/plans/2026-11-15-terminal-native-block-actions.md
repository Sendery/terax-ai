# Native block action contract

This change connects internal native block selection, navigation and scoped
search from the actual libghostty-vt engine through a typed Tauri endpoint to
EngineSession. It does not activate native blocks in the ordinary router.
Shared BlockOverlay wiring and full submitted-command association remain next.

Completed output retains native endpoint references plus a bounded canonical
unwrapped SHA-256 content stamp. Reads and actions reject overwritten/erased
ranges even when row references survive. Explicit reads retain their 1 MiB
limit, selection receipts 16 MiB and canonical integrity/search formatting
64 MiB. No output-body cache is introduced. Visible damaged entries retire
without advancing the command acceptance metadata revision.

Internal gterm_block_action supports select, presented-frame selectAt,
navigate, find, revisioned reveal and clearSearch. IDs, coordinates, direction,
query size/control characters and reply shapes are closed and bounded.
A missing presented frame never falls back to live coordinates. Scoped search
keeps at most 500 native anchored matches and paints through the native frame;
search does not replace the user's selection. Empty output has a valid empty
search scope and never includes a later prompt.

Manual selection and block requests share one actor FIFO and the existing
32-query admission with text/search/links. Accepted work can outlive the
2-second IPC receipt timeout, so actor FIFO preserves selection order even
after a receiver is abandoned. EngineSession also orders actions with pointer
selection, snapshots queued command arguments and shares selection revisions.
Late, closed or replaced replies cannot republish stale copied text.

Only sessions with blocks enabled allocate the optional action owner.
No Pi/MCP command or terminal-buffer snapshot exposure is added. No persistent
schema changes or new dependency are introduced. This commit changes no user
interface, so UI accessibility and visual acceptance belong to the pending
shared-overlay integration.

## Verification record

M2 isolated worktree:
  /Users/andres.rojo/Workspaces/terax-worktrees/native-block-ui
Branch: feat/native-terminal-block-ui. Base: 8e59c36.
All execution remains M2. Protected Mac and unrelated main-checkout plan stay
unchanged. Sendery local commits only; no Actions, push, PR, merge or benchmark.
60 FPS is optional and does not gate functional replacement.

The exact baseline already passed all eleven repository gates before 8e59c36.
Current owned delta continues from that clean committed baseline.
Verified prebuilt: libghostty-vt 0.2.2, Ghostty
a887df42c56f6de86c0fe6da9c4eeca37931e083; archive SHA-256
fd8ca44691ced7b1fa368666fb5546ba8bf4318b717b356ea0a36a2aada49fe0.
No core patch or Zig source fallback was used.

Observed red before production: missing integrity/prune/action contracts,
empty-output search including the prompt, missing actor/client actions, and
a retained actual actor returning an older block selection after manual Clear.
Fixture corrections preserved assertions: install a nonempty KEEP selection
after erase; hold the admission fixture's action receipt; credit the first
frame before retaining the second. The ES2021 type gate rejected Object.hasOwn;
the final validator uses Object.keys with exact count and key membership, without changing compiler configuration. The intermediate hasOwnProperty.call added a lint warning and was replaced without suppressing the rule.

Focused checks: block suites 33 passed; motor suite 163 passed with one existing
ignored before the final frame-color test; client 62 passed; check-types passed.
Native frame-color test exercises global/scoped overlay merging, Reveal,
ClearSearch and unchanged manual selection after input EOF. Independent source
review found and then closed the timeout/FIFO blocker, with no additional
blocking finding.

Final block-actions-clean floor: all eleven commands passed. Frontend:
2483 passed plus one existing skip. Pi: 101. Node: 43.
Plain Rust: 602 unit plus 58 integration, one existing ignored.
Native Rust: 741 unit plus 58 integration, two existing ignored.
Strict clippy passed both configurations. Full JSON lint comparison by path,
category, message and severity: exactly the baseline 120 warnings and two infos,
zero additions and zero removals. The first full run also exited zero but
revealed the added warning during explicit baseline comparison; the final run
includes its source fix.

Exact final floor commands, all passed:
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
The build includes the Pi package build. Dev remained stopped during native
gates, native builds ran sequentially with an explicit shared target, and Node
policy tests ran in worktree cwd without a global CARGO_TARGET_DIR.

Additional focused commands:
```sh
.terax/pi-development/m2/with-ghostty cargo test --manifest-path src-tauri/Cargo.toml --target-dir /Users/andres.rojo/Workspaces/terax-ai/src-tauri/target --locked --features ghostty-engine modules::pty::engine::block
.terax/pi-development/m2/with-ghostty cargo test --manifest-path src-tauri/Cargo.toml --target-dir /Users/andres.rojo/Workspaces/terax-ai/src-tauri/target --locked --features ghostty-engine block_action_actor_tests
.terax/pi-development/m2/with-ghostty cargo test --manifest-path src-tauri/Cargo.toml --target-dir /Users/andres.rojo/Workspaces/terax-ai/src-tauri/target --locked --features ghostty-engine modules::pty::engine
.terax/pi-development/m2/with-ghostty cargo test --manifest-path src-tauri/Cargo.toml --target-dir /Users/andres.rojo/Workspaces/terax-ai/src-tauri/target --locked --features ghostty-engine an_abandoned_block_receipt
pnpm exec vitest run src/modules/terminal/gl/nativeBlockActions.test.ts src/modules/terminal/gl/engineSession.test.ts
pnpm exec biome lint ./src --reporter=json --max-diagnostics=none
```
The focused block suite passed 33, the final action actor suite passed four,
and the client suite passed 62. The last motor-only run passed 163 with one
existing ignored before adding the final color-frame regression. The complete
final native suite includes all of them. The abandoned-receipt command first
proved the overwritten selection failure and passes in the final full suite.
Initial missing-contract/type/fixture failures are recorded above and in the
private run journal; no assertion, budget or configuration was weakened.

No new rendered UI or visual acceptance is claimed for this internal contract.
Ordinary blocks still use the legacy route. Next: guarded async shared
BlockOverlay/search integration, per-process projection mounting, full submitted
command association, real two-pane block/CodeMirror acceptance, then remaining
functional parity and default rollout. The full terminal replacement objective
remains active.
