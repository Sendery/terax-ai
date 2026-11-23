import type { SessionDigest } from "@/modules/agents/lib/types";
import {
  beforeTime, FLOW_LABELS, flowTasks, sessionFamily,
  type FlowDirection, type FlowKind, type FlowRun, type FlowTask, type TraceEvent,
} from "@/modules/agent-flow/model";
import { traceKey, type FlowTrace } from "@/modules/agent-flow/traceReader";

export const NODE_WIDTH = 326;
export const NODE_HEIGHT = 156;
const NODE_ANCHOR = { x: 47, y: 55 };
const SLOT_X = NODE_WIDTH + 26;
const SLOT_Y = NODE_HEIGHT + 38;
const GUTTER = 46;
const CLUSTER_PAD = 18;
const CLUSTER_HEADER = 31;

export type Point = { x: number; y: number };
export type Box = Point & { width: number; height: number };
export type FlowArrangement = "fit" | "lanes";

export type FlowSelection = { run: string; task?: string; event?: string };

export type FlowBranch = {
  run: FlowRun;
  events: readonly TraceEvent[];
  trace: FlowTrace | undefined;
  digest: SessionDigest | undefined;
  tasks: FlowTask[];
  start: number;
};

export type Actor = {
  label: string;
  tone: "active" | "waiting" | "complete" | "error" | "idle";
  speech: TraceEvent | undefined;
  activity: TraceEvent | undefined;
  tools: TraceEvent[];
  signals: TraceEvent[];
  usage: { tokens: number; cost: number | undefined; context?: { input: number; window: number } } | undefined;
};

export type SignalTone = "message" | "tool" | "branch" | "return" | "attention" | "state";

export function signalTone(kind: FlowKind): SignalTone {
  if (kind === "reply" || kind === "user") return "message";
  if (kind === "tool") return "tool";
  if (kind === "delegated" || kind === "subagent" || kind === "delivery") return "branch";
  if (kind === "returned" || kind === "finished" || kind === "turn-ended") return "return";
  if (kind === "attention" || kind === "notification" || kind === "error") return "attention";
  return "state";
}

export function signalEvents(events: readonly TraceEvent[], limit = 12): TraceEvent[] {
  const result: TraceEvent[] = [];
  for (let index = events.length - 1; index >= 0 && result.length < limit; index--) {
    const event = events[index];
    if (event.kind !== "usage" && event.kind !== "working") result.push(event);
  }
  return result.reverse();
}

export function contextPercent(context: NonNullable<NonNullable<Actor["usage"]>["context"]>): number {
  return Math.round(Math.max(0, Math.min(1, context.input / context.window)) * 100);
}

export function eventStream(run: FlowRun, trace: FlowTrace | undefined): TraceEvent[] {
  return [...run.events, ...trace?.events ?? []].sort((a, b) => a.at - b.at);
}

export function branchFor(
  run: FlowRun,
  children: readonly FlowRun[],
  digests: Record<number, SessionDigest> | null,
  traces: ReadonlyMap<string, FlowTrace>,
): FlowBranch {
  const trace = traces.get(traceKey(run) ?? "");
  const events = eventStream(run, trace);
  const latestDigest = run.active && run.leafId !== undefined ? digests?.[run.leafId] : undefined;
  const digest = run.sessionId && latestDigest?.sessionId === run.sessionId ? latestDigest : undefined;
  const recorded = flowTasks(events);
  const family = sessionFamily(run, children);
  const running = (digest?.tasks ?? []).filter((task) => task.kind === "subagent" &&
    !recorded.some((entry) => entry.label === task.label && Math.abs(entry.at - task.startedAt) < 2000));
  const tasks = family.length ? family : [...recorded, ...running.map((task, index) => ({
    id: `digest:${task.startedAt}:${index}`, label: task.label, at: task.startedAt,
  }))];
  return { run, trace, events, digest, tasks, start: run.createdAt ?? events[0]?.at ?? run.startedAt };
}

function combinedUsage(events: readonly TraceEvent[]): Actor["usage"] {
  let tokens = 0;
  let cost: number | undefined;
  let context: NonNullable<Actor["usage"]>["context"];
  let found = false;
  const records = new Map<string, NonNullable<TraceEvent["usage"]>>();
  for (const event of events) {
    const usage = event.usage;
    if (!usage) continue;
    found = true;
    if (usage.context && usage.context.window > 0) context = usage.context;
    if (usage.cumulative) {
      tokens = usage.tokens;
      if (usage.cost !== undefined && usage.cost !== null) cost = usage.cost;
    } else {
      records.set(usage.key ?? event.id, usage);
    }
  }
  for (const usage of records.values()) {
    tokens += usage.tokens;
    if (usage.cost !== undefined && usage.cost !== null) cost = (cost ?? 0) + usage.cost;
  }
  return found ? { tokens, cost, context } : undefined;
}

