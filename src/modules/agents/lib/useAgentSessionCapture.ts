import { useEffect, useRef, useState } from "react";
import { native } from "@/modules/ai/lib/native";
import { isSerializableTab } from "@/modules/spaces/lib/serialize";
import type { Tab } from "@/modules/tabs";
import { findLeafCwd } from "@/modules/terminal";
import { useAgentStore } from "../store/agentStore";
import type { AgentHarness, AgentSession } from "./types";
import {
  buildRestoreSnapshot,
  claimSessionId,
  type RestorableAgent,
  type SavedAgentSession,
} from "./restore";
import { writeRestoreSnapshot } from "./restoreStore";

/** Agents whose sessions can be reopened, mapped from the detected harness. */
function restorableAgent(harness: AgentHarness): RestorableAgent | null {
  return harness === "pi" || harness === "claude" || harness === "codex"
    ? harness
    : null;
}

const PERSIST_DEBOUNCE_MS = 1000;
/** Floor between two transcript listings for one leaf, so signals cannot storm IPC. */
const RESOLVE_INTERVAL_MS = 5000;
/** Transcripts read per directory: enough to skip the ones other leaves hold. */
const LIST_LIMIT = 16;

type Tracked = {
  agent: RestorableAgent;
  cwd: string;
  /** Ids that already existed when this agent started. */
  before: Set<string>;
  sessionId?: string;
  lastAttemptAt: number;
};

type Live = {
  leafId: number;
  agent: RestorableAgent;
  cwd: string;
  spaceId: string;
  tabIndex: number;
  tabTitle: string;
  tabColor?: SavedAgentSession["tabColor"];
  startedAt: number;
};

/** The live agents worth remembering: not private, still in a tab, with a cwd. */
function liveAgents(
  sessions: Record<number, AgentSession>,
  tabs: Tab[],
): Live[] {
  const indexInSpace = new Map<number, number>();
  const counters = new Map<string, number>();
  for (const tab of tabs) {
    if (!isSerializableTab(tab)) continue;
    const next = counters.get(tab.spaceId) ?? 0;
    counters.set(tab.spaceId, next + 1);
    indexInSpace.set(tab.id, next);
  }

  const out: Live[] = [];
  for (const session of Object.values(sessions)) {
    const agent = restorableAgent(session.harness);
    if (!agent) continue;
    const tab = tabs.find((candidate) => candidate.id === session.tabId);
    if (tab?.kind !== "terminal" || tab.private) continue;
    const tabIndex = indexInSpace.get(tab.id);
    if (tabIndex === undefined) continue;
    const cwd = findLeafCwd(tab.paneTree, session.leafId) ?? tab.cwd;
    if (!cwd) continue;
    out.push({
      leafId: session.leafId,
      agent,
      cwd,
      spaceId: tab.spaceId,
      tabIndex,
      tabTitle: tab.customTitle ?? tab.title,
      ...(tab.color !== undefined && { tabColor: tab.color }),
      startedAt: session.startedAt,
    });
  }
  return out.sort((a, b) => a.startedAt - b.startedAt);
}

async function listSessionIds(
  agent: RestorableAgent,
  cwd: string,
): Promise<string[]> {
  // Codex mints its own ids and stores them outside the shape this reader
  // understands, so there is nothing to resolve: it resumes by directory.
  if (agent === "codex") return [];
  try {
    const found = await native.agentSessionsList(agent, cwd, LIST_LIMIT);
    return found.map((info) => info.id);
  } catch {
    return [];
  }
}

/**
 * Remembers which agent sessions are live, so the next launch can offer to
 * reopen them.
 *
 * The snapshot is written while the agents are running rather than on the way
 * out: an update, a reinstall, a kill and a crash all end the process without
 * running any close handler, and those are exactly the cases the user is asked
 * to recover from. Writes are debounced and skipped when nothing changed, so an
 * idle window with one agent open costs one store write per agent transition.
 *
 * Session ids are read from each agent's own transcript directory, which is the
 * only place they exist: nothing here parses terminal output.
 */
