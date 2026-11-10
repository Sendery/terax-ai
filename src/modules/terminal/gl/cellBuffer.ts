import {
  ATTR_BOLD,
  ATTR_FAINT,
  ATTR_INVERSE,
  ATTR_INVISIBLE,
  ATTR_ITALIC,
  ATTR_OVERLINE,
  ATTR_STRIKETHROUGH,
  ATTR_UNDERLINE_MASK,
  ATTR_UNDERLINE_SHIFT,
  CELL_CODEPOINT_MASK,
  CELL_SPACER_TAIL,
  CELL_WIDE_HEAD,
  COLOR_EXPLICIT,
  COLOR_MASK,
  createRowView,
  type DecodedFrame,
  readRow,
  styleWordOf,
  UNDERLINE_KIND_MAX,
} from "@/modules/terminal/gl/frameCodec";

/**
 * Instance layout, four u32 per cell:
 *   0  glyph slot (bits 0-23), wide (24), spacer tail (25), colour page (26),
 *      underline kind (27-29), strikethrough (30), overline (31)
 *   1  foreground 0x00BBGGRR, faint and inverse already applied
 *   2  background
 *   3  underline colour
 */
export const CELL_WORDS = 4;

export const GLYPH_SLOT_MASK = 0xffffff;
export const GLYPH_WIDE = 1 << 24;
export const GLYPH_SKIP = 1 << 25;
export const GLYPH_COLOR = 1 << 26;
const UNDERLINE_SHIFT = 27;
const GLYPH_STRIKE = 1 << 30;
const GLYPH_OVERLINE = 0x80000000;
const DECORATION_MASK =
  (0b111 << UNDERLINE_SHIFT) | GLYPH_STRIKE | GLYPH_OVERLINE;

export const FONT_BOLD = 1;
export const FONT_ITALIC = 2;

const REPLACEMENT = 0xfffd;

/**
 * Resolves a codepoint to the glyph bits of an instance: the slot plus
 * `GLYPH_COLOR` when the glyph lives on the colour page. 0 draws nothing.
 */
export type GlyphLookup = (
  codepoint: number,
  font: number,
  wide: boolean,
) => number;

export type CellGrid = {
  cols: number;
  rows: number;
  cells: Uint32Array;
};

export type ApplyResult = "applied" | "needs-full";

function createGrid(cols: number, rows: number): CellGrid {
  return { cols, rows, cells: new Uint32Array(cols * rows * CELL_WORDS) };
}

// fg, bg, underline colour, decoration bits, font bits | invisible << 2
const RESOLVED_WORDS = 5;
let resolved = new Uint32Array(64 * RESOLVED_WORDS);

function halfway(a: number, b: number): number {
  return ((a & 0xfefefe) >>> 1) + ((b & 0xfefefe) >>> 1);
}

function resolveStyles(frame: DecodedFrame): Uint32Array {
  const count = Math.max(frame.styleCount, 1);
  if (resolved.length < count * RESOLVED_WORDS) {
    resolved = new Uint32Array(count * RESOLVED_WORDS * 2);
  }
  const u32 = frame.u32;
  const u16 = frame.u16;
  for (let id = 0; id < count; id++) {
    const out = id * RESOLVED_WORDS;
    if (id >= frame.styleCount) {
      resolved[out] = frame.defaultFg;
      resolved[out + 1] = frame.defaultBg;
      resolved[out + 2] = frame.defaultFg;
      resolved[out + 3] = 0;
      resolved[out + 4] = 0;
      continue;
    }
    const word = styleWordOf(frame, id);
    const fgWord = u32[word];
    const bgWord = u32[word + 1];
    const ulWord = u32[word + 2];
    const attrs = u16[(word + 3) * 2];
    let fg = fgWord & COLOR_EXPLICIT ? fgWord & COLOR_MASK : frame.defaultFg;
    let bg = bgWord & COLOR_EXPLICIT ? bgWord & COLOR_MASK : frame.defaultBg;
    if (attrs & ATTR_INVERSE) {
      const swap = fg;
      fg = bg;
      bg = swap;
    }
    if (attrs & ATTR_FAINT) fg = halfway(fg, bg);
    const underline = ulWord & COLOR_EXPLICIT ? ulWord & COLOR_MASK : fg;
    const invisible = (attrs & ATTR_INVISIBLE) !== 0;
    let kind = (attrs >>> ATTR_UNDERLINE_SHIFT) & ATTR_UNDERLINE_MASK;
    if (kind > UNDERLINE_KIND_MAX) kind = 1;
    let decorations = kind << UNDERLINE_SHIFT;
    if (attrs & ATTR_STRIKETHROUGH) decorations |= GLYPH_STRIKE;
    if (attrs & ATTR_OVERLINE) decorations |= GLYPH_OVERLINE;
    resolved[out] = fg;
    resolved[out + 1] = bg;
    resolved[out + 2] = underline;
    resolved[out + 3] = invisible ? 0 : decorations;
    resolved[out + 4] =
      (attrs & ATTR_BOLD ? FONT_BOLD : 0) |
      (attrs & ATTR_ITALIC ? FONT_ITALIC : 0) |
      (invisible ? 4 : 0);
  }
  return resolved;
}

