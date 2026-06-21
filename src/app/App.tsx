import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BUILD_INFO } from "@/lib/buildInfo";
import { getLaunchDir } from "@/lib/launchDir";
import { IS_WINDOWS } from "@/lib/platform";
import { usePresence } from "@/lib/usePresence";
import { quoteShellArg } from "@/lib/shellQuote";
import { useZoom } from "@/lib/useZoom";
import {
  AGENT_MONITOR_MAX_WIDTH,
  AGENT_MONITOR_MIN_WIDTH,
  AgentMonitorPanel,
  AgentNotificationsBridge,
  AgentRestoreDialog,
  useAgentMonitorPanel,
  useAgentSessionCapture,
  useAgentSessionRestore,
  useAgentStore,
} from "@/modules/agents";
import { captureSurface } from "@/modules/capture";
import {
  AgentRunBridge,
  AiMiniWindow,
  LocalAgentNotificationsBridge,
  SelectionAskAi,
  useAiBootstrap,
  useAiLiveBridge,
  useChatStore,
  useSelectionAskAi,
} from "@/modules/ai";
import { AiComposerProvider } from "@/modules/ai/lib/composer";
import { native } from "@/modules/ai/lib/native";
import {
  checkReadable,
  checkReadableCanonical,
} from "@/modules/ai/lib/security";
import { CommandPalette, createCommandItems } from "@/modules/command-palette";
import {
  buildAppSnapshot,
  useExternalCommandBridge,
  type CommandHandlers,
} from "@/modules/commands";
import {
  NewEditorDialog,
  useEditorFileSync,
  type EditorPaneHandle,
} from "@/modules/editor";
import { FileExplorer, type FileExplorerHandle } from "@/modules/explorer";
import type { GitHistorySearchHandle } from "@/modules/git-history";
import {
  Header,
  type SearchInlineHandle,
  type SearchTarget,
} from "@/modules/header";
import { validateMermaidSource } from "@/modules/mermaid";
import { type PreviewPaneHandle, samePreviewUrl } from "@/modules/preview";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { isMarkdownPath } from "@/lib/utils";
import {
  useGlobalShortcuts,
  type ShortcutHandlers,
  type ShortcutId,
} from "@/modules/shortcuts";
import {
  SidebarRail,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useSidebarPanel,
} from "@/modules/sidebar";
import {
  cardCitation,
  cardTitle,
  type NoteCard,
  type NoteCardPatch,
  NotesDockedNotice,
  NotesPanel,
  NOTES_MAX_WIDTH,
  NOTES_MIN_WIDTH,
  type NotesMutator,
  closeNotesWindow,
  openNotesWindow,
  useNotesPanel,
  useNotesWindowBridge,
  useTabNotes,
} from "@/modules/notes";
import {
  type ScheduledTask,
  type TabTarget,
  TASKS_MAX_WIDTH,
  TASKS_MIN_WIDTH,
  formatScheduleSpec,
  TaskEditor,
  taskInputFromCommand,
  taskPatchFromCommand,
  TasksPanel,
  taskSummary,
  useScheduledTasks,
  useTaskDispatcher,
  useTasksPanel,
  useTasksScheduler,
} from "@/modules/tasks";
import {
  agentKindFromName,
  GRAPH_MAX_WIDTH,
  GRAPH_MIN_WIDTH,
  SessionGraphPanel,
  collectTerminalSources,
  nextTerminalBinding,
  type TerminalBinding,
  useResolvedSession,
  useSessionGraphPanel,
} from "@/modules/session-graph";
import {
  SourceControlPanel,
  useSourceControlContext,
} from "@/modules/source-control";
import { StatusBar } from "@/modules/statusbar";
import {
  useTabs,
  waitForMermaidTabReplacement,
  useWindowTitle,
  useWorkspaceCwd,
  DEFAULT_SPACE_ID,
  type TabColor,
} from "@/modules/tabs";
import {
  clearFocusedTerminal,
  disposeSession,
  findLeafCwd,
  hasLeaf,
  isLeafTuiReady,
  leafIds,
  navigateFocusedBlocks,
  respawnSession,
  type TerminalPaneHandle,
  useTerminalFileDrop,
  writeToSession,
} from "@/modules/terminal";
import {
  SpaceSwitcher,
  useSpaces,
  useSpacePersistence,
  useSpacesBoot,
} from "@/modules/spaces";
import { ThemeProvider, useThemeFileEditing } from "@/modules/theme";
import { UpdaterDialog } from "@/modules/updater";
import { useWorkspaceEnvStore, type WorkspaceEnv } from "@/modules/workspace";
import type { SearchAddon } from "@xterm/addon-search";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CloseDialogs } from "./components/CloseDialogs";
import {
  TOGGLE_BLOCK_INPUT_EVENT,
  WorkspaceInputBar,
} from "./components/WorkspaceInputBar";
import { WorkspaceSurface } from "./components/WorkspaceSurface";
import { useAppCloseGuard } from "./hooks/useAppCloseGuard";
import { useTabCloseGuards } from "./hooks/useTabCloseGuards";
import { useWorkspaceSwitcher } from "./hooks/useWorkspaceSwitcher";

function waitForMermaidPane(tabId: number, timeoutMs = 5_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const check = () => {
      if (document.querySelector(`[data-mermaid-tab-id="${tabId}"]`)) {
        resolve();
        return;
      }
      if (performance.now() >= deadline) {
        reject(new Error(`Mermaid tab ${tabId} did not mount in time`));
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });
}

