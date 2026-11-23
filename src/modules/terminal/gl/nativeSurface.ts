import type { PaneRect } from "@/modules/terminal/gl/gridRenderer";

export function nativePaneLayout(
  pane: { left: number; top: number; width: number; height: number },
  surface: { left: number; top: number },
  cell: { width: number; height: number },
): { rect: PaneRect; grid: { cols: number; rows: number } } {
  const rect = {
    x: pane.left - surface.left + 6,
    y: pane.top - surface.top + 6,
    width: Math.max(0, pane.width - 12),
    height: Math.max(0, pane.height - 12),
  };
  const grid = {
    cols: cell.width > 0 ? Math.max(1, Math.floor(rect.width / cell.width)) : 1,
    rows:
      cell.height > 0 ? Math.max(1, Math.floor(rect.height / cell.height)) : 1,
  };
  return {
    rect,
    grid: { cols: Math.min(1000, grid.cols), rows: Math.min(500, grid.rows) },
  };
}
