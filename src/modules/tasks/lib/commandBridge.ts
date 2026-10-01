import type { TaskAgent } from "./agents";
import type { TaskPatch } from "./collection";
import { formatCountdown, scheduleLabel } from "./presentation";
import { aggregateTaskUsage, type TaskRun } from "./runs";
import { formatScheduleSpec, parseScheduleSpec } from "./spec";
import type { ScheduledTask, TaskInput } from "./task";

/** Shape the command registry hands over, already validated. */
export type TaskCommandInput = {
  name?: string;
  prompt?: string;
  schedule?: string;
  enabled?: boolean;
  cwd?: string;
  target?: ScheduledTask["target"];
  mode?: ScheduledTask["mode"];
  agent?: TaskAgent;
  missed?: ScheduledTask["missed"];
  overlap?: ScheduledTask["overlap"];
  sessionId?: string;
  model?: string;
  provider?: string;
  thinking?: string;
  maxRuns?: number;
  tabId?: number;
};

function shared(input: TaskCommandInput, cwd: string): Partial<TaskInput> {
  return {
    ...(input.target !== undefined ? { target: input.target } : {}),
    ...(input.mode !== undefined ? { mode: input.mode } : {}),
    ...(input.agent !== undefined ? { agent: input.agent } : {}),
    ...(input.missed !== undefined ? { missed: input.missed } : {}),
    ...(input.overlap !== undefined ? { overlap: input.overlap } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.provider !== undefined ? { provider: input.provider } : {}),
    ...(input.thinking !== undefined ? { thinking: input.thinking } : {}),
    ...(input.maxRuns !== undefined ? { maxRuns: input.maxRuns } : {}),
    ...(input.tabId !== undefined ? { tabId: input.tabId } : {}),
    ...(input.sessionId !== undefined
      ? { sessions: [{ id: input.sessionId, cwd }] }
      : {}),
  };
}

/**
 * Builds a task from a command payload. `fallbackCwd` is the active tab's
 * directory: a task created from a Pi session must inherit the directory that
 * session runs in, so the session can be resumed there.
 */
export function taskInputFromCommand(
  input: TaskCommandInput,
  fallbackCwd: string,
): TaskInput | { error: string } {
  if (!input.name || input.name.trim() === "") {
    return { error: "tasks.add requires a name" };
  }
  if (!input.prompt) return { error: "tasks.add requires a prompt" };
  const schedule = parseScheduleSpec(input.schedule ?? "");
  if (!schedule) return { error: "tasks.add requires a valid schedule spec" };
  const cwd = (input.cwd ?? fallbackCwd).trim();
  if (cwd === "") {
    return { error: "tasks.add needs a working directory and none could be inferred" };
  }
  return {
    name: input.name,
    prompt: input.prompt,
    cwd,
    schedule,
    ...shared(input, cwd),
  };
}

export function taskPatchFromCommand(
  input: TaskCommandInput,
  current: ScheduledTask,
): TaskPatch | { error: string } {
  const patch: TaskPatch = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.prompt !== undefined) patch.prompt = input.prompt;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.cwd !== undefined) patch.cwd = input.cwd.trim();
  if (input.schedule !== undefined) {
    const schedule = parseScheduleSpec(input.schedule);
    if (!schedule) return { error: "tasks.update requires a valid schedule spec" };
    patch.schedule = schedule;
  }
  const cwd = patch.cwd ?? current.cwd;
  const rest = shared(input, cwd);
  return { ...patch, ...rest };
}

export type TaskSummary = {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  scheduleLabel: string;
  enabled: boolean;
  mode: ScheduledTask["mode"];
  target: ScheduledTask["target"];
  agent: TaskAgent;
  model: string | null;
  missed: ScheduledTask["missed"];
  overlap: ScheduledTask["overlap"];
  cwd: string;
  sessions: string[];
  tabId: number | null;
  nextRunAt: number | null;
  nextRun: string;
  lastRunAt: number | null;
  runCount: number;
  maxRuns: number | null;
  totals: {
    runs: number;
    failures: number;
    durationMs: number;
    totalTokens: number;
    costTotal: number;
  };
  lastRun: {
    status: TaskRun["status"];
    startedAt: number;
    endedAt: number | null;
    sessionId: string;
    exitCode: number | null;
    message: string | null;
    totalTokens: number | null;
    costTotal: number | null;
  } | null;
};

/**
 * Full task view for `tasks.list`. Unlike the app snapshot this deliberately
 * includes the prompt, because listing is an explicit request rather than
 * ambient coordination state.
 */
export function taskSummary(
  task: ScheduledTask,
  runs: readonly TaskRun[],
  now: number,
): TaskSummary {
  const totals = aggregateTaskUsage(runs);
  const last = runs[0];
  return {
    id: task.id,
    name: task.name,
    prompt: task.prompt,
    schedule: formatScheduleSpec(task.schedule),
    scheduleLabel: scheduleLabel(task.schedule),
    enabled: task.enabled,
    mode: task.mode,
    target: task.target,
    agent: task.agent,
    model: task.model ?? null,
    missed: task.missed,
    overlap: task.overlap,
    cwd: task.cwd,
    sessions: task.sessions.map((session) => session.id),
    tabId: task.tabId ?? null,
    nextRunAt: task.nextRunAt ?? null,
    nextRun: formatCountdown(task.nextRunAt, now),
    lastRunAt: task.lastRunAt ?? null,
    runCount: task.runCount,
    maxRuns: task.maxRuns ?? null,
    totals: {
      runs: totals.runs,
      failures: totals.failures,
      durationMs: totals.durationMs,
      totalTokens: totals.usage.totalTokens,
      costTotal: totals.usage.costTotal,
    },
    lastRun: last
      ? {
          status: last.status,
          startedAt: last.startedAt,
          endedAt: last.endedAt ?? null,
          sessionId: last.sessionId,
          exitCode: last.exitCode ?? null,
          message: last.message ?? null,
          totalTokens: last.usage?.totalTokens ?? null,
          costTotal: last.usage?.costTotal ?? null,
        }
      : null,
  };
}
