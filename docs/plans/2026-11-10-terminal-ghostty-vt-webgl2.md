# Terminal Engine: libghostty-vt in Rust, WebGL2 Renderer Implementation Plan

**Goal:** Replace the xterm.js terminal engine with Ghostty's terminal core (`libghostty-vt`) running in the Rust process and a Terax-owned WebGL2 renderer in the webview, so that terminal output is parsed off the webview's main thread, every pane shares one GPU context, a busy pane never drops output, and the terminal gains what Ghostty's core already implements (Kitty keyboard protocol, grapheme clustering, Kitty graphics, OSC 133 semantics in the grid). The React surface that sits on top of the terminal (blocks, decorations, links, context menus, AI composer) stays DOM.

**Architecture:** Each PTY session owns a `Terminal` from `libghostty-vt` on the thread that already reads the PTY (the types are `!Send`, so the terminal lives and dies on that thread). The reader feeds bytes into the terminal at native speed and never waits for the webview. A frame pump takes a `RenderState` snapshot at most once per display frame, and only while the pane is visible, encodes the dirty rows into a compact binary frame and sends it over the existing raw-bytes Tauri `Channel`. The webview keeps no terminal state beyond the last frame of each visible pane: a single WebGL2 canvas per window draws every pane with one instanced draw call from one shared glyph atlas. Input, resize, scroll, selection and search become commands into the Rust terminal. The engine sits behind a `TerminalEngine` seam so xterm.js remains selectable until parity.

**Tech stack:** Rust, `libghostty-vt` 0.2.x (static `libghostty-vt.a` built with Zig 0.15.2 from a pinned Ghostty commit), `portable-pty`, Tauri 2 `Channel`, TypeScript, WebGL2, Vitest, `cargo nextest`.

---

## Why

Measured against other terminals (Ghostty, Kitty, WezTerm, iTerm2, Windows Terminal), the gaps in today's engine are structural, not a missing addon:

- xterm.js parses on the webview's main thread, so a flooding pane starves React and every other pane.
- Every renderer slot holds its own WebGL context. The pool is capped at 5 (`rendererPool.ts`), and a whole class of code exists to move terminals between slots (`DormantRing`, lazy serialization, `repaintStaleSlot`, the atlas repaint after a resize).
- Backpressure is a drop: past 4 MiB pending, `session.rs` discards the backlog and writes a hard reset into the stream.
- No Kitty keyboard protocol, no grapheme clustering (mode 2027), no image protocol.

## Spike results (2026-11-10)

Code and raw numbers: `spikes/terminal-ghostty-vt/`. Apple M4 Pro, macOS 27.0.1. Three synthetic payloads: `ascii` (log lines), `sgr` (256-colour and truecolor runs, wide CJK, emoji), `tui` (synchronized-output full-screen repaints with absolute cursor addressing, the shape Claude Code and Pi emit). Terminal 200x60, 10 000 lines of scrollback.

**Parser throughput, 64 MiB payloads**

| Payload | libghostty-vt (native) | xterm.js 6.0 headless (Node 22) | xterm.js 6.0 + WebGL in WKWebView (8 MiB) |
|---|---|---|---|
| ascii | 1002 MB/s | 133 MB/s | 52 MB/s |
| sgr | 100 MB/s | 85 MB/s | 18 MB/s |
| tui | 137 MB/s | 97 MB/s | 82 MB/s |

Raw parsing is not where the win is. On styled output the two parsers are within 20 percent of each other when xterm.js has a thread to itself; the difference appears when it shares the main thread with rendering (2 to 5 times slower in the webview) and with other terminals.

**Main thread while a pane floods, in WKWebView**

