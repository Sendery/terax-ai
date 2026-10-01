import { describe, expect, it } from "vitest";

import { buildSessionGraph } from "./graph";
import type { SessionNode, SessionNodeKind } from "./entries";

function node(
  id: string,
  parentId: string | null,
  kind: SessionNodeKind = "user",
  at = 0,
): SessionNode {
  return {
    id,
    parentId,
    kind,
    at,
    preview: id,
    toolNames: [],
    isMilestone: kind === "user",
    isSidechain: false,
    hasReasoning: false,
    isSynthetic: false,
    compaction: null,
  };
}

/**
 * The shape observed in a real rewind: `a3` has two children — the original
 * tool result path, and a later user message that started a new branch.
 *
 *   a1 (user)
 *   └── a2 (assistant)
 *       └── a3 (assistant)
 *           ├── a4 (toolResult)  ← abandoned
 *           │   └── a5 (assistant)
 *           └── a6 (user)        ← active, HEAD below
 *               └── a7 (assistant)  = HEAD
 */
const REWIND = [
  node("a1", null, "user"),
  node("a2", "a1", "assistant"),
  node("a3", "a2", "assistant"),
  node("a4", "a3", "toolResult"),
  node("a5", "a4", "assistant"),
  node("a6", "a3", "user"),
  node("a7", "a6", "assistant"),
];

