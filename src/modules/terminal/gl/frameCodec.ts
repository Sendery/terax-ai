export const FRAME_MAGIC = 0x31465854;
export const HEADER_BYTES = 36;
export const STYLE_BYTES = 16;
const ROW_HEADER_BYTES = 8;

export const FRAME_FLAG_FULL = 1;
export const FRAME_FLAG_CURSOR_BLINK = 2;
export const FRAME_FLAG_SCROLLED_BACK = 4;
export const FRAME_FLAG_GRAPHEMES = 8;
export const CELL_GRAPHEME = 1 << 29;
export const MAX_GRAPHEME_BYTES = 1024 * 1024;
export const MAX_GRAPHEME_TABLE_BYTES = 8 * 1024 * 1024;
export const MAX_GRAPHEMES = 500 * 500;

export const CURSOR_HIDDEN = 0;
export const CURSOR_BLOCK = 1;
export const CURSOR_BAR = 2;
export const CURSOR_HOLLOW_BLOCK = 4;

export const COLOR_EXPLICIT = 1 << 24;
export const COLOR_MASK = 0xffffff;
export const CURSOR_COLOR_NONE = 0xffffffff;

export const ATTR_BOLD = 1;
export const ATTR_ITALIC = 1 << 1;
export const ATTR_FAINT = 1 << 2;
export const ATTR_INVERSE = 1 << 3;
export const ATTR_INVISIBLE = 1 << 4;
export const ATTR_STRIKETHROUGH = 1 << 5;
export const ATTR_OVERLINE = 1 << 6;
export const ATTR_UNDERLINE_SHIFT = 8;
export const ATTR_UNDERLINE_MASK = 0b111;
export const UNDERLINE_KIND_MAX = 5;

export const CELL_CODEPOINT_MASK = 0x1fffff;
export const CELL_SPACER_TAIL = 1 << 30;
export const CELL_WIDE_HEAD = 0x80000000;

export const ROW_FLAG_WRAPPED = 1;
export const ROW_PROMPT_SHIFT = 1;
export const ROW_PROMPT_MASK = 0b11;

export type FrameErrorCode =
  | "unsupported-platform"
  | "truncated"
  | "misaligned"
  | "bad-magic"
  | "bad-header"
  | "bad-style-table"
  | "bad-row"
  | "bad-graphemes"
  | "trailing-bytes";

export class FrameDecodeError extends Error {
  readonly code: FrameErrorCode;

  constructor(code: FrameErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "FrameDecodeError";
    this.code = code;
  }
}

/**
 * A validated frame. Every field past the header is read lazily through the
 * typed views, which alias the received buffer. Optional grapheme strings are
 * decoded once per unique frame-local entry.
 */
export type DecodedFrame = {
  readonly byteLength: number;
  readonly seq: number;
  readonly cols: number;
  readonly rows: number;
  readonly cursorX: number;
  readonly cursorY: number;
  readonly cursorStyle: number;
  readonly flags: number;
  readonly full: boolean;
  readonly rowCount: number;
  readonly defaultFg: number;
  readonly defaultBg: number;
  readonly cursorColor: number;
  readonly styleCount: number;
  /** u32 index of the first style entry. */
  readonly styleWord: number;
  /** u32 index of each row record, in frame order. */
  readonly rowWords: Uint32Array;
  readonly graphemes: readonly string[];
  readonly u16: Uint16Array;
  readonly u32: Uint32Array;
};

/** A row record, filled in place by `readRow` so iteration allocates nothing. */
export type RowView = {
  y: number;
  runCount: number;
  cellCount: number;
  flags: number;
  /** u16 index of the first `(style_id, len)` pair. */
  runsAt: number;
  /** u32 index of the first cell. */
  cellsAt: number;
};

export function createRowView(): RowView {
  return { y: 0, runCount: 0, cellCount: 0, flags: 0, runsAt: 0, cellsAt: 0 };
}

const EMPTY_GRAPHEMES: readonly string[] = [];
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const IS_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

