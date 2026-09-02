import { leafIds } from "@/modules/terminal";
import type { SidebarViewId } from "@/modules/sidebar";
import type { Tab, TabColor } from "@/modules/tabs";
import {
  TTS_ENGINES,
  TTS_MODELS,
  type TtsEngineId,
  type TtsModelId,
} from "@/modules/tts/lib/engines";
import type { TtsStatus } from "@/modules/tts/lib/native";

export type SnapshotTab =
  | {
      id: number;
      kind: "terminal";
      spaceId: string;
      title: string;
      cwd?: string;
      paneCount: number;
      color?: TabColor;
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
      color?: TabColor;
    }
  | {
      id: number;
      kind: "preview";
      spaceId: string;
      title: string;
      url: string;
      color?: TabColor;
    }
  | {
      id: number;
      kind: "markdown";
      spaceId: string;
      title: string;
      path: string;
      color?: TabColor;
    }
  | {
      id: number;
      kind: "mermaid";
      spaceId: string;
      title: string;
      sourceCharacters: number;
      color?: TabColor;
    }
  | {
      id: number;
      kind: "ai-diff";
      spaceId: string;
      title: string;
      path: string;
      status: "pending" | "approved" | "rejected";
      isNewFile: boolean;
      color?: TabColor;
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
      color?: TabColor;
    }
  | {
      id: number;
      kind: "git-history";
      spaceId: string;
      title: string;
      repoRoot: string;
      color?: TabColor;
    }
  | {
      id: number;
      kind: "pr-review";
      spaceId: string;
      title: string;
      repoRoot: string;
      /** Branch under review. */
      head: string;
      /** Branch it is compared against. */
      base: string;
      color?: TabColor;
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
      color?: TabColor;
    };

/** Coordination state for a scheduled task. The prompt is deliberately absent:
 *  a stored prompt can carry sensitive detail, and ambient snapshots are not the
 *  place to surface it. `tasks.list` exposes it on explicit request. */
export type SnapshotTask = {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  mode: "task" | "routine";
  target: "headless" | "tab";
  missed: string;
  tabId?: number;
  nextRunAt: number | null;
  lastRunAt: number | null;
  runCount: number;
  maxRuns?: number;
  state: "running" | "queued" | "idle";
};

/** Local speech state as coordination data only: which engines and models are
 *  on disk, which are up, and whether this window is speaking. Never the text
 *  being read, never a sidecar token, never a sample path. */
export type SnapshotTts = {
  engines: { id: TtsEngineId; installed: boolean; running: boolean }[];
  models: { id: TtsModelId; downloaded: boolean }[];
  speaking: boolean;
};

export type SnapshotTtsInput = {
  /** Last status read by this window, or null when nothing has read it yet.
   *  The snapshot never invokes Rust to fill it in. */
  status: TtsStatus | null;
  speaking: boolean;
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
  scheduledTasks?: {
    paused: boolean;
    tasks: SnapshotTask[];
  };
  tts?: SnapshotTts;
};

export type AppSnapshotInput = {
  tabs: Tab[];
  activeTabId: number | null;
  activeSpaceId: string | null;
  sidebar?: {
    visible: boolean;
    view: SidebarViewId;
  };
  scheduledTasks?: {
    paused: boolean;
    tasks: SnapshotTaskInput[];
  };
  tts?: SnapshotTtsInput;
};

export type SnapshotTaskInput = {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  enabled: boolean;
  mode: "task" | "routine";
  target: "headless" | "tab";
  missed: string;
  tabId?: number;
  nextRunAt?: number | null;
  lastRunAt?: number;
  runCount: number;
  maxRuns?: number;
  running: boolean;
  queued: boolean;
};

function serializeTask(task: SnapshotTaskInput): SnapshotTask {
  return {
    id: task.id,
    name: task.name,
    schedule: task.schedule,
    enabled: task.enabled,
    mode: task.mode,
    target: task.target,
    missed: task.missed,
    ...(task.tabId !== undefined ? { tabId: task.tabId } : {}),
    nextRunAt: task.nextRunAt ?? null,
    lastRunAt: task.lastRunAt ?? null,
    runCount: task.runCount,
    ...(task.maxRuns !== undefined ? { maxRuns: task.maxRuns } : {}),
    state: task.running ? "running" : task.queued ? "queued" : "idle",
  };
}

function serializeTts(input: SnapshotTtsInput): SnapshotTts {
  const engines = input.status?.engines ?? [];
  const models = input.status?.models ?? [];
  return {
    engines: TTS_ENGINES.map((id) => {
      const entry = engines.find((candidate) => candidate.id === id);
      return {
        id,
        installed: entry?.installed ?? false,
        running: entry?.running ?? false,
      };
    }),
    models: TTS_MODELS.map((id) => ({
      id,
      downloaded:
        models.find((candidate) => candidate.id === id)?.downloaded ?? false,
    })),
    speaking: input.speaking,
  };
}

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
      ...(tab.color ? { color: tab.color } : {}),
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
      ...(tab.color ? { color: tab.color } : {}),
    };
  }

  if (tab.kind === "preview") {
    return {
      id: tab.id,
      kind: "preview",
      spaceId: tab.spaceId,
      title: displayTitle(tab),
      url: tab.url,
      ...(tab.color ? { color: tab.color } : {}),
    };
  }

  if (tab.kind === "markdown") {
    return {
      id: tab.id,
      kind: "markdown",
      spaceId: tab.spaceId,
      title: displayTitle(tab),
      path: tab.path,
      ...(tab.color ? { color: tab.color } : {}),
    };
  }

  if (tab.kind === "mermaid") {
    return {
      id: tab.id,
      kind: "mermaid",
      spaceId: tab.spaceId,
      title: displayTitle(tab),
      sourceCharacters: tab.source.length,
      ...(tab.color ? { color: tab.color } : {}),
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
      ...(tab.color ? { color: tab.color } : {}),
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
      ...(tab.color ? { color: tab.color } : {}),
    };
  }

  if (tab.kind === "git-history") {
    return {
      id: tab.id,
      kind: "git-history",
      spaceId: tab.spaceId,
      title: displayTitle(tab),
      repoRoot: tab.repoRoot,
      ...(tab.color ? { color: tab.color } : {}),
    };
  }

  if (tab.kind === "pr-review") {
    return {
      id: tab.id,
      kind: "pr-review",
      spaceId: tab.spaceId,
      title: displayTitle(tab),
      repoRoot: tab.repoRoot,
      head: tab.head,
      base: tab.base,
      ...(tab.color ? { color: tab.color } : {}),
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
    ...(tab.color ? { color: tab.color } : {}),
  };
}

export function buildAppSnapshot(input: AppSnapshotInput): AppSnapshot {
  return {
    version: 1,
    activeTabId: input.activeTabId,
    activeSpaceId: input.activeSpaceId,
    ...(input.sidebar ? { sidebar: input.sidebar } : {}),
    tabs: input.tabs.map(serializeTab),
    ...(input.scheduledTasks
      ? {
          scheduledTasks: {
            paused: input.scheduledTasks.paused,
            tasks: input.scheduledTasks.tasks.map(serializeTask),
          },
        }
      : {}),
    ...(input.tts ? { tts: serializeTts(input.tts) } : {}),
  };
}
