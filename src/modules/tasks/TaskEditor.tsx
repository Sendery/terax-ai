import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import {
  agentCapabilities,
  agentLabel,
  agentModelPresets,
  DEFAULT_TASK_AGENT,
  TASK_AGENTS,
  type TaskAgent,
} from "./lib/agents";
import type { TaskDefaults } from "./lib/collection";
import {
  missedPolicyLabel,
  modeDescription,
  overlapPolicyLabel,
  scheduleLabel,
} from "./lib/presentation";
import {
  fromDateAndTime,
  isSchedule,
  MIN_INTERVAL_MINUTES,
  type Schedule,
  toDateInput,
  toTimeInput,
  type Weekday,
} from "./lib/recurrence";
import {
  MISSED_POLICIES,
  type MissedPolicy,
  OVERLAP_POLICIES,
  type OverlapPolicy,
  type ScheduledTask,
  type TaskInput,
  type TaskMode,
  type TaskTarget,
} from "./lib/task";

/** Sentinel values for the model select, which mixes presets with two states
 *  that are not model names. */
const MODEL_INHERIT = "\u0000inherit";
const MODEL_CUSTOM = "\u0000custom";

function agentHint(agent: TaskAgent): string {
  switch (agent) {
    case "claude":
      return "Runs the claude command line.";
    case "codex":
      return "Runs the codex command line.";
    default:
      return "Runs the pi command line.";
  }
}

function sessionHint(agent: TaskAgent): string {
  switch (agent) {
    case "claude":
      return "A UUID, or empty to let Terax own the session.";
    case "codex":
      return "Codex mints its own ids: a task resumes its most recent session in this directory.";
    default:
      return "Leave empty to let Terax create and own the session.";
  }
}

const DAY_LABELS: readonly { value: Weekday; label: string }[] = [
  { value: 1, label: "M" },
  { value: 2, label: "T" },
  { value: 3, label: "W" },
  { value: 4, label: "T" },
  { value: 5, label: "F" },
  { value: 6, label: "S" },
  { value: 0, label: "S" },
];

type ScheduleKind = Schedule["kind"];

const KIND_LABELS: Record<ScheduleKind, string> = {
  manual: "Manual only",
  once: "Once",
  everyN: "Repeat every",
  weekly: "Days of the week",
  everyNDays: "Every N days",
  dates: "Specific dates",
};

const KIND_ORDER: readonly ScheduleKind[] = [
  "everyN",
  "weekly",
  "everyNDays",
  "dates",
  "once",
  "manual",
];

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function defaultSchedule(kind: ScheduleKind): Schedule {
  switch (kind) {
    case "manual":
      return { kind: "manual" };
    case "once":
      return { kind: "once", at: Date.now() + 3_600_000 };
    case "everyN":
      return { kind: "everyN", minutes: 60 };
    case "weekly":
      return { kind: "weekly", days: [1, 2, 3, 4, 5], time: "09:00" };
    case "everyNDays":
      return { kind: "everyNDays", days: 1, time: "09:00", from: todayIso() };
    case "dates":
      return { kind: "dates", dates: [todayIso()], time: "09:00" };
  }
}

function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label className="text-[11px] font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

