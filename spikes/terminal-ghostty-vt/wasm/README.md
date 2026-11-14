# Rust + Zig WASM feasibility

This headless experiment evaluates the fallback required by the negative
Phase 1 Channel result. It links the exact pinned Ghostty static WASM core
and the existing Rust frame V1 encoder into one module. It is not connected
to the app, a Worker or PTY transport, and produces no FPS result.

The module creates, feeds, snapshots and drops a terminal for three existing
golden cases: plain text, truecolor styles and wide/combining Unicode. The
host copies each frame before another call and reacquires `memory.buffer`
after every call that can grow it. It checks 300 frames byte-for-byte over
100 cycles, clears the retained frame each cycle, rejects stale output after
an invalid case and checks all 68 size/alignment assertions exposed for the
34 types in the compiled core's ABI JSON. Native binding assertions remain
unchanged. This is not full terminal parity or proof of leak freedom.

`frame.rs` is included directly from production. `prepare.py` derives a
snapshot copy with exactly three changes: RenderState, RowIterator and
CellIterator constructors use Rust's `Allocator::GLOBAL`, as does Terminal.
No terminal object in this proof uses the default Zig allocator. The only
WASM import is `env.log`; the verifier rejects unexpected log calls. Long
logging paths, callbacks, selection, deltas, resize and fragmented feeds are
not exercised.

## Reproduce on a build machine

Do not run these commands on the protected original Mac. No GitHub Actions
are needed. The native dependency's source fallback remains blocked by
default. This experiment explicitly builds WASM in an ignored directory; it
does not install Zig onto the ordinary development PATH or change the app.

Requirements: Rust with `wasm32-unknown-unknown`, Zig 0.15.2, LLVM/libclang 20,
Python 3, Node, pkg-config and the verified native ARM64 prebuilt archive.
On the M2, Homebrew `zig@0.15` 0.15.2 and `llvm@20` 20.1.8 are installed.
The checksum-pinned official Zig SDK failed while linking its host build
runner against the macOS 27 SDK, before WASM compilation. The pinned
[upstream troubleshooting note](https://github.com/ghostty-org/ghostty/blob/a887df42c56f6de86c0fe6da9c4eeca37931e083/HACKING.md)
recommends the packaged compiler for this SDK problem. The successful M2
compiler is the Homebrew build, with its packaged patches, not the official
SDK binary. No SDK replacement or xcrun shim is used here.

From the repository root, using fresh output directories:

```sh
set -eu
export TERAX_WASM_WORK="$PWD/.terax/pi-development/wasm-feasibility"
export TERAX_WASM_SOURCE="$TERAX_WASM_WORK/ghostty"
export TERAX_WASM_PREFIX="$TERAX_WASM_WORK/core-prefix"
export TERAX_WASM_SPIKE="$PWD/spikes/terminal-ghostty-vt/wasm"
export TERAX_WASM_ZIG=/opt/homebrew/opt/zig@0.15/bin/zig
export TERAX_WASM_CLANG=/opt/homebrew/opt/llvm@20/bin/clang
export LIBCLANG_PATH=/opt/homebrew/opt/llvm@20/lib
export TERAX_NATIVE_CORE_ARCHIVE=/absolute/path/to/verified-native-prebuilt.tar.gz

mkdir -p "$TERAX_WASM_SOURCE"
git -C "$TERAX_WASM_SOURCE" init
git -C "$TERAX_WASM_SOURCE" fetch --depth=1 \
  https://github.com/ghostty-org/ghostty.git \
  a887df42c56f6de86c0fe6da9c4eeca37931e083
git -C "$TERAX_WASM_SOURCE" checkout --detach FETCH_HEAD
test "$("$TERAX_WASM_ZIG" version)" = 0.15.2
(
  cd "$TERAX_WASM_SOURCE"
  "$TERAX_WASM_ZIG" build -Dtarget=wasm32-freestanding -Dcpu=baseline \
    -Doptimize=ReleaseFast -Demit-lib-vt=true -Dapp-runtime=none \
    -Demit-xcframework=false -Dsimd=false --prefix "$TERAX_WASM_PREFIX" \
    --cache-dir "$TERAX_WASM_WORK/zig-cache" \
    --global-cache-dir "$TERAX_WASM_WORK/zig-global-cache" -j2 < /dev/null
)
rustup target add wasm32-unknown-unknown < /dev/null
python3 "$TERAX_WASM_SPIKE/prepare.py" \
  --source "$TERAX_WASM_SOURCE" --core-prefix "$TERAX_WASM_PREFIX"

export GHOSTTY_INCLUDE_DIR="$TERAX_WASM_SOURCE/include"
export BINDGEN_EXTRA_CLANG_ARGS="--target=wasm32-unknown-unknown -ffreestanding -nostdinc -isystem $("$TERAX_WASM_CLANG" -print-resource-dir)/include"
CARGO_TARGET_DIR="$TERAX_WASM_WORK/bindgen-target" \
  node scripts/with-zig.mjs --provisional "$TERAX_NATIVE_CORE_ARCHIVE" -- \
  cargo run --manifest-path "$TERAX_WASM_SPIKE/target/sys/Cargo.toml" \
  --locked --no-default-features --features pkg-config,bindgen-tool \
  --bin gen-bindings < /dev/null
unset GHOSTTY_INCLUDE_DIR BINDGEN_EXTRA_CLANG_ARGS

export PKG_CONFIG_ALLOW_CROSS=1
export PKG_CONFIG_PATH="$TERAX_WASM_SPIKE/target/pkgconfig"
export PKG_CONFIG_LIBDIR="$PKG_CONFIG_PATH"
export CARGO_TARGET_DIR="$TERAX_WASM_WORK/rust-target"
cargo build --release --manifest-path "$TERAX_WASM_SPIKE/Cargo.toml" \
  --target wasm32-unknown-unknown --locked < /dev/null
node "$TERAX_WASM_SPIKE/verify.mjs" \
  "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/terax_wasm_feasibility.wasm" \
  "$TERAX_WASM_WORK/result.json" "$TERAX_WASM_PREFIX/bin/ghostty-vt.wasm"
```

The verifier refuses to overwrite an existing report. `prepare.py` checks a
clean exact source commit, keeps the native ABI file intact and removes any
previous ABI32 output before generation. Its copied dependency lives only
under ignored `target/`. Both Cargo dependency graphs have committed locks;
no production dependency, native build script or target mapping is changed.
Use a fresh shell afterward so the WASM pkg-config environment cannot affect
a native build.

## Remaining decision

Before choosing this architecture, build and measure a bounded raw-byte PTY
transport and Worker ownership/lifecycle with the unchanged shared renderer.
Preserve backpressure, control responsiveness, post-draw credit semantics,
final-frame validation, Rust input/selection logic and hidden-window policy.
Then repeat the registered native WKWebView workload twice without concurrent
builds. The existing negative Channel result remains valid. Phases 2 through
5 remain gated and production xterm remains unchanged.
