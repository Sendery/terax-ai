import { LazyStore } from "@tauri-apps/plugin-store";
import { create } from "zustand";
import type { AgentSession, AgentSignal, SessionDigest } from "@/modules/agents/lib/types";
import { labelFor } from "@/modules/tabs/lib/tabLabel";
import type { TerminalTab } from "@/modules/tabs/lib/useTabs";
import { findLeafCwd } from "@/modules/terminal/lib/panes";
import type { FlowKind, FlowRun } from "@/modules/agent-flow/model";

const MAX_RUNS = 160;
const MAX_EVENTS = 96;
const store = new LazyStore("terax-agent-flow.json", { defaults: {}, autoSave: false });
const launch = Date.now().toString(36);
const archived = (run: FlowRun): FlowRun => ({
  ...run,
  active: undefined,
  tabId: undefined,
  leafId: undefined,
});

export const useFlowJournal = create<{ runs: FlowRun[] }>(() => ({ runs: [] }));

let loaded: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function loadFlowJournal(): Promise<void> {
  loaded ??= store.get<FlowRun[]>("runs").then((stored) => {
    if (!Array.isArray(stored)) return;
    useFlowJournal.setState(({ runs }) => ({
      runs: [...stored.slice(-MAX_RUNS).map(archived), ...runs].slice(-MAX_RUNS),
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
      await store.set("runs", useFlowJournal.getState().runs.map(archived));
      await store.save();
    }).catch(() => {});
  }, 1000);
}

export function flowRunKey(session: AgentSession): string {
  return `${launch}:${session.leafId}:${session.startedAt}`;
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
  const previous = past.at(-1);
  const at = signal.kind === "started" ? session.startedAt : Date.now();
  const events = kind && (!previous || kind !== previous.kind || kind === "subagent" || kind === "notification")
    ? [...past, {
      id: `${key}:${at}:${kind}:${past.length}`,
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
  const run: FlowRun = {
    key,
    group: `${launch}:${session.tabId}`,
    tabTitle: tab ? labelFor(tab).slice(0, 160) : old?.tabTitle ?? "Terminal",
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
