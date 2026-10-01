import { isTabColor, type TabColor } from "@/modules/tabs";

import {
  DEFAULT_TASK_AGENT,
  isTaskAgent,
  newSessionSeed,
  type TaskAgent,
} from "./agents";
import { isSchedule, type Schedule } from "./recurrence";

/** A run is killed after this long. Matches the agreed operational limit. */
export const RUN_TIMEOUT_MS = 30 * 60_000;

export type TaskMode = "task" | "routine";
export type TaskTarget = "headless" | "tab";
export type MissedPolicy = "skip" | "runOnce" | "runAll" | "askOnResume";
export type OverlapPolicy = "queue" | "skip" | "parallel";

export const TASK_MODES: readonly TaskMode[] = ["task", "routine"];
export const TASK_TARGETS: readonly TaskTarget[] = ["headless", "tab"];
export const MISSED_POLICIES: readonly MissedPolicy[] = [
  "skip",
  "runOnce",
  "runAll",
  "askOnResume",
];
export const OVERLAP_POLICIES: readonly OverlapPolicy[] = [
  "queue",
  "skip",
  "parallel",
];

export type FailurePolicy = {
  retries: number;
  thenDisable: boolean;
};

export const DEFAULT_FAILURE_POLICY: FailurePolicy = {
  retries: 2,
  thenDisable: true,
};

/** A Pi session this task wakes. `cwd` is captured at creation so a resumed
 *  session lands in the directory it was created in. */
export type PiSessionRef = {
  id: string;
  cwd: string;
  label?: string;
};

export type ScheduledTask = {
  id: string;
  name: string;
  prompt: string;
  enabled: boolean;
  /** `task` accumulates context in a stable session; `routine` starts a fresh
   *  session per run. */
  mode: TaskMode;
  target: TaskTarget;
  /** Which agent CLI this task drives. */
  agent: TaskAgent;
  /** Names the session this task owns. Regenerating it is how a user asks for
   *  a clean slate without losing the task itself. Absent on tasks stored
   *  before seeds existed, which keep their legacy id-derived session. */
  seed?: string;
  schedule: Schedule;
  sessions: PiSessionRef[];
  tabId?: number;
  color?: TabColor;
  cwd: string;
  model?: string;
  provider?: string;
  thinking?: string;
  missed: MissedPolicy;
  overlap: OverlapPolicy;
  failure: FailurePolicy;
  /** Absent means unlimited. Never stored as 0. */
  maxRuns?: number;
  runCount: number;
  lastRunAt?: number;
  nextRunAt?: number | null;
  createdAt: number;
};

export type TaskInput = {
  name: string;
  prompt: string;
  cwd: string;
  schedule: Schedule;
  mode?: TaskMode;
  target?: TaskTarget;
  agent?: TaskAgent;
  seed?: string;
  sessions?: PiSessionRef[];
  tabId?: number;
  color?: TabColor;
  model?: string;
  provider?: string;
  thinking?: string;
  missed?: MissedPolicy;
  overlap?: OverlapPolicy;
  failure?: FailurePolicy;
  maxRuns?: number;
  enabled?: boolean;
};

let idCounter = 0;

export function newTaskId(): string {
  idCounter = (idCounter + 1) % 0xffff;
  return `st-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function optional<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : ({ [key]: value } as Record<string, T>);
}

export function createTask(input: TaskInput, now = Date.now()): ScheduledTask {
  const maxRuns =
    typeof input.maxRuns === "number" && input.maxRuns > 0
      ? Math.floor(input.maxRuns)
      : undefined;
  return {
    id: newTaskId(),
    name: input.name.trim(),
    prompt: input.prompt,
    enabled: input.enabled ?? true,
    mode: input.mode ?? "task",
    target: input.target ?? "tab",
    agent: input.agent ?? DEFAULT_TASK_AGENT,
    seed: input.seed ?? newSessionSeed(),
    schedule: input.schedule,
    sessions: input.sessions ? [...input.sessions] : [],
    cwd: input.cwd,
    missed: input.missed ?? "runOnce",
    overlap: input.overlap ?? "queue",
    failure: input.failure ?? DEFAULT_FAILURE_POLICY,
    runCount: 0,
    createdAt: now,
    ...optional("tabId", input.tabId),
    ...optional("color", input.color),
    ...optional("model", input.model),
    ...optional("provider", input.provider),
    ...optional("thinking", input.thinking),
    ...optional("maxRuns", maxRuns),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isSessionRef(value: unknown): value is PiSessionRef {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.cwd) &&
    isOptionalString(value.label)
  );
}

function isFailurePolicy(value: unknown): value is FailurePolicy {
  return (
    isRecord(value) &&
    isCount(value.retries) &&
    typeof value.thenDisable === "boolean"
  );
}

/** Hydration guard. Stored tasks are an untrusted boundary: a task that fails
 *  this check is dropped rather than trusted through a cast. */
export function isScheduledTask(value: unknown): value is ScheduledTask {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isNonEmptyString(value.name)) return false;
  if (!isNonEmptyString(value.prompt)) return false;
  if (!isNonEmptyString(value.cwd)) return false;
  if (typeof value.enabled !== "boolean") return false;
  if (!TASK_MODES.includes(value.mode as TaskMode)) return false;
  if (!TASK_TARGETS.includes(value.target as TaskTarget)) return false;
  if (!isTaskAgent(value.agent)) return false;
  if (value.seed !== undefined && !isNonEmptyString(value.seed)) return false;
  if (!MISSED_POLICIES.includes(value.missed as MissedPolicy)) return false;
  if (!OVERLAP_POLICIES.includes(value.overlap as OverlapPolicy)) return false;
  if (!isSchedule(value.schedule)) return false;
  if (!isFailurePolicy(value.failure)) return false;
  if (!Array.isArray(value.sessions) || !value.sessions.every(isSessionRef)) {
    return false;
  }
  if (!isCount(value.runCount)) return false;
  if (!isCount(value.createdAt)) return false;
  if (value.maxRuns !== undefined && !(isCount(value.maxRuns) && value.maxRuns > 0)) {
    return false;
  }
  if (value.tabId !== undefined && !isCount(value.tabId)) return false;
  if (value.color !== undefined && !isTabColor(value.color)) return false;
  if (value.lastRunAt !== undefined && !isCount(value.lastRunAt)) return false;
  if (
    value.nextRunAt !== undefined &&
    value.nextRunAt !== null &&
    !isCount(value.nextRunAt)
  ) {
    return false;
  }
  if (!isOptionalString(value.model)) return false;
  if (!isOptionalString(value.provider)) return false;
  if (!isOptionalString(value.thinking)) return false;
  return true;
}

export function remainingRuns(task: ScheduledTask): number {
  if (task.maxRuns === undefined) return Number.POSITIVE_INFINITY;
  return Math.max(0, task.maxRuns - task.runCount);
}

export function isExhausted(task: ScheduledTask): boolean {
  return remainingRuns(task) <= 0;
}
