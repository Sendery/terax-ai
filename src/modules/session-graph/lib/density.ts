// Zoom levels for the graph.
//
// A transcript is mostly agent work: reasoning, tool calls and their results. At
// full detail that buries the few messages a person actually wrote, so the panel
// defaults to an overview of user turns and represents everything between them
// as one group carrying a count and a tool tally. Zooming in reveals more.
//
// Three things are never collapsed, because hiding them would misrepresent the
// history rather than merely compress it:
//   - user turns, which are the navigable milestones;
//   - branch points, which are where a rewind happened;
//   - entries the user marked, which are their own record of what matters.

import type { SessionGraphRow } from "./graph";

export type GraphDensity = "overview" | "compact" | "full";

/** Ordered widest-first, which is also the zoom-in direction. */
export const DENSITIES: GraphDensity[] = ["overview", "compact", "full"];

export type ToolTally = { name: string; count: number };

export type GraphEntry =
  | { kind: "row"; row: SessionGraphRow }
  | {
      kind: "group";
      turnIndex: number;
      hiddenCount: number;
      tools: ToolTally[];
      /** True when the hidden run contains a fork. */
      hasBranch: boolean;
      /** Index into the unfolded rows, so a click can scroll into the group. */
      firstRowIndex: number;
    };

/**
 * Caps how many tool chips a collapsed group shows.
 *
 * A busy turn can call a dozen distinct tools; rendering them all overflowed the
 * panel and clipped the last chip mid-word. The most-used tools are the ones
 * worth showing, so the tally is ranked by count before it is cut.
 */
export function topTools(
  tools: readonly ToolTally[],
  max: number,
): { shown: ToolTally[]; extra: number } {
  if (tools.length <= max) return { shown: [...tools], extra: 0 };
  const ranked = [...tools].sort((a, b) => b.count - a.count);
  return { shown: ranked.slice(0, max), extra: tools.length - max };
}

/** Longest tool name a chip shows before it would push the row out of view. */
const MAX_TOOL_NAME = 13;

/**
 * Shortens an over-long tool name for a chip. Namespaced MCP tools like
 * `mcp__server__do_thing` are cut from the front, because the trailing segment
 * is the part that says what it does.
 */
export function shortToolName(name: string): string {
  if (name.length <= MAX_TOOL_NAME) return name;
  // Only strip a namespace when there is one: lastIndexOf returns -1 otherwise,
  // which would slice the first character off an ordinary name.
  const separator = name.lastIndexOf("__");
  const tail = separator >= 0 ? name.slice(separator + 2) : "";
  const candidate = tail.length > 0 ? tail : name;
  return candidate.length <= MAX_TOOL_NAME
    ? candidate
    : `${candidate.slice(0, MAX_TOOL_NAME - 1)}\u2026`;
}

export function nextDensity(current: GraphDensity, step: 1 | -1 = 1): GraphDensity {
  const index = DENSITIES.indexOf(current);
  const size = DENSITIES.length;
  return DENSITIES[(index + step + size) % size];
}

/** Whether a row survives collapsing at the given density. */
function isAlwaysVisible(row: SessionGraphRow, marked: ReadonlySet<string>): boolean {
  return row.node.isMilestone || row.isBranchPoint || marked.has(row.node.id);
}

function keepAtDensity(row: SessionGraphRow, density: GraphDensity): boolean {
  switch (density) {
    case "full":
      return true;
    // Compact keeps the calls the agent made but not their output, which is the
    // bulkiest and least informative part of a transcript.
    case "compact":
      return row.node.toolNames.length > 0;
    case "overview":
      return false;
  }
}

export function collapseByDensity(
  rows: readonly SessionGraphRow[],
  density: GraphDensity,
  expandedTurns: ReadonlySet<number>,
  markedNodeIds: ReadonlySet<string>,
): GraphEntry[] {
  const out: GraphEntry[] = [];

  let pending: {
    turnIndex: number;
    hiddenCount: number;
    tools: Map<string, number>;
    hasBranch: boolean;
    firstRowIndex: number;
  } | null = null;

  const flush = () => {
    if (!pending || pending.hiddenCount === 0) {
      pending = null;
      return;
    }
    out.push({
      kind: "group",
      turnIndex: pending.turnIndex,
      hiddenCount: pending.hiddenCount,
      tools: [...pending.tools.entries()].map(([name, count]) => ({ name, count })),
      hasBranch: pending.hasBranch,
      firstRowIndex: pending.firstRowIndex,
    });
    pending = null;
  };

  rows.forEach((row, rowIndex) => {
    const visible =
      isAlwaysVisible(row, markedNodeIds) ||
      expandedTurns.has(row.turnIndex) ||
      keepAtDensity(row, density);

    if (visible) {
      flush();
      out.push({ kind: "row", row });
      return;
    }

    if (pending && pending.turnIndex !== row.turnIndex) flush();
    pending ??= {
      turnIndex: row.turnIndex,
      hiddenCount: 0,
      tools: new Map(),
      hasBranch: false,
      firstRowIndex: rowIndex,
    };
    pending.hiddenCount++;
    if (row.isBranchPoint) pending.hasBranch = true;
    for (const tool of row.node.toolNames) {
      pending.tools.set(tool, (pending.tools.get(tool) ?? 0) + 1);
    }
  });

  flush();
  return out;
}
