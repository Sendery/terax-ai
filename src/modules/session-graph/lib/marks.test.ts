import { describe, expect, it } from "vitest";

import {
  createMark,
  isSessionMark,
  MARK_COLORS,
  markKey,
  marksForSession,
  parseStoredMarks,
  removeMark,
  renameMark,
  upsertMark,
} from "./marks";

const NOW = Date.UTC(2026, 7, 7, 9);

describe("createMark", () => {
  it("records the entry, the label and when it was marked", () => {
    const mark = createMark(
      { sessionId: "s1", nodeId: "n1", label: "before refactor" },
      NOW,
    );

    expect(mark).toMatchObject({
      sessionId: "s1",
      nodeId: "n1",
      label: "before refactor",
      color: "amber",
      at: NOW,
    });
  });

  it("trims the label and collapses inner whitespace", () => {
    const mark = createMark(
      { sessionId: "s1", nodeId: "n1", label: "  key   point \n" },
      NOW,
    );

    expect(mark.label).toBe("key point");
  });

  it("caps a pasted label so one mark cannot break the row", () => {
    const mark = createMark({ sessionId: "s1", nodeId: "n1", label: "x".repeat(500) }, NOW);

    expect(mark.label.length).toBeLessThanOrEqual(60);
  });

  it("accepts a chosen colour from the closed palette", () => {
    const mark = createMark(
      { sessionId: "s1", nodeId: "n1", label: "a", color: "green" },
      NOW,
    );

    expect(mark.color).toBe("green");
  });
});

describe("isSessionMark", () => {
  const valid = createMark({ sessionId: "s1", nodeId: "n1", label: "a" }, NOW);

  it("accepts a well-formed mark", () => {
    expect(isSessionMark(valid)).toBe(true);
  });

  it("rejects anything that is not a usable mark", () => {
    for (const bad of [
      null,
      undefined,
      "mark",
      42,
      [],
      {},
      { ...valid, sessionId: "" },
      { ...valid, nodeId: "" },
      { ...valid, label: "" },
      { ...valid, at: "yesterday" },
      { ...valid, color: "chartreuse" },
      { ...valid, sessionId: 1 },
    ]) {
      expect(isSessionMark(bad)).toBe(false);
    }
  });

  it("only accepts colours from the palette", () => {
    for (const color of MARK_COLORS) {
      expect(isSessionMark({ ...valid, color })).toBe(true);
    }
  });
});

describe("parseStoredMarks", () => {
  it("drops an invalid record instead of failing the whole panel", () => {
    const good = createMark({ sessionId: "s1", nodeId: "n1", label: "keep" }, NOW);

    const marks = parseStoredMarks([good, { nope: true }, null, "x"]);

    expect(marks).toEqual([good]);
  });

  it("keeps the last write when the same entry was marked twice", () => {
    const first = createMark({ sessionId: "s1", nodeId: "n1", label: "old" }, NOW);
    const second = createMark({ sessionId: "s1", nodeId: "n1", label: "new" }, NOW + 1);

    expect(parseStoredMarks([first, second])).toEqual([second]);
  });

  it("treats the same node id in different sessions as different marks", () => {
    const a = createMark({ sessionId: "s1", nodeId: "n1", label: "a" }, NOW);
    const b = createMark({ sessionId: "s2", nodeId: "n1", label: "b" }, NOW);

    expect(parseStoredMarks([a, b])).toHaveLength(2);
  });

  it("returns nothing for a corrupt or missing store", () => {
    expect(parseStoredMarks(undefined)).toEqual([]);
    expect(parseStoredMarks({})).toEqual([]);
  });
});

describe("collection operations", () => {
  const a = createMark({ sessionId: "s1", nodeId: "n1", label: "a" }, NOW);
  const b = createMark({ sessionId: "s1", nodeId: "n2", label: "b" }, NOW + 1);
  const other = createMark({ sessionId: "s2", nodeId: "n3", label: "c" }, NOW + 2);

  it("adds a mark", () => {
    expect(upsertMark([a], b)).toEqual([a, b]);
  });

  it("replaces the label when the same entry is marked again", () => {
    const again = createMark({ sessionId: "s1", nodeId: "n1", label: "revised" }, NOW + 5);

    const marks = upsertMark([a, b], again);

    expect(marks).toHaveLength(2);
    expect(marks.find((m) => m.nodeId === "n1")?.label).toBe("revised");
  });

  it("removes only the addressed mark", () => {
    expect(removeMark([a, b, other], "s1", "n1")).toEqual([b, other]);
  });

  it("ignores a removal that matches nothing", () => {
    expect(removeMark([a], "s1", "missing")).toEqual([a]);
  });

  it("renames in place and keeps the original colour", () => {
    const marks = renameMark([a, b], "s1", "n1", "  new name ");

    expect(marks[0]).toMatchObject({ nodeId: "n1", label: "new name", color: a.color });
  });

  it("drops a mark renamed to nothing, since a blank label is not a record", () => {
    expect(renameMark([a, b], "s1", "n1", "   ")).toEqual([b]);
  });

  it("selects only the marks of one session, keyed by node", () => {
    const map = marksForSession([a, b, other], "s1");

    expect([...map.keys()].sort()).toEqual(["n1", "n2"]);
    expect(map.get("n1")?.label).toBe("a");
  });

  it("returns an empty map for a session with no marks", () => {
    expect(marksForSession([a, b], "s9").size).toBe(0);
  });

  it("keys a mark by session and node together", () => {
    expect(markKey("s1", "n1")).not.toBe(markKey("s2", "n1"));
  });
});
