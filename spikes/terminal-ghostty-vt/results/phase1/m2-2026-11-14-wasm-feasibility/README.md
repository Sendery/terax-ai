# M2 Rust + Zig WASM feasibility, 2026-11-14

The isolated module links and executes. It generated 300 full frames identical
to the three existing V1 goldens: plain-text, styled-truecolor and
wide-combining. It also rejects stale output after an invalid case. The
compiled Zig core's metadata matches all 68 generated size/alignment
assertions for its 34 exposed types. This is a headless feasibility result;
it does not change the negative native Channel gate or permit phases 2 to 5.

[Source and exact reproduction commands](../../../wasm/README.md) are tracked
alongside the two Cargo locks. The recorded source commit is `406a3d2` plus
an explicitly dirty experiment tree; `result.json` includes hashes of the
wrapper, preparation, verifier, manifest, locks, native/derived snapshot,
production codec and selected bindings. No binary is committed. The input
archive hash and controlled build command document what was supplied to the
linker; hashing the separate core.wasm does not independently establish that
it came from that archive.

| Observation | Result |
|---|---:|
| Rust + Zig module bytes | 867312 |
| Rust + Zig module SHA256 | 42449edfb6e44675af0424a1edea8bc3ec7c1cbcd94b90196efb212b0b0eeb77 |
| Initial linear memory bytes | 1245184 |
| Maximum/final observed linear memory bytes | 6553600 |
| Full-frame matches | 300 / 300 |
| Unexpected log callbacks | 0 |
| Core ABI size/alignment checks | 68 / 68 |
| WASM imports | env.log only |

Linear memory is not process RSS, application bundle size or a general leak
measurement. The linked proof is smaller than the standalone all-exports
core.wasm (4419060 bytes); neither size proves the final production bundle
cost. Deltas, cursors, resize, fragmented input, selection, Rust/Zig callbacks
and residual logging allocator paths are unverified. No Worker, real PTY
transport, GPU timing or FPS was exercised.

The official checksum-pinned Zig 0.15.2 SDK failed at the host build-runner
link on the macOS 27 SDK. Homebrew zig@0.15 0.15.2, with packaged patches,
built the exact pinned source successfully. `toolchain.json` records binary
hashes, linked libraries, versions, producer flags and archive hashes. The
source default guard, native ABI64 file and app code were not changed. Homebrew exposes Zig on the M2
PATH; native source fallback remains explicitly guarded even with Zig present. All execution occurred on M2; no
Actions or native execution occurred on the protected original Mac.

Verification passed on M2:

- `pnpm lint`, `pnpm check-types`, `pnpm test` (2283 passed, one existing skip), `pnpm build`.
- `pnpm --dir packages/pi-terax test` (101 passed; its build also ran through the root production build).
- `node --test scripts/*.node-test.mjs scripts/libghostty/*.node-test.mjs` (41 passed).
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings` and `cargo test --manifest-path src-tauri/Cargo.toml --locked` (582 unit, 58 integration, one ignored).
- `.terax/pi-development/m2/with-ghostty cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked --features ghostty-engine -- -D warnings` and `.terax/pi-development/m2/with-ghostty cargo test --manifest-path src-tauri/Cargo.toml --locked --features ghostty-engine` (618 unit, 58 integration, two ignored).
- Isolated `cargo build --release --manifest-path spikes/terminal-ghostty-vt/wasm/Cargo.toml --target wasm32-unknown-unknown --locked` and the corresponding `cargo clippy --release ... -- -D warnings`, with the explicit WASM pkg-config environment from the reproduction instructions.
- `rustfmt --edition 2024 --check --config skip_children=true spikes/terminal-ghostty-vt/wasm/src/lib.rs`, `node spikes/terminal-ghostty-vt/wasm/verify.mjs <module> <new-report> <core.wasm>` and `git diff --check`.

The first script test invocation mistakenly used `node --test
scripts/*.test.mjs`, which runs Vitest files with the wrong runner and failed
before assertions. The actual Vitest suite passed through `pnpm test`, and
the corrected Node command passed. No assertion or configuration was weakened.
The stale-frame invariant was observed failing with 132 retained bytes before
its fix, then passed. Native ABI64 compile assertions were also observed
rejecting wasm32 before separate ABI32 generation. Formatting was corrected
only in the new wrapper before the final smoke.

Independent Astra review found no residual functional blocker to this limited
proof. Its provenance recommendation was applied by recording the input
archive and manifest hashes. It does not approve proceeding beyond Phase 1.
Graphical stage profiling still needs a verified unlocked M2 console, followed
by the registered unchanged workload twice without concurrent builds.
