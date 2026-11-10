import { cssColorToBgr } from "@/terminal-lab/lib/colors";
import { distribution, intervals, perSecond } from "@/terminal-lab/lib/stats";
import { describe, expect, it } from "vitest";

describe("distribution", () => {
  it("is empty without samples", () => {
    expect(distribution([])).toEqual({
      count: 0,
      p50: null,
      p95: null,
      max: null,
    });
  });

  it("takes nearest-rank percentiles regardless of order", () => {
    const samples = Array.from({ length: 100 }, (_, i) => 100 - i);
    expect(distribution(samples)).toEqual({
      count: 100,
      p50: 50,
      p95: 95,
      max: 100,
    });
  });

  it("handles a single sample and rounds to a tenth", () => {
    expect(distribution([16.6666])).toEqual({
      count: 1,
      p50: 16.7,
      p95: 16.7,
      max: 16.7,
    });
  });
});

describe("intervals and rates", () => {
  it("measures gaps between stamps", () => {
    expect(intervals([0, 16, 33, 50])).toEqual([16, 17, 17]);
    expect(intervals([5])).toEqual([]);
  });

  it("scales to per second and refuses an empty window", () => {
    expect(perSecond(120, 2000)).toBe(60);
    expect(perSecond(1, 0)).toBeNull();
  });
});

describe("cssColorToBgr", () => {
  it("reads computed rgb and hex colours", () => {
    expect(cssColorToBgr("rgb(255, 128, 0)", 0)).toBe(0x0080ff);
    expect(cssColorToBgr("rgba(1, 2, 3, 0.5)", 0)).toBe(0x030201);
    expect(cssColorToBgr("rgb(10 20 30)", 0)).toBe(0x1e140a);
    expect(cssColorToBgr("#112233", 0)).toBe(0x332211);
  });

  it("falls back on anything else", () => {
    expect(cssColorToBgr("oklch(0.5 0.1 200)", 7)).toBe(7);
    expect(cssColorToBgr("", 7)).toBe(7);
  });
});
