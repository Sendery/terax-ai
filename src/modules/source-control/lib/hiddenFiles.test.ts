import { describe, expect, it } from "vitest";
import {
  clearHiddenPaths,
  hiddenPathsFor,
  MAX_HIDDEN_PER_REPO,
  partitionHidden,
  repoKey,
  sanitizeHiddenFilesMap,
  withHiddenPaths,
  withoutHiddenPaths,
  type HiddenFilesMap,
} from "./hiddenFiles";

describe("repoKey", () => {
  it("normalizes separators and trailing slashes", () => {
    expect(repoKey("C:\\Users\\me\\repo\\")).toBe("C:/Users/me/repo");
    expect(repoKey("/home/me/repo/")).toBe("/home/me/repo");
    expect(repoKey("/")).toBe("/");
  });

  it("collapses missing roots to an empty key", () => {
    expect(repoKey(null)).toBe("");
    expect(repoKey(undefined)).toBe("");
    expect(repoKey("")).toBe("");
  });
});

describe("sanitizeHiddenFilesMap", () => {
  it("rejects anything we did not write", () => {
    expect(sanitizeHiddenFilesMap(null)).toEqual({});
    expect(sanitizeHiddenFilesMap("nope")).toEqual({});
    expect(sanitizeHiddenFilesMap(["/repo"])).toEqual({});
    expect(sanitizeHiddenFilesMap({ "/repo": "notes.md" })).toEqual({});
  });

  it("keeps only string paths and drops empty repos", () => {
    const map = sanitizeHiddenFilesMap({
      "/repo/": ["notes.md", 42, null, "notes.md", "  "],
      "/other": [],
    });
    expect(map).toEqual({ "/repo": ["notes.md"] });
  });

  it("caps a repo at the persisted maximum", () => {
    const paths = Array.from(
      { length: MAX_HIDDEN_PER_REPO + 50 },
      (_, i) => `f${i}.ts`,
    );
    const map = sanitizeHiddenFilesMap({ "/repo": paths });
    expect(map["/repo"]).toHaveLength(MAX_HIDDEN_PER_REPO);
  });
});

describe("hiddenPathsFor", () => {
  const map: HiddenFilesMap = { "/repo": ["notes.md", "tmp/scratch.txt"] };

  it("reads a repo through its normalized key", () => {
    expect([...hiddenPathsFor(map, "/repo/")]).toEqual([
      "notes.md",
      "tmp/scratch.txt",
    ]);
  });

  it("returns nothing for an unknown or missing repo", () => {
    expect(hiddenPathsFor(map, "/elsewhere").size).toBe(0);
    expect(hiddenPathsFor(map, null).size).toBe(0);
  });
});

describe("withHiddenPaths", () => {
  it("adds paths without duplicating them", () => {
    const first = withHiddenPaths({}, "/repo", ["notes.md"]);
    const second = withHiddenPaths(first, "/repo", ["notes.md", "a.ts"]);
    expect(second).toEqual({ "/repo": ["notes.md", "a.ts"] });
  });

  it("keeps repositories isolated from each other", () => {
    const map = withHiddenPaths(withHiddenPaths({}, "/a", ["x.ts"]), "/b", [
      "y.ts",
    ]);
    expect(map).toEqual({ "/a": ["x.ts"], "/b": ["y.ts"] });
  });

  it("returns the same reference when nothing changes", () => {
    const map = withHiddenPaths({}, "/repo", ["notes.md"]);
    expect(withHiddenPaths(map, "/repo", ["notes.md"])).toBe(map);
    expect(withHiddenPaths(map, "/repo", [])).toBe(map);
    expect(withHiddenPaths(map, null, ["notes.md"])).toBe(map);
  });
});

describe("withoutHiddenPaths", () => {
  it("drops the repo entry once its last path is revealed", () => {
    const map = withHiddenPaths({}, "/repo", ["notes.md"]);
    expect(withoutHiddenPaths(map, "/repo", ["notes.md"])).toEqual({});
  });

  it("leaves the other repositories untouched", () => {
    const map = withHiddenPaths(
      withHiddenPaths({}, "/a", ["x.ts", "z.ts"]),
      "/b",
      ["y.ts"],
    );
    expect(withoutHiddenPaths(map, "/a", ["x.ts"])).toEqual({
      "/a": ["z.ts"],
      "/b": ["y.ts"],
    });
  });

  it("returns the same reference when the path was not hidden", () => {
    const map = withHiddenPaths({}, "/repo", ["notes.md"]);
    expect(withoutHiddenPaths(map, "/repo", ["other.md"])).toBe(map);
    expect(withoutHiddenPaths(map, "/unknown", ["notes.md"])).toBe(map);
  });
});

describe("clearHiddenPaths", () => {
  it("empties one repo and keeps the rest", () => {
    const map = withHiddenPaths(withHiddenPaths({}, "/a", ["x.ts"]), "/b", [
      "y.ts",
    ]);
    expect(clearHiddenPaths(map, "/a")).toEqual({ "/b": ["y.ts"] });
    expect(clearHiddenPaths(map, "/unknown")).toBe(map);
  });
});

describe("partitionHidden", () => {
  const entries = [
    { path: "a.ts" },
    { path: "notes.md" },
    { path: "src/b.ts" },
  ];

  it("splits muted entries out while preserving order", () => {
    const result = partitionHidden(entries, new Set(["notes.md"]));
    expect(result.visible.map((e) => e.path)).toEqual(["a.ts", "src/b.ts"]);
    expect(result.hidden.map((e) => e.path)).toEqual(["notes.md"]);
  });

  it("matches Windows-style paths against stored forward slashes", () => {
    const result = partitionHidden(
      [{ path: "src\\b.ts" }],
      new Set(["src/b.ts"]),
    );
    expect(result.hidden).toHaveLength(1);
  });

  it("passes every entry through when nothing is hidden", () => {
    const result = partitionHidden(entries, new Set());
    expect(result.visible).toBe(entries);
    expect(result.hidden).toHaveLength(0);
  });
});
