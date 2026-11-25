import { LazyStore } from "@tauri-apps/plugin-store";
import { create } from "zustand";
import type { AgentSession, AgentSignal, SessionDigest } from "@/modules/agents/lib/types";
import { labelFor } from "@/modules/tabs/lib/tabLabel";
import type { TerminalTab } from "@/modules/tabs/lib/useTabs";
import { findLeafCwd, leafIds } from "@/modules/terminal/lib/panes";
import type { FlowActivity, FlowDelivery, FlowEndpoint, FlowKind, FlowRun } from "@/modules/agent-flow/model";

const MAX_RUNS = 160;
const MAX_EVENTS = 96;
const MAX_DELIVERIES = 240;
const store = new LazyStore("terax-agent-flow.json", { defaults: {}, autoSave: false });
const launch = Date.now().toString(36);

function archived(run: FlowRun): FlowRun {
  const [instance, leaf, startedAt] = run.key.split(":");
  const shellKey = instance === run.group.split(":")[0] && Number(startedAt) === run.startedAt && /^\d+$/.test(leaf)
    ? `${run.group}:${leaf}` : undefined;
  return { ...run, shellKey: run.shellKey ?? shellKey, active: undefined, tabId: undefined, leafId: undefined };
}

export const useFlowJournal = create<{ runs: FlowRun[]; deliveries: FlowDelivery[] }>(
  () => ({ runs: [], deliveries: [] }),
);

let loaded: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let eventSequence = 0;

export function loadFlowJournal(): Promise<void> {
  loaded ??= Promise.all([store.get<FlowRun[]>("runs"), store.get<FlowDelivery[]>("deliveries")]).then(([savedRuns, savedDeliveries]) => {
    useFlowJournal.setState(({ runs, deliveries }) => ({
      runs: Array.isArray(savedRuns) ? [...savedRuns.slice(-MAX_RUNS).map(archived), ...runs].slice(-MAX_RUNS) : runs,
      deliveries: Array.isArray(savedDeliveries) ? [...savedDeliveries.slice(-MAX_DELIVERIES), ...deliveries].slice(-MAX_DELIVERIES) : deliveries,
    }));
  }).catch(() => {});
  return loaded;
}

let write = Promise.resolve();

function scheduleWrite() {
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    write = write.then(async () => {
      await loadFlowJournal();
      const { runs, deliveries } = useFlowJournal.getState();
      await store.set("runs", runs.map(archived));
      await store.set("deliveries", deliveries);
      await store.save();
    }).catch(() => {});
  }, 1000);
}

export function flowRunKey(session: AgentSession): string {
  return `${launch}:${session.leafId}:${session.startedAt}`;
}

export function flowShellKey(tabId: number, leafId: number): string {
  return `${flowTabKey(tabId)}:${leafId}`;
}

export function flowTabKey(tabId: number): string {
  return `${launch}:${tabId}`;
}

export function recordTeraxFlow(sessionId: string, activity: FlowActivity): void {
  const key = `terax-ai:${launch}:${sessionId}`;
  const at = Date.now();
  useFlowJournal.setState(({ runs }) => {
    const previous = runs.find((run) => run.key === key);
    const events = previous?.events ?? [];
    const current = { ...activity, id: `${key}:${++eventSequence}`, at };
    if (current.usage && !current.taskId) {
      const prior = [...events].reverse().find((event) => !event.taskId && event.usage)?.usage;
      current.usage = {
        ...current.usage, cumulative: true, tokens: (prior?.tokens ?? 0) + current.usage.tokens,
        outputOnly: current.usage.outputOnly && (!prior || prior.outputOnly),
      };
    }
    const run: FlowRun = {
      key, group: "terax-ai", tabTitle: "Terax AI", agent: "terax", harness: "generic", name: "Terax AI",
      startedAt: previous?.startedAt ?? at, active: true, events: [...events, current].slice(-MAX_EVENTS),
    };
    return { runs: [...runs.filter((entry) => entry.key !== key), run].slice(-MAX_RUNS) };
  });
  scheduleWrite();
}

type Pane = { tabId: number; leafId: number };

export function recordFlowDelivery(
  target: Pane,
  source: Pane | undefined,
  submitted: boolean,
  sessions: Readonly<Record<number, AgentSession>>,
): void {
  const endpoint = ({ tabId, leafId }: Pane): FlowEndpoint => {
    const session = sessions[leafId];
    return {
      shellKey: flowShellKey(tabId, leafId),
      runKey: session?.tabId === tabId ? flowRunKey(session) : undefined,
    };
  };
  const entry: FlowDelivery = {
    id: `${launch}:delivery:${++eventSequence}`,
    at: Date.now(),
    submitted,
    source: source && endpoint(source),
    target: endpoint(target),
  };
  useFlowJournal.setState(({ deliveries }) => ({ deliveries: [...deliveries, entry].slice(-MAX_DELIVERIES) }));
  scheduleWrite();
}

export function recordFlowSignal(
  session: AgentSession,
  signal: AgentSignal,
  tab: TerminalTab | undefined,
  digest: SessionDigest | undefined,
): void {
  if (tab?.private || session.ptyId !== signal.id) return;
  if (signal.kind === "progress") return;
  const key = flowRunKey(session);
  const runs = useFlowJournal.getState().runs;
  const old = runs.find((run) => run.key === key);
  if (!tab && !old) return;
  let kind: FlowKind | null = signal.kind === "bound" ? null : signal.kind;
  if (kind === "exited" && signal.exitCode) kind = "error";
  const past = old?.events ?? [];
  const previous = past[past.length - 1];
  const at = signal.kind === "started" ? session.startedAt : Date.now();
  const events = kind && (!previous || kind !== previous.kind || kind === "subagent" || kind === "notification")
    ? [...past, {
      id: `${key}:${++eventSequence}`,
      at,
      kind,
      ...(kind === "attention" && signal.reason ? { text: {
        permission: "Permission requested",
        question: "Question asked",
        idle: "Waiting for input",
      }[signal.reason] } : {}),
      ...(kind === "error" ? { text: `Exit code ${signal.exitCode}` } : {}),
    }].slice(-MAX_EVENTS)
    : past;
  const sessionId = session.sessionId ?? old?.sessionId;
  if (old && old.events === events && old.sessionId === sessionId) return;
  const leaves = tab && leafIds(tab.paneTree);
  const run: FlowRun = {
    key,
    group: flowTabKey(session.tabId),
    shellKey: flowShellKey(session.tabId, session.leafId),
    tabTitle: tab ? labelFor(tab).slice(0, 160) : old?.tabTitle ?? "Terminal",
    paneLabel: leaves && leaves.length > 1 ? `Shell ${leaves.indexOf(session.leafId) + 1}` : old?.paneLabel,
    color: tab ? tab.color : old?.color,
    cwd: tab ? findLeafCwd(tab.paneTree, session.leafId) ?? tab.cwd : old?.cwd,
    harness: session.harness,
    agent: session.agent,
    startedAt: session.startedAt,
    name: digest?.sessionId === sessionId ? digest?.name ?? old?.name : old?.name,
    sessionId,
    tabId: session.tabId,
    leafId: session.leafId,
    events,
  };
  const next = [...runs.filter((run) => run.key !== key), run].slice(-MAX_RUNS);
  useFlowJournal.setState({ runs: next });
  scheduleWrite();
}