function sanitize(codepoint: number): number {
  if (codepoint > 0x10ffff) return REPLACEMENT;
  if (codepoint >= 0xd800 && codepoint <= 0xdfff) return REPLACEMENT;
  return codepoint;
}

function fillDefault(
  cells: Uint32Array,
  from: number,
  to: number,
  fg: number,
  bg: number,
): void {
  for (let i = from; i < to; i += CELL_WORDS) {
    cells[i] = 0;
    cells[i + 1] = fg;
    cells[i + 2] = bg;
    cells[i + 3] = fg;
  }
}

/**
 * Writes a decoded frame into a pane's instance buffer and returns the grid
 * to keep (a new one when a full frame changes the size). A partial frame the
 * grid cannot take, before any full frame or at another size, changes nothing
 * and asks for a full frame instead.
 */
export function applyFrame(
  grid: CellGrid | null,
  frame: DecodedFrame,
  glyph: GlyphLookup,
): { grid: CellGrid | null; result: ApplyResult } {
  if (!frame.full) {
    if (!grid || grid.cols !== frame.cols || grid.rows !== frame.rows) {
      return { grid, result: "needs-full" };
    }
  }
  let target = grid;
  if (!target || target.cols !== frame.cols || target.rows !== frame.rows) {
    target = createGrid(frame.cols, frame.rows);
  }
  const { cols, cells } = target;
  const styles = resolveStyles(frame);
  const u16 = frame.u16;
  const u32 = frame.u32;
  const row = createRowView();
  const rowWords = cols * CELL_WORDS;
  let nextUnwritten = 0;

  for (let i = 0; i < frame.rowCount; i++) {
    readRow(frame, i, row);
    if (frame.full && row.y > nextUnwritten) {
      fillDefault(
        cells,
        nextUnwritten * rowWords,
        row.y * rowWords,
        frame.defaultFg,
        frame.defaultBg,
      );
    }
    nextUnwritten = row.y + 1;
    let dst = row.y * rowWords;
    let cell = row.cellsAt;
    for (let r = 0; r < row.runCount; r++) {
      const styleId = u16[row.runsAt + r * 2];
      const len = u16[row.runsAt + r * 2 + 1];
      const s = styleId * RESOLVED_WORDS;
      const fg = styles[s];
      const bg = styles[s + 1];
      const underline = styles[s + 2];
      const decorations = styles[s + 3];
      const font = styles[s + 4] & 3;
      const invisible = (styles[s + 4] & 4) !== 0;
      for (let c = 0; c < len; c++) {
        const value = u32[cell++];
        let bits: number;
        if (value & CELL_SPACER_TAIL) {
          bits = GLYPH_SKIP;
        } else {
          const isWide = (value & CELL_WIDE_HEAD) !== 0;
          const cp = value & CELL_CODEPOINT_MASK;
          bits = cp > 32 && !invisible ? glyph(sanitize(cp), font, isWide) : 0;
          if (isWide) bits |= GLYPH_WIDE;
        }
        cells[dst] = (bits & ~DECORATION_MASK) | decorations;
        cells[dst + 1] = fg;
        cells[dst + 2] = bg;
        cells[dst + 3] = underline;
        dst += CELL_WORDS;
      }
    }
    fillDefault(
      cells,
      dst,
      (row.y + 1) * rowWords,
      frame.defaultFg,
      frame.defaultBg,
    );
  }
  if (frame.full && nextUnwritten < frame.rows) {
    fillDefault(
      cells,
      nextUnwritten * rowWords,
      frame.rows * rowWords,
      frame.defaultFg,
      frame.defaultBg,
    );
  }
  return { grid: target, result: "applied" };
}

/** Drops every glyph reference, keeping colours, for an atlas that was reset. */
export function clearGlyphs(grid: CellGrid): void {
  const cells = grid.cells;
  for (let i = 0; i < cells.length; i += CELL_WORDS) {
    cells[i] &= DECORATION_MASK | GLYPH_WIDE | GLYPH_SKIP;
  }
}
