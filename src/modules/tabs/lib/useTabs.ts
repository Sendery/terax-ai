import { isMarkdownPath } from "@/lib/utils";
import type { NoteCard } from "@/modules/notes/lib/cards";
import {
  findLeafCwd,
  hasLeaf,
  leafIds,
  nextLeafId,
  type PaneNode,
  removeLeaf,
  type SplitDir,
  setLeafCwd as setLeafCwdInTree,
  siblingLeafOf,
  splitLeaf,
} from "@/modules/terminal/lib/panes";
import { disposeSession } from "@/modules/terminal/lib/useTerminalSession";
import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { replaceMermaidTab } from "./mermaidTabMutation";
import type { TabColor } from "./tabColors";

// Matches the renderer slot pool size — over this we'd evict an active leaf.
export const MAX_PANES_PER_TAB = 4;

type TabBase = {
  spaceId: string;
  /** Restored from disk, not yet activated: rendered as a placeholder, not mounted. */
  cold?: boolean;
  /** User-set label that overrides the derived tab name. */
  customTitle?: string;
  /** Optional accent color for the tab, chosen from the fixed palette. */
  color?: TabColor;
  /** Per-tab notes (Jira/GitHub PR/Notion/Figma/Obsidian/link/text cards). */
  notes?: NoteCard[];
};

export type TerminalTab = TabBase & {
  id: number;
  kind: "terminal";
  title: string;
  cwd?: string;
  paneTree: PaneNode;
  activeLeafId: number;
  blocks?: boolean;
  /** AI agent cannot read buffer / context of this terminal. */
  private?: boolean;
};

export type EditorTab = TabBase & {
  id: number;
  kind: "editor";
  title: string;
  path: string;
  dirty: boolean;
  /**
   * True while the tab is in the transient "preview" state — opened by a
   * single-click in the explorer and not yet pinned by the user. A preview tab
   * is replaced by the next single-click rather than accumulating.
   */
  preview: boolean;
};

export type PreviewTab = TabBase & {
  id: number;
  kind: "preview";
  title: string;
  url: string;
};

export type MarkdownTab = TabBase & {
  id: number;
  kind: "markdown";
  title: string;
  path: string;
};

export type MermaidVisualLayout = {
  kind: "flowchart";
  positions: Record<string, { x: number; y: number }>;
};

export type MermaidTab = TabBase & {
  id: number;
  kind: "mermaid";
  title: string;
  source: string;
  visualLayout?: MermaidVisualLayout;
};

export type AiDiffStatus = "pending" | "approved" | "rejected";

export type AiDiffTab = TabBase & {
  id: number;
  kind: "ai-diff";
  title: string;
  path: string;
  /** "" for newly created files. */
  originalContent: string;
  proposedContent: string;
  /** Tool-call approval id used to resolve the AI SDK approval. */
  approvalId: string;
  status: AiDiffStatus;
  isNewFile: boolean;
};

export type GitDiffTab = TabBase & {
  id: number;
  kind: "git-diff";
  title: string;
  path: string;
  repoRoot: string;
  mode: "-" | "+";
  originalPath: string | null;
};

export type GitHistoryTab = TabBase & {
  id: number;
  kind: "git-history";
  title: string;
  repoRoot: string;
};

export type GitCommitFileDiffTab = TabBase & {
  id: number;
  kind: "git-commit-file";
  title: string;
  repoRoot: string;
  sha: string;
  shortSha: string;
  subject: string;
  path: string;
  originalPath: string | null;
};

/** A local review of one branch against the branch it would merge into. */
export type PrReviewTab = TabBase & {
  id: number;
  kind: "pr-review";
  title: string;
  repoRoot: string;
  /** Branch under review. */
  head: string;
  /** Branch it is compared against; the user can change it in the pane. */
  base: string;
};

export type Tab =
  | PrReviewTab
  | TerminalTab
  | EditorTab
  | PreviewTab
  | MarkdownTab
  | MermaidTab
  | AiDiffTab
  | GitDiffTab
  | GitHistoryTab
  | GitCommitFileDiffTab;

export type TabPatch = Partial<{
  title: string;
  cwd: string;
  path: string;
  dirty: boolean;
  url: string;
  /** Empty string resets a tab to its derived name. */
  customTitle: string;
  /** Palette color to apply. null explicitly clears any set color. */
  color: TabColor | null;
}>;

