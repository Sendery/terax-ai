# Terminal Engine: handoff for the integration and Phase 1 measurements

This document hands the remaining Phase 0 and Phase 1 work of `docs/plans/2026-11-10-terminal-ghostty-vt-webgl2.md` to a development agent working in another environment. It is self-contained: read it top to bottom, then the three documents under "Read first".

## The issue

The work stopped on the original development host because its endpoint protection agent terminates the process tree that runs the engine build.

- Two terminations on 2026-11-10 (03:39 and 10:19 local time), both reported by the agent's behavioural module with action "Terminate" and "Quarantined: True". The source process in both reports is the terminal application the build was launched from, so the whole tree died: the build, the coding session and every other session in that terminal.
- Both happened while `cargo` was building `libghostty-vt-sys` through `scripts/with-zig.mjs` (first build of the spike, then `pnpm build:sandbox --no-bundle --features ghostty-engine`). About fifty minutes of identical builds in between ran without a report, so the rule that fires is not known. The report shows no rule name.
- The same module terminated the same application twice in July 2026, before this work existed. The engine build is therefore a trigger, not necessarily the only one.
- What is specific to this build on that host: a freshly downloaded Zig compiler, native binaries produced and executed inside `target/`, a `git clone` of Ghostty plus package fetches from a build script, and, on macOS 26 and later only, a wrapper that shows Zig a stand-in SDK and an `xcrun` replacement (see "Build finding" in the plan).

Decision: nothing is done on that host to get around the agent. The remaining work runs where no such agent is present, and Phase 0 is finished so that the original host never needs Zig again (Task A).

Consequence for the code: none of the engine or renderer code is in question. All four commits passed their gates before the stop. The interrupted work is integration and measurement only, and no file was changed after `369b0e1`.

## State of the branch

Branch `feat/terminal-ghostty-vt-webgl2`, from `qa` at `a132715`.

| Commit | Content |
|---|---|
| `96a1c16` | Plan and spike (`docs/plans/2026-11-10-terminal-ghostty-vt-webgl2.md`, `spikes/terminal-ghostty-vt/`) |
| `3c5eedb` | Contract: `docs/architecture/terminal-engine.md` |
| `5ba4578` | Rust engine behind the `ghostty-engine` feature, `scripts/with-zig.mjs`, frame fixtures |
| `369b0e1` | WebGL2 grid renderer and the Terminal Lab window |

Verified at `369b0e1`, macOS arm64 only:

- `pnpm lint`, `pnpm check-types`, `pnpm test` (2199 tests), `vite build`.
- `cargo clippy --all-targets --locked -- -D warnings` and `cargo test --locked`: 559 tests without the feature, 587 with it.
- Encoder: full 200x60 frame 20 to 29 KB, 191 to 257 microseconds optimized, 1.2 to 2.0 ms in a plain debug build.
- Backpressure test: the reader stalls at `QUEUE_DEPTH` 8 and no byte is lost.

Not yet verified at `369b0e1` (see Handoff result for later validation):

- The Rust half and the webview half running together. The sandbox app has never been launched with the feature.
- Anything in a real webview: shader compilation, `Channel<ArrayBuffer>` delivery, capabilities of the `terminal-lab` window, the credit loop.
- Linux and Windows builds of the feature. There is no `ci.yml`; only `release.yml` exists.

Known gaps and risks carried over from review:

- No theme colours reach the engine (white on black), no bracketed paste, mouse reporting or application cursor mode in `keyInput.ts`, cursor blink is ignored. Paste, mouse and cursor mode belong to Phase 2; colours are Task B1.
- `src/main.tsx` calls `pty_close_all` when the main window reloads, which kills the lab's sessions. Acceptable for the lab; note it, do not redesign it.
- The engine thread can block while writing terminal replies to the PTY if the child does not read. Keep it in mind when a run stalls; fix only if observed.

## Read first

