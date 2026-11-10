# Terminal engine (libghostty-vt + WebGL2)

Contract for the engine described in `docs/plans/2026-11-10-terminal-ghostty-vt-webgl2.md`. This file is the single source of truth for the Rust and the TypeScript side; when the two disagree, this file wins and gets fixed first. It covers phases 0 and 1: the engine exists behind a cargo feature, is reachable only from the Terminal Lab window, and never replaces xterm.js in a terminal tab.

## Invariants

1. **Bytes are never dropped.** The PTY reader hands bytes to the engine through a bounded queue. When the engine is behind, the reader blocks, the kernel PTY buffer fills and the child blocks. There is no overflow path.
2. **Frames are droppable, state is not.** The webview holds no terminal state it cannot rebuild from one full frame. A frame that is not sent is simply superseded by the next one.
3. **One frame in flight per terminal.** Rust sends a frame only when it holds a credit. The webview returns the credit after it has applied the frame and a display frame has been presented. A hidden or throttled window therefore produces no frames and no work.
4. **The terminal lives on one thread.** `libghostty-vt` types are `!Send`. The `Terminal`, the `RenderState` and both iterators are created, used and dropped on the engine thread. Everything else talks to it through its queue.
5. **Unused costs nothing.** Without the `ghostty-engine` feature no engine code is compiled. With it, nothing runs until a terminal is opened on the engine.
6. **The xterm.js path is untouched.** `pty_open` and everything downstream of it behave byte for byte as before. Shared code is refactored only where the engine needs a seam, and the existing tests stay green.

## Build

- Cargo feature `ghostty-engine` is off by default. It enables `libghostty-vt = "=0.2.2"` without its default features and the optional `libghostty-vt-sys = "=0.2.2"` dependency with `pkg-config`. The safe crate does not forward that feature.
- `node scripts/with-zig.mjs -- <command...>` defaults to a checksum-pinned static archive. Pins and availability are in `scripts/libghostty/pin.json`. An unavailable target, download failure, checksum mismatch or missing pkg-config is an error, never permission to build from source. Native GNU Linux x86_64, MSVC Windows x86_64 and both macOS architectures are the planned targets; cross-target consumption is rejected.
- The wrapper verifies the archive, extracts the static library and headers under `src-tauri/target/toolchains/`, relocates `libghostty-vt-static.pc`, and preflights pkg-config. A deny-only Zig executable blocks the crate's implicit source fallback. It never provisions Zig in prebuilt mode. Static Windows linkage uses `ghostty-vt-static.lib`, never the DLL import library `ghostty-vt.lib`.
- Explicit source build: `node scripts/with-zig.mjs --source -- <command...>`. This provisions checksum-verified Zig 0.15.2 and builds pinned Ghostty `a887df42c56f6de86c0fe6da9c4eeca37931e083`, with `ReleaseFast` unless overridden. The initial source build needs network access. Source mode uses the host's real SDK; no SDK substitute or xcrun shim is provided. Use a compatible SDK or prebuilt archive if native compilation fails. Do not run source mode on the protected original development Mac.
- Sandbox with the engine: `node scripts/with-zig.mjs -- pnpm dev:sandbox --features ghostty-engine`. Archives that still have a null checksum are unavailable, not verified releases.
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
| `gterm_bench_stats` | `id` | `{ bytesFed, frames, frameBytes, encodeMicros, creditWaitMicros, credits }`, valid until the session is closed. A bench session shares the id space of PTY sessions and is closed with `pty_close` |
| `open_terminal_lab_window` | none | nothing. Singleton window, label `terminal-lab`, page `terminal-lab.html` |

| `gterm_lab_autorun` | none | `string \| null`: the value of the `TERAX_TERMINAL_LAB_AUTORUN` environment variable (a result file path). When it is set, the app opens the Terminal Lab window at startup |
| `gterm_lab_report` | `json` (string) | nothing. Writes the string to the autorun path and exits the app. Fails with `not-autorun` when the variable is not set, so the command cannot be used to write arbitrary files |

`gterm_open` goes through the same workspace authorization as `pty_open` (`user_spawn_cwd_or_home`). Unknown ids return `no session`, like `pty_*`.

### Theme colors and statistics

`colors` is `{ foreground, background, cursor?, palette }`. Foreground, background, the optional cursor and every palette entry must be ASCII `#rrggbb` strings; the palette must contain exactly 16 entries. Rust rejects malformed colors before starting a session or queuing an update. The engine applies its initial colors before its first frame. Live changes are coalesced in the control record and produce a full frame after the outstanding credit returns. Palette entries 16 through 255 retain the terminal core's existing defaults. Omitting colors preserves the core defaults; omitting cursor resets the default cursor color.

The lab resolves the same theme tokens as its xterm.js pane, including CSS color formats, into explicit RGB values before crossing IPC. A theme change while an open is pending is replayed after the session id arrives. Normal engine sessions similarly replay a changed size after opening; benchmark sessions do not invoke the PTY resize command.

All benchmark counters are cumulative. `credits` counts accepted acknowledgements only, excluding the initial credit and stale or duplicate acknowledgements. `creditWaitMicros` measures time when output or a full frame is pending but the pump has no credit, not total frame-to-ack latency. It was already cumulative before this handoff; regression tests cover successive waiting intervals without double-counting.

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
| 17 | u8 | `flags`: bit 0 full frame, bit 1 cursor blinks, bit 2 viewport is not at the bottom |
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
| `cell_count` x u32 | cells: bits 0 to 20 codepoint (0 is an empty cell), bit 30 spacer tail of a wide cell, bit 31 wide cell head. Bit 29 is reserved for the grapheme side table |

Trailing cells that are empty and in the default style are not encoded. Rows appear in increasing `y`. A multi-codepoint grapheme sends its first codepoint only in v1.

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