describe("buildSessionGraph", () => {
  it("orders rows oldest first so the transcript reads top-down", () => {
    const { rows } = buildSessionGraph([node("n1", null), node("n2", "n1"), node("n3", "n2")], "n3");

    expect(rows.map((r) => r.node.id)).toEqual(["n1", "n2", "n3"]);
  });

  it("keeps a linear session in a single lane", () => {
    const { rows, laneCount } = buildSessionGraph(
      [node("n1", null), node("n2", "n1")],
      "n2",
    );

    expect(rows.every((r) => r.lane === 0)).toBe(true);
    expect(laneCount).toBe(1);
  });

  it("marks the ancestry of HEAD as the active branch", () => {
    const { rows } = buildSessionGraph(REWIND, "a7");
    const active = rows.filter((r) => r.isOnActiveBranch).map((r) => r.node.id);

    expect(active).toEqual(["a1", "a2", "a3", "a6", "a7"]);
  });

  it("keeps the active branch in lane 0 and pushes abandoned work aside", () => {
    const { rows } = buildSessionGraph(REWIND, "a7");
    const lane = new Map(rows.map((r) => [r.node.id, r.lane]));

    expect(lane.get("a1")).toBe(0);
    expect(lane.get("a6")).toBe(0);
    expect(lane.get("a7")).toBe(0);
    expect(lane.get("a4")).toBeGreaterThan(0);
    expect(lane.get("a5")).toBe(lane.get("a4"));
  });

  it("emits abandoned branches before the active line continues", () => {
    // Keeps the main line contiguous below the spur instead of interleaving.
    const { rows } = buildSessionGraph(REWIND, "a7");

    expect(rows.map((r) => r.node.id)).toEqual(["a1", "a2", "a3", "a4", "a5", "a6", "a7"]);
  });

  it("reports the branch point so the UI can draw the fork", () => {
    const { rows } = buildSessionGraph(REWIND, "a7");
    const byId = new Map(rows.map((r) => [r.node.id, r]));

    expect(byId.get("a3")?.isBranchPoint).toBe(true);
    expect(byId.get("a3")?.childIds).toEqual(["a4", "a6"]);
    expect(byId.get("a2")?.isBranchPoint).toBe(false);
  });

  it("groups each abandoned spur so it can be collapsed as a unit", () => {
    const { branches } = buildSessionGraph(REWIND, "a7");
    const abandoned = branches.filter((b) => !b.isActive);

    expect(abandoned).toHaveLength(1);
    expect(abandoned[0]).toMatchObject({
      rootId: "a4",
      branchPointId: "a3",
      nodeIds: ["a4", "a5"],
    });
  });

  it("indexes user turns as milestones for the scroll rail", () => {
    const { milestones } = buildSessionGraph(REWIND, "a7");

    // Only user turns on the active branch anchor navigation.
    expect(milestones.map((m) => m.nodeId)).toEqual(["a1", "a6"]);
    expect(milestones.map((m) => m.rowIndex)).toEqual([0, 5]);
  });

  it("numbers turns so intermediate work can fold under its user message", () => {
    const { rows } = buildSessionGraph(REWIND, "a7");
    const turn = new Map(rows.map((r) => [r.node.id, r.turnIndex]));

    expect(turn.get("a1")).toBe(0);
    expect(turn.get("a2")).toBe(0);
    expect(turn.get("a3")).toBe(0);
    expect(turn.get("a6")).toBe(1);
    expect(turn.get("a7")).toBe(1);
  });

  it("draws a vertical edge from a node to its parent's row", () => {
    const { rows } = buildSessionGraph(REWIND, "a7");
    const byId = new Map(rows.map((r) => [r.node.id, r]));

    expect(byId.get("a2")?.parentRowIndex).toBe(0);
    // The spur's first row connects back up to the branch point, not to a5.
    expect(byId.get("a4")?.parentRowIndex).toBe(2);
    expect(byId.get("a6")?.parentRowIndex).toBe(2);
    expect(byId.get("a1")?.parentRowIndex).toBe(null);
  });

  it("handles several branch points in one session", () => {
    //  b1 ├── b2 (abandoned)
    //     ├── b3 (abandoned)
    //     └── b4 → b5 = HEAD
    const nodes = [
      node("b1", null, "assistant"),
      node("b2", "b1", "user"),
      node("b3", "b1", "user"),
      node("b4", "b1", "user"),
      node("b5", "b4", "assistant"),
    ];

    const { branches, rows, laneCount } = buildSessionGraph(nodes, "b5");

    expect(branches.filter((b) => !b.isActive).map((b) => b.rootId)).toEqual(["b2", "b3"]);
    expect(rows.find((r) => r.node.id === "b4")?.lane).toBe(0);
    expect(laneCount).toBeGreaterThanOrEqual(3);
  });

  it("still lays out a session whose HEAD is unknown", () => {
    // A file being written can leave HEAD pointing at a line we skipped.
    const { rows, milestones } = buildSessionGraph(REWIND, "does-not-exist");

    expect(rows).toHaveLength(7);
    expect(milestones.length).toBeGreaterThan(0);
  });

  it("lays out multiple roots without dropping any node", () => {
    const nodes = [node("r1", null), node("r2", null), node("r3", "r2")];

    const { rows } = buildSessionGraph(nodes, "r3");

    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.node.id)).size).toBe(3);
  });

  it("keeps lanes bounded by branch nesting, not by total branch count", () => {
    // Real claude transcripts contain hundreds of disjoint roots. Allocating a
    // fresh lane per root produced 693 lanes and an unrenderable rail.
    const nodes: SessionNode[] = [];
    for (let i = 0; i < 200; i++) nodes.push(node(`root${i}`, null, "user"));
    nodes.push(node("tip", "root0", "assistant"));

    const { laneCount, rows } = buildSessionGraph(nodes, "tip");

    expect(rows).toHaveLength(201);
    expect(laneCount).toBeLessThanOrEqual(2);
  });

  it("gives sibling spurs distinct lanes so they read as separate branches", () => {
    const nodes = [
      node("s1", null, "assistant"),
      node("s2", "s1", "user"),
      node("s3", "s1", "user"),
      node("s4", "s1", "user"),
      node("s5", "s4", "assistant"),
    ];

    const { rows } = buildSessionGraph(nodes, "s5");
    const lane = new Map(rows.map((r) => [r.node.id, r.lane]));

    expect(lane.get("s4")).toBe(0);
    expect(lane.get("s2")).not.toBe(lane.get("s3"));
  });

  it("returns an empty layout for an empty session", () => {
    const { rows, milestones, branches, laneCount } = buildSessionGraph([], null);

    expect(rows).toEqual([]);
    expect(milestones).toEqual([]);
    expect(branches).toEqual([]);
    expect(laneCount).toBe(0);
  });

  it("survives a parent cycle in a corrupt file", () => {
    const nodes = [node("c1", "c2"), node("c2", "c1")];

    expect(() => buildSessionGraph(nodes, "c2")).not.toThrow();
    expect(buildSessionGraph(nodes, "c2").rows).toHaveLength(2);
  });
});
