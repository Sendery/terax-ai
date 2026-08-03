# Scheduled tasks

Scheduled tasks wake a Pi session with a prompt you wrote once, on a schedule or
on demand. A task can run invisibly in the background or inside a terminal tab
you can take over afterwards.

Open the panel with the alarm-clock button in the header, next to notes.

## What a task is

| Field | Meaning |
| --- | --- |
| Name | Label on the card. |
| Prompt | Sent verbatim to the Pi session. Multiple lines are supported. |
| Schedule | When it fires. See below. |
| Run in | `Terminal tab` or `Headless`. |
| Context | `Task` reuses one session so context accumulates. `Routine` starts a fresh session each run. |
| Working directory | Where pi runs. Defaults to the active tab's directory. |
| Pi session id | An existing session to wake. Leave empty and Terax owns one for the task. |
| Model / provider / thinking | Per task. Leave empty to inherit your pi defaults. |
| Max runs | Stop after N runs. Empty means unlimited. |

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
| `once:2026-08-04T09:15` | A single instant. |

Times are your local wall clock and stay correct across daylight saving changes.

## How a run happens

**Headless** spawns `pi --print --session-id <id> "<prompt>"` in the task's
directory, captures its output, and is killed if it exceeds 30 minutes.

**Terminal tab** reuses the tab linked to the task, or creates one in the task's
directory, launches `pi --session-id <id>` there, then types the prompt and
presses Enter. Line breaks are sent as Shift+Enter so a multiline prompt arrives
intact, and the session stays live for you to continue by hand.

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
keep their cadence.

## Driving it from Pi

Pi can manage tasks through the Terax bridge:

`tasks.show`, `tasks.hide`, `tasks.toggle`, `tasks.list`, `tasks.add`,
`tasks.update`, `tasks.remove`, `tasks.run`, `tasks.setEnabled`,
`tasks.pauseAll`, `tasks.resumeAll`.

`tasks.add` needs a name, a prompt and a schedule spec. Omit the working
directory and the task inherits the calling session's directory, so the session
can be resumed where it was created. Call `app.commands` for the full parameter
list.

`app.snapshot` reports task state, but never the prompt. `tasks.list` returns the
prompt, because asking for it is explicit.
