import { describe, expect, it } from "vitest";
import {
  FLOWCHART_NODE_HEIGHT,
  FLOWCHART_NODE_WIDTH,
  getFlowchartCanvasGeometry,
  getFlowchartEdgeGeometry,
} from "./flowchartVisualGeometry";

describe("flowchart visual geometry", () => {
  it("keeps negative layout coordinates visible without changing spacing", () => {
    const geometry = getFlowchartCanvasGeometry([
      { id: "A", x: -120, y: -40 },
      { id: "B", x: 180, y: 160 },
    ]);

    expect(geometry.positions.A.x).toBeGreaterThanOrEqual(0);
    expect(geometry.positions.A.y).toBeGreaterThanOrEqual(0);
    expect(geometry.positions.B.x - geometry.positions.A.x).toBe(300);
    expect(geometry.positions.B.y - geometry.positions.A.y).toBe(200);
    expect(geometry.width).toBeGreaterThan(
      geometry.positions.B.x + FLOWCHART_NODE_WIDTH,
    );
    expect(geometry.height).toBeGreaterThan(
      geometry.positions.B.y + FLOWCHART_NODE_HEIGHT,
    );
  });

  it("trims a straight connection to the node boundaries", () => {
    const edge = getFlowchartEdgeGeometry({ x: 0, y: 0 }, { x: 300, y: 0 });

    expect(edge.path).toBe("M 160 36 L 300 36");
    expect(edge.label).toEqual({ x: 230, y: 28 });
  });

  it("draws a visible loop for a connection back to the same node", () => {
    const edge = getFlowchartEdgeGeometry({ x: 20, y: 30 }, { x: 20, y: 30 });

    expect(edge.path).toContain(" C ");
    expect(edge.label.x).toBeGreaterThan(20 + FLOWCHART_NODE_WIDTH);
  });

  it("keeps a rightmost self-loop and its label inside the canvas", () => {
    const canvas = getFlowchartCanvasGeometry([{ id: "A", x: 1_000, y: 50 }]);
    const position = canvas.positions.A;
    const edge = getFlowchartEdgeGeometry(position, position);

    expect(edge.label.x).toBeLessThanOrEqual(canvas.width);
  });
});