export function describeActor(
  branch: FlowBranch, task: FlowTask | undefined, trace: FlowTrace | undefined, time: number | null,
): Actor {
  const events = beforeTime(task ? trace?.events ?? [] : branch.events, time);
  const taskReturned = task?.returnedAt !== undefined && (time === null || task.returnedAt <= time);
  const status = [...events].reverse().find((event) => (
    (event.kind === "error" && !event.taskId) || event.kind === "exited" ||
    event.kind === "attention" || event.kind === "finished" || event.kind === "turn-ended" ||
    event.kind === "started" || event.kind === "working" || event.kind === "tool" || event.kind === "delegated"
  ));
  let tone: Actor["tone"] = "idle";
  let label = task ? "Delegated" : branch.run.projectHistory ? "History" : "Recorded";
  if (taskReturned) {
    tone = task?.failed ? "error" : "complete";
    label = task?.failed ? "Failed" : "Returned";
  } else if (status) {
    if (status.kind === "error") {
      tone = "error";
      label = "Error";
    } else if (status.kind === "attention") {
      tone = "waiting";
      label = status.text || "Needs input";
    } else if (status.kind === "finished" || status.kind === "turn-ended") {
      tone = "complete";
      label = "Turn complete";
    } else if (status.kind === "exited") {
      label = "Exited";
    } else if (branch.run.active || time !== null) {
      tone = "active";
      label = "Working";
    }
  }
  const relevant = [...events].reverse();
  const activity = relevant.find((event) => event.kind !== "usage" && (event.kind !== "returned" || task));
  const speech = relevant.find((event) => (event.kind === "reply" || event.kind === "user" || event.kind === "attention") && !!event.text);
  const digest = time === null && !task ? branch.digest : undefined;
  const summary = digest?.pendingQuestion ?? digest?.lastReply ?? digest?.recap;
  const recentTurn = relevant.find((event) => event.kind === "user");
  const recordedSignals = task && !trace
    ? branch.events.filter((event) => (time === null || event.at <= time)
      && (event.taskId === task.id || event.id === task.id))
    : events;
  const signals = signalEvents(recordedSignals);
  return {
    label, tone, activity: activity ?? signals[signals.length - 1],
    speech: speech ?? (summary ? { id: `summary:${summary}`, kind: "reply", at: digest?.lastReplyAt ?? branch.start, text: summary } : undefined),
    tools: relevant.filter((event) => event.kind === "tool" && (!recentTurn || event.at >= recentTurn.at)).slice(0, 2),
    signals,
    usage: combinedUsage(events),
  };
}

type Cluster = {
  branch: FlowBranch;
  box: Box;
  nodes: { task?: FlowTask; at: Point; parent?: Point }[];
};

export function edgeGeometry(from: Point, to: Point, direction: FlowDirection, returned: boolean) {
  const a = { x: from.x + NODE_ANCHOR.x, y: from.y + NODE_ANCHOR.y };
  const b = { x: to.x + NODE_ANCHOR.x, y: to.y + NODE_ANCHOR.y };
  if (direction === "right") {
    const start = { x: a.x + 29, y: a.y };
    const end = { x: b.x - 29, y: b.y };
    const rail = Math.min(from.y, to.y);
    const d = `M ${start.x} ${start.y} C ${start.x + 24} ${start.y}, ${start.x + 16} ${rail}, ${start.x + 53} ${rail} H ${end.x - 53} C ${end.x - 14} ${rail}, ${end.x - 22} ${end.y}, ${end.x} ${end.y}`;
    const tip = returned ? start : end;
    const back = tip.x + (returned ? 7 : -7);
    return { d, arrow: `M ${back} ${tip.y - 4} L ${tip.x} ${tip.y} L ${back} ${tip.y + 4}` };
  }
  const start = { x: a.x, y: a.y + 29 };
  const end = { x: b.x, y: b.y - 29 };
  const mid = (start.y + end.y) / 2;
  const d = `M ${start.x} ${start.y} C ${start.x} ${mid}, ${end.x} ${mid}, ${end.x} ${end.y}`;
  const tip = returned ? start : end;
  const back = tip.y + (returned ? 7 : -7);
  return { d, arrow: `M ${tip.x - 4} ${back} L ${tip.x} ${tip.y} L ${tip.x + 4} ${back}` };
}

