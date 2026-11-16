# Native terminal general validation

Code candidate: 03a44af64dff5f7e99209d0e417fb3c513c63e75, consolidated in local qa.
This report records the completed implementation and the first general
validation block. Functional replacement and default rollout remain open.

## General automatic checks

All checks ran once on M2 against the complete candidate:

| Check | Result |
| --- | --- |
| Frontend, extension Pi and regular script tests | 2788 passed, one existing skip, 288 files |
| Node-only script tests | 73 passed, zero skips |
| TypeScript | Passed |
| Biome lint | Passed, unchanged 119 warnings and two infos |
| Rust without ghostty-engine | 626 unit and 58 integration passed, one existing ignored |
| Rust with ghostty-engine | 796 unit and 58 integration passed, two existing ignored |
| Strict all-target Clippy, both configurations | Passed |
| Sandbox app build | Passed, verified native-core-v1 prebuilt, no source fallback |

Cargo used the explicit shared target directory. No native producer was
repeated. The unchanged archive is
c390cf1908007dc0ab9f1c6914384532c8482cbd6fbe5aea2752e610425e09ae.

## Exact running version

The frozen M2 artifact is
.terax/qa-candidates/03a44af/Pi-Terax Sandbox.app in the qa worktree.
Its executable SHA256 is
0095e4d0f72ec9c86ca99dc2f41112441ce261db09b156ac4e8dab02fc373ab6.
The identifier is app.crynta.terax.sandbox. Discovery, app.buildInfo and the
mapped executable verify commit03a44af, branchqa and Sendery/terax-ai.

The old sandbox closed normally through its own observed close button after
public/clean/idle checks and a workspace backup. A transient SSH and ping outage
interrupted the handoff; its cause remains unproven. Connectivity recovered.
The current app is PID30102, with a temporary bounded awake assertion tied to
that PID. The normal environment has no temporary ZDOTDIR override.

All twelve tabs, active35 and all three editor paths were restored and checked
against the workspace backup. The unrelated editor38 was preserved and its
contents were not inspected. The original tested left/right shell PIDs30695
and30696 remain unchanged. Focusing the existing public tab9 added owned idle
shell5391 without replacing them.

## Real ordinary-pane interaction

The unlocked matching console session and Accessibility were verified.
The first full-window PNG was visually inspected for native text, colors,
cursor and split geometry.

Actual macOS keyboard events executed independent marker commands in the
correct left and right shells. System pointer events switched the focused
pane correctly. The first PID-directed mouse injection did not perform the
intended hit test; a system pointer event resolved that automation limitation.
No product change was required.

Two small bounded TUI peers ran through the real left PTY. They restored
their terminal modes and exited normally. Their raw input records establish:

- The core replies to a Kitty keyboard query.
- With negotiated flags11, actual key press, repeat and release events reach
  the program, including shifted Enter and functional-key release.
- Switching left/right panes delivers the requested focus-out and focus-in.
- SGR mouse press/release at calibrated cell6,row5 are correct.
- SGR pixel press/release are94,166 for the calibrated physical position.
  The exact pinned encoder uses zero-based pixel coordinates.
- Vertical wheel without mouse reporting in the alternate screen sends one
  application-cursor Up or Down per corresponding event.
- Alt-click from column20 to column5 sends exactly fifteen Left sequences.
- Cmd+K sends no PTY input. A subsequent cursor report proves the active cursor
  row moved from row10 to row1, with the shell/core owner retained.

Initial automation expectations were deliberately retained with the records:
PID-directed repeated key events did not deliver repeat to WebKit, while
system key events did. The pixel oracle initially assumed one-based coordinates,
and the CG wheel sign was initially treated as DOM deltaY. Directed repeats
with the correct event path and pinned-protocol expectations passed. These
were corrected test-oracle/injection assumptions, not hidden source failures.

## Progress and explicit notifications

A program-origin OSC9;4 determinate progress42 is visible only in its owning
left pane in a real captured window. The foreground bar remains above native
canvas pixels. It disappears after the fixture clears progress and exits.

