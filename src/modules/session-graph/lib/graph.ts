// Top-down tree layout for an agent session transcript.
//
// Differs from the git-log layout in `modules/git-history/lib/graph.ts` on two
// counts, which is why it is a separate algorithm rather than a reuse:
//   - a session entry has exactly one parent, so there are no merges, only forks;
//   - rows are emitted oldest-first (top-down) so the graph reads like the
//     transcript it represents, instead of newest-first like `git log`.
//
// The active branch (ancestry of HEAD) is pinned to lane 0 so the main line
// reads straight down the panel. Abandoned branches — what a rewind leaves
// behind — are emitted as spurs in their own lane directly under the branch
// point, keeping the main line contiguous below them.

import { laneColor, type LaneColor } from "@/modules/git-history/lib/graph";
import type { SessionNode } from "./entries";

export type SessionGraphRow = {
  node: SessionNode;
  /** Horizontal slot: 0 is the active branch. */
  lane: number;
  color: LaneColor;
  /** Row index of this node's parent, for drawing the connecting edge. */
  parentRowIndex: number | null;
  isOnActiveBranch: boolean;
  /** True when this node forked, i.e. a rewind happened here. */
  isBranchPoint: boolean;
  childIds: string[];
  /** Which user turn this row belongs to, so agent work folds under it. */
  turnIndex: number;
  /** Id of the spur this row belongs to; null on the active branch. */
  branchId: string | null;
};

export type SessionBranch = {
  /** First node of the branch. */
  rootId: string;
  /** Node the branch forked from. */
  branchPointId: string | null;
  nodeIds: string[];
  isActive: boolean;
};

/** A user turn, used to draw ticks on the scroll rail and to snap between them. */
export type SessionMilestone = {
  nodeId: string;
  rowIndex: number;
  preview: string;
  at: number;
};

export type SessionGraph = {
  rows: SessionGraphRow[];
  branches: SessionBranch[];
  milestones: SessionMilestone[];
  laneCount: number;
};

export const EMPTY_SESSION_GRAPH: SessionGraph = {
  rows: [],
  branches: [],
  milestones: [],
  laneCount: 0,
};

/** Deeply nested rewinds still have to fit the rail, so lanes saturate. */
const MAX_LANE = 11;

function clampLane(lane: number): number {
  return Math.min(lane, MAX_LANE);
}

/**
 * Ancestry of HEAD, walked child→parent. Uses a seen-set because a partially
 * written or corrupt file can contain a parent cycle.
 */
