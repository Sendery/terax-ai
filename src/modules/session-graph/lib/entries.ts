// Normalises an agent session transcript (JSONL, append-only) into a single
// node shape the graph layer can lay out, regardless of which agent wrote it.
//
// Both supported agents already persist a parent/child tree, so the graph is
// read out of the file rather than inferred:
//
//   pi      id / parentId          ~/.pi/agent/sessions/--<cwd>--/<ts>_<id>.jsonl
//   claude  uuid / parentUuid      ~/.claude/projects/-<cwd>/<uuid>.jsonl
//
// HEAD is the *last* entry in file order for both agents. That matches pi's own
// SessionManager._buildIndex, which walks the file and keeps overwriting leafId,
// so the active branch is always the ancestry of the final line.
//
// Parsing is deliberately forgiving: these files are appended to while an agent
// is running, so the tail can be a partial line, and a crashed write can leave
// a corrupt one. A bad line is skipped, never fatal.

import { isSyntheticUserText } from "./synthetic";

export type SessionAgent = "pi" | "claude";

/** Solid nodes are user turns; everything else is intermediate agent work. */
export type SessionNodeKind =
  | "user"
  | "assistant"
  | "toolResult"
  | "compaction"
  | "branchSummary"
  | "modelChange"
  | "thinkingLevelChange"
  | "sessionInfo"
  | "customMessage";

export type SessionNode = {
  id: string;
  parentId: string | null;
  kind: SessionNodeKind;
  at: number;
  /** Short single-line excerpt for the row. Empty when there is nothing to show. */
  preview: string;
  /** Tools this entry invoked, in order. */
  toolNames: string[];
  /** User turns anchor navigation and the milestone scrollbar. */
  isMilestone: boolean;
  /** Claude subagent work, foldable as a unit. */
  isSidechain: boolean;
  /** The entry carried a reasoning block, so an empty preview is not "nothing". */
  hasReasoning: boolean;
  /** Recorded with role "user" but injected by the harness, not typed by a person. */
  isSynthetic: boolean;
  compaction: { firstKeptEntryId: string; tokensBefore: number } | null;
};

export type SessionHeaderInfo = {
  sessionId: string;
  cwd: string | null;
  startedAt: number;
  /** Absolute path of the session this one was forked from, when any. */
  parentSessionPath: string | null;
  name: string | null;
};

export type ParsedSession = {
  header: SessionHeaderInfo | null;
  nodes: SessionNode[];
  /** HEAD: last entry in file order. */
  headId: string | null;
  /** Entry id -> user label, resolved in file order (git-tag equivalent). */
  labels: Map<string, string>;
  /** Entry id -> tracked file paths captured at that point (claude only). */
  codeSnapshots: Map<string, string[]>;
};

const MAX_PREVIEW = 160;

