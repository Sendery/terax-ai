import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { native } from "@/modules/ai/lib/native";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import { loadFlowJournal, flowRunKey, useFlowJournal } from "@/modules/agent-flow/journal";
import {
  historyRun, isTraceProvider, mergeRuns,
  type FlowRun, type HistorySession, type Trace, type TraceEvent,
} from "@/modules/agent-flow/model";
import { collectTerminalSources } from "@/modules/session-graph/lib/terminalSources";
import { labelFor } from "@/modules/tabs/lib/tabLabel";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { findLeafCwd, hasLeaf } from "@/modules/terminal/lib/panes";

const HISTORY_LIMIT = 25;
const MAX_TRACE_EVENTS = 600;
const POLL_MS = 2000;

type History = { key: string; runs: FlowRun[]; failed: boolean };

export function useFlowData(tabs: readonly Tab[], open: boolean, refresh: number) {
  const sessions = useAgentStore((state) => open ? state.sessions : null);
  const digests = useAgentStore((state) => open ? state.digests : null);
  const journal = useFlowJournal((state) => open ? state.runs : null);
  const [history, setHistory] = useState<History>({ key: "", runs: [], failed: false });
  const activeKey = Object.values(sessions ?? {}).filter(
    (session) => session.harness === "codex" || session.harness === "copilot",
  ).map((session) => flowRunKey(session)).join(",");
  const sourceKey = useMemo(() => {
    if (!open) return "";
    const terminals = tabs.filter((tab) => tab.kind === "terminal");
    const sources = collectTerminalSources(terminals.map((tab) => ({
      ...tab,
      cwd: tab.cwd ?? null,
      title: labelFor(tab),
    })));
    const privateTabs = new Set(terminals.filter((tab) => tab.private).map((tab) => tab.id));
    const privateCwds = new Set(sources.filter((source) => privateTabs.has(source.tabId)).map((source) => source.cwd));
    return JSON.stringify([...new Set(sources.map((source) => source.cwd))]
      .filter((cwd) => !privateCwds.has(cwd)).sort());
  }, [open, tabs]);
  const historyKey = sourceKey ? `${refresh}:${activeKey}:${sourceKey}` : "";

  useEffect(() => {
    if (!open) return;
    void loadFlowJournal();
  }, [open]);

  useEffect(() => {
    if (!sourceKey) return;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const cwds: string[] = JSON.parse(sourceKey);
    void (async () => {
      const found = new Map<string, FlowRun>();
      const add = (session: HistorySession) => {
        const label = session.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? session.cwd;
        const run = historyRun(session, label);
        found.set(run.key, run);
      };
      const extra = invoke<HistorySession[]>("agent_flow_history", { cwds })
        .then((records) => { for (const record of records) add(record); })
        .catch(() => false);
      let failed = false;
      for (const cwd of cwds) {
        const results = await Promise.allSettled((["claude", "pi"] as const).map(
          (provider) => native.agentSessionsList(provider, cwd, HISTORY_LIMIT),
        ));
        if (stopped) return;
        for (const result of results) {
          if (result.status === "rejected") {
            failed = true;
            continue;
          }
          for (const record of result.value) {
            // A Claude project directory is a lossy encoding of its path.
            if (record.cwd && record.cwd !== cwd) continue;
            add({ provider: record.agent, id: record.id, cwd, modifiedAt: record.modifiedMs });
          }
        }
      }
      const extraResult = await extra;
      if (activeKey && !stopped) {
        retry = setTimeout(() => {
          void invoke<HistorySession[]>("agent_flow_history", { cwds }).then((records) => {
            if (stopped) return;
            for (const record of records) add(record);
            setHistory({ key: historyKey, runs: [...found.values()], failed });
          }).catch(() => {});
        }, 4000);
      }
      if (!stopped) setHistory({ key: historyKey, runs: [...found.values()], failed: failed || extraResult === false });
    })();
    return () => { stopped = true; clearTimeout(retry); };
  }, [sourceKey, historyKey, activeKey]);

  const runs = useMemo(() => {
    if (!sessions) return [];
    const byKey = new Map((journal ?? []).map((run) => [run.key, run]));
    const currentTabs = new Map(tabs.map((tab) => [tab.id, tab]));
    for (const session of Object.values(sessions)) {
      const tab = currentTabs.get(session.tabId);
      if (tab?.kind !== "terminal" || tab.private || !hasLeaf(tab.paneTree, session.leafId)) continue;
      const key = flowRunKey(session);
      const record = byKey.get(key);
      const digest = digests?.[session.leafId];
      const sessionId = session.sessionId ?? record?.sessionId;
      const syntheticEvent: TraceEvent = {
        id: `${key}:current`,
        at: session.lastActivityAt,
        kind: session.lastSignal === "finished" || session.lastSignal === "attention"
          ? session.lastSignal
          : session.status === "waiting" ? "attention" : "working",
      };
      byKey.set(key, {
        key,
        group: record?.group ?? key.split(":")[0] + ":" + tab.id,
        tabTitle: labelFor(tab),
        color: tab.color,
        startedAt: session.startedAt,
        harness: session.harness,
        agent: session.agent,
        name: sessionId && digest?.sessionId === sessionId ? digest.name ?? undefined : record?.name,
        sessionId,
        cwd: findLeafCwd(tab.paneTree, session.leafId) ?? tab.cwd,
        events: record?.events.length ? record.events : [syntheticEvent],
        active: true,
        tabId: tab.id,
        leafId: session.leafId,
      });
    }
    const candidates = history.key === historyKey ? history.runs : [];
    const allowed = [...byKey.values()].filter((run) => {
      const tab = run.tabId === undefined ? undefined : currentTabs.get(run.tabId);
      return tab?.kind !== "terminal" || !tab.private;
    });
    const attributed = allowed.map((run) => {
      if (run.sessionId || !run.cwd || (run.harness !== "codex" && run.harness !== "copilot")) return run;
      const closeToStart = (at: number, other: FlowRun) => Math.abs(other.startedAt - at) <= 15_000;
      const matching = candidates.filter((entry) =>
        entry.harness === run.harness && entry.cwd === run.cwd && entry.createdAt !== undefined &&
        closeToStart(entry.createdAt, run) &&
        allowed.filter((other) => other.harness === run.harness && other.cwd === run.cwd &&
          closeToStart(entry.createdAt ?? 0, other)).length === 1,
      );
      if (matching.length !== 1) return run;
      const sessionId = matching[0].sessionId;
      const digest = run.leafId === undefined ? undefined : digests?.[run.leafId];
      return { ...run, sessionId, name: digest?.sessionId === sessionId ? digest?.name ?? undefined : run.name };
    });
    return mergeRuns(attributed, candidates);
  }, [sessions, digests, journal, tabs, history, historyKey]);

  return {
    runs,
    digests,
    loading: open && history.key !== historyKey,
    failed: history.key === historyKey && history.failed,
  };
}

