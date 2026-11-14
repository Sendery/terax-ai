# Terminal Lab credit batching experiment

Registered before graphical execution. This is a Phase 1 comparison, not a
migration phase, a production change or evidence that 60 fps has been reached.
The accepted `4e8694a` native gate remains negative. The headless WASM proof
establishes limited link/codec feasibility; it does not select a Worker design.

## Question and fixed workload

Does registering credits in one command after a shared draw reduce command
traffic and improve the slowest pane's update rate? Native frames, terminal
ownership, byte queues, snapshot/codec, generator and Pump stay unchanged.
Every credit still names the same `id` and `seq`. Command registration is not
Pump acceptance; `rust[].credits` remains the accepted-acknowledgement counter.
No improvement can be attributed to a particular stage without measurements.

The existing gate and profile gate are the controls. Candidate modes are
`gate-engine-batched` and `gate-engine-profile-batched`. All four use the same
three ASCII/SGR/TUI generators, twelve 100x30 grids, 1024 MiB per session, full
native-font backbuffer, 180 s case timeout, 250 ms warmup and minimum 5 s common
interval. Every measured variant runs twice. No benchmark threshold, geometry,
payload, final-frame barrier or report size bound changes.

## Implemented candidate

Only `runBench` opting into `batchCredits` creates a window-local batcher and
passes its sender to `EngineSession.openBench`. Ordinary engine opens and the
existing modes keep `gterm_credit`; production xterm remains byte-for-byte
unchanged. Both variants from the same source preserve the real draw timestamp
for delayed-open credits, so they share that small bookkeeping cost.

A microtask registered during the renderer's post-draw callbacks dispatches
acknowledgements when that same draw task returns. It does not wait for another
rAF and never returns credit before a draw. Delayed session ids hold drawn
acknowledgements until open completes. A batch contains at most twelve distinct
ids, in enqueue order. Multiple sequences for one id go in separate invocations;
no pair is replaced with a newer sequence. An exact duplicate outstanding pair
is rejected explicitly. Joint queued/in-flight acknowledgement storage is
limited to 48. Crossing that bound rejects the measurement, not bytes or state.

`gterm_lab_credits` requires the existing autorun authorization: sandbox,
`terminal-lab` calling window and absolute environment-selected output path.
Its bounded argument accepts 1 through 12 distinct positive u32 ids/sequences
and rejects unknown fields. It resolves all ids against bench sessions under
one lock before registering any controls. Real PTY session ids are rejected.
It calls the same non-blocking `EngineHandle.credit` for each pair; the existing
Pump decides whether a sequence matches its outstanding frame. A completed
command does not promise individual Pump acceptance, including at shutdown.

Batch replies resolve/reject every member. Synchronous dispatch errors and
rejections without an error value remain failures. Closing the batcher rejects
all queued/in-flight local promises and prevents later microtask dispatch.
The final receive/draw barrier and wall/rAF/draw counters stop as before; reply
draining is outside that interval and bounded by five seconds. Incomplete,
failed, rejected or missing registration makes the candidate invalid even
when all frames arrived. Native processing still preserves every input byte.

## Recorded evidence

The existing stage profile keeps one tuple per received sequence. `onCredit`
marks dispatch inside the batcher's microtask, immediately before the command
call, rather than enqueue. Consequently `creditSentAt` and `creditCommandMs`
retain dispatch-to-command-reply semantics in both profiled modes. They include
synchronous JS dispatch preparation, not native Pump acceptance. Clock
quantization still applies; native and JS clock values are never subtracted.

Candidate `creditBatch` adds bounded aggregate bookkeeping:

- queued, registered, failed, rejected, pending and maximum pending counts;
- actual command invocation count and batch-size histogram indexed 0 through 12;
- count, sum, minimum and maximum enqueue-to-dispatch delay (`dispatchDelayMs`);
- the same aggregates for actual draw-to-dispatch delay (`drawToDispatchMs`), including any delayed-open wait.

These delay aggregates are not percentile estimates. Registered counts are
command replies, not accepted native credits. The runner requires complete
batch bookkeeping and one registration per received frame, alongside the
unchanged sustained interval, native stats and final-frame checks. Runner
success still means complete collection, not 60 fps. Original modes allocate
no batcher and retain their existing report fields.

## Execution order and decision

1. Obtain an actual unlocked M2 console; the runner's existing GUI guard must
   report it available. No policy change or sudo command substitutes for this.
2. Repeat the existing `014b72d` profile binary that previously stalled. Lock
   was observed afterward, so it is not a proven cause. If it stalls again,
   diagnose that failure before measuring the candidate.
3. Build one optimized sandbox binary from the final reviewed experiment
   source, production frontend and the same verified prebuilt core. Record
   source, runner, binary and core hashes. Preserve the old diagnostic binary.
4. With no builds/tests running concurrently, collect `gate-engine-profile`
   twice, then `gate-engine-profile-batched` twice from that same new binary.
   Invoke the runner separately for each mode: a combined mode list alternates
   modes within each repetition and would change this registered order.
   Retain complete raw reports, graphics/hardware/GUI state and teardown.
