// Row text, turn folding and milestone-rail geometry for the session graph.
//
// Pure on purpose: the panel is a thin renderer over these functions, so the
// navigation behaviour is testable without mounting anything.

import type { SessionNode } from "./entries";
import type { SessionGraphRow, SessionMilestone } from "./graph";

export type RowSummary = {
  /** Primary line for the row. Never empty. */
  label: string;
  /** Secondary hint: tool names, a result marker, compaction size. */
  detail: string | null;
  /** User turns are the milestones and read louder than agent work. */
  isEmphasis: boolean;
};

/** Shown when an entry carries no text at all, e.g. an attachment-only turn. */
const EMPTY_LABEL = "(no text)";

export function rowSummary(node: SessionNode): RowSummary {
  const tools = node.toolNames.join(", ");
  // Reasoning-only entries are common; saying so beats calling them empty.
  const label =
    node.preview || tools || (node.hasReasoning ? "thinking…" : EMPTY_LABEL);

  let detail: string | null = null;
  switch (node.kind) {
    case "user":
      detail = node.isSynthetic ? "injected" : null;
      break;
    case "assistant":
      // Only add tool names as a hint when they are not already the label.
      detail = tools && node.preview ? tools : null;
      break;
    case "toolResult":
      detail = "result";
      break;
    case "compaction":
      detail = node.compaction
        ? `compacted ${node.compaction.tokensBefore.toLocaleString("en-US")} tokens`
        : "compacted";
      break;
    case "branchSummary":
      detail = "branch summary";
      break;
    case "modelChange":
      detail = "model";
      break;
    case "thinkingLevelChange":
      detail = "thinking";
      break;
    case "sessionInfo":
      detail = "session";
      break;
    case "customMessage":
      detail = "injected";
      break;
    default:
      detail = null;
  }

  // Injected context is rendered like machine work, not like a request, so the
  // few real user turns stand out.
  return { label, detail, isEmphasis: node.kind === "user" && !node.isSynthetic };
}

export type FoldedEntry =
  | { kind: "row"; row: SessionGraphRow }
  | { kind: "fold"; turnIndex: number; hiddenCount: number };

/**
 * Collapses the agent work of the given turns into a single stub, keeping the
 * user message visible. Milestones are never hidden: they are what the rail and
 * keyboard navigation anchor to.
 */
export function foldRows(
  rows: readonly SessionGraphRow[],
  collapsedTurns: ReadonlySet<number>,
): FoldedEntry[] {
  const out: FoldedEntry[] = [];
  let pendingTurn: number | null = null;
  let pendingCount = 0;

  const flush = () => {
    if (pendingTurn !== null && pendingCount > 0) {
      out.push({ kind: "fold", turnIndex: pendingTurn, hiddenCount: pendingCount });
    }
    pendingTurn = null;
    pendingCount = 0;
  };

  for (const row of rows) {
    const hidden = collapsedTurns.has(row.turnIndex) && !row.node.isMilestone;
    if (!hidden) {
      flush();
      out.push({ kind: "row", row });
      continue;
    }
    if (pendingTurn !== row.turnIndex) flush();
    pendingTurn = row.turnIndex;
    pendingCount++;
  }
  flush();

  return out;
}

/**
 * Whether a row draws an edge downward out of its node.
 *
 * A leaf must not: the last entry of an abandoned spur has nothing below it, and
 * drawing the edge anyway left a stub hanging into empty space.
 */
export function hasOutgoingEdge(row: SessionGraphRow): boolean {
  return row.childIds.length > 0;
}

export type RailTick = {
  nodeId: string;
  rowIndex: number;
  /** Normalised 0..1 position down the rail. */
  position: number;
  preview: string;
};

/**
 * Tick marks for the scroll rail, so a long transcript reads like a document
 * index: continuous scrolling with visible anchors at every user turn.
 */
export function railTicks(
  milestones: readonly SessionMilestone[],
  totalRows: number,
): RailTick[] {
  if (milestones.length === 0 || totalRows <= 0) return [];
  return milestones.map((milestone) => ({
    nodeId: milestone.nodeId,
    rowIndex: milestone.rowIndex,
    // Guard the single-row case rather than dividing by zero.
    position: totalRows <= 1 ? 0 : milestone.rowIndex / totalRows,
    preview: milestone.preview,
  }));
}

/** Row index of the first milestone strictly below `fromRow`. */
export function nextMilestoneRow(
  milestones: readonly SessionMilestone[],
  fromRow: number,
): number | null {
  if (milestones.length === 0) return null;
  const next = milestones.find((milestone) => milestone.rowIndex > fromRow);
  // Saturate at the last milestone so a jump never scrolls past the end.
  return next ? next.rowIndex : milestones[milestones.length - 1].rowIndex;
}

/** Row index of the last milestone strictly above `fromRow`. */
export function previousMilestoneRow(
  milestones: readonly SessionMilestone[],
  fromRow: number,
): number | null {
  if (milestones.length === 0) return null;
  for (let i = milestones.length - 1; i >= 0; i--) {
    if (milestones[i].rowIndex < fromRow) return milestones[i].rowIndex;
  }
  return milestones[0].rowIndex;
}
