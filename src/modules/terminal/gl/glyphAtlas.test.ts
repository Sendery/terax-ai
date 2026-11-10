import { FONT_BOLD, FONT_ITALIC } from "@/modules/terminal/gl/cellBuffer";
import {
  fontString,
  isColorGlyph,
  SlotAllocator,
} from "@/modules/terminal/gl/glyphAtlas";
import { describe, expect, it } from "vitest";

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
