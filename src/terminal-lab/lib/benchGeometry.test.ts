import { benchGeometry } from "@/terminal-lab/lib/benchGeometry";
import { describe, expect, it } from "vitest";

describe("benchmark geometry", () => {
  it("allocates every grid at its original cell size before CSS presentation", () => {
    const layout = benchGeometry(100, 30, 12, { width: 8, height: 18 });
    expect(layout.width).toBe(3200);
    expect(layout.height).toBe(1620);
    expect(layout.panes).toHaveLength(12);
    expect(layout.panes[11]).toEqual({
      x: 2400,
      y: 1080,
      width: 800,
      height: 540,
    });
  });
  it("preserves the single 200 by 60 workload", () => {
    const layout = benchGeometry(200, 60, 1, { width: 8, height: 18 });
    expect(layout.width).toBe(1600);
    expect(layout.height).toBe(1080);
  });
  it("rejects empty or nonfinite geometry", () => {
    expect(() => benchGeometry(100, 30, 0, { width: 8, height: 18 })).toThrow();
    expect(() =>
      benchGeometry(100, 30, 12, { width: Number.NaN, height: 18 }),
    ).toThrow();
  });
});
