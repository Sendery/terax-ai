import { liveTasks } from "@/modules/agents/lib/describeEvent";
import type { SessionDigest } from "@/modules/agents/lib/types";
import {
  beforeTime, FLOW_LABELS, flowTasks, sessionFamily, taskStartKind,
  type FlowDirection, type FlowKind, type FlowRun, type FlowTask, type TraceEvent,
} from "@/modules/agent-flow/model";
import { traceKey, type FlowTrace } from "@/modules/agent-flow/traceReader";

const NODE_GEOMETRY = {
  down: { width: 326, height: 156, centerX: 47, centerY: 55 },
  right: { width: 326, height: 174, centerX: 47, centerY: 73 },
  compact: { width: 156, height: 132, centerX: 78, centerY: 42 },
};
const GUTTER = 46;
const COORDINATOR_HEIGHT = 74;
const COORDINATOR_WIDTH = 200;
const CLUSTER_PAD = 18;
const CLUSTER_HEADER = 31;
export const COMPACT_SCALE = 0.48;
const FINISHED_LINGER_MS = 30_000;
const UNCONFIRMED_IDLE_MS = 300_000;

export function nodeGeometry(direction: FlowDirection, compact = false) {
  return NODE_GEOMETRY[compact ? "compact" : direction];
}

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
  if (kind === "tool" || kind === "task-activity") return "tool";
  if (kind === "delegated" || kind === "subagent" || kind === "delivery") return "branch";
  if (kind === "monitor-started" || kind === "background-started" || kind === "loop-started") return "branch";
  if (kind === "returned" || kind === "finished" || kind === "turn-ended") return "return";
  if (kind === "attention" || kind === "notification" || kind === "error") return "attention";
  return "state";
}

export function signalEvents(events: readonly TraceEvent[], limit = 12): TraceEvent[] {
  const result: TraceEvent[] = [];
  for (let index = events.length - 1; index >= 0 && result.length < limit; index--) {
    const event = events[index];
    if (event.kind !== "usage" && event.kind !== "working" && event.kind !== "task-alias") result.push(event);
  }
  return result.reverse();
}

export function contextPercent(context: NonNullable<NonNullable<Actor["usage"]>["context"]>): number {
  return Math.round(Math.max(0, Math.min(1, context.input / context.window)) * 100);
}

export function eventStream(run: FlowRun, trace: FlowTrace | undefined): TraceEvent[] {
  const events = [...run.events, ...trace?.events ?? []];
  const aliases = new Map<string, string>();
  for (const event of events) {
    if (event.kind === "task-alias" && event.text && event.taskId) aliases.set(event.text, event.taskId);
  }
  return events.flatMap((event) => {
    if (event.kind === "task-alias") return [];
    const taskId = event.taskId && aliases.get(event.taskId);
    return [taskId ? { ...event, taskId } : event];
  }).sort((a, b) => a.at - b.at);
}

function terminalOutcome(events: readonly TraceEvent[], since: number) {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event.at < since) return undefined;
    if (event.taskId) continue;
    if (event.kind === "exited" || event.kind === "finished" || event.kind === "turn-ended" || event.kind === "error")
      return event;
    if (event.kind === "started" || event.kind === "user" || event.kind === "attention" || event.kind === "working"
      || event.kind === "tool" || event.kind === "delegated")
      return undefined;
  }
  return undefined;
}

