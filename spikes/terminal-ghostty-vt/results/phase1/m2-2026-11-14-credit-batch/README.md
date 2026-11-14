# M2 credit batching: measured outcome

Phase 1 remains negative. The corrected candidate completes, reduces credit
command traffic and improves SGR/TUI descriptively, but does not reach the
required 60 minimum individual-pane updates/s. Production xterm is unchanged;
this is not a usable normal-pane terminal replacement or delivered parity.

## Provenance and fixed workload

Native Apple M2, macOS 27.0.1, arm64, 8 GiB, real WKWebView. Each case has
twelve 100x30 terminals, 1024 MiB per session from the unchanged ASCII/SGR/TUI
generators, full native-font backbuffer, 180 s timeout, 250 ms warmup and a
minimum 5 s common interval. No builds or tests ran during measurement.
The GUI guard reported the matching unlocked console available, and the
runner held its power assertion. All twelve native runs exited 0, with no
runner timeout/failure or cleanup error/survivor. These facts do not make an
invalid or below-target measurement pass.

Corrected comparison and confirmation source and runner:
`e500b3260520c4262b465347f07d5ba0e64e440d`.
Binary SHA256 `37b6c9d75d456d1388aa264a9899b0ea7b0f404567f1258ad22e61234bd185ac`.
Native core 0.2.2, Ghostty pin
`a887df42c56f6de86c0fe6da9c4eeca37931e083`, provisional ARM64 prebuilt archive
SHA256 `fd8ca44691ced7b1fa368666fb5546ba8bf4318b717b356ea0a36a2aada49fe0`.
Vite production frontend; optimized dev Rust, opt-level 3, no debug info or
assertions, no incremental, strip none, panic unwind; sandbox identity and
no main app window. The release profile still aborts on panic.

Separate runner calls preserve the preregistered order A1,A2,B1,B2, then two
unprofiled confirmations. Both variants share the same preserved binary.
Collection success is distinct from the 60 FPS requirement.

## Corrected instrumented comparison

Each cell is minimum pane updates/s, followed by common duration in seconds.
`invalid` means the observation is diagnostic only, not a sustained result.

| Payload | Control 1 | Control 2 | Batch 1 | Batch 2 |
|---|---:|---:|---:|---:|
| ascii | 30.1455 / 3.848 (invalid) | 31.1481 / 6.132 | 39.6394 / 6.433 | 37.8821 / 4.514 (invalid) |
| sgr | 51.0308 / 35.508 | 50.0716 / 35.629 | 54.1304 / 34.694 | 54.0789 / 34.875 |
| tui | 51.0826 / 27.250 | 51.9682 / 27.132 | 54.6562 / 26.749 | 54.9603 / 26.601 |

ASCII has one short control and one short candidate, so its sustained A/B
comparison is inconclusive. Both SGR and TUI repetitions are valid. With
A,A,B,B and two repetitions, the descriptive improvement can include temporal
drift; it is not a causal isolation of all scheduler effects.

Every corrected case received and drew its final frames and has complete
profile accounting, no decode error, context loss, timeout or explicit case
error. Candidate queued and registered counts match every received frame,
with zero failed/rejected/pending acknowledgements. SGR/TUI average roughly
10.9 acknowledgements per actual command invocation, instead of one. All
measured candidate draw-to-dispatch maxima are 1 ms or less. Exact counts,
histograms, sums, frame/byte throughput, native accepted credits and stage
distributions are in `derived.json` and the unmodified compressed reports.

Credit command reply p50 remains about 6 ms for SGR and 5 ms for TUI in both
variants. Decode/apply p95 are quantized to 0 ms and do not imply zero work.
Draw submission is CPU/driver time, not GPU execution or presentation. Native
send-call timing does not include delivery to JavaScript. Never subtract
native and JS clocks or sum percentiles to attribute latency. Registered
commands are not native accepted credits; the latter retain their own counts.

## Confirmation without optional stage profile

| Payload | Repetition 1 FPS / common s | Repetition 2 FPS / common s | 60 FPS |
|---|---:|---:|---|
| ascii | 39.2021 / 5.765 | 39.5049 / 7.999 | no |
| sgr | 54.3255 / 34.551 | 53.5827 / 34.750 | no |
| tui | 55.2334 / 26.216 | 55.3016 / 26.473 | no |

Both confirmation collections are valid and contain no optional stage
profile. Neither repetition meets the required 60 FPS in every pane for all three
payloads. Credit batching is insufficient. Do not tune batch size, waiting,
4 ms cadence, workload, geometry or thresholds to pursue a favorable result.

## Retained diagnostic collections

- `historical-014`: old optimized profile binary, SHA256
  `662f87d1668d3f0032e943290d82aa74d534a9a133db66703e0c83084c7fe32b`,
  source `014b72d592b411ee7fb2de46ed5b0dc01eba1479`, runner `89a5bd6`.
  Both collections completed; ASCII 2 had only 4.131 s of common activity.
  This does not establish what caused the earlier stalled attempts.
- `control-489`: source `489be42`, binary SHA256
  `d95a6b0605413c174c05f83fc7f6c1adaee7dfd2982c23301dea9f8771424c1a`,
  runner `89a5bd6`. Both collections are valid and below 60 FPS.
- `invalid-batched-489`: same source/binary/runner as that control. All six
  cases are invalid: WebKit rejected an unbound `Window.queueMicrotask`
  receiver. No batch invocation occurred. Native parsing completed and sent
  only initial/final frames; its zero repaint rates are not performance data.
  The correction and two observed-red regressions are recorded in `e500b32`.

The old and new controls are not spliced into a cross-binary comparison.
No selective replacement or threshold adjustment was made for short cases.

## Evidence and decision

`*.gz` files contain the exact original bytes of final reports, runner data,
status, samples, process baseline, hardware, controller and app logs.
`original-files.json` records both compressed and original hashes and sizes.
Gzip mtime is fixed to zero; decompression was checked byte-for-byte.
`derived.json` records all 36 cases, including invalid reasons, and recomputes
the minimum FPS from each pane's update count and the common duration.
`SHA256SUMS` covers this complete evidence directory except itself. No sandbox
home, discovery token, settings store or private terminal capture is included.
Intermediate checkpoints remain on the M2; complete final reports retain all
measured events. These are bench generators, not a claim of real user parity.

Next: one bounded frame-delivery batching experiment, registered separately,
then an explicit architecture decision. Tauri 2.11.5's installed
`src/ipc/channel.rs` sends raw messages of at least 1024 bytes through a fetch
command. These frames usually exceed that threshold. The source therefore
supports testing fewer per-window deliveries; it does not prove a bottleneck.
The existing WASM link/codec proof does not evaluate raw-byte transport or a
Worker. Moving parser ownership would send substantially more bytes over IPC
for this workload, so that alternative needs an integrated comparison.
Phases 2 through 5 and all normal-pane parity acceptance remain open.

Source validation for the scheduler correction is recorded in the experiment
plan: full frontend/Pi/Node/Rust gates passed and Astra independently reviewed
the final diff. No Actions, push, merge, release or original-Mac native build
was performed.


Independent evidence review: Astra verified all 92 manifest entries and all
89 gzip files, including their uncompressed hashes and sizes. It recomputed
all 36 common windows and per-pane rates from the raw drawn events and
confirmed the six unprofiled cases' barriers and credit accounting. No blocker
was found in the result record or decision. No benchmark ran during review.
