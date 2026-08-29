import { validateMermaidDraftSource } from "@/modules/mermaid";
import { isNoteCard, type NoteCard } from "@/modules/notes/lib/cards";
import {
  type EditorTab,
  isTabColor,
  type MarkdownTab,
  type MermaidTab,
  type MermaidVisualLayout,
  type PreviewTab,
  type Tab,
  type TabColor,
  type TerminalTab,
} from "@/modules/tabs";
import {
  isLeaf,
  type PaneNode,
  type SplitDir,
} from "@/modules/terminal/lib/panes";

export type SerializedNode =
  | { kind: "leaf"; cwd?: string; active?: boolean }
  | { kind: "split"; dir: SplitDir; children: SerializedNode[] };

type SerializedTabBase = { color?: TabColor; notes?: NoteCard[] };

export type SerializedTab =
  | (SerializedTabBase & {
      kind: "terminal";
      tree: SerializedNode;
      blocks?: boolean;
      customTitle?: string;
    })
  | (SerializedTabBase & { kind: "editor"; path: string })
  | (SerializedTabBase & { kind: "preview"; url: string })
  | (SerializedTabBase & { kind: "markdown"; path: string })
  | (SerializedTabBase & {
      kind: "mermaid";
      title: string;
      source: string;
      visualLayout?: MermaidVisualLayout;
    });

const MAX_MERMAID_LAYOUT_NODES = 256;
const MAX_MERMAID_LAYOUT_COORDINATE = 100_000;
const MERMAID_VISUAL_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;

function validateMermaidVisualLayout(
  value: unknown,
): MermaidVisualLayout | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const candidate = value as { kind?: unknown; positions?: unknown };
  if (
    candidate.kind !== "flowchart" ||
    !candidate.positions ||
    typeof candidate.positions !== "object" ||
    Array.isArray(candidate.positions)
  ) {
    return;
  }
  const entries = Object.entries(candidate.positions);
  if (entries.length > MAX_MERMAID_LAYOUT_NODES) return;
  const positions: MermaidVisualLayout["positions"] = {};
  for (const [id, point] of entries) {
    if (!MERMAID_VISUAL_ID.test(id) || !point || typeof point !== "object") {
      return;
    }
    const { x, y } = point as { x?: unknown; y?: unknown };
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      Math.abs(x) > MAX_MERMAID_LAYOUT_COORDINATE ||
      Math.abs(y) > MAX_MERMAID_LAYOUT_COORDINATE
    ) {
      return;
    }
    positions[id] = { x, y };
  }
  return { kind: "flowchart", positions };
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function titleFromUrl(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url || "preview";
  }
}

function serializeNode(node: PaneNode, activeLeafId: number): SerializedNode {
  if (isLeaf(node)) {
    return {
      kind: "leaf",
      ...(node.cwd !== undefined && { cwd: node.cwd }),
      ...(node.id === activeLeafId && { active: true }),
    };
  }
  return {
    kind: "split",
    dir: node.dir,
    children: node.children.map((c) => serializeNode(c, activeLeafId)),
  };
}

export function isSerializableTab(tab: Tab): boolean {
  switch (tab.kind) {
    case "terminal":
      return !tab.private;
    case "editor":
    case "preview":
    case "markdown":
    case "mermaid":
      return true;
    default:
      return false;
  }
}

function serializeTab(tab: Tab): SerializedTab | null {
  if (!isSerializableTab(tab)) return null;
  switch (tab.kind) {
    case "terminal":
      return {
        kind: "terminal",
        tree: serializeNode(tab.paneTree, tab.activeLeafId),
        ...(tab.blocks && { blocks: true }),
        ...(tab.customTitle !== undefined && { customTitle: tab.customTitle }),
        ...(tab.color !== undefined && { color: tab.color }),
      };
    case "editor":
      return {
        kind: "editor",
        path: tab.path,
        ...(tab.color !== undefined && { color: tab.color }),
      };
    case "preview":
      return {
        kind: "preview",
        url: tab.url,
        ...(tab.color !== undefined && { color: tab.color }),
      };
    case "markdown":
      return {
        kind: "markdown",
        path: tab.path,
        ...(tab.color !== undefined && { color: tab.color }),
      };
    case "mermaid": {
      const visualLayout = validateMermaidVisualLayout(tab.visualLayout);
      return {
        kind: "mermaid",
        title: tab.customTitle ?? tab.title,
        source: tab.source,
        ...(visualLayout && { visualLayout }),
        ...(tab.color !== undefined && { color: tab.color }),
      };
    }
    default:
      return null;
  }
}

export function serializeTabs(tabs: Tab[]): SerializedTab[] {
  const out: SerializedTab[] = [];
  for (const tab of tabs) {
    const s = serializeTab(tab);
    if (!s) continue;
    if (tab.notes?.length) {
      const valid = tab.notes.filter(isNoteCard);
      if (valid.length) s.notes = valid;
    }
    out.push(s);
  }
  return out;
}

