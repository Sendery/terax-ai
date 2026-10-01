import { describe, expect, it } from "vitest";
import {
  basePointsAtRemote,
  fileDiffRequest,
  nextScopeAfterCommits,
  type ReviewScope,
} from "./reviewScope";

const BRANCH: ReviewScope = { kind: "branch" };
const COMMIT: ReviewScope = { kind: "commit", sha: "abc1234def" };

describe("fileDiffRequest", () => {
  const file = { path: "src/a.ts", originalPath: null };

  it("diffs the whole branch from the merge base", () => {
    // A review shows what the branch added, so the left side is where it
    // forked, not the tip of the base branch.
    expect(
      fileDiffRequest(BRANCH, file, { mergeBase: "base9", head: "feature" }),
    ).toEqual({
      kind: "range",
      baseRev: "base9",
      headRev: "feature",
      path: "src/a.ts",
      originalPath: null,
    });
  });

  it("diffs a single commit against its own parent", () => {
    expect(
      fileDiffRequest(COMMIT, file, { mergeBase: "base9", head: "feature" }),
    ).toEqual({
      kind: "commit",
      sha: "abc1234def",
      path: "src/a.ts",
      originalPath: null,
    });
  });

  it("carries a rename through so the old side can be read", () => {
    const renamed = { path: "src/new.ts", originalPath: "src/old.ts" };

    expect(
      fileDiffRequest(BRANCH, renamed, { mergeBase: "base9", head: "feature" }),
    ).toMatchObject({ originalPath: "src/old.ts" });
  });
});

describe("nextScopeAfterCommits", () => {
  it("keeps the branch view when the commits change", () => {
    expect(nextScopeAfterCommits(BRANCH, ["a", "b"])).toEqual(BRANCH);
  });

  it("keeps a commit that is still in the range", () => {
    expect(nextScopeAfterCommits(COMMIT, ["x", "abc1234def"])).toEqual(COMMIT);
  });

  it("falls back to the branch when the commit is gone", () => {
    // A rebase or an amend replaces shas; pinning to one that no longer exists
    // would leave the pane asking git for a commit it cannot resolve.
    expect(nextScopeAfterCommits(COMMIT, ["x", "y"])).toEqual(BRANCH);
  });

  it("falls back to the branch when the range is empty", () => {
    expect(nextScopeAfterCommits(COMMIT, [])).toEqual(BRANCH);
  });
});

describe("basePointsAtRemote", () => {
  const remotes = ["origin/main", "origin/qa", "fork/main"];

  it("recognises a remote-tracking base", () => {
    expect(basePointsAtRemote("origin/main", remotes)).toBe(true);
  });

  it("leaves a local branch alone", () => {
    expect(basePointsAtRemote("main", remotes)).toBe(false);
  });

  it("does not go by the name, which a local branch may borrow", () => {
    // `git branch origin/main` is legal. Only the ref list settles it, which
    // is why the decision needs the list rather than a prefix match.
    expect(basePointsAtRemote("origin/main", ["fork/main"])).toBe(false);
  });

  it("says no when the ref list is not known yet", () => {
    expect(basePointsAtRemote("origin/main", [])).toBe(false);
  });
});