export function useAgentSessionCapture({
  tabs,
  enabled,
}: {
  tabs: Tab[];
  /** Gate writes until boot restore settled, so it never clobbers the snapshot. */
  enabled: boolean;
}): void {
  const sessions = useAgentStore((s) => s.sessions);
  // A quiet agent emits no signals, so resolution cannot be driven by them
  // alone: an unresolved leaf schedules the next look itself.
  const [retry, setRetry] = useState(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tracked = useRef<Map<number, Tracked>>(new Map());
  const lastJson = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const persist = useRef(() => {});
  persist.current = () => {
    if (!enabledRef.current) return;
    const live = liveAgents(sessionsRef.current, tabsRef.current);
    const candidates: SavedAgentSession[] = [];
    for (const entry of live) {
      const id = tracked.current.get(entry.leafId)?.sessionId;
      candidates.push({
        agent: entry.agent,
        cwd: entry.cwd,
        spaceId: entry.spaceId,
        ...(id !== undefined && { sessionId: id }),
        tabIndex: entry.tabIndex,
        tabTitle: entry.tabTitle,
        ...(entry.tabColor !== undefined && { tabColor: entry.tabColor }),
        startedAt: entry.startedAt,
      });
    }
    const snapshot = buildRestoreSnapshot(candidates, Date.now());
    const json = JSON.stringify(snapshot.sessions);
    if (json === lastJson.current) return;
    lastJson.current = json;
    void writeRestoreSnapshot(snapshot);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry is the manual re-resolve trigger
  useEffect(() => {
    if (!enabled) return;
    const live = liveAgents(sessions, tabs);
    const alive = new Set(live.map((entry) => entry.leafId));
    for (const leafId of tracked.current.keys()) {
      if (!alive.has(leafId)) tracked.current.delete(leafId);
    }

    const now = Date.now();
    const pending: Live[] = [];
    for (const entry of live) {
      const existing = tracked.current.get(entry.leafId);
      if (!existing || existing.cwd !== entry.cwd) {
        // A new agent, or one whose directory moved: its transcript is a
        // different file, so the previous resolution no longer applies.
        tracked.current.set(entry.leafId, {
          agent: entry.agent,
          cwd: entry.cwd,
          before: new Set(),
          lastAttemptAt: 0,
        });
      }
      const state = tracked.current.get(entry.leafId);
      if (!state || state.sessionId !== undefined) continue;
      if (entry.agent === "codex") continue;
      if (now - state.lastAttemptAt < RESOLVE_INTERVAL_MS) continue;
      state.lastAttemptAt = now;
      pending.push(entry);
    }

    let cancelled = false;
    void (async () => {
      for (const entry of pending) {
        const listed = await listSessionIds(entry.agent, entry.cwd);
        if (cancelled) return;
        const state = tracked.current.get(entry.leafId);
        if (!state || state.sessionId !== undefined) continue;
        if (state.before.size === 0 && listed.length) {
          // First look at this directory. Everything already there predates the
          // agent unless it turns out to be the file the agent is writing, so
          // the next pass is the one that can tell them apart.
          state.before = new Set(listed);
          continue;
        }
        const claimed = new Set<string>();
        for (const other of tracked.current.values()) {
          if (other.sessionId) claimed.add(other.sessionId);
        }
        const id = claimSessionId({ listed, before: state.before, claimed });
        if (id) {
          state.sessionId = id;
          persist.current();
        }
      }
      if (cancelled) return;
      const unresolved = [...tracked.current.values()].some(
        (state) => state.agent !== "codex" && state.sessionId === undefined,
      );
      if (unresolved && retryTimer.current === null) {
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          setRetry((value) => value + 1);
        }, RESOLVE_INTERVAL_MS);
      }
    })();

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      persist.current();
    }, PERSIST_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [sessions, tabs, enabled, retry]);

  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    const flush = () => persist.current();
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("beforeunload", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [enabled]);
}
