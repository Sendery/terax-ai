# Agent Flow

Open **Agent Flow** from the Agent Monitor header. It opens a Terax workspace
tab. Choose a terminal tab or project from the source selector, then select a
session to inspect its activity and delegations. Root and subagent cards share
the source tab accent. The direction button alternates between top to bottom
and right to left. Use the timeline slider, playback button or an activity
timestamp to review a point in time. Go live returns to incoming activity.

| CLI | Recorded terminal activity | Transcript activity |
| --- | --- | --- |
| Claude Code | Terax hooks, process status and terminal alerts | Messages, tool calls, delegation calls and return notifications from the parent transcript |
| Codex | Process status and terminal alerts | Messages, tools, turns and child rollout links, with child activity when available |
| Pi | Pi extension markers, process status and terminal alerts | Messages, tools and explicit subagent calls from the session transcript |
| Copilot CLI | Process status and terminal alerts | Messages, tools, turns and structured subagent events |
| Antigravity | Process status and terminal alerts | Messages, tools and errors from local transcripts with a recorded workspace |
| Grok | Process status and terminal alerts | Terminal activity is retained from this version |

Project history is discovered for open public terminal directories. Previous
transcripts without a recorded tab association appear under the project. Codex,
Copilot and Antigravity transcripts join a terminal run when a unique start-time match is
available in its directory. Resumed or concurrent runs with ambiguous matches
remain separate. The terminal journal keeps at most 160 recent public runs and
96 terminal events per run. It stores lifecycle and source metadata. Transcript
excerpts are fetched on demand, remain in memory and follow the selected live
session by byte offset. The view reads at most the latest 4 MiB and retains up
to 600 projected events per trace. Use the existing session history panel for
the complete supported conversation tree.

Private panes are excluded from recording and source discovery. When a private
pane shares a directory, Agent Flow skips that project's history discovery
while the pane is open. CLI activity is read from the local machine through
the native app. Agent Flow starts no separate server, hook installer or shell.
