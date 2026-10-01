import { describe, expect, it } from "vitest";

import { extractLogoMark } from "./logoMark";

function solid(size: number, value: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  return data;
}

function alphaAt(data: Uint8ClampedArray, size: number, x: number, y: number) {
  return data[(y * size + x) * 4 + 3];
}

describe("extractLogoMark", () => {
  it("drops the dark squircle and keeps the light ribbon", () => {
    const dark = solid(64, 56);
    extractLogoMark(dark, 64, 64);
    expect(alphaAt(dark, 64, 32, 32)).toBe(0);

    const light = solid(64, 200);
    extractLogoMark(light, 64, 64);
    expect(alphaAt(light, 64, 32, 32)).toBe(255);
  });

  it("ramps the ribbon's shading instead of cutting it", () => {
    const mid = solid(64, 107);
    extractLogoMark(mid, 64, 64);
    const alpha = alphaAt(mid, 64, 32, 32);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(255);
  });

  it("clears the rim of the original icon", () => {
    const light = solid(64, 230);
    extractLogoMark(light, 64, 64);
    expect(alphaAt(light, 64, 0, 0)).toBe(0);
    expect(alphaAt(light, 64, 63, 32)).toBe(0);
  });
});