type HydratedTree = {
  tree: PaneNode;
  activeLeafId: number;
  firstLeafCwd?: string;
};

function hydrateNode(
  node: SerializedNode,
  allocId: () => number,
  acc: { activeLeafId: number | null },
): PaneNode {
  if (node.kind === "leaf") {
    const id = allocId();
    if (node.active && acc.activeLeafId === null) acc.activeLeafId = id;
    return {
      kind: "leaf",
      id,
      ...(node.cwd !== undefined && { cwd: node.cwd }),
    };
  }
  const children = node.children.map((c) => hydrateNode(c, allocId, acc));
  if (children.length === 0) return { kind: "leaf", id: allocId() };
  if (children.length === 1) return children[0];
  return { kind: "split", id: allocId(), dir: node.dir, children };
}

function hydrateTree(
  tree: SerializedNode,
  allocId: () => number,
): HydratedTree {
  const acc: { activeLeafId: number | null } = { activeLeafId: null };
  const paneTree = hydrateNode(tree, allocId, acc);
  const leaves = collectLeaves(paneTree);
  const activeLeafId = acc.activeLeafId ?? leaves[0]?.id ?? allocId();
  const firstLeafCwd =
    leaves.find((l) => l.id === activeLeafId)?.cwd ?? leaves[0]?.cwd;
  return { tree: paneTree, activeLeafId, firstLeafCwd };
}

function collectLeaves(node: PaneNode): Array<{ id: number; cwd?: string }> {
  if (isLeaf(node)) return [{ id: node.id, cwd: node.cwd }];
  return node.children.flatMap(collectLeaves);
}

function hydrateTab(
  s: SerializedTab,
  spaceId: string,
  allocId: () => number,
): Tab | null {
  const color = isTabColor(s.color) ? { color: s.color } : {};
  switch (s.kind) {
    case "terminal": {
      const { tree, activeLeafId, firstLeafCwd } = hydrateTree(s.tree, allocId);
      const title =
        s.customTitle ??
        (firstLeafCwd ? basename(firstLeafCwd) : s.blocks ? "blocks" : "shell");
      return {
        id: allocId(),
        kind: "terminal",
        spaceId,
        cold: true,
        title,
        cwd: firstLeafCwd,
        paneTree: tree,
        activeLeafId,
        ...(s.blocks && { blocks: true }),
        ...(s.customTitle !== undefined && { customTitle: s.customTitle }),
        ...color,
      } satisfies TerminalTab;
    }
    case "editor":
      return {
        id: allocId(),
        kind: "editor",
        spaceId,
        cold: true,
        title: basename(s.path),
        path: s.path,
        dirty: false,
        preview: false,
        ...color,
      } satisfies EditorTab;
    case "preview":
      return {
        id: allocId(),
        kind: "preview",
        spaceId,
        cold: true,
        title: titleFromUrl(s.url),
        url: s.url,
        ...color,
      } satisfies PreviewTab;
    case "markdown":
      return {
        id: allocId(),
        kind: "markdown",
        spaceId,
        cold: true,
        title: basename(s.path),
        path: s.path,
        ...color,
      } satisfies MarkdownTab;
    case "mermaid": {
      if (typeof s.source !== "string") return null;
      const source = validateMermaidDraftSource(s.source);
      if (!source.ok) return null;
      const title =
        typeof s.title === "string" && s.title.trim()
          ? s.title.trim().slice(0, 80)
          : "Mermaid diagram";
      const visualLayout = validateMermaidVisualLayout(
        (s as { visualLayout?: unknown }).visualLayout,
      );
      return {
        id: allocId(),
        kind: "mermaid",
        spaceId,
        cold: true,
        title,
        source: source.source,
        ...(visualLayout && { visualLayout }),
        ...color,
      } satisfies MermaidTab;
    }
    default:
      return null;
  }
}

export function freshTerminalTab(
  spaceId: string,
  cwd: string | null,
  allocId: () => number,
): TerminalTab {
  const leafId = allocId();
  return {
    id: allocId(),
    kind: "terminal",
    spaceId,
    cold: true,
    title: cwd ? basename(cwd) : "shell",
    cwd: cwd ?? undefined,
    paneTree: { kind: "leaf", id: leafId, ...(cwd && { cwd }) },
    activeLeafId: leafId,
  };
}

export function hydrateTabs(
  serialized: SerializedTab[],
  spaceId: string,
  allocId: () => number,
): Tab[] {
  if (!Array.isArray(serialized)) return [];
  const out: Tab[] = [];
  for (const s of serialized) {
    try {
      const tab = hydrateTab(s, spaceId, allocId);
      if (!tab) continue;
      const rawNotes = (s as { notes?: unknown }).notes;
      if (Array.isArray(rawNotes)) {
        const valid = rawNotes.filter(isNoteCard);
        if (valid.length) tab.notes = valid;
      }
      out.push(tab);
    } catch {
      // Skip corrupted entries rather than failing the whole restore.
    }
  }
  return out;
}
