import type { GitLogEntry } from "@/modules/ai/lib/native";
import { describe, expect, it } from "vitest";
import { commitMatches } from "./filter";

const commit = (over: Partial<GitLogEntry> = {}): GitLogEntry => ({
  sha: "0123456789abcdef0123456789abcdef01234567",
  shortSha: "0123456",
  author: "Ada Lovelace",
  authorEmail: "ada@example.com",
  timestampSecs: 1,
  parents: [],
  subject: "add the analytical engine",
  body: "",
  refs: [],
  filesChanged: 1,
  insertions: 1,
  deletions: 0,
  ...over,
});

describe("commitMatches", () => {
  it("matches the subject, author, email and short sha", () => {
    const c = commit();

    expect(commitMatches(c, "analytical")).toBe(true);
    expect(commitMatches(c, "lovelace")).toBe(true);
    expect(commitMatches(c, "ada@")).toBe(true);
    expect(commitMatches(c, "0123456")).toBe(true);
  });

  it("matches the full sha someone pasted from elsewhere", () => {
    expect(
      commitMatches(commit(), "0123456789abcdef0123456789abcdef01234567"),
    ).toBe(true);
  });

  it("searches the commit body, not only its first line", () => {
    const c = commit({ body: "Fixes the punch card reader." });

    expect(commitMatches(c, "punch card")).toBe(true);
  });

  it("finds a commit by the branch or tag on it", () => {
    const c = commit({
      refs: [{ name: "release/v2", kind: "branch", isHead: false }],
    });

    expect(commitMatches(c, "release/")).toBe(true);
  });

  it("ignores case", () => {
    expect(commitMatches(commit(), "ANALYTICAL")).toBe(true);
  });

  it("rejects a term that appears nowhere", () => {
    expect(commitMatches(commit(), "difference engine")).toBe(false);
  });

  it("matches everything on an empty term", () => {
    expect(commitMatches(commit(), "")).toBe(true);
  });
});
