import type { AgentHarness } from "@/modules/agents/lib/types";
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
  returned: "Returned",
  "turn-ended": "Turn complete",
} as const;

export type FlowKind = keyof typeof FLOW_LABELS;
export type TraceProvider = "claude" | "pi" | "codex" | "copilot" | "agy";
export type TraceEvent = {
  id: string;
  at: number;
  kind: FlowKind;
  text?: string;
  taskId?: string | null;
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
  tabTitle: string;
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
  parentId?: string;
  run?: FlowRun;
};

export function flowTasks(events: readonly TraceEvent[]): FlowTask[] {
  const tasks = new Map<string, FlowTask>();
  for (const event of events) {
    if (event.kind === "delegated") {
      const id = event.taskId ?? event.id;
      tasks.set(id, { id, label: event.text || "Subagent", at: event.at });
    } else if (event.kind === "returned" && event.taskId) {
      const task = tasks.get(event.taskId);
      if (task) task.returnedAt = event.at;
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

export type FlowDirection = "down" | "left";

export const CARD_WIDTH = 244;
export const CARD_HEIGHT = 132;
const GAP = 28;
const LEG = 78;
const INSET = 24;

export function placeLane(tasks: readonly FlowTask[], direction: FlowDirection) {
  const columns = new Map<string, number>();
  const layers: FlowTask[][] = [[]];
  for (const task of tasks) {
    const layer = (task.parentId ? columns.get(task.parentId) ?? 0 : 0) + 1;
    columns.set(task.id, layer);
    if (!layers[layer]) layers[layer] = [];
    layers[layer].push(task);
  }
  const depth = layers.length;
  const cross = Math.max(1, ...layers.map((layer) => layer.length));
  const crossStep = (direction === "down" ? CARD_WIDTH : CARD_HEIGHT) + GAP;
  const depthStep = (direction === "down" ? CARD_HEIGHT : CARD_WIDTH) + LEG;
  const positions = new Map<string, { x: number; y: number }>();
  for (let level = 1; level < depth; level++) {
    const layer = layers[level];
    for (const [index, task] of layer.entries()) {
      const axis = INSET + (index + (cross - layer.length) / 2) * crossStep;
      positions.set(task.id, direction === "down"
        ? { x: axis, y: INSET + level * depthStep }
        : { x: INSET + (depth - level - 1) * depthStep, y: axis });
    }
  }
  const rootCross = INSET + (cross - 1) * crossStep / 2;
  return {
    root: direction === "down"
      ? { x: rootCross, y: INSET }
      : { x: INSET + (depth - 1) * depthStep, y: rootCross },
    positions,
    width: CARD_WIDTH + INSET * 2 + (direction === "down" ? (cross - 1) * crossStep : (depth - 1) * depthStep),
    height: CARD_HEIGHT + INSET * 2 + (direction === "down" ? (depth - 1) * depthStep : (cross - 1) * crossStep),
  };
}
