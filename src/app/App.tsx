import { STARTER_GRAPH } from "@/modules/graphx/lib/document";
import type { GraphPlacement } from "@/modules/graphx/lib/document";
import {
  graphPlacementTarget,
  rememberGraphTerminalFocus,
} from "@/modules/graphx/lib/placementFocus";
import type { TerminalFileLocation } from "@/modules/terminal/lib/fileLinks";
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
  AiChatBottomPane,
  AiChatDock,
  AiMiniWindow,
  LocalAgentNotificationsBridge,
  useAiBootstrap,
  useAiLiveBridge,
  useChatLayoutStore,
  useChatStore,
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
  useControlHandlers,
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
import { setLspNavigator } from "@/modules/lsp";
import {
  Header,
  type SearchInlineHandle,
  type SearchTarget,
} from "@/modules/header";
import { validateMermaidSource } from "@/modules/mermaid";
import { type PreviewPaneHandle, samePreviewUrl } from "@/modules/preview";
import {
  closeReaderDoc,
  isLive,
  type LibraryEntry,
  loadStored,
  type OriginTab,
  openStored,
  pickDefaultDoc,
  playReader,
  ReaderMiniPlayer,
  readerNative,
  installReaderMediaSession,
  setReaderOrigin,
  setReaderSpeed,
  stepReader,
  setReaderVoice,
  stepSpeed,
  stopEverything,
  isSoundingNow,
  stopReader,
  toggleReader,
  useReaderStore,
} from "@/modules/reader";
import type { ReadContextMenuBinding } from "@/modules/reader/components/ReadContextMenu";
import { requestReaderLibrary } from "@/modules/reader/components/ReaderLibraryButton";
import {
  dockTarget,
  NOTHING_TO_READ_REASON,
  PRIVATE_READ_REASON,
  readHereReason,
  readsWholeDocument,
  speakReason,
} from "@/modules/reader/lib/readingAvailability";
import { titleFromText } from "@/modules/reader/lib/readerCommands";
import {
  readTerminalClipboard,
  writeTerminalClipboard,
} from "@/modules/terminal/lib/terminalClipboard";
import type { DocEntry } from "@/modules/reader/store/readerStore";
import { useFullDiskAccessHint } from "@/modules/privacy";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { isMarkdownPath } from "@/lib/utils";
import {
  shouldYieldTerminalShortcut,
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
  createTaskTerminal,
  createdTaskSessionPatch,
  dispatchedTaskPatch,
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
  labelFor,
  READER_DOCK_DEFAULT_HEIGHT,
  type TabColor,
} from "@/modules/tabs";
import {
  captureLeafInput,
  captureLeafSubmission,
  canClearActiveLeaf,
  canClearFocusedTerminal,
  clearActiveLeaf,
  clearFocusedTerminal,
  disposeSession,
  findLeafCwd,
  hasLeaf,
  leafIdForPty,
  leafIds,
  navigateFocusedBlocks,
  respawnSession,
  type TerminalPaneHandle,
  useTerminalFileDrop,
  writeToSession,
} from "@/modules/terminal";
import {
  openTerminalLab,
  useTerminalLabAvailable,
} from "@/modules/terminal/lib/terminalLab";
import {
  SpaceSwitcher,
  useSpaces,
  useSpacePersistence,
  useSpacesBoot,
} from "@/modules/spaces";
import { ThemeProvider, useThemeFileEditing } from "@/modules/theme";
import {
  speakText,
  ttsDownloadCommand,
  ttsInstallCommand,
  ttsSpeakCommand,
  ttsStartCommand,
  ttsStatusCommand,
  ttsStopCommand,
  ttsStopSpeakingCommand,
  ttsVoicesCommand,
  useTtsStore,
  type SpeakOptions,
} from "@/modules/tts";
import {
  dictationInstallCommand,
  dictationStartCommand,
  dictationStatusCommand,
  dictationStopCommand,
  dictationTranscribeCommand,
} from "@/modules/stt/lib/commands";
import { UpdaterDialog } from "@/modules/updater";
import { useWorkspaceEnvStore, type WorkspaceEnv } from "@/modules/workspace";
import type { TerminalSearch } from "@/modules/terminal/lib/terminalSearch";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CloseDialogs } from "./components/CloseDialogs";
import {
  TOGGLE_BLOCK_INPUT_EVENT,
  WorkspaceInputBar,
} from "./components/WorkspaceInputBar";
import {
  type ReaderDockBinding,
  WorkspaceSurface,
} from "./components/WorkspaceSurface";
import { useAppCloseGuard } from "./hooks/useAppCloseGuard";
import { FlowWindowBridge } from "@/modules/agent-flow/FlowWindowBridge";
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
    openGraph,
    readGraph,
    updateGraph,
    setGraphPlacement,
    setGraphPanel,
    newMermaidTab,
    updateMermaidSource,
    replaceMermaidTabContent,
    updateMermaidVisualLayout,
    setRenderableView,
    openAiDiffTab,
    closeAiDiffTab,
    openGitDiffTab,
    openCommitHistoryTab,
    openCommitFileDiffTab,
    openPrReviewTab,
    openReaderTab,
    openAgentFlowTab,
    closeAgentFlowTab,
    setPrReviewBase,
    moveTab,
    setTabPinned,
    closeTab,
    updateTab,
    updateTabNotes,
    ensureReaderKey,
    setReaderDock,
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
  const graphTerminalFocus = useRef<ReadonlyMap<string, number>>(new Map());
  useEffect(() => {
    graphTerminalFocus.current = rememberGraphTerminalFocus(
      tabs,
      activeId,
      graphTerminalFocus.current,
    );
  }, [tabs, activeId]);

  const activeTerminalTab = useMemo(() => {
    const t = tabs.find((x) => x.id === activeId);
    return t && t.kind === "terminal" ? t : null;
  }, [tabs, activeId]);
  const activeLeafId = activeTerminalTab?.activeLeafId ?? null;

  const pendingGotoLocation = useRef<Map<string, TerminalFileLocation>>(
    new Map(),
  );
  const searchAddons = useRef<Map<number, TerminalSearch>>(new Map());
  const [activeSearchAddon, setActiveSearchAddon] =
    useState<TerminalSearch | null>(null);
  const searchInlineRef = useRef<SearchInlineHandle | null>(null);
  const terminalRefs = useRef<Map<number, TerminalPaneHandle>>(new Map());
  const editorRefs = useRef<Map<number, EditorPaneHandle>>(new Map());
  const committedActiveIdRef = useRef(activeId);
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
  const getActiveSpaceId = useCallback(() => useSpaces.getState().activeId, []);
  const agentRestore = useAgentSessionRestore({
    ready: spacesHydrated && prefsHydrated,
    policy: restoreAgentSessionsPref,
    shellFlavor: IS_WINDOWS ? "windows" : "posix",
    getTabs: getTabsForRestore,
    knownSpaceIds,
    activeSpaceId: getActiveSpaceId,
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
    initialSidebarCollapsed,
    persistSidebarView,
    persistSidebarCollapsed,
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
  const terminalLabAvailable = useTerminalLabAvailable(commandPaletteOpen);
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
  const chatLayout = useChatLayoutStore((s) => s.mode);
  const openMini = useChatStore((s) => s.openMini);
  const toggleMini = useChatStore((s) => s.toggleMini);
  const focusInput = useChatStore((s) => s.focusInput);
  const openPanel = useChatStore((s) => s.openPanel);
  const closePanel = useChatStore((s) => s.closePanel);
  const panelOpen = useChatStore((s) => s.panelOpen);
  const setLive = useChatStore((s) => s.setLive);
  const respondToApproval = useChatStore((s) => s.respondToApproval);

  const { hasComposer, keysLoaded } = useAiBootstrap();
  const showChat = hasComposer && miniPresence.mounted;

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
  const isEditorTab = activeTab?.kind === "editor" || activeTab?.kind === "markdown";
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

  useEffect(() => {
    committedActiveIdRef.current = activeId;
    const handle = editorRefs.current.get(activeId);
    if (!handle) return;
    const path = handle.getPath();
    const location = pendingGotoLocation.current.get(path);
    if (!location) return;
    pendingGotoLocation.current.delete(path);
    handle.gotoLine(location.line, location.column);
  }, [activeId]);

  const handleSearchReady = useCallback(
    (leafId: number, addon: TerminalSearch) => {
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
      const tab = tabsRef.current.find((tab) => tab.id === id);
      if (tab?.kind === "editor" || tab?.kind === "markdown") pendingGotoLocation.current.delete(tab.path);
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
  useFullDiskAccessHint();

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
    if (t.kind === "editor" || t.kind === "markdown") {
      // The rendered Markdown view is plain DOM, not the editor.
      const dom = window.getSelection()?.toString() ?? "";
      return (
        editorRefs.current.get(activeId)?.getSelection() ??
        (dom.trim() ? dom : null)
      );
    }
    return null;
  }, [tabs, activeId]);

  /** The tab on screen, read at call time rather than from the last render. */
  const activeTabNow = useCallback(
    () => tabsRef.current.find((t) => t.id === activeIdRef.current),
    [],
  );

  /** The selection reading aloud may use: never a private terminal's. */
  const captureReadableSelection = useCallback((): string | null => {
    if (speakReason(activeTabNow()) === PRIVATE_READ_REASON) return null;
    return captureActiveSelection();
  }, [activeTabNow, captureActiveSelection]);

  /**
   * What an editor or Markdown tab reads with nothing selected: the buffer
   * when it has unsaved edits, so what is heard is what is on screen, else
   * the file itself.
   */
  const activeDocumentSource = useCallback(():
    | { text: string; title: string }
    | { path: string }
    | null => {
    const tab = activeTabNow();
    if (!tab || !readsWholeDocument(tab)) return null;
    if (tab.kind !== "editor" && tab.kind !== "markdown") return null;
    if (tab.dirty) {
      const text = editorRefs.current.get(tab.id)?.getText();
      if (text?.trim()) {
        const name = tab.path.split(/[\\/]/).filter(Boolean).pop() ?? tab.path;
        return { text, title: name };
      }
    }
    return { path: tab.path };
  }, [activeTabNow]);

  /** The last tab with content on screen: where a reading lands when it must. */
  const lastContentTabRef = useRef<number | null>(null);
  useEffect(() => {
    const tab = tabs.find((t) => t.id === activeId);
    if (tab && tab.kind !== "reader") lastContentTabRef.current = tab.id;
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

  // The text-taking cores are what the terminal context menu calls, since it
  // must act on the selection captured when it opened rather than re-reading a
  // selection a right-click may already have replaced. The zero-argument
  // wrappers keep the signature the shortcuts and command palette are wired to.
  const askWithSelection = useCallback(
    (selection: string) => {
      if (!hasComposer) {
        void openSettingsWindow("models");
        return;
      }
      if (!selection.trim()) {
        focusInput(null);
        return;
      }
      const source: "terminal" | "editor" =
        (activeTab?.kind === "editor" || activeTab?.kind === "markdown") ? "editor" : "terminal";
      attachSelection(selection, source);
    },
    [hasComposer, focusInput, attachSelection, activeTab],
  );

  const askFromSelection = useCallback(() => {
    askWithSelection(captureActiveSelection() ?? "");
  }, [askWithSelection, captureActiveSelection]);

  const addTextToNote = useCallback(
    (selection: string) => {
      if (!selection.trim()) return;
      tabNotes.addFromInput(selection);
      showNotesPanel();
      if (notesDetached) void openNotesWindow();
    },
    [tabNotes, showNotesPanel, notesDetached],
  );

  const addSelectionToNote = useCallback(() => {
    addTextToNote(captureActiveSelection() ?? "");
  }, [addTextToNote, captureActiveSelection]);

  /** The open tab a reading belongs to, by the key in its manifest. */
  const readerOriginTab = useCallback(
    (key: string | null): OriginTab | null => {
      if (!key) return null;
      const tab = tabsRef.current.find(
        (t) => t.kind !== "reader" && t.readerKey === key,
      );
      return tab ? { id: tab.id, label: labelFor(tab) } : null;
    },
    [],
  );

  /**
   * Records `tabId` as where a reading belongs, unless the tab it already
   * belongs to is still open: the first home wins while it exists.
   */
  const recordReaderOrigin = useCallback(
    (tabId: number, entry: DocEntry) => {
      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (!tab || tab.kind === "reader") return;
      if (readerOriginTab(entry.state.origin?.key ?? null)) return;
      const key = ensureReaderKey(tabId);
      if (key) setReaderOrigin(entry.id, { key, label: labelFor(tab) });
    },
    [ensureReaderKey, readerOriginTab],
  );

  /** Shows a reading in the panel under a tab. False for a Reader tab. */
  const dockReading = useCallback(
    (tabId: number, entry: DocEntry): boolean => {
      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (!tab || tab.kind === "reader") return false;
      setReaderDock(tabId, {
        docId: entry.id,
        height: tab.readerDock?.height ?? READER_DOCK_DEFAULT_HEIGHT,
      });
      recordReaderOrigin(tabId, entry);
      return true;
    },
    [setReaderDock, recordReaderOrigin],
  );

  const openInReader = useCallback(
    async (
      source: { text?: string; path?: string; title?: string },
      play = true,
      placement: "dock" | "tab" = "tab",
      voiceId?: string,
    ) => {
      try {
        const title =
          source.title ??
          (source.text ? titleFromText(source.text) : undefined);
        const entry = await openStored({ ...source, title });
        const from = activeIdRef.current;
        if (placement !== "dock" || !dockReading(from, entry)) {
          recordReaderOrigin(from, entry);
          openReaderTab({ docId: entry.id, title: entry.state.title });
        }
        // A voice picked in Read here with is the document's from now on.
        if (voiceId) await setReaderVoice(entry.id, voiceId);
        if (play) await playReader(entry.id);
      } catch (error: unknown) {
        toast.error(
          error instanceof Error ? error.message : "The Reader could not open it.",
        );
      }
    },
    [openReaderTab, dockReading, recordReaderOrigin],
  );

  /**
   * Every reading action a menu offers. Empty text with Read here or Read in
   * new tab means the document on screen; Speak always needs text.
   */
  const speakAloud = useCallback(
    (
      text: string,
      options: SpeakOptions & { reader?: boolean; here?: boolean } = {},
    ) => {
      if (options.reader || options.here) {
        const source = text.trim() ? { text } : activeDocumentSource();
        if (!source) {
          toast.message("Select the text to read first");
          return;
        }
        void openInReader(
          source,
          true,
          options.here ? "dock" : "tab",
          options.voiceId ?? undefined,
        );
        return;
      }
      if (!text.trim()) return;
      void speakText(text, options)
        .then((result) => {
          if (result?.truncated)
            toast.message("Read up to 8 KB", {
              description: "The rest was left out. Read here reads any length.",
            });
        })
        .catch((error: unknown) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "Reading aloud failed. Check Settings, Voice.",
          );
        });
    },
    [openInReader, activeDocumentSource],
  );

  /** Reopens the most recent Reader document where it was left. */
  const resumeLastReader = useCallback(async () => {
    try {
      const [last] = await readerNative.list();
      if (!last) {
        toast.message("The Reader library is empty", {
          description: "Open a selection, a file or `terax-read` output first.",
        });
        return;
      }
      const entry = await loadStored(last.id);
      // Like a pick in the library: the panel of the tab it was made in when
      // the chain is on, else the panel here. A tab only when no tab can
      // hold a panel at all.
      const origin = useReaderStore.getState().followOrigin
        ? (readerOriginTab(last.originKey)?.id ?? null)
        : null;
      const target = dockTarget({
        tabs: tabsRef.current,
        origin,
        preferred: activeIdRef.current,
        lastContent: lastContentTabRef.current,
      });
      if (target !== null && dockReading(target, entry)) {
        if (target !== activeIdRef.current) setActiveId(target);
      } else {
        openReaderTab({ docId: entry.id, title: entry.state.title });
      }
      await playReader(entry.id);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [openReaderTab, readerOriginTab, dockReading, setActiveId]);

  const readSelectionAloud = useCallback(
    (options: SpeakOptions = {}) => {
      const reason = speakReason(activeTabNow());
      if (reason) {
        toast.message(reason);
        return;
      }
      const selection = captureActiveSelection();
      if (!selection?.trim()) {
        toast.message("Select text to speak first", {
          description: "Read here reads the whole document instead.",
        });
        return;
      }
      speakAloud(selection, options);
    },
    [activeTabNow, captureActiveSelection, speakAloud],
  );

  /** The one Stop: one-shot speech and the Reader alike. */
  const stopReading = useCallback(() => {
    stopEverything();
  }, []);

  const openMermaidWithSource = useCallback(
    (selection: string) => {
      const source = validateMermaidSource(selection);
      if (!source.ok) {
        toast.error(source.message);
        return;
      }
      newMermaidTab(source.source);
    },
    [newMermaidTab],
  );

  const openNewGraphTab = useCallback(() => {
    try {
      openGraph(STARTER_GRAPH);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not open GraphX",
      );
    }
  }, [openGraph]);
  const placeGraphPanel = useCallback(
    (graphId: string, placement: GraphPlacement) => {
      const currentTabs = tabsRef.current;
      const currentActiveId = activeIdRef.current;
      const graph = setGraphPlacement(graphId, placement);
      const remembered = rememberGraphTerminalFocus(
        currentTabs,
        currentActiveId,
        graphTerminalFocus.current,
      );
      graphTerminalFocus.current = remembered;
      const targetId = graphPlacementTarget(
        currentTabs,
        graph,
        placement,
        currentActiveId,
        remembered,
      );
      useSpaces.getState().setActive(graph.spaceId);
      warmTab(targetId);
      activeIdRef.current = targetId;
      setActiveId(targetId);
      return graph;
    },
    [setGraphPlacement, warmTab, setActiveId],
  );

  /** The selection actions every text view's right-click menu offers. */
  const selectionMenuActions = useMemo(
    () => ({
      onAsk: askWithSelection,
      onAddToNote: addTextToNote,
      onOpenMermaid: openMermaidWithSource,
    }),
    [askWithSelection, addTextToNote, openMermaidWithSource],
  );

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
        if (linked.private) return Promise.resolve(null);
        setActiveId(linked.id);
        const leafId = linked.activeLeafId;
        const agent = useAgentStore.getState().sessions[leafId];
        return Promise.resolve({
          tabId: linked.id,
          leafId,
          spaceId: linked.spaceId,
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
          if (tab?.kind !== "terminal" || tab.private) {
            resolve(null);
            return;
          }
          resolve({ tabId, leafId: tab.activeLeafId, spaceId: tab.spaceId, agentRunning: false });
        }, 120);
      });
    },
    [newTab, updateTab, setActiveId],
  );

  const captureTaskTarget = useCallback(
    async (target: TabTarget, task: ScheduledTask, current: () => boolean) => {
      const deadline = Date.now() + 3000;
      while (current() && Date.now() < deadline) {
        const tab = tabsRef.current.find((value) => value.id === target.tabId);
        if (
          tab?.kind !== "terminal" ||
          tab.private ||
          (target.spaceId !== undefined && tab.spaceId !== target.spaceId) ||
          !hasLeaf(tab.paneTree, target.leafId)
        )
          return null;
        const input = captureLeafInput(target.leafId);
        if (input)
          return createTaskTerminal({
            target,
            task,
            input,
            submission: captureLeafSubmission(target.leafId),
            getTabs: () => tabsRef.current,
            getAgent: () => useAgentStore.getState().sessions[target.leafId],
          });
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      return null;
    },
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
    (taskId: string, at: number) => {
      const task = scheduledRef.current.readTasks().find((value) => value.id === taskId);
      if (task) scheduledRef.current.update(taskId, dispatchedTaskPatch(task, at));
    }, [],
  );
  const markTaskSessionCreated = useCallback(
    (taskId: string, sessionId: string, cwd: string, expectedSeed: string | undefined) => {
      const task = scheduledRef.current.readTasks().find((value) => value.id === taskId);
      if (!task) return;
      const patch = createdTaskSessionPatch(task, sessionId, cwd, expectedSeed);
      if (patch) scheduledRef.current.update(taskId, patch);
    }, [],
  );

  const disableTaskAfterFailures = useCallback(
    (taskId: string) => scheduled.setEnabled(taskId, false),
    [scheduled],
  );
  const dispatcher = useTaskDispatcher({
    tasks: scheduled.tasks,
    readTasks: scheduled.readTasks,
    paused: scheduled.paused,
    shellFlavor: IS_WINDOWS ? "windows" : "posix",
    recordRun: scheduled.recordRun,
    markDispatched: markTaskDispatched,
    markSessionCreated: markTaskSessionCreated,
    disableTask: disableTaskAfterFailures,
    notify: notifyTask,
    ensureTab: ensureTaskTab,
    captureTarget: captureTaskTarget,
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
    (path: string, location?: TerminalFileLocation) => {
      if (location) pendingGotoLocation.current.set(path, location);
      else pendingGotoLocation.current.delete(path);
      const targetId = openFileTab(path, true);
      const handle =
        targetId === activeIdRef.current &&
        targetId === committedActiveIdRef.current &&
        targetId !== null
          ? editorRefs.current.get(targetId)
          : null;
      if (location && handle) {
        pendingGotoLocation.current.delete(path);
        handle.gotoLine(location.line, location.column);
      }
    },
    [openFileTab],
  );

  const handlePathRenamed = useCallback(
    (from: string, to: string) => {
      for (const t of tabs) {
        if (t.kind !== "editor" && t.kind !== "markdown") continue;
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
    if (activeTab?.kind === "editor" || activeTab?.kind === "markdown") return activeTab.path;
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
    if (!activeTerminalTab || activeLeafId === null) return;
    void clearActiveLeaf(activeLeafId).catch((error) =>
      console.error("clear active terminal failed", error),
    );
  }, [activeTerminalTab, activeLeafId]);

  /**
   * The reading a Reader shortcut means: the one sounding, else the one on
   * screen (Reader tab or panel), else the one left paused; null if none is
   * loaded.
   */
  const defaultReaderDoc = useCallback((): string | null => {
    const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
    const { playback, docs } = useReaderStore.getState();
    const docId = pickDefaultDoc(
      playback,
      tab?.kind === "reader"
        ? tab.docId
        : (tab?.readerDock?.docId ?? null),
    );
    return docId && docs[docId] ? docId : null;
  }, []);

  const nudgeReaderSpeed = useCallback(
    (direction: 1 | -1) => {
      const docId = defaultReaderDoc();
      const entry = docId ? useReaderStore.getState().docs[docId] : undefined;
      if (!docId || !entry) return;
      const speed = stepSpeed(entry.state.speed, direction);
      setReaderSpeed(docId, speed);
      toast.message(`Reader at ${speed}x`, { duration: 1200 });
    },
    [defaultReaderDoc],
  );

  /** Reader actions defined further down, reached by the shortcuts above them. */
  const readerActionsRef = useRef({
    readHere: () => {},
    togglePanel: () => {},
  });

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
        if (activeLeafId === null || !activeTerminalTab) return;
        void clearFocusedTerminal(activeLeafId).catch((error) =>
          console.error("clear terminal history failed", error),
        );
      },
      "terminal.toggleInput": () =>
        window.dispatchEvent(new CustomEvent(TOGGLE_BLOCK_INPUT_EVENT)),
      "blocks.prev": () => navigateFocusedBlocks(-1),
      "blocks.next": () => navigateFocusedBlocks(1),
      "search.focus": () => searchInlineRef.current?.focus(),
      "ai.toggle": togglePanelAndFocus,
      "ai.toggleMini": () => {
        if (!hasComposer) {
          void openSettingsWindow("models");
          return;
        }
        toggleMini();
      },
      "ai.askSelection": askFromSelection,
      "notes.addSelection": addSelectionToNote,
      "tts.readSelection": () => readSelectionAloud(),
      "speech.stop": stopReading,
      "reader.togglePlayback": () => {
        const docId = defaultReaderDoc();
        if (docId)
          void toggleReader(docId).catch((error: unknown) =>
            toast.error(error instanceof Error ? error.message : String(error)),
          );
      },
      "reader.previous": () => {
        const docId = defaultReaderDoc();
        if (docId) void stepReader(docId, -1);
      },
      "reader.next": () => {
        const docId = defaultReaderDoc();
        if (docId) void stepReader(docId, 1);
      },
      "reader.faster": () => nudgeReaderSpeed(1),
      "reader.slower": () => nudgeReaderSpeed(-1),
      "reader.readHere": () => readerActionsRef.current.readHere(),
      "reader.togglePanel": () => readerActionsRef.current.togglePanel(),
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
      activeLeafId,
      activeTerminalTab,
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
      hasComposer,
      togglePanelAndFocus,
      toggleMini,
      askFromSelection,
      addSelectionToNote,
      readSelectionAloud,
      stopReading,
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
        return activeTab?.kind !== "editor" && activeTab?.kind !== "markdown";
      }
      if (id === "ai.askSelection" || id === "sidebar.toggle") {
        return shouldYieldTerminalShortcut(id, {
          target: e.target ?? document.activeElement,
          shiftKey: e.shiftKey,
          getSelection: captureActiveSelection,
        });
      }
      if (id === "notes.addSelection") {
        // Only claim the binding when there is a selection to act on;
        // otherwise let the key fall through (never preventDefault when
        // disabled).
        return !captureActiveSelection()?.trim();
      }
      if (id === "tts.readSelection") {
        // Claimed wherever text could be selected, so an empty selection or
        // a private terminal answers with a short reason instead of silence.
        return speakReason(activeTab) === NOTHING_TO_READ_REASON;
      }
      if (id === "speech.stop") {
        return !isSoundingNow();
      }
      if (
        id === "reader.togglePlayback" ||
        id === "reader.previous" ||
        id === "reader.next" ||
        id === "reader.faster" ||
        id === "reader.slower"
      ) {
        // Only claim the chord while there is a reading to drive.
        return defaultReaderDoc() === null;
      }
      if (id === "reader.readHere") {
        // A private terminal claims the key to say why; a view with no text
        // lets it fall through.
        const reason = readHereReason(activeTab);
        return reason !== null && reason !== PRIVATE_READ_REASON;
      }
      if (id === "reader.togglePanel") {
        return !activeTab;
      }
      if (id === "terminal.clear") {
        // Only intercept ⌘K while a terminal is focused; elsewhere let the key
        // fall through (we never preventDefault when disabled).
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        return activeTab?.kind !== "terminal" ||
          !canClearFocusedTerminal(activeTab.activeLeafId, target);
      }
      if (id === "terminal.clearActive") {
        const target = (e.target as Element | null) ?? document.activeElement;
        return (
          activeTab?.kind !== "terminal" ||
          !canClearActiveLeaf(activeTab.activeLeafId, target)
        );
      }
      if (
        id === "terminal.toggleInput" ||
        id === "blocks.prev" ||
        id === "blocks.next"
      ) {
        return !(activeTab?.kind === "terminal" && activeTab.blocks === true);
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
        const path = h.getPath();
        const location = pendingGotoLocation.current.get(path);
        if (location && id === activeId) {
          pendingGotoLocation.current.delete(path);
          h.gotoLine(location.line, location.column);
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

  const onOpenAgentFlow = useCallback(() => {
    const spaceId = openAgentFlowTab();
    const spaces = useSpaces.getState();
    if (spaces.activeId !== spaceId) spaces.setActive(spaceId);
  }, [openAgentFlowTab]);

  const onFocusFlowTerminal = useCallback(
    (tabId: number, leafId: number) => {
      const tab = tabsRef.current.find((item) => item.id === tabId);
      if (tab?.kind !== "terminal" || tab.private || !hasLeaf(tab.paneTree, leafId)) return;
      const spaces = useSpaces.getState();
      if (spaces.activeId !== tab.spaceId) spaces.setActive(tab.spaceId);
      onActivateAgent(tabId, leafId);
    },
    [onActivateAgent],
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

  const handleReaderTitle = useCallback(
    (tabId: number, title: string) => {
      updateTab(tabId, { title });
    },
    [updateTab],
  );

  // A reading nothing shows any more, by any route (its tab or the tab under
  // its panel closed, the panel closed), saves its place and frees its audio.
  // The one playing or exporting is kept: the mini player still drives it.
  useEffect(() => {
    const open = new Set(
      tabs.flatMap((t) =>
        t.kind === "reader"
          ? [t.docId]
          : t.readerDock?.docId
            ? [t.readerDock.docId]
            : [],
      ),
    );
    const { playback, docs } = useReaderStore.getState();
    if (playback.docId && isLive(playback.docId)) open.add(playback.docId);
    if (playback.exporting) open.add(playback.exporting.docId);
    for (const docId of Object.keys(docs)) {
      if (!open.has(docId)) void closeReaderDoc(docId);
    }
  }, [tabs]);

  const focusReaderDoc = useCallback(
    (docId: string) => {
      const tabs = tabsRef.current;
      const active = tabs.find((t) => t.id === activeIdRef.current);
      if (
        active &&
        (active.kind === "reader"
          ? active.docId === docId
          : active.readerDock?.docId === docId)
      )
        return;
      const tab =
        tabs.find((t) => t.kind === "reader" && t.docId === docId) ??
        tabs.find((t) => t.kind !== "reader" && t.readerDock?.docId === docId);
      if (tab) {
        setActiveId(tab.id);
        return;
      }
      const entry = useReaderStore.getState().docs[docId];
      if (entry && !dockReading(activeIdRef.current, entry))
        openReaderTab({ docId, title: entry.state.title });
    },
    [setActiveId, dockReading, openReaderTab],
  );

  /** Hands the keyboard back to a tab's own content, from its Reader panel. */
  const focusTabContent = useCallback((tabId: number) => {
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (tab?.kind === "terminal") {
      terminalRefs.current.get(tab.activeLeafId)?.focus();
      return;
    }
    if (tab?.kind === "editor") {
      editorRefs.current.get(tabId)?.focus();
      return;
    }
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  }, []);

  /** Closes a tab's panel; the reading stops unless something else shows it. */
  const closeReaderDock = useCallback(
    (tabId: number) => {
      const tab = tabsRef.current.find((t) => t.id === tabId);
      const docId = tab?.kind !== "reader" ? tab?.readerDock?.docId : null;
      if (docId) {
        const elsewhere = tabsRef.current.some(
          (t) =>
            t.id !== tabId &&
            (t.kind === "reader"
              ? t.docId === docId
              : t.readerDock?.docId === docId),
        );
        if (!elsewhere && useReaderStore.getState().playback.docId === docId)
          stopReader();
      }
      setReaderDock(tabId, null);
      if (tabId === activeIdRef.current) focusTabContent(tabId);
    },
    [setReaderDock, focusTabContent],
  );

  const showReaderLibrary = useCallback(
    (tabId: number) => {
      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (!tab || tab.kind === "reader") return;
      setReaderDock(tabId, {
        docId: null,
        height: tab.readerDock?.height ?? READER_DOCK_DEFAULT_HEIGHT,
      });
    },
    [setReaderDock],
  );

  /**
   * Reads the selection, else the document on screen (unsaved edits
   * included), in the panel under the tab.
   */
  const readHere = useCallback(() => {
    const tab = activeTabNow();
    const reason = readHereReason(tab);
    if (reason) {
      toast.message(reason);
      return;
    }
    const selection = captureActiveSelection();
    const source = selection?.trim()
      ? { text: selection }
      : activeDocumentSource();
    if (source) {
      void openInReader(source, true, "dock");
      return;
    }
    toast.message("Select the text to read first", {
      description: "Then right-click it and choose Read here.",
    });
  }, [
    activeTabNow,
    captureActiveSelection,
    activeDocumentSource,
    openInReader,
  ]);

  /** The same in a Reader tab of its own. */
  const readInNewTab = useCallback(() => {
    const reason = readHereReason(activeTabNow());
    if (reason) {
      toast.message(reason);
      return;
    }
    const selection = captureActiveSelection();
    const source = selection?.trim()
      ? { text: selection }
      : activeDocumentSource();
    if (source) void openInReader(source, true, "tab");
    else toast.message("Select the text to read first");
  }, [
    activeTabNow,
    captureActiveSelection,
    activeDocumentSource,
    openInReader,
  ]);

  const toggleReaderPanel = useCallback(() => {
    const tab = activeTabNow();
    if (!tab) return;
    // A Reader tab has no panel; its own library button opens instead.
    if (tab.kind === "reader") {
      requestReaderLibrary(tab.id);
      return;
    }
    if (tab.readerDock) closeReaderDock(tab.id);
    else showReaderLibrary(tab.id);
  }, [activeTabNow, closeReaderDock, showReaderLibrary]);

  readerActionsRef.current = { readHere, togglePanel: toggleReaderPanel };

  // The operating system's media controls drive the Reader too.
  useEffect(() => installReaderMediaSession(), []);

  /**
   * A reading picked in the library opens in the tab it was made in when the
   * chain is on and that tab is open, else in the panel it was picked from.
   */
  const pickReading = useCallback(
    async (fromTabId: number, picked: LibraryEntry) => {
      try {
        const entry = await loadStored(picked.id);
        const origin = useReaderStore.getState().followOrigin
          ? (readerOriginTab(picked.originKey)?.id ?? null)
          : null;
        // Picked from a Reader tab, which has no panel: the last tab with
        // content takes it.
        const target = dockTarget({
          tabs: tabsRef.current,
          origin,
          preferred: fromTabId,
          lastContent: lastContentTabRef.current,
        });
        if (target === null || !dockReading(target, entry)) return;
        if (target !== activeIdRef.current) setActiveId(target);
        // Resumes paused, with the keyboard on Play: Space or Return goes on.
        useReaderStore.getState().requestFocusPlay(entry.id);
      } catch (error: unknown) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [dockReading, readerOriginTab, setActiveId],
  );

  /**
   * A Reader tab's "Dock here": the reading moves into the panel of the tab
   * it was made in (or the last tab with content), and the Reader tab closes.
   * Playback goes on.
   */
  const dockReaderTabHere = useCallback(
    async (readerTabId: number, docId: string) => {
      try {
        const entry =
          useReaderStore.getState().docs[docId] ?? (await loadStored(docId));
        const target = dockTarget({
          tabs: tabsRef.current,
          origin: readerOriginTab(entry.state.origin?.key ?? null)?.id ?? null,
          preferred: null,
          lastContent: lastContentTabRef.current,
        });
        if (target === null || !dockReading(target, entry)) {
          toast.message("No tab to dock it under", {
            description: "Open a terminal or a file first.",
          });
          return;
        }
        setActiveId(target);
        void handleClose(readerTabId);
      } catch (error: unknown) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [readerOriginTab, dockReading, setActiveId, handleClose],
  );

  /** Deleted readings leave the panels and Reader tabs that showed them. */
  const forgetDeletedReadings = useCallback(
    (ids: string[]) => {
      const gone = new Set(ids);
      for (const tab of tabsRef.current) {
        if (tab.kind === "reader") {
          if (gone.has(tab.docId)) void handleClose(tab.id);
        } else if (tab.readerDock?.docId && gone.has(tab.readerDock.docId)) {
          setReaderDock(tab.id, { ...tab.readerDock, docId: null });
        }
      }
    },
    [setReaderDock, handleClose],
  );

  const readerDockBinding = useMemo<ReaderDockBinding>(
    () => ({
      onResize: (tabId, height) => {
        const tab = tabsRef.current.find((t) => t.id === tabId);
        if (tab?.readerDock)
          setReaderDock(tabId, { ...tab.readerDock, height });
      },
      onClose: closeReaderDock,
      onPick: (tabId, entry) => void pickReading(tabId, entry),
      onDeleted: forgetDeletedReadings,
      onOpenAsTab: (docId, title) => {
        // The reading moves: out of the panel, into a tab of its own.
        const from = activeIdRef.current;
        const tab = tabsRef.current.find((t) => t.id === from);
        if (tab?.kind !== "reader" && tab?.readerDock?.docId === docId)
          setReaderDock(from, null);
        openReaderTab({ docId, title });
      },
      onEscape: focusTabContent,
      originTab: readerOriginTab,
      onDockHere: (tabId, docId) => void dockReaderTabHere(tabId, docId),
    }),
    [
      setReaderDock,
      closeReaderDock,
      pickReading,
      forgetDeletedReadings,
      openReaderTab,
      focusTabContent,
      readerOriginTab,
      dockReaderTabHere,
    ],
  );

  /** Right-click in the editor and Markdown views. */
  const editorReadMenu = useMemo<ReadContextMenuBinding>(
    () => ({
      readSelection: captureReadableSelection,
      blockedReason: () => readHereReason(activeTabNow()),
      documentFallback: () => readsWholeDocument(activeTabNow()),
      editable: () => {
        const tab = activeTabNow();
        return tab
          ? (editorRefs.current.get(tab.id)?.isEditable() ?? false)
          : false;
      },
      onReplaceSelection: (text) => {
        const tab = activeTabNow();
        if (tab) editorRefs.current.get(tab.id)?.replaceSelection(text);
      },
      onCopy: (text) => void writeTerminalClipboard(text),
      readClipboard: readTerminalClipboard,
      onRead: speakAloud,
      onStop: stopReading,
      selectionActions: selectionMenuActions,
    }),
    [
      captureReadableSelection,
      activeTabNow,
      speakAloud,
      stopReading,
      selectionMenuActions,
    ],
  );

  const readerPanelHost = useMemo(
    () => ({
      dockReading,
      recordOrigin: recordReaderOrigin,
      showLibrary: showReaderLibrary,
      closeDock: closeReaderDock,
      forgetDeleted: forgetDeletedReadings,
      tabOfPty: (ptyId: number) => {
        const leaf = leafIdForPty(ptyId);
        if (leaf === null) return null;
        return (
          tabsRef.current.find(
            (t) => t.kind === "terminal" && leafIds(t.paneTree).includes(leaf),
          )?.id ?? null
        );
      },
    }),
    [
      dockReading,
      recordReaderOrigin,
      showReaderLibrary,
      closeReaderDock,
      forgetDeletedReadings,
    ],
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
            openNewGraph: openNewGraphTab,
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
            hasSelection: Boolean(captureReadableSelection()?.trim()),
            speakDisabled: speakReason(activeTab) ?? undefined,
            readSelectionAloud: () => readSelectionAloud(),
            readSelectionAloudSpanish: () =>
              readSelectionAloud({ language: "es-ES" }),
            readSelectionAloudEnglish: () =>
              readSelectionAloud({ language: "en-US" }),
            resumeLastReader: () => void resumeLastReader(),
            readHere,
            readHereDisabled: readHereReason(activeTab) ?? undefined,
            readInNewTab,
            readInNewTabDisabled:
              readHereReason(activeTab) ??
              (readsWholeDocument(activeTab) ||
              captureReadableSelection()?.trim()
                ? undefined
                : "No selection"),
            toggleReaderPanel: activeTab ? toggleReaderPanel : undefined,
            toggleReaderPlayback: (() => {
              const { playback } = useReaderStore.getState();
              const docId = pickDefaultDoc(
                playback,
                activeTab?.kind === "reader"
                  ? activeTab.docId
                  : (activeTab?.readerDock?.docId ?? null),
              );
              return docId
                ? () =>
                    void toggleReader(docId).catch((error: unknown) =>
                      toast.error(
                        error instanceof Error ? error.message : String(error),
                      ),
                    )
                : undefined;
            })(),
            stopReading,
            stopDisabled: isSoundingNow() ? undefined : "Nothing is playing",
            openVoiceSettings: () => void openSettingsWindow("voice"),
            openSettings: () => void openSettingsWindow(),
            openKeyboardShortcuts: () => void openSettingsWindow("shortcuts"),
            spaces: useSpaces.getState().spaces,
            activeSpaceId,
            openSpacesOverview: () => setSwitcherOpen(true),
            newSpace: () => void handleNewSpace(),
            switchSpace: (id) => useSpaces.getState().setActive(id),
            openTerminalLab: terminalLabAvailable ? openTerminalLab : undefined,
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
      openNewGraphTab,
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
      captureReadableSelection,
      readSelectionAloud,
      resumeLastReader,
      readHere,
      readInNewTab,
      toggleReaderPanel,
      activeTab,
      stopReading,
      activeSpaceId,
      handleNewSpace,
      terminalLabAvailable,
    ],
  );

  const controlHandlers = useControlHandlers({
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
    readerPanel: readerPanelHost,
  });

  const externalCommandHandlers = useMemo<CommandHandlers>(
    () => ({
      ...controlHandlers,
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
          tts: {
            status: useTtsStore.getState().status,
            speaking: useTtsStore.getState().speaking,
          },
        }),
      getBuildInfo: () => ({
        repository: BUILD_INFO.repository,
        branch: BUILD_INFO.branch,
        commit: BUILD_INFO.commit,
        channel: BUILD_INFO.channel,
      }),
      capture: async (payload) => {
        try {
          return await captureSurface(payload, () => ({
            tabs: tabsRef.current,
            activeTabId: activeIdRef.current,
          }));
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
      openGraph: ({ source, graphId }) => {
        const { tab, created } = openGraph(source, graphId);
        useSpaces.getState().setActive(tab.spaceId);
        warmTab(tab.id);
        setActiveId(tab.id);
        return {
          tabId: tab.id,
          graphId: tab.graphId,
          documentId: tab.documentId,
          revision: tab.revision,
          placement: tab.placement,
          created,
        };
      },
      readGraph: ({ graphId }) => {
        const tab = readGraph(graphId);
        return {
          tabId: tab.id,
          graphId,
          documentId: tab.documentId,
          revision: tab.revision,
          source: tab.source,
          placement: tab.placement,
        };
      },
      updateGraph: ({ graphId, documentId, expectedRevision, source }) => {
        const tab = updateGraph(graphId, documentId, expectedRevision, source);
        return { tabId: tab.id, graphId, revision: tab.revision };
      },
      placeGraph: ({ graphId, placement }) => {
        const tab = placeGraphPanel(graphId, placement);
        return { tabId: tab.id, graphId, placement: tab.placement };
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
      getTtsStatus: () => ttsStatusCommand(),
      startTtsEngine: ({ engine }) => ttsStartCommand(engine),
      stopTtsEngine: ({ engine }) => ttsStopCommand(engine),
      installTtsEngine: ({ engine, withModel }) =>
        ttsInstallCommand(engine, withModel ?? true),
      downloadTtsModel: ({ model }) => ttsDownloadCommand(model),
      listTtsVoices: (payload) => ttsVoicesCommand(payload?.language),
      speakTts: (payload) => ttsSpeakCommand(payload),
      stopTtsSpeaking: () => ttsStopSpeakingCommand(),
      getDictationStatus: () => dictationStatusCommand(),
      installDictation: (payload) =>
        dictationInstallCommand("rumble", payload?.withModel ?? true),
      startDictation: () => dictationStartCommand(),
      stopDictation: () => dictationStopCommand(),
      transcribeDictation: (payload) => dictationTranscribeCommand(payload),
    }),
    [
      controlHandlers,
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
      openGraph,
      readGraph,
      updateGraph,
      placeGraphPanel,
      warmTab,
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

  const openContentHit = useCallback(
    (path: string, line: number) => handleOpenTerminalFileLink(path, { line }),
    [handleOpenTerminalFileLink],
  );

  useEffect(() => {
    setLspNavigator({ openFile: openContentHit });
    return () => setLspNavigator(null);
  }, [openContentHit]);

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
              onNewGraph={openNewGraphTab}
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
              onLayoutChanged={(_, { isUserInteraction }) => {
                const width = sidebarRef.current?.getSize().inPixels ?? 0;
                persistSidebarWidth(width, isUserInteraction);
              }}
            >
              <ResizablePanel
                id="sidebar"
                panelRef={sidebarRef}
                defaultSize={
                  initialSidebarCollapsed ? "0px" : `${sidebarWidthRef.current}px`
                }
                minSize={`${SIDEBAR_MIN_WIDTH}px`}
                maxSize={`${SIDEBAR_MAX_WIDTH}px`}
                collapsible
                collapsedSize={0}
                onResize={(size) => {
                  persistSidebarCollapsed(size.inPixels <= 0);
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
                <div data-ai-dock-host className="flex h-full min-h-0">
                  {showChat && chatLayout === "left" ? (
                    <AiChatDock side="left" state={miniPresence.state} />
                  ) : null}
                  <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
                    <div className="relative min-h-0 flex-1">
                      <WorkspaceSurface
                        onGraphUpdate={updateGraph}
                        onGraphPlace={placeGraphPanel}
                        onGraphPanel={setGraphPanel}
                        tabs={tabs}
                        activeId={activeId}
                        activeTab={activeTab}
                        registerTerminalHandle={registerTerminalHandle}
                        onSearchReady={handleSearchReady}
                        onCwd={handleTerminalCwd}
                        onExit={handleLeafExit}
                        onFocusLeaf={handleFocusLeaf}
                        onOpenFileLink={handleOpenTerminalFileLink}
                        onReadAloud={speakAloud}
                        onStopReading={stopReading}
                        selectionActions={selectionMenuActions}
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
                        onReaderClose={(id) => void handleClose(id)}
                        onReaderTitle={handleReaderTitle}
                        readerDock={readerDockBinding}
                        editorReadMenu={editorReadMenu}
                        onGitHistorySearchHandle={setGitHistoryHandle}
                        onSetRenderableView={setRenderableView}
                        onMermaidSourceChange={updateMermaidSource}
                        onMermaidVisualLayoutChange={updateMermaidVisualLayout}
                        onActivateAgent={onFocusFlowTerminal}
                        onAgentFlowDetached={closeAgentFlowTab}
                      />
                    </div>

                    {showChat && chatLayout === "bottom" ? (
                      <AiChatBottomPane state={miniPresence.state} />
                    ) : null}

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
                  {showChat && chatLayout === "right" ? (
                    <AiChatDock side="right" state={miniPresence.state} />
                  ) : null}
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
                      onOpenFlow={onOpenAgentFlow}
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
          <FlowWindowBridge tabs={tabs} onActivate={onFocusFlowTerminal} onDock={onOpenAgentFlow} />
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

          {showChat && chatLayout === "floating" ? (
            <AiMiniWindow state={miniPresence.state} />
          ) : null}
          <ReaderMiniPlayer
            visibleDocId={
              activeTab?.kind === "reader"
                ? activeTab.docId
                : (activeTab?.readerDock?.docId ?? null)
            }
            onOpenDoc={focusReaderDoc}
          />

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
