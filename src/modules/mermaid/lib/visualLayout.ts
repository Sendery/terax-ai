import type { MermaidVisualLayout } from "@/modules/tabs";

const MAX_LAYOUT_COORDINATE = 100_000;
const GRID_COLUMNS = 2;
const GRID_X = 220;
const GRID_Y = 120;
const GRID_ORIGIN = { x: 40, y: 40 };

function clampCoordinate(value: number): number {
  return Math.max(
    -MAX_LAYOUT_COORDINATE,
    Math.min(MAX_LAYOUT_COORDINATE, value),
  );
}

export function normalizeFlowLayout(
  nodes: Array<{ id: string }>,
  layout?: MermaidVisualLayout,
): MermaidVisualLayout {
  const positions: MermaidVisualLayout["positions"] = {};
  nodes.forEach((node, index) => {
    const existing = layout?.positions[node.id];
    positions[node.id] = existing ?? {
      x: GRID_ORIGIN.x + (index % GRID_COLUMNS) * GRID_X,
      y: GRID_ORIGIN.y + Math.floor(index / GRID_COLUMNS) * GRID_Y,
    };
  });
  return { kind: "flowchart", positions };
}

export function moveFlowLayoutNode(
  layout: MermaidVisualLayout,
  nodeId: string,
  delta: { x: number; y: number },
): MermaidVisualLayout {
  const current = layout.positions[nodeId];
  if (!current) return layout;
  return {
    kind: "flowchart",
    positions: {
      ...layout.positions,
      [nodeId]: {
        x: clampCoordinate(current.x + delta.x),
        y: clampCoordinate(current.y + delta.y),
      },
    },
  };
}

export function renameFlowLayoutNode(
  layout: MermaidVisualLayout,
  previousId: string,
  nextId: string,
): MermaidVisualLayout {
  const current = layout.positions[previousId];
  if (!current || previousId === nextId) return layout;
  const positions = { ...layout.positions };
  delete positions[previousId];
  positions[nextId] = current;
  return { kind: "flowchart", positions };
}
