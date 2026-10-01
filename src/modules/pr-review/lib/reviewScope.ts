/** What the review is showing: the branch as a whole, or one of its commits. */
export type ReviewScope = { kind: "branch" } | { kind: "commit"; sha: string };

export type ReviewFileRef = {
  path: string;
  originalPath: string | null;
};

export type FileDiffRequest =
  | {
      kind: "range";
      baseRev: string;
      headRev: string;
      path: string;
      originalPath: string | null;
    }
  | {
      kind: "commit";
      sha: string;
      path: string;
      originalPath: string | null;
    };

/**
 * Which two revisions a file's diff should compare.
 *
 * Whole-branch reads from the merge base, so commits that landed on the base
 * branch after this one forked are not attributed to the author. A single
 * commit reads against its own parent, which is the change that commit made.
 */
export function fileDiffRequest(
  scope: ReviewScope,
  file: ReviewFileRef,
  range: { mergeBase: string; head: string },
): FileDiffRequest {
  if (scope.kind === "commit") {
    return {
      kind: "commit",
      sha: scope.sha,
      path: file.path,
      originalPath: file.originalPath,
    };
  }
  return {
    kind: "range",
    baseRev: range.mergeBase,
    headRev: range.head,
    path: file.path,
    originalPath: file.originalPath,
  };
}

/**
 * Keeps a scope valid across a reload.
 *
 * A rebase or an amend replaces shas, so a pinned commit can vanish; falling
 * back to the branch is better than asking git for a commit it cannot resolve.
 */
export function nextScopeAfterCommits(
  scope: ReviewScope,
  shas: readonly string[],
): ReviewScope {
  if (scope.kind === "branch") return scope;
  return shas.includes(scope.sha) ? scope : { kind: "branch" };
}

/**
 * Whether the base is a remote-tracking branch, and so worth fetching first.
 *
 * Decided from the repository's own ref list rather than the shape of the
 * name: `git branch origin/main` is legal, and fetching because a local branch
 * happens to be named like a remote one would be wrong.
 */
export function basePointsAtRemote(
  base: string,
  remoteBranches: readonly string[],
): boolean {
  return remoteBranches.includes(base);
}
