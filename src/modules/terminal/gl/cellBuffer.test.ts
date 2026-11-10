import {
  applyFrame,
  CELL_WORDS,
  type CellGrid,
  clearGlyphs,
  FONT_BOLD,
  FONT_ITALIC,
  GLYPH_COLOR,
  GLYPH_SKIP,
  GLYPH_SLOT_MASK,
  GLYPH_WIDE,
  type GlyphLookup,
} from "@/modules/terminal/gl/cellBuffer";
import {
  ATTR_BOLD,
  ATTR_FAINT,
  ATTR_INVERSE,
  ATTR_INVISIBLE,
  ATTR_ITALIC,
  ATTR_OVERLINE,
  ATTR_STRIKETHROUGH,
  ATTR_UNDERLINE_SHIFT,
  decodeFrame,
  FRAME_FLAG_FULL,
} from "@/modules/terminal/gl/frameCodec";
import {
  encodeFrame,
  explicit,
  type FrameSpec,
  TAIL,
  textRow,
  wide,
} from "@/modules/terminal/gl/frameCodec.testing";
import { describe, expect, it } from "vitest";

const FG = 0x00c0c0c0;
const BG = 0x00101010;

type Lookup = { cp: number; font: number; wide: boolean };

function recordingLookup(): { lookup: GlyphLookup; calls: Lookup[] } {
  const calls: Lookup[] = [];
  return {
    calls,
    lookup: (cp, font, isWide) => {
      calls.push({ cp, font, wide: isWide });
      return cp === 0x1f600 ? 900 | GLYPH_COLOR : cp;
    },
  };
}

function frame(spec: Partial<FrameSpec> & Pick<FrameSpec, "rowRecords">) {
  return decodeFrame(
    encodeFrame({
      cols: 4,
      rows: 3,
      defaultFg: FG,
      defaultBg: BG,
      flags: FRAME_FLAG_FULL,
      ...spec,
    }),
  );
}

function cell(grid: CellGrid, x: number, y: number) {
  const i = (y * grid.cols + x) * CELL_WORDS;
  const w = grid.cells;
  return {
    slot: w[i] & GLYPH_SLOT_MASK,
    wide: (w[i] & GLYPH_WIDE) !== 0,
    skip: (w[i] & GLYPH_SKIP) !== 0,
    color: (w[i] & GLYPH_COLOR) !== 0,
    underline: (w[i] >>> 27) & 7,
    strike: (w[i] & (1 << 30)) !== 0,
    overline: w[i] >>> 31 === 1,
    fg: w[i + 1],
    bg: w[i + 2],
    ul: w[i + 3],
  };
}

function apply(grid: CellGrid | null, spec: Parameters<typeof frame>[0]) {
  return applyFrame(grid, frame(spec), recordingLookup().lookup);
}

