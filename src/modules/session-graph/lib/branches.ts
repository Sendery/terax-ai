// Navigating between the branches a rewind left behind, and between the
// sessions a fork created.
//
// Two levels of the same idea:
//   - inside one transcript, a rewind leaves two children on one entry, and
//     switching branch means moving HEAD to the tip of the other one;
//   - across transcripts, `pi --fork` and Terax's own branch-to-new-session
//     write a header with `parentSession`, forming a tree of files.

import type { SessionNode } from "./entries";

function childrenOf(nodes: readonly SessionNode[]): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parentId === null) continue;
    const list = children.get(node.parentId);
    if (list) list.push(node.id);
    else children.set(node.parentId, [node.id]);
  }
  return children;
}

/**
 * Walks down from an entry to the end of its branch.
 *
 * When a branch forks again the most recent child wins, which is the one the
 * agent actually continued on. Guarded with a seen-set: a corrupt file can
 * contain a cycle.
 */
export function descendTip(
  nodes: readonly SessionNode[],
  startId: string,
): string | null {
  const ids = new Set(nodes.map((node) => node.id));
  if (!ids.has(startId)) return null;

  const children = childrenOf(nodes);
  const seen = new Set<string>();
  let current = startId;

  while (!seen.has(current)) {
    seen.add(current);
    const kids = children.get(current);
    if (!kids || kids.length === 0) return current;
    // File order is append order, so the last child is the newest attempt.
    const next = kids[kids.length - 1];
    if (seen.has(next)) return current;
    current = next;
  }
  return current;
}

export type BranchChoice = {
  /** First entry of this alternative. */
  childId: string;
  /** Entry to make HEAD when switching to this alternative. */
  tipId: string;
  /** How many entries hang off this alternative. */
  size: number;
  preview: string;
  isActive: boolean;
};

export type BranchFork = {
  branchPointId: string;
  choices: BranchChoice[];
};

/** Ancestry of an entry, used to tell which alternative HEAD sits on. */
function ancestry(nodes: readonly SessionNode[], headId: string): Set<string> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const path = new Set<string>();
  let cursor = byId.get(headId);
  while (cursor && !path.has(cursor.id)) {
    path.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return path;
}

function subtreeSize(children: Map<string, string[]>, rootId: string): number {
  let count = 0;
  const stack = [rootId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    count++;
    for (const child of children.get(id) ?? []) stack.push(child);
  }
  return count;
}

/**
 * Every fork in the transcript with its alternatives, so the panel can offer a
 * switch. Reported in file order, which is the order the forks happened.
 */
export function branchOptions(
  nodes: readonly SessionNode[],
  headId: string,
): BranchFork[] {
  const children = childrenOf(nodes);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const onHead = ancestry(nodes, headId);

  const forks: BranchFork[] = [];
  for (const node of nodes) {
    const kids = children.get(node.id);
    if (!kids || kids.length < 2) continue;

    forks.push({
      branchPointId: node.id,
      choices: kids.map((childId) => ({
        childId,
        tipId: descendTip(nodes, childId) ?? childId,
        size: subtreeSize(children, childId),
        preview: byId.get(childId)?.preview ?? "",
        isActive: onHead.has(childId),
      })),
    });
  }
  return forks;
}

export type SessionLink = { id: string; parentSessionId: string | null };

/**
 * Where a transcript sits in the fork tree: the session it branched from, and
 * the sessions branched from it.
 *
 * A parent pointer to a file that is no longer present is ignored rather than
 * surfaced as a dead link.
 */
export function sessionLineage(
  sessions: readonly SessionLink[],
  sessionId: string,
): { parentId: string | null; childIds: string[] } {
  const known = new Set(sessions.map((session) => session.id));
  const self = sessions.find((session) => session.id === sessionId);
  if (!self) return { parentId: null, childIds: [] };

  const parentId =
    self.parentSessionId && known.has(self.parentSessionId) ? self.parentSessionId : null;

  return {
    parentId,
    childIds: sessions
      .filter((session) => session.parentSessionId === sessionId)
      .map((session) => session.id),
  };
}