export function makeScene(branches: readonly FlowBranch[], direction: FlowDirection, arrangement: FlowArrangement = "fit") {
  const placed = branches.map((branch) => {
    const depths = new Map<string, number>();
    const layers: (FlowTask | undefined)[][] = [[undefined]];
    for (const task of branch.tasks) {
      const depth = task.parentId ? (depths.get(task.parentId) ?? 0) + 1 : 1;
      depths.set(task.id, depth);
      const layer = layers[depth] ?? [];
      layer.push(task);
      layers[depth] = layer;
    }
    const breadth = Math.min(4, Math.max(...layers.map((layer) => layer.length)));
    const depth = layers.reduce((total, layer) => total + Math.ceil(layer.length / breadth), 0);
    const width = (direction === "down" ? breadth : depth) * SLOT_X + CLUSTER_PAD * 2 - (SLOT_X - NODE_WIDTH);
    const height = (direction === "down" ? depth : breadth) * SLOT_Y + CLUSTER_HEADER + CLUSTER_PAD * 2 - (SLOT_Y - NODE_HEIGHT);
    const positions = new Map<string, Point>();
    const nodes: Cluster["nodes"] = [];
    let rank = 0;
    for (const layer of layers) {
      for (let index = 0; index < layer.length; index++) {
        const task = layer[index];
        const row = Math.floor(index / breadth);
        const count = Math.min(breadth, layer.length - row * breadth);
        const cross = (index % breadth) + (breadth - count) / 2;
        const at = direction === "down"
          ? { x: CLUSTER_PAD + cross * SLOT_X, y: CLUSTER_HEADER + CLUSTER_PAD + (rank + row) * SLOT_Y }
          : { x: CLUSTER_PAD + (rank + row) * SLOT_X, y: CLUSTER_HEADER + CLUSTER_PAD + cross * SLOT_Y };
        const parent = task?.parentId ? positions.get(task.parentId) : nodes[0]?.at;
        nodes.push({ task, at, parent });
        if (task) positions.set(task.id, at);
      }
      rank += Math.ceil(layer.length / breadth);
    }
    return { branch, width, height, nodes };
  });

  if (arrangement === "lanes") {
    const across = direction === "down";
    const crossSize = placed.reduce((max, group) => Math.max(max, across ? group.height : group.width), 0);
    let nextLane = GUTTER;
    const clusters = placed.map((group): Cluster => {
      const box = across
        ? { x: nextLane, y: GUTTER, width: group.width, height: crossSize }
        : { x: GUTTER, y: nextLane, width: crossSize, height: group.height };
      nextLane += (across ? group.width : group.height) + GUTTER;
      return { branch: group.branch, box, nodes: group.nodes };
    });
    return {
      clusters,
      width: across ? nextLane : crossSize + 2 * GUTTER,
      height: across ? crossSize + 2 * GUTTER : nextLane,
    };
  }

  const ordered = [...placed].sort((a, b) => b.height - a.height || b.width - a.width);
  const widest = Math.max(0, ...ordered.map(({ width }) => width));
  const area = placed.reduce((sum, { width, height }) => sum + (width + GUTTER) * (height + GUTTER), 0);
  const ratio = 1.7;
  const nominal = Math.sqrt(area * ratio);
  const widths = placed.length > 140 ? [nominal] : [nominal, nominal * 1.2, nominal * 1.44, nominal * 1.68, nominal * 0.83];
  let best: { clusters: Cluster[]; width: number; height: number } | undefined;
  for (const candidate of widths) {
    const rowWidth = Math.max(widest, candidate);
    let x = GUTTER;
    let y = GUTTER;
    let tallest = 0;
    let right = 0;
    const clusters: Cluster[] = [];
    for (const group of ordered) {
      if (x > GUTTER && x + group.width > rowWidth + GUTTER) {
        x = GUTTER;
        y += tallest + GUTTER;
        tallest = 0;
      }
      clusters.push({ branch: group.branch, box: { x, y, width: group.width, height: group.height }, nodes: group.nodes });
      tallest = Math.max(tallest, group.height);
      right = Math.max(right, x + group.width);
      x += group.width + GUTTER;
    }
    const layout = { clusters, width: right + GUTTER, height: y + tallest + GUTTER };
    if (!best || Math.max(layout.width / ratio, layout.height) < Math.max(best.width / ratio, best.height)) {
      best = layout;
    }
  }
  return best ?? { clusters: [], width: GUTTER, height: GUTTER };
}

export type FlowScene = ReturnType<typeof makeScene>;
export type Camera = Point & { scale: number };

export function fitCamera(scene: { width: number; height: number }, viewport: { width: number; height: number }): Camera {
  const scale = Math.min(1.15, Math.max(0.07, Math.min(
    (viewport.width - 26) / Math.max(scene.width, 1),
    (viewport.height - 36) / Math.max(scene.height, 1),
  )));
  return { scale, x: (viewport.width - scene.width * scale) / 2, y: (viewport.height - scene.height * scale) / 2 };
}

export function laneCamera(scene: { width: number; height: number }, viewport: { width: number; height: number }): Camera {
  const scale = Math.max(0.56, Math.min(1, fitCamera(scene, viewport).scale));
  const freeX = viewport.width - scene.width * scale;
  const freeY = viewport.height - scene.height * scale;
  return { scale, x: Math.max(0, freeX / 2), y: Math.max(0, freeY / 2) };
}

export function zoomCamera(camera: Camera, point: Point, factor: number): Camera {
  const scale = Math.max(0.07, Math.min(2.2, camera.scale * factor));
  const ratio = scale / camera.scale;
  return { scale, x: point.x - (point.x - camera.x) * ratio, y: point.y - (point.y - camera.y) * ratio };
}

export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function eventLabel(event: TraceEvent): string {
  return event.kind === "tool" && event.text ? event.text : FLOW_LABELS[event.kind];
}