1. `TERAX.md`: conventions and quality bar. Comments default to none and explain only why, no em-dash characters, no emojis, `@/` imports, pnpm only, functional core and thin shell, tests for core subsystems.
2. `docs/architecture/terminal-engine.md`: the contract for both halves and the single source of truth. Edit it only to record decisions that are implemented.
3. `docs/plans/2026-11-10-terminal-ghostty-vt-webgl2.md`: the plan. "Spike results" and the Phase 1 exit criterion matter most.
4. Code: `src-tauri/src/modules/pty/engine/*`, `src-tauri/src/modules/pty/gterm.rs`, `src-tauri/src/modules/pty/session.rs`, `src-tauri/src/lib.rs`, `src/modules/terminal/gl/*`, `src/terminal-lab/*`, `scripts/with-zig.mjs`, `scripts/sandbox.mjs`.

## Environment

- Rust stable, Node 22 or newer and pnpm. The default feature build needs the published checksum-pinned archive for its host, not Zig. The explicit source route needs network for pinned Ghostty and checksum-verified Zig 0.15.2.
- Every command that compiles the feature goes through `node scripts/with-zig.mjs -- <command>`. Missing or invalid prebuilt artifacts fail closed. There is no SDK stand-in; do not use `--source` on the protected original Mac.
- Run the app only through the sandbox identity: `pnpm dev:sandbox` and `pnpm build:sandbox` (`scripts/sandbox.mjs`, identifier `app.crynta.terax.sandbox`). It has its own stores and cache root. Read the "Persisted stores are single-instance" gotcha in `TERAX.md` and `src-tauri/src/modules/profile.rs` before the first launch.
- The measurements that decide the exit criterion are about WKWebView, so they need macOS. On Linux, do Tasks A and B and bring the lab up under WebKitGTK (`xvfb-run`) to shake out integration bugs; record any numbers taken there as Linux numbers and leave the macOS tables empty and marked as pending rather than extrapolating.

## Task A: finish Phase 0 with a prebuilt terminal core

Goal: a host can build and run the engine without Zig, by linking a prebuilt static library.

1. A GitHub Actions workflow (`.github/workflows/libghostty-vt.yml`, manual dispatch plus a run when the pin changes) that builds the static library from the pinned Ghostty commit with Zig 0.15.2 and `ReleaseFast` for `aarch64-macos`, `x86_64-macos`, `x86_64-linux` and `x86_64-windows`, and publishes one archive per target with a SHA-256 manifest as assets of a dedicated release (tag `libghostty-vt-<crate version>-<short commit>`). Use a macOS runner image whose SDK Zig 0.15.2 links against natively, so the workflow does not need the stand-in SDK.
2. Consume it through the crate's `pkg-config` route. `scripts/with-zig.mjs` (rename it if the name stops fitting, and update the docs) gains a prebuilt mode that downloads the archive for the host, verifies it against checksums pinned in the repo, unpacks it under `src-tauri/target/toolchains/` and exports what `libghostty-vt-sys` needs to find it. Prebuilt is the default when an archive exists for the host; building from source stays available behind an explicit flag or environment variable.
3. A `ci.yml` that runs the frontend gates and the Rust gates without the feature on Linux, macOS and Windows, and with the feature on at least Linux and macOS using the prebuilt library.
4. Record in the plan: the pinned commit, the upgrade procedure (bump the crate, rebuild the archives, update the checksums), and that the source route needs network access.

Acceptance: on a clean checkout with no Zig installed, `cargo test --locked --features ghostty-engine` passes through the wrapper on macOS arm64 and Linux x86_64, and the wrapper starts no Zig process in prebuilt mode.

If the crate's `pkg-config` feature cannot express a fully static link on some target, stop on that target, document why, and keep the source build there.

## Task B: review findings

Each with tests where the logic is pure.

