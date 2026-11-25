# Agent Flow

Open **Agent Flow** from the Agent Monitor header. It opens a Terax workspace
tab. Use **Detach** to move the map into a separate window that you can put on
another display. **Dock** returns to the workspace tab. Both views follow the
same terminal sessions.

The source menu groups open shells under their tab. Select a tab to include all
its shells, including newly opened splits, or select individual shells. The
menu updates as shells open or close. A named session uses its CLI name. Other
agent sessions show their tab, start time and CLI. **All sessions** also exposes
archived sources that cannot be attributed to a current tab.
Agents and subagents share the source tab accent. Replies and prompts appear
in speech bubbles, tool calls appear beside the agent that made them, and
delegation and return events travel in opposite directions along their links.
During live viewing, the halo and its markers move even while an agent is
idle. The colored ring segments show the latest recorded signal types.
The latest-signal card opens the corresponding agent and event. Replay pauses
ambient movement.

Drag the map or use the trackpad to pan, pinch or use the zoom buttons to zoom,
and use **Fit all** to reorient the canvas. The adjacent zoom menu offers presets
and **Auto fit**, which smoothly reframes the map as nodes appear or leave.
The minimap starts folded in the
bottom-left corner and opens above the zoom controls. The Agents list can find
and center a session. The direction button switches between top to bottom and
left to right. In the horizontal view, each session starts on the left and
delegates toward the right. Switch from Fit to screen to session lanes to give
each session its own column in the vertical view or row in the horizontal view.
Pan across the lanes to explore, or fit the whole map using the canvas controls.
Select an agent, bubble or tool to open its details. Activity,
Messages, Tools and Files views work at the current replay position. Files
lists explicit paths reported by supported file tools.

At overview zoom, the map shows names and states. Zoom in to reveal
conversations, then tools and telemetry. Pin a session from its inspector to
keep its position on screen as incoming activity changes the map.

Live nodes pulse when Terax records a notification for their shell. Pending
permission and input labels stay with their own nodes until the shell resumes.
The notification bell keeps the full notification history and actions. Canvas
effects respect the operating system's reduced-motion setting.

Manage terminal tabs in the existing workspace controls. Terax AI can list,
inspect, focus and organize public terminals from its chat panel. This includes
split panes and shells without a detected agent or trace.

The canvas draws explicit terminal relays as directed links. Use `terminal.send`
with the destination `leafId` and optional
`sourceLeafId` from `terminal.list` to link two shells. Shells may share a tab
or be in different tabs or spaces. With no source pane, the link starts at
Terax. Shells with a relay and no detected agent get a lightweight endpoint.
Agent Flow retains the endpoints, time and
whether input was staged or submitted. Message text stays out of the relay
journal. A successful write to the terminal establishes delivery to the pane.
The connection uses the source pane declared by the caller. Conversation
between tools outside this route depends on the links recorded by the CLI.

Shared file activity draws a dotted, undirected link when one session attempts
to write a file and another reads or attempts to write the same normalized path.
Select a relay or
file label on the map to inspect its evidence, open the Git diff or jump to
the recorded event. Links follow the current time and session filters and
cover the transcripts loaded in this view.

Use the timeline to scrub, step or replay at 1×, 2× or 4×. It opens as a single
activity overview. Expand Shells to show one track per terminal pane, including
separate panes in the same tab. All tracks share the same time scale and
playhead. Click a track or use its arrow keys to seek to one of its events.
Each shell has a checkbox to hide its track and its marks from the timeline.
The canvas keeps showing the shell while its timeline is hidden.
Archived sessions without recorded pane attribution get individual tracks.
Go live returns to incoming activity. Usage displays available token records for Claude Code,
Codex and Pi and reported cost for Pi. Codex also displays the last recorded
input token count against its context window. The amounts cover the loaded traces.

| CLI | Recorded terminal activity | Transcript activity |
| --- | --- | --- |
| Claude Code | Terax hooks, process status and terminal alerts | Messages, tool calls, delegation calls and return notifications from the parent transcript |
| Codex | Process status and terminal alerts | Tools, turns, token counts and context occupancy from rollouts. Subagents use the recorded parent relationship and task events, including children that run in a different worktree. |
| Pi | Pi extension markers, process status and terminal alerts | Messages, tools and explicit subagent calls from the session transcript |
| Copilot CLI | Process status and terminal alerts | Messages, tools, turns, structured subagent events and token totals from usage records or session accounting when present. |
| Antigravity | Process status and terminal alerts | Messages, tools and errors from local transcripts with a recorded workspace. Usage depends on the transcript including a count. |
| Grok | Process status and terminal alerts | Terminal activity only. |
| Terax AI | Chat and delegated tool lifecycle | Tool names, subagent status and reported token counts. The Flow journal stores no chat text, tool inputs or outputs. |

Finished subagents and jobs leave the live map after 30 seconds. In **Active
sessions**, a completed session also leaves once its work ends. A subsequent
turn brings it back. **All sessions** keeps finished subagents available with their tools and usage.

Project history is discovered for open and recently recorded public terminal directories.
History joins a current tab when its directory maps to that one tab. Codex,
Copilot and Antigravity transcripts join a terminal run when a unique start-time match is
available in its directory. Resumed or concurrent runs with ambiguous matches
remain separate. The terminal journal keeps at most 160 recent public runs and
96 terminal events per run. It stores lifecycle and source metadata. The map
follows active transcripts in bounded batches by byte offset and reads nearby
historical transcripts on demand. It reads at most the latest 4 MiB and keeps
up to 600 projected events per trace in memory. Offscreen agent nodes are
culled, and the map follows the operating system's reduced-motion setting.
Use the existing session history panel for the complete supported conversation
tree.

Private panes are excluded from recording and source discovery. When a private
pane shares a directory, Agent Flow skips that project's history discovery
while the pane is open. CLI activity is read from the local machine through
the native app. Agent Flow starts no separate server, hook installer or shell.
