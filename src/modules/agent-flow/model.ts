import type { AgentHarness, DigestTaskKind } from "@/modules/agents/lib/types";
import type { TabColor } from "@/modules/tabs/lib/tabColors";

export const FLOW_LABELS = {
  started: "Session started",
  working: "Working",
  attention: "Needs input",
  notification: "Terminal alert",
  finished: "Turn complete",
  subagent: "Subagent reported back",
  exited: "Process exited",
  error: "Error",
  user: "User message",
  reply: "Agent reply",
  tool: "Tool call",
  delegated: "Delegated",
  "monitor-started": "Monitor started",
  "background-started": "Background job started",
  "loop-started": "Loop scheduled",
  "task-activity": "Task activity",
  "task-alias": "Task reference",
  returned: "Returned",
  delivery: "Terminal input",
  "turn-ended": "Turn complete",
  usage: "Token usage",
} as const;

export type FlowKind = keyof typeof FLOW_LABELS;
export const PROCESS_LABELS = { monitor: "Monitor", background: "Background job", loop: "Loop" } as const;
export type ProcessKind = Exclude<DigestTaskKind, "subagent">;
const PROCESS_START = { monitor: "monitor-started", background: "background-started", loop: "loop-started" } as const;
export type TraceProvider = "claude" | "pi" | "codex" | "copilot" | "agy";
export type TraceEvent = {
  id: string;
  at: number;
  kind: FlowKind;
  text?: string;
  taskId?: string | null;
  file?: string | null;
  usage?: {
    tokens: number;
    cumulative: boolean;
    key?: string | null;
    cost?: number | null;
    context?: { input: number; window: number };
  } | null;
};
export type Trace = {
  events: TraceEvent[];
  name: string | null;
  nextOffset: number;
  reset: boolean;
  limited: boolean;
};
export type HistorySession = {
  id: string;
  provider: TraceProvider;
  cwd: string;
  modifiedAt: number;
  createdAt?: number | null;
  parentId?: string | null;
  name?: string | null;
};
export type FlowRun = {
  key: string;
  group: string;
  shellKey?: string;
  tabTitle: string;
  paneLabel?: string;
  marker?: "shell" | "terax" | "background";
  color?: TabColor;
  startedAt: number;
  createdAt?: number;
  parentId?: string;
  harness: AgentHarness;
  agent: string;
  name?: string;
  sessionId?: string;
  cwd?: string;
  leafId?: number;
  tabId?: number;
  events: TraceEvent[];
  active?: boolean;
  projectHistory?: boolean;
};

export type FlowEndpoint = { shellKey: string; runKey?: string };

export type FlowDelivery = {
  id: string;
  at: number;
  submitted: boolean;
  source?: FlowEndpoint;
  target: FlowEndpoint;
};

export function isTraceProvider(harness: AgentHarness): harness is TraceProvider {
  return harness === "claude" || harness === "pi" || harness === "codex" || harness === "copilot" || harness === "agy";
}

export function beforeTime<T extends { at: number }>(events: readonly T[], time: number | null): T[] {
  return time === null ? [...events] : events.filter((event) => event.at <= time);
}

export type FlowTask = {
  id: string;
  label: string;
  at: number;
  returnedAt?: number;
  failed?: boolean;
  parentId?: string;
  run?: FlowRun;
  running?: boolean;
  process?: {
    kind: ProcessKind;
    state?: "running" | "listening" | "scheduled" | "paused";
    lastActivityAt?: number;
    cadence?: string;
  };
};

export function taskStartKind(task: FlowTask): FlowKind {
  return task.process ? PROCESS_START[task.process.kind] : "delegated";
}

export function flowTasks(events: readonly TraceEvent[]): FlowTask[] {
  const tasks = new Map<string, FlowTask>();
  for (const event of events) {
    if (event.kind === "delegated" || event.kind === "monitor-started" || event.kind === "background-started") {
      const id = event.taskId ?? event.id;
      const kind = event.kind === "monitor-started" ? "monitor" : event.kind === "background-started" ? "background" : undefined;
      tasks.set(id, { id, label: event.text || (kind ? PROCESS_LABELS[kind] : "Subagent"), at: event.at,
        ...(kind && { process: { kind } }) });
    } else if (event.kind === "task-activity" && event.taskId) {
      const process = tasks.get(event.taskId)?.process;
      if (process) process.lastActivityAt = event.at;
    } else if ((event.kind === "returned" || event.kind === "error") && event.taskId) {
      const task = tasks.get(event.taskId);
      if (task) {
        task.returnedAt = event.at;
        if (event.kind === "error") task.failed = true;
      }
    }
  }
  return [...tasks.values()];
}

export function historyRun(session: HistorySession, tabTitle: string): FlowRun {
  return {
    key: `history:${session.provider}:${session.id}`,
    group: `project:${session.cwd}`,
    tabTitle,
    agent: session.provider,
    harness: session.provider,
    cwd: session.cwd,
    sessionId: session.id,
    startedAt: session.modifiedAt,
    ...(session.createdAt ? { createdAt: session.createdAt } : {}),
    ...(session.parentId ? { parentId: session.parentId } : {}),
    ...(session.name ? { name: session.name } : {}),
    projectHistory: true,
    events: [],
  };
}

export function mergeRuns(journal: readonly FlowRun[], history: readonly FlowRun[]): FlowRun[] {
  const known = new Set(journal.filter((run) => run.sessionId).map((run) => `${run.harness}:${run.sessionId}`));
  const historyIds = new Set(history.map((run) => `${run.harness}:${run.sessionId}`));
  return [...journal, ...history.filter((run) =>
    !known.has(`${run.harness}:${run.sessionId}`) &&
    (!run.parentId || (!known.has(`${run.harness}:${run.parentId}`) && !historyIds.has(`${run.harness}:${run.parentId}`))),
  )]
    .sort((a, b) => a.startedAt - b.startedAt || a.key.localeCompare(b.key));
}

export function sessionFamily(run: FlowRun | undefined, history: readonly FlowRun[]): FlowTask[] {
  if (!run?.sessionId || run.harness !== "codex") return [];
  const root = run.sessionId;
  const parents = new Map<string, FlowRun[]>();
  for (const child of history) {
    if (child.harness !== run.harness || !child.parentId || !child.sessionId) continue;
    const siblings = parents.get(child.parentId) ?? [];
    siblings.push(child);
    parents.set(child.parentId, siblings);
  }
  const seen = new Set([root]);
  const queue = [root];
  const result: FlowTask[] = [];
  for (const parent of queue) {
    for (const child of parents.get(parent) ?? []) {
      if (!child.sessionId || seen.has(child.sessionId)) continue;
      seen.add(child.sessionId);
      queue.push(child.sessionId);
      result.push({
        id: child.sessionId,
        label: child.name || "Subagent",
        at: child.createdAt ?? child.startedAt,
        parentId: parent === root ? undefined : parent,
        run: child,
      });
    }
  }
  return result;
}

export type FlowDirection = "down" | "right";