1. **Theme colours.** The engine resolves colours against libghostty's built-in palette. `gterm_open` and `gterm_bench_open` take an optional `colors: { foreground, background, cursor?, palette: string[16] }` (`#rrggbb`), and a new `gterm_set_colors(id, colors)` applies a theme change to a live session through the control record, followed by a full frame. Use `set_default_fg_color`, `set_default_bg_color`, `set_default_cursor_color` and `set_default_color_palette`, keeping the default entries 16 to 255. Bad colour strings are an error in Rust, never a panic. The lab passes the colours the xterm.js pane uses and sends them again when the theme changes. Update the contract.
2. **Resize before open completes.** `EngineSession.resize` stores the size but never sends it while the session id is unknown. After `start` resolves, send `pty_resize` when the stored size differs from the size the session was opened with. Add a test.
3. **`creditWaitMicros`** holds the last value while its siblings are cumulative. Make it cumulative and add a `credits` count beside it, in the contract and in the frontend type.
4. **Encoder speed in debug builds.** A debug build measures a slow terminal core (1.2 to 2.0 ms per frame against about 0.2 ms). Decide how the sandbox is built for measurement, document it, and add nothing that makes the default build print warnings.
5. Whatever the first real run shows to be wrong (shaders, IPC argument names, capabilities for `terminal-lab`, frames not arriving as `ArrayBuffer`, credit stalls, layout). Fix at the root on the side that is wrong. If the contract is wrong, fix the contract and both sides.

## Task C: make it run

Bring up the sandbox with the feature and get the Terminal Lab working: an engine pane with a real shell next to an xterm.js pane.

- Prefer the unattended path: `TERAX_TERMINAL_LAB_AUTORUN=<absolute result path>` opens the lab at startup, runs the bench, writes the JSON report through `gterm_lab_report` and exits.
- Add a lab-only, autorun-only way to capture what the lab renders (read the WebGL canvas back in the task that draws it, or a Rust command restricted to autorun mode). Keep it out of the normal code path.
- Capture the engine pane after a short scripted shell session (`printf` with colours, a wide CJK string, an emoji, `ls -la`) and the same on the xterm.js pane. Look at the images and confirm text, colours, cursor and wide characters; fix the renderer if they are wrong. Save them under `docs/plans/assets/`, under 400 KB each.

## Task D: Phase 1 measurements

Build so the numbers mean something: the production frontend bundle and optimized Rust for both `terax` and the terminal core. A release build with fat LTO is heavy; `pnpm build:sandbox --no-bundle`, or a debug-profile build with `CARGO_PROFILE_DEV_OPT_LEVEL=3`, `CARGO_PROFILE_DEV_DEBUG=false` and `CARGO_PROFILE_DEV_DEBUG_ASSERTIONS=false`, are both acceptable. Record exactly what was built.

Produce, as listed in "Measurements phase 1 must produce" in the contract:

- frames per second and frame bytes per second over the `Channel` for 1 and for 12 concurrent bench sessions per payload kind (`ascii`, `sgr`, `tui`), with the webview's `requestAnimationFrame` interval p50, p95 and max while they run, and the Rust-side stats (bytes fed, MB/s fed, encode time per frame);
- credit round trip p50 and p95;
- keystroke echo p50 and p95 on the engine pane and on the xterm.js pane in the same window;
- resident memory of 12 idle engine terminals with 10 000 lines of scrollback each against 12 idle xterm.js terminals, measured from outside the app, naming the processes summed. Add a lab mode that opens N idle terminals of one kind and waits;
- xterm.js flooded with the same payloads in the same build and window (1 pane, and 5 or 12 panes), so the comparison is made inside Tauri and not against the standalone spike.

Run the bench at least twice and report the spread. Then answer the exit criterion explicitly: can frame delivery over the `Channel` sustain 60 frames per second for 12 panes repainting continuously, yes or no, with the numbers. If not, say where the time goes (encode, Channel serialization, decode and apply on the main thread, GPU) and what would fix it (per-window batching, scroll shift, WASM in a Worker). Do not tune the benchmark to pass.

Write the results into the plan as a section "Phase 1 results (sandbox)" after "Spike results", in the same style, including what was not measured. Raw JSON goes under `spikes/terminal-ghostty-vt/results/phase1/`. Add a short "Terminal engine" paragraph to `TERAX.md` in the module layout area that points to the contract and says the engine is feature gated and lab only.

## Gates

- `pnpm lint`, `pnpm check-types`, `pnpm test`.
- From `src-tauri/`: `cargo clippy --all-targets --locked -- -D warnings` and `cargo test --locked`, then the same two with `--features ghostty-engine` through the wrapper.
- No sandbox process left running.

## Working rules