A multipart OSC99 title/body was emitted while that pane was hidden. The
same peer remained alive, the owned active tab was restored and it exited
normally. The body Owned native terminal test appears in the app bell.
The existing bellRowView prefers body over combined text, so the custom title
is not independently visible there. Exact OS banner delivery and title display
are not claimed by this bell check. No agent session was invented.

## Graphics, renderer migration and live geometry

The ordinary left pane rendered a direct red Kitty image and a virtual green
one-pixel source spread across four columns and two placeholder rows. Real
window PNGs were inspected before, during and after the WebGL preference
changed from on to off to on. All sixteen calibrated red/green center samples
in each image matched exact RGBA values. Both virtual rows remain visible in
Canvas2D, including the fractional source slices. The original WebGL preference
was restored. No shell, tab, editor or app process was replaced.

The actual General settings controls changed Font size from 14 to 16 pixels
and Letter spacing from zero to one pixel. Visible split shells changed from
41 rows by 58 columns to 35 by 52, then 35 by 47. The hidden ordinary shell
also received the changes, from 41 by 117 to 35 by 105, then 35 by 95.
Restoring both original values restored 41 by 58 and 41 by 117. TTY geometry
was read without consuming or injecting PTY bytes. Captures confirm readable
text and retained direct/virtual graphics after the changes. Other preferences
and destructive history shrink scenarios are not inferred from these checks.

## Search and privacy through ordinary controls

Actual Cmd+F, text input and Enter found TERAX_KITTY_READY in the owning left
native pane. The captured window shows the expected highlighted marker.
Shift+Enter requested the previous occurrence; Escape cleared search and
restored Terminal input focus. The clipboard was not changed.

Actual Cmd+R created one new private terminal. A manually typed marker command
executed normally. The snapshot exposed only its id, private-terminal kind
and space id, with no title, cwd, pane count or content. Whole-window, active
pane and explicit private-pane captures each refused with the expected privacy
reason. Whole-window capture also refused after the private tab was hidden.

While the private tab was active, an explicit inactive public pane35 capture
succeeded without changing the active tab. The PNG was inspected and contains
only the requested public split pane. Only the newly created private tab was
closed. All twelve original tabs, three editors, three shell identities and
active35 were restored and rechecked.

## Concrete defects after the general sweep

A source review identified two legacy-only focus assumptions. The global
shortcut guards in src/app/App.tsx recognize only .xterm for ai.askSelection
and sidebar.toggle. Actual Cmd+B from focused native input reproduced the
defect: the explorer changed from hidden to visible. The original hidden state
was restored immediately. The intended plain-Mod+B terminal exception and
Shift override are documented in shortcuts.ts.

The selection-action popup hook also only recognizes .xterm and .cm-editor,
and its zero-delay read does not await native selection completion. The
existing native context menu remains a separate working path. These concrete
defects are being corrected in two exclusive atomic worktrees, with directed
checks. No corrected runtime acceptance is claimed for the still-frozen
03a44af artifact.

## Evidence and remaining sweep

Ignored M2 evidence lives under
.terax/pi-development/m2/logs/general-03a44af/.
It includes automatic-check results, artifact/runtime identities,
workspace/readiness checks, marker proofs, two TUI event records, calibrated
geometry and capture outcomes. Generated PNGs remain in the sandbox capture
cache; selected public images were inspected.

Remaining acceptance includes the two atomic corrections; other live
preferences/history shrink and selection/search/block invalidation; broader
blocks/app/AI/agent/restore/task/Pi consumers; additional private/stale-owner
and failure scenarios; physical mixed-DPI and applicable supported-platform/
default and real-workload requirements. Historical completed slices are
retained as evidence, not substituted for the scope of a new check.

Concrete product failures found after this general sweep use atomic worktrees
and directed checks. Already-passed whole floors are not repeated without a
relevant change or unresolved concern. No performance laboratory was run;
60FPS remains optional.

No Actions, push, PR, publication, merge commit or protected-original-Mac
project operation was performed. This is not a claim of complete parity.
