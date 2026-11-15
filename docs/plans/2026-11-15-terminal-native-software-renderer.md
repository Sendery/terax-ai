# Native software presentation

## Behavior

The native terminal keeps its Rust engine, PTY, history, input and retained
session when the presentation backend changes. The existing GPU preference now
selects WebGL2 or Canvas2D. A failed WebGL2 constructor retries on a fresh canvas;
a lost GPU context switches to software. Disabling then enabling the preference
allows an explicit GPU retry. Ordinary panes and blocks use the same public
renderer contract and existing attachRenderer/full-frame migration.

Canvas2D consumes the existing decoded native frames and shared cell/style
resolver, including full graphemes, wide cells, colors, inverse/faint/invisible,
bold/italic, underline variants, strike/overline and cursor styles. It does not
parse VT output or create another shell. Device pixel metrics use the same
font measurement as the GPU renderer.

Inline RGBA images retain generation identity, three z layers, alpha, physical
cell scaling and source crops. A bounded scratch bitmap isolates source pixels
before smooth magnification, including single-pixel crops. Hidden image state
is released and reconstructed from a full frame on reveal.

## Resource and failure contract

Glyph keys are bounded to 65536 entries and 8 MiB of UTF16 key bytes for a window.
Retained image bitmaps are bounded to 128 MiB across panes; the crop scratch is
bounded by a valid source image, at most 32 MiB. Dimensions pass through zero
before changing crop aspect ratio, avoiding a transient product of unrelated
old and new dimensions. Unused incoming IPC buffers are not retained.

Each cell and pane balances canvas state through finally. Allocation/paint
failure releases owned image resources, invalidates presented metadata, reports
capacity without failing the native process, and returns draw credit with
rendered=false. Other panes continue. Retry/full refresh is bounded; explicit
Redraw and font/DPR changes renew failed capacity epochs. Last image removal
releases scratch storage.

## Source verification

Worktree: /Users/andres.rojo/Workspaces/terax-worktrees/native-renderer-fallback,
from db918d0. All work runs on M2; the protected original Mac is unchanged.
No Actions, FPS lab, push, PR, merge or publication.

- pnpm exec vitest run src/modules/terminal/gl: 296 passed, one existing skip.
- pnpm check-types: passed.
- pnpm lint: passed with unchanged 119 warnings and two infos.
- git diff --check: passed.
- Astra source review: all concrete resource/recovery blockers reproduced red
  and corrected; directed follow-up finds no remaining source blocker.

Runtime acceptance of preference switching, process identity, software pixels
and input is pending the integrated sandbox build. Unit tests do not establish
actual WebKit appearance, GPU loss or other-platform acceptance. This block does
not enable the production default or complete the whole migration.

## Parallel development

The user explicitly requested independent worktrees so source validation can
overlap development. File drop targeting and agent restoration were developed
separately from this renderer, reviewed while it was still being implemented,
and are integrated only through their green local Sendery checkpoints.
