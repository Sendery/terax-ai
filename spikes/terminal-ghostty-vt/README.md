# Spike: libghostty-vt in Rust, WebGL2 renderer in the webview

Throwaway code that measures the terminal architecture proposed in
`docs/plans/2026-11-10-terminal-ghostty-vt-webgl2.md`. Nothing here is wired
into the app, and nothing here runs inside or next to an installed Terax.

- `src/main.rs`: payload generator, parser benchmark and frame encoder on top of
  the `libghostty-vt` crate (0.2.2, Ghostty commit `a887df4`).
- `web/renderer.js`: one WebGL2 context and one glyph atlas drawing any number
  of panes with one instanced draw call each.
- `web/bench.js`: replays encoded frames through that renderer and runs the
  same payloads through xterm.js 6.0 with its WebGL addon.
- `wkwebview.swift`: opens the page in a plain `WKWebView`, the engine a Tauri
  window uses on macOS, and saves a snapshot when the page finishes.
- `results/`: the numbers and the snapshot from 2026-11-10 (Apple M4 Pro,
  macOS 27.0.1).

## Run

Zig 0.15.2 is required by the pinned Ghostty commit and must be first on `PATH`.

```bash
OUT=$(mktemp -d)
cargo build --release
BIN=target/release/terax-ghostty-vt-spike
for kind in ascii sgr tui; do
  $BIN gen $kind 64 $OUT/$kind-64.bin
  $BIN gen $kind 8 $OUT/$kind.bin
  $BIN bench $OUT/$kind-64.bin 200 60
  $BIN frames $OUT/$kind.bin 200 60 32 256 $OUT/$kind-200x60.frames
  $BIN frames $OUT/$kind.bin 100 30 32 256 $OUT/$kind-100x30.frames
done

# xterm.js parser baseline, in a directory with @xterm/headless@6.0.0 installed
node xterm-headless-bench.mjs $OUT/ascii-64.bin 200 60

# renderer benchmark, with @xterm/xterm@6.0.0 and @xterm/addon-webgl@0.19.0
node serve.mjs $OUT <node_modules/@xterm> $OUT/result.json &
swiftc -O wkwebview.swift -o $OUT/wkwebview
$OUT/wkwebview http://127.0.0.1:4517/bench.html $OUT/snapshot.png
```

## Zig on macOS 27

Zig 0.15.2 cannot read the `libSystem.tbd` of the macOS 26 and 27 SDKs, so every
native link fails with undefined libc symbols, the build runner included. The
workaround used here is a stand-in SDK made of Zig's own files, returned by an
`xcrun` shim that only the Zig process sees:

- `<sdk>/usr/lib/libSystem.tbd` and `<sdk>/SDKSettings.json` from
  `<zig>/lib/libc/darwin/`
- `<sdk>/usr/include/` from `<zig>/lib/libc/include/any-macos-any/`
- a `zig` wrapper that prepends a directory holding an `xcrun` script which
  prints `<sdk>` for `--show-sdk-path` and defers to `/usr/bin/xcrun` otherwise

The app build needs a supported answer to this before the crate can become a
dependency of `src-tauri` (see the plan).
