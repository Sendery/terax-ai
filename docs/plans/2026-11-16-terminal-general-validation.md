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

The broad-sweep frozen M2 artifact was
.terax/qa-candidates/03a44af/Pi-Terax Sandbox.app in the qa worktree.
Its executable SHA256 is
0095e4d0f72ec9c86ca99dc2f41112441ce261db09b156ac4e8dab02fc373ab6.
The identifier is app.crynta.terax.sandbox. Discovery, app.buildInfo and the
mapped executable verify commit03a44af, branchqa and Sendery/terax-ai.

The old sandbox closed normally through its own observed close button after
public/clean/idle checks and a workspace backup. A transient SSH and ping outage
interrupted the handoff; its cause remains unproven. Connectivity recovered.
That broad-sweep app was PID30102, with a temporary bounded awake assertion
tied to that PID. It has since been retired normally for the atomic candidate. The normal environment has no temporary ZDOTDIR override.

All twelve tabs, active35 and all three editor paths were restored and checked
against the workspace backup. The unrelated editor38 was preserved and its
contents were not inspected. The original tested left/right shell PIDs30695
and30696 remained unchanged throughout that broad-sweep runtime. Focusing the existing public tab9 added owned idle
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

## Blocks and a real Pi session

Actual Cmd+Shift+T created one owned Blocks tab41. Shift+Enter inserted a
newline in its command editor; Enter executed the complete two-line command
once. Copy output returned both expected markers. Copy command returned the
exact original multiline text. Each clipboard check restored all original
pasteboard items and representations without printing their content.

Run again executed the same full command once more: the program-owned counter
changed from one to two. The captured pane shows both finished blocks, both
output markers and their independent toolbars. Only the owned idle tab41 was
closed. The original twelve tabs, three editors, three shells and active35
were rechecked. Block-specific search and attachment actions are not inferred
from this copy/repeat check.

The installed Pi0.74.0 ran in the actual left native PTY with offline startup,
an ephemeral session and the explicit built Terax extension. A real captured
editor shows two unsent lines entered through Shift+Enter. The pane was hidden
by focusing the existing public tab9, then restored to tab35. The same Pi PID
and parent survived, and appending _RESUMED extended the second line without
losing the first. The restored draft was visually inspected.

Ctrl+C cleared the draft and Ctrl+D exited Pi normally with code0. No provider
request was submitted. Original shells and workspace metadata remained intact.
This accepts real Pi TUI input/hide/continue, not model responses, tool calls,
managed restore or scheduled delivery.

The first Pi fixture used a 120-second safety bound and was terminated by that
bound after its successful multiline capture, before hide/restore. Its forced
exit record remains. A second directed fixture used a 300-second safety bound
and completed through normal application controls before that bound. The
timeout is a test-harness limit, not evidence of a terminal crash or a passed
graceful-exit check.

## Concrete defects after the general sweep

A source review identified two legacy-only focus assumptions. The global
shortcut guards in src/app/App.tsx recognize only .xterm for ai.askSelection
and sidebar.toggle. Actual Cmd+B from focused native input reproduced the
defect: the explorer changed from hidden to visible. The original hidden state
was restored immediately. The intended plain-Mod+B terminal exception and
Shift override are documented in shortcuts.ts.

The selection-action popup hook also only recognizes .xterm and .cm-editor,
and its zero-delay read does not await native selection completion. The
existing native context menu remains a separate working path. The shortcut correction was committed as c502951 and integrated into qa
as a89ce6d after review and 34 focused checks, types and scoped lint. The selection popup
source correction was integrated as ced062b. Its post-sweep runtime result and
the next concrete correction are recorded below.

## Post-sweep atomic candidate

The two reviewed source corrections were integrated into local qa as a89ce6d
(shortcut ownership) and ced062b (native selection popup). The combined
candidate passed 73 directed tests in nine files and TypeScript. One matching
sandbox build passed with the same verified archive and explicit Cargo target.
No already-passed general frontend/Rust floor was repeated.

The new frozen artifact is .terax/qa-candidates/ced062b/Pi-Terax Sandbox.app.
Its executable SHA256 is
203a0feaad994227b95fb09d021e5739c59c1b475e7ccb3993af4f6c2d2200f6.
The old 03a44af app and owned process tree closed normally after fresh
public/clean/idle checks and another workspace backup. Its bounded awake
process had expired into a verified owned zombie before retirement; no
unrecognized process was accepted or killed.

The exact new runtime is PID58221, verified by discovery, app.buildInfo and
mapped executable. All twelve tabs and all three editor paths were restored,
including unrelated editor38 without reading its contents. Its two initial
ordinary shell PIDs are58664 and58665. A new bounded awake process58222 is tied
to the app and owned by the launch wrapper. The matching GUI is unlocked.