- Commit on this branch in small conventional commits (`feat(terminal): ...`, `docs(terminal): ...`, `ci: ...`), as the repository's author identity; see `AGENTS.md`. Do not merge into `qa`: the lead reviews the branch first, and the merge is `git merge --no-ff` with the message `merge: <description> into qa`.
- The xterm.js path stays byte for byte as it is (invariant 6 of the contract). The engine stays off by default and reachable only from the Terminal Lab.
- Never run a non-sandbox dev or build of this repo next to an installed Terax: it shares the stores.
- Report measured against assumed, and anything that failed. A measured negative result is worth more than an optimistic guess.

## Report back

A final section appended to this file, "Handoff result", with: what changed (review fixes separated from bugs found by running), the exact build and launch commands, gate output tails, the measurement tables with the spread and the explicit answer to the exit criterion, what the screenshots show, and what is still unverified.


## Handoff result

### Review fixes

- Added validated initial and live theme colors on the Rust engine thread, keeping extended palette entries 16 through 255. The lab supplies the same resolved theme colors as xterm.js, including changes while a session opens.
- Replayed a pending normal-session resize after the session id arrives. Benchmark sessions do not send PTY resize commands.
- Added accepted-credit counts and cumulative-wait regression tests. Inspection found that `creditWaitMicros` was already cumulative; no double-counting change was made.
- Documented optimized sandbox measurement commands without changing the default app profile or adding default warnings.
- Added the pkg-config prebuilt route, checksum validation, stable verified cache, explicit source opt-in, native four-target producer and cross-platform CI. Missing artifacts fail closed. The SDK shim was removed.

### Integration findings and limits

The full Linux feature build found one Rust closure-inference error in the new RGB adapter; an explicit byte-array type fixes it. Feature clippy and tests pass after the fix. No bug is attributed to a real webview run because no such run completed.

Xvfb cannot establish display sockets in this environment. Task C's scripted shell comparison and captures are therefore not complete. There are no new screenshots to inspect or claim. Task D remains open as recorded in the plan's "Phase 1 results (sandbox)" section. No sandbox or X server is left running.

### Exact validation commands and output tails

Linux development dependencies were installed in a workspace-local sysroot from signed Debian repositories. `with-linux-deps` below sets local pkg-config, library and WebKit paths; it does not change the project or the original Mac. Rust tools are on PATH.

```sh
pnpm lint
# Checked 740 files; exit 0. Existing 109 warnings and 2 infos remain.
pnpm check-types
# tsc --noEmit; exit 0.
pnpm test
# Test Files 228 passed. Tests 2241 passed, 1 skipped.
pnpm build
# Production frontend bundle built successfully.
node --test scripts/libghostty/core.node-test.mjs scripts/libghostty/licenses.node-test.mjs
# 19 tests passed.
node --test scripts/terminal-lab.node-test.mjs scripts/terminal-lab-cleanup.node-test.mjs
# 8 tests passed.
with-linux-deps cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
# Finished dev profile; exit 0.
with-linux-deps cargo test --manifest-path src-tauri/Cargo.toml --locked
# Unit: 586 passed, 1 ignored. Integration: 25 + 26 + 7 passed.
with-linux-deps node scripts/with-zig.mjs -- cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked --features ghostty-engine -- -D warnings
# Finished dev profile; exit 0.
with-linux-deps node scripts/with-zig.mjs -- cargo test --manifest-path src-tauri/Cargo.toml --locked --features ghostty-engine
# Unit: 621 passed, 2 ignored. Integration: 25 + 26 + 7 passed.
CARGO_TARGET_DIR=src-tauri/target/prebuilt-smoke node scripts/with-zig.mjs -- cargo run --manifest-path scripts/libghostty/smoke/Cargo.toml
# prebuilt terminal create/feed/render succeeded
# Repeated invocation reuses the compiled consumer.
```

The required handoff gates pass on Linux. A separate whole-repository `cargo fmt --check` reports extensive pre-existing formatting differences outside this task; unrelated modules and the production xterm path were not reformatted. New/changed terminal engine modules were formatted and `git diff --check` passes.

### Publication and remaining acceptance

Local experimental archives exist for Linux x86_64 and macOS arm64/Intel; the Apple archives have the expected Mach-O architecture but no native link/runtime validation. Local hashes marked publication pending are not canonical release artifacts. The native producer must build release-ready archives including dependency notices, run its platform smoke checks, publish the immutable release and supply the real checksums for a follow-up pin update. Windows is unbuilt locally.