| Scenario | Frame interval p50 / max | Frames per second |
|---|---|---|
| xterm.js, 1 pane, sgr | 110 ms / 138 ms | 9 |
| xterm.js, 5 panes, sgr | 185 ms / 210 ms | 6.5 |
| xterm.js, 5 panes, tui | 60 ms / 77 ms | 17 |
| xterm.js, 12 panes, tui | 145 ms / 174 ms | 7 |
| WebGL2 renderer, 12 panes, sgr, a new frame per pane every display frame | 17 ms / 25 ms | 59.9 |
| WebGL2 renderer, 12 panes, tui, same | 17 ms / 45 ms | 59.6 |

The WebGL2 renderer spends 0.6 ms of main-thread time per display frame to update and draw 12 panes of 100x30, and 0.8 to 1.0 ms to apply and draw a full 200x60 frame. xterm.js rendered 4 to 8 frames in total during each flood; the new path rendered all 256.

**Frame path in Rust**

- Snapshot plus encode of a full 200x60 frame: 240 to 290 microseconds. At 60 frames per second that is under 2 percent of one core per visible, continuously repainting pane.
- A full frame in the spike's naive encoding (12 bytes per cell) is 144 KiB, 8.6 MB/s per pane at 60 fps. This is the number to bring down (see Frame protocol).
- `libghostty-vt.a` adds about 1.3 MB to the binary (spike binary 1.6 MB in total) and builds in about 25 s.

**Rendering:** colours, bold, backgrounds, wide CJK cells and the cursor render correctly (`results/renderer-sgr-200x60.png`). Emoji render monochrome, because the spike atlas stores coverage only.

**Not measured by the spike:** frame delivery over the Tauri `Channel`, a real PTY session, input latency, glyph quality against xterm.js side by side, memory per terminal. Phase 1 exists to measure these in the sandbox build.

