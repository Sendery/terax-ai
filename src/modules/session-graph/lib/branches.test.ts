import { describe, expect, it } from "vitest";

import type { SessionNode, SessionNodeKind } from "./entries";
import { branchOptions, descendTip, sessionLineage } from "./branches";

function node(
  id: string,
  parentId: string | null,
  kind: SessionNodeKind = "user",
  preview = id,
): SessionNode {
  return {
    id,
    parentId,
    kind,
    at: 0,
    preview,
    toolNames: [],
    isMilestone: kind === "user",
    isSidechain: false,
    hasReasoning: false,
    isSynthetic: false,
    compaction: null,
  };
}

/**
 *   a1 ── a2 ── a3 ┬── a4 ── a5      (abandoned)
 *                  └── a6 ── a7      (active, HEAD = a7)
 */
const REWIND = [
  node("a1", null, "user"),
  node("a2", "a1", "assistant"),
  node("a3", "a2", "assistant"),
  node("a4", "a3", "toolResult"),
  node("a5", "a4", "assistant", "abandoned tip"),
  node("a6", "a3", "user", "second attempt"),
  node("a7", "a6", "assistant"),
];

describe("descendTip", () => {
  it("walks down to the end of a branch", () => {
    expect(descendTip(REWIND, "a4")).toBe("a5");
    expect(descendTip(REWIND, "a6")).toBe("a7");
  });

  it("returns the node itself when it is already a tip", () => {
    expect(descendTip(REWIND, "a7")).toBe("a7");
  });

  it("prefers the most recent child when a branch forks again", () => {
    const nodes = [...REWIND, node("a8", "a4", "assistant", "later fork")];

    expect(descendTip(nodes, "a4")).toBe("a8");
  });

  it("returns null for an id that is not in the session", () => {
    expect(descendTip(REWIND, "missing")).toBe(null);
  });

  it("survives a parent cycle in a corrupt file", () => {
    const cyclic = [node("c1", "c2"), node("c2", "c1")];

    expect(() => descendTip(cyclic, "c1")).not.toThrow();
  });
});

describe("branchOptions", () => {
  it("lists the alternatives at each fork with the tip to switch to", () => {
    const options = branchOptions(REWIND, "a7");

    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ branchPointId: "a3" });
    expect(options[0].choices.map((c) => c.childId)).toEqual(["a4", "a6"]);
  });

  it("marks which alternative the current head is on", () => {
    const [fork] = branchOptions(REWIND, "a7");

    expect(fork.choices.find((c) => c.childId === "a6")?.isActive).toBe(true);
    expect(fork.choices.find((c) => c.childId === "a4")?.isActive).toBe(false);
  });

  it("gives each alternative the tip that switching to it should select", () => {
    const [fork] = branchOptions(REWIND, "a7");

    expect(fork.choices.find((c) => c.childId === "a4")?.tipId).toBe("a5");
    expect(fork.choices.find((c) => c.childId === "a6")?.tipId).toBe("a7");
  });

  it("counts how many entries each alternative holds", () => {
    const [fork] = branchOptions(REWIND, "a7");

    expect(fork.choices.find((c) => c.childId === "a4")?.size).toBe(2);
    expect(fork.choices.find((c) => c.childId === "a6")?.size).toBe(2);
  });

  it("previews each alternative by its first entry, so the choice is readable", () => {
    const [fork] = branchOptions(REWIND, "a7");

    expect(fork.choices.find((c) => c.childId === "a6")?.preview).toBe("second attempt");
  });

  it("follows the active head after switching to the other branch", () => {
    const [fork] = branchOptions(REWIND, "a5");

    expect(fork.choices.find((c) => c.childId === "a4")?.isActive).toBe(true);
    expect(fork.choices.find((c) => c.childId === "a6")?.isActive).toBe(false);
  });

  it("reports nothing for a session that never forked", () => {
    const linear = [node("n1", null), node("n2", "n1"), node("n3", "n2")];

    expect(branchOptions(linear, "n3")).toEqual([]);
  });

  it("lists several forks in file order", () => {
    const nodes = [
      node("b1", null, "user"),
      node("b2", "b1", "assistant"),
      node("b3", "b2", "user"),
      node("b4", "b2", "user"),
      node("b5", "b4", "assistant"),
      node("b6", "b5", "user"),
      node("b7", "b5", "user"),
    ];

    const options = branchOptions(nodes, "b7");

    expect(options.map((o) => o.branchPointId)).toEqual(["b2", "b5"]);
  });
});

describe("sessionLineage", () => {
  const sessions = [
    { id: "s1", parentSessionId: null },
    { id: "s2", parentSessionId: "s1" },
    { id: "s3", parentSessionId: "s1" },
    { id: "s4", parentSessionId: "s2" },
    { id: "other", parentSessionId: null },
  ];

  it("finds the session a fork came from", () => {
    expect(sessionLineage(sessions, "s2").parentId).toBe("s1");
  });

  it("finds every session forked from this one", () => {
    expect(sessionLineage(sessions, "s1").childIds).toEqual(["s2", "s3"]);
  });

  it("reports no parent for a root session", () => {
    expect(sessionLineage(sessions, "s1").parentId).toBe(null);
  });

  it("reports no children for a leaf session", () => {
    expect(sessionLineage(sessions, "s4").childIds).toEqual([]);
  });

  it("ignores a parent pointer to a session that is not present", () => {
    const orphan = [{ id: "x1", parentSessionId: "gone" }];

    expect(sessionLineage(orphan, "x1").parentId).toBe(null);
  });

  it("returns an empty lineage for an unknown session", () => {
    expect(sessionLineage(sessions, "nope")).toEqual({ parentId: null, childIds: [] });
  });
});
