# Native terminal row settings and host clear frontend

Date: 2026-11-15. Base: 5acaa791a7e3927737e35b13abf09af02d024ff1.
Branch: feat/native-terminal-settings. All work and checks ran on M2 over SSH.

## Result

The existing terminalScrollback preference is now passed to gterm_open before
the first frame, applied live to visible or hidden native sessions, retained
through view configuration and used on respawn. Validation and preference
clamping share one pure settings helper: default 2000 rows, integer bounds
200 through 50000. No scrollback byte estimate, PTY replacement or renderer
replacement is used. Bench sessions retain their existing byte policy.

Live row changes retain the latest requested value and admit one target at a
time. A subsequent target waits for both the admission request to settle and
an actual applied state matching the previous target. This includes a rapid
2000 -> 5000 -> 2000 reversal. A rejected synchronous command retires only
its own target and reports the error without retrying it on unrelated state.
The next explicit preference change can proceed, or return to the rows from
the confirmed applied receipt. A different already queued target can drain.
Late replies cannot restart a closed owner.

Cmd+K now uses gterm_clear for the actual focused native grid owner. It does
not write a formfeed, reset the terminal or recreate a process. The legacy path
still calls xterm.clear. Mod+; keeps its existing formfeed behavior. The guard
tracks the exact DOM focus, leaf registration and submission owner through
opening and immediately before the target IPC. Manual private gestures are
allowed. A retained healthy core remains clearable after normal shell exit.
The blocks composer and unrelated editors keep the existing shortcut
fallthrough; this change claims the grid textarea or the real xterm slot only.

## Applied-state contract

The matching backend adds these fields to the existing state channel:

- scrollbackRows: number, or null only for low-level bench byte policy.
- hostMutationVersion: a monotonically increasing safe integer for an applied
  row-policy change or a changed host clear, independent of ordinary VT output.
- hostMutationAfterSeq: the u32 sequence of the last real frame emitted before
  that applied mutation.

gterm_set_scrollback_rows { id, rows } acknowledges admission, not application.
gterm_clear { id } returns a boolean after application. False is a genuine
no-op; it does not discard the presented frame or clear native selection.
For true, the frontend reads gterm_state and requires an advanced applied
receipt. The actor publishes that receipt before resolving the clear call.
The frame boundary uses unsigned modular distance, including u32 wrap.

Every host attempt cancels the current capture and quarantines asynchronous
content queries and cached copy text. Actual application invalidates presented
frame references, block/link views and stale selection/search/read replies.
Previously emitted full frames cannot revive those references or satisfy a
new capture. Their credits still return through the existing renderer display
turn; no synchronous ACK or synthetic drawn sequence is introduced. A fresh
capture requires applied row policy and a real full after the receipt boundary.

The frontend never sends a selection-clear command for host trim. If selection
was known, it reads the actual core selection after application, preserving its
clipped surviving text. Stale selection replies cannot overwrite that read.
A clear failure or malformed/unproven success keeps history consumers blocked
until a newer applied receipt establishes a valid boundary.

Old mode-only state payloads remain decodable for existing internal consumers;
they cannot prove application of a new row update or a successful host clear.
A partial receipt or normal-terminal byte-policy null is rejected.

## Focused validation

Tests preceded the implementation. The initial startup/decoder tests failed
on missing row forwarding and stripped/unvalidated receipts; the Engine controls
and focus tests also exposed the missing native APIs. No production behavior
was removed to make those tests pass.

Commands, with /Users/arb/.config/terax/dev-env.sh sourced (Node 24, pnpm 11.5):

    pnpm exec vitest run src/modules/terminal/gl/engineSession.test.ts src/modules/terminal/gl/nativeLeafSession.test.ts src/modules/terminal/gl/nativeState.test.ts src/modules/terminal/lib/sessionSubmissionFacade.test.ts
    pnpm check-types
    pnpm exec biome lint src/app/App.tsx src/modules/settings/store.ts src/modules/settings/terminalScrollback.ts src/modules/terminal/NativeTerminalPane.tsx src/modules/terminal/gl/engineSession.ts src/modules/terminal/gl/engineSession.test.ts src/modules/terminal/gl/nativeLeafSession.ts src/modules/terminal/gl/nativeLeafSession.test.ts src/modules/terminal/gl/nativeState.ts src/modules/terminal/gl/nativeState.test.ts src/modules/terminal/gl/nativeLeafRegistry.ts src/modules/terminal/index.ts src/modules/terminal/lib/useTerminalSession.ts src/modules/terminal/lib/sessionSubmissionFacade.test.ts
    git diff --check

Focused tests: 173 passed in four files. TypeScript passed. Lint had no errors;
15 existing warnings remain in the touched files (10 App, one settings store,
two Engine tests, one leaf test, one state test). The checks use mocked IPC and
DOM, including the actual EngineSession implementation and frame codec.

The cases cover startup/default/bounds, ordinary and blocks sessions, hidden
and detached owners, opening updates, unchanged configuration, respawn,
ACK/state ordering, coalescing/reversion, closing, stale copy/text responses,
clipped selection, rejected admission recovery without automatic retry,
changed/no-op/error clear, real focus/owner replacement,
no PTY input, capture cancellation and a post-mutation full across seq wrap.

## Integration and remaining validation

This checkpoint changes TypeScript only. It must be integrated with the
matching backend and prebuilt artifact before running the app; this lane did
not activate a bundle, modify Rust/vendor/pins or run Cargo, UI, GitHub Actions,
pushes or publication. The backend owns the actual clear semantics (preserving
the complete cursor row, X, SGR, OSC8, wrap, modes and saved cursor state) and
the native selection clipping. These frontend tests do not substitute for
native tests or WKWebView acceptance of live history trim and Cmd+K.

Astra completed the single source review and found one recovery blocker:
a rejected setter could permanently occupy its pending slot. Two additional
red-to-green regressions cover a next explicit target and a return to confirmed
applied rows. Parent reviewed that focused correction with no remaining blocker.
The synchronous Rust setter returns Err before admission, or after the actor
disconnects; it has no live admitted control after a command rejection.
No new acknowledgement protocol or retry loop was introduced.

Local logs are under .terax/pi-development/native-terminal-settings/.