export function runOutcome(branch: FlowBranch): TraceEvent | undefined {
  const transcript = branch.trace?.events;
  const outcome = transcript && terminalOutcome(transcript, branch.run.startedAt - 2000);
  if (outcome && !branch.events.some((event) => event.at > outcome.at
    && (event.kind === "user" || event.kind === "attention"))) return outcome;
  return terminalOutcome(branch.events, branch.run.startedAt - 2000);
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
  const tasks = family.length ? [...family, ...recorded.filter((task) => task.process)] : recorded;
  liveTasks(digest?.tasks ?? [], run.startedAt).forEach((task, index) => {
    const known = tasks.find((entry) => (task.id && entry.id === task.id)
      || ((entry.process?.kind ?? "subagent") === task.kind && entry.label === task.label
        && Math.abs(entry.at - task.startedAt) < 2000));
    if (known?.returnedAt !== undefined) return;
    if (task.kind === "subagent") {
      if (known) known.running = known.returnedAt === undefined;
      else if (!family.length) tasks.push({
        id: task.id ?? `digest:${task.startedAt}:${index}`, label: task.label, at: task.startedAt, running: true,
      });
      return;
    }
    const minuteStep = task.cron?.match(/^\*\/([1-9][0-9]?) \* \* \* \*$/)?.[1];
    const process: FlowTask["process"] = {
      kind: task.kind,
      state: task.kind === "monitor" ? "listening" : task.kind === "loop" ? "scheduled" : "running",
      cadence: minuteStep ? `Every ${minuteStep} min` : task.cron ? `Cron · ${task.cron}` : undefined,
      lastActivityAt: Math.max(known?.process?.lastActivityAt ?? 0, task.lastActivityAt ?? 0) || undefined,
    };
    if (known) known.process = process;
    else tasks.push({ id: task.id ?? `digest:${task.startedAt}:${index}`, label: task.label, at: task.startedAt, process });
  });
  for (const task of tasks) {
    if (!task.run || task.returnedAt !== undefined) continue;
    const childEvents = traces.get(traceKey(task.run) ?? "")?.events ?? [];
    const outcome = terminalOutcome(childEvents, task.at);
    if (outcome) {
      task.returnedAt = outcome.at;
      task.failed = outcome.kind === "error";
      task.running = false;
    }
  }
  return { run, trace, events, digest, tasks, start: run.createdAt ?? events[0]?.at ?? run.startedAt };
}

function retirementAt(task: FlowTask, traces: ReadonlyMap<string, FlowTrace>): number {
  if (task.returnedAt !== undefined) return task.returnedAt + FINISHED_LINGER_MS;
  if (task.process?.state === "paused") return 0;
  if (task.running || task.process?.state) return Infinity;
  const events = traces.get(traceKey(task.run) ?? "")?.events ?? [];
  const outcome = terminalOutcome(events, task.at);
  if (outcome) return outcome.at + FINISHED_LINGER_MS;
  let lastActivity = Math.max(task.at, task.run?.startedAt ?? 0, task.process?.lastActivityAt ?? 0);
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.kind === "usage" || event.taskId) continue;
    lastActivity = Math.max(lastActivity, event.at);
    if (event.kind === "attention") return Infinity;
    break;
  }
  return lastActivity + UNCONFIRMED_IDLE_MS;
}