**Build finding:** Zig 0.15.2 cannot link natively on macOS 26 or 27 (it cannot read the new SDK's `libSystem.tbd`). The spike builds through a stand-in SDK made of Zig's bundled files; the README documents it. The app build needs a supported route (Phase 0).

**Status:** the integration and the Phase 1 measurements were handed off before the first sandbox run. `2026-11-10-terminal-ghostty-vt-webgl2-handoff.md` describes why, the state of the branch and the remaining tasks.

## Phase 1 results (sandbox)

Development and static-core verification ran on Linux x86_64, Debian 13, Rust 1.99.1, Node 24.22.1 and pnpm 11.25.0. The frontend production bundle builds. Rust clippy and tests pass with and without the engine feature; the feature uses a checksum-verified static core built with Zig 0.15.2, ReleaseFast and baseline CPU. The Rust application tests themselves use the normal unoptimized development profile, so their durations are not terminal-performance measurements.

The graphical run is blocked: Xvfb cannot create its local display sockets in this execution environment, including with the supported execution approval. No graphical sandbox, shell-pane capture, IPC benchmark, echo measurement or resident-memory measurement has been reported as completed. No security setting was changed to get around this restriction. No build or link test ran on the original Mac.

| Required measurement | Linux WebKitGTK | macOS WKWebView |
|---|---|---|
| Channel FPS and bytes/s, 1 and 12 panes, ascii/sgr/tui | Not measured | Pending |
| rAF intervals p50/p95/max | Not measured | Pending |
| Credit round trip p50/p95 | Not measured | Pending |
| Engine and xterm key echo p50/p95 | Not measured | Pending |
| 12 idle terminal RSS, named processes | Not measured | Pending |
| xterm flood comparison and repeated-run spread | Not measured | Pending |

**Phase 1 exit criterion: not verified.** There is no evidence yet to answer yes to 60 fps with 12 continuously repainting panes over the real Channel. Successful native parsing/linking and unit tests do not establish this. The macOS measurement gate remains open; no later phase is approved by these results.

For meaningful follow-up measurements, use the production frontend and optimized Rust without changing default development settings:

```sh
CARGO_PROFILE_DEV_OPT_LEVEL=3 CARGO_PROFILE_DEV_DEBUG=false CARGO_PROFILE_DEV_DEBUG_ASSERTIONS=false node scripts/with-zig.mjs -- pnpm build:sandbox --debug --no-bundle --features ghostty-engine
TERAX_TERMINAL_LAB_AUTORUN=/absolute/path/report.json <sandbox executable>
```

A hosted macOS Intel lab workflow is prepared to run the bench, idle-engine and idle-xterm modes twice with an optimized Rust development profile and production frontend. It creates only the isolated Lab window, records named-process RSS externally, and retains raw reports, bounded PNG captures and failure logs. It has not yet supplied measurements to this table. The workflow explicitly bootstraps the verified native Intel artifact from producer run `42835004064`, SHA-256 `9a045b43db4a32733316b075a5b38a681fc34591656c7a4eeb923b1d9e6fed01`, while release publication waits for arm64 runner capacity. The checksum override exists only inside that job and is recorded in its hardware report; it is not a source-build fallback.

The default wrapper must first have published, reviewed checksum pins for the host. Do not choose `--source` on the protected original Mac. Record the actual app/core build metadata with every run. Two runs, captures, xterm flood and idle-memory modes still need to be completed before closing Tasks C/D.

## Acceptance criteria

- A terminal pane can run on the new engine end to end: shell spawn, input, resize, scrollback, selection and copy, search, links, OSC 7, OSC 133 blocks, OSC 52, agent signals.
- Output is never dropped. When the consumer is slow, frames are skipped, never bytes; the `dropped output due to backpressure` path is unreachable on the new engine.
- One WebGL2 context per window, regardless of pane count. A hidden pane costs no GPU memory and no frame work.
- With 12 visible panes repainting continuously the webview holds 60 frames per second and React stays responsive.
- Claude Code, Pi and Codex render and take input correctly, including Shift+Enter, bracketed paste, mouse reporting and synchronized output.
- The engine is selectable per build while both exist; xterm.js is removed only after a soak on the user's real workload (10+ split tabs, many agent panes, days of uptime).
- Bundle growth stays under 2 MB. An unused engine costs nothing at runtime.
- Rust and frontend gates are green, and each core-subsystem change (PTY session, IPC surface, frame codec, key encoding) carries a test that locks its invariant.

## Phases

Each phase merges into `qa` on its own with `--no-ff`. Until Phase 5 the new engine is off by default and validated only in the sandbox build (`pnpm dev:sandbox`, `pnpm build:sandbox`), never against the installed app.

### Phase 0: build integration

- Add `libghostty-vt` to `src-tauri` behind a cargo feature (`ghostty-engine`), default off until Phase 5.
- Zig 0.15.2 as a pinned build prerequisite: `flake.nix`, CI (`ci.yml`, release workflows), `CONTRIBUTING.md`. Decide between building from source on every platform and consuming a prebuilt `libghostty-vt.a` per target through the crate's `pkg-config` feature; prebuilt removes Zig from contributor machines and sidesteps the macOS 27 SDK problem.
- Confirm the three targets build and link: macOS universal, Linux, Windows (static `ghostty-vt-static.lib`).
- Record the Ghostty commit and the upgrade procedure. The C API has no stable release yet and announces one more breaking pass before 1.0, so the pin moves deliberately.

### Phase 1: one pane in the sandbox, measured

- `modules/pty/engine.rs`: the `Terminal`, `RenderState` and frame pump on the PTY reader thread. `on_pty_write` replaces `da_filter` replies for sessions on the new engine. `agent_detect` keeps reading the raw stream.
- Frame protocol v1 (below) with a pure encoder in Rust and a pure decoder in TypeScript, both tested against shared fixtures.
- `src/modules/terminal/gl/`: the renderer from the spike, hardened: context loss, DPR changes, font from preferences, theme from the theme engine, cursor styles, underline styles, colour emoji atlas page.
- A developer-only tab kind that opens a pane on the new engine next to an xterm.js pane.
- Measure in the sandbox and record in this document: Channel throughput and latency for frames, input-to-pixel latency against xterm.js, memory per terminal, the 12-pane scenario with real agents.
- Exit criterion: the numbers hold with real IPC. If frame delivery over the Channel cannot sustain 60 fps for 12 panes, stop and evaluate the WASM-in-Worker variant before going further.

### Phase 2: input and interaction

- Key encoding through `libghostty-vt`'s key encoder, which makes the Kitty keyboard protocol available and retires the `modifyOtherKeys` tracking in `keyboardProtocol.ts`. IME and dead keys through a hidden textarea, as today.
- Mouse reporting, bracketed paste, focus events.
- Selection owned by Rust (`selection` API) and drawn by the renderer; copy returns text from Rust. Word and line selection, drag autoscroll.
- Scrollback viewport (`scroll_viewport`, `scrollbar`) and resize with reflow.

### Phase 3: the surface on top

- A `TerminalEngine` interface that `useTerminalSession`, blocks, decorations, search, links and the context menu depend on, with an xterm.js adapter and a ghostty adapter. Row anchors for blocks use tracked grid references so they survive scroll and reflow.
- OSC 7 and title through terminal callbacks; OSC 133 from row and cell semantic state plus a Rust-side scanner for the exit code; OSC 52 through `on_clipboard_write` with the existing size cap; OSC 777 agent marker unchanged.
- Search in Rust over the grid; link detection over the visible rows plus OSC 8 from `hyperlink_uri`.
- Session restore and serialization from the Rust grid (`fmt`), replacing the serialize addon.

### Phase 4: what the old engine could not do

- Kitty graphics (`kitty-graphics` feature) with image placements as textures.
- Grapheme clustering (mode 2027) with multi-codepoint cells in the frame protocol.
- OSC 9 and OSC 99 notifications, OSC 9;4 progress, through the existing agent notification channel.
- Ligatures, if shaping in the atlas proves affordable.

### Phase 5: default and removal

- New engine on by default in dev builds, soak on the real workload, then in releases.
- Remove xterm.js and its addons, `rendererPool.ts`, `DormantRing`, the stale-slot repaint paths and `da_filter`. Update `TERAX.md`.

## Frame protocol v1

The spike sends 12 bytes per cell for every dirty row. v1 keeps the dirty-row model and shrinks the payload:

- Per window, not per pane: one message per display frame carrying every visible pane that changed, so the webview does one decode and one draw per frame.
- Rows are run-length encoded by style: `(style id, cell count)` runs over a codepoint array, with blank tails elided. A style table per frame maps ids to foreground, background, underline colour and flags.
- Multi-codepoint graphemes go through a side table indexed from the cell.
- Scroll is sent as a row shift, so a scrolling log moves existing rows in the instance buffer and uploads only the new ones.
- Frames are skippable: each one is self-contained relative to the last acknowledged frame, and the pump coalesces while the webview is busy. A resync request returns a full frame.
- The pump is driven by a `requestAnimationFrame` credit from the webview, so a hidden or throttled window produces no frames.

## Risks

- **API stability.** `libghostty-vt` is pre-1.0 and the Rust bindings are a third-party crate (`uzaaft/libghostty-rs`). Mitigation: pin both, wrap them in `engine.rs`, keep xterm.js behind the seam until Phase 5.
- **Toolchain.** Zig as a build dependency on three platforms, and the macOS 27 SDK incompatibility. Mitigation: prebuilt static libraries per target (Phase 0 decision).
- **IPC as the new bottleneck.** Unmeasured. Mitigation: Phase 1 exit criterion and the frame protocol; fallback is the same core compiled to WASM in a Worker with the same renderer.
- **Text quality.** Glyphs are rasterized by the browser into the atlas, so quality matches xterm.js, not Ghostty. Subpixel positioning, fallback fonts and colour emoji need care.
- **Scope.** Selection, IME, accessibility (screen reader output, which xterm.js provides through a DOM mirror) and search are owned by Terax after this change.
- **Threading.** One terminal per thread and no cross-thread access. Commands reach the terminal through a queue drained by its thread.


## Prebuilt core build and upgrade

The native build pins Ghostty `a887df42c56f6de86c0fe6da9c4eeca37931e083`, crate and sys version 0.2.2, and Zig 0.15.2. `scripts/libghostty/source.json` records the source and build identity. The separate `scripts/libghostty/pin.json` records target availability and archive checksums. A null checksum is an unavailable artifact, not a placeholder that the wrapper accepts.

`.github/workflows/libghostty-vt.yml` builds four native targets with baseline CPU and ReleaseFast, using a native macOS 15 SDK on Apple runners. The producer packages the final combined static archive, headers, relocatable static pkg-config metadata, license and build metadata. It excludes shared libraries and import libraries. Publishing requires all producers to succeed and never overwrites an existing release.

Upgrade procedure:

1. Review and bump both Rust crate pins and the Ghostty commit, Zig version if required, and dedicated release tag in `source.json`. Checksum-only updates to `pin.json` do not retrigger production. Clear old target checksums. Update Cargo.lock.
2. Dispatch the producer workflow. Inspect build provenance, static linkage and all target smoke tests before publishing or accepting assets.
3. Review the release SHA256SUMS and pin actual archive hashes in the repository. Never infer hashes from a filename or use a downloaded manifest as the consumer trust root.
4. Run clean Linux x86_64 and macOS arm64 feature gates through the default wrapper with no Zig installed. Verify there is no Ghostty shared-library dependency. Windows linkage remains a separate target gate.

Default command: `node scripts/with-zig.mjs -- cargo test --manifest-path src-tauri/Cargo.toml --locked --features ghostty-engine`.
Explicit source command: add `--source` before `--`. Source builds need network for Ghostty and Zig packages, use the real SDK only, and must not run on the protected original host. No SDK shim or security-agent workaround is included.

Publication, target checksums and clean consumer acceptance are pending until real artifacts and logs are available. CI intentionally fails feature gates when required artifacts are not yet pinned; baseline gates still run independently.


### Local prebuilt verification on dot

Native Linux and experimental cross-built macOS arm64 and Intel archives were produced on Linux with official Zig 0.15.2, the pinned source and baseline CPU. Cross builds use upstream's bundled Darwin support, not an SDK shim, and no command ran on a Mac. Both Apple archives contain 11 Mach-O objects of the expected architecture with minimum macOS 13.0.0. Neither has been linked or executed on macOS.

The Linux archive passes a fresh standalone Rust safe/sys 0.2.2 create/feed/render smoke through the default wrapper. The binary depends on libc/libgcc, with no Ghostty shared dependency. A repeated invocation with the stable verified cache completes without recompilation. Invoking `zig version` inside prebuilt mode fails through the deny-only guard with status 97. Node wrapper unit tests pass (10 tests), including LF/CRLF private-dependency metadata regressions.

Local archive hashes are recorded in `pin.json` with publication pending. These are experimental, not canonical release assets; they lack the complete bundled dependency notices added to the native CI producer. Do not upload them to the immutable canonical release. Native CI must produce and validate release-ready archives, and its real checksums must replace local pins after publication. Windows and full native macOS consumer acceptance remain pending.


### Native producer verification

Producer run [42835004064](https://github.com/Sendery/terax-ai/actions/runs/42835004064) built static archives and linked/executed the safe-crate consumer without Zig in the consumer path on Linux x86_64, Windows x86_64 and macOS Intel. Native Intel objects were independently inspected: all 11 Mach-O objects declare x86_64 and minimum macOS 13.0. This does not establish execution on macOS 13 itself.

The arm64 job did not execute any step on its first attempt. GitHub reported hosted-runner capacity constraints and cancelled the queued job; the dependent publication was skipped. A single failed-job retry was also cancelled for the same capacity reason, without executing the arm64 build. The immutable release and final checksum manifest are not yet published. Default consumer acceptance on a clean arm64 checkout therefore remains open.
