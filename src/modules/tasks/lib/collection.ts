import { newSessionSeed, type TaskAgent } from "./agents";
import { nextOccurrence, type Schedule } from "./recurrence";
import {
  type FailurePolicy,
  isExhausted,
  MISSED_POLICIES,
  type MissedPolicy,
  newTaskId,
  type OverlapPolicy,
  type ScheduledTask,
  type TaskMode,
  type TaskTarget,
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

function copyName(name: string, taken: readonly string[]): string {
  const first = `${name} (copy)`;
  if (!taken.includes(first)) return first;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${name} (copy ${index})`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${name} (copy ${Date.now()})`;
}

/**
 * A new task carrying the same configuration, ready to be edited. Everything
 * that identifies the original is dropped: its id, its run history, the session
 * it accumulated and the tab it owns. The copy lands disabled because it is
 * created to be edited, and an enabled copy of a frequent schedule would fire
 * while the editor is still open.
 */
export function cloneTask(
  task: ScheduledTask,
  now: number,
  existing: readonly ScheduledTask[] = [],
): ScheduledTask {
  const { tabId: _tabId, lastRunAt: _lastRunAt, ...rest } = task;
  return {
    ...rest,
    id: newTaskId(),
    name: copyName(task.name, existing.map((entry) => entry.name)),
    enabled: false,
    seed: newSessionSeed(),
    sessions: [],
    runCount: 0,
    nextRunAt: null,
    createdAt: now,
  };
}

/**
 * Points the task at a brand new session. The pinned session is dropped along
 * with the seed: keeping it would send the next run straight back into the
 * conversation the user just asked to leave behind.
 */
export function regenerateSeed(task: ScheduledTask): ScheduledTask {
  return { ...task, seed: newSessionSeed(), sessions: [] };
}

/** Settings a new task inherits from the last one the user created. */
export type TaskDefaults = {
  schedule: Schedule;
  target: TaskTarget;
  mode: TaskMode;
  agent: TaskAgent;
  model: string | undefined;
  provider: string | undefined;
  thinking: string | undefined;
  missed: MissedPolicy;
  overlap: OverlapPolicy;
  failure: FailurePolicy;
  cwd: string;
};

/**
 * Parameters the next new task should start from: the ones the user most
 * recently chose. Content is deliberately excluded — a prompt, a name and a
 * session belong to one task, while the schedule and the agent describe how
 * this user works.
 */
export function recentTaskDefaults(
  tasks: readonly ScheduledTask[],
): TaskDefaults | null {
  let recent: ScheduledTask | null = null;
  for (const task of tasks) {
    if (recent === null || task.createdAt > recent.createdAt) recent = task;
  }
  if (recent === null) return null;
  return {
    schedule: recent.schedule,
    target: recent.target,
    mode: recent.mode,
    agent: recent.agent,
    model: recent.model,
    provider: recent.provider,
    thinking: recent.thinking,
    missed: recent.missed,
    overlap: recent.overlap,
    failure: recent.failure,
    cwd: recent.cwd,
  };
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
