# Native terminal cursor blink preference

## Existing preference and program negotiation

The existing terminalCursorBlink preference now initializes ordinary and blocks
native sessions and applies live changes without respawning the process or
replacing the terminal engine. Its persisted default remains false. Settings
schema, hydration, setter, synchronization and the existing Cursor blinking
switch are reused; no new setting or persistence field is introduced.

The preference configures both the native default blink used by DECSCUSR reset
(CSI0q) and the current DEC12 blink state. Changing it does not change the current
cursor style or emit synthetic VT bytes. A program DECSCUSR or DEC12 sequence
processed by the actor after the preference has actually been applied remains
authoritative for the current blink state; CSI0q returns to the configured
default. The renderer does not AND a user preference over every
frame, so a program can still request a blinking cursor after the preference
was applied.

Repeated unchanged configuration, renderer migration, full reconstruction,
theme colors and font changes do not reapply blink or erase a program choice.
A preference changed during opening is replayed against the opened owner.
Respawn uses the latest stored preference before the replacement's first frame.
Closed and failed owners ignore later updates. Synthetic sessions retain the
previous false default and do not receive live preference mutations. The
legacy renderer path is unchanged.

## Transport and supported native API

The optional gterm_open cursorBlink boolean defaults to false for existing
clients. NativeLeafSession keeps the desired preference independently of a
view; EngineSession coalesces pre-ID changes and sends only actual preference
changes. gterm_set_cursor_blink is a typed internal Tauri command for an existing
native session, not an SDK/Pi/MCP command.

Rust Appearance groups colors and initial cursor blink without expanding every
ShellConfig literal or adding unrelated booleans to startup APIs. Existing
start_with_colors and start_with_shell keep their false blink default. The
initial appearance is applied on the engine actor before the first frame.
Live updates are coalesced on that same actor, independent of row data.

The live IPC result confirms admission to the coalesced control state, not
application or presentation. IPC preference updates and PTY output are concurrent
producers; their wall-clock order is not a promised actor-processing order.
An IPC success alone is not a barrier before a program override. Tests first
observe the frame containing the applied preference, then feed the program
sequence to verify the later actor transition. No receipt protocol is added.

The pinned libghostty-vt0.2.2 API provides set_default_cursor_blink (option23)
and set_mode(Mode::CURSOR_BLINKING) (DEC12). A real probe against the configured
prebuilt library verified both calls, unchanged underline style, later
DECSCUSR/DEC12 choices and reset behavior. Header presence alone was not used
as evidence of native support.

Unsupported or failed startup cursor configuration fails engine initialization;
it never silently claims the preference was applied. A failed live native
configuration invalidates engine health. The pinned API probe is a guard
against changing to an incompatible native artifact.

## Cursor metadata with clean rows

The actor regression exposed an existing frame omission: CSI2q could switch
from blinking block to steady block while the pinned RenderState reported
Dirty::Clean for rows. Snapshotter returned before reading the changed cursor
header, so the client never learned the new blink state.

Snapshotter now caches successfully encoded visible header state, excluding
sequence and full-frame bookkeeping. Changed metadata produces a partial frame
even when rows are clean; clean rows are not iterated or retransmitted. Repeated
unchanged metadata remains idle. Dimension/default-color changes still require
full rows because resolved cell colors and geometry must stay consistent.
No wire format change, output parser, per-byte full redraw or new dependency
is introduced.

## Verification and limits

Worktree native-cursor-settings on M2, based on
85811389fdc4aa3ff3d9be8647c182ac5ac256bc. All source work and checks use SSH on M2.
No protected-host project source/build/UI, GitHub Actions, publishing or
performance experiment was used.

The client behavior tests were red before implementation for missing opening
arguments, setter behavior and leaf replay/respawn. Focused client tests cover
true/false startup, changed-only updates, pending coalescing, retired owners,
synthetic exclusion, ordinary/blocks defaults and latest respawn configuration.
The initial client floor was95passed; the updated focused set is106passed.

Native tests cover the pinned direct API, initial first-frame state, actor
live updates, style preservation, full reconstruction, later program override
and CSI0q in both ordinary and blocks modes. A separate regression reproduces
Dirty::Clean with changed cursor metadata and requires exactly one row-free
partial frame followed by idle. No expectation was weakened to fix the timeout.

Logs and the implementation journal are under .terax/pi-development/m2/logs/
cursor-* and .terax/pi-development/native-cursor-settings/journal.md.

Commands for this block:
- pnpm exec vitest run src/modules/terminal/gl/engineSession.test.ts src/modules/terminal/gl/nativeLeafSession.test.ts src/modules/terminal/lib/cursorBlink.test.ts
- pnpm check-types
- pnpm exec biome lint src/modules/terminal/NativeTerminalPane.tsx src/modules/terminal/gl/engineSession.ts src/modules/terminal/gl/engineSession.test.ts src/modules/terminal/gl/nativeLeafSession.ts src/modules/terminal/gl/nativeLeafSession.test.ts
- .terax/pi-development/m2/with-ghostty cargo test --manifest-path src-tauri/Cargo.toml --target-dir /Users/andres.rojo/Workspaces/terax-ai/src-tauri/target --locked --features ghostty-engine modules::pty::engine
- .terax/pi-development/m2/with-ghostty cargo clippy --manifest-path src-tauri/Cargo.toml --target-dir /Users/andres.rojo/Workspaces/terax-ai/src-tauri/target --all-targets --locked --features ghostty-engine -- -D warnings
- .terax/pi-development/m2/with-ghostty cargo test --manifest-path src-tauri/Cargo.toml --target-dir /Users/andres.rojo/Workspaces/terax-ai/src-tauri/target --locked --no-default-features modules::pty::engine
- git diff --check

Native engine checks passed203tests with one existing ignored; the plain engine
set passed62tests. Strict all-targets native clippy and TypeScript checks passed.
The focused client set passed106tests. Focal lint exits successfully with three
preexisting noNonNullAssertion warnings in unchanged test cases. Astra source review
found no remaining blockers; real UI acceptance is separate.
This source block does not claim real macOS cursor animation, inactive-window
behavior, physical display changes or Linux/Windows runtime acceptance. Parent
coordinates the sandbox build and real UI acceptance after source integration.
Focus/window scheduling policy is not changed here. This is one parity slice,
not completion of the entire terminal replacement or production-default rollout.
