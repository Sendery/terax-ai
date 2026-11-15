# One-shot inactive native pane capture

Date: 2026-11-15. Base: `a27ea8f4cce7914b4ec58bd13703c706f25a05dc`.
Branch: `feat/native-terminal-inactive-capture`.

## Delivered behavior

An explicit `app.capture` pane request can capture a mounted inactive
public native terminal without activating its tab. The previous implementation
refused that request because hidden renderers discard their grids and images.
The existing request schema and PNG outcome are unchanged.

The new path requests one full packet from the same retained engine, freezes
its existing decoded buffer and reads the immutable block projection for that
exact sequence. It neither replaces the live renderer nor changes focus, PTY
size, viewport, parser or input ownership. A healthy retained core remains
queryable after shell exit. Missing full data, invalid projection, missing image
uploads or a failed renderer reject the capture instead of returning blank
terminal pixels.

A temporary CanvasRenderer reconstructs the frozen graphemes, native RGBA
images, styles, cursor and contrast with the same font, cell metrics and DPR.
Read-only chrome reuses BlockChrome and StickyHeader through an inert snapshot
component. The live block overlay is excluded from the base clone; its snapshot
is composited from the matching block sequence. Existing pane clipping and DOM
stacking order are preserved even when foreground images load out of order.
The watermark is marked as capture foreground so native pixels do not cover it.

## Ownership, privacy and resource bounds

A scoped provider lease opts in only the requested hidden native canvas. Window
captures continue excluding hidden canvases. Both provider and capture
orchestrator revalidate live ownership, registration, connectivity, exact target
association, privacy, geometry, font, theme, DPR and appearance across awaits.
App supplies a required live context getter, so replacing the tabs array cannot
leave a stale privacy decision. The guard runs immediately before persistence.

One deadline, currently ten seconds, covers preparation, image loading,
rasterization and persistence acknowledgement. Full-DPR staging is checked
against existing capture dimensions and pixel limits before native requests.
Only one capture consumer is admitted per owner; no hidden JS terminal history
or continuously rendered hidden view is added.

The core retains one frame in flight. A captured full keeps its ordinary credit
gated only until the matching block query finishes or aborts. Marked hidden
panes receive onDrawn(false) from the existing renderer display turn, without
glyph drawing or a fabricated drawn sequence. EngineSession no longer requests
another recovery full merely because a hidden renderer discarded its grid.
Revealing the pane still requests its required full through the existing path.

Finally releases the consumer, credit gate, temporary renderer and canvases,
image sources, inert header DOM and provider lock. Cancellation observes late
async results and disposes late resources. The existing capture_persist IPC
cannot withdraw a write already admitted by the backend; the live guard is
checked immediately before invocation. A timeout or privacy change during its
acknowledgement can reject the result without retroactively cancelling that
already admitted write.

## Verification

All source and checks ran on M2. Final source-only focused command:

```sh
PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin \
  ./node_modules/.bin/vitest run \
  src/modules/capture/lib/capture.test.ts \
  src/modules/capture/lib/captureLease.test.ts \
  src/modules/capture/lib/rasterize.test.ts \
  src/modules/capture/lib/rasterizePipeline.test.ts \
  src/modules/capture/lib/targets.test.ts \
  src/modules/terminal/gl/engineSession.test.ts \
  src/modules/terminal/gl/canvasRenderer.test.ts \
  src/modules/terminal/gl/gridRenderer.test.ts \
  src/modules/terminal/gl/nativeCaptureProvider.test.tsx \
  src/modules/terminal/gl/nativeBlocks.test.ts \
  src/modules/terminal/gl/nativeBlockView.test.ts \
  src/modules/terminal/gl/canvasGraphics.test.ts \
  src/modules/terminal/block/BlockOverlaySnapshot.test.tsx
```

186 tests pass across thirteen files. Coverage includes the real CanvasRenderer
full reconstruction and display-turn discard callback; prior hidden credit;
partial/full admission; exact-sequence blocks; concurrent capture; retained
healthy exit; abort and late query; privacy before persistence; stale
owner/geometry; timeout cleanup; frozen foreground substitution; and reverse
image-load stacking. Provider, DOM and image adapters use test doubles.
Astra reviewed source and reported no concrete blocker; it did not run checks.

`tsc --noEmit`, focal Biome lint and `git diff --check` pass.
Lint retains ten unchanged App baseline warnings and two existing non-null
assertion warnings in the engine tests. No new lint warning remains.

## Remaining acceptance

Real WKWebView acceptance is still required for inactive public normal and
blocks panes, native images and full graphemes, software and GPU main renderers,
and font/DPR/owner changes during capture. Validate the resulting PNG while the
active tab, shell PIDs, viewport and focus remain unchanged. This checkpoint
does not claim that runtime acceptance, whole-terminal parity or a performance
result. Existing visible-pane capture retains its ordinary presentation path.

No Cargo, application build, UI automation, producer, Actions, push or
publication was run in this lane. Shared architecture and parity documents were
left to the integration owner.

## Integrated M2 normal-pane acceptance

The integrated source at 5acaa791a7e3927737e35b13abf09af02d024ff1
passed 423 tests with one existing skip across 39 focused files, types,
unchanged lint baseline (119 warnings and two infos), and the sandbox build.
The frozen normal-environment sandbox used that exact commit and executable,
confirmed through discovery, app.buildInfo and the mapped binary.

With M2 unlocked, on-console, Accessibility trusted and the exact own app
foreground, app.capture produced an active two-pane PNG (1964x1564,
150732 bytes) and an inactive single-pane PNG (1964x1564, 86264 bytes).
Both PNGs were visually inspected: readable native shell text, colors, cursor
and pane divider are present. The active tab stayed 35, all twelve tabs
including the unrelated clean editor38 were preserved, and idle shell PIDs
72609, 98422 and 98423 remained identical. No terminal input, viewport change,
profile edit, process replacement or tab activation was needed for capture.
The generated evidence remains in the ignored M2 development area as
capture-foreground-runtime-result.json and the recorded capture paths.

Earlier locked-session attempts reached the capture deadline; that condition
was observed but is not proven to be the sole cause. The successful unlocked
normal-pane run does not establish blocks/image/grapheme fixture acceptance,
software-renderer capture, physical mixed-DPI behavior or mutation races.
Those scenarios remain for the general functional sweep.
