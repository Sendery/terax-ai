# Pi-Terax manager and GraphX functional acceptance

The implementation was developed in isolated M2 worktrees and consolidated into
local qa as Sendery. This report distinguishes actual application acceptance
from source tests and isolated browser fixtures. It does not declare the broader
terminal migration complete.

## Implemented behavior

Pi-Terax Agente is a selectable built-in agent for organizing tabs, classifying
content, notes and graph management. It discovers the running command catalog.
The workspace configuration at .terax/pi-terax-commands.json supplies validated,
bounded custom actions. The SDK tool terax_manager_actions reads this data;
CLI providers use their configured Pi/MCP tools and authorized file access.

GraphX documents persist as space tabs, including source, document incarnation,
revision, title, color, notes, panel placement and geometry. Authenticated
graphx.open/read/update/place and corresponding MCP actions support external
agents and already-owned subprocesses. Writes compare both document incarnation
and revision. A graph can occupy its tab, dock left/right beside a terminal, or
float within the workspace. This is not an OS-detached window.

The supported GraphX subset and deliberate data/security limits are documented
in docs/pi-terax-agent-graphx.md.

## Real application evidence

The built manager appears in Settings > Agents. Actual authenticated Pi calls
created and updated the owned three-node graph. Reopening its stable key did not
overwrite it. Stale revision, wrong document incarnation and invalid endpoints
were rejected without mutation. Passive snapshots expose metadata, not source.
Two owned stdio MCP subprocesses initialized and listed/read/updated the same
graph; an obsolete repeated write was rejected. No provider request was sent.

Real pointer gestures moved the floating panel by 120/80 pixels and resized it
by 80/40. A release near the right workspace edge docked it. API placement left
and returning from the graph tab to floating preserved the selected public
terminal. Actual keyboard operation of the placement select docked left.
The two native shell PIDs remained unchanged; each terminal resized from 64 to 26
columns when docked and returned to 64 when floating. No unrelated tab was warmed.

Actual tab commands renamed, colored and reordered the graph, created and
updated its note, then restored original metadata and notes. A real app restart
preserved all 13 tabs and all 3 editor paths, the graph UUID/revision 3, left
placement and panel geometry. The unrelated editor's content was not read.

The capture scope refused a whole-window capture while an owned empty private
terminal was open. It also refused an explicit graph-pane capture while the graph
was hidden beside that private terminal. Owned test tabs were closed and the
original public workspace was restored.

## Concrete corrections from acceptance and review

- Packaged opaque-origin WebKit requires exact script URLs in both CSP layers.
- Placement preserves the current or remembered public terminal.
- Opaque frame pixels require a bounded owned snapshot lease, and graph toolbars
  require foreground restoration above native terminal canvases.
- Claude, Codex, Cursor and OpenCode CLI plans now carry the selected persona
  and custom instructions. Pi carries them exactly once.
- GraphX saves customTitle separately from its source-derived title, including
  compatible restoration of distinguishable legacy labels.
- Capture cloning preserves the current select options rather than defaults.
- Packaged Tauri style policies require the real static-style nonce for
  trusted engine styles; merely counting SVG nodes is insufficient proof.

The first packaged capture fixture used raw CSP and therefore missed Tauri's
nonce transformation. Actual own-pane pixels revealed unstyled controls and
the default 300x150 SVG. That result is retained as a failed acceptance, not
reported as a passing graph render.

## Evidence handling and limits

Automatic approval review rejected transfer of a full-window PNG because it
could include private terminal/editor content. No such transfer occurred.
Only the explicit, owned three-node GraphX pane was transferred after source,
document and revision checks. Full-window captures remain on M2.

The final packaged rendering, capture and restored-title results are recorded
below after matching-artifact verification. General frontend/Rust floors from
the terminal sweep were not repeated for these focused changes. No performance
laboratory, Actions, push, PR, publication or protected-original-Mac project
operation was performed.


## Final packaged candidate

Code commit: 2d869a350465443b4bb860f5d3a9ee098dc2ddff.
Frozen artifact: .terax/qa-candidates/2d869a3/Pi-Terax Sandbox.app.
Executable SHA256:
ace0ce11c48ba2fbb699efde30a36d03ac41ffe972d62d70e2b3dc393508e4e2.

The matching application is PID 5217 with two ordinary shells 5549/5550.
Discovery, mapped executable and app.buildInfo identify this exact code and qa.
All13 tabs and all 3 editor paths survived the controlled restart. The owned
graph retained its document UUID, revision 5, source and floating geometry.

The three nodes and two connections are visible in the actual packaged pane.
A real sequence-button action also produced the three participants and both
messages; its PNG was inspected and the main graph view restored. The placement
select correctly shows Dock left. Captures are application-owned pane PNGs.

Actual pointer resize increased the panel by 80px width/40px height and its SVG
from 636x389 to 716x429, then restored the original dimensions. Docking left grew
the SVG height from 389 to 707, matching the panel's 318px growth. Native shells
5549/5550 stayed the same; their columns stayed 63 while floating/resizing and
changed to 25 when docked. The final demo remains docked left beside tab 35.

The restored custom-name workflow passed on code 953b12e: rename before restart,
restore, update graph source without losing the name, reset to the source title,
then restore the original source. The document advanced to revision 5 without
changing incarnation. Subsequent code changes were only embed CSS and fixture/docs.

The final focused combined run passed 110 tests in 11 files plus TypeScript at
953b12e. The subsequent CSS-only adjustment passed a RED/GREEN system-WK
same-frame resize case and the existing HTTP fixture; one matching app build
and actual pointer/viewport acceptance followed. No already-passed general
frontend/Rust floors were rerun for CSS. Independent reviews found no remaining
blocking issues in the feature or its atomic corrections.

Ignored evidence is under .terax/pi-development/m2/logs/candidate-2d869a3/,
including artifact/runtime identities, backups, graph-panel restart acceptance,
live resize measurements and graph/sequence capture results. Earlier directed
records under candidate-1eb3dd4, candidate-04bf58a and candidate-953b12e retain
the actual failures and their successful corrections. Final PNGs were inspected
only for the owned graph pane; full-window PNGs were not transferred.

This feature's functional M2 acceptance is complete. A real model/provider turn
was not submitted. Other supported-platform and broader terminal/default
migration requirements remain in the terminal validation report.
