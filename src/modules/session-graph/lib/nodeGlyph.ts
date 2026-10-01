// What each node in the graph looks like.
//
// Structure and process are carried by two different channels, the way a git
// client separates branch from author: the *lane colour* says which branch a row
// belongs to, while the *glyph inside the node* says what happened there. That
// keeps a long transcript readable at a glance — a run of amber terminals is
// obviously a shell session, a green pencil is an edit, a plain grey dot is just
// output.

import {
  ArchiveIcon,
  CheckListIcon,
  ComputerTerminal01Icon,
  Edit02Icon,
  GitBranchIcon,
  Globe02Icon,
  HelpCircleIcon,
  Idea01Icon,
  Message01Icon,
  PackageIcon,
  Search01Icon,
  Settings02Icon,
  SparklesIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import type { HugeiconsIcon } from "@hugeicons/react";

import type { SessionNode } from "./entries";

type IconElement = Parameters<typeof HugeiconsIcon>[0]["icon"];

export const TONES = [
  "user",
  "assistant",
  "thinking",
  "shell",
  "read",
  "write",
  "agent",
  "web",
  "plan",
  "ask",
  "tool",
  "result",
  "system",
  "compaction",
  "branch",
] as const;

export type NodeTone = (typeof TONES)[number];

/**
 * Hex rather than Tailwind classes: these are painted into SVG `fill` and
 * `stroke`, which cannot take a utility class. Chosen to stay legible on both
 * themes at a 13px node.
 */
export const TONE_COLOR: Record<NodeTone, string> = {
  user: "#38bdf8", // sky-400 — the person speaking
  assistant: "#a78bfa", // violet-400
  thinking: "#94a3b8", // slate-400
  shell: "#fbbf24", // amber-400
  read: "#22d3ee", // cyan-400
  write: "#34d399", // emerald-400
  agent: "#e879f9", // fuchsia-400
  web: "#60a5fa", // blue-400
  plan: "#fb923c", // orange-400
  ask: "#f472b6", // pink-400
  tool: "#cbd5e1", // slate-300
  result: "#64748b", // slate-500 — output is background noise
  system: "#7c8798",
  compaction: "#f59e0b",
  branch: "#c084fc",
};

export type GlyphSize = "large" | "medium" | "small";

export type NodeGlyph = {
  tone: NodeTone;
  /** Null draws a plain dot, which is what output and merges look like. */
  icon: IconElement | null;
  size: GlyphSize;
  /** Human description, used for the accessible row label. */
  label: string;
};

/**
 * Tool families, matched on the lowercased name both agents report.
 *
 * Order is significant, because names overlap: "TodoWrite" must be a plan rather
 * than a write, so the narrower families are tested first.
 */
const TOOL_FAMILIES: { tone: NodeTone; label: string; match: (name: string) => boolean }[] = [
  {
    tone: "shell",
    label: "shell command",
    match: (n) => n.includes("bash") || n.includes("shell") || n.includes("run_command"),
  },
  {
    tone: "read",
    label: "read",
    match: (n) =>
      n.includes("read") ||
      n.includes("grep") ||
      n.includes("glob") ||
      n.includes("find") ||
      n === "ls" ||
      n.includes("notebookread"),
  },
  {
    tone: "plan",
    label: "plan",
    match: (n) => n.includes("todo") || n.includes("plan"),
  },
  {
    tone: "ask",
    // Anchored, because "task" contains "ask" and would be misfiled.
    label: "question",
    match: (n) => n.startsWith("ask") || n.includes("question"),
  },
  {
    tone: "web",
    label: "web",
    match: (n) => n.includes("web") || n.includes("fetch") || n.includes("browser"),
  },
  {
    tone: "agent",
    label: "subagent",
    match: (n) => n.includes("task") || n.includes("agent") || n.includes("skill"),
  },
  {
    tone: "write",
    label: "edit",
    match: (n) => n.includes("edit") || n.includes("write") || n.includes("patch"),
  },
];

const TONE_ICON: Record<NodeTone, IconElement | null> = {
  user: Message01Icon,
  assistant: SparklesIcon,
  thinking: Idea01Icon,
  shell: ComputerTerminal01Icon,
  read: Search01Icon,
  write: Edit02Icon,
  agent: UserGroupIcon,
  web: Globe02Icon,
  plan: CheckListIcon,
  ask: HelpCircleIcon,
  tool: PackageIcon,
  result: null,
  system: Settings02Icon,
  compaction: ArchiveIcon,
  branch: GitBranchIcon,
};

function toolTone(toolNames: readonly string[]): { tone: NodeTone; label: string } | null {
  // The first call is what the entry is "about"; later ones show in the detail.
  const first = toolNames[0];
  if (!first) return null;
  const name = first.toLowerCase();
  // `write` before `agent` matters: "NotebookEdit" must not fall to a subagent.
  const family = TOOL_FAMILIES.find((candidate) => candidate.match(name));
  return family
    ? { tone: family.tone, label: family.label }
    : { tone: "tool", label: "tool call" };
}

/** Tone of a bare tool name, for colouring the tally on a collapsed group. */
export function toneForToolName(name: string): NodeTone {
  return toolTone([name])?.tone ?? "tool";
}

export function nodeGlyph(node: SessionNode): NodeGlyph {
  const tool = toolTone(node.toolNames);

  let tone: NodeTone;
  let label: string;

  if (node.kind === "user" && !node.isSynthetic) {
    tone = "user";
    label = "user turn";
  } else if (node.kind === "toolResult") {
    tone = "result";
    label = "output";
  } else if (tool) {
    tone = tool.tone;
    label = tool.label;
  } else if (node.kind === "compaction") {
    tone = "compaction";
    label = "compaction";
  } else if (node.kind === "branchSummary") {
    tone = "branch";
    label = "branch summary";
  } else if (
    node.kind === "modelChange" ||
    node.kind === "thinkingLevelChange" ||
    node.kind === "sessionInfo" ||
    node.kind === "customMessage" ||
    node.isSynthetic
  ) {
    tone = "system";
    label = node.isSynthetic ? "injected context" : "session setting";
  } else if (node.hasReasoning && !node.preview) {
    tone = "thinking";
    label = "reasoning";
  } else {
    tone = "assistant";
    label = "assistant";
  }

  const size: GlyphSize =
    tone === "user" ? "large" : tone === "result" ? "small" : "medium";

  return { tone, icon: TONE_ICON[tone], size, label };
}
