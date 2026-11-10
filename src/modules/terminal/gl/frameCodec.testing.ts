import {
  ATTR_UNDERLINE_MASK,
  ATTR_UNDERLINE_SHIFT,
  CELL_CODEPOINT_MASK,
  CELL_SPACER_TAIL,
  CELL_WIDE_HEAD,
  COLOR_EXPLICIT,
  COLOR_MASK,
  CURSOR_COLOR_NONE,
  createRowView,
  type DecodedFrame,
  FRAME_FLAG_CURSOR_BLINK,
  FRAME_FLAG_FULL,
  FRAME_FLAG_SCROLLED_BACK,
  FRAME_MAGIC,
  HEADER_BYTES,
  ROW_FLAG_WRAPPED,
  ROW_PROMPT_MASK,
  ROW_PROMPT_SHIFT,
  readRow,
  STYLE_BYTES,
  styleWordOf,
} from "@/modules/terminal/gl/frameCodec";

// Test-only counterpart of the Rust encoder (`engine/frame.rs`). Imported by
// tests alone, so it never reaches a bundle.

type StyleSpec = {
  fg?: number;
  bg?: number;
  underlineColor?: number;
  attrs?: number;
};

export type RowSpec = {
  y: number;
  flags?: number;
  runs: [styleId: number, len: number][];
  cells: number[];
};

export type FrameSpec = {
  seq?: number;
  cols: number;
  rows: number;
  cursorX?: number;
  cursorY?: number;
  cursorStyle?: number;
  flags?: number;
  defaultFg?: number;
  defaultBg?: number;
  cursorColor?: number;
  styles?: StyleSpec[];
  rowRecords: RowSpec[];
};

export function explicit(color: number): number {
  return (color & COLOR_MASK) | COLOR_EXPLICIT;
}

export function wide(codepoint: number): number {
  return (codepoint | CELL_WIDE_HEAD) >>> 0;
}

export const TAIL = CELL_SPACER_TAIL;

/** One row from text: one run in `styleId`, wide characters as head + tail. */
export function textRow(y: number, text: string, styleId = 0): RowSpec {
  const cells: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x1100 && isWideForTests(cp)) {
      cells.push(wide(cp), TAIL);
    } else {
      cells.push(ch === " " ? 0 : cp);
    }
  }
  return { y, runs: [[styleId, cells.length]], cells };
}

function isWideForTests(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0x1f300 && cp <= 0x1faff)
  );
}

export function encodeFrame(spec: FrameSpec): ArrayBuffer {
  const styles = spec.styles ?? [{}];
  let words = HEADER_BYTES / 4 + styles.length * (STYLE_BYTES / 4);
  for (const row of spec.rowRecords) {
    words += 2 + row.runs.length + row.cells.length;
  }
  const buffer = new ArrayBuffer(words * 4);
  const u32 = new Uint32Array(buffer);
  const u16 = new Uint16Array(buffer);
  u32[0] = FRAME_MAGIC;
  u32[1] = spec.seq ?? 1;
  u16[4] = spec.cols;
  u16[5] = spec.rows;
  u16[6] = spec.cursorX ?? 0;
  u16[7] = spec.cursorY ?? 0;
  u16[8] = ((spec.flags ?? FRAME_FLAG_FULL) << 8) | (spec.cursorStyle ?? 1);
  u16[9] = spec.rowRecords.length;
  u32[5] = spec.defaultFg ?? 0xcccccc;
  u32[6] = spec.defaultBg ?? 0x111111;
  u32[7] = spec.cursorColor ?? CURSOR_COLOR_NONE;
  u16[16] = styles.length;
  let word = HEADER_BYTES / 4;
  for (const style of styles) {
    u32[word] = style.fg ?? 0;
    u32[word + 1] = style.bg ?? 0;
    u32[word + 2] = style.underlineColor ?? 0;
    u16[(word + 3) * 2] = style.attrs ?? 0;
    word += STYLE_BYTES / 4;
  }
  for (const row of spec.rowRecords) {
    u16[word * 2] = row.y;
    u16[word * 2 + 1] = row.runs.length;
    u16[word * 2 + 2] = row.cells.length;
    u16[word * 2 + 3] = row.flags ?? 0;
    word += 2;
    for (const [styleId, len] of row.runs) {
      u16[word * 2] = styleId;
      u16[word * 2 + 1] = len;
      word += 1;
    }
    for (const cell of row.cells) {
      u32[word] = cell;
      word += 1;
    }
  }
  return buffer;
}

