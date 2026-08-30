import type { GitRef } from "@/modules/ai/lib/native";

// Local work first, then the names you tag by, then where the remote is. This
// is the order a history view reads best in: the branch you are on, what else
// is here, and only then the tracking refs that usually repeat it.
const GROUP_ORDER: Record<GitRef["kind"], number> = {
  branch: 1,
  other: 2,
  tag: 3,
  remote: 4,
};

export function orderRefs(refs: readonly GitRef[]): GitRef[] {
  return [...refs].sort((a, b) => {
    if (a.isHead !== b.isHead) return a.isHead ? -1 : 1;
    return GROUP_ORDER[a.kind] - GROUP_ORDER[b.kind];
  });
}

export type RefDisplay = {
  shown: GitRef[];
  hidden: GitRef[];
  overflow: number;
};

/**
 * Trims a row's refs to what fits, keeping the most useful ones.
 *
 * A busy commit can carry a dozen decorations and a row has no space for them.
 * The order from `orderRefs` decides what survives, so the checked-out branch
 * is never the one dropped.
 */
export function splitRefsForDisplay(
  refs: readonly GitRef[],
  limit: number,
): RefDisplay {
  const ordered = orderRefs(refs);
  if (ordered.length <= limit) {
    return { shown: ordered, hidden: [], overflow: 0 };
  }
  const shown = ordered.slice(0, Math.max(1, limit));
  const hidden = ordered.slice(shown.length);
  return { shown, hidden, overflow: hidden.length };
}