function activeBranchIds(
  byId: Map<string, SessionNode>,
  headId: string | null,
): Set<string> {
  const active = new Set<string>();
  let cursor = headId ? byId.get(headId) : undefined;
  while (cursor && !active.has(cursor.id)) {
    active.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return active;
}

export function buildSessionGraph(
  nodes: readonly SessionNode[],
  headId: string | null,
): SessionGraph {
  if (nodes.length === 0) return EMPTY_SESSION_GRAPH;

  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Children in file order: the original path was appended before any rewind,
  // so file order already puts the abandoned spur before the newer branch.
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const node of nodes) {
    const parent = node.parentId;
    if (parent === null || !byId.has(parent)) {
      roots.push(node.id);
      continue;
    }
    const list = children.get(parent);
    if (list) list.push(node.id);
    else children.set(parent, [node.id]);
  }

  // A file being appended to can end in a partial line, leaving HEAD pointing at
  // an entry that was skipped. Fall back to the last entry in file order, which
  // is how pi resolves its own leaf, so the view keeps a usable active branch
  // instead of losing every milestone.
  const effectiveHeadId =
    headId !== null && byId.has(headId) ? headId : (nodes[nodes.length - 1]?.id ?? null);
  const active = activeBranchIds(byId, effectiveHeadId);

  const rows: SessionGraphRow[] = [];
  const rowIndexById = new Map<string, number>();
  const branches: SessionBranch[] = [];
  const branchByRoot = new Map<string, SessionBranch>();

  let turnIndex = -1;
  const visited = new Set<string>();

  /**
   * Emit a node then its subtrees. Non-active children go first so an abandoned
   * spur sits directly under its branch point and the active line stays
   * contiguous underneath. Explicit stack: sessions run to tens of thousands of
   * entries, well past a safe recursion depth.
   */
  const emit = (rootId: string, lane: number, branchId: string | null): void => {
    const stack: { id: string; lane: number; branchId: string | null }[] = [
      { id: rootId, lane, branchId },
    ];

    while (stack.length > 0) {
      const frame = stack.pop();
      if (!frame) break;
      const node = byId.get(frame.id);
      if (!node || visited.has(frame.id)) continue;
      visited.add(frame.id);

      if (node.isMilestone) turnIndex++;

      const kids = children.get(frame.id) ?? [];
      const parentRowIndex =
        node.parentId !== null && rowIndexById.has(node.parentId)
          ? (rowIndexById.get(node.parentId) as number)
          : null;

      rowIndexById.set(frame.id, rows.length);
      rows.push({
        node,
        lane: frame.lane,
        color: laneColor(frame.lane),
        parentRowIndex,
        isOnActiveBranch: active.has(frame.id),
        isBranchPoint: kids.length > 1,
        childIds: kids,
        turnIndex: Math.max(turnIndex, 0),
        branchId: frame.branchId,
      });

      if (frame.branchId) {
        const branch = branchByRoot.get(frame.branchId);
        if (branch) branch.nodeIds.push(frame.id);
      }

      // Push in reverse: the stack pops last-in first, and we want abandoned
      // spurs emitted before the active continuation.
      const activeKid = kids.find((id) => active.has(id));
      const abandoned = kids.filter((id) => id !== activeKid);

      if (activeKid !== undefined) {
        stack.push({ id: activeKid, lane: frame.lane, branchId: frame.branchId });
      }

      // Allocate lanes and register branches in child order, so the leftmost
      // spur is also the earliest one. Pushing happens afterwards in reverse,
      // because the stack pops last-in first.
      const spurs = abandoned.map((kidId, siblingIndex) => {
        // A spur only needs its own lane when the row it forks from continues;
        // an only-child inherits the lane and stays visually straight.
        if (kids.length <= 1) {
          return { id: kidId, lane: frame.lane, branchId: frame.branchId };
        }
        const branch: SessionBranch = {
          rootId: kidId,
          branchPointId: frame.id,
          nodeIds: [],
          isActive: false,
        };
        branches.push(branch);
        branchByRoot.set(kidId, branch);
        // Lanes are relative to the branch point and are reused once the spur
        // ends, because a spur is emitted contiguously. Bounding by nesting
        // depth keeps the rail narrow: allocating one lane per branch produced
        // 693 lanes on a real transcript.
        return {
          id: kidId,
          lane: clampLane(frame.lane + 1 + siblingIndex),
          branchId: kidId,
        };
      });

      for (let i = spurs.length - 1; i >= 0; i--) stack.push(spurs[i]);
    }
  };

  const activeRoot = roots.find((id) => active.has(id));
  const orderedRoots = activeRoot
    ? [activeRoot, ...roots.filter((id) => id !== activeRoot)]
    : roots;

  // Disjoint roots are independent chains with no edge between them, so they can
  // all share lane 0. Real transcripts contain hundreds of them.
  for (const rootId of orderedRoots) {
    if (visited.has(rootId)) continue;
    emit(rootId, 0, null);
  }

  // A cycle can leave nodes unreachable from any root: emit them so no entry
  // silently disappears from the view.
  for (const node of nodes) {
    if (!visited.has(node.id)) emit(node.id, 0, null);
  }

  branches.unshift({
    rootId: activeRoot ?? rows[0]?.node.id ?? "",
    branchPointId: null,
    nodeIds: rows.filter((r) => r.isOnActiveBranch).map((r) => r.node.id),
    isActive: true,
  });

  const milestones: SessionMilestone[] = rows
    .filter((row) => row.node.isMilestone && row.isOnActiveBranch)
    .map((row) => ({
      nodeId: row.node.id,
      rowIndex: rowIndexById.get(row.node.id) ?? 0,
      preview: row.node.preview,
      at: row.node.at,
    }));

  return {
    rows,
    branches,
    milestones,
    laneCount: rows.reduce((max, row) => Math.max(max, row.lane + 1), 0),
  };
}
