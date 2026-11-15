# Native terminal background contrast

## Existing behavior preserved

The existing background image is a SurfaceLayer overlay across the app. It is
not an image behind each terminal canvas. This change retains that composition,
the opaque renderer contexts, image opacity and blur preferences.

Legacy rendererPool requests minimum contrast4.5 when backgroundKind=image and
backgroundImageId is truthy, otherwise1. The native surface now uses that same
policy in ordinary and blocks panes. No new setting, persistence field, IPC,
parser or clipboard capability is added.

An optional contrast policy feeds the shared native cell resolver, so WebGL2
and Canvas2D use identical adjusted foregrounds. Background RGB stays exact,
including inline image layering and cursor background rules. Inverse resolves
before contrast. As in installed xterm WebGL, faint uses half the target and
retains normal dim blending when raw foreground already satisfies that target.
Explicit underline colors are preserved; inherited underline uses the resolved
foreground. Invisible cells remain invisible. Box/block drawing2500..259F and
PowerlineE0A4..E0D6 retain their decorative colors, including a grapheme whose
first scalar belongs to those ranges.

The policy is absent at ratio1, preserving existing default frame goldens and
avoiding contrast work and cache allocation. When enabled, its color cache has
at most4096 entries and its style scratch is bounded by the decoded frame's
style count. Keys preserve exact24-bit foreground/background and dim identity.
Luminance lookup is lazy and bounded. Disabling the policy releases its cache.

## Live changes and ownership

A policy change requests full frames for visible panes; hidden panes refresh
on reveal. Colors do not replace glyph identity, renderer, native core or PTY.
Opening and GPU/software replacement use the latest preference in constructor
options. Full and partial native frames continue using the same wire format.

## Verification

Isolated M2 worktree native-appearance, branch feat/native-terminal-appearance,
base8581138. Protected original Mac was not edited or built. No Actions, push,
PR, merge, publication, FPS lab or native Cargo command ran in this block.

- pnpm exec vitest run src/modules/terminal/gl:312passed, one existing skip.
- pnpm check-types:passed.
- pnpm lint:passed with baseline119warnings and two infos.
- git diff --check:passed.
- Astra source review: no concrete blockers; algorithm/order/exclusions match
  the installed xterm source.

Focused regressions cover attainable contrast on dark/light/midrange colors,
faint/inverse/invisible cells, explicit black underlines, full grapheme
decorative exclusions, cache bounds, both backends and policy disable/reveal.
The initial missing-policy/live-setter regressions were red before source.

Actual WebKit image preference changes, faint/inverse pixels and hide/reveal
remain unverified while M2 is screen-locked. This source checkpoint does not
claim graphical acceptance, all-preferences parity or full migration delivery.
Cursor and scheduled-task work continue in independent worktrees.