Work remains on `feat/terminal-ghostty-vt-webgl2`. No merge into `qa` or another branch is authorized or performed. No further build ran on the original Mac and its interrupted build directory was not removed.


### Hosted laboratory preparation

Task C/D automation now includes actual after-draw engine and xterm PNG capture, the scripted color/wide-character/emoji/directory session, a byte-identical Rust payload fixture for xterm flooding, and idle modes for external memory sampling. The new writes are restricted to an autorun sandbox Lab window, fixed adjacent output names, bounded PNGs and validated JSON. Successful reports close PTYs before exit. The hosted runner records sanitized hardware and named-process RSS, repeats each mode twice, and treats incomplete or failed measurements as failures.

The hosted Intel workflow uses an explicitly checksum-verified native CI artifact while arm64 release publication is waiting for GitHub capacity. This is separate from the default release consumer route. No hosted graphical result has yet been accepted: the existing measurement table and 60 fps criterion remain pending until the reports and actual PNG pixels are reviewed. The original Mac is still not used for compilation or execution.

Cross-platform CI exposed pre-existing Windows test portability issues: CRLF shebang transforms, file URL entrypoint comparisons, platform path separators and PowerShell startup costs for real ACL integration. The fixes preserve the production checks, add CLI and LF/CRLF regressions, and keep native ACL assertions. Windows CI must be checked on the final commit before claiming all platforms pass.


Review of the measurement harness found that the core's scrollback option is a byte budget, not a line count. The engine now names a bounded 16 MiB byte policy, reports actual history rows, and the idle benchmark must verify exactly 10000 rows on both engines. This corrects a potential false memory comparison; no previous RSS result is claimed. Regression coverage also checks late PTY data after exit, renderer completion, complete echo samples and bounded cleanup of independently grouped PTY descendants.


After the harness and scrollback fixes, full Linux clippy and tests passed both with and without the feature (634 baseline tests and 669 feature tests, including integration suites). Frontend lint, typecheck, 2224 tests and the production bundle passed. The independent harness review's four findings were fixed and rechecked. Native Windows frontend gates passed after the portability fixes; its next CI stage exposed pre-existing Rust platform-cfg issues, which remain subject to the final Windows run.


The Windows Rust base failure was traced to stale TTS references after the existing process-job refactor and Unix-only slot monitor imports. The patch reuses `proc::job::ProcessJob`, scopes Unix helpers, and tests the unsupported-platform response without modifying PTY behavior or suppressing warnings. Linux strict clippy and all nine affected module tests pass; native Windows confirmation remains with CI.


### Hosted run and follow-up status

