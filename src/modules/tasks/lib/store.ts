import { LazyStore } from "@tauri-apps/plugin-store";

import { isTaskRun, type TaskRun } from "./runs";
import { isScheduledTask, type ScheduledTask } from "./task";

export const TASKS_STORE_PATH = "terax-scheduled-tasks.json";

export const KEY_TASKS = "tasks";
export const KEY_RUNS = "runs";
export const KEY_PAUSED = "paused";

export type RunHistory = Record<string, TaskRun[]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Stored tasks are untrusted. An invalid entry is dropped so one bad record
 *  cannot take the whole panel down on boot. */
export function parseStoredTasks(value: unknown): ScheduledTask[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tasks: ScheduledTask[] = [];
  for (const entry of value) {
    if (!isScheduledTask(entry)) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    tasks.push(entry);
  }
  return tasks;
}

export function parseStoredRuns(value: unknown): RunHistory {
  if (!isRecord(value)) return {};
  const history: RunHistory = {};
  for (const [taskId, bucket] of Object.entries(value)) {
    if (!Array.isArray(bucket)) continue;
    const runs = bucket.filter(
      (entry): entry is TaskRun => isTaskRun(entry) && entry.taskId === taskId,
    );
    if (runs.length > 0) history[taskId] = runs;
  }
  return history;
}

export function parseStoredPaused(value: unknown): boolean {
  return value === true;
}

export function toStoredTasks(tasks: readonly ScheduledTask[]): unknown {
  return tasks.map((task) => ({ ...task }));
}

export function toStoredRuns(history: RunHistory): unknown {
  return Object.fromEntries(
    Object.entries(history).map(([taskId, runs]) => [
      taskId,
      runs.map((run) => ({ ...run })),
    ]),
  );
}

const store = new LazyStore(TASKS_STORE_PATH, { defaults: {}, autoSave: 200 });

export type PersistedTasksState = {
  tasks: ScheduledTask[];
  runs: RunHistory;
  paused: boolean;
};

/** One `entries()` read instead of three plugin round-trips on boot. */
export async function hydrateTasksState(): Promise<PersistedTasksState> {
  try {
    const entries = await store.entries();
    const map = new Map(entries);
    return {
      tasks: parseStoredTasks(map.get(KEY_TASKS)),
      runs: parseStoredRuns(map.get(KEY_RUNS)),
      paused: parseStoredPaused(map.get(KEY_PAUSED)),
    };
  } catch {
    return { tasks: [], runs: {}, paused: false };
  }
}

async function write(key: string, value: unknown): Promise<void> {
  try {
    await store.set(key, value);
    await store.save();
  } catch {
    // A failed write must never break the panel; the next write retries.
  }
}

export function persistTasks(tasks: readonly ScheduledTask[]): Promise<void> {
  return write(KEY_TASKS, toStoredTasks(tasks));
}

export function persistRuns(history: RunHistory): Promise<void> {
  return write(KEY_RUNS, toStoredRuns(history));
}

export function persistPaused(paused: boolean): Promise<void> {
  return write(KEY_PAUSED, paused);
}
