# M2 native WKWebView phase 1, 2026-11-14

The twelve-pane exit criterion is **not met**. Both repetitions completed
without native failures, timeouts, decode errors, context losses or final-frame
mismatches. All three common intervals exceed the preregistered five seconds.
Every payload has a slowest pane below 60 updates/s in both repetitions. Draw
updates mean WebGL submission, not physical display presentation.

Source: `4e8694a`; macOS 27.0.1, Apple M2, 8 GB, native WKWebView. Production Vite
frontend, optimized Rust dev profile (`opt-level=3`, `debug=false`,
`debug-assertions=false`, `incremental=false`, `strip=none`), sandbox identifier
`app.crynta.terax.sandbox`, no main app window. ARM64 core source is the
checksum-pinned provisional archive identified in hardware.json; native
create/feed/render, clippy/tests and this run validate its arm64 consumer,
not canonical release publication or other platforms. The original protected
Mac was not used to build/run; no Actions were launched.

Unchanged workload: ascii/sgr/tui generators, 12 sessions, 100x30 cells each, 
1024 MiB per session (actual generation may end just beyond the requested
boundary), full original-font grids,180 s timeout,250 ms warmup and at least 5 s
common interval. Canvas 6800x3330 at DPR 2 is fully rasterized and then CSS scaled.
The rows below report the minimum *individual* pane update rate, not an
aggregate divided by 12. Aggregate rates include setup and the full run.

| Payload | Run | Common interval s | Slowest pane updates/s | Channel frames | Total frames/s | Frame MiB/s |
|---|---:|---:|---:|---:|---:|---:|
| ascii | 1 | 8.030 | 35.62 | 3887 | 445.40 | 3.44 |
| sgr | 1 | 35.258 | 49.80 | 22036 | 610.40 | 7.38 |
| tui | 1 | 26.990 | 53.17 | 17926 | 642.50 | 6.43 |
| ascii | 2 | 7.915 | 38.66 | 4175 | 485.20 | 3.75 |
| sgr | 2 | 35.503 | 50.64 | 22335 | 617.40 | 7.46 |
| tui | 2 | 27.229 | 52.41 | 17733 | 630.20 | 6.31 |

| Payload | Run | rAF p50/p95/max ms | Credit RTT p50/p95 ms | Encode us/frame | Total fed MiB | Fed MiB/s over wall time |
|---|---:|---:|---:|---:|---:|---:|
| ascii | 1 | 17/23/64 | 12/82 | 374.2 | 12288.00 | 1408.04 |
| sgr | 1 | 17/20/110 | 10/28 | 766.1 | 12288.00 | 340.41 |
| tui | 1 | 17/19/205 | 8/24 | 645.6 | 12288.01 | 440.40 |
| ascii | 2 | 17/19/51 | 12/63 | 453.4 | 12288.00 | 1428.17 |
| sgr | 2 | 17/20/66 | 10/28 | 781.3 | 12288.00 | 339.68 |
| tui | 2 | 17/19/214 | 8/25 | 686.2 | 12288.01 | 436.72 |

Rust encode statistics, credit round trips and rAF intervals do not isolate
Channel serialization, JS decode/apply or GPU execution. The spread is the
two observed values, not a confidence interval. No causal bottleneck is
claimed from these aggregate timings. The next experiment should instrument
local stage durations by sequence, then compare per-session credit invokes
with one bounded batch per window/rAF, without delaying batches another rAF.
All acceptance data and geometry must remain unchanged.

Idle memory in separate fresh processes, 12 sessions with exactly 10000 verified
history rows each, 30 s hold and externally sampled stable intervals:

| Mode | Run | Stable samples | RSS MiB min / median / max |
|---|---:|---:|---:|
| idle-engine | 1 | 25 | 385.44 / 385.56 / 386.14 |
| idle-engine | 2 | 26 | 384.23 / 384.33 / 385.08 |
| idle-xterm | 1 | 26 | 602.80 / 602.83 / 603.97 |
| idle-xterm | 2 | 26 | 613.92 / 613.95 / 615.11 |

RSS is the `ps` sum of the native app, its descendants and newly observed
named WebKit WebContent/GPU/Networking helpers. Exact names, PIDs, birth
identities and baseline exclusions are in each runner.json. Shared pages can
be counted more than once; pre-existing helpers are excluded. This is not PSS,
physical footprint or an exclusive-memory claim. Both modes use 100x30 grids
and verified history; renderer/context counts and canvas backings differ and
are recorded. The older 8 GiB WebKit footprint termination must not be compared
to these RSS numbers. Both repetitions exited 0 with clean teardown.

WASM-in-Worker evaluation: the pinned upstream source already selects a Wasm
library target and exports its older allocator helpers. See the pinned
[build target](https://github.com/ghostty-org/ghostty/blob/a887df42c56f6de86c0fe6da9c4eeca37931e083/build.zig#L105)
and [Wasm exports](https://github.com/ghostty-org/ghostty/blob/a887df42c56f6de86c0fe6da9c4eeca37931e083/src/lib_vt.zig#L311).
This establishes feasibility, not speed. Moving the grid to a Worker would
remove native grid-frame transport but retain native PTY-byte transport and
change state/selection ownership. The SGR run feeds about 12 GiB while emitting
about 270 MiB of grid frames, so shipping raw input could increase IPC volume
substantially. A Worker requires bounded flow control and transferable
buffers, the pinned ABI and explicit contract changes. It has not been built
or measured here. Current 1.0 documentation is not a compatible drop-in for
this pinned pre-1.0 API.

Phases 2 through 5 stay gated. Keep the production xterm path and the feature
default unchanged. One-pane acceptance measurements, the complete repeated
xterm flood/echo comparison, Windows runtime, Intel graphics setup, canonical
artifact publication and the days-long real-workload soak remain unverified.

Build and launch on M2:

```sh
cd /Users/andres.rojo/Workspaces/terax-ai
export CARGO_TARGET_DIR="$PWD/src-tauri/target/lab-optimized"
export CARGO_PROFILE_DEV_OPT_LEVEL=3 CARGO_PROFILE_DEV_DEBUG=false
export CARGO_PROFILE_DEV_DEBUG_ASSERTIONS=false CARGO_PROFILE_DEV_INCREMENTAL=false
export CARGO_PROFILE_DEV_STRIP=none
.terax/pi-development/m2/with-ghostty pnpm exec tauri build --debug --no-bundle --features ghostty-engine --config "$PWD/.terax/pi-development/m2/lab/tauri.lab.json"
export GITHUB_SHA=4e8694a05c3ded82906dd662e6eccad7fa3015d4
export TERAX_TERMINAL_LAB_CORE_SOURCE=provisional-linux-cross-arm64
export TERAX_TERMINAL_LAB_CORE_SHA256=fd8ca44691ced7b1fa368666fb5546ba8bf4318b717b356ea0a36a2aada49fe0
node scripts/terminal-lab.mjs "$PWD/src-tauri/target/lab-optimized/debug/terax" "$PWD/.terax/pi-development/m2/lab/gate-4e8694a" gate-engine
node scripts/terminal-lab.mjs "$PWD/src-tauri/target/lab-optimized/debug/terax" "$PWD/.terax/pi-development/m2/lab/idle-4e8694a" idle-engine,idle-xterm
```

The M2 wrapper references the already-verified adjacent provisional archive;
it is machine setup, not a replacement for the portable wrapper's pinned
artifact configuration. Both app processes exited 0, runner exited 0, reports
were saved compactly below 16 MiB, and cleanup found no errors or survivors.
Runner success records complete sustained collection; it does not mean 60 fps.
