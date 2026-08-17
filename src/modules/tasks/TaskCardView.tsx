import {
  AlertCircleIcon,
  CommandIcon,
  Copy01Icon,
  CpuIcon,
  Delete02Icon,
  Edit02Icon,
  Loading03Icon,
  PlayIcon,
  Refresh01Icon,
  SquareArrowUpRightIcon,
  Timer01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { TAB_COLOR_CSS } from "@/modules/tabs";

import { agentLabel } from "./lib/agents";
import {
  formatCost,
  formatCountdown,
  formatDuration,
  formatTokens,
  modeLabel,
  scheduleLabel,
  targetLabel,
  taskAccessibleLabel,
} from "./lib/presentation";
import { aggregateTaskUsage, type TaskRun } from "./lib/runs";
import { isExhausted, type ScheduledTask } from "./lib/task";

function Chip({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "warn" | "error" | "ok";
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
        tone === "muted" && "bg-muted text-muted-foreground",
        tone === "ok" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
        tone === "warn" && "bg-amber-500/15 text-amber-600 dark:text-amber-400",
        tone === "error" && "bg-red-500/15 text-red-600 dark:text-red-400",
      )}
    >
      {children}
    </span>
  );
}

export function TaskCardView({
  task,
  runs,
  now,
  running = false,
  queued = false,
  onToggleEnabled,
  onRunNow,
  onEdit,
  onClone,
  onRegenerateSeed,
  onRemove,
  onRecover,
}: {
  task: ScheduledTask;
  runs: readonly TaskRun[];
  now: number;
  running?: boolean;
  queued?: boolean;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onRunNow: (id: string) => void;
  onEdit: (id: string) => void;
  /** Copies the task, disabled, and opens it for editing. */
  onClone?: (id: string) => void;
  /** Points the task at a brand new agent session. */
  onRegenerateSeed?: (id: string) => void;
  onRemove: (id: string) => void;
  /** Reopens the last run's Pi session in a new terminal tab. */
  onRecover?: (run: TaskRun) => void;
}) {
  const totals = aggregateTaskUsage(runs);
  const lastRun = runs[0];
  const exhausted = isExhausted(task);
  const dotColor = task.color ? TAB_COLOR_CSS[task.color] : undefined;

  return (
    <article
      aria-label={taskAccessibleLabel(task, now, { running, queued })}
      className={cn(
        "group rounded-lg border border-border/60 bg-card/60 p-2.5 transition-colors",
        !task.enabled && "opacity-60",
        running && "border-primary/50",
      )}
    >
      <div className="flex items-start gap-2">
        {dotColor && (
          <span
            aria-hidden
            className="mt-1 size-2 shrink-0 rounded-full"
            style={{ backgroundColor: dotColor }}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground">
            {task.name}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <HugeiconsIcon icon={Timer01Icon} size={11} strokeWidth={2} />
            <span className="truncate">{scheduleLabel(task.schedule)}</span>
          </p>
        </div>
        <Switch
          checked={task.enabled}
          onCheckedChange={(next) => onToggleEnabled(task.id, next)}
          aria-label={task.enabled ? "Disable task" : "Enable task"}
          className="mt-0.5 shrink-0"
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {running ? (
          <Chip tone="warn">
            <HugeiconsIcon icon={Loading03Icon} size={10} strokeWidth={2} />
            running
          </Chip>
        ) : queued ? (
          <Chip tone="warn">queued</Chip>
        ) : (
          <Chip>{formatCountdown(task.nextRunAt, now)}</Chip>
        )}
        <Chip>
          <HugeiconsIcon
            icon={task.target === "tab" ? CommandIcon : CpuIcon}
            size={10}
            strokeWidth={2}
          />
          {targetLabel(task.target)}
        </Chip>
        <Chip>{modeLabel(task.mode)}</Chip>
        <Chip>{agentLabel(task.agent)}</Chip>
        {task.model && <Chip>{task.model}</Chip>}
        {task.maxRuns !== undefined && (
          <Chip tone={exhausted ? "error" : "muted"}>
            {task.runCount}/{task.maxRuns}
          </Chip>
        )}
        {totals.failures > 0 && (
          <Chip tone="error">
            <HugeiconsIcon icon={AlertCircleIcon} size={10} strokeWidth={2} />
            {totals.failures}
          </Chip>
        )}
      </div>

      {totals.runs > 0 && (
        <dl className="mt-2 grid grid-cols-3 gap-1 border-t border-border/40 pt-2 text-[10px]">
          <div className="min-w-0">
            <dt className="text-muted-foreground/70">Time</dt>
            <dd className="truncate font-medium text-foreground">
              {formatDuration(totals.durationMs)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground/70">Tokens</dt>
            <dd className="truncate font-medium text-foreground">
              {formatTokens(totals.usage.totalTokens)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground/70">Cost</dt>
            <dd className="truncate font-medium text-foreground">
              {formatCost(totals.usage.costTotal)}
            </dd>
          </div>
        </dl>
      )}

      {lastRun?.message && (
        <p
          className={cn(
            "mt-2 line-clamp-2 rounded bg-muted/60 px-1.5 py-1 text-[10px]",
            lastRun.status === "failed" || lastRun.status === "timeout"
              ? "text-red-600 dark:text-red-400"
              : "text-muted-foreground",
          )}
        >
          {lastRun.message}
        </p>
      )}

      <div className="mt-2 flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-foreground"
          aria-label={`Run ${task.name} now`}
          title="Run now"
          disabled={running}
          onClick={() => onRunNow(task.id)}
        >
          <HugeiconsIcon icon={PlayIcon} size={12} strokeWidth={2} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-foreground"
          aria-label={`Edit ${task.name}`}
          title="Edit"
          onClick={() => onEdit(task.id)}
        >
          <HugeiconsIcon icon={Edit02Icon} size={12} strokeWidth={2} />
        </Button>
        {onClone && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            aria-label={`Duplicate ${task.name}`}
            title="Duplicate into a new, disabled task"
            onClick={() => onClone(task.id)}
          >
            <HugeiconsIcon icon={Copy01Icon} size={12} strokeWidth={2} />
          </Button>
        )}
        {onRegenerateSeed && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            aria-label={`Start a new session for ${task.name}`}
            title="New session seed: the next run starts a fresh session"
            disabled={running}
            onClick={() => onRegenerateSeed(task.id)}
          >
            <HugeiconsIcon icon={Refresh01Icon} size={12} strokeWidth={2} />
          </Button>
        )}
        {onRecover && lastRun && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            aria-label={`Open the last run of ${task.name} in a terminal`}
            title="Open last run in a terminal"
            onClick={() => onRecover(lastRun)}
          >
            <HugeiconsIcon
              icon={SquareArrowUpRightIcon}
              size={12}
              strokeWidth={2}
            />
          </Button>
        )}
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-red-500"
          aria-label={`Delete ${task.name}`}
          title="Delete"
          onClick={() => onRemove(task.id)}
        >
          <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={2} />
        </Button>
      </div>
    </article>
  );
}