export function decodeFrame(
  buffer: ArrayBuffer,
  byteOffset = 0,
  byteLength = buffer.byteLength - byteOffset,
): DecodedFrame {
  if (!IS_LITTLE_ENDIAN) {
    throw new FrameDecodeError(
      "unsupported-platform",
      "frame views assume a little-endian host",
    );
  }
  if (
    !Number.isSafeInteger(byteOffset) ||
    !Number.isSafeInteger(byteLength) ||
    byteOffset < 0 ||
    byteLength < 0 ||
    byteOffset > buffer.byteLength ||
    byteLength > buffer.byteLength - byteOffset
  ) {
    throw new FrameDecodeError(
      "truncated",
      "frame region is outside the buffer",
    );
  }
  if (byteOffset % 4 !== 0) {
    throw new FrameDecodeError(
      "misaligned",
      "frame offset is not a multiple of 4",
    );
  }
  const length = byteLength;
  if (length < HEADER_BYTES) {
    throw new FrameDecodeError("truncated", `${length} bytes, header needs 36`);
  }
  if (length % 4 !== 0) {
    throw new FrameDecodeError(
      "misaligned",
      `${length} is not a multiple of 4`,
    );
  }
  const u32 = new Uint32Array(buffer, byteOffset, length / 4);
  const u16 = new Uint16Array(buffer, byteOffset, length / 2);
  if (u32[0] !== FRAME_MAGIC) {
    throw new FrameDecodeError(
      "bad-magic",
      `0x${u32[0].toString(16).padStart(8, "0")}`,
    );
  }
  const seq = u32[1];
  const cols = u16[4];
  const rows = u16[5];
  const cursorX = u16[6];
  const cursorY = u16[7];
  const cursorStyle = u16[8] & 0xff;
  const flags = u16[8] >>> 8;
  const rowCount = u16[9];
  const defaultFg = u32[5] & COLOR_MASK;
  const defaultBg = u32[6] & COLOR_MASK;
  const cursorColor = u32[7];
  const styleCount = u16[16];

  if (cols === 0 || rows === 0) {
    throw new FrameDecodeError("bad-header", `grid ${cols}x${rows}`);
  }
  if (cursorStyle > CURSOR_HOLLOW_BLOCK) {
    throw new FrameDecodeError("bad-header", `cursor style ${cursorStyle}`);
  }
  if (rowCount > rows) {
    throw new FrameDecodeError(
      "bad-header",
      `${rowCount} row records for ${rows} rows`,
    );
  }

  const styleWord = HEADER_BYTES / 4;
  let word = styleWord + styleCount * (STYLE_BYTES / 4);
  const totalWords = length / 4;
  if (word > totalWords) {
    throw new FrameDecodeError(
      "bad-style-table",
      `${styleCount} styles overrun ${length} bytes`,
    );
  }

  const rowWords = new Uint32Array(rowCount);
  let previousY = -1;
  let maxGrapheme = -1;
  for (let i = 0; i < rowCount; i++) {
    if (word + ROW_HEADER_BYTES / 4 > totalWords) {
      throw new FrameDecodeError("truncated", `row ${i} header`);
    }
    const h = word * 2;
    const y = u16[h];
    const runCount = u16[h + 1];
    const cellCount = u16[h + 2];
    if (y >= rows || y <= previousY) {
      throw new FrameDecodeError("bad-row", `row ${i} has y ${y}`);
    }
    if (cellCount > cols) {
      throw new FrameDecodeError(
        "bad-row",
        `row ${y} has ${cellCount} cells for ${cols} columns`,
      );
    }
    const runsWord = word + ROW_HEADER_BYTES / 4;
    const cellsWord = runsWord + runCount;
    const end = cellsWord + cellCount;
    if (end > totalWords) {
      throw new FrameDecodeError("truncated", `row ${y} body`);
    }
    let covered = 0;
    for (let r = 0; r < runCount; r++) {
      const styleId = u16[(runsWord + r) * 2];
      if (styleId >= styleCount && styleId !== 0) {
        throw new FrameDecodeError(
          "bad-row",
          `row ${y} uses style ${styleId} of ${styleCount}`,
        );
      }
      covered += u16[(runsWord + r) * 2 + 1];
    }
    if (covered !== cellCount) {
      throw new FrameDecodeError(
        "bad-row",
        `row ${y} runs cover ${covered} of ${cellCount} cells`,
      );
    }
    for (let cell = cellsWord; cell < end; cell++) {
      const value = u32[cell];
      if (value & CELL_GRAPHEME) {
        if (!(flags & FRAME_FLAG_GRAPHEMES) || value & CELL_SPACER_TAIL)
          throw new FrameDecodeError(
            "bad-graphemes",
            "invalid grapheme cell tag",
          );
        maxGrapheme = Math.max(maxGrapheme, value & CELL_CODEPOINT_MASK);
      }
    }
    rowWords[i] = word;
    previousY = y;
    word = end;
  }
  let graphemes = EMPTY_GRAPHEMES;
  if (flags & FRAME_FLAG_GRAPHEMES) {
    const tableStart = word;
    if (
      word >= totalWords ||
      (totalWords - word) * 4 > MAX_GRAPHEME_TABLE_BYTES
    )
      throw new FrameDecodeError(
        "bad-graphemes",
        "invalid grapheme table extent",
      );
    const count = u32[word++];
    if (
      count < 1 ||
      count > MAX_GRAPHEMES ||
      maxGrapheme < 0 ||
      maxGrapheme >= count ||
      count > (totalWords - word) / 2
    )
      throw new FrameDecodeError(
        "bad-graphemes",
        "invalid grapheme references",
      );
    const decoded: string[] = [];
    const bytes = new Uint8Array(buffer, byteOffset, byteLength);
    for (let index = 0; index < count; index++) {
      if (word >= totalWords)
        throw new FrameDecodeError("bad-graphemes", "missing grapheme length");
      const length = u32[word++];
      const words = Math.ceil(length / 4);
      if (
        length < 2 ||
        length > MAX_GRAPHEME_BYTES ||
        words > totalWords - word
      )
        throw new FrameDecodeError("bad-graphemes", "invalid grapheme length");
      let text: string;
      try {
        text = UTF8.decode(bytes.subarray(word * 4, word * 4 + length));
      } catch {
        throw new FrameDecodeError("bad-graphemes", "invalid grapheme UTF-8");
      }
      if (text.length <= ((text.codePointAt(0) ?? 0) > 0xffff ? 2 : 1))
        throw new FrameDecodeError(
          "bad-graphemes",
          "grapheme must contain multiple scalars",
        );
      for (let pad = length; pad < words * 4; pad++) {
        if (bytes[word * 4 + pad] !== 0)
          throw new FrameDecodeError(
            "bad-graphemes",
            "nonzero grapheme padding",
          );
      }
      decoded.push(text);
      word += words;
    }
    if ((word - tableStart) * 4 > MAX_GRAPHEME_TABLE_BYTES)
      throw new FrameDecodeError(
        "bad-graphemes",
        "grapheme table exceeds its limit",
      );
    graphemes = decoded;
  }
  if (word !== totalWords) {
    throw new FrameDecodeError(
      "trailing-bytes",
      `${(totalWords - word) * 4} bytes after the last row`,
    );
  }

  return {
    byteLength: length,
    seq,
    cols,
    rows,
    cursorX,
    cursorY,
    cursorStyle,
    flags,
    full: (flags & FRAME_FLAG_FULL) !== 0,
    rowCount,
    defaultFg,
    defaultBg,
    cursorColor,
    styleCount,
    styleWord,
    rowWords,
    graphemes,
    u16,
    u32,
  };
}