/** Collapses whitespace so a multi-line body renders as one row. */
function toPreview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_PREVIEW ? `${flat.slice(0, MAX_PREVIEW - 1)}…` : flat;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function timestampOf(raw: Record<string, unknown>): number {
  const parsed = Date.parse(asString(raw.timestamp) ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Content blocks differ per agent but overlap enough to read uniformly:
 * pi uses `toolCall`/`thinking`, claude uses `tool_use`/`tool_result`.
 * Thinking is skipped for previews — it is not what the turn was about.
 */
function readContent(content: unknown): {
  text: string;
  toolNames: string[];
  hasToolResult: boolean;
  hasReasoning: boolean;
} {
  const empty = { text: "", toolNames: [], hasToolResult: false, hasReasoning: false };
  if (typeof content === "string") {
    return { ...empty, text: content };
  }
  if (!Array.isArray(content)) {
    return empty;
  }

  let text = "";
  // A tool result body is only a fallback: a real text block wins.
  let resultText = "";
  const toolNames: string[] = [];
  let hasToolResult = false;
  let hasReasoning = false;

  for (const block of content) {
    const record = asRecord(block);
    if (!record) continue;
    const type = asString(record.type);

    if (type === "text") {
      const value = asString(record.text);
      if (value && !text) text = value;
    } else if (type === "toolCall" || type === "tool_use") {
      const name = asString(record.name) ?? asString(record.toolName);
      if (name) toolNames.push(name);
    } else if (type === "tool_result" || type === "toolResult") {
      hasToolResult = true;
      // Claude carries the body on the block's own `content` field.
      const value = asString(record.content);
      if (value && !resultText) resultText = value;
    } else if (type === "thinking" || type === "reasoning") {
      hasReasoning = true;
    }
  }

  return { text: text || resultText, toolNames, hasToolResult, hasReasoning };
}

/** Entry types that carry no conversation node (titles, modes, queue noise). */
const CLAUDE_IGNORED = new Set([
  "ai-title",
  "custom-title",
  "mode",
  "permission-mode",
  "last-prompt",
  "queue-operation",
  "frame-link",
  "pr-link",
  "attachment",
  "system",
  "file-history-snapshot",
  "file-history-delta",
]);

type Draft = { node: SessionNode; targetId?: string; label?: string };

function parsePiEntry(raw: Record<string, unknown>): Draft | null {
  const id = asString(raw.id);
  if (!id) return null;
  const type = asString(raw.type);
  const parentId = asString(raw.parentId);
  const at = timestampOf(raw);

  const base = {
    id,
    parentId,
    at,
    preview: "",
    toolNames: [] as string[],
    isMilestone: false,
    isSidechain: false,
    hasReasoning: false,
    isSynthetic: false,
    compaction: null,
  };

  switch (type) {
    case "message": {
      const message = asRecord(raw.message);
      if (!message) return null;
      const role = asString(message.role);
      const { text, toolNames, hasReasoning } = readContent(message.content);
      const kind: SessionNodeKind =
        role === "user" ? "user" : role === "toolResult" ? "toolResult" : "assistant";
      const isSynthetic = kind === "user" && isSyntheticUserText(text);
      return {
        node: {
          ...base,
          kind,
          preview: toPreview(text),
          toolNames,
          hasReasoning,
          isSynthetic,
          // Injected context is not a turn a person took, so it must not become
          // a navigable milestone.
          isMilestone: kind === "user" && !isSynthetic,
        },
      };
    }
    case "compaction": {
      const firstKeptEntryId = asString(raw.firstKeptEntryId);
      const tokensBefore = typeof raw.tokensBefore === "number" ? raw.tokensBefore : 0;
      return {
        node: {
          ...base,
          kind: "compaction",
          preview: toPreview(asString(raw.summary) ?? ""),
          compaction: firstKeptEntryId ? { firstKeptEntryId, tokensBefore } : null,
        },
      };
    }
    case "branch_summary":
      return {
        node: {
          ...base,
          kind: "branchSummary",
          preview: toPreview(asString(raw.summary) ?? ""),
        },
      };
    case "model_change":
      return {
        node: {
          ...base,
          kind: "modelChange",
          preview: toPreview(
            [asString(raw.provider), asString(raw.modelId)].filter(Boolean).join(" / "),
          ),
        },
      };
    case "thinking_level_change":
      return {
        node: {
          ...base,
          kind: "thinkingLevelChange",
          preview: toPreview(asString(raw.thinkingLevel) ?? ""),
        },
      };
    case "session_info":
      return {
        node: { ...base, kind: "sessionInfo", preview: toPreview(asString(raw.name) ?? "") },
      };
    case "label": {
      const targetId = asString(raw.targetId);
      if (!targetId) return null;
      // A label is a real tree entry in pi, but it is rendered as a tag on its
      // target rather than as a row of its own.
      return {
        node: { ...base, kind: "sessionInfo", preview: "" },
        targetId,
        label: asString(raw.label) ?? "",
      };
    }
    case "custom_message": {
      // Extensions can inject context; `display: false` means "never show me".
      if (raw.display !== true) return null;
      const { text } = readContent(raw.content);
      return {
        node: {
          ...base,
          kind: "customMessage",
          preview: toPreview(text || (asString(raw.customType) ?? "")),
        },
      };
    }
    default:
      // `custom` and anything newer: extension bookkeeping, not a graph node.
      return null;
  }
}

function parseClaudeEntry(raw: Record<string, unknown>): Draft | null {
  const type = asString(raw.type);
  if (!type || CLAUDE_IGNORED.has(type)) return null;

  const id = asString(raw.uuid);
  if (!id) return null;
  const parentId = asString(raw.parentUuid);
  const message = asRecord(raw.message);
  if (!message) return null;

  const { text, toolNames, hasToolResult, hasReasoning } = readContent(message.content);
  // A claude tool result arrives as a `user` entry carrying a tool_result
  // block. It is agent work, so it must not become a user milestone.
  const kind: SessionNodeKind =
    type === "assistant" ? "assistant" : hasToolResult ? "toolResult" : "user";
  const isSynthetic = kind === "user" && isSyntheticUserText(text);

  return {
    node: {
      id,
      parentId,
      kind,
      at: timestampOf(raw),
      preview: toPreview(text),
      toolNames,
      isMilestone: kind === "user" && !isSynthetic,
      isSidechain: raw.isSidechain === true,
      hasReasoning,
      isSynthetic,
      compaction: null,
    },
  };
}

function readPiHeader(raw: Record<string, unknown>): SessionHeaderInfo | null {
  const sessionId = asString(raw.id);
  if (!sessionId) return null;
  return {
    sessionId,
    cwd: asString(raw.cwd),
    startedAt: timestampOf(raw),
    parentSessionPath: asString(raw.parentSession),
    name: null,
  };
}

/** Claude has no header line, so identity comes from the first entry seen. */
function readClaudeHeader(raw: Record<string, unknown>): SessionHeaderInfo | null {
  const sessionId = asString(raw.sessionId);
  if (!sessionId) return null;
  return {
    sessionId,
    cwd: asString(raw.cwd),
    startedAt: timestampOf(raw),
    parentSessionPath: null,
    name: null,
  };
}

function readClaudeSnapshot(
  raw: Record<string, unknown>,
  into: Map<string, string[]>,
): void {
  const type = asString(raw.type);

  if (type === "file-history-snapshot") {
    const snapshot = asRecord(raw.snapshot);
    const messageId = asString(raw.messageId) ?? asString(snapshot?.messageId);
    const backups = asRecord(snapshot?.trackedFileBackups);
    if (!messageId || !backups) return;
    into.set(messageId, Object.keys(backups));
    return;
  }

  if (type === "file-history-delta") {
    const messageId = asString(raw.messageId);
    const trackingPath = asString(raw.trackingPath);
    if (!messageId || !trackingPath) return;
    const existing = into.get(messageId) ?? [];
    if (!existing.includes(trackingPath)) existing.push(trackingPath);
    into.set(messageId, existing);
  }
}

/**
 * Parse a whole transcript. `text` may be a partial file: a truncated final
 * line is dropped rather than throwing, which is what a live tail looks like.
 */
export function parseSessionLines(text: string, agent: SessionAgent): ParsedSession {
  const nodes: SessionNode[] = [];
  const labels = new Map<string, string>();
  const codeSnapshots = new Map<string, string[]>();
  let header: SessionHeaderInfo | null = null;
  let headId: string | null = null;

  // Parent link of *every* entry seen, including the ones that never become
  // rows. Bookkeeping entries (pi `custom`/`label`, claude `system`) sit inside
  // the conversation chain, so dropping them without re-chaining their children
  // shatters one tree into thousands of false roots.
  const rawParents = new Map<string, string | null>();
  const kept = new Set<string>();

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const raw = asRecord(value);
    if (!raw) continue;

    if (agent === "pi") {
      if (asString(raw.type) === "session") {
        header ??= readPiHeader(raw);
        continue;
      }
    } else {
      header ??= readClaudeHeader(raw);
      readClaudeSnapshot(raw, codeSnapshots);
    }

    const rawId = asString(raw.id) ?? asString(raw.uuid);
    if (rawId && !rawParents.has(rawId)) {
      rawParents.set(rawId, asString(raw.parentId) ?? asString(raw.parentUuid));
    }

    const draft = agent === "pi" ? parsePiEntry(raw) : parseClaudeEntry(raw);
    if (!draft) continue;

    if (draft.targetId !== undefined) {
      // Label entries resolve in file order: an empty label clears the target.
      if (draft.label) labels.set(draft.targetId, draft.label);
      else labels.delete(draft.targetId);
      headId = draft.node.id;
      continue;
    }

    if (draft.node.kind === "sessionInfo" && draft.node.preview && header) {
      header = { ...header, name: draft.node.preview };
    }

    // Transcripts can re-append an identical entry, so the same id may appear
    // more than once. Keep the first occurrence to preserve file order.
    if (kept.has(draft.node.id)) {
      headId = draft.node.id;
      continue;
    }
    kept.add(draft.node.id);
    nodes.push(draft.node);
    headId = draft.node.id;
  }

  return {
    header,
    nodes: rechainToKeptAncestors(nodes, rawParents, kept),
    headId,
    labels,
    codeSnapshots,
  };
}

/**
 * Rewrite each node's parent to its nearest retained ancestor, so filtering
 * non-visual entries preserves tree shape instead of fragmenting it. A node
 * whose whole ancestry was filtered becomes a root.
 *
 * Mirrors what pi's own createBranchedSession does when it strips label
 * entries out of a retained path.
 */
function rechainToKeptAncestors(
  nodes: SessionNode[],
  rawParents: Map<string, string | null>,
  kept: Set<string>,
): SessionNode[] {
  const resolved = new Map<string, string | null>();

  const nearestKept = (id: string): string | null => {
    const cached = resolved.get(id);
    if (cached !== undefined) return cached;

    // Iterative with a seen-set: a corrupt file could contain a parent cycle.
    const chain: string[] = [];
    const seen = new Set<string>();
    let cursor: string | null = id;
    let answer: string | null = null;

    while (cursor !== null && !seen.has(cursor)) {
      seen.add(cursor);
      const cachedCursor = resolved.get(cursor);
      if (cachedCursor !== undefined) {
        answer = cachedCursor;
        break;
      }
      if (kept.has(cursor)) {
        answer = cursor;
        break;
      }
      chain.push(cursor);
      cursor = rawParents.get(cursor) ?? null;
    }

    for (const step of chain) resolved.set(step, answer);
    return answer;
  };

  return nodes.map((node) =>
    node.parentId === null || kept.has(node.parentId)
      ? node
      : { ...node, parentId: nearestKept(node.parentId) },
  );
}
