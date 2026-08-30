import type { GitRef } from "@/modules/ai/lib/native";
import { describe, expect, it } from "vitest";
import { orderRefs, splitRefsForDisplay } from "./refs";

const ref = (name: string, kind: GitRef["kind"], isHead = false): GitRef => ({
  name,
  kind,
  isHead,
});

describe("orderRefs", () => {
  it("puts the checked-out branch first", () => {
    const ordered = orderRefs([
      ref("origin/main", "remote"),
      ref("v1.0", "tag"),
      ref("main", "branch", true),
    ]);

    expect(ordered[0]).toMatchObject({ name: "main", isHead: true });
  });

  it("orders local branches, then tags, then remotes", () => {
    const ordered = orderRefs([
      ref("origin/main", "remote"),
      ref("v1.0", "tag"),
      ref("topic", "branch"),
    ]);

    expect(ordered.map((r) => r.name)).toEqual([
      "topic",
      "v1.0",
      "origin/main",
    ]);
  });

  it("keeps a stable order inside a group", () => {
    const ordered = orderRefs([
      ref("origin/b", "remote"),
      ref("origin/a", "remote"),
    ]);

    expect(ordered.map((r) => r.name)).toEqual(["origin/b", "origin/a"]);
  });

  it("keeps a detached HEAD visible", () => {
    const ordered = orderRefs([ref("HEAD", "other", true)]);

    expect(ordered).toHaveLength(1);
  });
});

describe("splitRefsForDisplay", () => {
  const many = [
    ref("main", "branch", true),
    ref("v1.0", "tag"),
    ref("origin/main", "remote"),
    ref("origin/release", "remote"),
    ref("backup", "branch"),
  ];

  it("shows every ref when they fit", () => {
    const split = splitRefsForDisplay(many.slice(0, 2), 3);

    expect(split.shown).toHaveLength(2);
    expect(split.overflow).toBe(0);
  });

  it("counts the ones it had to drop", () => {
    const split = splitRefsForDisplay(many, 3);

    expect(split.shown).toHaveLength(3);
    expect(split.overflow).toBe(2);
  });

  it("never drops the checked-out branch", () => {
    // A row that hides where HEAD is defeats the point of the column.
    const split = splitRefsForDisplay(many, 1);

    expect(split.shown[0].isHead).toBe(true);
  });

  it("names the hidden refs so the title can list them", () => {
    const split = splitRefsForDisplay(many, 2);

    expect(split.hidden.map((r) => r.name)).toEqual([
      "v1.0",
      "origin/main",
      "origin/release",
    ]);
  });

  it("handles a commit with no refs", () => {
    expect(splitRefsForDisplay([], 3)).toEqual({
      shown: [],
      hidden: [],
      overflow: 0,
    });
  });
});
