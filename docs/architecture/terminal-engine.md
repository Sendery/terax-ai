# Terminal engine (libghostty-vt + WebGL2)

Contract for the engine described in `docs/plans/2026-11-10-terminal-ghostty-vt-webgl2.md`. This file is the single source of truth for the Rust and the TypeScript side; when the two disagree, this file wins and gets fixed first. The native engine serves all terminal panes. Cargo enables `ghostty-engine` by default. Terminal Lab uses the same engine.

## Current implementation checkpoint

Ordinary and blocks panes, app/agent/task consumers, active/inactive capture,
exact-row retention and host clear are integrated on the native path.
The completion pass adds negotiated mouse, Alt-click cursor navigation, selection autoscroll, readline,
OSC9/99 notifications, OSC9;4 progress and Kitty Unicode placeholders.
See [the source inventory and acceptance boundary](../plans/2026-11-15-terminal-complete-implementation.md).
Earlier phase paragraphs below retain their historical context.

The internal gterm_encode_input union also accepts moveCursor: a bounded target
cell with expected cursor/grid. The actor checks its live viewport and mouse
owner, then encodes cursor movement from native rows. The input queue rechecks
the frontend owner/focus/gesture guard before writing.

The internal gterm_encode_input union also accepts mouse events: closed action,
bounded button/modifiers/geometry and optional repeat1..32 only for wheel
presses. Encoding remains actor-ordered and uses the terminal's actual modes.
Coordinates use physical pixels relative to the terminal grid, without host
padding. The pinned SGR-pixels encoder emits that coordinate system directly.

Graphics tables retain subformat1 for ordinary placements. Subformat2 has the
same header, image data and14-word placement size, with the final eight
geometry words encoded as little-endian IEEE754 f32. Identity/generation,
signed z/col/row and capacity limits are unchanged. Geometry must be finite,
nonnegative and bounded; widths/heights are positive. This supports fractional
source cropping across virtual placeholder rows. Both renderers and inactive
capture consume the same decoder. This is a frame subformat, not a core ABI
or archive change.

## Invariants

1. **Bytes are never dropped.** The PTY reader hands bytes to the engine through a bounded queue. When the engine is behind, the reader blocks, the kernel PTY buffer fills and the child blocks. There is no overflow path.
2. **Frames are droppable, state is not.** The webview holds no terminal state it cannot rebuild from one full frame. A frame that is not sent is simply superseded by the next one.
3. **One frame in flight per terminal.** Rust sends a frame only when it holds a credit. The webview returns the credit after it has applied the frame and a display frame has been presented. A hidden or throttled window therefore produces no frames and no work.
4. **The terminal lives on one thread.** `libghostty-vt` types are `!Send`. The `Terminal`, the `RenderState` and both iterators are created, used and dropped on the engine thread. Everything else talks to it through its queue.
5. **No terminal work until a leaf opens.** The native engine is linked at build time and creates its state when a terminal starts.

## Build

- Cargo enables `ghostty-engine` by default. It links the pinned `libghostty-vt` and `libghostty-vt-sys` 0.2.2 via pkg-config.
- `pnpm tauri dev`, `pnpm dev:sandbox` and the build scripts use `node scripts/with-zig.mjs --native-core -- <command...>`. Both patched ABI exports are required. Universal macOS builds select both library slices through Cargo's target-specific pkg-config variables.
- The wrapper verifies the archive, extracts the static library and headers under `src-tauri/target/toolchains/`, relocates `libghostty-vt-static.pc`, and preflights pkg-config. A deny-only Zig executable blocks the crate's implicit source fallback. It never provisions Zig in prebuilt mode. Static Windows linkage uses `ghostty-vt-static.lib`, never the DLL import library `ghostty-vt.lib`.
- Both Cargo workspaces patch `libghostty-vt-sys` to the pinned copy in `src-tauri/vendor/`. That copy rejects entry to the source-build function unless `TERAX_GHOSTTY_SOURCE_BUILD=1`, before cloning or starting Zig. The explicit source wrapper supplies that opt-in; prebuilt mode rejects it. The PATH guard is an additional barrier, not the source-build policy.
- `node scripts/with-zig.mjs --provisional /absolute/path/to/archive.tar.gz -- <command...>` accepts only the separately pinned experimental ARM64 archive in `scripts/libghostty/provisional.json`. It verifies the supplied bytes even when a cached copy exists, strips the archive's outer directory, and uses an isolated provisional cache. It never downloads or changes canonical release pins. This is an explicit validation route, not a validated release. Native acceptance is recorded separately.
- The producer verifies its checked-in dependency notices and source checks before building. The notice manifest is tied to the Ghostty commit and Zig version; upgrading either requires reviewing and repinning the license bundle. Existing assets are not repaired by a later manifest update.
- Explicit source build: `node scripts/with-zig.mjs --source -- <command...>`. This provisions checksum-verified Zig 0.15.2 and builds pinned Ghostty `a887df42c56f6de86c0fe6da9c4eeca37931e083`, with `ReleaseFast` unless overridden. The initial source build needs network access. Source mode uses the host's real SDK; no SDK substitute or xcrun shim is provided. Use a compatible SDK or prebuilt archive if native compilation fails. Do not run source mode on the protected original development Mac.
- Apple Silicon debug app: `TERAX_GHOSTTY_ARCHIVE=/absolute/path/to/core.tar.gz pnpm build:dev-app`. This builds the app with the development name and no updater artifacts or signing. No installation or launch is performed. Set `TERAX_GHOSTTY_ARCHIVE_DIR` to a directory of pinned per-target archive names for multi-target consumption. The wrapper will look for published assets if no matching local file is supplied.
- Commands are always registered. Without the feature, `gterm_available` returns `false` and every other `gterm_*` command returns `engine-unavailable`.

## Rust layout

```
src-tauri/src/modules/pty/
  engine/
    mod.rs        Pump (pure credit and timing logic), EngineHandle, the engine thread
    frame.rs      pure frame model and encoder, no libghostty types, fully unit tested
    snapshot.rs   libghostty RenderState -> frame model (feature gated)
    bench.rs      synthetic payload generators and the bench session (feature gated)
    fixtures.rs   test only: writes and checks tests/fixtures/terminal-frames
  gterm.rs        the gterm_* commands
```

`frame.rs` is the functional core: it takes a plain description of rows and cells and produces bytes. It compiles and is tested without the feature, so CI covers the codec on every platform even where Zig is absent.

### Threads per engine session

- **reader** (existing): reads the PTY, runs `AgentDetector` on the raw bytes exactly as today, then sends the chunk to the engine through a bounded `sync_channel`. It does not run `DaFilter`: device attribute and status queries are answered by the terminal through `on_pty_write`, which writes to the PTY writer.
- **engine** (new, `terax-pty-engine`): owns the terminal. Blocks on its queue, which carries only what must stay ordered: `Bytes(Vec<u8>)` and `Shutdown`, both from the producer side. Commands from the webview (credit, resize, colors, scroll, request full) never enter that queue: they are merged into a mutex-guarded control record and followed by a non-blocking wake, because they arrive on Tauri's command threads and a blocking send behind a flood would freeze the UI. The engine reads the control record after every message.
- **waiter** (existing): unchanged, except that it signals `Shutdown` after the reader reaches EOF so the last frame is sent before `on_exit`.

