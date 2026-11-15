# Native complete command metadata and prompt header anchors

Native blocks retain the original accepted command beyond the previous 256-character shell truncation and 4 KiB client/parser bound. zsh, fish and PowerShell emit the complete original cmdline_url only for authenticated native blocks, preserving Unicode, newlines and tabs. The decoded command limit is 1 MiB, matching the native paste envelope; marker storage is bounded to three times that plus 512 bytes. An invalid or oversized value is unavailable as a whole, never a prefix offered for reexecution. Existing unsigned/raw and ordinary native shell marker behavior is preserved.

Bash full-command capture remains open. The implementation does not guess from shell history or associate pending host writes by timing. Runtime acceptance of fish and PowerShell is also open; neither shell is installed on this M2.

Header placement now uses a tracked native reference to the actual reserved row at authenticated prompt-end. Authenticated prompt-start invalidates pending anchors; command-start transfers ownership to the new block. Reflow and history collection use native reference semantics. Presented snapshots contain nullable headerLine independently of output bounds. JavaScript validates that coordinate and aligns the bar within that actual row. Missing or unavailable anchors suppress the in-grid bar, with no output-distance or live-grid fallback.

A program can overwrite the reserved row without damaging its output. A valid output digest alone therefore cannot authorize a toolbar there. Snapshot creation checks visible header rows for native text and hides only overwritten headers while preserving valid block output. Checking only viewport rows avoids scanning all retained history for this validation.

## Scope and invariants

All work stays in the isolated M2 worktree:
  /Users/andres.rojo/Workspaces/terax-worktrees/native-block-ui
Branch feat/native-terminal-block-ui; starting commit8f53399, clean.
No original-Mac project execution or edit, antivirus change, GitHub Actions,
push, PR, merge or performance laboratory. Commits use Sendery only.

The verified provisional libghostty-vt0.2.2 archive remains pinned to Ghostty
a887df42c56f6de86c0fe6da9c4eeca37931e083 and SHA-256
fd8ca44691ced7b1fa368666fb5546ba8bf4318b717b356ea0a36a2aada49fe0.
No source/Zig fallback.

No persistent schema, dependency, terminal-buffer snapshot or public Pi/MCP surface is added. Native block metadata remains bounded by the existing 4 MiB allocation budget, 1000 completed entries and presented-cache limits. Explicit output integrity, empty-output distinction, private capture/AI guards, process ownership and the existing blocks single-leaf restriction are preserved.

## Verification

Checks follow the user's current cadence: focused checks while developing, one broad Astra source review, a combined pass for the affected code at the QA checkpoint, and manual application QA by the user. The earlier eleven-gate baseline at8f53399 remains evidence for that earlier commit; it is not presented as a full-suite run of this delta.

Client: 70 tests passed across nativeBlocks, NativeBlockView and EngineSession.
Types and frontend/Pi package build passed. Changed-file lint contains only
the two existing noNonNullAssertion warnings in engineSession.test.ts.
No added lint diagnostic.

Native engine tests cover original multiline Unicode metadata beyond4KiB,
the exact1MiB cap, entire-value rejection on oversize, an actual zsh hook,
native wrapped echo/reflow, missing/unsigned/invalidated prompt anchors,
and cursor-addressing overwrite of the header while output remains valid.
The final added VT test feeds a long fragmented marker through libghostty
and asserts marker bytes do not become visible output.

An additional real interactive zsh PTY test injects the actual profile, waits
for an authenticated prompt, sends a long Unicode multiline command through
bracketed paste, waits for the next prompt, and compares CommandStart with the
complete original. It does not invoke preexec manually. It passed.

The initial native compile found a fixture using the wrong resize arity;
the pinned API requires column, row and both pixel arguments. The fixture was
corrected. Cargo fmt also traversed unrelated baseline Rust files; its own
format-only mutations were saved privately and the exact unrelated files
restored from HEAD before final checks. No unrelated changes are included.

The independent broad review found the overwritten-header case described above.
The source fix and regression were reviewed again; the reviewer closed the
finding and reported no further blocker. Bash and other shell/platform
acceptance remain explicit limitations.

Final combined Rust checks all passed: plain shell tests14, native engine tests172 plus one existing ignored, and strict clippy for both configurations. All exact commands below passed.

Exact commands:
```sh
pnpm exec vitest run src/modules/terminal/gl/nativeBlocks.test.ts src/modules/terminal/gl/nativeBlockView.test.ts src/modules/terminal/gl/engineSession.test.ts
pnpm check-types
pnpm build
pnpm exec biome lint src/modules/terminal/gl/nativeBlocks.ts src/modules/terminal/gl/nativeBlocks.test.ts src/modules/terminal/gl/nativeBlockView.test.ts src/modules/terminal/gl/engineSession.test.ts src/modules/terminal/block/lib/blockDecorations.ts src/modules/terminal/block/BlockOverlay.tsx --reporter=json --max-diagnostics=none
cargo clippy --manifest-path src-tauri/Cargo.toml --target-dir /Users/andres.rojo/Workspaces/terax-ai/src-tauri/target --all-targets --locked -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --target-dir /Users/andres.rojo/Workspaces/terax-ai/src-tauri/target --locked modules::pty::engine::shell
.terax/pi-development/m2/with-ghostty cargo clippy --manifest-path src-tauri/Cargo.toml --target-dir /Users/andres.rojo/Workspaces/terax-ai/src-tauri/target --all-targets --locked --features ghostty-engine -- -D warnings
.terax/pi-development/m2/with-ghostty cargo test --manifest-path src-tauri/Cargo.toml --target-dir /Users/andres.rojo/Workspaces/terax-ai/src-tauri/target --locked --features ghostty-engine modules::pty::engine
git diff --check
```

Native checks run sequentially with the explicit shared target and dev stopped.
No full repository test run, automated visual walkthrough, packaged release,
benchmark or exhaustive platform matrix is claimed for this delta.

## Suggested user QA

In the M2 native sandbox, use zsh blocks to run a command longer than256
characters, then Copy command and Run again; compare the complete command.
Repeat with a multiline command. Resize the window so a command wraps and
confirm its metadata toolbar stays in the blank header row. Check ordinary
blocks search/copy and a foreground interactive program as daily usage.

This is a runnable development candidate, not a release-ready replacement.
The goal remains a terminal with all current capabilities preserved or improved.
Remaining work includes Bash, fish/PowerShell runtime acceptance, full grapheme
rendering, inline images, Retina/mixed-DPI, TUI/mouse/readline, settings,
notification/clipboard protocols, AI/agent/task/restore consumers and rollout.
60 FPS is optional and does not gate that functional work.
