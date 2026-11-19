import { type RefObject, useEffect, useMemo } from "react";
import { useAgentStore } from "@/modules/agents";
import { readTerminalContext } from "@/modules/ai/lib/terminalContext";
import { switchChatLayout } from "@/modules/ai/store/chatLayoutStore";
import { hasKeyForModel, useChatStore } from "@/modules/ai/store/chatStore";
import { useSpaces } from "@/modules/spaces";
import { MAX_PANES_PER_TAB, type Tab } from "@/modules/tabs";
import {
  hasLeaf,
  type TerminalPaneHandle,
  whenSessionReady,
  writeToSession,
} from "@/modules/terminal";
import { focusLeafInput } from "@/modules/terminal/lib/useTerminalSession";
import {
  startWatchRunner,
  stopWatchRunner,
  watchCommands,
} from "@/modules/watchers";
import {
  createReaderHandlers,
  type ReaderHost,
} from "@/modules/reader/lib/readerCommands";
import type { ControlHandlers } from "./lib/controlCommands";
import { createTerminalControl } from "./lib/terminalControl";

type Params = {
  tabsRef: RefObject<Tab[]>;
  activeIdRef: RefObject<number>;
  terminalRefs: RefObject<Map<number, TerminalPaneHandle>>;
  newTab: (cwd?: string) => number;
  setActiveId: (id: number) => void;
  focusPane: (tabId: number, leafId: number) => void;
  splitActivePane: (tabId: number, dir: "row" | "col") => number | null;
  closePaneByLeaf: (leafId: number) => void;
  updateTab: (id: number, patch: { customTitle?: string }) => void;
  moveTabToSpace: (tabId: number, spaceId: string) => boolean;
  openReaderTab: (input: {
    docId: string;
    title: string;
    background?: boolean;
  }) => number;
  /** How the Reader panel under a tab is driven, from App. */
  readerPanel: Pick<
    ReaderHost,
    "dockReading" | "recordOrigin" | "showLibrary" | "closeDock" | "forgetDeleted"
  >;
};

function failure(message: string): never {
  throw { code: "command_failed", message };
}

function requireSpace(spaceId: string) {
  const space = useSpaces.getState().spaces.find((s) => s.id === spaceId);
  if (!space) failure(`Space ${spaceId} not found`);
  return space;
}

/** Hands a changed watch to the Terax AI chat, only while it is idle. */
async function deliverToAgent(message: string): Promise<boolean> {
  const state = useChatStore.getState();
  const { status } = state.agentMeta;
  if (status !== "idle" && status !== "error") return false;
  const sessionId = state.activeSessionId;
  if (!sessionId || !hasKeyForModel(state.selectedModelId)) return false;
  const { getOrCreateChat } = await import("@/modules/ai/store/chatRuntime");
  if (!state.mini.open && !state.panelOpen) state.openMini();
  void getOrCreateChat(sessionId).sendMessage({ text: message });
  return true;
}

/**
 * The handlers behind the control commands (terminal panes, spaces, watches),
 * built from the tab primitives App owns. Everything is read through refs, so
 * the object is stable and the command bridge never resubscribes for it.
 */
export function useControlHandlers(params: Params): ControlHandlers {
  const {
    tabsRef,
    activeIdRef,
    terminalRefs,
    newTab,
    setActiveId,
    focusPane,
    splitActivePane,
    closePaneByLeaf,
    updateTab,
    moveTabToSpace,
    openReaderTab,
    readerPanel,
  } = params;

  useEffect(() => {
    void startWatchRunner({
      deliverToAgent,
      getFallbackCwd: () => useChatStore.getState().live.getCwd(),
    });
    return stopWatchRunner;
  }, []);

  return useMemo<ControlHandlers>(() => {
    const focusTab = (tabId: number) => {
      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (!tab) return;
      useSpaces.getState().setActive(tab.spaceId);
      activeIdRef.current = tabId;
      setActiveId(tabId);
    };

    const terminals = createTerminalControl({
      getTabs: () => tabsRef.current,
      getActiveTabId: () => activeIdRef.current,
      getAgent: (leafId) => useAgentStore.getState().sessions[leafId],
      isMounted: (leafId) => terminalRefs.current.has(leafId),
      readBuffer: (leafId, lines) =>
        readTerminalContext(() => {
          const tab = tabsRef.current.find(
            (t) => t.kind === "terminal" && hasLeaf(t.paneTree, leafId),
          );
          const handle = terminalRefs.current.get(leafId);
          return tab?.kind === "terminal" && handle
            ? { tabId: tab.id, leafId, private: tab.private === true, handle }
            : null;
        }, lines),
      newTab,
      defaultCwd: () => useChatStore.getState().live.getCwd() ?? undefined,
      focusTab,
      focusPane,
      splitActivePane,
      closePane: closePaneByLeaf,
      setTabTitle: (tabId, title) => updateTab(tabId, { customTitle: title }),
      whenReady: whenSessionReady,
      write: writeToSession,
      focusInput: focusLeafInput,
      maxPanesPerTab: MAX_PANES_PER_TAB,
    });

    return {
      ...terminals,
      listSpaces: () => {
        const { spaces, activeId } = useSpaces.getState();
        return {
          spaces: spaces.map((space) => ({
            id: space.id,
            name: space.name,
            root: space.root,
            active: space.id === activeId,
            tabs: tabsRef.current.filter((t) => t.spaceId === space.id).length,
          })),
        };
      },
      focusSpace: ({ spaceId }) => {
        requireSpace(spaceId);
        useSpaces.getState().setActive(spaceId);
        return { spaceId };
      },
      moveTabToSpace: ({ tabId, spaceId }) => {
        requireSpace(spaceId);
        const tab = tabsRef.current.find((t) => t.id === tabId);
        if (!tab) failure(`Tab ${tabId} not found`);
        if (tab.kind === "terminal" && tab.private)
          failure(`Tab ${tabId} is private and is not available to agents`);
        if (moveTabToSpace(tabId, spaceId)) {
          useSpaces.getState().setActive(spaceId);
        }
        return { tabId, spaceId };
      },
      listWatches: () => watchCommands.list(),
      readWatch: ({ id }) => watchCommands.read(id),
      addWatch: (payload) =>
        watchCommands.add({
          ...payload,
          cwd: payload.cwd ?? useChatStore.getState().live.getCwd(),
        }),
      updateWatch: ({ id, ...patch }) => watchCommands.update(id, patch),
      removeWatch: ({ id }) => watchCommands.remove(id),
      setWatchEnabled: ({ id, enabled }) =>
        watchCommands.setEnabled(id, enabled),
      runWatch: ({ id }) => watchCommands.run(id),
      setChatLayout: ({ mode, show }) => {
        switchChatLayout(mode);
        const chat = useChatStore.getState();
        if (show === false) chat.closeMini();
        else chat.openMini();
        return { mode, visible: show !== false };
      },
      ...createReaderHandlers({
        tabs: () => tabsRef.current,
        activeId: () => activeIdRef.current,
        openReaderTab: (input) => {
          const id = openReaderTab(input);
          if (!input.background) focusTab(id);
          return id;
        },
        ...readerPanel,
      }),
    };
  }, [
    tabsRef,
    activeIdRef,
    terminalRefs,
    newTab,
    setActiveId,
    focusPane,
    splitActivePane,
    closePaneByLeaf,
    updateTab,
    moveTabToSpace,
    openReaderTab,
    readerPanel,
  ]);
}