export function cellGrapheme(
  frame: DecodedFrame,
  value: number,
): string | undefined {
  return frame.flags & FRAME_FLAG_GRAPHEMES && value & CELL_GRAPHEME
    ? frame.graphemes[value & CELL_CODEPOINT_MASK]
    : undefined;
}

export function readRow(
  frame: DecodedFrame,
  index: number,
  out: RowView,
): RowView {
  const word = frame.rowWords[index];
  const h = word * 2;
  const u16 = frame.u16;
  out.y = u16[h];
  out.runCount = u16[h + 1];
  out.cellCount = u16[h + 2];
  out.flags = u16[h + 3];
  out.runsAt = h + ROW_HEADER_BYTES / 2;
  out.cellsAt = word + ROW_HEADER_BYTES / 4 + out.runCount;
  return out;
}

/** u32 index of a style entry: `fg`, `bg`, `underline_color`, then `attrs`. */
export function styleWordOf(frame: DecodedFrame, styleId: number): number {
  return frame.styleWord + styleId * (STYLE_BYTES / 4);
}

export function styleAttrs(frame: DecodedFrame, styleId: number): number {
  if (styleId >= frame.styleCount) return 0;
  return frame.u16[(styleWordOf(frame, styleId) + 3) * 2];
}

/** Sequence number of a buffer that may not decode, for acknowledging it. */
export function peekSeq(buffer: ArrayBuffer): number {
  if (buffer.byteLength < 8) return 0;
  return new DataView(buffer).getUint32(4, true);
}
