import { isTaskAgent, type TaskAgent } from "./agents";

/** Retained run history per task. Conversation content is never stored here:
 *  it stays in the Pi session file, reachable through the recover action. */
export const MAX_RUNS_PER_TASK = 50;

export type RunStatus = "running" | "ok" | "failed" | "timeout" | "skipped";
export type RunTrigger = "schedule" | "manual" | "recovery" | "external";

export const RUN_STATUSES: readonly RunStatus[] = [
  "running",
  "ok",
  "failed",
  "timeout",
  "skipped",
];
export const RUN_TRIGGERS: readonly RunTrigger[] = [
  "schedule",
  "manual",
  "recovery",
  "external",
];

/** Accounting for one trigger, read back from the Pi session file. */
export type RunUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  totalTokens: number;
  costTotal: number;
};

export type TaskRun = {
  id: string;
  taskId: string;
  sessionId: string;
  /** Agent CLI this run drove. Absent on runs recorded before agents existed,
   *  which were always pi. */
  agent?: TaskAgent;
  /** Session file backing the recover action. */
  sessionFile?: string;
  cwd: string;
  trigger: RunTrigger;
  attempt: number;
  startedAt: number;
  endedAt?: number;
  status: RunStatus;
  exitCode?: number;
  stopReason?: string;
  model?: string;
  usage?: RunUsage;
  /** Human readable outcome, sized for a card and for debugging a failure. */
  message?: string;
};

export type RunSeed = {
  taskId: string;
  sessionId: string;
  cwd: string;
  trigger: RunTrigger;
  attempt: number;
  agent?: TaskAgent;
  sessionFile?: string;
};

export type RunOutcome = {
  status: Exclude<RunStatus, "running">;
  endedAt: number;
  exitCode?: number;
  stopReason?: string;
  model?: string;
  usage?: RunUsage;
  message?: string;
  sessionFile?: string;
};

export type TaskTotals = {
  runs: number;
  failures: number;
  durationMs: number;
  usage: RunUsage;
};

let idCounter = 0;

function newRunId(): string {
  idCounter = (idCounter + 1) % 0xffff;
  return `tr-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function emptyUsage(): RunUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    totalTokens: 0,
    costTotal: 0,
  };
}

function optional<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : ({ [key]: value } as Record<string, T>);
}

export function newRun(seed: RunSeed, now = Date.now()): TaskRun {
  return {
    id: newRunId(),
    taskId: seed.taskId,
    sessionId: seed.sessionId,
    cwd: seed.cwd,
    trigger: seed.trigger,
    attempt: seed.attempt,
    startedAt: now,
    status: "running",
    ...optional("agent", seed.agent),
    ...optional("sessionFile", seed.sessionFile),
  };
}

export function finishRun(run: TaskRun, outcome: RunOutcome): TaskRun {
  return {
    ...run,
    status: outcome.status,
    endedAt: outcome.endedAt,
    ...optional("exitCode", outcome.exitCode),
    ...optional("stopReason", outcome.stopReason),
    ...optional("model", outcome.model),
    ...optional("usage", outcome.usage),
    ...optional("message", outcome.message),
    ...optional("sessionFile", outcome.sessionFile ?? run.sessionFile),
  };
}

export function runDurationMs(run: TaskRun): number {
  if (run.endedAt === undefined) return 0;
  return Math.max(0, run.endedAt - run.startedAt);
}

/** Newest first, bounded, and idempotent for an updated run. */
export function appendRun(
  history: readonly TaskRun[],
  run: TaskRun,
): readonly TaskRun[] {
  const without = history.filter((entry) => entry.id !== run.id);
  return [run, ...without].slice(0, MAX_RUNS_PER_TASK);
}

export function aggregateTaskUsage(runs: readonly TaskRun[]): TaskTotals {
  const usage = emptyUsage();
  let durationMs = 0;
  let failures = 0;
  for (const run of runs) {
    durationMs += runDurationMs(run);
    if (run.status === "failed" || run.status === "timeout") failures += 1;
    if (!run.usage) continue;
    usage.input += run.usage.input;
    usage.output += run.usage.output;
    usage.cacheRead += run.usage.cacheRead;
    usage.cacheWrite += run.usage.cacheWrite;
    usage.reasoning += run.usage.reasoning;
    usage.totalTokens += run.usage.totalTokens;
    usage.costTotal += run.usage.costTotal;
  }
  return { runs: runs.length, failures, durationMs, usage };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isUsage(value: unknown): value is RunUsage {
  return (
    isRecord(value) &&
    isFiniteNumber(value.input) &&
    isFiniteNumber(value.output) &&
    isFiniteNumber(value.cacheRead) &&
    isFiniteNumber(value.cacheWrite) &&
    isFiniteNumber(value.reasoning) &&
    isFiniteNumber(value.totalTokens) &&
    isFiniteNumber(value.costTotal)
  );
}

export function isTaskRun(value: unknown): value is TaskRun {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isNonEmptyString(value.taskId)) return false;
  if (!isNonEmptyString(value.sessionId)) return false;
  if (!isNonEmptyString(value.cwd)) return false;
  if (!RUN_STATUSES.includes(value.status as RunStatus)) return false;
  if (!RUN_TRIGGERS.includes(value.trigger as RunTrigger)) return false;
  if (!isCount(value.startedAt)) return false;
  if (!(isCount(value.attempt) && value.attempt >= 1)) return false;
  if (value.endedAt !== undefined && !isCount(value.endedAt)) return false;
  if (value.usage !== undefined && !isUsage(value.usage)) return false;
  if (value.exitCode !== undefined && !Number.isInteger(value.exitCode)) {
    return false;
  }
  if (value.agent !== undefined && !isTaskAgent(value.agent)) return false;
  for (const key of ["sessionFile", "stopReason", "model", "message"]) {
    const field = value[key];
    if (field !== undefined && typeof field !== "string") return false;
  }
  return true;
}