The Intel laboratory run [42842787247](https://github.com/Sendery/terax-ai/actions/runs/42842787247) built the sandbox successfully at `ad27cf6149464fecd4ee848419a71b1c6be41121`, then failed in the native execution stage. Its diagnostic artifact is `terminal-lab-macos-intel-ad27cf6149464fecd4ee848419a71b1c6be41121` (artifact id `13778865488`, 18791 bytes). The artifact and logs have not yet been read; the public failure annotation contains only exit code 1. Do not infer a renderer, IPC, permission or cleanup cause from that annotation. No screenshot pixels or successful measurement report have been reviewed, and the Phase 1 exit criterion is still not verified.

The hosted build and launch commands were:

```sh
CARGO_PROFILE_DEV_OPT_LEVEL=3 CARGO_PROFILE_DEV_DEBUG=false CARGO_PROFILE_DEV_DEBUG_ASSERTIONS=false node scripts/with-zig.mjs -- pnpm exec tauri build --debug --no-bundle --features ghostty-engine --config "$PWD/src-tauri/tauri.lab-ci.json"
node scripts/terminal-lab.mjs src-tauri/target/debug/terax "$RUNNER_TEMP/terminal-lab-results"
```

Follow-up fixes prepared after that commit address native CI findings: Unix-only waker writes are cfg-gated, UTF-16 decoding preserves prior lossy/trailing-byte behavior while using aligned byte chunks, and shared CLI entrypoint detection resolves symlinks on both paths. The latter prevents macOS `/var` versus `/private/var` aliases from silently skipping CLI execution. Regressions cover escaped paths, aliases/junctions, preserved entrypoint symlinks and import-only execution. They do not prove the cause of the separate laboratory failure.

The prebuilt packager now carries an offline, SHA-256-verified bundle of 24 dependency notices with five source-file checks. This recovers notices omitted by upstream package archives and checks the actual vendored SIMDUTF version. Pin changes require a new license review before a build starts. The producer preserves source bytes across Windows checkout settings. Do not publish or retry the old producer as a release candidate: its already-built archives do not contain the corrected bundle. A new four-target producer run is required after these changes are published.

Full Linux validation after these follow-ups passes: strict clippy in both modes; 644 baseline and 679 feature Rust tests including integration suites; 2241 frontend tests and one skip; types, lint, production frontend build; and 27 Node wrapper, license and laboratory-runner tests. The native Windows and macOS gates must still run against the final published revision. These follow-ups are pending publication, not part of the recorded `ad27cf6` run.

A separate ARM64 archive was prepared on Linux as a provisional transfer artifact, with complete notices, provenance and per-file checksums. Its archive SHA-256 is `fd8ca44691ced7b1fa368666fb5546ba8bf4318b717b356ea0a36a2aada49fe0`; size is 841375 bytes. All 11 objects are Mach-O ARM64 with minimum macOS 13.0. Debug information was removed from a copy, and the external symbol set was checked unchanged. This is not a native ARM link/runtime result, a canonical release or an accepted consumer input. It does not change repository pins. Do not invoke Cargo directly, opt into source mode or bypass the wrapper guard to consume it.

### Prebuilt recovery, 2026-11-11

Applied the supplied follow-up patch to `ad27cf6`, including Windows fixes,
CLI entrypoint handling and dependency notices. No merge, push, publication
or new Actions run was performed.

Static review of the supplied ARM64 tar confirmed its recorded archive hash,
all 62 per-file hashes and 11 Mach-O arm64 members. It contains no symlinks or
unsafe paths. These checks do not establish ABI or runtime compatibility.

An explicit `--provisional <archive>` wrapper route now consumes these exact
bytes with a dedicated manifest and cache. Canonical pins are unchanged.
Missing files, invalid hashes, host/source identity changes, corrupt caches,
source environment overrides and pkg-config failure stop the consumer.
Preparing the actual attached archive through this route succeeded with a
Node-only child, without compiling or loading the static library.

Independent review found that the previous PATH guard still allowed the
upstream build script to clone Ghostty before it reached Zig. Both Cargo
workspaces now patch sys 0.2.2 to an unchanged-binding copy with an explicit
source-build guard. It fails before source fetch unless the exact opt-in
`TERAX_GHOSTTY_SOURCE_BUILD=1` is supplied by the source wrapper. Its MIT
notice and upstream provenance are included. Lockfile resolution was updated
offline using the already installed Rust 1.97.1 toolchain.

The existing Intel diagnostic artifact was retrieved and its ZIP checksum
verified: `ac8e5bbfe1c326450cf9ff53354e450fe80e0ec447e3d3836b0b05b5d79106d2`.
It reports pane-readiness failure, shader-allocation failure and a falsy-value
error from autorun. No successful captures or performance measurements were
produced. The root causes of those separate lab failures remain unverified.

Validation completed on the recovery tree:

```sh
pnpm check-types
# Passed.
pnpm lint
# Passed, existing 109 warnings and 2 infos.
pnpm test
# 228 files passed; 2241 tests passed, 1 skipped.
pnpm build
# Extension and production frontend built successfully.
pnpm --dir packages/pi-terax test
# 9 files, 101 tests passed.
node --test scripts/libghostty/core.node-test.mjs scripts/libghostty/licenses.node-test.mjs scripts/libghostty/provisional.node-test.mjs scripts/terminal-lab.node-test.mjs scripts/terminal-lab-cleanup.node-test.mjs
# 31 tests passed, including actual wrapper/cache/process tests.
```

Native verification commands are prepared but have not been executed on this
Mac, preserving the original user's host restriction while clarification is
pending. They compile only the policy probe or small smoke consumer, not the
whole app:

```sh
RUSTUP_TOOLCHAIN=1.97.1 node --test scripts/libghostty/policy.node-test.mjs
RUSTUP_TOOLCHAIN=1.97.1 node scripts/with-zig.mjs --provisional /absolute/path/to/libghostty-vt-0.2.2-a887df4-aarch64-macos-provisional-linux-cross.tar.gz -- cargo run --offline --locked --manifest-path scripts/libghostty/smoke/Cargo.toml
```

The policy probe forces pkg-config failure and spies on git and Zig; it must
reject missing/invalid opt-in and source-directory overrides before either
producer process is started. Its explicit source case invokes a spy, not real
git or Zig. Native smoke, backend clippy/tests, ARM64 app execution and Phase 1
measurements remain pending. No native app was launched, no compiler Zig was
executed and no antivirus settings were changed in this recovery work.

### M2 setup and native ARM64 validation, 2026-11-14

The dedicated M2 now has a separate checkout at the same project path as the
original host, on this feature branch, with all pending recovery changes.
No native build ran on the original protected host. No Actions run, push or
merge was performed. Sendery's author/committer identity, SSH authentication,
GitHub CLI login, repository push permission and a non-mutating push dry-run
were verified on the new host.

Host: macOS 27.0.1, Apple Silicon arm64, 8 GiB RAM, 8 CPUs. Build tools:
Apple Command Line Tools, Rust 1.97.1 with clippy/rustfmt, Node 24.22.3, pnpm
11.5.0, pkg-config 3.0.10, Python 3.13.18, CMake 4.5.0 and cargo-nextest
0.9.152. Rust used two parallel jobs. Shell setup also covers non-interactive
SSH. Machine-local instructions, the provisional artifact and output logs are
under the ignored `.terax/pi-development/m2/` directory.

The real sys build-script policy test passed, including missing and invalid
source opt-in, a source-directory override and an explicit opt-in that reaches
only a process spy. The ARM64 static archive then linked and executed the
Rust create/feed/render smoke successfully. No Zig compiler is on the host's
normal PATH. This establishes native smoke compatibility for these exact
provisional bytes, not canonical publication or renderer performance.

The machine-local `with-ghostty` helper expands to the checked-in wrapper with
`--provisional` and the archive in its adjacent `artifacts/` directory. Exact
validation commands and results:

```sh
pnpm install --frozen-lockfile
# Passed.
pnpm lint
# Passed, existing warnings remain.
pnpm check-types
# Passed.
pnpm test --maxWorkers=2
# 228 files; 2241 passed, 1 skipped.
pnpm --dir packages/pi-terax test --maxWorkers=2
# 9 files; 101 passed.
node --test scripts/libghostty/core.node-test.mjs scripts/libghostty/licenses.node-test.mjs scripts/libghostty/provisional.node-test.mjs scripts/libghostty/policy.node-test.mjs scripts/terminal-lab.node-test.mjs scripts/terminal-lab-cleanup.node-test.mjs
# 32 passed.
.terax/pi-development/m2/with-ghostty cargo run --offline --locked --manifest-path scripts/libghostty/smoke/Cargo.toml
# prebuilt terminal create/feed/render succeeded.
.terax/pi-development/m2/with-ghostty pnpm build:sandbox --debug --no-bundle --features ghostty-engine
# Production frontend and extension built; sandbox executable built successfully.
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
# Passed.
cargo test --manifest-path src-tauri/Cargo.toml --locked
# 578 unit + 25 + 26 + 7 integration passed; 1 ignored.
.terax/pi-development/m2/with-ghostty cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked --features ghostty-engine -- -D warnings
# Passed.
.terax/pi-development/m2/with-ghostty cargo test --manifest-path src-tauri/Cargo.toml --locked --features ghostty-engine
# 613 unit + 25 + 26 + 7 integration passed; 2 ignored.
```

The sandbox was compiled, not launched. Its Rust profile is unoptimized debug,
so it is not a Phase 1 measurement build. WKWebView integration, captures,
optimized measurements and the 60 fps exit criterion still need a real lab
run. Windows, the updated Linux policy and canonical release publication also
remain pending. The full-migration handoff supplied later is context for the
following phases; no merge or phase-advance criterion is implied by setup.

### First native WKWebView diagnostic on M2, 2026-11-14

The optimized lab-only sandbox built and launched in the real M2 graphical
session. Use the same optimized dev-profile settings as the hosted command,
plus `CARGO_PROFILE_DEV_STRIP=none`: without it, macOS failed to load
`zerofrom_derive` with E0463. The existing release-profile proc-macro exception
does not cover this optimized development profile. The successful build used
`CARGO_TARGET_DIR=src-tauri/target/lab-optimized`, `OPT_LEVEL=3`, `DEBUG=false`,
`DEBUG_ASSERTIONS=false`, `INCREMENTAL=false`, the production frontend and the
same checksum-pinned ARM64 core. No source compilation or Actions were used.

The first capture attempt exercised both Rust and WKWebView, but its fixture
moved the cursor to the first row before returning to the shell prompt. Prompt
cleanup erased the content below the marker in both engine and xterm images.
The fixture now reserves the first row and saves/restores the final cursor
around its readiness marker. The corrected pixels still require a new run.

The initial benchmark did not finish. Unified-log evidence confirms that
WebContent PID 62364 reached a footprint of 8570 MB, then 8245 MB after attempted
shrinking, above its 8192 MB kill threshold. WebKit terminated it with
`ExceededMemoryLimit` during xterm SGR x12 and Tauri's default handler reloaded
the webview. A replacement process restarted the autorun. The precise memory
allocation source is not yet established; RSS alone was much smaller and
must not be interpreted as the footprint. The diagnostic runner and its
verified descendants were explicitly stopped; cleanup reported no errors or
survivors. Evidence is under
`spikes/terminal-ghostty-vt/results/phase1/m2-2026-11-14-diagnostic/`.

Corrections prepared from this run and Astra's independent review:

- Native bootstrap state rejects a second autorun in the same process, records
  a failure and exits, preserving checkpoints. Status sequence numbers prevent
  late progress writes replacing newer state. Runner samples are flushed as
  JSONL and a native failure stops further repetitions.
- Every engine benchmark tracks received, drawn and credited sequences per
  session, checks final Rust frame/byte counters and waits for the final draw.
  Nonzero exit, decode/upload errors and context loss are recorded.
- The common measurement interval starts 250 ms after every pane has drawn and
  must last at least 5000 ms. Reports expose each pane's update rate and the
  minimum; aggregate received frames divided by twelve is not the exit test.
- Fixed 200x60 and twelve 100x30 grids are rasterized completely at the original
  font cell size into a full backbuffer, then CSS-scaled for display. This
  removes the old 224px-stage scissor reduction without reducing protocol or
  raster work. Reports name both backbuffer and display dimensions. Idle
  memory setup records its canvas dimensions too.
- Empty or fully clipped panes cannot acknowledge a valid draw. Background
  recovery after an invalid frame is distinguished from a new rendered
  sequence. Constructor and benchmark failures release their contexts and
  sessions.

No frame-rate result from the first diagnostic is accepted. The 60 fps exit
criterion remains unverified, and phases 2 through 5 remain gated. The next
run must verify corrected captures, stable checkpoints and per-pane data;
short fixed-payload runs are inconclusive, not a pass. A longer workload must
preserve the generator and geometry, and must not reduce work to pass.

Validation of the diagnostic corrections on M2: `pnpm lint`,
`pnpm check-types`, `pnpm test` (2267 passed, one existing skip), `pnpm build`,
`pnpm --dir packages/pi-terax test` (101 passed), and
`node --test scripts/*.node-test.mjs scripts/libghostty/*.node-test.mjs`
(34 passed) all completed successfully. Strict all-target clippy and
`cargo test --locked` passed without the feature (581 unit plus 58 integration
passed, one ignored) and through the pinned provisional wrapper with
`--features ghostty-engine` (616 unit plus 58 integration passed, two ignored).
Independent Astra review found no remaining blocker for the next native run.
`successfulRun` checks complete collection, not the 60 fps gate: acceptance
also requires twelve clean per-pane timelines, the common five-second window,
complete final-frame checks, no timeout and no context loss. Draw events mark
WebGL command submission, not physical display presentation.
