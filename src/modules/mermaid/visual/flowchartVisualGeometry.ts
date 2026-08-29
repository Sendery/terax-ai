export const FLOWCHART_NODE_WIDTH = 160;
export const FLOWCHART_NODE_HEIGHT = 72;

const CANVAS_PADDING = 88;
const MIN_CANVAS_WIDTH = 720;
const MIN_CANVAS_HEIGHT = 480;
const EDGE_LABEL_OFFSET = 8;
const LOOP_WIDTH = 72;
const LOOP_HEIGHT = 68;

type LayoutNode = {
  id: string;
  x: number;
  y: number;
};

type Point = {
  x: number;
  y: number;
};

type EdgeGeometry = {
  path: string;
  label: Point;
};

export function getFlowchartCanvasGeometry(nodes: LayoutNode[]): {
  width: number;
  height: number;
  positions: Record<string, Point>;
} {
  if (nodes.length === 0) {
    return {
      width: MIN_CANVAS_WIDTH,
      height: MIN_CANVAS_HEIGHT,
      positions: {},
    };
  }

  const minX = Math.min(0, ...nodes.map((node) => node.x));
  const minY = Math.min(0, ...nodes.map((node) => node.y));
  const maxX = Math.max(
    MIN_CANVAS_WIDTH - CANVAS_PADDING * 2,
    ...nodes.map((node) => node.x + FLOWCHART_NODE_WIDTH),
  );
  const maxY = Math.max(
    MIN_CANVAS_HEIGHT - CANVAS_PADDING * 2,
    ...nodes.map((node) => node.y + FLOWCHART_NODE_HEIGHT),
  );
  const offsetX = CANVAS_PADDING - minX;
  const offsetY = CANVAS_PADDING - minY;

  return {
    width: maxX - minX + CANVAS_PADDING * 2,
    height: maxY - minY + CANVAS_PADDING * 2,
    positions: Object.fromEntries(
      nodes.map((node) => [
        node.id,
        { x: node.x + offsetX, y: node.y + offsetY },
      ]),
    ),
  };
}

function formatCoordinate(value: number): string {
  return Number(value.toFixed(2)).toString();
}

export function getFlowchartEdgeGeometry(from: Point, to: Point): EdgeGeometry {
  const fromCenter = {
    x: from.x + FLOWCHART_NODE_WIDTH / 2,
    y: from.y + FLOWCHART_NODE_HEIGHT / 2,
  };
  const toCenter = {
    x: to.x + FLOWCHART_NODE_WIDTH / 2,
    y: to.y + FLOWCHART_NODE_HEIGHT / 2,
  };
  const deltaX = toCenter.x - fromCenter.x;
  const deltaY = toCenter.y - fromCenter.y;

  if (deltaX === 0 && deltaY === 0) {
    const startX = from.x + FLOWCHART_NODE_WIDTH;
    const startY = fromCenter.y - FLOWCHART_NODE_HEIGHT / 4;
    const endY = fromCenter.y + FLOWCHART_NODE_HEIGHT / 4;
    const controlX = startX + LOOP_WIDTH;
    const topY = fromCenter.y - LOOP_HEIGHT;
    const bottomY = fromCenter.y + LOOP_HEIGHT;
    return {
      path: `M ${formatCoordinate(startX)} ${formatCoordinate(startY)} C ${formatCoordinate(controlX)} ${formatCoordinate(topY)} ${formatCoordinate(controlX)} ${formatCoordinate(bottomY)} ${formatCoordinate(startX)} ${formatCoordinate(endY)}`,
      label: { x: controlX + EDGE_LABEL_OFFSET, y: fromCenter.y },
    };
  }

  const horizontalScale =
    Math.abs(deltaX) > 0
      ? FLOWCHART_NODE_WIDTH / 2 / Math.abs(deltaX)
      : Number.POSITIVE_INFINITY;
  const verticalScale =
    Math.abs(deltaY) > 0
      ? FLOWCHART_NODE_HEIGHT / 2 / Math.abs(deltaY)
      : Number.POSITIVE_INFINITY;
  const scale = Math.min(horizontalScale, verticalScale);
  const start = {
    x: fromCenter.x + deltaX * scale,
    y: fromCenter.y + deltaY * scale,
  };
  const end = {
    x: toCenter.x - deltaX * scale,
    y: toCenter.y - deltaY * scale,
  };

  return {
    path: `M ${formatCoordinate(start.x)} ${formatCoordinate(start.y)} L ${formatCoordinate(end.x)} ${formatCoordinate(end.y)}`,
    label: {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2 - EDGE_LABEL_OFFSET,
    },
  };
}