describe("applyFrame", () => {
  it("creates a grid from a full frame and clears what it does not encode", () => {
    const { grid, result } = apply(null, { rowRecords: [textRow(1, "ab")] });
    expect(result).toBe("applied");
    expect(grid?.cols).toBe(4);
    expect(grid?.rows).toBe(3);
    const g = grid as CellGrid;
    expect(cell(g, 0, 1)).toMatchObject({ slot: 97, fg: FG, bg: BG, ul: FG });
    expect(cell(g, 1, 1).slot).toBe(98);
    for (const [x, y] of [
      [2, 1],
      [3, 1],
      [0, 0],
      [3, 2],
    ]) {
      expect(cell(g, x, y)).toMatchObject({ slot: 0, fg: FG, bg: BG });
    }
  });

  it("resolves explicit colours, inverse and faint", () => {
    const { grid } = apply(null, {
      styles: [
        {},
        { fg: explicit(0x0000ff), bg: explicit(0x00ff00) },
        { fg: explicit(0x0000ff), attrs: ATTR_INVERSE },
        { fg: explicit(0x000000), bg: explicit(0xfefefe), attrs: ATTR_FAINT },
        { attrs: ATTR_INVERSE | ATTR_FAINT },
      ],
      rowRecords: [
        {
          y: 0,
          runs: [
            [1, 1],
            [2, 1],
            [3, 1],
            [4, 1],
          ],
          cells: [65, 66, 67, 68],
        },
      ],
    });
    const g = grid as CellGrid;
    expect(cell(g, 0, 0)).toMatchObject({ fg: 0x0000ff, bg: 0x00ff00 });
    expect(cell(g, 1, 0)).toMatchObject({ fg: BG, bg: 0x0000ff });
    expect(cell(g, 2, 0)).toMatchObject({ fg: 0x7f7f7f, bg: 0xfefefe });
    expect(cell(g, 3, 0)).toMatchObject({ bg: FG, fg: 0x686868 });
  });

  it("uses the resolved foreground for an underline without its own colour", () => {
    const { grid } = apply(null, {
      styles: [
        {},
        { fg: explicit(0x0000ff), attrs: 3 << ATTR_UNDERLINE_SHIFT },
        {
          underlineColor: explicit(0x00aa00),
          attrs: (5 << ATTR_UNDERLINE_SHIFT) | ATTR_STRIKETHROUGH,
        },
        { attrs: ATTR_OVERLINE | (7 << ATTR_UNDERLINE_SHIFT) },
      ],
      rowRecords: [
        {
          y: 0,
          runs: [
            [1, 1],
            [2, 1],
            [3, 1],
          ],
          cells: [65, 0, 67],
        },
      ],
    });
    const g = grid as CellGrid;
    expect(cell(g, 0, 0)).toMatchObject({ underline: 3, ul: 0x0000ff });
    expect(cell(g, 1, 0)).toMatchObject({
      slot: 0,
      underline: 5,
      strike: true,
      ul: 0x00aa00,
    });
    expect(cell(g, 2, 0)).toMatchObject({ underline: 1, overline: true });
  });

  it("asks for bold and italic faces and skips invisible glyphs", () => {
    const { lookup, calls } = recordingLookup();
    const { grid } = applyFrame(
      null,
      frame({
        styles: [
          {},
          { attrs: ATTR_BOLD | ATTR_ITALIC },
          {
            attrs:
              ATTR_INVISIBLE | ATTR_STRIKETHROUGH | (1 << ATTR_UNDERLINE_SHIFT),
            bg: explicit(0x00ff00),
          },
        ],
        rowRecords: [
          {
            y: 0,
            runs: [
              [1, 1],
              [2, 1],
            ],
            cells: [65, 66],
          },
        ],
      }),
      lookup,
    );
    expect(calls).toEqual([
      { cp: 65, font: FONT_BOLD | FONT_ITALIC, wide: false },
    ]);
    expect(cell(grid as CellGrid, 1, 0)).toMatchObject({
      slot: 0,
      underline: 0,
      strike: false,
      bg: 0x00ff00,
    });
  });

  it("marks a wide head and skips its spacer tail", () => {
    const { lookup, calls } = recordingLookup();
    const { grid } = applyFrame(
      null,
      frame({
        rowRecords: [
          {
            y: 0,
            runs: [[0, 4]],
            cells: [wide(0x1f600), TAIL, wide(0x4e16), TAIL],
          },
        ],
      }),
      lookup,
    );
    const g = grid as CellGrid;
    expect(cell(g, 0, 0)).toMatchObject({ slot: 900, wide: true, color: true });
    expect(cell(g, 1, 0)).toMatchObject({ slot: 0, skip: true });
    expect(cell(g, 2, 0)).toMatchObject({ slot: 0x4e16, wide: true });
    expect(cell(g, 3, 0).skip).toBe(true);
    expect(calls.map((c) => c.wide)).toEqual([true, true]);
  });

  it("replaces codepoints that cannot be drawn", () => {
    const { lookup, calls } = recordingLookup();
    applyFrame(
      null,
      frame({
        rowRecords: [{ y: 0, runs: [[0, 2]], cells: [0xd800, 0x1fffff] }],
      }),
      lookup,
    );
    expect(calls.map((c) => c.cp)).toEqual([0xfffd, 0xfffd]);
  });

  it("leaves rows a partial frame does not mention untouched", () => {
    const first = apply(null, {
      rowRecords: [textRow(0, "aaaa"), textRow(1, "bbbb"), textRow(2, "cccc")],
    });
    const before = (first.grid as CellGrid).cells.slice();
    const second = apply(first.grid, {
      flags: 0,
      rowRecords: [textRow(1, "x")],
    });
    expect(second.result).toBe("applied");
    expect(second.grid).toBe(first.grid);
    const g = second.grid as CellGrid;
    expect(cell(g, 0, 1).slot).toBe(120);
    expect(cell(g, 1, 1).slot).toBe(0);
    const rowWords = 4 * CELL_WORDS;
    expect(g.cells.slice(0, rowWords)).toEqual(before.slice(0, rowWords));
    expect(g.cells.slice(2 * rowWords)).toEqual(before.slice(2 * rowWords));
  });

  it("refuses a partial frame without a grid or at another size", () => {
    const partial = { flags: 0, rowRecords: [textRow(0, "x")] };
    expect(apply(null, partial)).toEqual({ grid: null, result: "needs-full" });
    const { grid } = apply(null, { rowRecords: [] });
    const resized = apply(grid, { ...partial, cols: 5 });
    expect(resized.result).toBe("needs-full");
    expect(resized.grid).toBe(grid);
  });

  it("replaces the grid on a full frame of another size", () => {
    const { grid } = apply(null, { rowRecords: [textRow(0, "abcd")] });
    const next = apply(grid, {
      cols: 6,
      rows: 2,
      rowRecords: [textRow(1, "z")],
    });
    expect(next.grid).not.toBe(grid);
    const g = next.grid as CellGrid;
    expect(g.cells.length).toBe(6 * 2 * CELL_WORDS);
    expect(cell(g, 0, 0).slot).toBe(0);
    expect(cell(g, 0, 1).slot).toBe(122);
  });

  it("reuses the grid on a full frame of the same size and clears stale rows", () => {
    const { grid } = apply(null, {
      rowRecords: [textRow(0, "abcd"), textRow(2, "efgh")],
    });
    const next = apply(grid, { rowRecords: [textRow(1, "q")] });
    expect(next.grid).toBe(grid);
    const g = next.grid as CellGrid;
    expect(cell(g, 0, 0).slot).toBe(0);
    expect(cell(g, 0, 1).slot).toBe(113);
    expect(cell(g, 0, 2).slot).toBe(0);
  });

  it("clears glyph references but keeps colours and decorations", () => {
    const { grid } = apply(null, {
      styles: [{}, { attrs: 1 << ATTR_UNDERLINE_SHIFT, bg: explicit(0xff) }],
      rowRecords: [{ y: 0, runs: [[1, 3]], cells: [wide(0x4e16), TAIL, 65] }],
    });
    const g = grid as CellGrid;
    clearGlyphs(g);
    expect(cell(g, 0, 0)).toMatchObject({
      slot: 0,
      wide: true,
      underline: 1,
      bg: 0xff,
    });
    expect(cell(g, 1, 0).skip).toBe(true);
    expect(cell(g, 2, 0).slot).toBe(0);
  });
});
