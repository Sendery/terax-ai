# Native shell state in ordinary panes

Ordinary native terminal panes now update their real working directory and
signal when the shell is ready. The existing application pane tree, breadcrumb,
workspace authorization and session-ready consumers receive these updates.
Each leaf retains its own CWD across focus, tab changes and view remounts.
This is a functional migration slice; the complete terminal goal remains open.

## Behavior and trust boundary

Native shell profiles add a per-session `aid` to OSC 133. The actor observes
only bounded shell metadata and publishes validated CWD/readiness/running state
on the existing versioned state channel. Unauthenticated command output cannot
open the CWD acceptance window by printing A/D markers. Tokens are not exposed
in state, snapshots, UI or diagnostics. This protects against remote output or
printed files; same-user local processes that can read their inherited
environment are not an isolated security domain.

Opening alone never marks a shell ready. A retired, exited or failed process
cannot mark its replacement ready via a late state message. Reset callback
failure cannot interrupt teardown. Respawn uses the current genuine CWD when
none is supplied. The legacy timeout fallback does not set the ready flag.

Raw spawns clear an inherited native token. The actual unsigned marker output
from zsh and bash was compared byte-for-byte to b79d631 and remained identical.
The native actor receives every original PTY byte; invalid or oversized metadata
is ignored by the observer, not dropped from terminal input.

## Verification

M2 normal sandbox, authenticated Pi client, real OS keyboard/mouse and inspected
window/active-pane PNGs prove independent Unicode/space CWD in two distinct
shells, correct focus and tab return, and rejection of unsigned D/A plus OSC 7
while the emitting command remains running. The first test attempt typed into
one shell twice because the initial activating click was not delivered; PID
markers exposed that fixture error. The corrected test asserts distinct shell
PIDs before accepting focus/CWD evidence. Raw machine evidence and artifact
paths are in `.terax/pi-development/normal-shell-integration/` on M2.

The clean baseline was b79d631 with its full floor green. The complete floor
passed for this implementation:

```sh
pnpm lint
pnpm check-types
pnpm test
pnpm build
pnpm --dir packages/pi-terax test
node --test scripts/*.node-test.mjs scripts/libghostty/*.node-test.mjs
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
.terax/pi-development/m2/with-ghostty cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked --features ghostty-engine -- -D warnings
.terax/pi-development/m2/with-ghostty cargo test --manifest-path src-tauri/Cargo.toml --locked --features ghostty-engine
git diff --check
```

Frontend: 2416 passed, one existing skip. Pi: 101 passed. Node: 43 passed.
Rust: 595 unit plus 58 integration passed without Ghostty (one ignored),
677 unit plus 58 integration passed with Ghostty (two ignored). Build includes
the Pi package build. No rules, assertions or checks were suppressed.
Independent Astra review found a Windows import and stale readiness during
retirement/exit; both were corrected with regressions before final acceptance.
No Actions, push or protected-Mac native build ran.

## Remaining scope

Fish/PowerShell/WSL changes have source review but no runtime acceptance here.
Custom shells without integration retain the existing timeout compatibility;
their readiness is not inferred from time. Native blocks, search, links,
complete restore/task/agent scenarios, settings, graphics, graphemes and the
remaining platform/rollout requirements stay open. FPS remains optional.
