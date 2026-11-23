import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { native } from "@/modules/ai/lib/native";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import type { FlowTerminal } from "@/modules/agent-flow/coordination";
import { loadFlowJournal, flowRunKey, flowShellKey, useFlowJournal } from "@/modules/agent-flow/journal";
import {
  historyRun, mergeRuns,
  type FlowRun, type HistorySession, type TraceEvent,
} from "@/modules/agent-flow/model";
import { collectTerminalSources } from "@/modules/session-graph/lib/terminalSources";
import { labelFor } from "@/modules/tabs/lib/tabLabel";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { findLeafCwd, hasLeaf, leafIds } from "@/modules/terminal/lib/panes";

const HISTORY_LIMIT = 25;
const LIVE_HISTORY_MS = 8500;

type History = { key: string; sourceKey: string; runs: FlowRun[]; failed: boolean };

export function useFlowData(tabs: readonly Tab[], open: boolean, refresh: number) {
  const sessions = useAgentStore((state) => open ? state.sessions : null);
  const digests = useAgentStore((state) => open ? state.digests : null);
  const journal = useFlowJournal((state) => open ? state.runs : null);
  const deliveries = useFlowJournal((state) => open ? state.deliveries : null);
  const [history, setHistory] = useState<History>({ key: "", sourceKey: "", runs: [], failed: false });
  const { panes, hidden } = useMemo(() => {
    const panes: FlowTerminal[] = [];
    const hidden = new Set<string>();
    if (!open) return { panes, hidden };
    for (const tab of tabs) {
      if (tab.kind !== "terminal") continue;
      const leaves = leafIds(tab.paneTree);
      const title = labelFor(tab);
      leaves.forEach((leafId, index) => {
        const shellKey = flowShellKey(tab.id, leafId);
        if (tab.private) {
          hidden.add(shellKey);
          return;
        }
        const active = sessions?.[leafId];
        const session = active?.tabId === tab.id ? active : undefined;
        panes.push({ leafId, tabId: tab.id, shellKey, title, color: tab.color,
          slot: index + 1, split: leaves.length > 1, cold: !!tab.cold, session,
          runKey: session ? flowRunKey(session) : undefined });
      });
    }
    return { panes, hidden };
  }, [open, tabs, sessions]);
  const activeKey = Object.values(sessions ?? {}).filter(
    (session) => session.harness === "codex" || session.harness === "copilot" || session.harness === "agy",
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
    const knownCwds = (journal ?? []).flatMap((run) => run.cwd ? [run.cwd] : []);
    return JSON.stringify([...new Set([...sources.map((source) => source.cwd), ...knownCwds.reverse()])]
      .filter((cwd) => !privateCwds.has(cwd)).slice(0, 100).sort());
  }, [open, tabs, journal]);
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
        const label = session.cwd.split(/[\\/]/).filter(Boolean).pop() ?? session.cwd;
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
        const followHistory = async () => {
          if (stopped) return;
          if (document.visibilityState !== "hidden") {
            try {
              const records = await invoke<HistorySession[]>("agent_flow_history", { cwds });
              if (stopped) return;
              const size = found.size;
              for (const record of records) add(record);
              if (found.size !== size || extraResult === false) {
                setHistory({ key: historyKey, sourceKey, runs: [...found.values()], failed });
              }
            } catch {
              // Keep the last usable history while a provider restarts.
            }
          }
          if (!stopped) retry = setTimeout(followHistory, LIVE_HISTORY_MS);
        };
        retry = setTimeout(followHistory, 2800);
      }
      if (!stopped) setHistory({ key: historyKey, sourceKey, runs: [...found.values()], failed: failed || extraResult === false });
    })();
    return () => { stopped = true; clearTimeout(retry); };
  }, [sourceKey, historyKey, activeKey]);

  const runs = useMemo(() => {
    if (!sessions) return [];
    const byKey = new Map((journal ?? []).map((run) => [run.key, run]));
    const currentTabs = new Map(tabs.map((tab) => [tab.id, tab]));
    const publicPanes = new Map(panes.map((pane) => [pane.leafId, pane]));
    for (const session of Object.values(sessions)) {
      const tab = currentTabs.get(session.tabId);
      if (tab?.kind !== "terminal" || tab.private || !hasLeaf(tab.paneTree, session.leafId)) continue;
      const key = flowRunKey(session);
      const record = byKey.get(key);
      const pane = publicPanes.get(session.leafId);
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
        group: record?.group ?? `${key.split(":")[0]}:${tab.id}`,
        shellKey: flowShellKey(tab.id, session.leafId),
        tabTitle: labelFor(tab),
        paneLabel: pane?.split ? `Shell ${pane.slot}` : undefined,
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
    const candidates = history.sourceKey === sourceKey ? history.runs : [];
    const allowed = [...byKey.values()].flatMap((run) => {
      if (run.shellKey && hidden.has(run.shellKey)) return [];
      const tab = run.tabId === undefined ? undefined : currentTabs.get(run.tabId);
      if (tab?.kind !== "terminal") return [run];
      return tab.private ? [] : [{ ...run, tabTitle: labelFor(tab), color: tab.color }];
    });
    const publicProjects = new Set<string>(JSON.parse(sourceKey || "[]"));
    const liveByProject = new Map<string, number>();
    for (const run of allowed) {
      if (run.active && run.cwd) {
        const key = `${run.harness}:${run.cwd}`;
        liveByProject.set(key, (liveByProject.get(key) ?? 0) + 1);
      }
    }
    const attributed = allowed.map((run) => {
      const digest = run.leafId === undefined ? undefined : digests?.[run.leafId];
      if (!run.sessionId && run.active && run.cwd && publicProjects.has(run.cwd) && digest?.sessionId
        && liveByProject.get(`${run.harness}:${run.cwd}`) === 1
        && Math.max(digest.lastReplyAt ?? 0, digest.recapAt ?? 0) >= run.startedAt) {
        return { ...run, sessionId: digest.sessionId, name: digest.name ?? run.name };
      }
      if (run.sessionId || !run.cwd ||
        (run.harness !== "codex" && run.harness !== "copilot" && run.harness !== "agy")) return run;
      const closeToStart = (at: number, other: FlowRun) => Math.abs(other.startedAt - at) <= 15_000;
      const matching = candidates.filter((entry) =>
        !entry.parentId && entry.harness === run.harness && entry.cwd === run.cwd && entry.createdAt !== undefined &&
        closeToStart(entry.createdAt, run) &&
        allowed.filter((other) => other.harness === run.harness && other.cwd === run.cwd &&
          closeToStart(entry.createdAt ?? 0, other)).length === 1,
      );
      if (matching.length !== 1) return run;
      const sessionId = matching[0].sessionId;
      return { ...run, sessionId, name: matching[0].name ?? (digest?.sessionId === sessionId ? digest?.name ?? undefined : run.name) };
    });
    return mergeRuns(attributed, candidates);
  }, [sessions, digests, journal, tabs, panes, hidden, history, sourceKey]);

  const children = useMemo(() => history.sourceKey === sourceKey
    ? history.runs.filter((run) => !!run.parentId)
    : [], [history, sourceKey]);

  return {
    runs,
    children,
    digests,
    panes,
    hidden,
    deliveries,
    loading: open && history.key !== historyKey,
    failed: history.key === historyKey && history.failed,
  };
}
