# Terminal renderer pool

This guide elaborates on `TERAX.md`. If anything here conflicts with `TERAX.md`, `TERAX.md` wins.

## Why a pool exists

Terminal tabs are kept mounted and hidden on switch so PTYs and dev servers keep streaming in the background. Creating an unbounded number of live xterm + WebGL renderer instances would blow the memory budget, so Terax pools renderer slots.

The pool lives in `src/modules/terminal/lib/rendererPool.ts`.

## Slot lifecycle

- `POOL_MAX_SIZE` is a soft cap of 5 and `POOL_HARD_MAX_SIZE` a hard cap of 16 (`lib/poolPolicy.ts`). Past the soft cap the pool grows instead of stealing a protected slot (visible, busy, or alt-screen): a parked busy slot has no WebGL context, so the cost is one xterm buffer, while stealing it would serialize a TUI mid-output. Every running Claude Code session counts as busy, so a workload of many split tabs with an agent per pane otherwise evicted one on almost every tab switch. Idle surplus slots are reaped back down. Each slot owns one xterm `Terminal`, `FitAddon`, `SearchAddon`, `SerializeAddon`, and optionally a `WebglAddon`.
- A slot is created on demand and assigned to a leaf on bind.
- `releaseSlot` detaches a slot from a leaf. If the leaf is idle, the slot is parked with `display:none` so xterm stops rendering but keeps parsing PTY bytes.
- After a grace period, idle slots may be reaped to keep the pool size down.

## Parking vs releasing

When a leaf becomes hidden:

1. `parkLeafSlot` sets the host to `display:none`. Rendering pauses but the live buffer keeps receiving bytes.
2. If the leaf is **busy** (foreground command, agent signal, alt-screen TUI, or block-shell running mode), it keeps the slot parked indefinitely.
3. If the leaf is **idle**, `releaseSlot` is called after `HIDDEN_RELEASE_DELAY_MS`. The slot's `currentLeafId` is cleared and `retainedLeafId` is set so the buffer stays live.

When the leaf becomes visible again, `acquireSlot` looks for:

1. A slot already bound to this leaf.
2. A retained slot for this leaf (`retainedLeafId === leafId`) - fast path, no snapshot replay.
3. A clean idle slot.
4. If the pool is at the soft cap and the lowest-scoring slot is protected, a new slot is created up to the hard cap. Otherwise the lowest-scoring slot is evicted. Eviction serializes the retained buffer to a snapshot via `SerializeAddon` before stealing the slot. A leaf serialized while busy replays its dormant bytes on the next bind and then gets a SIGWINCH kick, so a program that repaints part of the screen incrementally redraws it from scratch.

## The DormantRing

`src/modules/terminal/lib/dormantRing.ts` buffers PTY bytes for leaves that have no slot at all (stolen or never bound). It is capped at 1 MiB and drops oldest blocks on overflow. On drain it resumes from the next line boundary rather than resetting the terminal, so a mid-line escape sequence is not replayed from the middle.

## The never-serialize-mid-command invariant

This is the most important rule in the pool. A leaf that is in the middle of a command must **never** be serialized. Replaying incremental TUI repaints over a stale snapshot is what used to wipe Claude Code.

The code enforces this by checking `isLeafBusy` before eviction and by keeping slots parked (not released) while `commandRunning`, `isAgentActivePty`, or alt-screen is true.

## Fast path and snapshot replay

If a retained slot exists for a leaf, `bindSlot` skips `term.clear()` / `term.reset()` and simply drains the DormantRing into the live buffer. This avoids re-rendering a large snapshot.

If only a snapshot exists, `bindSlot` clears the terminal, resizes, writes the snapshot, then drains the ring. For alt-screen TUIs, the snapshot is skipped and a SIGWINCH kick is sent so the TUI repaints from scratch.

## WebGL lifecycle

WebGL addons are created when a slot becomes visible and reaped after a grace period when parked. The addon recovers from context loss on sleep/wake or GPU reset.

### Repainting a shared atlas

Slots with the same font and theme share one glyph atlas, and `clearTextureAtlas` clears only the model of the renderer that calls it. Clearing the atlas for one pane therefore left every other renderer drawing from glyph positions that now held different glyphs: corrupt text in the neighbouring panes that only selecting it repaired. `repaintSlots` never clears for one slot alone: when any target kept an existing WebGL context, `clearSharedAtlas` clears it through every slot with a renderer, so each one invalidates its model. A renderer attached during the same repaint uploads every page into a fresh context and needs no clear at all (`lib/atlasRepaint.ts`), which is the common re-bind case.

### Glyph atlas budget

xterm's WebGL glyph atlas only grows. `clearTextureAtlas` wipes the pages but keeps their size, pages merge into larger ones up to `MAX_TEXTURE_SIZE` (16384 on Apple GPUs, where a single page can reach 1 GiB), and every WebGL context uploads its own mipmapped copy of each page. Slots with the same font and theme share one atlas, so it survives every individual slot rebind, and days of colourful agent output (truecolor diffs, spinners) pin that memory in the webview's graphics footprint.

The pool therefore caps it (`lib/atlasBudget.ts`, pure and tested). Each time a page is added, a debounced check sums the live atlas pages (deduplicated across slots); above `ATLAS_BUDGET_BYTES` (32 MiB) every WebGL renderer is disposed and the visible ones re-attached, which builds a fresh atlas holding only the glyphs on screen. All renderers are disposed before any is re-attached, since a slot re-attaching while another still owns the old atlas would join it again. Rebuilds are rate limited by `ATLAS_RESET_MIN_INTERVAL_MS` so a screen that genuinely needs a large atlas cannot loop. Page canvases are released (`width = height = 0`) as soon as they are merged away or the atlas is rebuilt, rather than whenever the canvas is collected. `terminalDebugStats().atlasBytes` reports the current size in dev builds.

## Invariants

- Never allow the pool to grow without bound; past `POOL_MAX_SIZE` it grows only for protected slots, and never past `POOL_HARD_MAX_SIZE`.
- Never serialize or evict a leaf that is mid-command or in alt-screen.
- A hidden busy leaf keeps its live grid parked with `display:none`.
- An idle hidden leaf releases its slot but the buffer continues parsing bytes.
- The DormantRing only buffers bytes for leaves without any slot.
- The shared glyph atlas is never cleared for one slot alone.
- The shared glyph atlas never exceeds `ATLAS_BUDGET_BYTES` for longer than one rate-limit interval.

## See also

- [`TERAX.md`](../../TERAX.md) - the architecture source of truth
- [`docs/README.md`](../README.md) - index of contributor guides
- [PTY shell integration](pty-shell-integration.md) - sessions, OSC sequences, and ConPTY