export default function App() {
  const {
    tabs,
    activeId,
    setActiveId,
    allocId,
    replaceTabs,
    moveTabToSpace,
    reorderTab,
    reorderTabByGap,
    newTabInSpace,
    warmTab,
    removeTabsForSpace,
    markBooted,
    setActiveSpaceForNewTabs,
    newTab,
    newBlockTab,
    newAgentTab,
    newPrivateTab,
    openFileTab,
    pinTab,
    newPreviewTab,
    newMarkdownTab,
    newMermaidTab,
    updateMermaidSource,
    replaceMermaidTabContent,
    updateMermaidVisualLayout,
    setMarkdownView,
    openAiDiffTab,
    closeAiDiffTab,
    openGitDiffTab,
    openCommitHistoryTab,
    openCommitFileDiffTab,
    openPrReviewTab,
    setPrReviewBase,
    moveTab,
    setTabPinned,
    closeTab,
    updateTab,
    updateTabNotes,
    selectByIndex,
    setLeafCwd,
    focusPane,
    focusNextPaneInTab,
    splitActivePane,
    closeActivePane,
    closePaneByLeaf,
    resetWorkspace,
  } = useTabs(getLaunchDir() ? { cwd: getLaunchDir() } : undefined);

  // Mirror `tabs` into a ref so callbacks scheduled with `setTimeout`
  // (e.g. cdInNewTab) read the latest pane state instead of a stale closure.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const activeTerminalTab = useMemo(() => {
    const t = tabs.find((x) => x.id === activeId);
    return t && t.kind === "terminal" ? t : null;
  }, [tabs, activeId]);
  const activeLeafId = activeTerminalTab?.activeLeafId ?? null;

  const searchAddons = useRef<Map<number, SearchAddon>>(new Map());
  const [activeSearchAddon, setActiveSearchAddon] =
    useState<SearchAddon | null>(null);
  const searchInlineRef = useRef<SearchInlineHandle | null>(null);
  const terminalRefs = useRef<Map<number, TerminalPaneHandle>>(new Map());
  const editorRefs = useRef<Map<number, EditorPaneHandle>>(new Map());
  const previewRefs = useRef<Map<number, PreviewPaneHandle>>(new Map());
  const [activeEditorHandle, setActiveEditorHandle] =
    useState<EditorPaneHandle | null>(null);
  const [gitHistoryHandle, setGitHistoryHandle] =
    useState<GitHistorySearchHandle | null>(null);
  const { zoomIn, zoomOut, zoomReset } = useZoom();
  useTerminalFileDrop();
  const explorerRef = useRef<FileExplorerHandle>(null);

  // Drives session disposal off the pane tree, not React lifecycles —
  // split/unsplit re-mount components but the leaf is still live.
  const liveLeavesRef = useRef<Set<number>>(new Set());

  const clearWorkspaceState = useCallback(() => {
    for (const id of liveLeavesRef.current) disposeSession(id);
    searchAddons.current.clear();
    terminalRefs.current.clear();
    editorRefs.current.clear();
    previewRefs.current.clear();
    setActiveSearchAddon(null);
    setActiveEditorHandle(null);
  }, []);

  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const setWorkspaceEnv = useWorkspaceEnvStore((s) => s.setEnv);
  const {
    home,
    launchCwd,
    launchCwdResolved,
    switchWorkspace,
    adoptWorkspaceEnv,
  } = useWorkspaceSwitcher({
    tabsRef,
    workspaceEnv,
    setWorkspaceEnv,
    resetWorkspace,
    clearWorkspaceState,
  });

  const activeSpaceId = useSpaces((s) => s.activeId);
  const spacesHydrated = useSpaces((s) => s.hydrated);

  const handleWorkspaceChange = useCallback(
    async (env: WorkspaceEnv) => {
      const switched = await switchWorkspace(env);
      if (switched && activeSpaceId) {
        useSpaces.getState().setEnv(activeSpaceId, env);
      }
    },
    [switchWorkspace, activeSpaceId],
  );

  useSpacesBoot({
    ready: launchCwdResolved,
    launchCwd,
    home,
    allocId,
    replaceTabs,
    markBooted,
    setActiveSpaceForNewTabs,
    adoptWorkspaceEnv,
  });

  useSpacePersistence({
    tabs,
    activeId,
    activeSpaceId: activeSpaceId ?? DEFAULT_SPACE_ID,
    enabled: spacesHydrated,
  });

  const restoreAgentSessionsPref = usePreferencesStore(
    (s) => s.restoreAgentSessions,
  );
  // Preferences hydrate asynchronously, and asking before they land would
  // ignore a stored "never".
  const prefsHydrated = usePreferencesStore((s) => s.hydrated);
  const getTabsForRestore = useCallback(() => tabsRef.current, []);
  const knownSpaceIds = useCallback(
    () => useSpaces.getState().spaces.map((s) => s.id),
    [],
  );
  const agentRestore = useAgentSessionRestore({
    ready: spacesHydrated && prefsHydrated,
    policy: restoreAgentSessionsPref,
    shellFlavor: IS_WINDOWS ? "windows" : "posix",
    getTabs: getTabsForRestore,
    knownSpaceIds,
    newTabInSpace,
    warmTab,
    setActiveId,
  });
  // Only starts once the restore decision is made, so the snapshot it
  // overwrites is never the one still being offered to the user. Turning the
  // feature off stops the writing too, so it costs nothing when unwanted.
  useAgentSessionCapture({
    tabs,
    enabled: agentRestore.settled && restoreAgentSessionsPref !== "never",
  });

  const prevSpaceRef = useRef(activeSpaceId);
  useEffect(() => {
    if (!spacesHydrated || !activeSpaceId) return;
    setActiveSpaceForNewTabs(activeSpaceId);
    const prev = prevSpaceRef.current;
    prevSpaceRef.current = activeSpaceId;
    if (prev === null || prev === activeSpaceId) return;
    const meta = useSpaces
      .getState()
      .spaces.find((s) => s.id === activeSpaceId);
    if (meta) void adoptWorkspaceEnv(meta.env);
    const inSpace = tabsRef.current.filter((t) => t.spaceId === activeSpaceId);
    if (inSpace.length === 0) return;
    // Keep the active tab if it already belongs to the newly active space (a
    // cross-space jump set it explicitly); else fall to the space's last tab.
    if (inSpace.some((t) => t.id === activeId)) return;
    setActiveId(inSpace[inSpace.length - 1].id);
  }, [
    activeSpaceId,
    activeId,
    spacesHydrated,
    setActiveSpaceForNewTabs,
    setActiveId,
    adoptWorkspaceEnv,
  ]);

  const [switcherOpen, setSwitcherOpen] = useState(false);

  const spaceTabs = useMemo(
    () => tabs.filter((t) => t.spaceId === (activeSpaceId ?? DEFAULT_SPACE_ID)),
    [tabs, activeSpaceId],
  );

  const {
    sidebarRef,
    sidebarWidthRef,
    sidebarView,
    persistSidebarView,
    toggleSidebar,
    showSidebar,
    hideSidebar,
    cycleSidebarView,
    persistSidebarWidth,
    toggleExplorerFocus,
  } = useSidebarPanel(explorerRef);

  const {
    notesRef,
    widthRef: notesWidthRef,
    notesVisible,
    toggleNotes,
    showNotes: showNotesPanel,
    hideNotes: hideNotesPanel,
    persistNotesWidth,
  } = useNotesPanel();
  const {
    agentMonitorRef,
    widthRef: agentMonitorWidthRef,
    agentMonitorVisible,
    showAgentMonitor,
    toggleAgentMonitor,
    hideAgentMonitor,
    persistAgentMonitorWidth,
  } = useAgentMonitorPanel();
  const mutateActiveTabNotes = useCallback<NotesMutator>(
    (updater) => {
      if (activeId != null) updateTabNotes(activeId, updater);
    },
    [activeId, updateTabNotes],
  );
  const [notesDetached, setNotesDetached] = useState(false);
  const detachNotes = useCallback(() => {
    setNotesDetached(true);
    showNotesPanel();
    void openNotesWindow();
  }, [showNotesPanel]);
  const attachNotes = useCallback(() => {
    setNotesDetached(false);
    showNotesPanel();
  }, [showNotesPanel]);
  // Docking back from the main window must also close the floating window
  // (re-attach alone left the undocked window open).
  const dockBackFromMain = useCallback(() => {
    void closeNotesWindow();
    setNotesDetached(false);
    showNotesPanel();
  }, [showNotesPanel]);
  const handleToggleNotes = useCallback(() => {
    if (notesDetached) {
      void openNotesWindow();
      return;
    }
    toggleNotes();
  }, [notesDetached, toggleNotes]);

  const [newEditorOpen, setNewEditorOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [paletteInitialMode, setPaletteInitialMode] = useState<
    "commands" | "content"
  >("commands");
  const openCommandPalette = useCallback(
    (mode: "commands" | "content" = "commands") => {
      setPaletteInitialMode(mode);
      setCommandPaletteOpen(true);
    },
    [],
  );
  const miniOpen = useChatStore((s) => s.mini.open);
  const miniPresence = usePresence(miniOpen, 200);
  const openMini = useChatStore((s) => s.openMini);
  const focusInput = useChatStore((s) => s.focusInput);
  const openPanel = useChatStore((s) => s.openPanel);
  const closePanel = useChatStore((s) => s.closePanel);
  const panelOpen = useChatStore((s) => s.panelOpen);
  const setLive = useChatStore((s) => s.setLive);
  const respondToApproval = useChatStore((s) => s.respondToApproval);

  const { hasComposer, keysLoaded } = useAiBootstrap();

  const activeTab = tabs.find((t) => t.id === activeId);
  const tabNotes = useTabNotes(activeTab?.notes, mutateActiveTabNotes);
  // Type a note's reference at the active shell prompt as a citation. Never
  // executes: newlines are collapsed and no carriage return is sent.
  const writeToActiveShell = useCallback(
    (text: string) => {
      if (activeLeafId === null) return;
      const term = terminalRefs.current.get(activeLeafId);
      if (!term) return;
      const line = text.replace(/[\r\n]+/g, " ").trim();
      if (!line) return;
      term.write(line);
      term.focus();
    },
    [activeLeafId],
  );
  const citeNoteToShell = useCallback(
    (card: NoteCard) => writeToActiveShell(cardCitation(card)),
    [writeToActiveShell],
  );
  useNotesWindowBridge({
    detached: notesDetached,
    activeTabId: activeId ?? null,
    activeTabTitle: activeTab?.title ?? null,
    notes: tabNotes.notes,
    api: tabNotes,
    onCite: writeToActiveShell,
    onWindowClosed: attachNotes,
  });
  const notesApiRef = useRef(tabNotes);
  notesApiRef.current = tabNotes;
  const isTerminalTab = activeTab?.kind === "terminal";
  const isBlockTab = activeTerminalTab?.blocks === true;
  const isEditorTab = activeTab?.kind === "editor";
  const isGitHistoryTab = activeTab?.kind === "git-history";

  useEditorFileSync({ tabs, tabsRef, editorRefs });
  useThemeFileEditing({ tabsRef, openFileTab });

  const { explorerRoot, inheritedCwdForNewTab } = useWorkspaceCwd(
    activeTab,
    tabs,
    launchCwd ?? home,
  );

  useWindowTitle(activeTab, explorerRoot);

  useEffect(() => {
    setActiveSearchAddon(
      activeLeafId !== null
        ? (searchAddons.current.get(activeLeafId) ?? null)
        : null,
    );
    setActiveEditorHandle(editorRefs.current.get(activeId) ?? null);
  }, [activeId, activeLeafId]);

  const handleSearchReady = useCallback(
    (leafId: number, addon: SearchAddon) => {
      searchAddons.current.set(leafId, addon);
      if (leafId === activeLeafId) setActiveSearchAddon(addon);
    },
    [activeLeafId],
  );

  const disposeTab = useCallback(
    (id: number) => {
      // Terminal-leaf-keyed maps (terminalRefs/searchAddons) are pruned by
      // the effect below as the pane tree changes; only the tab-id-keyed
      // handles need explicit cleanup here.
      editorRefs.current.delete(id);
      previewRefs.current.delete(id);
      closeTab(id);
    },
    [closeTab],
  );

  const {
    pendingCloseTab,
    pendingTerminalCloseTab,
    pendingDeleteTabs,
    handleClose,
    confirmClose,
    cancelClose,
    confirmTerminalClose,
    cancelTerminalClose,
    confirmDeleteClose,
    cancelDeleteClose,
    handlePathDeleted,
  } = useTabCloseGuards({ tabs, disposeTab });

  const { pendingAppClose, confirmAppClose, cancelAppClose } =
    useAppCloseGuard(tabsRef);

  useEffect(() => {
    const live = new Set<number>();
    for (const t of tabs) {
      if (t.kind === "terminal") {
        for (const id of leafIds(t.paneTree)) live.add(id);
      }
    }
    for (const id of liveLeavesRef.current) {
      if (!live.has(id)) disposeSession(id);
    }
    liveLeavesRef.current = live;
    for (const k of [...terminalRefs.current.keys()])
      if (!live.has(k)) terminalRefs.current.delete(k);
    for (const k of [...searchAddons.current.keys()])
      if (!live.has(k)) searchAddons.current.delete(k);
  }, [tabs]);

  const cycleTab = useCallback(
    (delta: 1 | -1) => {
      const scoped = tabsRef.current.filter(
        (t) => t.spaceId === (activeSpaceId ?? DEFAULT_SPACE_ID),
      );
      if (scoped.length < 2) return;
      const idx = scoped.findIndex((t) => t.id === activeId);
      const nextIdx = (idx + delta + scoped.length) % scoped.length;
      setActiveId(scoped[nextIdx].id);
    },
    [activeId, activeSpaceId, setActiveId],
  );

  const cycleSpace = useCallback((delta: 1 | -1) => {
    const { spaces, activeId: sid, setActive } = useSpaces.getState();
    if (spaces.length < 2) return;
    const idx = spaces.findIndex((s) => s.id === sid);
    const next = (idx + delta + spaces.length) % spaces.length;
    setActive(spaces[next].id);
  }, []);

  const captureActiveSelection = useCallback((): string | null => {
    const t = tabs.find((x) => x.id === activeId);
    if (!t) return null;
    if (t.kind === "terminal") {
      const lid = t.activeLeafId;
      return terminalRefs.current.get(lid)?.getSelection() ?? null;
    }
    if (t.kind === "editor") {
      return editorRefs.current.get(activeId)?.getSelection() ?? null;
    }
    return null;
  }, [tabs, activeId]);

  // A real toggle in every state. Without a provider the panel shows the
  // connect bar rather than jumping to Settings: that bar carries the same
  // action, and routing elsewhere left the shortcut unable to close what the
  // status-bar button had opened.
  const togglePanelAndFocus = useCallback(() => {
    if (panelOpen) {
      closePanel();
      return;
    }
    openPanel();
    if (hasComposer) focusInput(null);
  }, [hasComposer, panelOpen, openPanel, closePanel, focusInput]);

  const attachSelection = useChatStore((s) => s.attachSelection);

  const handleAttachFileToAgent = useCallback(
    (path: string) => {
      if (!hasComposer) {
        void openSettingsWindow("models");
        return;
      }
      // Dispatch a window event the composer listens for. Same pattern as
      // selections — keeps file-explorer decoupled from the AI module.
      window.dispatchEvent(
        new CustomEvent<string>("terax:ai-attach-file", { detail: path }),
      );
      openPanel();
      focusInput(null);
    },
    [hasComposer, openPanel, focusInput],
  );

  const askFromSelection = useCallback(() => {
    if (!hasComposer) {
      void openSettingsWindow("models");
      return;
    }
    const selection = captureActiveSelection();
    if (!selection || !selection.trim()) {
      focusInput(null);
      return;
    }
    const source: "terminal" | "editor" =
      activeTab?.kind === "editor" ? "editor" : "terminal";
    attachSelection(selection, source);
  }, [
    hasComposer,
    captureActiveSelection,
    focusInput,
    attachSelection,
    activeTab,
  ]);

  const addSelectionToNote = useCallback(() => {
    const selection = captureActiveSelection();
    if (!selection?.trim()) return;
    tabNotes.addFromInput(selection);
    showNotesPanel();
    if (notesDetached) void openNotesWindow();
  }, [
    captureActiveSelection,
    tabNotes,
    showNotesPanel,
    notesDetached,
  ]);

  const { askPopup, setAskPopup, onAskFromSelection, onAddToNoteFromSelection } =
    useSelectionAskAi({
      captureActiveSelection,
      askFromSelection,
      addSelectionToNote,
    });
  const onOpenMermaidFromSelection = useCallback(() => {
    const selection = captureActiveSelection();
    if (!selection) return;
    const source = validateMermaidSource(selection);
    if (!source.ok) {
      toast.error(source.message);
      return;
    }
    newMermaidTab(source.source);
    setAskPopup(null);
  }, [captureActiveSelection, newMermaidTab, setAskPopup]);
  const askPresence = usePresence(Boolean(askPopup), 120);

  const openNewTab = useCallback(() => {
    newTab(inheritedCwdForNewTab());
  }, [newTab, inheritedCwdForNewTab]);

  const openNewPrivateTab = useCallback(() => {
    newPrivateTab(inheritedCwdForNewTab());
  }, [newPrivateTab, inheritedCwdForNewTab]);

  const openNewBlockTab = useCallback(() => {
    newBlockTab(inheritedCwdForNewTab());
  }, [newBlockTab, inheritedCwdForNewTab]);

  const sendCd = useCallback(
    (path: string) => {
      if (activeLeafId === null) return;
      const term = terminalRefs.current.get(activeLeafId);
      if (!term) return;
      term.write(`cd ${quoteShellArg(path)}\r`);
      term.focus();
    },
    [activeLeafId],
  );

  const cdInNewTab = useCallback(
    (path: string) => {
      const tabId = newTab(path);
      setTimeout(() => {
        const tab = tabsRef.current.find((x) => x.id === tabId);
        if (!tab || tab.kind !== "terminal") return;
        const t = terminalRefs.current.get(tab.activeLeafId);
        if (!t) return;
        t.write(`cd ${quoteShellArg(path)}\r`);
        t.focus();
      }, 80);
    },
    [newTab],
  );

  // Resolves the terminal leaf a scheduled task should talk to: the linked tab
  // when it is still alive, otherwise a fresh one in the task's directory.
  const ensureTaskTab = useCallback(
    (task: ScheduledTask): Promise<TabTarget | null> => {
      const linked =
        task.tabId === undefined
          ? undefined
          : tabsRef.current.find(
              (t) => t.id === task.tabId && t.kind === "terminal",
            );
      if (linked && linked.kind === "terminal") {
        setActiveId(linked.id);
        const leafId = linked.activeLeafId;
        const agent = useAgentStore.getState().sessions[leafId];
        return Promise.resolve({
          tabId: linked.id,
          leafId,
          agentRunning: agent?.agent === task.agent,
        });
      }
      const tabId = newTab(task.cwd);
      if (task.color) updateTab(tabId, { color: task.color });
      return new Promise((resolve) => {
        // The leaf id only exists after the tab state commits and the pane
        // registers its handle.
        setTimeout(() => {
          const tab = tabsRef.current.find((x) => x.id === tabId);
          if (tab?.kind !== "terminal") {
            resolve(null);
            return;
          }
          resolve({ tabId, leafId: tab.activeLeafId, agentRunning: false });
        }, 120);
      });
    },
    [newTab, updateTab, setActiveId],
  );

  const writeToLeaf = useCallback((leafId: number, data: string) => {
    const term = terminalRefs.current.get(leafId);
    if (!term) return;
    term.write(data);
  }, []);

  const shiftEnterFor = useCallback((leafId: number) => {
    return terminalRefs.current.get(leafId)?.shiftEnter() ?? "\x1b\r";
  }, []);

  const isTaskLeafReady = useCallback(
    (leafId: number) => isLeafTuiReady(leafId),
    [],
  );

  // Enough of the screen to see an agent start a turn, without paying for the
  // whole scrollback on every poll.
  const readTaskLeafBuffer = useCallback(
    (leafId: number) => terminalRefs.current.get(leafId)?.getBuffer(60) ?? null,
    [],
  );

  const openTerminalWith = useCallback(
    (cwd: string, commandLine: string) => {
      const tabId = newTab(cwd);
      setTimeout(() => {
        const tab = tabsRef.current.find((x) => x.id === tabId);
        if (tab?.kind !== "terminal") return;
        const t = terminalRefs.current.get(tab.activeLeafId);
        if (!t) return;
        t.write(`${commandLine}\r`);
        t.focus();
      }, 120);
    },
    [newTab],
  );

  const {
    tasksRef,
    widthRef: tasksWidthRef,
    tasksVisible,
    toggleTasks,
    showTasks: showTasksPanel,
    hideTasks: hideTasksPanel,
    persistTasksWidth,
  } = useTasksPanel();

  const {
    graphRef,
    widthRef: graphWidthRef,
    graphVisible,
    hideGraph: hideGraphPanel,
    showGraph: showGraphPanel,
    toggleGraph: toggleGraphPanel,
    persistGraphWidth,
  } = useSessionGraphPanel();
  const scheduled = useScheduledTasks();
  const scheduledRef = useRef(scheduled);
  scheduledRef.current = scheduled;
  const notifyTask = useCallback(
    (message: string, tone: "info" | "warning" | "error") => {
      if (tone === "error") toast.error(message);
      else if (tone === "warning") toast.warning(message);
      else toast(message);
    },
    [],
  );
  const markTaskDispatched = useCallback(
    (taskId: string, at: number, sessionId: string) => {
      const task = scheduled.tasks.find((t) => t.id === taskId);
      if (!task) return;
      // A task that accumulates context remembers the session this run created,
      // so the next run knows to resume it instead of creating it again.
      const owns =
        task.mode === "task" &&
        !task.sessions.some((session) => session.id === sessionId);
      scheduled.update(taskId, {
        lastRunAt: at,
        runCount: task.runCount + 1,
        ...(owns
          ? { sessions: [{ id: sessionId, cwd: task.cwd }, ...task.sessions] }
          : {}),
      });
    },
    [scheduled],
  );
  const disableTaskAfterFailures = useCallback(
    (taskId: string) => scheduled.setEnabled(taskId, false),
    [scheduled],
  );
  const dispatcher = useTaskDispatcher({
    tasks: scheduled.tasks,
    paused: scheduled.paused,
    shellFlavor: IS_WINDOWS ? "windows" : "posix",
    recordRun: scheduled.recordRun,
    markDispatched: markTaskDispatched,
    disableTask: disableTaskAfterFailures,
    notify: notifyTask,
    ensureTab: ensureTaskTab,
    writeToLeaf,
    shiftEnterFor,
    isLeafTuiReady: isTaskLeafReady,
    readLeafBuffer: readTaskLeafBuffer,
    openTerminalWith,
  });
  const dispatcherRef = useRef(dispatcher);
  dispatcherRef.current = dispatcher;
  const tasksScheduler = useTasksScheduler({
    tasks: scheduled.tasks,
    paused: scheduled.paused,
    hydrated: scheduled.hydrated,
    run: dispatcher.run,
    reschedule: scheduled.rescheduleOne,
    notify: notifyTask,
  });
  const tasksSchedulerRef = useRef(tasksScheduler);
  tasksSchedulerRef.current = tasksScheduler;
  const [taskEditorOpen, setTaskEditorOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const editingTask =
    editingTaskId === null
      ? null
      : (scheduled.tasks.find((t) => t.id === editingTaskId) ?? null);
  const openNewTaskEditor = useCallback(() => {
    setEditingTaskId(null);
    setTaskEditorOpen(true);
  }, []);
  const cloneTaskAndEdit = useCallback(
    (id: string) => {
      const copy = scheduledRef.current.clone(id);
      if (!copy) return;
      setEditingTaskId(copy.id);
      setTaskEditorOpen(true);
      toast(`${copy.name} created, disabled until you enable it`);
    },
    [],
  );
  const regenerateTaskSeed = useCallback((id: string) => {
    const task = scheduledRef.current.readTasks().find((t) => t.id === id);
    scheduledRef.current.regenerate(id);
    if (task) toast(`${task.name} will start a new session on its next run`);
  }, []);
  const openTaskEditor = useCallback((id: string) => {
    setEditingTaskId(id);
    setTaskEditorOpen(true);
  }, []);
  const closeTaskEditor = useCallback(() => {
    setTaskEditorOpen(false);
    setEditingTaskId(null);
  }, []);

  const handleOpenFile = useCallback(
    (path: string, pin?: boolean) => {
      // Markdown opens in its rendered view by default; a per-tab toggle flips
      // it to the raw editor. Other files default to preview (pin=false);
      // explicit actions like context-menu "Open" pass pin=true to persist.
      if (isMarkdownPath(path)) newMarkdownTab(path);
      else openFileTab(path, pin ?? false);
    },
    [openFileTab, newMarkdownTab],
  );

  const handleOpenTerminalFileLink = useCallback(
    (path: string) => {
      openFileTab(path, true);
    },
    [openFileTab],
  );

  const handlePathRenamed = useCallback(
    (from: string, to: string) => {
      for (const t of tabs) {
        if (t.kind !== "editor") continue;
        if (t.path === from) {
          const i = to.lastIndexOf("/");
          updateTab(t.id, { path: to, title: i === -1 ? to : to.slice(i + 1) });
        } else if (t.path.startsWith(`${from}/`)) {
          const suffix = t.path.slice(from.length);
          const newPath = `${to}${suffix}`;
          const i = newPath.lastIndexOf("/");
          updateTab(t.id, {
            path: newPath,
            title: i === -1 ? newPath : newPath.slice(i + 1),
          });
        }
      }
    },
    [tabs, updateTab],
  );

  const activeTerminalLeafCwd =
    activeTab?.kind === "terminal"
      ? (findLeafCwd(activeTab.paneTree, activeTab.activeLeafId) ??
        activeTab.cwd ??
        null)
      : null;

  const activeFilePath = (() => {
    if (activeTab?.kind === "editor") return activeTab.path;
    if (activeTab?.kind === "git-diff") {
      if (/^([A-Za-z]:|\/|\\)/.test(activeTab.path)) return activeTab.path;
      const root = activeTab.repoRoot.replace(/[\\/]+$/, "");
      const rel = activeTab.path.replace(/^[\\/]+/, "");
      return `${root}/${rel}`;
    }
    if (activeTab?.kind === "git-commit-file") {
      const root = activeTab.repoRoot.replace(/[\\/]+$/, "");
      const rel = activeTab.path.replace(/^[\\/]+/, "");
      return `${root}/${rel}`;
    }
    return null;
  })();
  const explorerActiveFilePath =
    activeTab?.kind === "editor" || activeTab?.kind === "markdown"
      ? activeTab.path
      : null;
  const {
    sourceControl,
    toggleSourceControl,
    openGitGraphFromContext,
    openReviewFromContext,
  } = useSourceControlContext({
    activeTab,
    tabs,
    activeTerminalLeafCwd,
    explorerRoot,
    launchCwd,
    launchCwdResolved,
    home,
    sidebarView,
    cycleSidebarView,
    openCommitHistoryTab,
    openPrReviewTab,
  });
  const explorerGitDecorations = usePreferencesStore(
    (s) => s.explorerGitDecorations,
  );

  const openPreviewTab = useCallback(
    (url: string) => {
      const id = newPreviewTab(url);
      // Focus the address bar if the URL is empty so the user can type.
      if (!url) {
        setTimeout(() => previewRefs.current.get(id)?.focusAddressBar(), 0);
      }
      return id;
    },
    [newPreviewTab],
  );

  const splitActivePaneInActiveTab = useCallback(
    (dir: "row" | "col") => {
      const t = tabsRef.current.find((x) => x.id === activeId);
      if (!t || t.kind !== "terminal") return;
      splitActivePane(activeId, dir);
    },
    [activeId, splitActivePane],
  );

  const handleCloseTabOrPane = useCallback(() => {
    const t = tabsRef.current.find((x) => x.id === activeId);
    if (t?.kind === "terminal" && leafIds(t.paneTree).length > 1) {
      closeActivePane(activeId);
      return;
    }
    void handleClose(activeId);
  }, [activeId, closeActivePane, handleClose]);

  const [zenMode, setZenMode] = useState(false);

  const clearActiveTerminal = useCallback(() => {
    if (!document.activeElement?.closest(".xterm")) return;
    if (!activeTerminalTab || activeLeafId === null) return;
    terminalRefs.current.get(activeLeafId)?.write("\x0c");
  }, [activeTerminalTab, activeLeafId]);

  const shortcutHandlers = useMemo<ShortcutHandlers>(
    () => ({
      "commandPalette.open": () => openCommandPalette("commands"),
      "commandPalette.content": () => openCommandPalette("content"),
      "tab.new": openNewTab,
      "tab.newBlock": openNewBlockTab,
      "tab.newPrivate": openNewPrivateTab,
      "tab.newPreview": () => openPreviewTab(""),
      "tab.newEditor": () => setNewEditorOpen(true),
      "tab.close": handleCloseTabOrPane,
      "tab.next": () => cycleTab(1),
      "tab.prev": () => cycleTab(-1),
      "tab.selectByIndex": (e) => selectByIndex(parseInt(e.key, 10) - 1),
      "space.next": () => cycleSpace(1),
      "space.prev": () => cycleSpace(-1),
      "space.overview": () => setSwitcherOpen(true),
      "pane.splitRight": () => splitActivePaneInActiveTab("row"),
      "pane.splitDown": () => splitActivePaneInActiveTab("col"),
      "pane.focusNext": () => focusNextPaneInTab(activeId, 1),
      "pane.focusPrev": () => focusNextPaneInTab(activeId, -1),
      "pane.source": toggleSourceControl,
      "terminal.clear": () => {
        clearFocusedTerminal();
      },
      "terminal.toggleInput": () =>
        window.dispatchEvent(new CustomEvent(TOGGLE_BLOCK_INPUT_EVENT)),
      "blocks.prev": () => navigateFocusedBlocks(-1),
      "blocks.next": () => navigateFocusedBlocks(1),
      "search.focus": () => searchInlineRef.current?.focus(),
      "ai.toggle": togglePanelAndFocus,
      "ai.askSelection": askFromSelection,
      "notes.addSelection": addSelectionToNote,
      "terminal.clearActive": clearActiveTerminal,
      "settings.open": () => void openSettingsWindow(),
      "sidebar.toggle": toggleSidebar,
      "explorer.focus": toggleExplorerFocus,
      "view.zoomIn": zoomIn,
      "view.zoomOut": zoomOut,
      "view.zoomReset": zoomReset,
      "view.zenMode": () => setZenMode((v) => !v),
      "editor.undo": () => editorRefs.current.get(activeId)?.undo(),
      "editor.redo": () => editorRefs.current.get(activeId)?.redo(),
    }),
    [
      activeId,
      openCommandPalette,
      cycleTab,
      cycleSpace,
      handleCloseTabOrPane,
      openNewTab,
      openNewBlockTab,
      openNewPrivateTab,
      openPreviewTab,
      selectByIndex,
      splitActivePaneInActiveTab,
      focusNextPaneInTab,
      clearActiveTerminal,
      toggleSourceControl,
      togglePanelAndFocus,
      askFromSelection,
      addSelectionToNote,
      toggleSidebar,
      toggleExplorerFocus,
      zoomIn,
      zoomOut,
      zoomReset,
    ],
  );

  const shortcutsDisabled = useCallback(
    (id: ShortcutId, e: KeyboardEvent) => {
      if (id === "editor.undo" || id === "editor.redo") {
        return activeTab?.kind !== "editor";
      }
      if (id === "ai.askSelection") {
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        const inTerminal = !!(target as HTMLElement | null)?.closest?.(
          ".xterm",
        );
        if (!inTerminal) return false;
        const sel = captureActiveSelection();
        return !sel || !sel.trim();
      }
      if (id === "notes.addSelection") {
        // Only claim the binding when there is a selection to add; otherwise
        // let the key fall through (never preventDefault when disabled).
        return !captureActiveSelection()?.trim();
      }
      if (id === "terminal.clear") {
        // Only intercept ⌘K while a terminal is focused; elsewhere let the key
        // fall through (we never preventDefault when disabled).
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        return !(target as HTMLElement | null)?.closest?.(".xterm");
      }
      if (id === "terminal.clearActive") {
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        return !target?.closest?.(".xterm");
      }
      if (
        id === "terminal.toggleInput" ||
        id === "blocks.prev" ||
        id === "blocks.next"
      ) {
        return !(activeTab?.kind === "terminal" && activeTab.blocks === true);
      }
      if (id === "sidebar.toggle") {
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        const inTerminal = !!(target as HTMLElement | null)?.closest?.(
          ".xterm",
        );
        return inTerminal && !e.shiftKey;
      }
      return false;
    },
    [activeTab, captureActiveSelection],
  );

  useGlobalShortcuts(shortcutHandlers, { isDisabled: shortcutsDisabled });

  const registerTerminalHandle = useCallback(
    (leafId: number, h: TerminalPaneHandle | null) => {
      if (h) terminalRefs.current.set(leafId, h);
      else terminalRefs.current.delete(leafId);
    },
    [],
  );

  const registerEditorHandle = useCallback(
    (id: number, h: EditorPaneHandle | null) => {
      if (h) {
        editorRefs.current.set(id, h);
        const line = pendingGotoLine.current.get(id);
        if (line != null) {
          pendingGotoLine.current.delete(id);
          h.gotoLine(line);
        }
      } else {
        editorRefs.current.delete(id);
      }
      if (id === activeId) setActiveEditorHandle(h);
    },
    [activeId],
  );

  const registerPreviewHandle = useCallback(
    (id: number, h: PreviewPaneHandle | null) => {
      if (h) previewRefs.current.set(id, h);
      else previewRefs.current.delete(id);
    },
    [],
  );

  const handlePreviewUrl = useCallback(
    (id: number, url: string) => updateTab(id, { url }),
    [updateTab],
  );

  const authorizedCwds = useRef(new Set<string>());
  const handleTerminalCwd = useCallback(
    (leafId: number, cwd: string) => {
      setLeafCwd(leafId, cwd);
      if (cwd && !authorizedCwds.current.has(cwd)) {
        authorizedCwds.current.add(cwd);
        native.workspaceAuthorize(cwd).catch(() => {
          authorizedCwds.current.delete(cwd);
        });
      }
    },
    [setLeafCwd],
  );

  const handleFocusLeaf = useCallback(
    (tabId: number, leafId: number) => focusPane(tabId, leafId),
    [focusPane],
  );

  const onActivateAgent = useCallback(
    (tabId: number, leafId: number) => {
      setActiveId(tabId);
      focusPane(tabId, leafId);
    },
    [setActiveId, focusPane],
  );

  const onActivateLocalAgent = useCallback(() => {
    openPanel();
    focusInput(null);
  }, [openPanel, focusInput]);

  const handleLeafExit = useCallback(
    (leafId: number, _code: number) => {
      const all = tabsRef.current;
      const tab = all.find(
        (t) => t.kind === "terminal" && hasLeaf(t.paneTree, leafId),
      );
      if (!tab || tab.kind !== "terminal") return;
      const isLast =
        leafIds(tab.paneTree).length === 1 &&
        all.filter((t) => t.kind === "terminal").length === 1;
      if (isLast) {
        void respawnSession(leafId, tab.cwd);
      } else {
        closePaneByLeaf(leafId);
      }
    },
    [closePaneByLeaf],
  );

  const handleEditorDirty = useCallback(
    (id: number, dirty: boolean) => updateTab(id, { dirty }),
    [updateTab],
  );

  const handleRenameTab = useCallback(
    (id: number, title: string) => updateTab(id, { customTitle: title.trim() }),
    [updateTab],
  );

  const handleSetTabColor = useCallback(
    (id: number, color: TabColor | null) => updateTab(id, { color }),
    [updateTab],
  );

  const searchTarget = useMemo<SearchTarget>(() => {
    if (isTerminalTab && activeLeafId !== null && activeSearchAddon)
      return {
        kind: "terminal",
        addon: activeSearchAddon,
        focus: () => terminalRefs.current.get(activeLeafId)?.focus(),
      };
    if (isEditorTab && activeEditorHandle)
      return {
        kind: "editor",
        handle: activeEditorHandle,
        focus: () => activeEditorHandle.focus(),
      };
    if (isGitHistoryTab && gitHistoryHandle)
      return {
        kind: "git-history",
        handle: gitHistoryHandle,
        focus: () => {},
      };
    return null;
  }, [
    isTerminalTab,
    isEditorTab,
    isGitHistoryTab,
    activeLeafId,
    activeSearchAddon,
    activeEditorHandle,
    gitHistoryHandle,
  ]);

  const activeCwd = activeTerminalLeafCwd;
  // Command handlers run outside render, so they read the cwd through a ref.
  const activeCwdRef = useRef(activeCwd);
  activeCwdRef.current = activeCwd;

  // The history panel follows whichever agent the focused terminal runs. Agent
  // detection is heuristic and reports free-form names, so it is narrowed to the
  // two agents that actually persist a navigable transcript. Subscribed rather
  // than read from getState so the panel re-resolves when the agent changes.
  const activeAgentName = useAgentStore((state) =>
    activeLeafId != null ? (state.sessions[activeLeafId]?.agent ?? null) : null,
  );
  const graphAgentHint = agentKindFromName(activeAgentName);

  const terminalTabs = useMemo(
    () => tabs.filter((tab) => tab.kind === "terminal"),
    [tabs],
  );
  const terminalSources = useMemo(
    () =>
      collectTerminalSources(
        terminalTabs.map((tab) => ({
          id: tab.id,
          title: tab.title,
          cwd: tab.cwd ?? null,
          activeLeafId: tab.activeLeafId,
          paneTree: tab.paneTree,
        })),
      ),
    [terminalTabs],
  );

  // The panel follows the focused terminal, but focus moves to editors and
  // diagrams constantly and those own no transcript, so the last terminal is
  // held rather than blanking the panel mid-read.
  const focusedTerminal = useMemo(
    () =>
      activeTab?.kind === "terminal" && activeCwd
        ? {
            tabId: activeTab.id,
            leafId: activeTab.activeLeafId,
            tabTitle: activeTab.title,
            cwd: activeCwd,
          }
        : null,
    [activeTab, activeCwd],
  );
  const terminalBindingRef = useRef<TerminalBinding | null>(null);
  terminalBindingRef.current = nextTerminalBinding(
    terminalBindingRef.current,
    focusedTerminal,
    terminalTabs.map((tab) => tab.id),
  );
  const graphBinding = terminalBindingRef.current;

  const {
    agent: graphAgent,
    sessionId: graphSessionId,
    candidates: graphCandidates,
    groups: graphSourceGroups,
  } = useResolvedSession(graphAgentHint, graphBinding, terminalSources);

  const handlePrReviewBaseChange = useCallback(
    (tabId: number, base: string) => {
      setPrReviewBase(tabId, base);
    },
    [setPrReviewBase],
  );

  const handleNewSpace = useCallback(() => {
    const { spaces, create, setActive } = useSpaces.getState();
    const meta = create({
      name: `Space ${spaces.length + 1}`,
      root: activeCwd ?? home ?? null,
      env: workspaceEnv,
    });
    setActiveSpaceForNewTabs(meta.id);
    newTab(activeCwd ?? undefined);
    setActive(meta.id);
    return meta.id;
  }, [activeCwd, home, workspaceEnv, newTab, setActiveSpaceForNewTabs]);

  const handleDeleteSpace = useCallback(
    (id: string) => {
      useSpaces.getState().remove(id);
      removeTabsForSpace(id);
    },
    [removeTabsForSpace],
  );

  const handleMoveTab = useCallback(
    (tabId: number, targetSpaceId: string) => {
      if (moveTabToSpace(tabId, targetSpaceId)) {
        useSpaces.getState().setActive(targetSpaceId);
      }
    },
    [moveTabToSpace],
  );

  const handleReorderTab = useCallback(
    (tabId: number, targetTabId: number, edge: "top" | "bottom") => {
      if (reorderTab(tabId, targetTabId, edge)) {
        const target = tabsRef.current.find((x) => x.id === targetTabId);
        if (target) useSpaces.getState().setActive(target.spaceId);
      }
    },
    [reorderTab],
  );

  const handleNewTabInSpace = useCallback(
    (spaceId: string) => {
      const root = useSpaces
        .getState()
        .spaces.find((s) => s.id === spaceId)?.root;
      newTabInSpace(spaceId, root ?? undefined);
    },
    [newTabInSpace],
  );

  const jumpToTab = useCallback(
    (tabId: number) => {
      const t = tabsRef.current.find((x) => x.id === tabId);
      if (!t) return;
      setActiveId(tabId);
      useSpaces.getState().setActive(t.spaceId);
      setSwitcherOpen(false);
    },
    [setActiveId],
  );

  const spaceSwitcher = (
    <SpaceSwitcher
      open={switcherOpen}
      onOpenChange={setSwitcherOpen}
      tabs={tabs}
      onNewSpace={() => void handleNewSpace()}
      onDeleteSpace={handleDeleteSpace}
      onNewTabInSpace={handleNewTabInSpace}
      onJumpTab={jumpToTab}
      onCloseTab={handleClose}
      onMoveTabToSpace={handleMoveTab}
      onReorderTab={handleReorderTab}
      onReorderSpaces={(ids) => useSpaces.getState().reorder(ids)}
    />
  );

  const commandPaletteItems = useMemo(
    () =>
      commandPaletteOpen
        ? createCommandItems({
            tabs,
            activeId,
            searchTarget,
            explorerRoot,
            home,
            openNewTab,
            openNewBlock: openNewBlockTab,
            openNewPrivate: openNewPrivateTab,
            openNewEditor: () => setNewEditorOpen(true),
            openNewPreview: () => openPreviewTab(""),
            openGitGraph: openGitGraphFromContext,
            toggleSourceControl,
            closeActiveTabOrPane: handleCloseTabOrPane,
            splitPaneRight: () => splitActivePaneInActiveTab("row"),
            splitPaneDown: () => splitActivePaneInActiveTab("col"),
            focusSearch: () => searchInlineRef.current?.focus(),
            focusExplorerSearch: () => explorerRef.current?.focusSearch(),
            toggleSidebar,
            toggleNotes: handleToggleNotes,
            toggleTasks,
            newScheduledTask: openNewTaskEditor,
            toggleAi: togglePanelAndFocus,
            askAiSelection: askFromSelection,
            openSettings: () => void openSettingsWindow(),
            openKeyboardShortcuts: () => void openSettingsWindow("shortcuts"),
            spaces: useSpaces.getState().spaces,
            activeSpaceId,
            openSpacesOverview: () => setSwitcherOpen(true),
            newSpace: () => void handleNewSpace(),
            switchSpace: (id) => useSpaces.getState().setActive(id),
          })
        : [],
    [
      commandPaletteOpen,
      tabs,
      activeId,
      searchTarget,
      explorerRoot,
      home,
      openNewTab,
      openNewBlockTab,
      openNewPrivateTab,
      openPreviewTab,
      openGitGraphFromContext,
      toggleSourceControl,
      handleCloseTabOrPane,
      splitActivePaneInActiveTab,
      toggleSidebar,
      handleToggleNotes,
      toggleTasks,
      openNewTaskEditor,
      togglePanelAndFocus,
      askFromSelection,
      activeSpaceId,
      handleNewSpace,
    ],
  );

  const externalCommandHandlers = useMemo<CommandHandlers>(
    () => ({
      getSnapshot: () =>
        buildAppSnapshot({
          tabs: tabsRef.current,
          activeTabId: activeIdRef.current,
          activeSpaceId,
          sidebar: {
            visible:
              (sidebarRef.current?.getSize().asPercentage ??
                sidebarWidthRef.current) > 0,
            view: sidebarView,
          },
          ...(scheduledRef.current.readTasks().length > 0
            ? {
                scheduledTasks: {
                  paused: scheduledRef.current.paused,
                  tasks: scheduledRef.current.readTasks().map((task) => ({
                    id: task.id,
                    name: task.name,
                    prompt: task.prompt,
                    schedule: formatScheduleSpec(task.schedule),
                    enabled: task.enabled,
                    mode: task.mode,
                    target: task.target,
                    missed: task.missed,
                    ...(task.tabId !== undefined ? { tabId: task.tabId } : {}),
                    nextRunAt: task.nextRunAt ?? null,
                    ...(task.lastRunAt !== undefined
                      ? { lastRunAt: task.lastRunAt }
                      : {}),
                    runCount: task.runCount,
                    ...(task.maxRuns !== undefined
                      ? { maxRuns: task.maxRuns }
                      : {}),
                    running: dispatcherRef.current.runningIds.includes(task.id),
                    queued: dispatcherRef.current.queuedIds.includes(task.id),
                  })),
                },
              }
            : {}),
        }),
      getBuildInfo: () => ({
        repository: BUILD_INFO.repository,
        branch: BUILD_INFO.branch,
        commit: BUILD_INFO.commit,
        channel: BUILD_INFO.channel,
      }),
      capture: async (payload) => {
        try {
          return await captureSurface(
            payload,
            tabsRef.current,
            activeIdRef.current,
          );
        } catch (error) {
          throw {
            code: "command_failed",
            message: error instanceof Error ? error.message : "Capture failed",
          };
        }
      },
      showSidebar: ({ view }) => {
        showSidebar(view);
        return { visible: true, view: view ?? sidebarView };
      },
      hideSidebar: () => {
        hideSidebar();
        return { visible: false };
      },
      openFile: ({ path, pin }) => {
        handleOpenFile(path, pin);
        return { opened: true };
      },
      openPreview: ({ url, title }) => {
        const existing = tabsRef.current.find(
          (t) => t.kind === "preview" && samePreviewUrl(t.url, url),
        );
        const tabId = existing?.id ?? openPreviewTab(url);
        if (existing) {
          useSpaces.getState().setActive(existing.spaceId);
          setActiveId(existing.id);
        }
        const customTitle = title?.trim();
        if (customTitle) updateTab(tabId, { customTitle });
        return { tabId, url, created: !existing };
      },
      openMermaid: async ({ source, title }) => {
        const tabId = newMermaidTab(source, title ?? "Mermaid diagram");
        await waitForMermaidPane(tabId);
        return { tabId, title: title ?? "Mermaid diagram" };
      },
      updateMermaid: async ({ tabId, source, title }) => {
        const tab = tabsRef.current.find((candidate) => candidate.id === tabId);
        if (!tab || tab.kind !== "mermaid") {
          throw {
            code: "command_failed",
            message: `Mermaid tab ${tabId} not found`,
          };
        }
        const updated = replaceMermaidTabContent(tabId, source, title);
        if (!updated) {
          throw {
            code: "command_failed",
            message: `Mermaid tab ${tabId} could not be updated`,
          };
        }
        const committed = await waitForMermaidTabReplacement(
          () => tabsRef.current,
          tabId,
          source,
          title,
        );
        return {
          tabId,
          title: committed.customTitle ?? committed.title,
        };
      },
      focusTab: ({ tabId }) => {
        const tab = tabsRef.current.find((t) => t.id === tabId);
        if (!tab) {
          throw { code: "command_failed", message: `Tab ${tabId} not found` };
        }
        useSpaces.getState().setActive(tab.spaceId);
        activeIdRef.current = tabId;
        setActiveId(tabId);
        return { tabId, spaceId: tab.spaceId };
      },
      closeTab: ({ tabId }) => {
        void handleClose(tabId ?? activeId);
        return { requested: true, tabId: tabId ?? activeId };
      },
      renameTab: ({ tabId, title }) => {
        updateTab(tabId, { customTitle: title.trim() });
        return { tabId };
      },
      resetTabTitle: ({ tabId }) => {
        updateTab(tabId, { customTitle: "" });
        return { tabId };
      },
      setTabColor: ({ tabId, color }) => {
        const tab = tabsRef.current.find((t) => t.id === tabId);
        if (!tab) {
          throw { code: "command_failed", message: `Tab ${tabId} not found` };
        }
        updateTab(tabId, { color });
        return { tabId };
      },
      openGitDiff: (payload) => {
        const tabId = openGitDiffTab(payload);
        return { tabId };
      },
      openGitHistory: ({ repoRoot, branch }) => {
        const tabId = openCommitHistoryTab({ repoRoot, branch });
        return { tabId };
      },
      openCommitFile: ({ repoRoot, sha, path, originalPath, subject }) => {
        const tabId = openCommitFileDiffTab({
          repoRoot,
          sha,
          shortSha: sha.slice(0, 7),
          subject: subject ?? "",
          path,
          originalPath: originalPath ?? null,
        });
        return { tabId };
      },
      searchContent: async ({ query, root, caseInsensitive, maxResults }) => {
        // Pi is an external caller, so the same deny-list the in-app AI tools
        // use guards the root and every hit: a match must never reveal a path
        // the agent is not allowed to read.
        const safety = await checkReadableCanonical(root, (p) =>
          native.canonicalize(p),
        );
        if (!safety.ok) {
          throw { code: "command_failed", message: safety.reason };
        }
        let response: Awaited<ReturnType<typeof native.grep>>;
        try {
          response = await native.grep({
            pattern: query,
            root: safety.canonical,
            caseInsensitive,
            maxResults: maxResults ?? 50,
          });
        } catch (error) {
          throw {
            code: "command_failed",
            message: error instanceof Error ? error.message : String(error),
          };
        }
        const hits = response.hits.filter((hit) => {
          const absolute = hit.path.startsWith("/")
            ? hit.path
            : `${safety.canonical}/${hit.path}`;
          return checkReadable(absolute).ok;
        });
        return {
          hits,
          truncated: response.truncated || hits.length !== response.hits.length,
          filesScanned: response.files_scanned,
        };
      },
      moveTab: ({ tabId, index }) => {
        const moved = moveTab(tabId, index);
        if (moved === null) {
          throw { code: "command_failed", message: `Tab ${tabId} not found` };
        }
        return { tabId, index: moved };
      },
      setTabPinned: ({ tabId, pinned }) => {
        if (!setTabPinned(tabId, pinned)) {
          throw {
            code: "command_failed",
            message: `Tab ${tabId} is not an editor tab`,
          };
        }
        return { tabId, pinned };
      },
      openSettings: ({ tab }) => {
        void openSettingsWindow(tab);
        return { opened: true, tab: tab ?? null };
      },
      showAgentMonitor: () => {
        showAgentMonitor();
        return { visible: true };
      },
      hideAgentMonitor: () => {
        hideAgentMonitor();
        return { visible: false };
      },
      toggleAgentMonitor: () => {
        toggleAgentMonitor();
        return { toggled: true };
      },
      showNotes: () => {
        if (notesDetached) {
          void openNotesWindow();
          return { visible: true, detached: true };
        }
        showNotesPanel();
        return { visible: true, detached: false };
      },
      hideNotes: () => {
        hideNotesPanel();
        return { visible: false };
      },
      toggleNotes: () => {
        handleToggleNotes();
        return { toggled: true, detached: notesDetached };
      },
      detachNotes: () => {
        detachNotes();
        return { detached: true };
      },
      attachNotes: () => {
        dockBackFromMain();
        return { detached: false };
      },
      addNote: ({ content }) => {
        if (activeId == null) {
          throw { code: "command_failed", message: "No active tab" };
        }
        const card = notesApiRef.current.addFromInput(content);
        if (!card) {
          throw { code: "command_failed", message: "Empty note content" };
        }
        return { id: card.id, kind: card.kind, tabId: activeId };
      },
      removeNote: ({ id }) => {
        notesApiRef.current.remove(id);
        return { removed: true, id };
      },
      updateNote: ({ id, title, body, url, note }) => {
        const before = notesApiRef.current.notes.find((c) => c.id === id);
        if (!before) {
          throw { code: "command_failed", message: `No note card "${id}"` };
        }
        const patch: NoteCardPatch = {};
        if (typeof title === "string") patch.title = title;
        if (typeof body === "string") patch.body = body;
        if (typeof url === "string") patch.url = url;
        if (typeof note === "string") patch.note = note;
        notesApiRef.current.update(id, patch);
        return { updated: true, id, tabId: activeId ?? null };
      },
      listNotes: () => ({
        tabId: activeId ?? null,
        notes: notesApiRef.current.notes.map((c) => ({
          id: c.id,
          kind: c.kind,
          title: cardTitle(c),
          ...(c.kind === "text" ? { body: c.body } : {}),
          ...("url" in c ? { url: c.url } : {}),
          ...("note" in c && c.note ? { note: c.note } : {}),
          ...(c.kind === "github-pr"
            ? { prState: c.prState, ciState: c.ciState }
            : {}),
          ...(c.kind === "jira" ? { status: c.status } : {}),
        })),
      }),
      showTasks: () => {
        showTasksPanel();
        return { visible: true };
      },
      hideTasks: () => {
        hideTasksPanel();
        return { visible: false };
      },
      toggleTasks: () => {
        toggleTasks();
        return { toggled: true };
      },
      showHistory: () => {
        showGraphPanel();
        return { visible: true };
      },
      hideHistory: () => {
        hideGraphPanel();
        return { visible: false };
      },
      toggleHistory: () => {
        toggleGraphPanel();
        return { toggled: true };
      },
      openTaskEditor: ({ id }) => {
        if (id !== undefined) {
          const current = scheduledRef.current
            .readTasks()
            .find((t) => t.id === id);
          if (!current) {
            throw { code: "command_failed", message: `Task ${id} not found` };
          }
          openTaskEditor(id);
        } else {
          openNewTaskEditor();
        }
        showTasksPanel();
        return { opened: true, id: id ?? null };
      },
      listTasks: () => {
        const api = scheduledRef.current;
        const now = Date.now();
        return {
          paused: api.paused,
          running: dispatcherRef.current.runningIds,
          queued: dispatcherRef.current.queuedIds,
          tasks: api.tasks.map((task) =>
            taskSummary(task, api.runs[task.id] ?? [], now),
          ),
        };
      },
      addTask: (payload) => {
        const input = taskInputFromCommand(
          payload,
          activeCwdRef.current ?? home ?? "",
        );
        if ("error" in input) {
          throw { code: "command_failed", message: input.error };
        }
        const created = scheduledRef.current.add(input);
        showTasksPanel();
        return {
          id: created.id,
          name: created.name,
          cwd: created.cwd,
          nextRunAt: created.nextRunAt ?? null,
        };
      },
      updateTask: ({ id, ...fields }) => {
        const current = scheduledRef.current
          .readTasks()
          .find((t) => t.id === id);
        if (!current) {
          throw { code: "command_failed", message: `Task ${id} not found` };
        }
        const patch = taskPatchFromCommand(fields, current);
        if ("error" in patch) {
          throw { code: "command_failed", message: patch.error };
        }
        scheduledRef.current.update(id, patch);
        return { id, updated: true };
      },
      cloneTask: ({ id }) => {
        const current = scheduledRef.current
          .readTasks()
          .find((t) => t.id === id);
        if (!current) {
          throw { code: "command_failed", message: `Task ${id} not found` };
        }
        const copy = scheduledRef.current.clone(id);
        if (!copy) {
          throw { code: "command_failed", message: `Task ${id} not found` };
        }
        setEditingTaskId(copy.id);
        setTaskEditorOpen(true);
        showTasksPanel();
        // The copy is disabled on purpose: it exists to be edited first.
        return {
          id: copy.id,
          source: id,
          name: copy.name,
          enabled: copy.enabled,
        };
      },
      reseedTask: ({ id }) => {
        const current = scheduledRef.current
          .readTasks()
          .find((t) => t.id === id);
        if (!current) {
          throw { code: "command_failed", message: `Task ${id} not found` };
        }
        const seed = scheduledRef.current.regenerate(id);
        return { id, seed, reseeded: seed !== null };
      },
      removeTask: ({ id }) => {
        const current = scheduledRef.current
          .readTasks()
          .find((t) => t.id === id);
        if (!current) {
          throw { code: "command_failed", message: `Task ${id} not found` };
        }
        scheduledRef.current.remove(id);
        return { id, removed: true };
      },
      runTask: ({ id }) => {
        const current = scheduledRef.current
          .readTasks()
          .find((t) => t.id === id);
        if (!current) {
          throw { code: "command_failed", message: `Task ${id} not found` };
        }
        dispatcherRef.current.run(id, "manual");
        return { id, started: true };
      },
      setTaskEnabled: ({ id, enabled }) => {
        const current = scheduledRef.current
          .readTasks()
          .find((t) => t.id === id);
        if (!current) {
          throw { code: "command_failed", message: `Task ${id} not found` };
        }
        scheduledRef.current.setEnabled(id, enabled);
        return { id, enabled };
      },
      pauseAllTasks: () => {
        scheduledRef.current.setPaused(true);
        return { paused: true };
      },
      resumeAllTasks: () => {
        scheduledRef.current.setPaused(false);
        scheduledRef.current.rescheduleAll();
        return { paused: false };
      },
      wakeTasks: () => {
        const dispatched = tasksSchedulerRef.current.wakeNow();
        return { dispatched, paused: scheduledRef.current.paused };
      },
    }),
    [
      activeId,
      home,
      showTasksPanel,
      hideTasksPanel,
      toggleTasks,
      showAgentMonitor,
      hideAgentMonitor,
      toggleAgentMonitor,
      showGraphPanel,
      hideGraphPanel,
      toggleGraphPanel,
      openTaskEditor,
      openNewTaskEditor,
      activeSpaceId,
      handleClose,
      handleOpenFile,
      hideSidebar,
      openGitDiffTab,
      openPreviewTab,
      newMermaidTab,
      setActiveId,
      showSidebar,
      sidebarRef,
      sidebarView,
      sidebarWidthRef,
      updateTab,
      notesDetached,
      showNotesPanel,
      hideNotesPanel,
      handleToggleNotes,
      detachNotes,
      dockBackFromMain,
    ],
  );

  useExternalCommandBridge(externalCommandHandlers);

  const pendingGotoLine = useRef<Map<number, number>>(new Map());
  const openContentHit = useCallback(
    (path: string, line: number) => {
      const id = openFileTab(path, true);
      if (id == null) return;
      const h = editorRefs.current.get(id);
      if (h) h.gotoLine(line);
      else pendingGotoLine.current.set(id, line);
    },
    [openFileTab],
  );

  const insertHistoryCommand = useMemo(
    () =>
      isTerminalTab && activeLeafId !== null
        ? (cmd: string) => {
            writeToSession(activeLeafId, cmd);
            terminalRefs.current.get(activeLeafId)?.focus();
          }
        : null,
    [isTerminalTab, activeLeafId],
  );

  useAiLiveBridge({
    setLive,
    activeId,
    tabs,
    explorerRoot,
    launchCwd,
    home,
    openPreviewTab,
    newAgentTab,
    terminalRefs,
  });

  const shell = (
    <ThemeProvider>
      <TooltipProvider>
        <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
          {!zenMode && (
            <Header
              tabs={spaceTabs}
              activeId={activeId}
              onSelect={setActiveId}
              onNew={openNewTab}
              onNewBlock={openNewBlockTab}
              onNewPrivate={openNewPrivateTab}
              onNewPreview={() => openPreviewTab("")}
              onNewEditor={() => setNewEditorOpen(true)}
              onNewGitGraph={openGitGraphFromContext}
              onClose={handleClose}
              onPin={pinTab}
              onRename={handleRenameTab}
              onSetColor={handleSetTabColor}
              onReorder={reorderTabByGap}
              onToggleSidebar={toggleSidebar}
              onToggleNotes={handleToggleNotes}
              notesVisible={notesVisible || notesDetached}
              onToggleTasks={toggleTasks}
              tasksVisible={tasksVisible}
              onToggleAgentMonitor={toggleAgentMonitor}
              agentMonitorVisible={agentMonitorVisible}
              onToggleSessionGraph={toggleGraphPanel}
              sessionGraphVisible={graphVisible}
              sessionGraphAgent={graphAgent}
              scheduledCount={
                scheduled.tasks.filter((task) => task.enabled).length
              }
              scheduledPaused={scheduled.paused}
              onOpenCommandPalette={() => openCommandPalette("commands")}
              onActivateAgent={onActivateAgent}
              onActivateLocalAgent={onActivateLocalAgent}
              onOpenSettings={() => void openSettingsWindow()}
              spaceSwitcher={spaceSwitcher}
              searchTarget={searchTarget}
              searchRef={searchInlineRef}
            />
          )}

          <main className="zoom-content flex min-h-0 flex-1 flex-col">
            <ResizablePanelGroup
              orientation="horizontal"
              className="min-h-0 flex-1"
            >
              <ResizablePanel
                id="sidebar"
                panelRef={sidebarRef}
                defaultSize={`${sidebarWidthRef.current}px`}
                minSize={`${SIDEBAR_MIN_WIDTH}px`}
                maxSize={`${SIDEBAR_MAX_WIDTH}px`}
                collapsible
                collapsedSize={0}
                onResize={(size) => {
                  if (size.inPixels > 0) persistSidebarWidth(size.inPixels);
                }}
              >
                <div
                  data-capture-target="sidebar"
                  className="flex h-full min-h-0 flex-col border-r border-border/60 bg-card"
                >
                  <div
                    key={sidebarView}
                    className="min-h-0 flex-1 terax-panel-in"
                  >
                    {sidebarView === "explorer" ? (
                      <FileExplorer
                        ref={explorerRef}
                        rootPath={explorerRoot}
                        gitStatus={
                          explorerGitDecorations ? sourceControl.status : null
                        }
                        activeFilePath={explorerActiveFilePath}
                        onOpenFile={handleOpenFile}
                        onPathRenamed={handlePathRenamed}
                        onPathDeleted={handlePathDeleted}
                        onRevealInTerminal={cdInNewTab}
                        onAttachToAgent={handleAttachFileToAgent}
                      />
                    ) : (
                      <SourceControlPanel
                        open
                        sourceControl={sourceControl}
                        onOpenDiff={openGitDiffTab}
                        onOpenGitGraph={openGitGraphFromContext}
                        onOpenReview={openReviewFromContext}
                        onOpenFile={handleOpenFile}
                      />
                    )}
                  </div>
                  <SidebarRail
                    activeView={sidebarView}
                    onSelectView={persistSidebarView}
                    changedCount={sourceControl.changedCount}
                  />
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel
                id="workspace"
                defaultSize="78%"
                minSize="30%"
              >
                <div className="flex h-full min-h-0 flex-col">
                  <div className="relative min-h-0 flex-1">
                    <WorkspaceSurface
                      tabs={tabs}
                      activeId={activeId}
                      activeTab={activeTab}
                      registerTerminalHandle={registerTerminalHandle}
                      onSearchReady={handleSearchReady}
                      onCwd={handleTerminalCwd}
                      onExit={handleLeafExit}
                      onFocusLeaf={handleFocusLeaf}
                      onOpenFileLink={handleOpenTerminalFileLink}
                      homePath={home}
                      registerEditorHandle={registerEditorHandle}
                      onEditorDirtyChange={handleEditorDirty}
                      onEditorCloseTab={disposeTab}
                      registerPreviewHandle={registerPreviewHandle}
                      onPreviewUrlChange={handlePreviewUrl}
                      onAiDiffAccept={(id) => respondToApproval(id, true)}
                      onAiDiffReject={(id) => respondToApproval(id, false)}
                      onOpenCommitFile={openCommitFileDiffTab}
                      onPrReviewBaseChange={handlePrReviewBaseChange}
                      onGitHistorySearchHandle={setGitHistoryHandle}
                      onSetMarkdownView={setMarkdownView}
                      onMermaidSourceChange={updateMermaidSource}
                      onMermaidVisualLayoutChange={updateMermaidVisualLayout}
                    />
                  </div>

                  <WorkspaceInputBar
                    isBlockTab={isBlockTab}
                    isTerminalTab={isTerminalTab}
                    activeLeafId={activeLeafId}
                    cwd={activeCwd}
                    home={home}
                    hasComposer={hasComposer}
                    panelOpen={panelOpen}
                    keysLoaded={keysLoaded}
                    onConnect={() => void openSettingsWindow("models")}
                    onDismiss={closePanel}
                  />
                </div>
              </ResizablePanel>
              {notesVisible && (
                <>
              <ResizableHandle withHandle />
              <ResizablePanel
                id="notes"
                panelRef={notesRef}
                defaultSize={`${notesWidthRef.current}px`}
                minSize={`${NOTES_MIN_WIDTH}px`}
                maxSize={`${NOTES_MAX_WIDTH}px`}
                onResize={(size) => {
                  if (size.inPixels > 0) persistNotesWidth(size.inPixels);
                }}
              >
                {notesDetached ? (
                  <NotesDockedNotice
                    onFocusWindow={() => void openNotesWindow()}
                    onDock={dockBackFromMain}
                  />
                ) : (
                  <NotesPanel
                    notes={tabNotes.notes}
                    disabled={activeId == null}
                    subtitle={activeTab?.title ?? null}
                    onAddFromInput={tabNotes.addFromInput}
                    onRemove={tabNotes.remove}
                    onUpdate={tabNotes.update}
                    onMove={tabNotes.move}
                    onCite={citeNoteToShell}
                    onHide={hideNotesPanel}
                    onDetach={detachNotes}
                    onRefresh={tabNotes.refresh}
                    onRefreshAll={tabNotes.refreshAll}
                  />
                )}
              </ResizablePanel>
                </>
              )}
              {agentMonitorVisible && (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel
                    id="agent-monitor"
                    panelRef={agentMonitorRef}
                    defaultSize={`${agentMonitorWidthRef.current}px`}
                    minSize={`${AGENT_MONITOR_MIN_WIDTH}px`}
                    maxSize={`${AGENT_MONITOR_MAX_WIDTH}px`}
                    onResize={(size) => {
                      if (size.inPixels > 0) {
                        persistAgentMonitorWidth(size.inPixels);
                      }
                    }}
                  >
                    <AgentMonitorPanel
                      onActivate={onActivateAgent}
                      onHide={hideAgentMonitor}
                      tabs={tabs}
                    />
                  </ResizablePanel>
                </>
              )}
              {tasksVisible && (
                <>
              <ResizableHandle withHandle />
              <ResizablePanel
                id="tasks"
                panelRef={tasksRef}
                defaultSize={`${tasksWidthRef.current}px`}
                minSize={`${TASKS_MIN_WIDTH}px`}
                maxSize={`${TASKS_MAX_WIDTH}px`}
                onResize={(size) => {
                  if (size.inPixels > 0) persistTasksWidth(size.inPixels);
                }}
              >
                <TasksPanel
                  tasks={scheduled.tasks}
                  runs={scheduled.runs}
                  now={scheduled.now}
                  paused={scheduled.paused}
                  runningIds={dispatcher.runningIds}
                  queuedIds={dispatcher.queuedIds}
                  onAdd={openNewTaskEditor}
                  onEdit={openTaskEditor}
                  onClone={cloneTaskAndEdit}
                  onRegenerateSeed={regenerateTaskSeed}
                  onRemove={scheduled.remove}
                  onToggleEnabled={scheduled.setEnabled}
                  onRunNow={(id) => dispatcher.run(id, "manual")}
                  onRecover={dispatcher.recover}
                  onTogglePaused={() => scheduled.setPaused(!scheduled.paused)}
                  onHide={hideTasksPanel}
                />
              </ResizablePanel>
                </>
              )}
              {graphVisible && (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel
                    id="session-graph"
                    panelRef={graphRef}
                    defaultSize={`${graphWidthRef.current}px`}
                    minSize={`${GRAPH_MIN_WIDTH}px`}
                    maxSize={`${GRAPH_MAX_WIDTH}px`}
                    onResize={(size) => {
                      if (size.inPixels > 0) persistGraphWidth(size.inPixels);
                    }}
                  >
                    <SessionGraphPanel
                      agent={graphAgent}
                      sessionId={graphSessionId}
                      candidates={graphCandidates}
                      sources={graphSourceGroups}
                      boundTerminalKey={
                        graphBinding
                          ? `${graphBinding.tabId}:${graphBinding.leafId}`
                          : null
                      }
                      subtitle={graphBinding?.tabTitle ?? null}
                      onHide={hideGraphPanel}
                    />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </main>

          {!zenMode && (
            <StatusBar
              cwd={activeCwd}
              filePath={activeFilePath}
              home={home}
              onCd={sendCd}
              onWorkspaceChange={handleWorkspaceChange}
              onOpenMini={openMini}
              hasComposer={hasComposer}
              privateActive={
                activeTab?.kind === "terminal" && activeTab.private === true
              }
            />
          )}

          <AgentNotificationsBridge
            tabs={tabs}
            activeId={activeId}
            onActivate={onActivateAgent}
          />
          <Toaster position="bottom-right" />

          {hasComposer ? (
            <>
              <AgentRunBridge
                openAiDiffTab={openAiDiffTab}
                closeAiDiffTab={closeAiDiffTab}
              />
              <LocalAgentNotificationsBridge />
            </>
          ) : null}

          {hasComposer && miniPresence.mounted ? (
            <AiMiniWindow state={miniPresence.state} />
          ) : null}
          {askPresence.mounted ? (
            <SelectionAskAi
              state={askPresence.state}
              x={askPopup?.x ?? 0}
              y={askPopup?.y ?? 0}
              onAsk={onAskFromSelection}
              onAddToNote={onAddToNoteFromSelection}
              onOpenMermaid={onOpenMermaidFromSelection}
              onDismiss={() => setAskPopup(null)}
            />
          ) : null}

          <CommandPalette
            open={commandPaletteOpen}
            onOpenChange={setCommandPaletteOpen}
            initialMode={paletteInitialMode}
            commandItems={commandPaletteItems}
            workspaceRoot={explorerRoot}
            onOpenContentHit={openContentHit}
            insertCommand={insertHistoryCommand}
          />

          <NewEditorDialog
            open={newEditorOpen}
            onOpenChange={setNewEditorOpen}
            rootPath={explorerRoot ?? home}
            onCreated={(path) => openFileTab(path)}
          />

          <UpdaterDialog />

          <TaskEditor
            open={taskEditorOpen}
            task={editingTask}
            defaultCwd={activeCwd ?? home ?? ""}
            defaults={scheduled.defaults}
            onSubmit={(input) => {
              if (editingTask) scheduled.update(editingTask.id, input);
              else scheduled.add(input);
              closeTaskEditor();
            }}
            onCancel={closeTaskEditor}
          />

          <AgentRestoreDialog
            sessions={agentRestore.pending}
            onRestore={agentRestore.restore}
            onDismiss={agentRestore.dismiss}
          />

          <CloseDialogs
            tabs={tabs}
            pendingCloseTab={pendingCloseTab}
            onCancelClose={cancelClose}
            onConfirmClose={confirmClose}
            pendingTerminalCloseTab={pendingTerminalCloseTab}
            onCancelTerminalClose={cancelTerminalClose}
            onConfirmTerminalClose={confirmTerminalClose}
            pendingDeleteTabs={pendingDeleteTabs}
            onCancelDeleteClose={cancelDeleteClose}
            onConfirmDeleteClose={confirmDeleteClose}
            pendingAppClose={pendingAppClose}
            onCancelAppClose={cancelAppClose}
            onConfirmAppClose={confirmAppClose}
          />
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );

  return <AiComposerProvider>{shell}</AiComposerProvider>;
}
