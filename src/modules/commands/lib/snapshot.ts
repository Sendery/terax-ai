import { leafIds } from "@/modules/terminal";
import type { SidebarViewId } from "@/modules/sidebar";
import type { Tab } from "@/modules/tabs";

export type SnapshotTab =
  | {
      id: number;
      kind: "terminal";
      spaceId: string;
      title: string;
      cwd?: string;
      paneCount: number;
    }
  | {
      id: number;
      kind: "private-terminal";
      spaceId: string;
    }
  | {
      id: number;
      kind: "editor";
      spaceId: string;
      title: string;
      path: string;
      dirty: boolean;
      preview: boolean;
    }
  | {
      id: number;
      kind: "preview";
      spaceId: string;
      title: string;
      url: string;
    }
  | {
      id: number;
      kind: "markdown";
      spaceId: string;
      title: string;
      path: string;
    }
  | {
      id: number;
      kind: "ai-diff";
      spaceId: string;
      title: string;
      path: string;
      status: "pending" | "approved" | "rejected";
      isNewFile: boolean;
    }
  | {
      id: number;
      kind: "git-diff";
      spaceId: string;
      title: string;
      repoRoot: string;
      path: string;
      mode: "-" | "+";
      originalPath: string | null;
    }
  | {
      id: number;
      kind: "git-history";
      spaceId: string;
      title: string;
      repoRoot: string;
    }
  | {
      id: number;
      kind: "git-commit-file";
      spaceId: string;
      title: string;
      repoRoot: string;
      sha: string;
      shortSha: string;
      subject: string;
      path: string;
      originalPath: string | null;
    };

export type AppSnapshot = {
  version: 1;
  activeTabId: number | null;
  activeSpaceId: string | null;
  sidebar?: {
    visible: boolean;
    view: SidebarViewId;
  };
  tabs: SnapshotTab[];
};

export type AppSnapshotInput = {
  tabs: Tab[];
  activeTabId: number | null;
  activeSpaceId: string | null;
  sidebar?: {
    visible: boolean;
    view: SidebarViewId;
  };
};

function displayTitle(tab: Tab): string {
  return tab.customTitle ?? tab.title;
}

function serializeTab(tab: Tab): SnapshotTab {
  if (tab.kind === "terminal") {
    if (tab.private) {
      return {
        id: tab.id,
        kind: "private-terminal",
        spaceId: tab.spaceId,
      };
    }
    return {
      id: tab.id,
      kind: "terminal",
      spaceId: tab.spaceId,
      title: displayTitle(tab),
      ...(tab.cwd ? { cwd: tab.cwd } : {}),
      paneCount: leafIds(tab.paneTree).length,
    };
  }

  if (tab.kind === "editor") {
    return {
      id: tab.id,
      kind: "editor",
      spaceId: tab.spaceId,
      title: displayTitle(tab),
      path: tab.path,
      dirty: tab.dirty,
      preview: tab.preview,
    };
  }

  if (tab.kind === "preview") {
    return {
      id: tab.id,
      kind: "preview",
      spaceId: tab.spaceId,
      title: displayTitle(tab),
      url: tab.url,
    };
  }

  if (tab.kind === "markdown") {
    return {
      id: tab.id,
      kind: "markdown",
      spaceId: tab.spaceId,
      title: displayTitle(tab),
      path: tab.path,
    };
  }

  if (tab.kind === "ai-diff") {
    return {
      id: tab.id,
      kind: "ai-diff",
      spaceId: tab.spaceId,
      title: displayTitle(tab),
      path: tab.path,
      status: tab.status,
      isNewFile: tab.isNewFile,
    };
  }

  if (tab.kind === "git-diff") {
    return {
      id: tab.id,
      kind: "git-diff",
      spaceId: tab.spaceId,
      title: displayTitle(tab),
      repoRoot: tab.repoRoot,
      path: tab.path,
      mode: tab.mode,
      originalPath: tab.originalPath,
    };
  }

  if (tab.kind === "git-history") {
    return {
      id: tab.id,
      kind: "git-history",
      spaceId: tab.spaceId,
      title: displayTitle(tab),
      repoRoot: tab.repoRoot,
    };
  }

  return {
    id: tab.id,
    kind: "git-commit-file",
    spaceId: tab.spaceId,
    title: displayTitle(tab),
    repoRoot: tab.repoRoot,
    sha: tab.sha,
    shortSha: tab.shortSha,
    subject: tab.subject,
    path: tab.path,
    originalPath: tab.originalPath,
  };
}

export function buildAppSnapshot(input: AppSnapshotInput): AppSnapshot {
  return {
    version: 1,
    activeTabId: input.activeTabId,
    activeSpaceId: input.activeSpaceId,
    ...(input.sidebar ? { sidebar: input.sidebar } : {}),
    tabs: input.tabs.map(serializeTab),
  };
}
