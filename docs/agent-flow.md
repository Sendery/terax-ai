# Agent Flow

Open **Agent Flow** from the Agent Monitor header. It opens a Terax workspace
tab. The map shows concurrent sessions and their available delegations together.
Choose a source tab or project, or switch between active and all sessions.
Agents and subagents share the source tab accent. Replies and prompts appear
in speech bubbles, tool calls appear beside the agent that made them, and
delegation and return events travel in opposite directions along their links.

Drag the map or use the trackpad to pan, pinch or use the zoom buttons to zoom,
and use Fit all or the minimap to reorient the canvas. The Agents list can find
and center a session. The direction button switches between top to bottom and
right to left. Select an agent, bubble or tool to open its details. Activity,
Messages, Tools and Files views work at the current replay position. Files
lists explicit paths reported by supported file tools.

Use the timeline to scrub, step or replay at 1×, 2× or 4×. Go live returns to
incoming activity. Usage displays available token records for Claude Code,
Codex and Pi and reported cost for Pi. The amounts cover the loaded traces.

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
