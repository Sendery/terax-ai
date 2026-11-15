# Native full-grapheme rendering

The native terminal now carries the complete cluster from libghostty-vt to
the canvas atlas. Combining marks, variation/ZWJ sequences, skin tones and
regional flags keep their full text and native cell width. Before this change,
the core and explicit copies retained that text but frame pixels used only
the first scalar.

This is one coherent renderer change across the Rust frame producer,
TypeScript decoder, GPU cell translation, shared atlas and recovery lifecycle.
Normal scalar frames remain byte-identical. New complex frames use the
previously reserved cell bit 29 and header flag 8 with a frame-local UTF-8 table.
The complete wire contract and bounds are in docs/architecture/terminal-engine.md.

The decoder validates the table flag, reference indices, native spacer width,
UTF-8, scalar count and zero padding, preserving leading U+FEFF. IDs never
become cache identities: atlas keys contain full text, face and native width.
The GPU grid holds slots/colors, while bounded atlas text keys and CPU texture
pages support lookup and context restoration without a JS terminal history.
Device-pixel font changes clear cluster keys and rebuild through the existing
DPR/metrics/full-frame path. Physical mixed-display acceptance is still open.

## Explicit capacity recovery

The protocol bounds clusters to 1 MiB, the table to 8 MiB and 250,000 entries.
The atlas also bounds retained UTF-16 text keys to 8 MiB, alongside its existing
texture budgets. Oversized values fail explicitly; no prefix is sent.

Atlas capacity never substitutes glyph 0. Each visible participant may trigger
one automatic cache reset in a recovery epoch. Renewal requires every visible
pane to rebuild a full frame. A still-unrenderable view reports a visible error
and stops repeated full-frame requests. Credits/native terminal processing
continue and presented geometry is invalidated. Redraw or font/DPR changes retry.
Hidden panes perform no atlas work; they request reconstruction on reveal.
One full request may still be queued for a received hidden frame; this is not
a claim of zero hidden IPC.

## Provenance and isolation

M2 worktree /Users/andres.rojo/Workspaces/terax-worktrees/native-graphemes,
branch feat/native-terminal-graphemes, clean starting commit e2d2fa1.
Original Mac project not edited or executed. Main M2 plans with unrelated edits
were preserved. Sendery local commits only, no Actions, push, PR or merge.

A standalone debug QA application with embedded frontend was built from e2d2fa1
and copied to the previous worktree's ignored
.terax/qa-candidates/e2d2fa1/Pi-Terax Sandbox.app.
Its authenticated live buildInfo and exact application path were verified.
It has no dev watcher, so development here does not change that candidate.

All native commands use the checksum-verified provisional libghostty-vt 0.2.2
archive, Ghostty a887df42c56f6de86c0fe6da9c4eeca37931e083, SHA-256
fd8ca44691ced7b1fa368666fb5546ba8bf4318b717b356ea0a36a2aada49fe0.
No Zig/source fallback or new dependency was introduced. New worktree package
dependencies were installed offline from the frozen lockfile; the first shared
node_modules symlink was removed after pnpm refused an implicit purge, with
the prior installation preserved.

## Verification

- GL module: 226 passed plus one existing fixture-absence skip.
- Native engine: 177 passed plus one existing ignored.
- Plain encoder: 22 passed.
- Strict clippy passed with and without ghostty-engine.
- Types and frontend/Pi build passed.
- Full lint: 121 diagnostics, exactly the baseline 119 warnings and 2 infos;
  no additions/removals.
- Rust-generated full/partial grapheme fixtures pass TypeScript decoding.
  The existing wide-combining fixture now asserts the complete accent rather
  than the old known loss; all other fixture outputs remain unchanged.
- Independent broad review found a missing-table flag case and unbounded
  capacity recovery, including a hidden participant cycle. Those source fixes
  and regressions were reviewed again; no blocking finding remains.

Tests cover exact UTF-8/BOM, accent distinctions, ZWJ/native wide tails,
partial-frame index reuse, invalid/truncated/oversized data, per-face/width
atlas keys, device-font rebuild, shared text-key exhaustion, bounded retries,
successful epoch renewal, hidden/reveal work and credits/presented geometry.
Mock fillText assertions prove arguments and cache behavior, not WebKit pixels.
Focused real application acceptance is recorded separately in the ignored
native-graphemes journal and the final handoff report.

A native compile first found an old test-only Row literal needing its new
grapheme-table field; it was corrected. Added lint diagnostics were fixed
without suppression. No assertion, skip or validation rule was weakened.

Exact final checks:
```sh
pnpm exec vitest run src/modules/terminal/gl
pnpm check-types
pnpm build
pnpm exec biome lint ./src --reporter=json --max-diagnostics=none
cargo clippy --manifest-path src-tauri/Cargo.toml --target-dir /Users/andres.rojo/Workspaces/terax-ai/src-tauri/target --all-targets --locked -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --target-dir /Users/andres.rojo/Workspaces/terax-ai/src-tauri/target --locked modules::pty::engine::frame
.terax/pi-development/m2/with-ghostty cargo clippy --manifest-path src-tauri/Cargo.toml --target-dir /Users/andres.rojo/Workspaces/terax-ai/src-tauri/target --all-targets --locked --features ghostty-engine -- -D warnings
.terax/pi-development/m2/with-ghostty cargo test --manifest-path src-tauri/Cargo.toml --target-dir /Users/andres.rojo/Workspaces/terax-ai/src-tauri/target --locked --features ghostty-engine modules::pty::engine
git diff --check
```

The two fixture-generation commands used UPDATE_FIXTURES=1 only for
fixtures::wide_and_combining and fixtures::full_grapheme_frame_fixtures.
Final native validation ran without regeneration. Native builds were sequential
with the explicit target; the frozen QA app is independent of that target.
Full repository tests, performance laboratories, platform matrices and user
manual QA are not claimed for this renderer slice.

## Remaining functional replacement

Native inline images, physical Retina/mixed-DPI acceptance, Bash command
association, fish/PowerShell acceptance, TUI/mouse/readline/settings and the
remaining AI/agent/task/restore consumers still need completion or verification.
Default rollout is not enabled. The objective remains all current terminal
capabilities preserved or improved; 60 FPS is optional.

Suggested manual QA for the new candidate: compare decomposed accents and
composed emoji, select/copy that output, hide a running terminal then reveal
it, and resize/change font or move between displays.

Primary pinned core reference:
[Ghostty page/grapheme storage](https://raw.githubusercontent.com/ghostty-org/ghostty/a887df42c56f6de86c0fe6da9c4eeca37931e083/src/terminal/page.zig).
