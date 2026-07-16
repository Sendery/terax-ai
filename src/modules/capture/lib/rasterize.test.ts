import { describe, expect, it } from "vitest";
import {
  buildSvgMarkup,
  captureScaleFor,
  MAX_CAPTURE_HEIGHT,
  MAX_CAPTURE_PIXELS,
  MAX_CAPTURE_WIDTH,
  validateCaptureDimensions,
} from "./rasterize";

describe("validateCaptureDimensions", () => {
  it("accepts a normal window size", () => {
    expect(validateCaptureDimensions(1512, 982)).toBeNull();
  });

  it("rejects empty and non-integer sizes", () => {
    expect(validateCaptureDimensions(0, 100)).toMatch(/dimensions/i);
    expect(validateCaptureDimensions(100.5, 100)).toMatch(/dimensions/i);
  });

  it("rejects sizes beyond the shared visual QA limits", () => {
    expect(validateCaptureDimensions(MAX_CAPTURE_WIDTH + 1, 10)).toMatch(
      /dimensions/i,
    );
    expect(validateCaptureDimensions(10, MAX_CAPTURE_HEIGHT + 1)).toMatch(
      /dimensions/i,
    );
    expect(validateCaptureDimensions(7_680, 4_320)).toMatch(/dimensions/i);
    expect(7_680 * 4_320).toBeGreaterThan(MAX_CAPTURE_PIXELS);
  });
});

describe("captureScaleFor", () => {
  it("keeps the device pixel ratio when within limits", () => {
    expect(captureScaleFor(1000, 800, 2)).toBe(2);
  });

  it("downscales when the scaled surface would exceed the pixel cap", () => {
    const scale = captureScaleFor(6000, 4000, 2);
    expect(scale).toBeLessThan(2);
    expect(scale).toBeGreaterThan(0);
    expect(
      Math.floor(6000 * scale) * Math.floor(4000 * scale),
    ).toBeLessThanOrEqual(MAX_CAPTURE_PIXELS);
  });

  it("never returns a scale above the requested ratio or below a floor", () => {
    expect(captureScaleFor(100, 100, 3)).toBe(3);
    expect(captureScaleFor(7000, 4000, 4)).toBeGreaterThanOrEqual(0.1);
  });
});

describe("buildSvgMarkup", () => {
  it("wraps serialized content in a sized foreignObject", () => {
    const svg = buildSvgMarkup(320, 200, "<div>hello</div>", "");
    expect(svg).toContain('width="320"');
    expect(svg).toContain('height="200"');
    expect(svg).toContain("<foreignObject");
    expect(svg).toContain("<div>hello</div>");
  });

  it("embeds font css inside a style element when provided", () => {
    const svg = buildSvgMarkup(10, 10, "<div/>", "@font-face{}");
    expect(svg).toContain("<style>@font-face{}</style>");
  });
});
