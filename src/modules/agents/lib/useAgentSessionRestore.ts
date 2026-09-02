import { useCallback, useEffect, useRef, useState } from "react";
import type { ShellFlavor } from "@/modules/tasks/lib/dispatch";
import type { Tab } from "@/modules/tabs";
import { submitToLeaf, whenSessionReady } from "@/modules/terminal";
import {
  matchRestoreTargets,
  type RestoreTarget,
  resumeCommandLine,
  type SavedAgentSession,
} from "./restore";
import { clearRestoreSnapshot, readRestoreSnapshot } from "./restoreStore";

export type AgentRestorePolicy = "ask" | "always" | "never";

type Params = {
  /** True once the space boot finished, so restored tabs exist to match against. */
  ready: boolean;
  policy: AgentRestorePolicy;
  shellFlavor: ShellFlavor;
  getTabs: () => Tab[];
  knownSpaceIds: () => string[];
  newTabInSpace: (spaceId: string, cwd?: string) => number;
  warmTab: (tabId: number) => void;
  setActiveId: (tabId: number) => void;
};

export type AgentRestoreApi = {
  /** Sessions offered to the user, empty while there is nothing to ask about. */
  pending: SavedAgentSession[];
  restore: (sessions: readonly SavedAgentSession[]) => void;
  dismiss: () => void;
  /** True once boot decided, so the capture hook may start overwriting. */
  settled: boolean;
};

/** How long a restored tab is given to reach a prompt before typing into it. */
const READY_TIMEOUT_MS = 15_000;
/** Poll budget for a freshly created tab to appear in the tab list. */
const TAB_APPEAR_TIMEOUT_MS = 3000;
const TAB_POLL_MS = 40;

function leafOf(tabs: Tab[], tabId: number): number | null {
  const tab = tabs.find((candidate) => candidate.id === tabId);
  return tab?.kind === "terminal" ? tab.activeLeafId : null;
}

/**
 * Offers to reopen the agent sessions that were live when Terax last ran.
 *
 * Restoring means resuming the conversation, not replaying it: each session is
 * handed back to its own CLI (`claude --resume`, `pi --session`, `codex resume
 * --last`), which is the only thing that can reconstruct an agent's context.
 * Sessions land back in the tab the space serializer already restored, so a
 * restore does not double every agent tab.
 */
export function useAgentSessionRestore({
  ready,
  policy,
  shellFlavor,
  getTabs,
  knownSpaceIds,
  newTabInSpace,
  warmTab,
  setActiveId,
}: Params): AgentRestoreApi {
  const [pending, setPending] = useState<SavedAgentSession[]>([]);
  const [settled, setSettled] = useState(false);
  const started = useRef(false);
  const deps = useRef({
    getTabs,
    knownSpaceIds,
    newTabInSpace,
    warmTab,
    setActiveId,
    shellFlavor,
  });
  deps.current = {
    getTabs,
    knownSpaceIds,
    newTabInSpace,
    warmTab,
    setActiveId,
    shellFlavor,
  };

  const resume = useCallback(async (sessions: readonly SavedAgentSession[]) => {
    const d = deps.current;
    const targets: RestoreTarget[] = matchRestoreTargets(
      sessions,
      d.getTabs().map((tab) => ({
        id: tab.id,
        kind: tab.kind,
        spaceId: tab.spaceId,
        ...(tab.kind === "terminal" && tab.cwd !== undefined
          ? { cwd: tab.cwd }
          : {}),
      })),
    );

    let focus: number | null = null;
    for (const target of targets) {
      const tabId =
        target.tabId ??
        d.newTabInSpace(target.session.spaceId, target.session.cwd);
      d.warmTab(tabId);
      focus ??= tabId;

      const deadline = Date.now() + TAB_APPEAR_TIMEOUT_MS;
      let leafId = leafOf(d.getTabs(), tabId);
      while (leafId === null && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, TAB_POLL_MS));
        leafId = leafOf(d.getTabs(), tabId);
      }
      if (leafId === null) continue;

      const leaf = leafId;
      const command = resumeCommandLine(target.session, d.shellFlavor);
      // Each tab is warmed and left to reach its own prompt; typing before the
      // shell integration reports one loses the command.
      void whenSessionReady(leaf, READY_TIMEOUT_MS).then(() => {
        submitToLeaf(leaf, command);
      });
    }
    if (focus !== null) d.setActiveId(focus);
  }, []);

  const finish = useCallback(() => {
    setPending([]);
    setSettled(true);
    void clearRestoreSnapshot();
  }, []);

  const restore = useCallback(
    (sessions: readonly SavedAgentSession[]) => {
      void resume(sessions);
      finish();
    },
    [resume, finish],
  );

  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    if (policy === "never") {
      setSettled(true);
      void clearRestoreSnapshot();
      return;
    }
    void (async () => {
      const snapshot = await readRestoreSnapshot();
      const spaces = new Set(deps.current.knownSpaceIds());
      const usable =
        snapshot?.sessions.filter((session) => spaces.has(session.spaceId)) ??
        [];
      if (usable.length === 0) {
        setSettled(true);
        void clearRestoreSnapshot();
        return;
      }
      if (policy === "always") {
        void resume(usable);
        setSettled(true);
        void clearRestoreSnapshot();
        return;
      }
      setPending(usable);
    })();
  }, [ready, policy, resume]);

  return { pending, restore, dismiss: finish, settled };
}
