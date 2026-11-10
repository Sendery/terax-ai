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

Never verified anywhere:

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

- Rust stable, Node 22, pnpm, network access for the first feature build (the crate clones Ghostty at `a887df42c56f6de86c0fe6da9c4eeca37931e083`; Zig 0.15.2 is downloaded and checksum verified by `scripts/with-zig.mjs`).
- Every command that compiles the feature goes through `node scripts/with-zig.mjs -- <command>`. On Linux and on macOS 15 or earlier the probe finds that Zig links natively and no SDK stand-in is used.
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
