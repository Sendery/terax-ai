import { nextOccurrence } from "./recurrence";
import {
  isExhausted,
  MISSED_POLICIES,
  type MissedPolicy,
  type ScheduledTask,
} from "./task";

/** Fields a patch may never rewrite. */
type Immutable = "id" | "createdAt";

export type TaskPatch = Partial<Omit<ScheduledTask, Immutable>>;

export function upsertTask(
  tasks: readonly ScheduledTask[],
  task: ScheduledTask,
): ScheduledTask[] {
  const index = tasks.findIndex((entry) => entry.id === task.id);
  if (index === -1) return [...tasks, task];
  const next = [...tasks];
  next[index] = task;
  return next;
}

export function removeTask(
  tasks: readonly ScheduledTask[],
  id: string,
): ScheduledTask[] {
  return tasks.filter((task) => task.id !== id);
}

export function updateTask(
  tasks: readonly ScheduledTask[],
  id: string,
  patch: TaskPatch,
): ScheduledTask[] {
  return tasks.map((task) => {
    if (task.id !== id) return task;
    const { id: _id, createdAt: _createdAt, ...safe } = patch as TaskPatch & {
      id?: string;
      createdAt?: number;
    };
    const merged: ScheduledTask = { ...task, ...safe };
    if ("maxRuns" in safe) {
      const value = safe.maxRuns;
      if (typeof value !== "number" || value <= 0) delete merged.maxRuns;
      else merged.maxRuns = Math.floor(value);
    }
    return merged;
  });
}

/** Recomputes `nextRunAt`. Null means nothing pending: disabled, manual, or the
 *  run budget is spent. */
export function reschedule(task: ScheduledTask, now: number): ScheduledTask {
  if (!task.enabled || isExhausted(task)) {
    return { ...task, nextRunAt: null };
  }
  const next = nextOccurrence(task.schedule, {
    now,
    lastRunAt: task.lastRunAt,
    runCount: task.runCount,
    maxRuns: task.maxRuns,
  });
  return { ...task, nextRunAt: next };
}

export function setTaskEnabled(
  tasks: readonly ScheduledTask[],
  id: string,
  enabled: boolean,
  now: number,
): ScheduledTask[] {
  return tasks.map((task) =>
    task.id === id ? reschedule({ ...task, enabled }, now) : task,
  );
}

export function sortTasksByNextRun(
  tasks: readonly ScheduledTask[],
): ScheduledTask[] {
  return [...tasks].sort((a, b) => {
    const left = a.nextRunAt ?? Number.POSITIVE_INFINITY;
    const right = b.nextRunAt ?? Number.POSITIVE_INFINITY;
    if (left !== right) return left - right;
    return a.name.localeCompare(b.name);
  });
}

export function moveTask(
  tasks: readonly ScheduledTask[],
  id: string,
  toIndex: number,
): ScheduledTask[] {
  const from = tasks.findIndex((task) => task.id === id);
  if (from === -1) return [...tasks];
  const next = [...tasks];
  const [moved] = next.splice(from, 1);
  const target = Math.max(0, Math.min(toIndex, next.length));
  next.splice(target, 0, moved);
  return next;
}

export type MissedGroup = {
  policy: MissedPolicy;
  tasks: ScheduledTask[];
};

/** Panel grouping axis: the downtime recovery policy, in a fixed order so the
 *  list never reshuffles between renders. */
export function applyMissedGrouping(
  tasks: readonly ScheduledTask[],
): MissedGroup[] {
  const order: readonly MissedPolicy[] = [
    "runOnce",
    "skip",
    "runAll",
    "askOnResume",
  ];
  return order
    .filter((policy) => MISSED_POLICIES.includes(policy))
    .map((policy) => ({
      policy,
      tasks: sortTasksByNextRun(tasks.filter((task) => task.missed === policy)),
    }));
}
