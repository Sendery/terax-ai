import { agentLabel } from "./agents";
import type { Schedule, Weekday } from "./recurrence";
import {
  isExhausted,
  type MissedPolicy,
  type OverlapPolicy,
  type ScheduledTask,
  type TaskMode,
  type TaskTarget,
} from "./task";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5];
const WEEKEND: readonly Weekday[] = [0, 6];

function sameDays(days: readonly Weekday[], other: readonly Weekday[]): boolean {
  if (days.length !== other.length) return false;
  const set = new Set(days);
  return other.every((day) => set.has(day));
}

function intervalLabel(minutes: number): string {
  if (minutes === 1) return "Every minute";
  if (minutes < 60) return `Every ${minutes} min`;
  if (minutes === 60) return "Every hour";
  if (minutes === 1440) return "Every day";
  if (minutes % 60 === 0) return `Every ${minutes / 60} h`;
  return `Every ${minutes} min`;
}

export function scheduleLabel(schedule: Schedule): string {
  switch (schedule.kind) {
    case "manual":
      return "Manual only";
    case "once":
      return `Once at ${new Date(schedule.at).toLocaleString()}`;
    case "everyN":
      return intervalLabel(schedule.minutes);
    case "weekly": {
      const days = [...schedule.days].sort((a, b) => a - b);
      if (sameDays(days, WEEKDAYS)) return `Weekdays at ${schedule.time}`;
      if (sameDays(days, WEEKEND)) return `Weekends at ${schedule.time}`;
      if (days.length === 7) return `Daily at ${schedule.time}`;
      return `${days.map((day) => DAY_NAMES[day]).join(", ")} at ${schedule.time}`;
    }
    case "everyNDays":
      return schedule.days === 1
        ? `Daily at ${schedule.time}`
        : `Every ${schedule.days} days at ${schedule.time}`;
    case "dates": {
      const count = schedule.dates.length;
      return `${count} ${count === 1 ? "date" : "dates"} at ${schedule.time}`;
    }
  }
}

export function formatCountdown(
  nextRunAt: number | null | undefined,
  now: number,
): string {
  if (nextRunAt === null || nextRunAt === undefined) return "not scheduled";
  const delta = nextRunAt - now;
  if (delta <= 0) return "due now";
  const seconds = Math.round(delta / 1_000);
  if (seconds < 60) return `in ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `in ${hours}h` : `in ${hours}h ${rest}m`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `in ${days}d` : `in ${days}d ${restHours}h`;
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  if (ms < 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = seconds % 60;
    return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatTokens(total: number): string {
  if (total < 1_000) return String(Math.max(0, Math.round(total)));
  if (total < 1_000_000) return `${(total / 1_000).toFixed(1)}k`;
  return `${(total / 1_000_000).toFixed(1)}M`;
}

export function formatCost(total: number): string {
  if (total <= 0) return "$0.00";
  if (total < 0.01) return "<$0.01";
  return `$${total.toFixed(2)}`;
}

export function modeLabel(mode: TaskMode): string {
  return mode === "task" ? "Task" : "Routine";
}

export function targetLabel(target: TaskTarget): string {
  return target === "tab" ? "Terminal tab" : "Headless";
}

export function missedPolicyLabel(policy: MissedPolicy): string {
  switch (policy) {
    case "skip":
      return "Skip missed";
    case "runOnce":
      return "Recover once";
    case "runAll":
      return "Recover all";
    case "askOnResume":
      return "Ask on resume";
  }
}

export function overlapPolicyLabel(policy: OverlapPolicy): string {
  switch (policy) {
    case "queue":
      return "Queue next";
    case "skip":
      return "Skip while running";
    case "parallel":
      return "Allow parallel";
  }
}

export function modeDescription(mode: TaskMode): string {
  return mode === "task"
    ? "Reuses one Pi session so context accumulates across runs."
    : "Starts a fresh Pi session for every run, with no prior context.";
}

/**
 * Single accessible label for a task card. The parent label replaces descendant
 * announcements, so every state a sighted user can see must appear here.
 */
export function taskAccessibleLabel(
  task: ScheduledTask,
  now: number,
  state: { running?: boolean; queued?: boolean } = {},
): string {
  const parts = [
    task.name,
    scheduleLabel(task.schedule),
    agentLabel(task.agent),
    task.enabled ? "enabled" : "disabled",
  ];
  if (isExhausted(task)) parts.push("run budget spent");
  if (state.running) parts.push("running now");
  else if (state.queued) parts.push("queued");
  parts.push(formatCountdown(task.nextRunAt, now));
  return parts.join(", ");
}