const CURSOR_STYLE_NAMES = [
  "hidden",
  "block",
  "bar",
  "underline",
  "hollow_block",
];
const ATTR_NAMES = [
  "bold",
  "italic",
  "faint",
  "inverse",
  "invisible",
  "strikethrough",
  "overline",
  "blink",
];
const UNDERLINE_NAMES = [
  "none",
  "single",
  "double",
  "curly",
  "dotted",
  "dashed",
];
const PROMPT_NAMES = ["none", "prompt", "continuation", "unknown"];

function hex(color: number): string {
  const r = color & 0xff;
  const g = (color >>> 8) & 0xff;
  const b = (color >>> 16) & 0xff;
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function explicitHex(word: number): string | null {
  return word & COLOR_EXPLICIT ? hex(word & COLOR_MASK) : null;
}

/**
 * The fixture description from `docs/architecture/terminal-engine.md`. The
 * contract's example names both the grid height and the row list `rows`; the
 * Rust fixtures resolve that as `viewportRows` and add `viewportScrolled`.
 */
export function describeFrame(frame: DecodedFrame) {
  const row = createRowView();
  const rows = [];
  for (let i = 0; i < frame.rowCount; i++) {
    readRow(frame, i, row);
    let text = "";
    for (let c = 0; c < row.cellCount; c++) {
      const cell = frame.u32[row.cellsAt + c];
      if (cell & CELL_SPACER_TAIL) continue;
      const cp = cell & CELL_CODEPOINT_MASK;
      text += cp === 0 ? " " : String.fromCodePoint(cp);
    }
    const runs = [];
    let start = 0;
    for (let r = 0; r < row.runCount; r++) {
      const styleId = frame.u16[row.runsAt + r * 2];
      const len = frame.u16[row.runsAt + r * 2 + 1];
      const word = styleWordOf(frame, styleId);
      const known = styleId < frame.styleCount;
      const attrs = known ? frame.u16[(word + 3) * 2] : 0;
      runs.push({
        start,
        len,
        fg: known ? explicitHex(frame.u32[word]) : null,
        bg: known ? explicitHex(frame.u32[word + 1]) : null,
        underlineColor: known ? explicitHex(frame.u32[word + 2]) : null,
        attrs: ATTR_NAMES.filter((_, bit) => attrs & (1 << bit)),
        underline:
          UNDERLINE_NAMES[
            (attrs >>> ATTR_UNDERLINE_SHIFT) & ATTR_UNDERLINE_MASK
          ] ?? "unknown",
      });
      start += len;
    }
    rows.push({
      y: row.y,
      wrapped: (row.flags & ROW_FLAG_WRAPPED) !== 0,
      prompt: PROMPT_NAMES[(row.flags >>> ROW_PROMPT_SHIFT) & ROW_PROMPT_MASK],
      text: text.replace(/ +$/, ""),
      runs,
    });
  }
  return {
    seq: frame.seq,
    cols: frame.cols,
    viewportRows: frame.rows,
    full: (frame.flags & FRAME_FLAG_FULL) !== 0,
    viewportScrolled: (frame.flags & FRAME_FLAG_SCROLLED_BACK) !== 0,
    cursor: {
      x: frame.cursorX,
      y: frame.cursorY,
      style: CURSOR_STYLE_NAMES[frame.cursorStyle],
      blink: (frame.flags & FRAME_FLAG_CURSOR_BLINK) !== 0,
      color:
        frame.cursorColor === CURSOR_COLOR_NONE
          ? null
          : hex(frame.cursorColor & COLOR_MASK),
    },
    defaultFg: hex(frame.defaultFg),
    defaultBg: hex(frame.defaultBg),
    rows,
  };
}