5. Report both repetitions and dispersion: minimum individual-pane FPS, common
   intervals, frame and byte throughput, stage distributions, native accepted
   credits, invocation count, batch sizes and draw/queue delay aggregates.
   Profile overhead is held constant; do not claim GPU/presentation causality.
6. If the candidate helps, repeat `gate-engine-batched` twice without optional
   stage-profile tuples. Batch bookkeeping and the normal benchmark timelines
   remain enabled. It must independently meet 60 fps in every panel for the
   unchanged acceptance workload before proceeding. A faster incomplete run
   or only an instrumented improvement cannot pass.

Before unlock, only preparation, unit/domain checks and compilation can be
verified. No performance result is accepted for this candidate. Phases 2 to 5,
production default changes, merge and publication remain outside this step.


## Preparation checks

The source began clean at `ee3cf98`; all baseline gates passed on M2. New
queue, lifecycle, delayed-id, closed-mode, fixed-workload and dispatch-timestamp
regressions were observed failing before their implementation. Astra found
that the first profile integration timestamped enqueue; per-sequence dispatch
callbacks correct that without changing profile assertions. Additional tests
cover observer exceptions and isolation between window-local senders.

Final preparation checks on M2 passed:

- `pnpm lint`, `pnpm check-types`, `pnpm test` (2299 passed, one existing skip), `pnpm build`.
- `pnpm --dir packages/pi-terax test` (101 passed).
- `node --test scripts/*.node-test.mjs scripts/libghostty/*.node-test.mjs` (42 passed).
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings` and `cargo test --manifest-path src-tauri/Cargo.toml --locked` (584 unit, 58 integration, one ignored).
- `.terax/pi-development/m2/with-ghostty cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked --features ghostty-engine -- -D warnings` and `.terax/pi-development/m2/with-ghostty cargo test --manifest-path src-tauri/Cargo.toml --locked --features ghostty-engine` (620 unit, 58 integration, two ignored).
- `git diff --check`; independent final Astra review found no residual blocker to the local preparation commit.

The historical optimized profile binary was preserved before rebuilding its
target, SHA256 `662f87d1668d3f0032e943290d82aa74d534a9a133db66703e0c83084c7fe32b`.
This artifact and any new optimized binary are preparation, not proof that
WKWebView ran the candidate. No Actions, push, merge, production default or
protected-original-Mac native build occurred in this step.


## First graphical collection and scheduler correction

The unlocked historical `014b72d` diagnostic completed twice with native exit
0 and complete frame/profile accounting. ASCII repetition 2 had only 4.131 s
of common activity and is not a valid sustained gate; it is retained rather
than selectively repeated. This does not establish the cause of the earlier
stalls. The `489be42` control completed two valid collections, still below
60 minimum pane updates/s for every payload.

Both first `489be42` candidate repetitions are invalid. Real WKWebView
rejected the detached `Window.queueMicrotask` receiver, so no batch command
was dispatched. The native engines parsed all bytes and sent initial/final
frames, which is not evidence of continuous repainting. The runner correctly
rejected the reports for explicit errors and incomplete batch/profile data.
Do not use their zero FPS values as candidate performance results.

The correction wraps the global scheduling method and closes/rejects pending
work if scheduling throws, including a callback retained before the throw.
Two new unit regressions were observed failing before the correction. This
changes neither the registered workload nor the intended microtask policy.
Preserve the old runs; rebuild one new optimized binary and repeat the whole
A,A,B,B comparison from that source. No control result is spliced across
binary versions. Native graphical confirmation is still required.


Correction validation on M2: the focused credit batch suite passes 13 tests.
`pnpm lint`, `pnpm check-types`, `pnpm test` (2305 passed, one existing skip),
`pnpm build`, `pnpm --dir packages/pi-terax test` (101 passed), and
`node --test scripts/*.node-test.mjs scripts/libghostty/*.node-test.mjs`
all passed. Strict `cargo clippy --manifest-path src-tauri/Cargo.toml
--all-targets --locked -- -D warnings` and `cargo test --manifest-path
src-tauri/Cargo.toml --locked` passed both without the feature (588 unit,
58 integration, one ignored) and through the verified prebuilt wrapper with
`--features ghostty-engine` (629 unit, 58 integration, two ignored).
`git diff --check` passed. Astra's independent final read found no blocker.
These checks establish the correction's preparation; graphical validity and
performance still require the new same-source comparison.


## Measured decision after correction

The `e500b32` candidate runs correctly in real WKWebView. Both final
unprofiled confirmations are valid, but the minimum individual-pane rates
remain ASCII 39.2021/39.5049, SGR 54.3255/53.5827 and TUI 55.2334/55.3016.
The answer to the Phase 1 60 FPS criterion remains **no**. Batching credits
reduces invocation traffic but is insufficient; this experiment is closed.
Do not continue tuning its batch size or waiting policy.

The instrumented comparison, its short ASCII intervals, all earlier invalid
runs, exact provenance, native accepted-credit counters and full raw reports
are retained in [the M2 result record](../../spikes/terminal-ghostty-vt/results/phase1/m2-2026-11-14-credit-batch/README.md).
The next bounded transport comparison must be registered separately before
measurement. Normal-pane integration, rollout and the full parity matrix are
still required, after the performance architecture decision.
