# Scheduled tasks

Scheduled tasks wake an agent session with a prompt you wrote once, on a schedule
or on demand. A task can run invisibly in the background or inside a terminal tab
you can take over afterwards, and it can drive pi, Claude Code or Codex.

Open the panel with the alarm-clock button in the header, next to notes.

## What a task is

| Field | Meaning |
| --- | --- |
| Name | Label on the card. |
| Prompt | Sent verbatim to the Pi session. Multiple lines are supported. |
| Schedule | When it fires. See below. |
| Run in | `Terminal tab` or `Headless`. |
| Context | `Task` reuses one session so context accumulates. `Routine` starts a fresh session each run. |
| Agent | `Pi`, `Claude Code` or `Codex`. Decides which command line the run launches. |
| Model | A preset for that agent, `Inherit default`, or a custom value passed verbatim. |
| Working directory | Where the agent runs. Defaults to the active tab's directory. |
| Session id | An existing session to wake. Leave empty and Terax owns one for the task. |
| Max runs | Stop after N runs. Empty means unlimited. |

A new task starts from the parameters of the last one you created — schedule,
agent, model, directory and policies — so a second task is a small edit rather
than a full form. Name and prompt are never inherited.

## Agents

| Agent | Launches | Session handling |
| --- | --- | --- |
| Pi | `pi` | `--session-id` accepts any id and creates it if missing. |
| Claude Code | `claude` | `--session-id` needs a UUID and only works once; later runs use `--resume`. |
| Codex | `codex` / `codex exec` | Codex mints its own ids, so a task resumes its most recent session in the directory (`codex resume --last`). |

Provider and thinking level are pi-only options and are ignored by the other two.

## Schedules

The editor builds these for you, alarm-clock style. The same schedules have a
compact text form, which is what the Pi commands accept:

| Spec | Meaning |
| --- | --- |
| `manual` | Never fires on its own. |
| `every:30m`, `every:2h`, `every:1d` | Fixed interval. One minute is the floor. |
| `daily:09:00` | Every day at a time. |
| `weekly:mon,wed@07:30` | Named weekdays. `weekdays` and `weekend` are shorthands. |
| `days:3@06:00:2026-08-01` | Every N days, anchored on a date. |
| `dates:2026-08-04,2026-08-09@12:00` | Specific calendar dates. |
| `once:2026-08-04T09:15` | A single instant, edited as a date field and an hour field. |

Times are your local wall clock and stay correct across daylight saving changes.

## Duplicating a task and starting a new session

The card has two buttons next to edit:

- **Duplicate** copies the task with its schedule, agent, model, directory and
  policies, opens the copy in the editor, and leaves it **disabled** so it
  cannot fire while you are still changing it. Run history, the tab it was
  linked to, and the session it accumulated stay with the original.
- **New session seed** points the task at a brand new agent session. The next
  run starts from an empty context instead of continuing the conversation the
  task has been growing. Nothing else changes: the schedule, the runs already
  spent and the history stay as they are.

## How a run happens

**Headless** spawns the agent's non-interactive form in the task's directory
(`pi --print … "<prompt>"`, `claude --print … "<prompt>"`, `codex exec …
"<prompt>"`), captures its output, and is killed if it exceeds 30 minutes.

**Terminal tab** reuses the tab linked to the task, or creates one in the task's
directory, launches the agent there, then types the prompt and
presses Enter. Line breaks are sent as Shift+Enter so a multiline prompt arrives
intact, and the session stays live for you to continue by hand.

Typing waits for the agent's TUI to take the terminal into raw mode, rather than
for a fixed delay: a prompt typed into a still-booting session is swallowed
together with the Enter that would submit it, leaving the text sitting in the
composer. After Enter, Terax checks the terminal for a started turn and presses
Enter again if it sees none; the run card says so when it could not confirm one.

## What the card reports

Time spent, tokens and cost, both for the last trigger and accumulated. These
come from Pi's own session file, so they are the real numbers.

The conversation itself is not copied into Terax. Use the card's open-in-terminal
button to reopen that run's session in a new tab, already in the right directory.

## Policies

Each task decides its own behaviour, and the funnel icon groups the panel by the
recovery policy.

**Missed runs**, when Terax was closed over one or more occurrences:

- `Recover once` (default) runs one catch-up and resumes the normal cadence.
- `Skip missed` ignores them.
- `Recover all` replays every lost occurrence.
- `Ask on resume` leaves it to you.

**Already running**, when the next occurrence arrives before the previous run
finished: `Queue next` (default, one deep, further occurrences are skipped and
reported), `Skip while running`, or `Allow parallel`.

**Failure**: retry with growing backoff, then disable the task with a red
notification.

## Safety

A scheduled prompt runs pi unattended, so it can edit files and run commands in
the task's directory. Creating a task therefore requires an explicit
confirmation, `Max runs` can bound it, and the pause button in the panel header
stops every schedule at once. Manual runs still work while paused.

Terax only fires while it is running. Enable launch at login if you want tasks to
keep their cadence, or turn on the waker below.

## Waking Terax when it is closed

Settings has an optional **Wake Terax for scheduled tasks** toggle. It registers a
background check with your operating system: a LaunchAgent on macOS, a systemd
user timer on Linux, a Task Scheduler task on Windows. Turning the toggle off
removes it again.

The check runs every 15 minutes by default, adjustable from 1 to 180 minutes.
That interval bounds how late a task can fire while Terax is closed, and both
you and Pi can change it.

Each check is deliberately cheap. It asks a running Terax to handle the wake and
exits; one instance confirming is enough, because every instance shares the same
tasks. If none is running it reads the next scheduled instant that Terax exported
and exits when nothing is due. Only when something is actually overdue does it
open Terax, minimized and without stealing focus, and Terax then stays running so
its own clock takes over.

### Waking the computer itself

Only Windows can do this without administrator rights, so only there does the
task ask to wake the machine. On macOS scheduling a wake needs root
(`pmset schedule` refuses otherwise), and a systemd user timer may not set
`WakeSystem` because that needs a privileged capability. On those systems a due
task runs the next time the computer wakes, and your recovery policy decides what
happens to anything missed in between.

## Driving it from Pi

Pi can manage tasks through the Terax bridge:

`tasks.show`, `tasks.hide`, `tasks.toggle`, `tasks.list`, `tasks.add`,
`tasks.update`, `tasks.remove`, `tasks.run`, `tasks.setEnabled`,
`tasks.pauseAll`, `tasks.resumeAll`, `tasks.openEditor`, `tasks.wake`.

`tasks.wake` re-evaluates the schedule and dispatches whatever is due. It is what
the OS waker calls, so confirming it is how a running Terax takes ownership of a
wake.

`tasks.add` needs a name, a prompt and a schedule spec. Omit the working
directory and the task inherits the calling session's directory, so the session
can be resumed where it was created. Call `app.commands` for the full parameter
list.

`app.snapshot` reports task state, but never the prompt. `tasks.list` returns the
prompt, because asking for it is explicit.