function ScheduleBuilder({
  schedule,
  onChange,
}: {
  schedule: Schedule;
  onChange: (next: Schedule) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
      <Field label="When">
        <Select
          value={schedule.kind}
          onValueChange={(kind) => onChange(defaultSchedule(kind as ScheduleKind))}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KIND_ORDER.map((kind) => (
              <SelectItem key={kind} value={kind} className="text-xs">
                {KIND_LABELS[kind]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {schedule.kind === "everyN" && (
        <Field label="Interval" hint="One minute is the shortest allowed interval.">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={MIN_INTERVAL_MINUTES}
              value={schedule.minutes}
              onChange={(e) =>
                onChange({
                  kind: "everyN",
                  minutes: Math.max(
                    MIN_INTERVAL_MINUTES,
                    Number.parseInt(e.target.value, 10) || MIN_INTERVAL_MINUTES,
                  ),
                })
              }
              className="h-8 w-24 text-xs"
              aria-label="Interval in minutes"
            />
            <span className="text-xs text-muted-foreground">minutes</span>
          </div>
        </Field>
      )}

      {schedule.kind === "weekly" && (
        <>
          <Field label="Days">
            <ToggleGroup
              type="multiple"
              value={schedule.days.map(String)}
              onValueChange={(values) => {
                const days = values
                  .map((v) => Number.parseInt(v, 10))
                  .filter((v): v is Weekday => v >= 0 && v <= 6);
                if (days.length === 0) return;
                onChange({ ...schedule, days });
              }}
              className="justify-start"
            >
              {DAY_LABELS.map((day) => (
                <ToggleGroupItem
                  key={day.value}
                  value={String(day.value)}
                  aria-label={`Weekday ${day.value}`}
                  className="size-7 text-[11px]"
                >
                  {day.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
          <Field label="Time">
            <Input
              type="time"
              value={schedule.time}
              onChange={(e) => onChange({ ...schedule, time: e.target.value })}
              className="h-8 w-28 font-mono text-xs"
              aria-label="Time of day, 24 hour HH:MM"
            />
          </Field>
        </>
      )}

      {schedule.kind === "everyNDays" && (
        <div className="flex flex-wrap gap-3">
          <Field label="Every">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                value={schedule.days}
                onChange={(e) =>
                  onChange({
                    ...schedule,
                    days: Math.max(1, Number.parseInt(e.target.value, 10) || 1),
                  })
                }
                className="h-8 w-20 text-xs"
                aria-label="Day interval"
              />
              <span className="text-xs text-muted-foreground">days</span>
            </div>
          </Field>
          <Field label="Starting">
            <Input
              type="date"
              value={schedule.from}
              onChange={(e) => onChange({ ...schedule, from: e.target.value })}
              className="h-8 w-40 font-mono text-xs"
              aria-label="Anchor date, YYYY-MM-DD"
            />
          </Field>
          <Field label="Time">
            <Input
              type="time"
              value={schedule.time}
              onChange={(e) => onChange({ ...schedule, time: e.target.value })}
              className="h-8 w-28 font-mono text-xs"
              aria-label="Time of day, 24 hour HH:MM"
            />
          </Field>
        </div>
      )}

      {schedule.kind === "dates" && (
        <>
          <Field
            label="Dates"
            hint="One date per line, as YYYY-MM-DD."
          >
            <Textarea
              value={schedule.dates.join("\n")}
              onChange={(e) =>
                onChange({
                  ...schedule,
                  dates: e.target.value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean),
                })
              }
              rows={3}
              className="text-xs"
              aria-label="Calendar dates"
            />
          </Field>
          <Field label="Time">
            <Input
              type="time"
              value={schedule.time}
              onChange={(e) => onChange({ ...schedule, time: e.target.value })}
              className="h-8 w-28 font-mono text-xs"
              aria-label="Time of day, 24 hour HH:MM"
            />
          </Field>
        </>
      )}

      {schedule.kind === "once" && (
        // Date and hour are edited separately. A single combined text field
        // could not be edited at all: every intermediate keystroke made the
        // whole instant unparseable, so the change was thrown away.
        <div className="flex flex-wrap gap-3">
          <Field label="Date">
            <Input
              type="date"
              value={toDateInput(schedule.at)}
              onChange={(e) => {
                const at = fromDateAndTime(
                  e.target.value,
                  toTimeInput(schedule.at),
                );
                if (at !== null) onChange({ kind: "once", at });
              }}
              className="h-8 w-40 font-mono text-xs"
              aria-label="Date, YYYY-MM-DD"
            />
          </Field>
          <Field label="Time">
            <Input
              type="time"
              value={toTimeInput(schedule.at)}
              onChange={(e) => {
                const at = fromDateAndTime(
                  toDateInput(schedule.at),
                  e.target.value,
                );
                if (at !== null) onChange({ kind: "once", at });
              }}
              className="h-8 w-28 font-mono text-xs"
              aria-label="Time of day, 24 hour HH:MM"
            />
          </Field>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        {isSchedule(schedule)
          ? scheduleLabel(schedule)
          : "This schedule is not valid yet."}
      </p>
    </div>
  );
}

export type TaskDraft = {
  name: string;
  prompt: string;
  cwd: string;
  schedule: Schedule;
  target: TaskTarget;
  mode: TaskMode;
  agent: TaskAgent;
  missed: MissedPolicy;
  overlap: OverlapPolicy;
  retries: number;
  thenDisable: boolean;
  maxRuns: string;
  sessionId: string;
  model: string;
  /** The model was typed rather than chosen, so the text field stays open. */
  customModel: boolean;
  provider: string;
  thinking: string;
};

/**
 * The draft a form starts from. Editing shows the task; creating starts from
 * the parameters the user chose last, because a second task is almost always a
 * variation of the first, and retyping the schedule, agent and policies every
 * time is the friction this removes. Content is never inherited.
 */
export function draftFrom(
  task: ScheduledTask | null,
  fallbackCwd: string,
  defaults: TaskDefaults | null = null,
): TaskDraft {
  if (!task) {
    const model = defaults?.model ?? "";
    const agent = defaults?.agent ?? DEFAULT_TASK_AGENT;
    return {
      name: "",
      prompt: "",
      cwd: fallbackCwd || (defaults?.cwd ?? ""),
      schedule: defaults?.schedule ?? defaultSchedule("everyN"),
      target: defaults?.target ?? "tab",
      mode: defaults?.mode ?? "task",
      agent,
      missed: defaults?.missed ?? "runOnce",
      overlap: defaults?.overlap ?? "queue",
      retries: defaults?.failure.retries ?? 2,
      thenDisable: defaults?.failure.thenDisable ?? true,
      maxRuns: "",
      sessionId: "",
      model,
      customModel: isCustomModel(agent, model),
      provider: defaults?.provider ?? "",
      thinking: defaults?.thinking ?? "",
    };
  }
  return {
    name: task.name,
    prompt: task.prompt,
    cwd: task.cwd,
    schedule: task.schedule,
    target: task.target,
    mode: task.mode,
    agent: task.agent,
    missed: task.missed,
    overlap: task.overlap,
    retries: task.failure.retries,
    thenDisable: task.failure.thenDisable,
    maxRuns: task.maxRuns === undefined ? "" : String(task.maxRuns),
    sessionId: task.sessions[0]?.id ?? "",
    model: task.model ?? "",
    customModel: isCustomModel(task.agent, task.model ?? ""),
    provider: task.provider ?? "",
    thinking: task.thinking ?? "",
  };
}

function isCustomModel(agent: TaskAgent, model: string): boolean {
  if (model.trim() === "") return false;
  return !agentModelPresets(agent).some((preset) => preset.value === model);
}

/** Keeps the model consistent with the agent: a preset that only means
 *  something to the previous CLI is dropped, a typed value is kept. */
export function retargetModel(
  draft: TaskDraft,
  agent: TaskAgent,
): Pick<TaskDraft, "agent" | "model" | "customModel"> {
  if (draft.customModel || draft.model.trim() === "") {
    return { agent, model: draft.model, customModel: draft.customModel };
  }
  const stillValid = agentModelPresets(agent).some(
    (preset) => preset.value === draft.model,
  );
  return {
    agent,
    model: stillValid ? draft.model : "",
    customModel: false,
  };
}

export function toTaskInput(draft: TaskDraft): TaskInput {
  const maxRuns = Number.parseInt(draft.maxRuns, 10);
  const trimmedSession = draft.sessionId.trim();
  return {
    name: draft.name,
    prompt: draft.prompt,
    cwd: draft.cwd.trim(),
    schedule: draft.schedule,
    target: draft.target,
    mode: draft.mode,
    agent: draft.agent,
    missed: draft.missed,
    overlap: draft.overlap,
    failure: { retries: draft.retries, thenDisable: draft.thenDisable },
    ...(Number.isFinite(maxRuns) && maxRuns > 0 ? { maxRuns } : {}),
    ...(trimmedSession
      ? { sessions: [{ id: trimmedSession, cwd: draft.cwd.trim() }] }
      : {}),
    ...(draft.model.trim() ? { model: draft.model.trim() } : {}),
    ...(draft.provider.trim() ? { provider: draft.provider.trim() } : {}),
    ...(draft.thinking.trim() ? { thinking: draft.thinking.trim() } : {}),
  };
}

export function TaskEditor({
  open,
  task,
  defaultCwd,
  defaults = null,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  /** Null opens the editor in create mode. */
  task: ScheduledTask | null;
  defaultCwd: string;
  /** Parameters a new task starts from. Ignored when editing. */
  defaults?: TaskDefaults | null;
  onSubmit: (input: TaskInput) => void;
  onCancel: () => void;
}) {
  const isEdit = task !== null;
  const [draft, setDraft] = useState<TaskDraft>(() =>
    draftFrom(task, defaultCwd, defaults),
  );
  const [acknowledged, setAcknowledged] = useState(false);
  const [seed, setSeed] = useState<string | null>(task?.id ?? null);

  // Re-seed when the dialog is pointed at a different task.
  const key = task?.id ?? "new";
  if (seed !== key && open) {
    setSeed(key);
    setDraft(draftFrom(task, defaultCwd, defaults));
    setAcknowledged(false);
  }

  const patch = useCallback(
    <K extends keyof TaskDraft>(field: K, value: TaskDraft[K]) => {
      setDraft((current) => ({ ...current, [field]: value }));
    },
    [],
  );

  const problems = useMemo(() => {
    const list: string[] = [];
    if (draft.name.trim() === "") list.push("Give the task a name.");
    if (draft.prompt.trim() === "") list.push("Write the prompt to send.");
    if (draft.cwd.trim() === "") list.push("Set a working directory.");
    if (!isSchedule(draft.schedule)) list.push("Fix the schedule.");
    return list;
  }, [draft]);

  const canSubmit = problems.length === 0 && (isEdit || acknowledged);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle className="text-sm">
            {isEdit ? "Edit scheduled task" : "New scheduled task"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Wakes an agent session with this prompt on the schedule below.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Field label="Name">
            <Input
              value={draft.name}
              onChange={(e) => patch("name", e.target.value)}
              placeholder="Watch CI"
              className="h-8 text-xs"
            />
          </Field>

          <Field
            label="Prompt"
            hint="Sent verbatim. Multiple lines are supported."
          >
            <Textarea
              value={draft.prompt}
              onChange={(e) => patch("prompt", e.target.value)}
              placeholder="Review the CI status and summarise any failures."
              rows={6}
              className="resize-y font-mono text-xs leading-relaxed"
            />
          </Field>

          <ScheduleBuilder
            schedule={draft.schedule}
            onChange={(next) => patch("schedule", next)}
          />

          <div className="grid grid-cols-2 gap-3">
            <Field label="Agent" hint={agentHint(draft.agent)}>
              <Select
                value={draft.agent}
                onValueChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    ...retargetModel(current, value as TaskAgent),
                  }))
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_AGENTS.map((agent) => (
                    <SelectItem key={agent} value={agent} className="text-xs">
                      {agentLabel(agent)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Model" hint="Inherit uses the agent's own default.">
              <Select
                value={
                  draft.customModel
                    ? MODEL_CUSTOM
                    : draft.model === ""
                      ? MODEL_INHERIT
                      : draft.model
                }
                onValueChange={(value) =>
                  setDraft((current) => {
                    if (value === MODEL_INHERIT) {
                      return { ...current, model: "", customModel: false };
                    }
                    if (value === MODEL_CUSTOM) {
                      return { ...current, customModel: true };
                    }
                    return { ...current, model: value, customModel: false };
                  })
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={MODEL_INHERIT} className="text-xs">
                    Inherit default
                  </SelectItem>
                  {agentModelPresets(draft.agent).map((preset) => (
                    <SelectItem
                      key={preset.value}
                      value={preset.value}
                      className="text-xs"
                    >
                      {preset.label}
                    </SelectItem>
                  ))}
                  <SelectItem value={MODEL_CUSTOM} className="text-xs">
                    Custom…
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          {draft.customModel && (
            <Field
              label="Custom model"
              hint="Passed verbatim to the agent command line."
            >
              <Input
                value={draft.model}
                onChange={(e) => patch("model", e.target.value)}
                placeholder="gpt-5.1-codex"
                className="h-8 font-mono text-xs"
              />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Run in">
              <Select
                value={draft.target}
                onValueChange={(value) => patch("target", value as TaskTarget)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tab" className="text-xs">
                    Terminal tab
                  </SelectItem>
                  <SelectItem value="headless" className="text-xs">
                    Headless
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Context" hint={modeDescription(draft.mode)}>
              <Select
                value={draft.mode}
                onValueChange={(value) => patch("mode", value as TaskMode)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="task" className="text-xs">
                    Task, accumulates context
                  </SelectItem>
                  <SelectItem value="routine" className="text-xs">
                    Routine, fresh session
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field
            label="Working directory"
            hint="Where pi runs. Defaults to the active tab's directory."
          >
            <Input
              value={draft.cwd}
              onChange={(e) => patch("cwd", e.target.value)}
              placeholder="/Users/you/project"
              className="h-8 font-mono text-xs"
            />
          </Field>

          <Field
            label="Session id"
            hint={sessionHint(draft.agent)}
          >
            <Input
              value={draft.sessionId}
              onChange={(e) => patch("sessionId", e.target.value)}
              placeholder="019fc4f0-9d22-71c6-a161-ec17c05eb692"
              className="h-8 font-mono text-xs"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="If runs were missed">
              <Select
                value={draft.missed}
                onValueChange={(value) => patch("missed", value as MissedPolicy)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MISSED_POLICIES.map((policy) => (
                    <SelectItem key={policy} value={policy} className="text-xs">
                      {missedPolicyLabel(policy)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="If still running">
              <Select
                value={draft.overlap}
                onValueChange={(value) =>
                  patch("overlap", value as OverlapPolicy)
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OVERLAP_POLICIES.map((policy) => (
                    <SelectItem key={policy} value={policy} className="text-xs">
                      {overlapPolicyLabel(policy)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Retries">
              <Input
                type="number"
                min={0}
                value={draft.retries}
                onChange={(e) =>
                  patch(
                    "retries",
                    Math.max(0, Number.parseInt(e.target.value, 10) || 0),
                  )
                }
                className="h-8 text-xs"
              />
            </Field>
            <Field label="Max runs" hint="Empty means unlimited.">
              <Input
                type="number"
                min={1}
                value={draft.maxRuns}
                onChange={(e) => patch("maxRuns", e.target.value)}
                placeholder="unlimited"
                className="h-8 text-xs"
              />
            </Field>
          </div>

          <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
            <Checkbox
              id="task-then-disable"
              checked={draft.thenDisable}
              onCheckedChange={(next) => patch("thenDisable", next === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor="task-then-disable"
              className="text-[11px] font-normal leading-snug text-muted-foreground"
            >
              Disable the task once the retries are spent.
            </Label>
          </div>

          {!isEdit && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-foreground">
              <Checkbox
                id="task-acknowledge"
                checked={acknowledged}
                onCheckedChange={(next) => setAcknowledged(next === true)}
                className="mt-0.5"
              />
              <Label
                htmlFor="task-acknowledge"
                className="text-[11px] font-normal leading-snug text-foreground"
              >
                I understand this runs {agentCapabilities(draft.agent).binary}{" "}
              unattended in{" "}
                <code className="font-mono">
                  {draft.cwd || "the chosen directory"}
                </code>{" "}
                and may edit files and run commands there.
              </Label>
            </div>
          )}

          {problems.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-[10px] text-red-600 dark:text-red-400">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!canSubmit}
            onClick={() => onSubmit(toTaskInput(draft))}
          >
            {isEdit ? "Save" : "Create task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
