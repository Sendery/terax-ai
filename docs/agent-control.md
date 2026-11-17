# Agent control of Terax

The Pi-Terax Agente, and any agent connected through the Pi-Terax extension or `terax --mcp`, operates the whole app through the command registry. This page covers what was added for that: terminal control, watches, the per-agent default model, shell commands from the AI input bar, and the conversation commands. The registry itself is described in `docs/pi-terax.md`.

## Terminals

| Command | What it does | Asks first (built-in agent) |
|---|---|---|
| `terminal.list` | Every pane that is not private: `leafId`, tab, space, title, directory, focus, running coding agent. Private terminals are a count only. | no |
| `terminal.read` | Tail of a pane's scrollback (200 lines by default, 2000 at most), secrets redacted. | no |
| `terminal.open` | New terminal tab, optionally with `cwd`, `title` and a `command` to run. | only with `command` |
| `terminal.split` | Split a pane `right` or `down` (four panes per tab), optionally running a `command`. | only with `command` |
| `terminal.focus` | Focus a pane, switching space and tab. | no |
| `terminal.close` | Close a pane and end its shell. The last terminal cannot be closed. | yes |
| `terminal.send` | Type one line into a pane and press Enter (`submit: false` leaves it at the prompt). | yes |

A private terminal is outside all of these. A pane restored from disk that has not been opened yet has no shell: `terminal.read` and `terminal.send` say so and ask for `terminal.focus` first.

To run a system command without showing it, agents use their own shell tool (`bash_run` and `bash_background` in Terax AI, the host's shell in Pi or an MCP client). `terminal.open` and `terminal.send` are for commands the user should see, and for answering a program that is waiting for input.

## Spaces

`space.list`, `space.focus` and `tab.moveToSpace`, together with the existing `tab.move`, `tab.rename` and `tab.setColor`, let an agent reorganize tabs and terminals by task.

## Watches

A watch polls a shell command on an interval and reacts only when its output changes. It exists so that following something (a pull request, a deploy, a build) costs no agent turns while nothing happens.

```json
{
  "command": "watch.add",
  "payload": {
    "name": "PR 42",
    "command": "gh pr view 42 --json state,reviewDecision,statusCheckRollup",
    "intervalSeconds": 120,
    "onChange": "agent",
    "prompt": "Update the GraphX document pr-radar with the new state and add a note if a check failed."
  }
}
```

- `onChange: "notify"` (default) posts a native notification with the first line of the new output.
- `onChange: "agent"` hands the new output and the stored prompt to the active Terax AI conversation. It waits until the agent is idle, keeps only the newest undelivered change per watch, and falls back to a notification if the agent cannot be reached for five minutes.
- `onChange: "none"` only records it, for an agent that reads `watch.read` on its own schedule.

The first run records a baseline and is not a change. A run that fails or times out (60 seconds) is not a change either, and the baseline is kept. Editing the command or directory drops the baseline. Output is stored redacted and capped at 16 KiB. Limits: interval 15 seconds to 24 hours, 16 watches.

Watches persist across restarts (`terax-watches.json`). The status bar shows a radar pill with the number of active watches whenever one exists; its popover lists each with run now, pause and delete, so a command polling in the background is always visible and stoppable.

A watch runs a command; a scheduled task wakes a coding agent with a prompt. Use a task when the work needs an agent every time, a watch when it only matters on change. Combining both is the live-update pattern: the watch detects, the agent's reply updates the graph, note or tab with `graphx.update`, `notes.update` or `tab.rename`.

## Approval and postures

`src/modules/commands/lib/policy.ts` classifies every command as `read`, `act` or `approve`. The built-in agent asks before `approve` commands. Over MCP the tools that hold them are annotated destructive and open-world, so the host's own permission prompt applies. In Pi, shell-capable commands go through `terax_run`; the chat's accept-edits posture excludes that tool together with `bash`, and the read-only posture never had `terax_call`.

## Default model per agent

Settings, Agents: every agent card, built-in or custom, has a default-model selector grouped by provider. When that agent becomes active (at startup too) its model is selected, over the global default. With Pi as the model, an optional `provider/model` sets which model Pi uses. It is a starting point, not a lock: the model picker in the input bar still changes the model, and that choice lasts until the agent is selected again.

## Shell commands from the AI input bar

- `!command` runs a one-shot shell command in the active terminal's directory. The command and its output stay in the conversation as a block marked "Shared with agent", redacted like any terminal text, and the agent reads it on its next turn.
- `!!command` does the same, but the block is marked "Hidden from agent" and is removed from everything sent to a model or a CLI agent. It is not redacted, since it never leaves the machine.

Both run with a 120 second limit, show as running until they finish, and keep the exit code. They are one-shot subshells, like the agent's own `run_command`: for an interactive program, use a terminal.

## Conversation commands

- `/new` (or `#new` from the snippet picker) starts a new conversation. Text after it becomes the first message.
- `/compact` (or `#compact`), optionally followed by what to focus on, asks the model to summarize the conversation and replaces the history with that summary. If no summary comes back, nothing is replaced. Blocks hidden with `!!` are not part of the summary and are gone afterwards.

## Keeping the surfaces together

A capability an agent can use ships in the registry, the MCP server, the Pi-Terax extension and the Pi-Terax Agente in the same change. `TERAX.md` ("Capability parity") lists the places to touch; the parity tests fail until all of them agree.
