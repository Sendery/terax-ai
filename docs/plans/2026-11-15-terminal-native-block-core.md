# Native command-block core

The native actor now tracks command blocks from the injected shell's authenticated
OSC 133 C/D boundaries. This is the backend foundation for replacing the existing
blocks terminal. Ordinary blocks panes still use the legacy implementation;
native block UI, drafts and actions are not delivered by this change.

## Behavior and boundaries

gterm_open accepts an optional blocks flag, default false. One explicit value
governs both the shell profile and the actor. Inherited TERAX_BLOCKS is removed
before applying that value; WSLENV retains unrelated entries and forwards the
flag only for an explicit WSL blocks launch. Shared policy tests run on M2;
Windows and WSL native execution remain unverified.

The bounded shell observer reports authenticated markers at their exact byte
terminators, even across fragments or multiple commands in one PTY message.
Every original byte still reaches libghostty-vt, including the rest of a batch
after a metadata failure. The actor makes such failure visible. Unsigned markers, invalid
framing/authentication, cancelled markers, duplicate tokens and opaque strings
do not create blocks. An authenticated C with invalid or duplicate command
metadata retains its boundary with an empty command. Non-block sessions retain the existing feed path without command decoding or
BlockStore allocation.

BlockStore retains at most 1000 completed entries and one live entry within
4 MiB of metadata, charging allocated String capacity. Native tracked grid
references resolve output ranges after reflow and become unavailable after
actual history reclamation or reset. No output body cache or numeric-offset
fallback retargets another row. Empty output and CRLF endpoints exclude the
next prompt. Completed reads use an independent native selection and a 1 MiB
output cap; the user's selection is untouched. EOF finishes a live block once
with unknown exit status and retains healthy post-exit reads.

Internal Tauri queries gterm_blocks and gterm_read_block share the existing
32-request text/selection/search/link admission limit, validate IDs before
admission, and have a two-second receipt timeout. Timeout does not cancel
accepted work. Disabled sessions return an explicit error. State adds only
blocksEnabled and blocksMetadataVersion. Command/output text and shell tokens
are not added to Pi snapshots, command registries or MCP surfaces.

metadataVersion changes with command metadata, not viewport geometry, reflow,
live output endpoints or alternate-screen changes. UI consumers must project
ranges on relevant frame/resize changes rather than deduplicate by this value.

## Verification

Isolated M2 worktree: /Users/andres.rojo/Workspaces/terax-worktrees/native-blocks.
Branch: feat/native-terminal-blocks. Clean base: 7329617.
Execution, builds and UI checks remain on M2. Sendery is the local commit
identity. No GitHub Actions, protected-Mac compilation, push, merge or new
performance laboratory ran. FPS is an optional future improvement.

The verified provisional libghostty-vt 0.2.2 archive uses Ghostty
a887df42c56f6de86c0fe6da9c4eeca37931e083. Its SHA-256 remains
fd8ca44691ced7b1fa368666fb5546ba8bf4318b717b356ea0a36a2aada49fe0;
prebuilt mode denies source fallback and does not provision Zig.
No core/library/archive patch was made. The pinned native source confirms
tracked-reference garbage semantics and the minimum two-page history size;
the prune test observes actual reclamation before checking unavailable refs.

Clean baseline and final complete floor passed. Final blocks-env-final logs:
frontend 2444 passed, one existing skip; Pi 101; Node 43; plain Rust 601 unit
plus 58 integration, one existing ignored; native Rust 718 unit plus 58
integration, two existing ignored. Strict clippy passed in both modes.
Lint retains the baseline 120 warnings and two infos. No tests, assertions,
rules or checks were skipped, weakened or suppressed for this change.

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

The build command also builds the Pi package. Native gates ran sequentially
with the owned dev watcher stopped. Node policy tests ran from worktree cwd
without global CARGO_TARGET_DIR.

Red-before-production evidence covers positioned shell events, tracked ranges,
endpoint handling, metadata allocation limits, bytes after metadata failure,
actor/query/EOF integration, inherited environment and WSL forwarding. Twelve
core regressions and neighboring actor tests pass. A real macOS zsh/profile/
portable-pty test executes two commands, proves exact outputs, cwd and exit
statuses 0/7, retains reads after exit and rejects after close. This proves the
backend through a real PTY, not native blocks UI or other-platform behavior.
Independent source review found endpoint, metadata revision, allocation and
inherited-environment issues; the final review found no remaining blockers in
this backend delta.

Run evidence and fixture corrections are recorded in the ignored
.terax/pi-development/normal-blocks/journal.md and m2/logs. Reusable lessons are
promoted to the development gotcha catalog.

Additional normal-pane smoke used the authenticated sandbox and real OS
keyboard input with TERAX_BLOCKS=1 deliberately inherited by the parent. The
active native PTY executed a fresh public fixture, wrote the expected
normal-mode-flag-absent acknowledgement and visibly returned to its ordinary
prompt. This establishes the actual child-mode fix, not blocks UI parity.
The inspected app-owned capture is
.terax/visual-qa/20261115T071001.250Z-blocks-default-env-smoke-K9qIr9/screenshot.png.
The user's pre-existing zsh profile reported denied reads of optional SDK files
under Downloads; fixture execution and prompt recovery succeeded without
changing that profile or OS permissions.

## Required next integration

A02 remains open in the parity inventory. Before ordinary blocks route to the
native engine, complete:

- Per-frame range projection, scroll/reflow/navigation and alternate-screen
  handling; metadata revision alone must never drive geometry.
- Full submitted command capture, including commands longer than the current
  zsh metadata truncation and Bash PS0 without complete command text.
- Completed-block cell overwrite/erase damage behavior, not just row lifetime,
  with acceptance that never returns a different command's output.
- Existing BlockOverlay/actions, output selection, rerun, block search, status/
  duration, ShellInput drafts/focus/submit and mode transitions through native
  leaf ownership, with private and stale-generation guards.
- Real ordinary blocks UI and shell acceptance. Windows/Linux/WSL runtime
  validation remains separate.

The full replacement objective remains active. Other parity rows, full
grapheme rendering, TUI mouse/readline, OSC consumers, preferences, capture
overlays/offscreen, agent/task/restore flows, graphics/HiDPI and default rollout
remain open. No performance target substitutes for functional parity.
