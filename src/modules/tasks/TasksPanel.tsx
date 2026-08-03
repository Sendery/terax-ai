import {
  Add01Icon,
  AlarmClockIcon,
  Cancel01Icon,
  FilterIcon,
  PauseIcon,
  PlayIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { applyMissedGrouping, sortTasksByNextRun } from "./lib/collection";
import { missedPolicyLabel } from "./lib/presentation";
import type { RunHistory } from "./lib/store";
import type { TaskRun } from "./lib/runs";
import type { ScheduledTask } from "./lib/task";
import { TaskCardView } from "./TaskCardView";

export function TasksPanel({
  tasks,
  runs,
  now,
  paused,
  runningIds,
  queuedIds,
  onAdd,
  onEdit,
  onRemove,
  onToggleEnabled,
  onRunNow,
  onRecover,
  onTogglePaused,
  onHide,
}: {
  tasks: readonly ScheduledTask[];
  runs: RunHistory;
  now: number;
  paused: boolean;
  runningIds: readonly string[];
  queuedIds: readonly string[];
  onAdd: () => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onRunNow: (id: string) => void;
  onRecover?: (run: TaskRun) => void;
  onTogglePaused: () => void;
  onHide: () => void;
}) {
  const [grouped, setGrouped] = useState(false);
  const running = useMemo(() => new Set(runningIds), [runningIds]);
  const queued = useMemo(() => new Set(queuedIds), [queuedIds]);
  const ordered = useMemo(() => sortTasksByNextRun(tasks), [tasks]);
  const groups = useMemo(
    () => (grouped ? applyMissedGrouping(tasks) : []),
    [grouped, tasks],
  );

  const card = (task: ScheduledTask) => (
    <li key={task.id}>
      <TaskCardView
        task={task}
        runs={runs[task.id] ?? []}
        now={now}
        running={running.has(task.id)}
        queued={queued.has(task.id)}
        onToggleEnabled={onToggleEnabled}
        onRunNow={onRunNow}
        onEdit={onEdit}
        onRemove={onRemove}
        onRecover={onRecover}
      />
    </li>
  );

  return (
    <aside
      data-capture-target="tasks"
      className="flex h-full min-h-0 flex-col border-l border-border/60 bg-card"
    >
      <header className="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-2.5 py-2">
        <HugeiconsIcon
          icon={AlarmClockIcon}
          size={14}
          strokeWidth={1.75}
          className="shrink-0 text-muted-foreground"
        />
        <h2 className="flex min-w-0 flex-1 items-baseline gap-1.5 text-xs font-semibold tracking-wide text-foreground">
          <span>Scheduled</span>
          {tasks.length > 0 && (
            <span className="text-muted-foreground">{tasks.length}</span>
          )}
          {paused && (
            <span className="text-[11px] font-normal text-amber-600 dark:text-amber-400">
              · paused
            </span>
          )}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Group tasks by recovery policy"
          aria-pressed={grouped}
          title="Group by recovery policy"
          onClick={() => setGrouped((current) => !current)}
          className={cn(
            "size-6",
            grouped
              ? "bg-accent/60 text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <HugeiconsIcon icon={FilterIcon} size={13} strokeWidth={2} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={paused ? "Resume all scheduled tasks" : "Pause all scheduled tasks"}
          aria-pressed={paused}
          title={paused ? "Resume all" : "Pause all"}
          onClick={onTogglePaused}
          className={cn(
            "size-6",
            paused
              ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <HugeiconsIcon
            icon={paused ? PlayIcon : PauseIcon}
            size={13}
            strokeWidth={2}
          />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="New scheduled task"
          title="New task"
          onClick={onAdd}
          className="size-6 text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon icon={Add01Icon} size={13} strokeWidth={2} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Hide scheduled tasks panel"
          title="Hide scheduled tasks"
          onClick={onHide}
          className="size-6 text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={2} />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {tasks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <HugeiconsIcon
              icon={AlarmClockIcon}
              size={26}
              strokeWidth={1.5}
              className="text-muted-foreground/40"
            />
            <p className="text-xs text-muted-foreground">
              No scheduled tasks yet.
            </p>
            <p className="text-[11px] text-muted-foreground/70">
              Create one to wake a Pi session with the same prompt on a
              schedule, in a terminal tab or headless.
            </p>
            <Button size="sm" variant="secondary" className="mt-1" onClick={onAdd}>
              New task
            </Button>
          </div>
        ) : grouped ? (
          <div className="flex flex-col gap-3">
            {groups
              .filter((group) => group.tasks.length > 0)
              .map((group) => (
                <section key={group.policy} className="flex flex-col gap-1.5">
                  <h3 className="px-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    {missedPolicyLabel(group.policy)}
                    <span className="ml-1 font-normal">{group.tasks.length}</span>
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {group.tasks.map(card)}
                  </ul>
                </section>
              ))}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">{ordered.map(card)}</ul>
        )}
      </div>
    </aside>
  );
}
