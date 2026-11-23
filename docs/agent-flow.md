# Agent Flow

Open **Agent Flow** from the Agent Monitor header. It opens a Terax workspace
tab. The map shows concurrent sessions and their available delegations together.
Choose a source tab or project, or switch between active and all sessions.
Agents and subagents share the source tab accent. Replies and prompts appear
in speech bubbles, tool calls appear beside the agent that made them, and
delegation and return events travel in opposite directions along their links.
During live viewing, the halo and its markers move even while an agent is
idle. The colored ring segments show the latest recorded signal types.
The latest-signal card opens the corresponding agent and event. Replay pauses
ambient movement.

Drag the map or use the trackpad to pan, pinch or use the zoom buttons to zoom,
and use Fit all or the minimap to reorient the canvas. The Agents list can find
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
Archived sessions without recorded pane attribution get individual tracks.
Go live returns to incoming activity. Usage displays available token records for Claude Code,
Codex and Pi and reported cost for Pi. Codex also displays the last recorded
input token count against its context window. The amounts cover the loaded traces.

| CLI | Recorded terminal activity | Transcript activity |
| --- | --- | --- |
| Claude Code | Terax hooks, process status and terminal alerts | Messages, tool calls, delegation calls and return notifications from the parent transcript |
| Codex | Process status and terminal alerts | Messages, tools, turns and child rollout links, with child activity when available |
| Pi | Pi extension markers, process status and terminal alerts | Messages, tools and explicit subagent calls from the session transcript |
| Copilot CLI | Process status and terminal alerts | Messages, tools, turns and structured subagent events |
| Antigravity | Process status and terminal alerts | Messages, tools and errors from local transcripts with a recorded workspace |
| Grok | Process status and terminal alerts | Terminal activity is retained from this version |

Project history is discovered for open and recently recorded public terminal directories. Previous
transcripts without a recorded tab association appear under the project. Codex,
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
