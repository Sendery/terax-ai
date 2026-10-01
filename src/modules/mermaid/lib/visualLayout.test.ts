import type { MermaidVisualLayout } from "@/modules/tabs";
import { describe, expect, it } from "vitest";
import {
  moveFlowLayoutNode,
  normalizeFlowLayout,
  renameFlowLayoutNode,
} from "./visualLayout";

const nodes = [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }];

describe("flowchart visual layout", () => {
  it("keeps valid positions, prunes stale ids, and lays out new nodes", () => {
    const layout = normalizeFlowLayout(nodes, {
      kind: "flowchart",
      positions: {
        A: { x: 55, y: 70 },
        Removed: { x: 10, y: 10 },
      },
    });
    expect(layout).toEqual({
      kind: "flowchart",
      positions: {
        A: { x: 55, y: 70 },
        B: { x: 260, y: 40 },
        C: { x: 40, y: 160 },
        D: { x: 260, y: 160 },
      },
    });
  });

  it("moves a node by a delta and clamps coordinates", () => {
    const layout: MermaidVisualLayout = {
      kind: "flowchart",
      positions: { A: { x: 99_990, y: -99_990 } },
    };
    expect(moveFlowLayoutNode(layout, "A", { x: 50, y: -50 })).toEqual({
      kind: "flowchart",
      positions: { A: { x: 100_000, y: -100_000 } },
    });
  });

  it("renames a position without changing its coordinates", () => {
    const layout: MermaidVisualLayout = {
      kind: "flowchart",
      positions: { Old: { x: 20, y: 30 } },
    };
    expect(renameFlowLayoutNode(layout, "Old", "New")).toEqual({
      kind: "flowchart",
      positions: { New: { x: 20, y: 30 } },
    });
  });

  it("returns the same layout for an unknown move", () => {
    const layout: MermaidVisualLayout = {
      kind: "flowchart",
      positions: { A: { x: 20, y: 30 } },
    };
    expect(moveFlowLayoutNode(layout, "missing", { x: 1, y: 1 })).toBe(layout);
  });
});