There is no flusher thread on this path.

### Frame pump

After every queue message (at most one 16 KiB chunk of output, so a flood cannot starve commands), the engine sends a frame when all of these hold: it has a credit, the render state reports dirty or a full frame was requested, and at least 4 ms have passed since the previous frame. The frame is built from `RenderState::update`, encoded by `frame.rs` and sent on the session's `Channel<Response>` as raw bytes. Sending consumes the credit. Dirty flags are cleared only for rows that were encoded.

A session starts with one credit and a pending full frame, so the first frame can leave before `gterm_open` has returned the id; the webview holds its credit until it knows the id. A credit counts only when it acknowledges the frame in flight; stale and duplicate credits are ignored. The frame sent at shutdown ignores the credit and the 4 ms rule, since nothing can follow it.

### Session integration

Engine sessions are ordinary `Session`s in `PtyState`, so `pty_write`, `pty_close`, `pty_has_foreground_job` and the rest work unchanged. `Session` gains an optional engine handle; `pty_resize` forwards the new size to it after resizing the PTY. `session::spawn` takes an output sink (`Raw` with today's flusher, or `Engine`) instead of growing a second copy of itself.

## IPC surface

| Command | Arguments | Returns |
|---|---|---|
| `gterm_available` | none | `bool` |
| `gterm_open` | `cols`, `rows`, `cwd?`, `workspace?`, `colors?`, `onFrame: Channel<ArrayBuffer>`, `onExit: Channel<number>` | session id (`u32`), usable with every `pty_*` command |
| `gterm_credit` | `id`, `seq` | nothing. Grants one credit; `seq` is the frame being acknowledged |
| `gterm_set_colors` | `id`, `colors` | nothing. Applies validated theme colors on the engine thread and requests a full frame |
| `gterm_scroll` | `id`, `delta` (rows, negative is up, into history) | nothing |
| `gterm_request_full` | `id` | nothing. The next frame is a full frame |
| `gterm_bench_open` | `kind` (`ascii`, `sgr`, `tui`), `megabytes`, `cols`, `rows`, `colors?`, `onFrame`, `onExit` | session id. No PTY: the engine is fed a generated payload as fast as it accepts it, then exits with code 0. Credits and frames behave exactly as in a real session |
| `gterm_bench_stats` | `id` | `{ bytesFed, frames, frameBytes, encodeMicros, sendMicros, creditWaitMicros, credits, scrollbackRows }`, valid until the session is closed. A bench session shares the id space of PTY sessions and is closed with `pty_close` |
| `open_terminal_lab_window` | none | nothing. Singleton window, label `terminal-lab`, page `terminal-lab.html` |

| `gterm_lab_autorun` | none | `string \| null`: the value of the `TERAX_TERMINAL_LAB_AUTORUN` environment variable (a result file path). When it is set, the app opens the Terminal Lab window at startup |
| `gterm_lab_report` | `json` (string) | nothing. Validates JSON, writes it to the autorun path, closes PTYs and exits |
| `gterm_lab_config` | none | `{ mode, count, holdMs }` from the lab environment: `bench`, `idle-engine` or `idle-xterm`, 1 through 12 terminals, 5 through 120 seconds |
| `gterm_lab_status` | `json` (string) | nothing. Writes validated JSON beside the report with the fixed `.status.json` suffix |
| `gterm_lab_capture` | raw PNG bytes, `x-lab-pane: engine` or `xterm` header | nothing. Writes a fixed adjacent `.engine.png` or `.xterm.png`; rejects invalid PNG, dimensions above 4096 and files of 400000 bytes or more |
| `gterm_lab_fixture` | `kind`, `megabytes`, `rows` | fixed payload path and byte length. Uses the same bounded Rust block generator as the engine bench |

Autorun reporting, status, capture and fixture commands require all three: the sandbox identifier, a calling window labeled `terminal-lab`, and an absolute `TERAX_TERMINAL_LAB_AUTORUN` path. They provide no webview-selected output path. Every command remains unavailable without the feature. `TERAX_TERMINAL_LAB_MODE`, `TERAX_TERMINAL_LAB_IDLE_COUNT` and `TERAX_TERMINAL_LAB_HOLD_SECONDS` choose the unattended mode. Manual lab use does not enable these writes.

`gterm_open` goes through the same workspace authorization as `pty_open` (`user_spawn_cwd_or_home`). Unknown ids return `no session`, like `pty_*`.

### Theme colors and statistics

`colors` is `{ foreground, background, cursor?, palette }`. Foreground, background, the optional cursor and every palette entry must be ASCII `#rrggbb` strings; the palette must contain exactly 16 entries. Rust rejects malformed colors before starting a session or queuing an update. The engine applies its initial colors before its first frame. Live changes are coalesced in the control record and produce a full frame after the outstanding credit returns. Palette entries 16 through 255 retain the terminal core's existing defaults. Omitting colors preserves the core defaults; omitting cursor resets the default cursor color.

The lab resolves theme tokens, including CSS color formats, into explicit RGB values before crossing IPC. A theme change while an open is pending is replayed after the session id arrives. Normal engine sessions similarly replay a changed size after opening; benchmark sessions do not invoke the PTY resize command.

The byte, frame, encoding, send-call, wait and accepted-credit counters are cumulative. `encodeMicros` includes snapshot extraction, binary encoding and the owned-frame copy. `sendMicros` measures the synchronous frame sink call (the native `Channel.send` call), not arrival or decoding in JavaScript. It includes failed sink attempts; per-successful-frame averages only describe clean complete runs. `scrollbackRows` is an instantaneous history-row gauge sampled on the engine thread at startup and after feeds and resizes, not a cumulative counter. A failed native query returns `null`, never an assumed or stale count. `credits` counts accepted acknowledgements only, excluding the initial credit and stale or duplicate acknowledgements. `creditWaitMicros` measures time when output or a full frame is pending but the pump has no credit, not total frame-to-ack latency. It was already cumulative before this handoff; regression tests cover successive waiting intervals without double-counting.

## Frame format v1

Little endian. Every section starts on a 4 byte boundary and the frame length is a multiple of 4, so the webview reads it through `Uint32Array` and `Uint16Array` views without copying. Colours are `0x00BBGGRR`.

### Header, 36 bytes

| Offset | Type | Field |
|---|---|---|
| 0 | u32 | magic `0x31465854` (`TXF1`) |
| 4 | u32 | `seq`, starts at 1, increases by 1 per frame sent |
| 8 | u16 | `cols` |
| 10 | u16 | `rows` |
| 12 | u16 | `cursor_x` |
| 14 | u16 | `cursor_y` |
| 16 | u8 | `cursor_style`: 0 hidden, 1 block, 2 bar, 3 underline, 4 hollow block |
| 17 | u8 | `flags`: bit 0 full frame, bit 1 cursor blinks, bit 2 viewport is not at the bottom, bit 3 grapheme table follows rows |
| 18 | u16 | `row_count`, number of row records |
| 20 | u32 | `default_fg` |
| 24 | u32 | `default_bg` |
| 28 | u32 | `cursor_color`, `0xFFFFFFFF` when the terminal sets none |
| 32 | u16 | `style_count` |
| 34 | u16 | reserved, zero |

A full frame carries every row of the viewport and replaces everything the webview holds for the terminal, including its size. A partial frame carries only changed rows; rows it does not mention are unchanged. A change of `cols` or `rows` is always a full frame.

### Style table, `style_count` entries of 16 bytes

| Offset | Type | Field |
|---|---|---|
| 0 | u32 | `fg`, bit 24 set when the cell has an explicit foreground, else use `default_fg` |
| 4 | u32 | `bg`, bit 24 set when explicit, else `default_bg` |
| 8 | u32 | `underline_color`, bit 24 set when explicit, else the resolved foreground |
| 12 | u16 | `attrs`: bit 0 bold, 1 italic, 2 faint, 3 inverse, 4 invisible, 5 strikethrough, 6 overline, 7 blink; bits 8 to 10 underline kind: 0 none, 1 single, 2 double, 3 curly, 4 dotted, 5 dashed |
| 14 | u16 | reserved, zero |

Entry 0 is always the default style (all zero). The table is per frame; ids are not stable across frames. Colours arrive already resolved against the palette. Inverse is not applied by the encoder: the renderer swaps.

### Row records, `row_count` of them

| Type | Field |
|---|---|
| u16 | `y`, viewport row |
| u16 | `run_count` |
| u16 | `cell_count`, cells encoded from column 0. Columns from `cell_count` to `cols - 1` are empty cells in the default style |
| u16 | `row_flags`: bit 0 soft wrapped; bits 1 to 2 semantic prompt: 0 none, 1 prompt, 2 continuation |
| `run_count` x (u16 `style_id`, u16 `len`) | style runs, lengths sum to `cell_count` |
| `cell_count` x u32 | cells: bits 0 to 20 codepoint (0 is empty), or frame-local table index when bit 29 is set; bit 30 spacer tail, bit 31 wide head |

Trailing cells that are empty and in the default style are not encoded. Rows appear in increasing `y`. Simple scalar frames remain byte-for-byte identical to the original v1 format.

When header flag bit 3 is set, rows are followed by a frame-local UTF-8 grapheme table: u32 entry count, then each entry as u32 byte length, exact UTF-8 bytes and zero padding to four-byte alignment. Cell bit 29 selects a table entry using bits 0 to 20; the native wide-head bit remains independent. Spacer tails cannot reference text. The decoder rejects a tag without its table flag, invalid indices, truncated/oversized entries, invalid UTF-8, nonzero padding and entries with fewer than two scalars. Leading U+FEFF is preserved, with no normalization. Bounds are 250000 entries, 1 MiB per entry and 8 MiB for the complete table including lengths/padding. Encoding over a limit fails explicitly rather than publishing a prefix.

Native cluster boundaries and cell widths follow the core's negotiated mode. Compatibility mode is preserved by default; programs can request DEC mode 2027 for Unicode grapheme clustering (ZWJ emoji, skin tones and regional-indicator pairs). The renderer does not merge adjacent native cells or force that mode globally. Resetting the mode preserves already stored clusters.

Snapshotter reads the complete cluster, including the base scalar, from the pinned render-cell graphemes_utf8 API. IDs belong only to that frame. The renderer resolves text before discarding the frame and keys the atlas by full cluster, face and native width, never by frame-local ID. The GPU grid retains only glyph slots and colors; bounded glyph keys are not a JS terminal-history cache. Optional table strings are decoded once per unique entry, while row/style views still alias the received buffer.


Header flag bit 4 appends a native graphics packet after rows and the optional
grapheme table. Its u32 header is version 1, native cell width/height in pixels,
image upload count and visible placement count. Each upload is u32 image ID,
u64 generation, u32 width, height and RGBA byte length, followed by exact RGBA8
pixels. Each placement is u32 image ID, u64 generation, i32 z, i32 viewport
column/row, u32 pixel offsets x/y, u32 source x/y/width/height and u32 rendered
pixel width/height. All fields are little endian and four-byte aligned.

Generations retain all 64 bits and are process-wide native content identities.
Every packet replaces the complete visible placement set; an empty set clears
images. Partial frames upload only newly visible or replaced image generations.
Full frames include every referenced pixel payload, allowing reconstruction
after hiding, detaching, or losing the context. Scrolling/resizing recomputes
geometry even when image content generation is unchanged. CPU cache entries own
pixel slices and compact placement metadata, without retaining complete IPC
buffers. Same-size replacement uses a new generation, not a dimension heuristic.

Native screen storage is limited to 16 MiB; PNG decode and frame uploads to
32 MiB, image dimensions to 8192 and visible placements to 4096. Cell dimensions
are 1..512 device pixels. The shared window image cache is bounded to 128 MiB
of CPU pixels with corresponding GPU textures, allocated only when used.
File, temporary-file and shared-memory image media are refused. Ghostty can
restore default storage quotas when initializing or resetting a screen, so the
shared native feed enforces policies before/after input and immediately after
APC introducers, before image data can be processed. It preserves exact input
bytes and the native parser state across fragments. Both ordinary and blocks
paths use this feed.

The existing shared WebGL2 context draws images with native source crops,
signed viewport positions, pane scissoring and three z layers: below
non-default cell backgrounds, below text and above text, with alpha blending.
Equal z values use image ID order. Default text-only panes retain one grid draw.
No JavaScript VT/image parser, filesystem loader or additional GL context is
introduced. Hidden image panes drop their graphic cache and require full
reconstruction on reveal. Context loss defers all glyph/image work and
invalidates affected image geometry; full frames reconstruct afterward.
Shader/texture capacity errors use the existing bounded visible-error path.

Physical cell metrics reach both core and PTY through gterm_resize; metric-only
updates preserve the actual kernel grid. Coalesced native grid/pixel updates
preserve admission order, including metrics changed before opening resolves.
Direct Kitty RGB/RGBA/PNG placements are implemented. Unicode virtual placements,
Sixel, iTerm images and terminal-driven image animation are not claimed by this
slice. See docs/plans/2026-11-15-terminal-native-images.md for evidence and scope.

The extended renderer has an 8 MiB bound for retained UTF-16 cluster keys in addition to existing mono/color texture bounds. Capacity exhaustion never silently returns an empty glyph. One automatic cache reset is allowed per participating visible pane within a recovery epoch; the epoch renews only after all visible panes rebuild full frames. A working set that still cannot fit blocks the affected view with a visible error. Credits and native terminal state continue, presented geometry is invalidated, and blocked views do not request endless full frames. Explicit Redraw or a font/DPR rebuild starts a new attempt. Hidden panes do no glyph work, retain a full-rebuild requirement and reconstruct when shown; they cannot participate in a hidden retry cycle.

Both producer and decoder ship in the same application build. Legacy decoders reject the optional table as trailing bytes; do not mix old assets with an extended producer.

## Webview layout

```
src/modules/terminal/gl/
  frameCodec.ts      pure decoder for the format above, plus a test-only encoder
  glyphAtlas.ts      shared atlas, coverage page and colour page
  gridRenderer.ts    one WebGL2 context, panes, instanced draw, context loss
  engineSession.ts   gterm_open, frame application, credit return, input, resize
src/terminal-lab/    the Terminal Lab window (entry `terminal-lab.html`)
```

The renderer starts from `spikes/terminal-ghostty-vt/web/renderer.js`. Each pane keeps one `Uint32Array` instance buffer and uploads only the rows a frame touched. The renderer never reaches into Tauri; `engineSession.ts` is the only file that calls `invoke`.

Credit return: after applying a frame, wait for the next `requestAnimationFrame`, draw, then call `gterm_credit` with the frame's `seq`. Never return a credit for a frame that has not been drawn.

## Fixtures

`tests/fixtures/terminal-frames/<name>.frame` holds a frame exactly as Rust encodes it and `<name>.json` describes what it must decode to:

```json
{
  "seq": 1, "cols": 80, "viewportRows": 24, "full": true, "viewportScrolled": false,
  "cursor": { "x": 0, "y": 0, "style": "block", "blink": false, "color": null },
  "defaultFg": "#rrggbb", "defaultBg": "#rrggbb",
  "rows": [
    { "y": 0, "wrapped": false, "prompt": "none", "text": "hello",
      "runs": [ { "start": 0, "len": 5, "fg": "#rrggbb", "bg": null, "underlineColor": null, "attrs": ["bold"], "underline": "none" } ] }
  ]
}
```

Cursor styles are `hidden`, `block`, `bar`, `underline` and `hollow-block`. `text` is the row with empty cells as spaces, trailing spaces removed; a wide cell contributes its character once and its spacer tail contributes nothing. The Rust test regenerates both files when `UPDATE_FIXTURES=1` and otherwise fails if its output differs from the files on disk. The TypeScript test decodes every `.frame` and compares it with its `.json`. At least: plain text, styled runs with palette and truecolor, wide and combining characters, a partial frame, an alternate screen repaint, a cursor of each style.

## Measurements phase 1 must produce

Recorded in the plan under the spike results, from the sandbox build on the engine feature:

- frames per second and bytes per second delivered over the `Channel` for 1 and for 12 concurrent bench sessions per payload kind, with the webview's frame interval percentiles while they run;
- time from `gterm_credit` to the next frame arriving (credit round trip);
- keystroke echo: from sending one byte with `pty_write` to the frame that shows it being drawn, on the engine and on an xterm.js pane in the same window;
- resident memory of the app with 12 idle engine terminals with 10 000 lines of scrollback each, against 12 xterm.js terminals.


### Scrollback budget and idle-memory validation

The pinned Ghostty implementation interprets `TerminalOptions.max_scrollback` as a byte budget, despite the safe wrapper's line-oriented documentation. Normal engine sessions use an explicit 16 MiB page budget. Pages are allocated lazily; this is neither a 16 MiB initial allocation nor a guarantee of a fixed number of rows at arbitrary widths or content. Production xterm settings are unchanged.

The lab clears initial history, fills its 100 by 30 terminal deterministically and verifies `scrollbackRows == 10000` before reporting `idle-ready`. xterm verifies its actual history count independently. A failed count prevents the memory comparison from passing. The external runner records the summed process names and states that RSS can double-count shared pages; it does not claim PSS.


### Optional phase 1 stage profile

`gate-engine-profile` runs the same fixed three generators, twelve 100x30 grids,
1024 MiB per session and two repetitions as `gate-engine`. It enables optional
JavaScript callbacks for decode, apply/upload, ready-to-draw wait, one shared
draw-submission sample per rAF, and the reply to each credit command. Timestamps
are local to JavaScript; do not subtract them from Rust's monotonic clock or
sum percentiles to attribute latency. Browser clock quantization still applies.

A credit-command reply means the native command registered control state,
not that the engine thread accepted the credit. `credits` remains the actual
accepted-credit counter. Draw timing is CPU/driver submission, not GPU
execution or display presentation. Coalesced frames retain their own receive
and credit data but have no invented draw timestamp.

Profiles keep ordered session/sequence tuples, missing and failed reply
counts, and exact column names. Benchmark wall time and rAF sampling stop at
the normal final-frame barrier; up to 5 seconds of reply draining is reported
separately. A missing credit or reply makes the profile incomplete. Compact
JSON preserves all events under the unchanged 16 MiB bound; excessive reports
fail explicitly. The normal gate does not allocate these tuples or enable
JavaScript timing callbacks. The new native send-call counter is collected
for both variants. Profile overhead must be reported and held constant in any
subsequent credit-batching comparison.


### Lab-only credit batch comparison

`gterm_lab_credits(credits)` is an autorun-only sandbox command accepting 1 to
12 distinct `{ id, seq }` pairs, positive u32 values, with unknown fields
rejected. Every id must resolve to a bench session before any control is
registered. It never accepts a real PTY id. The existing engine credit method
and Pump acceptance rules remain unchanged. Replies confirm control
registration, not accepted-credit counts.

`gate-engine-batched` and `gate-engine-profile-batched` opt into one window-local
sender. It dispatches from a microtask after the shared renderer's draw task,
without another rAF. Drawn credits waiting for an id retain their draw time.
Duplicate outstanding pairs fail explicitly; different sequences of one id
remain in separate ordered invocations. The combined queued/in-flight bound
is 48 acknowledgements. Overflow, rejection, incomplete registration or
cleanup failure cannot count as success. Normal modes keep their existing
individual command path and allocate no batcher.

Profile credit timestamps mark dispatch, not enqueue. The candidate reports
actual invocation counts, batch-size frequencies, command registrations and
bounded count/sum/min/max draw-to-dispatch and queue-to-dispatch aggregates.
These are not inferred percentiles or Pump acceptance. The same final-frame
barrier and bounded out-of-interval reply drain apply. The workload and
measurement order are registered in
[the credit batching experiment](../plans/2026-11-14-terminal-credit-batch-experiment.md).
No graphical result has been collected for this candidate.


### Failed engine and incomplete output

Panic conversion below applies to unwind builds, including the current
optimized dev-profile sandbox. `Cargo.toml` still sets release `panic=abort`:
a release panic aborts the process and cannot be converted by `catch_unwind`.
No release panic-isolation claim is made; rollout must verify its actual
profile and failure behavior. Explicit channel/snapshot errors do not require
unwinding.

`onExit` reserves `-2` for an unusable terminal output pipeline, distinct from
the child's normal exit status and the existing `-1` wait/cancel error. A closed
frame sink, failed snapshot or engine panic is sticky. `EngineThread.join`
returns failure even when every input byte was parsed or the child exited 0.
A benchmark cannot count a rejected final frame as success.

Failure subscription is atomic with the first failure and invokes listeners
outside its mutex. A PTY subscribes before starting its reader. Its exit
callback is consumed once, with the unusable flag set first; registry removal
and exit notification precede normal detached teardown scheduling. Teardown
must not block the engine thread under ordinary scheduling, particularly when
ConPTY is waiting for the reader. If teardown scheduling itself fails, failure
notification has already been attempted; complete cleanup under OS resource
exhaustion is not claimed.

The isolated engine still parses queued input after a frame sink closes, as
its existing no-drop test requires. Its owning session is invalidated and
closed rather than pretending the unseen output is healthy. An input producer
that discovers the engine receiver gone reports failure and stops; it does
not continue a discard loop. The engine receiver remains owned outside the
unwind boundary until panic health notification has been recorded.

Healthy PTY completion requires confirmed reader completion and successful
engine join before propagating the child status. Windows retains its existing
50 ms reader wait and shutdown/cleanup order: an unconfirmed drain is now an
explicit failure, not an assumed successful final snapshot. This is a
conservative guard, not proof of correct ConPTY draining or Windows parity;
it may reject a tail that would eventually drain. Windows final floods,
quick exit, descendants and pseudoconsole lifecycle still require native
validation and a supported drain implementation before release acceptance.

The webview fixes failed state before calling observers, reports `-2`, rejects
an open whose id arrived after failure and blocks further writes, credits,
resize, scroll and color controls. An observer exception cannot erase the
failure or prevent the exit callback. Already-drawn pixels can remain visible;
they are not evidence that the failed session consumed later output.


### Window frame envelope: codec preparation

The registered window-delivery experiment adds an autorun-only envelope,
`TXW1`, around unchanged V1 frames. Only its pure decoder is implemented at
this stage; no native transport or candidate lab mode is connected yet.
Production xterm and ordinary engine sessions remain unchanged.

All integers are little endian. The header is u32 magic `0x31575854`, u16
member count (1 through 24), and zero reserved u16. Each member is u32 route
(0 through 11), u32 frame byte length, then that complete V1 frame. Lengths
are multiples of four, at least 36 and at most 256 KiB. The exact final offset
must equal the envelope length; the envelope limit is 8 MiB. The native
transport must separately reserve its entire original-plus-envelope memory
peak within 8 MiB, including queued and in-flight originals and headers.
This is an owner allocation bound, not a Tauri/WebKit or whole-process bound.

The receiver registers a route before starting its producer. It validates the
whole envelope and every complete inner V1 frame before applying any member.
Unknown/closed routes, malformed data or noncontiguous sequences invalidate
the run. The decoder checks ordering within an envelope; the receiver must
also enforce continuity across envelopes before mutation. `decodeFrame` can
read an aligned, bounded byte region of the received ArrayBuffer. Inner views
alias that buffer, and the prepared session hook must consume those validated
views once rather than copying or decoding them again.

The optional stage profile appends `validationWaitMs` after `creditReplyOk`,
leaving earlier tuple indices unchanged. It is finite and nonnegative, with
its own distribution. Direct frames default to zero; the window candidate
will report the time between a member's validation and application after the
whole envelope is validated. Keep this wait separate from decode/apply CPU
durations and from the subsequent ready-to-draw interval. This preparation
has no graphical or performance result. The execution order and decision
limit are in the registered window-frame experiment plan.


### Current migration priority

The user's [2026-11-14 priority update](../plans/2026-11-14-terminal-migration-priority.md)
makes 60 FPS optional. Existing negative measurements remain evidence, but
no longer gate normal-pane integration. The window transport experiment is
deferred. Continue functional migration and the full parity inventory; do not
substitute laboratory or benchmark work for a usable new-engine terminal.


### Normal-session lifecycle adapter

`modules/terminal/lib/terminalEngine.ts` defines the shared transport/lifecycle
surface: id, write, awaitable resize and close. The existing PtySession is
structurally compatible; `ghosttyEngine.ts` explicitly adapts EngineSession
using `resizeAndWait`, which returns the actual native `pty_resize` promise.
The existing fire-and-forget resize entry remains for its existing callers.

TerminalSessionController opens one driver, keeps startup input in order,
serializes writes, coalesces resize in an independent loop, retains the first
exit/failure and retires each acquired resource once. Its close promise waits
for pending acquisition and the driver's close result; failed initialization also closes
an acquired resource. Cleanup failure is reported without replacing the
original cause. The startup limit retains the existing 262144 UTF-16 code-unit
bound and rejects overflow explicitly without discarding accepted input.

`opened` means transport acquisition and initialization, not prompt-ready or
TUI-ready. Real shell/protocol signals remain required for agent restore and
tasks. This adapter is preparation for normal panes; the UI, text/selection,
search, cwd and application consumers are not yet connected by this slice.
It creates no benchmark or laboratory behavior.

Validation on M2: 40 focused lifecycle/EngineSession tests passed, including
observed-red ordering, teardown and failed-initialization regressions. Full
`pnpm lint`, `pnpm check-types`, `pnpm test` (2325 passed, one existing skip),
`pnpm build`, `pnpm --dir packages/pi-terax test` (101), and
`node --test scripts/*.node-test.mjs scripts/libghostty/*.node-test.mjs` passed.
Strict `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked
-- -D warnings` and `cargo test --manifest-path src-tauri/Cargo.toml --locked`
passed bare and through the verified prebuilt wrapper with
`--features ghostty-engine` (588/629 unit, 58 integration, 1/2 ignored).
`git diff --check` passed. One new test's Array.at was replaced with ordinary
last indexing for the existing TypeScript target; no check was relaxed.
Astra reviewed the final implementation and found no residual blocker.
Native normal-pane integration remains required before claiming delivery.


### Native text queries for normal-pane consumers

`gterm_read_text(id, maxLines)` returns a string from the native terminal's
active screen, including its history. Limits are 1 through 1000 physical rows
and 1 MiB of formatted UTF-8. The range is the screen tail, independent of the
current scroll viewport. A temporary selection formats that range without
changing the user's selection; full combining/wide text is preserved and
physical wrapped rows remain separate. Blank trailing rows are removed.

Requests run on the terminal's owning thread through a control mailbox with
at most 32 queued and in-flight requests. A full byte/wake queue does not block
registration. Control snapshots preserve the pending count while requests are
being formatted. Engine termination/panic rejects remaining requests; a failed
frame pipeline cannot supply valid context. Formatting errors and overflow are
errors, never truncated or synthetic success. The pinned wrapper's empty-size
bug is avoided with the selection formatting API, which preserves empty
success and required length before exact bounded allocation.

The asynchronous Tauri command waits on a worker with a 2 s receive timeout.
This limits caller waiting, not necessarily work already queued on the actor.
No extra polling, idle thread or per-frame query is introduced. Without the
feature the command returns engine-unavailable. It is not added to Pi/MCP.
EngineSession.readText validates limits, response type and session health/
identity before and after the await. Application consumers must separately
recheck active pane, privacy and redaction policy after asynchronous reads.

This slice supplies the real native read surface, not completed AI/task
integration. Currently normal PTY completion still shuts down the actor and
reaps Session; retaining the grid after process exit remains required before
normal-pane parity. Driver close acknowledgement also does not by itself
prove native OS Drop has completed; existing pty_close may detach that cleanup.
The forthcoming retained-core lifecycle must verify that boundary explicitly.

M2 verification: frontend/Pi/Node and build/type/lint gates passed (2327
frontend tests, one existing skip; 101 Pi). Strict Clippy and locked Rust tests
passed bare (588 unit, 58 integration, one ignored) and with the verified
prebuilt ghostty-engine feature (637 unit, 58 integration, two ignored).
`git diff --check` passed. The first full feature run exposed the empty-size
wrapper bug; its isolated regression was observed failing, fixed through the
existing selection API, and the entire floor was rerun green. Astra reviewed
both the query boundary and final empty-output helper without blockers.
No benchmark, Actions, push, merge or original-Mac native build occurred.


### End of input versus actor shutdown

EngineInput.finish fences the producer stream in the same ordered byte queue
and returns a completion receipt. A shared input gate serializes accepted
feeds with Finish/Shutdown; new output and repeated Finish are rejected after
the fence. Control wakeups remain independent and non-blocking.

Finish sends any final pending snapshot under the existing final-frame policy,
propagates a failed sink/snapshot through engine health, releases the PTY
reply writer and its buffered bytes before confirmation, then leaves the
native terminal actor available for text queries and presentation controls.
Subsequent presentation frames use ordinary credits. Shutdown still terminates
the actor and does not repeat the input finalization. Neither blocking input
operation may be called synchronously from an actor callback; such teardown
must run outside the actor.

This checkpoint is the actor transition, not completed PTY retention. The
current process waiter still uses Shutdown and joins the core on child exit.
A separate normal-core owner, native cleanup and post-exit core-failure
notification remain required before the normal UI can retain history.

M2 checks passed: 26 actor tests including four new Finish regressions,
strict writer-Drop-before-receipt assertion, full frontend/Pi/Node floor,
production build, Clippy and locked Rust tests bare (588 unit, 58 integration,
one ignored) and with the verified prebuilt feature (641 unit, 58 integration,
two ignored), and git diff --check. Astra reviewed concurrency and lifecycle
without a residual blocker. No benchmark, Actions, merge or push ran.

### Native process exit and pane lifetime

Native PTY cores are reserved before process startup and owned separately from
OS sessions. Closing a pane invalidates that reservation before removing the
PTY, so a late open cannot publish a new session into a closed pane. A healthy
process exit drains accepted input, awaits the final frame submission, releases
the reply writer, and reaps the OS session while retaining terminal history and
presentation until pane close. This does not mean the frontend has drawn that
last frame; display credits still follow the existing contract.

`gterm_resize` updates the live PTY and core together; after confirmed process
exit it updates retained presentation only. Scroll, colors, redraw and bounded
text queries remain usable after ordinary exit, while input is stopped.
`gterm_open` supplies a separate `onFailure` channel so a subsequent core failure
is observable without replacing or duplicating the process exit. Failed or
closed cores reject queries. Actor-side failure observers use weak ownership
and nonblocking stop requests; pane close joins the actor outside locks. OS
session disposal remains asynchronous, especially for ConPTY, and its completion
is not established by the core join alone. Windows runtime validation remains
pending. Ordinary native-pane integration is described below; these lifecycle tests
alone do not establish full terminal parity.

### Asynchronous terminal text consumers

`TerminalPaneHandle.getBuffer`, live AI context, managed-agent output and task
handoff accept both synchronous legacy text and asynchronous native text. Every
consumer awaits the result before slicing or comparing it. AI reads capture
and recheck the owning tab, leaf, handle and privacy after awaiting, then apply
the existing secret redaction. A failed query or changed target yields no text;
a valid empty screen remains empty, so a booting agent is not mistaken for a
closed pane. Managed-agent output additionally revalidates the chat/agent
association and returns its current status. Task confirmation awaits both the
baseline and subsequent buffers; missing or rejected text is never evidence
that a turn started. App task readers reject a response from a replaced handle.
Ordinary native panes now use this real bounded query. Consumer scenarios
still require the complete parity verification; viewport projection is not history.

### Negotiated native input surface

`gterm_encode_input` accepts a closed typed key/paste/focus request, reserves
one of 32 per-core RAII admission slots before creating a blocking worker, and
encodes it on the terminal actor behind previously accepted output. The same
producer gate orders it against Finish, so completed input cannot acquire new
encoding requests. Presentation and retained history remain independent.

The pinned Ghostty encoder reads the live terminal's application cursor/keypad,
modifyOtherKeys and Kitty modes. Paste uses the current bracketed-paste mode;
focus is emitted only when requested. DOM physical key codes map to a closed
native enum; key text is capped at 4 KiB and paste at 1 MiB. Unknown codes,
modifier bits and invalid consumed modifiers are rejected. The native result
contains bytes, not a PTY write; the session revalidates its identity and state
before sending those bytes. Valid empty encoding causes no write. In particular,
Kitty Enter/Backspace/Tab releases additionally require REPORT_ALL.

`EngineSession` serializes raw writes, native keys, paste, focus and encode-only
queries through a 1 MiB input budget with a minimum event cost. It validates
returned bytes and drops replies after close, failure or process exit. The
native receipt timeout is two seconds after ordered enqueue; it is not an
end-to-end deadline and does not cancel queued work. An abandoned encoding
cannot independently write to the PTY. The pinned `encode_to_vec` growth helper
is avoided in favor of a bounded explicit buffer and required-size retry.
Ordinary-pane input uses these APIs as described below. The existing lab input
binding remains Phase 1; its checks do not establish product input parity.


### Ordinary and blocks panes

`NativeTerminalPane` owns the view for ordinary and blocks panes. Native blocks mount the shared `BlockOverlay` and `BlockWatermark` through one `NativeBlockView` per `EngineSession`.

`NativeLeafSession` lives in the leaf registry independently of React mounts.
Splitting, moving or hiding a pane detaches its input/view without terminating
the process. Explicit leaf disposal closes the native core and controller;
respawn waits for the shared retirement promise and preserves close failure.
Callbacks target the current view, survive observer exceptions, and preserve
pending exit/error information. Deferred clipboard reads cannot target a new
process after respawn. Native facade helpers route writes, paste, submit,
interrupt, PTY identity, selection, repaint, foreground queries and respawn.

`NativeTerminalSurface` shares one GPU context and glyph atlas across ordinary
panes. Every renderer acquisition creates its own canvas: renderer disposal
intentionally loses the context, so the old canvas cannot be reused during hot
reload. Context/hook exports live outside the component refresh boundary.
Reattaching a live engine to another renderer preserves its core ID and input
state, requests a full frame, and recovers outstanding display credit only
through the next display attempt. Failed renderer migration explicitly
invalidates the session instead of leaving an apparently live removed pane.

`gterm_state` and the `onState` channel publish versioned actual native modes,
including alternate screen and negotiated keyboard/paste/focus settings. The
client validates their fields and version order. Shell readiness is not inferred
from opening or from these modes. A bounded native XTMODKEYS observer preserves
the product's legacy Shift+Enter when no foreground keyboard protocol was
requested; encoding itself remains native and ordered behind accepted output.

`gterm_selection` runs closed typed gestures on the actor and returns bounded,
UTF-8 checked native selection text. Queries share bounded admission with text
reads and are available after healthy process exit. Mutations request repaint
even if text formatting fails; the frontend invalidates stale cached selections
and publishes only the latest acknowledged query. Selection highlighting uses
native selected cells. The ordinary DOM binding uses the existing composition
commit policy, the negotiated native encoder, real clipboard APIs, focus
reports, wheel/page navigation and per-pane pointer coordinates.

#### Copying from an agent pane

Agent TUIs such as Claude Code wrap paragraphs themselves: every row ends in a
real newline and continuation rows are indented, so the engine has no soft-wrap
flag to undo and a plain copy has the shape of the screen. While the agent
detector reports an agent in the pane, Copy (Cmd+C, Ctrl+Shift+C, and Copy in
the context menu) rejoins the rows the width forced apart and keeps what the
author wrote: blank lines, list items, tool output, tables, boxes and code.
When that changes the text, the context menu also offers **Copy as shown**,
which writes the selection exactly as it is on screen. Panes with no agent
running are never touched, and neither are the other selection actions (Ask
Terax, Add to Note, Speak).

The rule lives in `src/modules/terminal/lib/agentCopy.ts` as a pure function
of the copied text and the pane width. Two rows are joined only when the
second continues the paragraph of the first (same text column, no marker of
its own) and its first word would not have fit on the first row. A paragraph
with two or more breaks the width does not explain is left alone, because an
agent can print a code block at the text indent with no fence. Known limits:
text that was wrapped for a narrower pane than the current one is not
rejoined, and a short code block whose rows all reach the edge can be joined.

Capture uses required per-pane crop providers, with pixels frozen before font
and image awaits. The shared source canvas is excluded from DOM compositing so
it cannot cover dividers and other chrome. A required provider cannot silently
fall back to a transparent canvas. A pane hidden during capture preparation is
rejected. Explicit inactive native-pane capture uses an owner-guarded frozen full frame
and a temporary software canvas without focusing the tab. Existing
private-terminal capture guards still apply.

The real M2 normal sandbox now proves startup, text input, split, tab
hide/show, mouse focus, surviving-pane close, renderer replacement and scoped
capture. This is narrower than terminal parity. Links, blocks, remaining settings, TUI mouse reporting, full graphemes,
platform validation and rollout remain open in the parity inventory.


### Native shell state and readiness

Ordinary native spawns generate a fresh 128-bit correlation token and pass it
only to their shell and engine. Shell profiles add `aid` to OSC 133 A/B/C/D for
these sessions; command text on C uses the supported `cmdline_url` option.
Raw spawns remove an inherited native token, keeping the existing unsigned
marker output. Windows forwards the native variable through WSLENV; runtime
acceptance of fish, PowerShell and WSL remains pending.

The Rust actor runs a bounded OSC 7/133 metadata observer on accepted bytes
before feeding the unchanged byte slice to Ghostty. It skips other OSCs and
opaque control strings, handles fragmentation/cancellation and bounds decoded
CWD to 128 KiB. Authenticated command markers are bounded to 3 MiB plus 512
bytes of envelope; decoded command text is bounded to 1 MiB. Oversized or invalid
command values become unavailable as a whole, never a reexecutable prefix. Only correctly correlated A/D
opens a CWD window; B/C closes it. Unmatched output cannot unlock that window.
Decoded paths must be absolute, valid UTF-8 and control-free. Windows drive
URIs are normalized. The token correlates local shell integration; it does not
isolate a malicious local process that can inspect its inherited environment.
Neither token nor command text enters EngineState, Pi snapshots or diagnostics.
Native core `pwd()` and semantic row flags are not the trusted CWD source.

EngineState now contains bounded `cwd`, `shellReady` and `commandRunning` beside
the native input modes, with one version covering all fields. Unchanged state
is coalesced; no frame polling or extra per-keystroke query is introduced.
Readiness follows a genuine CWD/prompt marker, not engine opening. Native leaf
adapters deliver CWD to the existing pane tree/app callback and mark the shared
session-ready waiters. Remount delivers the cached CWD to the new view. Closing
invalidates the observer generation before any await; respawn/exit/failure
clears readiness and late state cannot mark a retired process ready again.
Readiness callback exceptions cannot prevent process retirement. The existing
whenSessionReady timeout fallback remains compatible; timeout does not set the
ready flag and is not evidence of an initialized shell.

M2 normal-window evidence covers zsh CWD in independent splits with Unicode and
spaces, focus and tab return, and rejection of unsigned D/A plus OSC 7 while a
command remains running. Actual zsh/bash profile output and native ordered
state have regression coverage. Broader restore/task/agent scenarios and other
platforms remain open in the parity inventory.


### Native header search in ordinary panes

The header accepts a minimal TerminalSearch interface shared by native and
legacy terminals. The legacy adapter retains its actual SearchAddon and
existing decorations. The native adapter submits ordered gterm_search queries;
it does not reconstruct history from frames or the bounded text-tail API.
Incremental input coalesces only adjacent unsent incremental queries. Explicit
navigation and clear remain ordered. Per-generation ownership and post-reply
checks prevent an old search from acting on a replacement process.

The actor searches the active screen's retained native history, including soft
wraps, literal case-insensitive Unicode, combining clusters and wide cells.
Only active match endpoints are tracked core references; pruning/reflow update
those anchors. Queries are at most 4096 UTF-8 bytes without controls; the
on-demand text index is bounded to 64 MiB and invalidated by input or resize.
Text/selection/search share the existing 32-request admission before blocking
workers. Receipt timeout is 10 seconds and does not cancel already accepted
actor work. Search remains available after healthy process exit until close.

Visible matches and the active match use the existing header colors in the
native frame projection, independently of user selection. No frame ABI change
is needed. Inactive search reads no history and allocates no overlay. Active
search refreshes viewport highlights with wrap context; contextual Greek sigma
queries require complete logical-line context. Normalization operates on joined
text and verifies transformed byte offsets before mapping native grapheme cells.
Overlapping matches retain active-color priority. An overlay error clears search
and forces a full redraw so stale highlights cannot survive.

The UI handles asynchronous errors for the current target, clears on target
change, and restores terminal focus on Escape. No search text or terminal text
is added to app snapshots, the Pi bridge or logs. Functional M2 evidence and
remaining scope are recorded in the native-search report; this does not close
the full migration or prove Windows/Linux runtime acceptance.

### Native URL, OSC 8 and file links in ordinary panes

The app queries gterm_link_context for the actually drawn sequence and cell,
not the newest applied frame. Snapshotter owns immutable link metadata for
three frames, sharing unchanged rows. Grapheme text and OSC 8 URIs are captured
during the existing dirty-row traversal; no idle polling or frame ABI change is
introduced. Link queries share the 32-request text/selection/search admission
and a two-second receipt timeout. Accepted work is not cancelled by that timeout.

Logical context includes soft wraps and bounded adjacent history. Native gaps
and clipped edges remain explicit, so a truncated path cannot become another
valid file. UTF-16 cell spans preserve wide tails and combining clusters. OSC 8
takes precedence over label detection; an unsupported or unavailable URI does
not fall back to the visible label. HTTP(S), mailto and tel use the existing
external opener. Local/localhost file URIs and plain file paths use the existing
human editor route, with CWD/home resolution and optional one-based line/column.
fs_stat establishes existence/type, not authorization. AI filesystem and command
authorization remain separate and unchanged.

Hover and activation bind to process, workspace, CWD/home and geometry. Pointer
down retains the drawn destination across later output; drag, secondary clicks,
replacement owners and changed scope cannot activate it. Geometry-only changes
request a draw notification before hit testing resumes. Primary pointer default
is prevented to preserve textarea focus; secondary/context-menu behavior stays
available. File activation waits for a committed active editor and a created,
ready CodeMirror view before consuming the pending location.

No terminal text, URI, shell token or new command is exposed through Pi snapshots.
M2 functional proof and capture limits are in the
[native links report](../plans/2026-11-15-terminal-native-links.md).
This does not establish full grapheme rendering, other-platform runtime parity,
or captured DOM hover overlays.


### Native command-block core (opt-in, UI pending)

gterm_open accepts optional blocks, default false, and passes one explicit
value to the shell profile and actor. Child setup clears inherited TERAX_BLOCKS
and its WSLENV variants; only explicit WSL blocks sessions forward that flag.
Ordinary blocks panes remain on the legacy route until their consumers are
integrated.

The shell observer emits authenticated C/D events exactly at marker byte
terminators. The actor feeds every original VT segment before observing its
event; a metadata failure still feeds the rest of the batch, then enters the
existing visible failure path. Non-block sessions allocate no BlockStore and
retain the existing feed path. Command metadata remains outside public state.

BlockStore retains bounded metadata and native tracked endpoints, not output
copies: at most 1000 completed entries plus one live entry and 4 MiB allocated
metadata. Reflow resolves through the native references; reclamation/reset
returns unavailable rather than retargeting offsets. Empty/CRLF ranges exclude
the next prompt. Completed output reads cap at 1 MiB and do not mutate the
user selection. EOF finalizes live metadata once with unknown exit status;
healthy post-exit queries remain possible until explicit close.

gterm_blocks and gterm_read_block are internal Tauri queries sharing the
32-request text/selection/search/link admission. IDs validate before admission.
The receipt timeout is two seconds; it does not cancel accepted work. Disabled
sessions fail explicitly. State carries only blocksEnabled and
blocksMetadataVersion; the revision covers metadata, not geometry. Viewport,
reflow, alternate screen and live endpoints require frame/resize projection.

Native row-reference lifetime does not establish immutable completed-cell
content. Cell overwrite/erase damage, full submitted command capture and the
existing blocks UI/drafts/actions remain prerequisites for ordinary native
blocks rollout. See the [native block-core report](../plans/2026-11-15-terminal-native-block-core.md)
for real-PTY evidence, gates and the remaining parity scope.


### Native block input ownership and frame projection

NativeLeafSession allocates NativeBlockInput only for an explicit blocks owner.
The chosen mode survives view detach/remount; drafts remain in memory per leaf
through process respawn, matching existing draft persistence scope. Initial
readiness and the submission-to-marker gap disable direct grid typing. A real
running command or alternate-screen program can own direct input. Input policy
changes notify views even when both phases have the public running mode.
Prompt focus goes to the shared ShellInput editor; leaf activation happens in
pointer capture before a child can cancel default focus.

Each authenticated OSC 133 B increments promptVersion in shell state. A repeated
prompt is observable even when no command block starts, such as after a shell
comment. The submission gap ends on newer authenticated block metadata or a
new prompt revision. Tokens and command text remain outside public snapshots.

Submission acceptance revalidates process identity, owner, generation and
lifecycle after awaiting native input. Draft settlement belongs to that owner
and draft revision, independently of the currently mounted editor. Every edit
updates its owner immediately; cleanup does not restore a stale draft. The
shared editor preserves rejected submissions, prevents duplicate pending Enter,
and drops late current-view updates after retarget or destruction.

gterm_blocks optionally accepts a presented frame sequence. The actor retains
up to three immutable projections within a 16 MiB snapshot budget plus bounded
container overhead; identical snapshots share storage. Oversized projections
are unavailable rather than retained without bound. Metadata-only changes
force a frame. Unavailable sequences fail explicitly, with no current-grid
fallback. Terminal output bodies are not cached by this presentation layer.
Current headless queries without seq retain their existing behavior.

EngineSession validates response IDs, exact sequence, viewport dimensions,
ranges and text budgets, shares 32 client admissions across block metadata and
output reads, and rejects replies after close/replacement. The native actor
still enforces its existing shared 32-query admission. NativeBlockProjection
coalesces to one in-flight query and the latest pending frame, drops old or
disposed replies and recomputes pixel layout for changed cell metrics.
Metadata revisions do not substitute for frame/geometry identity.

Native blocks now use the shared guarded async BlockOverlay actions/search and
native output integrity checks. A projection model must be disposed when its
process changes; seq values alone do not distinguish process generations. See
the [input/projection report](../plans/2026-11-15-terminal-native-block-input-projection.md)
and [overlay integration](../plans/2026-11-15-terminal-native-block-overlay.md).

In native blocks mode, zsh, fish and PowerShell emit the complete original
accepted command through authenticated cmdline_url, preserving Unicode, newlines
and tabs within the decoded 1 MiB contract. Legacy unsigned and ordinary native
markers retain their previous behavior. Bash full-command capture still needs
an authoritative shell source; neither history guesses nor timing of pending
host writes establishes command identity. Other shell/platform acceptance and
full functional parity remain open.

Authenticated A invalidates a pending header anchor. B records a tracked native
reference to the reserved blank row immediately before the prompt-end cursor;
C transfers it to the actual command entry. Snapshots publish nullable
headerLine coordinates from those references, alongside separate output bounds.
Visible reserved rows must still contain no native text; overwriting one hides
only that header, preserving valid output. Reflow, collection and missing
markers never trigger a guessed output-relative or live-grid fallback.
The frontend validates the anchor against output start and uses only the
presented snapshot. Missing anchors suppress the in-grid bar; sticky output
actions remain independent. No new persistent schema or public Pi/MCP exposure.


### Native terminal-origin clipboard writes

Ordinary and blocks sessions observe bounded OSC52 writes through the existing
Rust shell framer, retaining the legacy selector/base64/UTF8 policy instead of
the pinned core's narrower normalized callback. One pending owned string and
one constant notification are coalesced independently of frame credits. The
internal take command resolves an existing native session; no OS clipboard
read, query reply or Pi/MCP clipboard command is exposed. The client serializes
writes and validates ownership after IPC and immediately before platform writes.
Tolerant C0/Unicode C1 clipboard framing cannot authorize shell markers. See
[the native clipboard report](../plans/2026-11-15-terminal-native-clipboard.md)
for explicit limits, differences, real M2 acceptance and open platform checks.
