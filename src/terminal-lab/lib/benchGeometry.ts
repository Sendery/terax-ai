import type { PaneRect } from "@/modules/terminal/gl/gridRenderer";

export function benchGeometry(
  cols: number,
  rows: number,
  sessions: number,
  cell: { width: number; height: number },
): { width: number; height: number; panes: PaneRect[] } {
  if (
    ![cols, rows, sessions].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    ) ||
    sessions > 12 ||
    ![cell.width, cell.height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    throw new Error("invalid benchmark geometry");
  const across = sessions === 1 ? 1 : 4;
  const down = Math.ceil(sessions / across);
  const width = cols * cell.width;
  const height = rows * cell.height;
  return {
    width: width * across,
    height: height * down,
    panes: Array.from({ length: sessions }, (_, i) => ({
      x: (i % across) * width,
      y: Math.floor(i / across) * height,
      width,
      height,
    })),
  };
}