Actual plain Cmd+B now preserves the explorer state, Cmd+Shift+B still toggles
it, and selection-free Cmd+J keeps native input focus without opening another
window. This closes the concrete shortcut defect in the actual application.

The corrected native selection gesture does display all three popup actions.
A real Add to Note click then dismisses the popup without creating a note;
the same active-tab API and the visible notes panel confirm the failure.
Read-only investigation found that routine selection refreshes call
session.select(read), which increments the query-order revision captured by
the popup. The original selection can therefore remain highlighted while its
action token becomes invalid. A new atomic correction separates semantic
selection/history mutations from read/cache ordering. This behavior remains
open; no passed action acceptance is claimed.

Two automation assumptions were corrected before this product finding:
a pointer without explicit empty flags inherited Control and opened the
existing context menu; the actual popup labels include their shortcut suffix.
The records and captures distinguish these assumptions from the subsequent
real zero-note outcome. The next exact-marker drag will also use the exclusive
selection endpoint after the final character.

## Combined terminal, manager and GraphX candidate

The selection refresh correction was integrated as ce2f328. Astra's new
Pi-Terax manager and GraphX feature, including its two source follow-ups, were
consolidated as178c656, ec2cccb and b6ce5e3. The final build code664d589 adds only
formatting to the new Rust bridge test. Source details and deliberate GraphX
subset limits are in docs/pi-terax-agent-graphx.md.

Combined checks passed475 tests in40 files, TypeScript, SDK build and14 focused
Rust Pi bridge tests. One sandbox app build passed. The first native-test
invocation was stopped by an omitted manifest path after the prebuilt wrapper
changed directory; the directed retry with explicit manifest and target passed.
The app build was not repeated for that invocation error. Rustfmt exposed
three pre-existing formatting hunks; only the newly added test was formatted.

The frozen664d589 sandbox executable has SHA256
2e1f59e83afd010e17b974eeb4eb02422ed22c1a6eef36546878d26e93743549.
Its running PID is67750. The prior candidate closed normally after backup,
public/clean/idle checks and preservation of all three editors. Discovery,
mapped executable and app.buildInfo verify the new candidate. Twelve original
tabs and editor paths were preserved. Initial ordinary shell PIDs68066/68067
remain owned by the same app.

The actual native selection popup now survives its read refreshes. A real
pointer drag selected the complete TERAX_SELECTION_POPUP_MARKER; all three
actions appeared. Clicking Add to Note created exactly that text on tab35.
Only that owned note was removed, restoring the original notes. This closes
the concrete selection-action defect. No clipboard was changed by this case.

Pi-Terax Agente is present in actual Settings > Agents on the existing profile.
The exact app catalog offers graphx.open/read/update/place. An owned graph was
created and read through the authenticated Pi bridge. Reopening its stable id
did not duplicate or overwrite it. A valid update advanced the revision;
stale revision, invalid endpoint and wrong document incarnation each refused
without changing data. Passive snapshots contain graph metadata, not source.

A real owned binary --mcp subprocess initialized, listed the new actions and
read the same graph. A second subprocess updated it, read the new revision and
rejected a repeated obsolete write while preserving the new source. Both
stdio servers exited normally. The owned graph is at revision3. No provider
request was submitted.

Side-placement calls plus explicit focus on the chosen terminal resized the
same original PTYs from65 to32 columns; floating restored65 columns. Source
review and a separate real check found that placement itself switched active
tab35 to the first public tab7. The explicit-focus workaround is not claimed as
a passed placement-focus check; a separate atomic correction preserves the
current or remembered public terminal. Warming tab7 added two owned idle shells
without replacing the original pair.

Packaged WKWebView exposed a real GraphX load failure: the iframe HTML and
toolbar exist, but both scripts were blocked by script-src self under the
opaque custom-scheme origin. The parent timed out and the child remained at
Waiting for graph. An isolated system-WK fixture reproduced this exact error.
The reviewed correction was integrated as b3414cd: both CSP layers allow only
the two bundled tauri://localhost/graphx scripts. Sandbox origin isolation and
all other restrictions remain. System-WK layout/token/boundary checks and the
existing Chromium check pass. Packaged visible acceptance and real pointer
docking remain pending the next exact candidate.

## Evidence and remaining sweep

Ignored M2 evidence lives under
.terax/pi-development/m2/logs/general-03a44af/.
It includes automatic-check results, artifact/runtime identities,
workspace/readiness checks, marker proofs, two TUI event records, calibrated
geometry and capture outcomes. Generated PNGs remain in the sandbox capture
cache; selected public images were inspected.

The concrete selection correction is now accepted on M2. Remaining acceptance
includes packaged GraphX loading/placement and other live
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
