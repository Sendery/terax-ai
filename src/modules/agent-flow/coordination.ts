import type { AgentSession } from "@/modules/agents/lib/types";
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
  cold: boolean;
  session?: AgentSession;
  runKey?: string;
};

export function terminalTitle(pane: FlowTerminal) {
  return pane.split ? `${pane.title} · Shell ${pane.slot}` : pane.title;
}

export type AttentionItem = {
  id: string;
  pane: FlowTerminal;
  at: number;
  event?: string;
  label: string;
  error?: boolean;
};

export function collectAttention(panes: readonly FlowTerminal[], runs: readonly FlowRun[], traces: ReadonlyMap<string, FlowTrace>) {
  const open = new Map(panes.map((pane) => [pane.shellKey, pane]));
  const waiting = panes.flatMap((pane): AttentionItem[] => {
    const session = pane.session;
    if (session?.status !== "waiting" || session.attentionSince == null) return [];
    const label = session.lastReason === "permission" ? "Permission required"
      : session.lastReason === "question" ? "Question waiting" : "Waiting for input";
    return [{ id: `${pane.runKey}:${session.attentionSince}`, pane, label, at: session.attentionSince }];
  }).sort((a, b) => a.at - b.at);
  const errors = new Map<string, AttentionItem>();
  for (const run of runs) {
    const pane = run.shellKey && open.get(run.shellKey);
    if (!pane || (pane.runKey && pane.runKey !== run.key)) continue;
    const candidates = [run.events, traces.get(traceKey(run) ?? "")?.events ?? []];
    for (const events of candidates) {
      for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index];
        if (event.kind !== "error" || event.taskId) continue;
        const previous = errors.get(pane.shellKey);
        if (!previous || previous.at < event.at) {
          errors.set(pane.shellKey, { id: `${run.key}:${event.id}`, pane: { ...pane, runKey: run.key },
            at: event.at, event: event.id, label: "Last error", error: true });
        }
        break;
      }
    }
  }
  return [...waiting, ...[...errors.values()].sort((a, b) => b.at - a.at).slice(0, 8)];
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