/** Pure helper: apply a patch to a single tab without React state machinery. */
export function applyTabPatch(tab: Tab, patch: TabPatch): Tab {
  const customTitlePatch =
    patch.customTitle !== undefined
      ? {
          customTitle: patch.customTitle === "" ? undefined : patch.customTitle,
        }
      : {};
  const colorPatch =
    "color" in patch
      ? { color: patch.color === null ? undefined : patch.color }
      : {};

  if (tab.kind === "terminal") {
    return {
      ...tab,
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.cwd !== undefined && { cwd: patch.cwd }),
      ...customTitlePatch,
      ...colorPatch,
    };
  }
  if (tab.kind === "preview") {
    return {
      ...tab,
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.url !== undefined && {
        url: patch.url,
        title: patch.title ?? titleFromUrl(patch.url),
      }),
      ...customTitlePatch,
      ...colorPatch,
    };
  }
  if (tab.kind === "markdown") {
    return {
      ...tab,
      ...(patch.title !== undefined && { title: patch.title }),
      ...customTitlePatch,
      ...colorPatch,
    };
  }
  if (tab.kind === "mermaid") {
    return {
      ...tab,
      ...(patch.title !== undefined && { title: patch.title }),
      ...customTitlePatch,
      ...colorPatch,
    };
  }
  // editor tab: auto-promote from preview the moment the file becomes dirty.
  const autoPin =
    patch.dirty === true && (tab as EditorTab).preview
      ? { preview: false }
      : {};
  return {
    ...tab,
    ...autoPin,
    ...(patch.title !== undefined && { title: patch.title }),
    ...(patch.dirty !== undefined && { dirty: patch.dirty }),
    ...(patch.path !== undefined && { path: patch.path }),
    ...customTitlePatch,
    ...colorPatch,
  };
}

/**
 * Pure helper: apply a markdown/raw view mode transition to a tab.
 * Preserves all TabBase metadata (color, customTitle, cold, spaceId) across
 * the markdown ↔ editor kind change.
 */
export function applyMarkdownView(tab: Tab, mode: "rendered" | "raw"): Tab {
  if (!isMarkdownPath((tab as { path?: string }).path ?? "")) return tab;
  if (mode === "raw" && tab.kind === "markdown") {
    return { ...tab, kind: "editor" as const, dirty: false, preview: false };
  }
  if (mode === "rendered" && tab.kind === "editor") {
    if (tab.dirty) return tab;
    return {
      id: tab.id,
      kind: "markdown" as const,
      spaceId: tab.spaceId,
      cold: tab.cold,
      title: tab.title,
      path: tab.path,
      ...(tab.customTitle !== undefined && { customTitle: tab.customTitle }),
      ...(tab.color !== undefined && { color: tab.color }),
    };
  }
  return tab;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host || url;
  } catch {
    return url || "preview";
  }
}

export const DEFAULT_SPACE_ID = "default";

// Next active after close, scoped to the closing tab's space. null = last tab of
// its space, which callers treat as "refuse to close".
export function nextActiveInSpace(
  tabs: Tab[],
  closingId: number,
): number | null {
  const closing = tabs.find((t) => t.id === closingId);
  if (!closing) return null;
  const sameSpace = tabs.filter((t) => t.spaceId === closing.spaceId);
  if (sameSpace.length <= 1) return null;
  const idx = sameSpace.findIndex((t) => t.id === closingId);
  return (sameSpace[idx - 1] ?? sameSpace[idx + 1]).id;
}

// Gap index is relative to the space's own strip, including the dragged tab.
export function reorderTabsByGap(
  tabs: Tab[],
  fromId: number,
  toGapIndex: number,
): Tab[] {
  const moved = tabs.find((t) => t.id === fromId);
  if (!moved) return tabs;
  const sameSpace = tabs.filter((t) => t.spaceId === moved.spaceId);
  const spaceFrom = sameSpace.findIndex((t) => t.id === fromId);
  let spaceTarget = toGapIndex > spaceFrom ? toGapIndex - 1 : toGapIndex;
  spaceTarget = Math.max(0, Math.min(spaceTarget, sameSpace.length - 1));
  if (spaceTarget === spaceFrom) return tabs;
  const anchor = sameSpace[spaceTarget];
  const next = tabs.filter((t) => t.id !== fromId);
  const anchorIdx = next.findIndex((t) => t.id === anchor.id);
  const insertIdx = spaceTarget > spaceFrom ? anchorIdx + 1 : anchorIdx;
  next.splice(insertIdx, 0, moved);
  return next;
}

/**
 * Moves a tab to a destination index inside its own space.
 *
 * Spaces share one array, so the index is counted over the tab's own strip;
 * splicing by absolute position would drag it into a neighbouring space. The
 * index is clamped, so a caller does not have to know the strip's length.
 */
export function moveTabToIndex(
  tabs: readonly Tab[],
  tabId: number,
  index: number,
): { tabs: Tab[]; index: number | null } {
  const moved = tabs.find((t) => t.id === tabId);
  if (!moved) return { tabs: tabs as Tab[], index: null };
  const sameSpace = tabs.filter((t) => t.spaceId === moved.spaceId);
  const from = sameSpace.findIndex((t) => t.id === tabId);
  const target = Math.max(0, Math.min(Math.trunc(index), sameSpace.length - 1));
  if (target === from) return { tabs: tabs as Tab[], index: target };

  const anchor = sameSpace[target];
  const next = tabs.filter((t) => t.id !== tabId);
  const anchorIdx = next.findIndex((t) => t.id === anchor.id);
  next.splice(target > from ? anchorIdx + 1 : anchorIdx, 0, moved);
  return { tabs: next, index: target };
}

