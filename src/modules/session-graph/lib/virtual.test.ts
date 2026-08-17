import { describe, expect, it } from "vitest";

import { visibleWindow } from "./virtual";

describe("visibleWindow", () => {
  it("renders only the rows the viewport can show, plus overscan", () => {
    // 1000 rows of 24px in a 240px viewport: 10 visible, not 1000 mounted.
    const win = visibleWindow({
      total: 1000,
      rowHeight: 24,
      scrollTop: 0,
      viewportHeight: 240,
      overscan: 4,
    });

    expect(win.start).toBe(0);
    expect(win.end).toBe(14);
    expect(win.end - win.start).toBeLessThan(20);
  });

  it("keeps the total scrollable height so the scrollbar stays honest", () => {
    const win = visibleWindow({
      total: 1000,
      rowHeight: 24,
      scrollTop: 2400,
      viewportHeight: 240,
      overscan: 4,
    });

    expect(win.padTop + (win.end - win.start) * 24 + win.padBottom).toBe(1000 * 24);
  });

  it("offsets the rendered slice so rows land at their real position", () => {
    const win = visibleWindow({
      total: 1000,
      rowHeight: 24,
      scrollTop: 2400,
      viewportHeight: 240,
      overscan: 4,
    });

    expect(win.start).toBe(96);
    expect(win.padTop).toBe(96 * 24);
  });

  it("does not scroll past the last row", () => {
    const win = visibleWindow({
      total: 50,
      rowHeight: 24,
      scrollTop: 100_000,
      viewportHeight: 240,
      overscan: 4,
    });

    expect(win.end).toBe(50);
    expect(win.start).toBeLessThanOrEqual(50);
    expect(win.padBottom).toBe(0);
  });

  it("handles a viewport taller than the content", () => {
    const win = visibleWindow({
      total: 3,
      rowHeight: 24,
      scrollTop: 0,
      viewportHeight: 900,
      overscan: 4,
    });

    expect(win).toEqual({ start: 0, end: 3, padTop: 0, padBottom: 0 });
  });

  it("returns an empty window for no rows", () => {
    expect(
      visibleWindow({ total: 0, rowHeight: 24, scrollTop: 0, viewportHeight: 240 }),
    ).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
  });

  it("tolerates a viewport of zero height before first layout", () => {
    const win = visibleWindow({
      total: 100,
      rowHeight: 24,
      scrollTop: 0,
      viewportHeight: 0,
    });

    expect(win.start).toBe(0);
    expect(win.end).toBeGreaterThan(0);
  });

  it("refuses a zero row height instead of dividing by it", () => {
    const win = visibleWindow({
      total: 100,
      rowHeight: 0,
      scrollTop: 0,
      viewportHeight: 240,
    });

    expect(Number.isFinite(win.start)).toBe(true);
    expect(Number.isFinite(win.end)).toBe(true);
  });

  it("clamps a negative scroll position from elastic overscroll", () => {
    const win = visibleWindow({
      total: 100,
      rowHeight: 24,
      scrollTop: -500,
      viewportHeight: 240,
      overscan: 4,
    });

    expect(win.start).toBe(0);
    expect(win.padTop).toBe(0);
  });
});
