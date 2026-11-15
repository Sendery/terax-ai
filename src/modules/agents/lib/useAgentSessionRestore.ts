import { useCallback, useEffect, useRef, useState } from "react";
import { isSerializableTab } from "@/modules/spaces/lib/serialize";
import type { ShellFlavor } from "@/modules/tasks/lib/dispatch";
import type { Tab } from "@/modules/tabs";
import {
  captureLeafSubmission,
  findLeafCwd,
  hasLeaf,
  leafIds,
} from "@/modules/terminal";
import {
  buildRestoreSnapshot,
  matchRestoreTargets,
  type RestoreCandidateTab,
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
  /** Space on screen, so a restore never focuses a tab the user cannot see. */
  activeSpaceId: () => string | null;
  newTabInSpace: (spaceId: string, cwd?: string) => number;
  warmTab: (tabId: number) => void;
  setActiveId: (tabId: number) => void;
};

export type AgentRestoreApi = {
  /** Sessions offered to the user, empty while there is nothing to ask about. */
  pending: SavedAgentSession[];
  restore: (sessions: readonly SavedAgentSession[]) => void;
  dismiss: () => void;
  /** True after restore submissions and snapshot cleanup, so capture may write. */
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
 * Tabs as the matcher sees them: the same serializable set the capture side
 * indexes against, each carrying its panes in tree order. Both sides must
 * count the same tabs or a private or transient tab would shift every
 * recorded index.
 */
function candidateTabs(tabs: Tab[]): RestoreCandidateTab[] {
  const out: RestoreCandidateTab[] = [];
  for (const tab of tabs) {
    if (!isSerializableTab(tab)) continue;
    out.push({
      id: tab.id,
      kind: tab.kind,
      spaceId: tab.spaceId,
      leaves:
        tab.kind === "terminal"
          ? leafIds(tab.paneTree).map((id) => ({
              id,
              cwd: findLeafCwd(tab.paneTree, id),
            }))
          : [],
    });
  }
  return out;
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
  activeSpaceId,
  newTabInSpace,
  warmTab,
  setActiveId,
}: Params): AgentRestoreApi {
  const [pending, setPending] = useState<SavedAgentSession[]>([]);
  const [settled, setSettled] = useState(false);
  const started = useRef(false);
  const active = useRef(true);
  const run = useRef(0);
  const restoring = useRef(false);
  const deps = useRef({
    getTabs,
    knownSpaceIds,
    activeSpaceId,
    newTabInSpace,
    warmTab,
    setActiveId,
    shellFlavor,
  });
  deps.current = {
    getTabs,
    knownSpaceIds,
    activeSpaceId,
    newTabInSpace,
    warmTab,
    setActiveId,
    shellFlavor,
  };

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      run.current++;
      started.current = false;
      restoring.current = false;
    };
  }, []);

  const resume = useCallback(
    async (
      sessions: readonly SavedAgentSession[],
      current: () => boolean,
    ): Promise<SavedAgentSession[]> => {
      const d = deps.current;
      const targets: RestoreTarget[] = matchRestoreTargets(
        buildRestoreSnapshot(sessions, Date.now()).sessions,
        candidateTabs(d.getTabs()),
      );
      const onScreen = d.activeSpaceId();
      let focused = false;
      const failed = await Promise.all(
        targets.map(async (target) => {
          try {
            if (
              !current() ||
              !deps.current.knownSpaceIds().includes(target.session.spaceId)
            )
              return target.session;
            const tabId =
              target.tabId ??
              d.newTabInSpace(target.session.spaceId, target.session.cwd);
            d.warmTab(tabId);
            const deadline = Date.now() + TAB_APPEAR_TIMEOUT_MS;
            let leafId = target.leafId ?? leafOf(deps.current.getTabs(), tabId);
            let submission =
              leafId === null ? null : captureLeafSubmission(leafId);
            while (
              (leafId === null || submission === null) &&
              Date.now() < deadline
            ) {
              if (!current()) return target.session;
              const tab = deps.current
                .getTabs()
                .find((value) => value.id === tabId);
              if (
                (tab &&
                  (tab.kind !== "terminal" ||
                    tab.private ||
                    tab.spaceId !== target.session.spaceId)) ||
                (!tab && target.tabId !== null)
              )
                return target.session;
              await new Promise((resolve) => setTimeout(resolve, TAB_POLL_MS));
              leafId = target.leafId ?? leafOf(deps.current.getTabs(), tabId);
              submission =
                leafId === null ? null : captureLeafSubmission(leafId);
            }
            if (leafId === null || submission === null) return target.session;
            const leaf = leafId;
            const targetCurrent = () => {
              if (
                !current() ||
                !deps.current.knownSpaceIds().includes(target.session.spaceId)
              )
                return false;
              const tab = deps.current
                .getTabs()
                .find((value) => value.id === tabId);
              return (
                tab?.kind === "terminal" &&
                !tab.private &&
                tab.spaceId === target.session.spaceId &&
                hasLeaf(tab.paneTree, leaf) &&
                (findLeafCwd(tab.paneTree, leaf) ?? tab.cwd) ===
                  target.session.cwd
              );
            };
            if (!targetCurrent()) return target.session;
            if (
              !focused &&
              target.session.spaceId === onScreen &&
              deps.current.activeSpaceId() === onScreen
            ) {
              focused = true;
              deps.current.setActiveId(tabId);
            }
            const sent = await submission.submitWhenReady(
              resumeCommandLine(target.session, d.shellFlavor),
              READY_TIMEOUT_MS,
              targetCurrent,
            );
            return sent ? null : target.session;
          } catch {
            return target.session;
          }
        }),
      );
      return failed.filter(
        (value): value is SavedAgentSession => value !== null,
      );
    },
    [],
  );

  const finish = useCallback(() => {
    const ticket = ++run.current;
    restoring.current = true;
    setPending([]);
    setSettled(false);
    const complete = () => {
      if (!active.current || run.current !== ticket) return;
      restoring.current = false;
      setSettled(true);
    };
    void clearRestoreSnapshot().then(complete, complete);
  }, []);

  const restore = useCallback(
    (sessions: readonly SavedAgentSession[]) => {
      if (!active.current || restoring.current) return;
      restoring.current = true;
      const ticket = ++run.current;
      const current = () => active.current && run.current === ticket;
      setPending([]);
      setSettled(false);
      void resume(sessions, current).then(
        (failed) => {
          if (!current()) return;
          if (failed.length) {
            restoring.current = false;
            setPending(failed);
          } else finish();
        },
        () => {
          if (!current()) return;
          restoring.current = false;
          setPending([...sessions]);
        },
      );
    },
    [resume, finish],
  );

  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    const ticket = run.current;
    if (policy === "never") {
      finish();
      return;
    }
    void (async () => {
      const snapshot = await readRestoreSnapshot();
      if (!active.current || run.current !== ticket) return;
      const spaces = new Set(deps.current.knownSpaceIds());
      const usable =
        snapshot?.sessions.filter((session) => spaces.has(session.spaceId)) ??
        [];
      if (usable.length === 0) {
        finish();
        return;
      }
      if (policy === "always") {
        restore(usable);
        return;
      }
      setPending(usable);
    })();
  }, [ready, policy, restore, finish]);

  return { pending, restore, dismiss: finish, settled };
}