export function liveBranches(
  branches: readonly FlowBranch[],
  traces: ReadonlyMap<string, FlowTrace>,
  now: number,
  selection: FlowSelection | null,
  hideCompletedRuns = false,
) {
  let nextExpiry = Infinity;
  const visible = branches.flatMap((branch) => {
    const kept = new Set<string>();
    const byId = new Map(branch.tasks.map((task) => [task.id, task]));
    for (const task of branch.tasks) {
      const inspecting = selection?.run === branch.run.key && selection.task === task.id;
      const expiry = inspecting ? Infinity : retirementAt(task, traces);
      if (expiry <= now) continue;
      nextExpiry = Math.min(nextExpiry, expiry);
      let ancestor: FlowTask | undefined = task;
      while (ancestor && !kept.has(ancestor.id)) {
        kept.add(ancestor.id);
        ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined;
      }
    }
    if (!kept.size && branch.run.marker === "background") return [];
    if (hideCompletedRuns && !kept.size && branch.run.active && !branch.run.marker && selection?.run !== branch.run.key) {
      const outcome = runOutcome(branch);
      if (outcome) {
        const expiry = outcome.at + FINISHED_LINGER_MS;
        if (expiry <= now) return [];
        nextExpiry = Math.min(nextExpiry, expiry);
      }
    }
    if (kept.size === branch.tasks.length) return [branch];
    return [{ ...branch, tasks: branch.tasks.filter((task) => kept.has(task.id)) }];
  });
  return { branches: visible, nextExpiry };
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
  const status = (!task && time === null ? runOutcome(branch) : undefined) ?? [...events].reverse().find((event) => (
    (event.kind === "error" && !event.taskId) || event.kind === "exited" ||
    event.kind === "attention" || event.kind === "finished" || event.kind === "turn-ended" ||
    event.kind === "started" || event.kind === "user" || event.kind === "working" || event.kind === "tool" || event.kind === "delegated"
  ));
  let tone: Actor["tone"] = "idle";
  let label = task ? "Delegated" : branch.run.projectHistory ? "History" : "Recorded";
  if (taskReturned) {
    tone = task?.failed ? "error" : "complete";
    label = task?.failed ? "Failed" : task?.process ? "Ended" : "Returned";
  } else if (task?.process) {
    if (time !== null) label = "Recorded";
    else if (task.process.state === "running") { tone = "active"; label = "Running"; }
    else if (task.process.state === "listening") label = "Listening";
    else if (task.process.state === "scheduled") label = "Scheduled";
    else if (task.process.state === "paused") label = "Paused";
    else label = "Recorded";
  } else if (time === null && task?.running) {
    tone = "active";
    label = "Working";
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
  const signals = signalEvents(task?.process ? processEvents(task, recordedSignals, time) : recordedSignals);
  return {
    label, tone, activity: activity ?? signals[signals.length - 1],
    speech: speech ?? (summary ? { id: `summary:${summary}`, kind: "reply", at: digest?.lastReplyAt ?? branch.start, text: summary } : undefined),
    tools: relevant.filter((event) => event.kind === "tool" && (!recentTurn || event.at >= recentTurn.at)).slice(0, 2),
    signals,
    usage: combinedUsage(events),
  };
}

export function processEvents(task: FlowTask, events: readonly TraceEvent[], time: number | null): TraceEvent[] {
  const kind = taskStartKind(task);
  const activity = task.process?.lastActivityAt;
  const result = [...events];
  if (!result.some((event) => event.kind === kind) && (time === null || task.at <= time)) {
    result.push({ id: `${task.id}:started`, at: task.at, kind, taskId: task.id });
  }
  if (activity !== undefined && activity > task.at && (time === null || activity <= time)
      && !result.some((event) => event.at === activity && event.kind === "task-activity")) {
    result.push({ id: `${task.id}:activity:${activity}`, at: activity, kind: "task-activity", taskId: task.id });
  }
  return result.sort((a, b) => a.at - b.at);
}

type Cluster = {
  branch: FlowBranch;
  box: Box;
  channel?: { y: number; step: number };
  nodes: { task?: FlowTask; at: Point; parent?: Point }[];
};

type Layout = { clusters: Cluster[]; width: number; height: number };

function horizontalCurve(from: Point, to: Point): string {
  if (from.y === to.y) return ` H ${to.x}`;
  const control = Math.round((to.x - from.x) * 0.42);
  return ` C ${from.x + control} ${from.y}, ${to.x - control} ${to.y}, ${to.x} ${to.y}`;
}

export function edgeGeometry(from: Point, to: Point, direction: FlowDirection, returned: boolean, compact = false, channel?: Cluster["channel"]) {
  const { width, centerX, centerY } = nodeGeometry(direction, compact);
  const a = { x: from.x + centerX, y: from.y + centerY };
  const b = { x: to.x + centerX, y: to.y + centerY };
  if (direction === "right") {
    const start = { x: a.x + 29, y: a.y };
    const end = { x: b.x - 29, y: b.y };
    const across = channel && to.x - from.x > channel.step ? channel : undefined;
    let d = `M ${start.x} ${start.y}`;
    if (!across && start.y === end.y) {
      d += ` H ${end.x}`;
    } else {
      // Stay in the gap between speech and tools until there is room to turn.
      let depart = { x: compact ? start.x : from.x + width + 6, y: start.y };
      if (depart.x !== start.x) d += ` H ${depart.x}`;
      if (across) {
        const entry = { x: from.x + across.step - 6, y: across.y };
        const exit = { x: to.x - across.step + width + 6, y: across.y };
        d += horizontalCurve(depart, entry) + horizontalCurve(entry, exit);
        depart = exit;
      }
      d += horizontalCurve(depart, end);
    }
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

export function makeScene(branches: readonly FlowBranch[], direction: FlowDirection, arrangement: FlowArrangement = "fit", compact = false) {
  const { width: nodeWidth, height: nodeHeight, centerX, centerY } = nodeGeometry(direction, compact);
  const coordinator = branches.find(({ run }) => run.marker === "terax");
  const horizontal = direction === "right";
  const slotY = nodeHeight + (horizontal ? 20 : 38);
  const placed = branches.filter(({ run }) => run.marker !== "terax").map((branch) => {
    const header = CLUSTER_HEADER + (!compact && horizontal ? 16 : 0);
    const depths = new Map<string, number>();
    const layers: (FlowTask | undefined)[][] = [[undefined]];
    for (const task of branch.tasks) {
      const depth = task.parentId ? (depths.get(task.parentId) ?? 0) + 1 : 1;
      depths.set(task.id, depth);
      const layer = layers[depth] ?? [];
      layer.push(task);
      layers[depth] = layer;
    }
    const widestLayer = Math.max(...layers.map((layer) => layer.length));
    const limit = Math.min(widestLayer, horizontal ? Math.max(4, Math.ceil(Math.sqrt(2 * widestLayer))) : 4);
    const bands = layers.flatMap((layer) => {
      const count = Math.ceil(layer.length / limit);
      const chunk = horizontal ? layer.length / count : limit;
      return Array.from({ length: count }, (_, i) => layer.slice(Math.ceil(i * chunk), Math.ceil((i + 1) * chunk)));
    });
    const rows = horizontal ? Math.max(...bands.map((band) => band.length)) : bands.length;
    const turnSpace = horizontal && !compact ? Math.min(120, (rows - 1) * 24) : 0;
    const slotX = nodeWidth + 26 + turnSpace;
    const width = ((horizontal ? bands.length : limit) - 1) * slotX + nodeWidth + CLUSTER_PAD * 2;
    const top = header + CLUSTER_PAD;
    const split = Math.ceil(rows / 2);
    const wraps = horizontal && bands.length > layers.length;
    const channelGap = wraps && !compact ? 48 : 0;
    // Speech cards can extend above their node, so reserve extra clearance in full detail.
    const cardOverhang = compact ? 0 : 44;
    const channel = wraps ? {
      y: top + split * slotY + (nodeHeight - slotY + channelGap - cardOverhang) / 2,
      step: slotX,
    } : undefined;
    const height = (rows - 1) * slotY + nodeHeight + header + CLUSTER_PAD * 2 + channelGap;
    const positions = new Map<string, Point>();
    const nodes: Cluster["nodes"] = [];
    for (const [rank, band] of bands.entries()) {
      const upper = Math.ceil(band.length / 2);
      for (const [index, task] of band.entries()) {
        const cross = index + ((horizontal ? rows : limit) - band.length) / 2;
        let y = top + (horizontal ? cross : rank) * slotY;
        if (channel) {
          const row = split - upper + index;
          y = rank === 0 ? channel.y - centerY : top + row * slotY + (index >= upper ? channelGap : 0);
        }
        const at = horizontal
          ? { x: CLUSTER_PAD + rank * slotX, y }
          : { x: CLUSTER_PAD + cross * slotX, y };
        const parent = task?.parentId ? positions.get(task.parentId) : nodes[0]?.at;
        nodes.push({ task, at, parent });
        if (task) positions.set(task.id, at);
      }
    }
    return { branch, width, height, nodes, channel };
  });

  function addCoordinator(layout: Layout): Layout {
    if (!coordinator) return layout;
    const width = Math.max(layout.width, 2 * GUTTER + 192);
    const height = Math.max(layout.height, 2 * GUTTER + COORDINATOR_HEIGHT);
    const box = { x: GUTTER, y: GUTTER, width: horizontal ? COORDINATOR_WIDTH : width - 2 * GUTTER,
      height: horizontal ? height - 2 * GUTTER : COORDINATOR_HEIGHT };
    const at = { x: box.width / 2 - centerX, y: box.height / 2 - centerY };
    const dx = horizontal ? box.width + GUTTER : 0;
    const dy = horizontal ? 0 : box.height + GUTTER;
    return {
      width: width + dx,
      height: height + dy,
      clusters: [
        { branch: coordinator, box, nodes: [{ at }] },
        ...layout.clusters.map((cluster) => ({ ...cluster, box: { ...cluster.box, x: cluster.box.x + dx, y: cluster.box.y + dy } })),
      ],
    };
  }

  if (arrangement === "lanes") {
    const across = direction === "down";
    const crossSize = placed.reduce((max, group) => Math.max(max, across ? group.height : group.width), 0);
    let nextLane = GUTTER;
    const clusters = placed.map((group): Cluster => {
      const box = across
        ? { x: nextLane, y: GUTTER, width: group.width, height: compact ? group.height : crossSize }
        : { x: GUTTER, y: nextLane, width: compact ? group.width : crossSize, height: group.height };
      nextLane += (across ? group.width : group.height) + GUTTER;
      return { branch: group.branch, box, nodes: group.nodes, channel: group.channel };
    });
    return addCoordinator({
      clusters,
      width: across ? nextLane : crossSize + 2 * GUTTER,
      height: across ? crossSize + 2 * GUTTER : nextLane,
    });
  }

  const ordered = [...placed].sort((a, b) => b.height - a.height || b.width - a.width);
  const widest = Math.max(0, ...ordered.map(({ width }) => width));
  const area = placed.reduce((sum, { width, height }) => sum + (width + GUTTER) * (height + GUTTER), 0);
  const ratio = 1.7;
  const nominal = Math.sqrt(area * ratio);
  const widths = placed.length > 140 ? [nominal] : [nominal, nominal * 1.2, nominal * 1.44, nominal * 1.68, nominal * 0.83];
  let best: Layout | undefined;
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
      clusters.push({ branch: group.branch, box: { x, y, width: group.width, height: group.height }, nodes: group.nodes, channel: group.channel });
      tallest = Math.max(tallest, group.height);
      right = Math.max(right, x + group.width);
      x += group.width + GUTTER;
    }
    const layout = { clusters, width: right + GUTTER, height: y + tallest + GUTTER };
    if (!best || Math.max(layout.width / ratio, layout.height) < Math.max(best.width / ratio, best.height)) {
      best = layout;
    }
  }
  return addCoordinator(best ?? { clusters: [], width: GUTTER, height: GUTTER });
}

export type FlowScene = ReturnType<typeof makeScene>;
export type Camera = Point & { scale: number };
export type FlowLayouts = { expanded: FlowScene; compact: FlowScene };

export function fitCamera(scene: { width: number; height: number }, viewport: { width: number; height: number }, maxScale = 1.15): Camera {
  const scale = Math.min(maxScale, Math.max(0.07, Math.min(
    (viewport.width - 26) / Math.max(scene.width, 1),
    (viewport.height - 36) / Math.max(scene.height, 1),
  )));
  return { scale, x: (viewport.width - scene.width * scale) / 2, y: (viewport.height - scene.height * scale) / 2 };
}

export function fitFlowCamera(layouts: FlowLayouts, viewport: { width: number; height: number }): Camera {
  const expanded = fitCamera(layouts.expanded, viewport);
  return expanded.scale >= COMPACT_SCALE ? expanded : fitCamera(layouts.compact, viewport, COMPACT_SCALE - 0.01);
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

export function zoomFlowCamera(camera: Camera, point: Point, factor: number, layouts: FlowLayouts, direction: FlowDirection, time: number | null): Camera {
  const next = zoomCamera(camera, point, factor);
  const wasCompact = camera.scale < COMPACT_SCALE;
  const isCompact = next.scale < COMPACT_SCALE;
  if (wasCompact === isCompact) return next;

  const from = layouts[wasCompact ? "compact" : "expanded"];
  const to = layouts[isCompact ? "compact" : "expanded"];
  const oldNode = nodeGeometry(direction, wasCompact);
  const newNode = nodeGeometry(direction, isCompact);
  const world = { x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale };
  let closest: Cluster | undefined;
  let distance = Infinity;
  for (const cluster of from.clusters) {
    if (time !== null && cluster.branch.start > time) continue;
    const { x, y, width, height } = cluster.box;
    const gap = Math.max(0, x - world.x, world.x - x - width) ** 2
      + Math.max(0, y - world.y, world.y - y - height) ** 2;
    if (gap >= distance) continue;
    closest = cluster;
    distance = gap;
  }
  if (!closest) return next;
  const key = closest.branch.run.key;
  const destination = to.clusters.find(({ branch }) => branch.run.key === key);
  if (!destination) return next;
  const { box, nodes } = closest;
  let index = 0;
  distance = Infinity;
  nodes.forEach(({ at, task }, i) => {
    if (task && time !== null && task.at > time) return;
    const gap = (box.x + at.x + oldNode.centerX - world.x) ** 2 + (box.y + at.y + oldNode.centerY - world.y) ** 2;
    if (gap >= distance) return;
    index = i;
    distance = gap;
  });
  const start = nodes[index].at;
  const end = destination.nodes[index].at;
  return {
    ...next,
    x: next.x - (destination.box.x + end.x + newNode.centerX - box.x - start.x - oldNode.centerX) * next.scale,
    y: next.y - (destination.box.y + end.y + newNode.centerY - box.y - start.y - oldNode.centerY) * next.scale,
  };
}

export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function eventLabel(event: TraceEvent): string {
  return event.kind === "tool" && event.text ? event.text : FLOW_LABELS[event.kind];
}
