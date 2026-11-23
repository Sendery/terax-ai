import { notificationLabel } from "@/modules/agents/lib/describeEvent";
import type { AgentNotification, AgentSession } from "@/modules/agents/lib/types";
import type { FlowDelivery, FlowEndpoint, FlowRun, TraceEvent } from "@/modules/agent-flow/model";
import type { FlowBranch } from "@/modules/agent-flow/scene";
import { traceKey, type FlowTrace } from "@/modules/agent-flow/traceReader";
import type { TabColor } from "@/modules/tabs/lib/tabColors";

export type FlowTerminal = {
  leafId: number;
  tabId: number;
  shellKey: string;
  title: string;
  slot: number;
  split: boolean;
  color?: TabColor;
  session?: AgentSession;
  runKey?: string;
};

export function terminalTitle(pane: FlowTerminal) {
  return pane.split ? `${pane.title} · Shell ${pane.slot}` : pane.title;
}

export type FlowNotice = Pick<AgentNotification, "id" | "at" | "tone" | "read"> & { label: string };
export type FlowNodeStatus = { pending?: string; notice?: FlowNotice };

export function collectNodeStatus(
  panes: readonly FlowTerminal[], runs: readonly FlowRun[], notifications: readonly AgentNotification[],
): ReadonlyMap<string, FlowNodeStatus> {
  const byShell = new Map<string, FlowRun>();
  for (const run of runs) {
    if (!run.shellKey) continue;
    const previous = byShell.get(run.shellKey);
    if (!previous || run.startedAt > previous.startedAt) byShell.set(run.shellKey, run);
  }
  const latest = new Map<number, AgentNotification>();
  for (const notice of notifications) {
    if (notice.source !== "terminal") continue;
    const preceding = latest.get(notice.leafId);
    if (!preceding || notice.at > preceding.at) latest.set(notice.leafId, notice);
  }
  const statuses = new Map<string, FlowNodeStatus>();
  for (const pane of panes) {
    const run = byShell.get(pane.shellKey);
    if (!run || (pane.runKey && pane.runKey !== run.key)) continue;
    const session = pane.session;
    const pending = session?.status === "waiting" && session.attentionSince != null
      ? session.lastReason === "permission" ? "Permission required"
        : session.lastReason === "question" ? "Question waiting" : "Waiting for input"
      : undefined;
    const recent = latest.get(pane.leafId);
    let notice: FlowNotice | undefined;
    if (recent?.tabId === pane.tabId && recent.at >= run.startedAt) {
      const { id, at, tone, read, kind, reason } = recent;
      notice = { id, at, tone, read, label: notificationLabel(kind, reason) };
    }
    if (pending || notice) statuses.set(run.key, { pending, notice });
  }
  return statuses;
}

export type ResolvedEndpoint = { title: string; pane?: FlowTerminal; run?: FlowRun };
export type ResolvedDelivery = FlowDelivery & { from?: ResolvedEndpoint; to: ResolvedEndpoint };

export function resolveDeliveries(
  deliveries: readonly FlowDelivery[],
  panes: readonly FlowTerminal[],
  runs: readonly FlowRun[],
  hidden: ReadonlySet<string>,
  time: number | null,
): ResolvedDelivery[] {
  const paneByShell = new Map(panes.map((pane) => [pane.shellKey, pane]));
  const runByKey = new Map(runs.map((run) => [run.key, run]));
  function resolve(endpoint: FlowEndpoint): ResolvedEndpoint | undefined {
    if (hidden.has(endpoint.shellKey)) return undefined;
    const candidate = paneByShell.get(endpoint.shellKey);
    const pane = !endpoint.runKey || candidate?.runKey === endpoint.runKey ? candidate : undefined;
    const run = endpoint.runKey && runByKey.get(endpoint.runKey);
    if (run) return { title: pane ? terminalTitle(pane) : run.tabTitle, pane, run };
    if (!endpoint.runKey && pane) return { title: terminalTitle(pane), pane };
    return undefined;
  }
  return deliveries.filter(({ at }) => time === null || at <= time).flatMap((delivery): ResolvedDelivery[] => {
    const to = resolve(delivery.target);
    const from = delivery.source && resolve(delivery.source);
    return to && (!delivery.source || from) ? [{ ...delivery, to, from }] : [];
  }).reverse();
}

export type FileTouch = { run: FlowRun; task?: string; event: TraceEvent };
export type FileCrossing = { path: string; touches: FileTouch[] };

export type FlowRelation =
  | { key: string; from: string; to: string; kind: "relay"; deliveries: ResolvedDelivery[] }
  | { key: string; from: string; to: string; kind: "file"; file: FileCrossing };

