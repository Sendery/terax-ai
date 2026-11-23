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
export type TraceProvider = "claude" | "pi" | "codex" | "copilot";
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
  pending: boolean;
};
export type HistorySession = {
  id: string;
  provider: TraceProvider;
  cwd: string;
  modifiedAt: number;
  createdAt?: number | null;
};
export type FlowRun = {
  key: string;
  group: string;
  tabTitle: string;
  color?: TabColor;
  startedAt: number;
  createdAt?: number;
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
  return harness === "claude" || harness === "pi" || harness === "codex" || harness === "copilot";
}

export function beforeTime<T extends { at: number }>(events: readonly T[], time: number | null): T[] {
  return time === null ? [...events] : events.filter((event) => event.at <= time);
}

export function flowTasks(events: readonly TraceEvent[]) {
  const tasks = new Map<string, { id: string; label: string; at: number; returnedAt?: number }>();
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
    projectHistory: true,
    events: [],
  };
}

export function mergeRuns(journal: readonly FlowRun[], history: readonly FlowRun[]): FlowRun[] {
  const known = new Set(journal.filter((run) => run.sessionId).map((run) => `${run.harness}:${run.sessionId}`));
  return [...journal, ...history.filter((run) => !known.has(`${run.harness}:${run.sessionId}`))]
    .sort((a, b) => a.startedAt - b.startedAt || a.key.localeCompare(b.key));
}

export type FlowDirection = "down" | "left";

export const CARD_WIDTH = 244;
export const CARD_HEIGHT = 132;
const GAP = 28;
const LEG = 78;
const INSET = 24;

export function placeLane(children: number, direction: FlowDirection) {
  const depth = children ? 2 : 1;
  const cross = Math.max(children, 1);
  const crossStep = (direction === "down" ? CARD_WIDTH : CARD_HEIGHT) + GAP;
  const depthStep = (direction === "down" ? CARD_HEIGHT : CARD_WIDTH) + LEG;
  const positions = Array.from({ length: children }, (_, i) =>
    direction === "down"
      ? { x: INSET + i * crossStep, y: INSET + depthStep }
      : { x: INSET, y: INSET + i * crossStep },
  );
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
