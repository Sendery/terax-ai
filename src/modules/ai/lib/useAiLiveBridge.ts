import { type RefObject, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useManagedAgentsStore } from "@/modules/agents/store/managedAgentsStore";
import {
  findLeafCwd,
  hasLeaf,
  type TerminalPaneHandle,
  whenSessionReady,
  writeToSession,
} from "@/modules/terminal";
import type { Tab } from "@/modules/tabs";
import type { Live } from "../store/chatStore";
import { waitForClaudeTuiReady } from "@/modules/ai/lib/claudeReadiness";
import {
  readTerminalContext,
  type TerminalTextTarget,
} from "@/modules/ai/lib/terminalContext";

type Params = {
  setLive: (live: Live) => void;
  activeId: number;
  tabs: Tab[];
  explorerRoot: string | null;
  launchCwd: string | null;
  home: string | null;
  openPreviewTab: (url: string) => void;
  newAgentTab: (
    cwd: string | undefined,
    title: string,
  ) => { tabId: number; leafId: number };
  terminalRefs: RefObject<Map<number, TerminalPaneHandle>>;
};

/**
 * Publishes the live workspace context (cwd, terminal buffer, active file,
 * managed-agent spawning, ...) into the chat store so AI tools can read and
 * act on the foreground state.
 *
 * The live object's getters read the latest state through a ref, so the bridge
 * is published once instead of re-running on every tab/cwd change — cwd updates
 * arrive from terminal OSC on shell output and would otherwise churn constantly.
 */
export function useAiLiveBridge(params: Params) {
  const { setLive, terminalRefs } = params;
  const ref = useRef(params);
  ref.current = params;

  useEffect(() => {
    const findCwd = () => {
      const { activeId, tabs, explorerRoot, launchCwd, home } = ref.current;
      const active = tabs.find((x) => x.id === activeId);
      if (active?.kind === "terminal") {
        return (
          findLeafCwd(active.paneTree, active.activeLeafId) ??
          active.cwd ??
          null
        );
      }
      for (let i = tabs.length - 1; i >= 0; i--) {
        const t = tabs[i];
        if (t.kind !== "terminal") continue;
        const cwd = findLeafCwd(t.paneTree, t.activeLeafId) ?? t.cwd;
        if (cwd) return cwd;
      }
      return explorerRoot ?? launchCwd ?? home ?? null;
    };

    const leafTarget = (leafId: number): TerminalTextTarget | null => {
      const tab = ref.current.tabs.find(
        (item) => item.kind === "terminal" && hasLeaf(item.paneTree, leafId),
      );
      const handle = terminalRefs.current.get(leafId);
      return tab?.kind === "terminal" && handle
        ? { tabId: tab.id, leafId, private: tab.private === true, handle }
        : null;
    };
    const activeTarget = (): TerminalTextTarget | null => {
      const { activeId, tabs } = ref.current;
      const tab = tabs.find((item) => item.id === activeId);
      return tab?.kind === "terminal" ? leafTarget(tab.activeLeafId) : null;
    };

    setLive({
      getCwd: findCwd,
      getTerminalContext: () => readTerminalContext(activeTarget, 300),
      isActiveTerminalPrivate: () => {
        const { activeId, tabs } = ref.current;
        const t = tabs.find((x) => x.id === activeId);
        return t?.kind === "terminal" && t.private === true;
      },
      injectIntoActivePty: (text) => {
        const { activeId, tabs } = ref.current;
        const t = tabs.find((x) => x.id === activeId);
        if (t?.kind !== "terminal") return false;
        const term = terminalRefs.current.get(t.activeLeafId);
        if (!term) return false;
        term.write(text);
        term.focus();
        return true;
      },
      getWorkspaceRoot: () => {
        const { explorerRoot, launchCwd, home } = ref.current;
        return explorerRoot ?? launchCwd ?? home ?? null;
      },
      getActiveFile: () => {
        const { activeId, tabs } = ref.current;
        const t = tabs.find((x) => x.id === activeId);
        return t?.kind === "editor" ? t.path : null;
      },
      openPreview: (url: string) => {
        ref.current.openPreviewTab(url);
        return true;
      },
      spawnManagedAgent: (prompt: string, sessionId: string) => {
        const trimmed = prompt.trim();
        if (!trimmed) return null;
        const oneLine = trimmed.replace(/\s*\r?\n\s*/g, " ");
        const cwd = findCwd();
        const short =
          oneLine.length > 32 ? `${oneLine.slice(0, 32)}…` : oneLine;
        const { tabId, leafId } = ref.current.newAgentTab(
          cwd ?? undefined,
          `claude · ${short}`,
        );
        useManagedAgentsStore
          .getState()
          .register({ leafId, tabId, sessionId, task: oneLine, cwd });
        const hooksReady = invoke("agent_enable_claude_hooks").catch(() => {});
        void (async () => {
          await Promise.all([whenSessionReady(leafId), hooksReady]);
          if (!writeToSession(leafId, "claude\r")) {
            useManagedAgentsStore.getState().remove(leafId);
            return;
          }
          const readBuf = () =>
            readTerminalContext(() => leafTarget(leafId), 120);
          const result = await waitForClaudeTuiReady(readBuf);
          if (result !== "ready") {
            if (result === "timeout") {
              console.warn(
                "[terax] Claude TUI did not appear in time; aborting prompt send",
              );
            }
            useManagedAgentsStore.getState().remove(leafId);
            return;
          }
          if (!writeToSession(leafId, `\x1b[200~${trimmed}\x1b[201~`)) {
            useManagedAgentsStore.getState().remove(leafId);
            return;
          }
          setTimeout(() => writeToSession(leafId, "\r"), 120);
          useManagedAgentsStore.getState().setPhase(leafId, "working");
        })();
        return { tabId, leafId };
      },
      readLeafBuffer: (leafId: number) =>
        readTerminalContext(() => leafTarget(leafId), 300),
    });
  }, [setLive, terminalRefs]);
}