type TraceState = {
  key: string;
  events: TraceEvent[];
  name: string | null;
  loading: boolean;
  limited: boolean;
  failed: boolean;
};

const EMPTY_TRACE: TraceState = {
  key: "", events: [], name: null, loading: false, limited: false, failed: false,
};

export function useFlowTrace(run: FlowRun | undefined, open: boolean, follow: boolean, refresh: number) {
  const [state, setState] = useState(EMPTY_TRACE);
  const id = run?.sessionId;
  const provider = run?.harness;
  const key = open && id && provider && isTraceProvider(provider) ? `${provider}:${id}` : "";
  useEffect(() => {
    if (!key || !id || !provider) return;
    let stopped = false;
    let offset = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = async () => {
      try {
        const trace = await invoke<Trace>("agent_flow_trace", { provider, id, offset });
        if (stopped) return;
        const first = offset === 0;
        offset = trace.nextOffset;
        if (first || trace.reset || trace.events.length || trace.name) {
          setState((old) => {
            const same = old.key === key && !trace.reset;
            const combined = same ? [...old.events, ...trace.events] : trace.events;
            return {
              key,
              events: combined.slice(-MAX_TRACE_EVENTS),
              name: trace.name ?? (same ? old.name : null),
              loading: false,
              limited: trace.limited || (same && old.limited) || combined.length > MAX_TRACE_EVENTS,
              failed: false,
            };
          });
        } else {
          setState((old) => old.failed ? { ...old, failed: false } : old);
        }
        if (trace.pending || follow) timer = setTimeout(next, trace.pending ? 150 : POLL_MS);
      } catch {
        if (stopped) return;
        setState((old) => ({
          ...(old.key === key ? old : EMPTY_TRACE),
          key,
          loading: false,
          failed: true,
        }));
        if (follow) timer = setTimeout(next, POLL_MS * 3);
      }
    };
    void next();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id, key, provider, follow, refresh]);

  if (key && key !== state.key) return { ...EMPTY_TRACE, loading: true };
  return key ? state : EMPTY_TRACE;
}
