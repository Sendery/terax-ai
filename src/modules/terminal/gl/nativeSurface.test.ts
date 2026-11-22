import { expect, it } from "vitest";
import { nativePaneLayout } from "@/modules/terminal/gl/nativeSurface";

it("uses shared-canvas coordinates for a nested pane", () => {
  const layout = nativePaneLayout(
    { left: 300, top: 140, width: 412, height: 252 },
    { left: 100, top: 40 },
    { width: 8, height: 20 },
  );
  expect(layout.rect).toEqual({ x: 206, y: 106, width: 400, height: 240 });
  expect(layout.grid).toEqual({ cols: 50, rows: 12 });
});
it("keeps grids valid while a pane is initially collapsed or very large", () => {
  expect(
    nativePaneLayout(
      { left: 0, top: 0, width: 0, height: 0 },
      { left: 0, top: 0 },
      { width: 8, height: 20 },
    ).grid,
  ).toEqual({ cols: 1, rows: 1 });
  expect(
    nativePaneLayout(
      { left: 0, top: 0, width: 50000, height: 50000 },
      { left: 0, top: 0 },
      { width: 4, height: 8 },
    ).grid,
  ).toEqual({ cols: 1000, rows: 500 });
});