export function relayGraph(
  deliveries: readonly ResolvedDelivery[],
  runs: readonly FlowRun[],
  group: string,
) {
  const inScope = new Set(runs.map((run) => run.key));
  const markers = new Map<string, FlowRun>();
  const links = new Map<string, Extract<FlowRelation, { kind: "relay" }>>();
  function endpointRun(endpoint: ResolvedEndpoint, at: number): FlowRun | undefined {
    if (endpoint.run) return inScope.has(endpoint.run.key) ? endpoint.run : undefined;
    const pane = endpoint.pane;
    if (!pane) return undefined;
    const paneGroup = pane.shellKey.slice(0, pane.shellKey.lastIndexOf(":"));
    if (group && paneGroup !== group) return undefined;
    return {
      key: `shell:${pane.shellKey}`, group: paneGroup, shellKey: pane.shellKey, marker: "shell",
      tabTitle: pane.title, paneLabel: pane.split ? `Shell ${pane.slot}` : undefined,
      name: "Terminal shell", agent: "shell", harness: "generic", color: pane.color, startedAt: at,
      tabId: pane.tabId, leafId: pane.leafId, active: true, events: [],
    };
  }
  function remember(run: FlowRun) {
    if (!run.marker) return;
    const previous = markers.get(run.key);
    if (!previous || run.startedAt < previous.startedAt) markers.set(run.key, run);
  }
  for (const delivery of deliveries) {
    const to = endpointRun(delivery.to, delivery.at);
    if (!to) continue;
    const from = delivery.from ? endpointRun(delivery.from, delivery.at) : {
      key: "flow:terax", group: "flow:terax", marker: "terax" as const, tabTitle: "Terax", name: "Command source",
      agent: "terax", harness: "generic" as const, startedAt: delivery.at, events: [],
    };
    if (!from || from.key === to.key) continue;
    remember(from);
    remember(to);
    const key = JSON.stringify(["relay", from.key, to.key]);
    const link = links.get(key);
    if (link) link.deliveries.push(delivery);
    else links.set(key, { key, from: from.key, to: to.key, kind: "relay", deliveries: [delivery] });
  }
  return { markers: [...markers.values()], links: [...links.values()] };
}

export function fileRelations(files: readonly FileCrossing[]): FlowRelation[] {
  return files.flatMap((file) => {
    const [first, ...others] = file.touches.map(({ run }) => run.key).sort();
    return others.map((to) => ({
      key: JSON.stringify(["file", file.path, first, to]), from: first, to, kind: "file", file,
    }));
  });
}

export function relationLabel(relation: FlowRelation) {
  if (relation.kind === "file") return relation.file.path.split("/").pop() ?? relation.file.path;
  const count = relation.deliveries.length;
  return count === 1 ? "Terminal relay" : `${count} terminal relays`;
}

const WRITE_TOOLS = new Set(["edit", "write", "edit_file", "write_file", "replace"]);

export function normalizedFile(cwd: string | undefined, file: string) {
  if (!cwd || /[\x00-\x1f\x7f]/.test(file) || file.includes("://")) return undefined;
  const normalize = (value: string) => {
    const path = value.replace(/\\/g, "/");
    const root = /^(?:[a-z]:\/|\/)/i.exec(path)?.[0];
    if (!root || path.startsWith("//")) return undefined;
    const parts: string[] = [];
    for (const part of path.slice(root.length).split("/")) {
      if (part === "..") {
        if (!parts.length) return undefined;
        parts.pop();
      } else if (part && part !== ".") parts.push(part);
    }
    return root + parts.join("/");
  };
  const base = normalize(cwd);
  const path = normalize(/^(?:[a-z]:[\\/]|[\\/])/i.test(file) ? file : `${cwd}/${file}`);
  if (!base || !path) return undefined;
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return path.startsWith(prefix) && path.length > prefix.length ? path : undefined;
}

export function fileCrossings(
  branches: readonly FlowBranch[],
  traces: ReadonlyMap<string, FlowTrace>,
  time: number | null,
): FileCrossing[] {
  const files = new Map<string, Map<string, FileTouch>>();
  for (const { run, events, tasks } of branches) {
    const add = (stream: readonly TraceEvent[], task?: string) => {
      for (const event of stream) {
        if (event.kind !== "tool" || !event.file || !WRITE_TOOLS.has(event.text?.toLowerCase() ?? "") ||
          (time !== null && event.at > time)) continue;
        const path = normalizedFile(run.cwd, event.file);
        if (!path) continue;
        const touches = files.get(path) ?? new Map<string, FileTouch>();
        const previous = touches.get(run.key);
        if (!previous || previous.event.at < event.at) touches.set(run.key, { run, task, event });
        files.set(path, touches);
      }
    };
    add(events);
    for (const task of tasks) add(traces.get(traceKey(task.run) ?? "")?.events ?? [], task.id);
  }
  return [...files.entries()].flatMap(([path, touches]) => touches.size < 2 ? [] : [{
    path, touches: [...touches.values()].sort((a, b) => b.event.at - a.event.at),
  }]).sort((a, b) => b.touches[0].event.at - a.touches[0].event.at).slice(0, 24);
}
