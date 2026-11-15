import { RenderCapacityError } from "@/modules/terminal/gl/renderCapacity";
import { FONT_BOLD, FONT_ITALIC } from "@/modules/terminal/gl/cellBuffer";
import {
  fontString,
  GlyphAtlas,
  isColorGlyph,
  SlotAllocator,
} from "@/modules/terminal/gl/glyphAtlas";
import { afterEach, describe, expect, it, vi } from "vitest";

const CELL = { width: 10, height: 20, baseline: 16 };

describe("SlotAllocator", () => {
  it("fills a page row-major and opens pages on demand", () => {
    const slots = new SlotAllocator(40, CELL, 2);
    expect(slots.columns).toBe(4);
    expect(slots.rowsPerPage).toBe(2);
    expect(slots.pages).toBe(0);
    const taken = Array.from({ length: 7 }, () => slots.allocate(1));
    expect(taken).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(slots.pages).toBe(1);
    expect(slots.allocate(1)).toBe(8);
    expect(slots.pages).toBe(2);
    expect(slots.allocate(1)).toBe(9);
  });

  it("never splits a wide glyph across a row", () => {
    const slots = new SlotAllocator(40, CELL, 1);
    expect(slots.allocate(1)).toBe(1);
    expect(slots.allocate(1)).toBe(2);
    expect(slots.allocate(2)).toBe(4);
    expect(slots.allocate(2)).toBe(6);
  });

  it("reports exhaustion instead of reusing a slot", () => {
    const slots = new SlotAllocator(40, CELL, 1);
    for (let i = 1; i < 8; i++) expect(slots.allocate(1)).toBe(i);
    expect(slots.allocate(1)).toBe(-1);
    expect(slots.allocate(2)).toBe(-1);
    slots.reset();
    expect(slots.pages).toBe(0);
    expect(slots.allocate(2)).toBe(1);
  });

  it("refuses cells too large for a page", () => {
    const slots = new SlotAllocator(15, CELL, 4);
    expect(slots.allocate(1)).toBe(-1);
  });

  it("never returns the no-glyph slot", () => {
    const slots = new SlotAllocator(40, CELL, 3);
    const taken = new Set<number>();
    for (let i = 0; i < 30; i++) taken.add(slots.allocate(i % 3 ? 1 : 2));
    expect(taken.has(0)).toBe(false);
  });
});

describe("isColorGlyph", () => {
  it("treats grey coverage as a monochrome glyph", () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 128, 128, 128, 90]);
    expect(isColorGlyph(rgba)).toBe(false);
  });

  it("detects chroma in an opaque pixel", () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 250, 200, 40, 255]);
    expect(isColorGlyph(rgba)).toBe(true);
  });

  it("ignores chroma in nearly transparent pixels", () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 8]);
    expect(isColorGlyph(rgba)).toBe(false);
  });
});

describe("fontString", () => {
  const font = {
    family: '"JetBrains Mono", monospace',
    weight: "300",
    sizePx: 26,
    letterSpacingPx: 0,
  };

  it("uses the configured weight for the regular face", () => {
    expect(fontString(font, 0)).toBe('300 26px "JetBrains Mono", monospace');
  });

  it("switches to bold and italic faces", () => {
    expect(fontString(font, FONT_BOLD | FONT_ITALIC)).toBe(
      'italic bold 26px "JetBrains Mono", monospace',
    );
  });
});

afterEach(() => vi.unstubAllGlobals());
function mockedAtlas() {
  const canvas = { width: 0, height: 0 };
  const ctx = {
    canvas,
    font: "",
    measureText: () => ({
      width: 10,
      fontBoundingBoxAscent: 16,
      fontBoundingBoxDescent: 4,
    }),
    clearRect: vi.fn(),
    save: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillText: vi.fn(),
    restore: vi.fn(),
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4).fill(255),
    }),
  };
  vi.stubGlobal("document", {
    createElement: () => ({ getContext: () => ctx }),
  });
  const font = {
    family: "monospace",
    weight: "normal",
    sizePx: 14,
    letterSpacingPx: 0,
  };
  return { atlas: new GlyphAtlas(font), ctx, font };
}
it("rasterizes full cluster strings and distinguishes accents, face and native width in its cache", () => {
  const { atlas, ctx } = mockedAtlas();
  const acute = atlas.lookup("e\u0301", 0, false);
  expect(atlas.lookup("e\u0301", 0, false)).toBe(acute);
  expect(atlas.lookup("e\u0300", 0, false)).not.toBe(acute);
  expect(atlas.lookup("e\u0301", FONT_BOLD, false)).not.toBe(acute);
  expect(atlas.lookup("e\u0301", 0, true)).not.toBe(acute);
  atlas.lookup("\u{1f469}\u200d\u{1f4bb}", 0, true);
  expect(ctx.fillText.mock.calls.map((call) => call[0])).toEqual([
    "e\u0301",
    "e\u0300",
    "e\u0301",
    "e\u0301",
    "\u{1f469}\u200d\u{1f4bb}",
  ]);
  expect(atlas.glyphCount).toBe(5);
});
it("rebuilds complete cluster glyphs after changing device-pixel font metrics", () => {
  const { atlas, ctx, font } = mockedAtlas();
  atlas.lookup("e\u0301", 0, false);
  atlas.setFont({ ...font, sizePx: 28 });
  expect(atlas.glyphCount).toBe(0);
  atlas.lookup("e\u0301", 0, false);
  expect(ctx.fillText).toHaveBeenLastCalledWith("e\u0301", 0, 16);
  expect(ctx.font).toContain("28px");
  expect(ctx.fillText).toHaveBeenCalledTimes(2);
});

it("reports shared text-key exhaustion instead of returning a missing glyph and can explicitly reset", () => {
  const { atlas } = mockedAtlas();
  const long = `e${"\u0301".repeat(450000)}`;
  let capacity: unknown;
  for (let index = 0; index < 12; index++) {
    try {
      atlas.lookup(long + String.fromCodePoint(0x0300 + index), 0, false);
    } catch (error) {
      capacity = error;
      break;
    }
  }
  expect(capacity).toBeInstanceOf(RenderCapacityError);
  expect(atlas.exhausted).toBe(true);
  expect(atlas.glyphCount).toBeLessThan(12);
  atlas.reset();
  expect(atlas.lookup(long, 0, false)).toBeGreaterThan(0);
});