/**
 * Pins an editor tab, or returns it to the preview slot.
 *
 * A space has exactly one preview slot: the tab the next opened file replaces.
 * Unpinning therefore pins whichever tab held the slot, otherwise two tabs
 * would claim it and the next open would replace an unpredictable one.
 */
export function setTabPinnedInList(
  tabs: readonly Tab[],
  tabId: number,
  pinned: boolean,
): { tabs: Tab[]; changed: boolean } {
  const target = tabs.find((t) => t.id === tabId);
  if (target?.kind !== "editor") {
    return { tabs: tabs as Tab[], changed: false };
  }
  return {
    tabs: tabs.map((t) => {
      if (t.id === tabId) return { ...t, preview: !pinned };
      if (!pinned && t.kind === "editor" && t.spaceId === target.spaceId) {
        return t.preview ? { ...t, preview: false } : t;
      }
      return t;
    }),
    changed: true,
  };
}

export function useTabs(initial?: Partial<TerminalTab>) {
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const tabId = 1;
    const leafId = 2;
    return [
      {
        id: tabId,
        kind: "terminal",
        spaceId: DEFAULT_SPACE_ID,
        cold: true,
        title: initial?.title ?? "shell",
        cwd: initial?.cwd,
        paneTree: { kind: "leaf", id: leafId, cwd: initial?.cwd },
        activeLeafId: leafId,
      },
    ];
  });
  const [activeId, setActiveId] = useState(1);
  // Gates warming until boot resolves the restore, so no shell spawns before it.
  const [booted, setBooted] = useState(false);
  const nextIdRef = useRef(3);
  const activeSpaceIdRef = useRef(DEFAULT_SPACE_ID);
  const tabsRef = useRef(tabs);
  const activeIdRef = useRef(activeId);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // Activating a cold tab warms it: one choke point for every activation path.
  useEffect(() => {
    if (!booted) return;
    setTabs((curr) => {
      const t = curr.find((x) => x.id === activeId);
      if (!t?.cold) return curr;
      return curr.map((x) => (x.id === activeId ? { ...x, cold: false } : x));
    });
  }, [activeId, booted]);

  // Spawns a restored tab where it sits, without stealing focus. Session
  // restore needs the shell of every reopened agent, not just the focused one,
  // and activation can only warm one tab.
  const warmTab = useCallback((tabId: number) => {
    setTabs((curr) => {
      const t = curr.find((x) => x.id === tabId);
      if (!t?.cold) return curr;
      return curr.map((x) => (x.id === tabId ? { ...x, cold: false } : x));
    });
  }, []);

  const allocId = useCallback(() => nextIdRef.current++, []);

  const markBooted = useCallback(() => setBooted(true), []);

  const setActiveSpaceForNewTabs = useCallback((spaceId: string) => {
    activeSpaceIdRef.current = spaceId;
  }, []);

  const replaceTabs = useCallback((next: Tab[], nextActiveId: number) => {
    if (next.length === 0) return;
    setTabs(next);
    setActiveId(nextActiveId);
  }, []);

  // Appends a cold terminal tab to a space without stealing focus, so the
  // overview can populate a space in place; it spawns when first opened.
  const newTabInSpace = useCallback((spaceId: string, cwd?: string) => {
    const tabId = nextIdRef.current++;
    const leafId = nextIdRef.current++;
    setTabs((curr) => [
      ...curr,
      {
        id: tabId,
        kind: "terminal",
        spaceId,
        cold: true,
        title: cwd ? basename(cwd) : "shell",
        cwd,
        paneTree: { kind: "leaf", id: leafId, cwd },
        activeLeafId: leafId,
      },
    ]);
    return tabId;
  }, []);

  // Reassigns a tab to another space. Returns true when the moved tab was active
  // and emptied its source space, so the caller should follow it into the target.
  const moveTabToSpace = useCallback(
    (tabId: number, targetSpaceId: string): boolean => {
      const curr = tabsRef.current;
      const tab = curr.find((t) => t.id === tabId);
      if (!tab || tab.spaceId === targetSpaceId) return false;
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId ? ({ ...t, spaceId: targetSpaceId } as Tab) : t,
        ),
      );
      if (activeIdRef.current !== tabId) return false;
      const fallback = nextActiveInSpace(curr, tabId);
      if (fallback !== null) {
        setActiveId(fallback);
        return false;
      }
      return true;
    },
    [],
  );

  // Positions a tab next to a target tab, inheriting the target's space. Returns
  // true when the active tab crossed into the target space and emptied its
  // source, so the caller should follow it.
  const reorderTab = useCallback(
    (tabId: number, targetTabId: number, edge: "top" | "bottom"): boolean => {
      if (tabId === targetTabId) return false;
      const curr = tabsRef.current;
      const moved = curr.find((t) => t.id === tabId);
      const target = curr.find((t) => t.id === targetTabId);
      if (!moved || !target) return false;
      const crossSpace = moved.spaceId !== target.spaceId;
      setTabs((prev) => {
        const without = prev.filter((t) => t.id !== tabId);
        let idx = without.findIndex((t) => t.id === targetTabId);
        if (idx < 0) return prev;
        if (edge === "bottom") idx += 1;
        const next: Tab = crossSpace
          ? ({ ...moved, spaceId: target.spaceId } as Tab)
          : moved;
        without.splice(idx, 0, next);
        return without;
      });
      if (!crossSpace || activeIdRef.current !== tabId) return false;
      const fallback = nextActiveInSpace(curr, tabId);
      if (fallback !== null) {
        setActiveId(fallback);
        return false;
      }
      return true;
    },
    [],
  );

  const removeTabsForSpace = useCallback((spaceId: string) => {
    let toDispose: number[] = [];
    setTabs((curr) => {
      const next = curr.filter((t) => t.spaceId !== spaceId);
      if (next.length === 0 || next.length === curr.length) return curr;
      toDispose = curr
        .filter((t) => t.spaceId === spaceId && t.kind === "terminal")
        .flatMap((t) => leafIds((t as TerminalTab).paneTree));
      return next;
    });
    for (const lid of toDispose) disposeSession(lid);
  }, []);

  const newTab = useCallback((cwd?: string) => {
    const tabId = nextIdRef.current++;
    const leafId = nextIdRef.current++;
    setTabs((t) => [
      ...t,
      {
        id: tabId,
        kind: "terminal",
        spaceId: activeSpaceIdRef.current,
        title: "shell",
        cwd,
        paneTree: { kind: "leaf", id: leafId, cwd },
        activeLeafId: leafId,
      },
    ]);
    setActiveId(tabId);
    return tabId;
  }, []);

  const newBlockTab = useCallback((cwd?: string) => {
    const tabId = nextIdRef.current++;
    const leafId = nextIdRef.current++;
    setTabs((t) => [
      ...t,
      {
        id: tabId,
        kind: "terminal",
        spaceId: activeSpaceIdRef.current,
        title: "blocks",
        cwd,
        paneTree: { kind: "leaf", id: leafId, cwd },
        activeLeafId: leafId,
        blocks: true,
      },
    ]);
    setActiveId(tabId);
    return tabId;
  }, []);

  useEffect(() => {
    if (!import.meta.env?.DEV || typeof window === "undefined") return;
    (
      window as unknown as { __teraxNewBlockTab?: (cwd?: string) => number }
    ).__teraxNewBlockTab = newBlockTab;
  }, [newBlockTab]);

  const newAgentTab = useCallback((cwd: string | undefined, title: string) => {
    const tabId = nextIdRef.current++;
    const leafId = nextIdRef.current++;
    setTabs((t) => [
      ...t,
      {
        id: tabId,
        kind: "terminal",
        spaceId: activeSpaceIdRef.current,
        title,
        cwd,
        paneTree: { kind: "leaf", id: leafId, cwd },
        activeLeafId: leafId,
      },
    ]);
    setActiveId(tabId);
    return { tabId, leafId };
  }, []);

  const newPrivateTab = useCallback((cwd?: string) => {
    const tabId = nextIdRef.current++;
    const leafId = nextIdRef.current++;
    setTabs((t) => [
      ...t,
      {
        id: tabId,
        kind: "terminal",
        spaceId: activeSpaceIdRef.current,
        title: "private",
        cwd,
        paneTree: { kind: "leaf", id: leafId, cwd },
        activeLeafId: leafId,
        private: true,
      },
    ]);
    setActiveId(tabId);
    return tabId;
  }, []);

  /**
   * Opens a file in an editor tab.
   *
   * - `pin = true` (default) — opens or activates a **persistent** tab.
   *   If the path is currently in the preview slot it is promoted in-place.
   *   Use this for programmatic opens (AI diff, New File dialog, etc.).
   * - `pin = false` — VSCode-style **preview** tab. A single shared slot is
   *   reused: if a persistent tab for the path already exists it is activated;
   *   otherwise the current preview slot is replaced with the new path.
   */
  const openFileTab = useCallback((path: string, pin = true) => {
    let targetId: number | null = null;
    setTabs((curr) => {
      if (pin) {
        // Persistent open: find any existing editor tab, pin it if needed.
        const existing = curr.find(
          (t) => t.kind === "editor" && t.path === path,
        );
        if (existing) {
          targetId = existing.id;
          if ((existing as EditorTab).preview) {
            return curr.map((t) =>
              t.id === existing.id ? { ...t, preview: false } : t,
            );
          }
          return curr;
        }
        const id = nextIdRef.current++;
        targetId = id;
        return [
          ...curr,
          {
            id,
            kind: "editor",
            spaceId: activeSpaceIdRef.current,
            title: basename(path),
            path,
            dirty: false,
            preview: false,
          } satisfies EditorTab,
        ];
      } else {
        // Preview open: persistent tab for this path takes priority.
        const persistent = curr.find(
          (t) =>
            t.kind === "editor" && t.path === path && !(t as EditorTab).preview,
        );
        if (persistent) {
          targetId = persistent.id;
          return curr;
        }
        // Reuse the slot if it already shows the same path.
        const existingPreview = curr.find(
          (t) =>
            t.kind === "editor" && t.path === path && (t as EditorTab).preview,
        );
        if (existingPreview) {
          targetId = existingPreview.id;
          return curr;
        }
        // Replace the current preview slot, or append a new one.
        const previewIdx = curr.findIndex(
          (t) => t.kind === "editor" && (t as EditorTab).preview,
        );
        const id = nextIdRef.current++;
        targetId = id;
        const tab: EditorTab = {
          id,
          kind: "editor",
          spaceId: activeSpaceIdRef.current,
          title: basename(path),
          path,
          dirty: false,
          preview: true,
        };
        if (previewIdx === -1) return [...curr, tab];
        const next = [...curr];
        next[previewIdx] = tab;
        return next;
      }
    });
    if (targetId !== null) setActiveId(targetId);
    return targetId as number | null;
  }, []);

  /**
   * Promotes a preview tab to a persistent one. Called on double-click of the
   * tab title in the tab bar. Dirty edits also auto-promote (see `updateTab`).
   */
  const pinTab = useCallback((id: number) => {
    setTabs((curr) =>
      curr.map((t) =>
        t.id === id && t.kind === "editor" ? { ...t, preview: false } : t,
      ),
    );
  }, []);

  const openAiDiffTab = useCallback(
    (input: {
      path: string;
      originalContent: string;
      proposedContent: string;
      approvalId: string;
      isNewFile: boolean;
    }) => {
      let targetId: number | null = null;
      setTabs((curr) => {
        const existing = curr.find(
          (t) => t.kind === "ai-diff" && t.approvalId === input.approvalId,
        );
        if (existing) {
          targetId = existing.id;
          return curr;
        }
        const id = nextIdRef.current++;
        targetId = id;
        const title = `${basename(input.path)} (AI diff)`;
        return [
          ...curr,
          {
            id,
            kind: "ai-diff",
            spaceId: activeSpaceIdRef.current,
            title,
            path: input.path,
            originalContent: input.originalContent,
            proposedContent: input.proposedContent,
            approvalId: input.approvalId,
            status: "pending",
            isNewFile: input.isNewFile,
          },
        ];
      });
      if (targetId !== null) setActiveId(targetId);
      return targetId as number | null;
    },
    [],
  );

  const setAiDiffStatus = useCallback(
    (approvalId: string, status: AiDiffStatus) => {
      setTabs((curr) =>
        curr.map((t) =>
          t.kind === "ai-diff" && t.approvalId === approvalId
            ? { ...t, status }
            : t,
        ),
      );
    },
    [],
  );

  const closeAiDiffTab = useCallback((approvalId: string) => {
    setTabs((curr) => {
      const target = curr.find(
        (t) => t.kind === "ai-diff" && t.approvalId === approvalId,
      );
      if (!target) return curr;
      const fallback = nextActiveInSpace(curr, target.id);
      if (fallback === null) {
        return curr.map((t) =>
          t.kind === "ai-diff" && t.approvalId === approvalId
            ? { ...t, status: "approved" as AiDiffStatus }
            : t,
        );
      }
      const next = curr.filter((t) => t.id !== target.id);
      setActiveId((active) => (target.id === active ? fallback : active));
      return next;
    });
  }, []);

  const newPreviewTab = useCallback((url: string) => {
    const id = nextIdRef.current++;
    setTabs((t) => [
      ...t,
      {
        id,
        kind: "preview",
        spaceId: activeSpaceIdRef.current,
        title: titleFromUrl(url),
        url,
      },
    ]);
    setActiveId(id);
    return id;
  }, []);

  const newMarkdownTab = useCallback((path: string) => {
    let targetId: number | null = null;
    setTabs((curr) => {
      const existing = curr.find(
        (t) => t.kind === "markdown" && t.path === path,
      );
      if (existing) {
        targetId = existing.id;
        return curr;
      }
      const id = nextIdRef.current++;
      targetId = id;
      return [
        ...curr,
        {
          id,
          kind: "markdown",
          spaceId: activeSpaceIdRef.current,
          title: basename(path),
          path,
        },
      ];
    });
    if (targetId !== null) setActiveId(targetId);
    return targetId;
  }, []);

  const newMermaidTab = useCallback(
    (source: string, title = "Mermaid diagram") => {
      const id = nextIdRef.current++;
      startTransition(() => {
        setTabs((curr) => [
          ...curr,
          {
            id,
            kind: "mermaid",
            spaceId: activeSpaceIdRef.current,
            title,
            source,
          } satisfies MermaidTab,
        ]);
        setActiveId(id);
      });
      return id;
    },
    [],
  );

  const updateMermaidSource = useCallback((id: number, source: string) => {
    setTabs((curr) =>
      curr.map((tab) =>
        tab.id === id && tab.kind === "mermaid" ? { ...tab, source } : tab,
      ),
    );
  }, []);

  const replaceMermaidTabContent = useCallback(
    (id: number, source: string, title?: string) => {
      const result = replaceMermaidTab(tabsRef.current, id, source, title);
      if (!result.updated) return false;
      setTabs(result.tabs);
      return true;
    },
    [],
  );

  const updateMermaidVisualLayout = useCallback(
    (id: number, visualLayout: MermaidVisualLayout | undefined) => {
      setTabs((curr) =>
        curr.map((tab) =>
          tab.id === id && tab.kind === "mermaid"
            ? { ...tab, visualLayout }
            : tab,
        ),
      );
    },
    [],
  );

  const setMarkdownView = useCallback(
    (id: number, mode: "rendered" | "raw") => {
      setTabs((curr) =>
        curr.map((t) => (t.id !== id ? t : applyMarkdownView(t, mode))),
      );
    },
    [],
  );

  const openGitDiffTab = useCallback(
    (input: {
      path: string;
      repoRoot: string;
      mode: "-" | "+";
      originalPath?: string | null;
      title?: string;
    }) => {
      const curr = tabsRef.current;
      const existing = curr.find(
        (t) =>
          t.kind === "git-diff" &&
          t.repoRoot === input.repoRoot &&
          t.path === input.path &&
          t.mode === input.mode,
      );
      const computedTitle =
        input.title ?? `${basename(input.path)} (${input.mode})`;
      const originalPath = input.originalPath ?? null;

      if (existing) {
        const nextTabs = curr.map((t) =>
          t.id === existing.id
            ? { ...t, title: computedTitle, originalPath }
            : t,
        );
        tabsRef.current = nextTabs;
        setTabs(nextTabs);
        setActiveId(existing.id);
        return existing.id;
      }

      const id = nextIdRef.current++;
      const nextTabs = [
        ...curr,
        {
          id,
          kind: "git-diff",
          spaceId: activeSpaceIdRef.current,
          title: computedTitle,
          path: input.path,
          repoRoot: input.repoRoot,
          mode: input.mode,
          originalPath,
        } satisfies GitDiffTab,
      ];
      tabsRef.current = nextTabs;
      setTabs(nextTabs);
      setActiveId(id);
      return id;
    },
    [],
  );

  const openCommitHistoryTab = useCallback(
    (input: { repoRoot: string; branch?: string | null }) => {
      const curr = tabsRef.current;
      const existing = curr.find(
        (t) => t.kind === "git-history" && t.repoRoot === input.repoRoot,
      );
      const title = input.branch ? `History · ${input.branch}` : "Git History";
      if (existing) {
        const nextTabs = curr.map((t) =>
          t.id === existing.id ? { ...t, title } : t,
        );
        tabsRef.current = nextTabs;
        setTabs(nextTabs);
        setActiveId(existing.id);
        return existing.id;
      }
      const id = nextIdRef.current++;
      const nextTabs = [
        ...curr,
        {
          id,
          kind: "git-history",
          spaceId: activeSpaceIdRef.current,
          title,
          repoRoot: input.repoRoot,
        } satisfies GitHistoryTab,
      ];
      tabsRef.current = nextTabs;
      setTabs(nextTabs);
      setActiveId(id);
      return id;
    },
    [],
  );

  const openPrReviewTab = useCallback(
    (input: { repoRoot: string; head: string; base: string }) => {
      const curr = tabsRef.current;
      // One review per branch: reopening from the panel should return to the
      // review already in progress rather than start a second copy of it.
      const existing = curr.find(
        (t) =>
          t.kind === "pr-review" &&
          t.repoRoot === input.repoRoot &&
          t.head === input.head,
      );
      const title = `Review ${input.head}`;
      if (existing) {
        const nextTabs = curr.map((t) =>
          t.id === existing.id ? { ...t, title, base: input.base } : t,
        );
        tabsRef.current = nextTabs;
        setTabs(nextTabs);
        setActiveId(existing.id);
        return existing.id;
      }
      const id = nextIdRef.current++;
      const nextTabs = [
        ...curr,
        {
          id,
          kind: "pr-review",
          spaceId: activeSpaceIdRef.current,
          title,
          repoRoot: input.repoRoot,
          head: input.head,
          base: input.base,
        } satisfies PrReviewTab,
      ];
      tabsRef.current = nextTabs;
      setTabs(nextTabs);
      setActiveId(id);
      return id;
    },
    [],
  );

  const setPrReviewBase = useCallback((tabId: number, base: string) => {
    setTabs((curr) =>
      curr.map((t) =>
        t.id === tabId && t.kind === "pr-review" ? { ...t, base } : t,
      ),
    );
  }, []);

  const openCommitFileDiffTab = useCallback(
    (input: {
      repoRoot: string;
      sha: string;
      shortSha: string;
      subject: string;
      path: string;
      originalPath: string | null;
    }) => {
      const curr = tabsRef.current;
      const existing = curr.find(
        (t) =>
          t.kind === "git-commit-file" &&
          t.repoRoot === input.repoRoot &&
          t.sha === input.sha &&
          t.path === input.path,
      );
      const title = `${basename(input.path)} @ ${input.shortSha}`;
      if (existing) {
        const nextTabs = curr.map((t) =>
          t.id === existing.id
            ? {
                ...t,
                title,
                subject: input.subject,
                originalPath: input.originalPath,
              }
            : t,
        );
        tabsRef.current = nextTabs;
        setTabs(nextTabs);
        setActiveId(existing.id);
        return existing.id;
      }
      const id = nextIdRef.current++;
      const nextTabs = [
        ...curr,
        {
          id,
          kind: "git-commit-file",
          spaceId: activeSpaceIdRef.current,
          title,
          repoRoot: input.repoRoot,
          sha: input.sha,
          shortSha: input.shortSha,
          subject: input.subject,
          path: input.path,
          originalPath: input.originalPath,
        } satisfies GitCommitFileDiffTab,
      ];
      tabsRef.current = nextTabs;
      setTabs(nextTabs);
      setActiveId(id);
      return id;
    },
    [],
  );

  const closeTab = useCallback((id: number) => {
    let toDispose: number[] = [];
    setTabs((curr) => {
      const fallback = nextActiveInSpace(curr, id);
      if (fallback === null) return curr;
      const target = curr.find((t) => t.id === id);
      if (target?.kind === "terminal") {
        toDispose = leafIds(target.paneTree);
      }
      const next = curr.filter((t) => t.id !== id);
      setActiveId((active) => (id === active ? fallback : active));
      return next;
    });
    for (const lid of toDispose) disposeSession(lid);
  }, []);

  const updateTab = useCallback((id: number, patch: TabPatch) => {
    setTabs((t) =>
      t.map((x) => {
        if (x.id !== id) return x;
        return applyTabPatch(x, patch);
      }),
    );
  }, []);

  /** Update a tab's notes with an immutable updater. Persisted via the space
   * serializer, so notes survive restarts and are scoped per workspace+tab. */
  const updateTabNotes = useCallback(
    (id: number, updater: (notes: NoteCard[]) => NoteCard[]) => {
      setTabs((t) =>
        t.map((x) => {
          if (x.id !== id) return x;
          const current = x.notes ?? [];
          const next = updater(current);
          if (next === current) return x;
          return { ...x, notes: next };
        }),
      );
    },
    [],
  );

  const selectByIndex = useCallback(
    (idx: number) => {
      const t = tabs[idx];
      if (t) setActiveId(t.id);
    },
    [tabs],
  );

  /** Update a leaf's cwd; mirror to the tab's `cwd` when the leaf is active.
   * Bails out without setTabs when nothing actually changed — shell integration
   * re-emits OSC 7 on every prompt, including empty Enters, so this fires at
   * keystroke rate. Always-setTabs there cascades a paneTree re-render across
   * every open tab. */
  const setLeafCwd = useCallback((leafId: number, cwd: string) => {
    setTabs((curr) => {
      let changed = false;
      const next = curr.map((t) => {
        if (t.kind !== "terminal" || !hasLeaf(t.paneTree, leafId)) return t;
        const paneTree = setLeafCwdInTree(t.paneTree, leafId, cwd);
        const isActive = t.activeLeafId === leafId;
        const cwdChanged = isActive && t.cwd !== cwd;
        if (paneTree === t.paneTree && !cwdChanged) return t;
        changed = true;
        return { ...t, paneTree, ...(cwdChanged && { cwd }) };
      });
      return changed ? next : curr;
    });
  }, []);

  const focusPane = useCallback((tabId: number, leafId: number) => {
    setTabs((curr) =>
      curr.map((t) => {
        if (t.id !== tabId || t.kind !== "terminal") return t;
        if (!hasLeaf(t.paneTree, leafId)) return t;
        if (t.activeLeafId === leafId) return t;
        const cwd = findLeafCwd(t.paneTree, leafId);
        return {
          ...t,
          activeLeafId: leafId,
          ...(cwd !== undefined && { cwd }),
        };
      }),
    );
  }, []);

  const focusNextPaneInTab = useCallback((tabId: number, delta: 1 | -1) => {
    setTabs((curr) =>
      curr.map((t) => {
        if (t.id !== tabId || t.kind !== "terminal") return t;
        const next = nextLeafId(t.paneTree, t.activeLeafId, delta);
        if (next === t.activeLeafId) return t;
        const cwd = findLeafCwd(t.paneTree, next);
        return { ...t, activeLeafId: next, ...(cwd !== undefined && { cwd }) };
      }),
    );
  }, []);

  /** Split the active leaf of `tabId` along `dir`. Returns the new leaf id. */
  const splitActivePane = useCallback(
    (tabId: number, dir: SplitDir): number | null => {
      let newLeafId: number | null = null;
      setTabs((curr) =>
        curr.map((t) => {
          if (t.id !== tabId || t.kind !== "terminal" || t.blocks) return t;
          if (leafIds(t.paneTree).length >= MAX_PANES_PER_TAB) return t;
          const splitId = nextIdRef.current++;
          const leafId = nextIdRef.current++;
          newLeafId = leafId;
          const paneTree = splitLeaf(
            t.paneTree,
            t.activeLeafId,
            splitId,
            leafId,
            dir,
            t.cwd,
          );
          return { ...t, paneTree, activeLeafId: leafId };
        }),
      );
      return newLeafId;
    },
    [],
  );

  const closePaneByLeaf = useCallback((leafId: number): void => {
    let didRemove = false;
    setTabs((curr) => {
      const tab = curr.find(
        (t) => t.kind === "terminal" && hasLeaf(t.paneTree, leafId),
      );
      if (tab?.kind !== "terminal") return curr;
      const newTree = removeLeaf(tab.paneTree, leafId);
      if (newTree === null) {
        const fallback = nextActiveInSpace(curr, tab.id);
        if (fallback === null) return curr;
        const next = curr.filter((x) => x.id !== tab.id);
        setActiveId((active) => (active === tab.id ? fallback : active));
        didRemove = true;
        return next;
      }
      const remaining = leafIds(newTree);
      let newActive = tab.activeLeafId;
      if (tab.activeLeafId === leafId) {
        const sib = siblingLeafOf(tab.paneTree, leafId);
        newActive = sib && remaining.includes(sib) ? sib : remaining[0];
      }
      didRemove = true;
      return curr.map((x) =>
        x.id === tab.id
          ? { ...x, paneTree: newTree, activeLeafId: newActive }
          : x,
      );
    });
    if (didRemove) disposeSession(leafId);
  }, []);

  const closeActivePane = useCallback((tabId: number): boolean => {
    let closedTab = false;
    let removedLeaf: number | null = null;
    setTabs((curr) => {
      const t = curr.find((x) => x.id === tabId);
      if (t?.kind !== "terminal") return curr;
      const target = t.activeLeafId;
      const newTree = removeLeaf(t.paneTree, target);
      if (newTree === null) {
        const fallback = nextActiveInSpace(curr, tabId);
        if (fallback === null) return curr;
        const next = curr.filter((x) => x.id !== tabId);
        setActiveId((active) => (active === tabId ? fallback : active));
        closedTab = true;
        removedLeaf = target;
        return next;
      }
      const remaining = leafIds(newTree);
      const sib = siblingLeafOf(t.paneTree, target);
      const newActive = sib && remaining.includes(sib) ? sib : remaining[0];
      removedLeaf = target;
      return curr.map((x) =>
        x.id === tabId
          ? { ...x, paneTree: newTree, activeLeafId: newActive }
          : x,
      );
    });
    if (removedLeaf !== null) disposeSession(removedLeaf);
    return closedTab;
  }, []);

  const resetWorkspace = useCallback((cwd?: string) => {
    const tabId = nextIdRef.current++;
    const leafId = nextIdRef.current++;
    let toDispose: number[] = [];
    setTabs((curr) => {
      toDispose = curr.flatMap((t) =>
        t.kind === "terminal" ? leafIds(t.paneTree) : [],
      );
      return [
        {
          id: tabId,
          kind: "terminal",
          spaceId: activeSpaceIdRef.current,
          title: "shell",
          cwd,
          paneTree: { kind: "leaf", id: leafId, cwd },
          activeLeafId: leafId,
        },
      ];
    });
    setActiveId(tabId);
    for (const lid of toDispose) disposeSession(lid);
  }, []);

  const reorderTabByGap = useCallback((fromId: number, toGapIndex: number) => {
    setTabs((prev) => reorderTabsByGap(prev, fromId, toGapIndex));
  }, []);

  const moveTab = useCallback((tabId: number, index: number) => {
    const result = moveTabToIndex(tabsRef.current, tabId, index);
    if (result.index === null) return null;
    tabsRef.current = result.tabs;
    setTabs(result.tabs);
    return result.index;
  }, []);

  const setTabPinned = useCallback((tabId: number, pinned: boolean) => {
    const result = setTabPinnedInList(tabsRef.current, tabId, pinned);
    if (!result.changed) return false;
    tabsRef.current = result.tabs;
    setTabs(result.tabs);
    return true;
  }, []);

  return {
    tabs,
    activeId,
    setActiveId,
    allocId,
    replaceTabs,
    moveTabToSpace,
    reorderTab,
    reorderTabByGap,
    moveTab,
    setTabPinned,
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
    openGitDiffTab,
    openCommitHistoryTab,
    openCommitFileDiffTab,
    openPrReviewTab,
    setPrReviewBase,
    setAiDiffStatus,
    closeAiDiffTab,
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
  };
}
