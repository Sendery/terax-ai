import { isAgentActivePty } from "./agentActivity";

/**
 * Agent TUIs (Claude Code, Codex) wrap paragraphs themselves: every visual
 * line ends in a real newline and continuation lines are indented to the text
 * column. The terminal cannot tell those newlines from real ones, so a copy
 * comes out in the shape of the screen. `rejoinWrappedParagraphs` undoes that
 * wrap from the copied text and the pane width alone.
 *
 * Two lines are joined only when all of these hold:
 *  - both are non-blank and belong to the same paragraph: the second has no
 *    marker of its own and starts at the text column of the paragraph head;
 *  - neither is preformatted: tool output (`⎿`), fenced code, tables and box
 *    drawing, truncated lines (`…`), text indented deeper than its item;
 *  - the first word of the second line would not have fit on the first, so
 *    the break was forced by the width and not written by the author;
 *  - the paragraph has at most one break the width does not explain. An
 *    agent can print a code block at the text indent with no fence, and two
 *    written breaks are how a block of code or a poem shows itself.
 *
 * Every doubt resolves to leaving the text as shown.
 */

/** Slack below the pane width that still counts as the wrap edge: some
 *  Claude Code components (notices, nested boxes) wrap a few columns early. */
const MAX_RIGHT_MARGIN = 10;

/** Heads whose continuation lines are prose wrapped by the program. */
const MESSAGE_MARKERS = new Set(["⏺", "●", "❯", "›", "✦", ">"]);
const LIST_MARKERS = new Set(["-", "*", "+", "•", "◦", "▪", "‣", "·"]);
/** Heads whose body is program output shown as it was printed. */
const OUTPUT_MARKERS = new Set(["⎿", "└", "╰"]);

const BOX_DRAWING = /[\u2500-\u259F]/;
/** Words set apart by a wide gap are columns of a menu or a table. */
const COLUMN_GAP = /\S\s{3,}\S/;
const WORD_START = /^[\p{L}\p{N}\p{P}\p{Z}]/u;
const NUMBERED = /^(\d{1,3}[.)])(\s+|$)/;
/** A line ending like this is code or shell, where a newline is syntax. */
const CODE_LINE_END = /(?:[{};[(\\]|=>|->|&&|\|\|?)$/;
const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}\p{Cc}]$/u;
const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u;

function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1b000 && cp <= 0x1b2ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/** Columns the text takes on the grid: wide CJK and emoji count two. */
export function terminalDisplayWidth(text: string): number {
  // Fast path: printable ASCII is one column per code unit.
  if (/^[\x20-\x7E]*$/.test(text)) return text.length;
  let width = 0;
  let last = 0;
  let joined = false;
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    if (cp === 0x200d) {
      // Zero-width joiner: the next glyph merges into the one before.
      joined = true;
      continue;
    }
    if (cp === 0xfe0f) {
      // Emoji presentation widens a narrow symbol to two columns.
      width += 2 - last;
      last = 2;
      continue;
    }
    if (joined) {
      joined = false;
      continue;
    }
    if (cp >= 0x1f3fb && cp <= 0x1f3ff) continue; // skin tone modifiers
    if (cp < 0x20 || cp === 0x7f || ZERO_WIDTH.test(char)) continue;
    const regional = cp >= 0x1f1e6 && cp <= 0x1f1ff; // two make one flag
    last =
      !regional && (isWideCodePoint(cp) || EMOJI_PRESENTATION.test(char))
        ? 2
        : 1;
    width += last;
  }
  return width;
}

type LineKind =
  | "blank"
  /** Starts a paragraph whose continuation lines may be joined. */
  | "prose"
  /** Kept as shown: output, tables, rules, unknown symbols. */
  | "fixed";

type Line = {
  raw: string;
  kind: LineKind;
  indent: number;
  /** Text after the indent. */
  body: string;
  /** Marker glyph or number, when the line opens an item. */
  marker: string | null;
  /** Column where the text after the marker starts. */
  textCol: number;
  width: number;
  /** Opens program output: deeper lines after it stay as shown. */
  output: boolean;
};

function classify(raw: string): Line {
  const body = raw.trim();
  const indent = raw.length - raw.trimStart().length;
  const line: Line = {
    raw,
    kind: "prose",
    indent,
    body,
    marker: null,
    textCol: indent,
    width: 0,
    output: false,
  };
  if (body === "") {
    line.kind = "blank";
    return line;
  }
  line.width = indent + terminalDisplayWidth(body);
  const first = Array.from(body)[0] ?? "";
  const afterFirst = body.slice(first.length);
  const gap = afterFirst.length - afterFirst.trimStart().length;
  const standsAlone = gap > 0 || afterFirst === "";
  if (BOX_DRAWING.test(body) || body.startsWith("|") || COLUMN_GAP.test(body)) {
    line.kind = "fixed";
    line.output = OUTPUT_MARKERS.has(first) && standsAlone;
    return line;
  }
  if (OUTPUT_MARKERS.has(first) && standsAlone) {
    line.kind = "fixed";
    line.output = true;
    return line;
  }
  if (
    standsAlone &&
    (MESSAGE_MARKERS.has(first) || LIST_MARKERS.has(first)) &&
    afterFirst !== ""
  ) {
    line.marker = first;
    line.textCol = indent + terminalDisplayWidth(first) + gap;
    return line;
  }
  const numbered = NUMBERED.exec(body);
  if (numbered && numbered[2] !== "") {
    line.marker = numbered[1];
    line.textCol = indent + numbered[0].length;
    return line;
  }
  // A leading glyph that is not text (status icons, spinners, check marks)
  // labels a line of the interface, not a paragraph.
  if ((body.codePointAt(0) ?? 0) > 0x7f && !WORD_START.test(body))
    line.kind = "fixed";
  return line;
}

function firstWord(body: string): string {
  const end = body.search(/\s/);
  return end === -1 ? body : body.slice(0, end);
}

/** Text that continues with no space: CJK, or one long token cut at the edge. */
function joinsWithoutSpace(a: Line, b: Line, edge: number): boolean {
  const tail = Array.from(a.body).pop() ?? "";
  if (
    isWideCodePoint(tail.codePointAt(0) ?? 0) &&
    isWideCodePoint(b.body.codePointAt(0) ?? 0)
  )
    return true;
  if (a.width < edge) return false;
  // The row is full. wrap-ansi cuts a token longer than the row wherever the
  // edge falls, so a URL or a path that ends there goes on without a space.
  const text = a.marker ? a.body.slice(a.marker.length).trim() : a.body;
  const token = text.slice(text.search(/\S+$/));
  return token === text || (token.length >= 10 && /[/\\]/.test(token));
}

type Options = {
  /** Columns of the pane when the text was copied. */
  cols: number;
};

/**
 * Rejoins paragraphs an agent TUI wrapped with hard newlines. Returns the
 * input string itself when nothing was joined.
 */
export function rejoinWrappedParagraphs(
  text: string,
  options: Options,
): string {
  const cols = Math.floor(options.cols);
  if (!Number.isFinite(cols) || cols < 20) return text;
  if (!text.includes("\n") || text.includes("\r")) return text;
  const margin = Math.min(MAX_RIGHT_MARGIN, Math.floor(cols / 5));
  const lines = text.split("\n").map(classify);

  // Pass 1: mark every line that may be appended to the one before it.
  // `head[i]` is the index of the paragraph head line `i` continues.
  const head = new Array<number>(lines.length).fill(-1);
  let fenced = false;
  /** Indent of the open output marker; deeper lines are its output. */
  let outputIndent: number | null = null;
  /** Text column of the last paragraph head: deeper markerless text is
   *  indented code or a quote, and stays as shown. */
  let baseCol: number | null = null;
  /** Text column of the message the lines belong to, once one was seen. */
  let messageCol: number | null = null;
  /** Head of the paragraph the previous line belongs to, if joinable. */
  let open: { index: number; cols: number[] } | null = null;
  /** A selection that starts mid-row: the first line's column is unknown. */
  let floatingFirst = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.kind === "blank") {
      open = null;
      continue;
    }
    if (line.body.startsWith("```") || line.body.startsWith("~~~")) {
      fenced = !fenced;
      open = null;
      continue;
    }
    if (fenced) {
      open = null;
      continue;
    }
    if (outputIndent !== null) {
      if (line.indent > outputIndent) {
        open = null;
        continue;
      }
      outputIndent = null;
    }
    if (line.output) {
      outputIndent = line.indent;
      open = null;
      continue;
    }
    if (line.kind === "fixed") {
      open = null;
      continue;
    }
    if (line.marker === null && open?.cols.includes(line.indent)) {
      head[i] = open.index;
      continue;
    }
    if (
      i === 1 &&
      line.marker === null &&
      line.indent > 0 &&
      lines[0].kind === "prose" &&
      lines[0].marker === null &&
      lines[0].indent <= 1 &&
      lines[0].indent < line.indent
    ) {
      // "end of a row\n  next row": the selection began inside row 0. Whole
      // rows of an agent open with a marker or an indent of two or more.
      floatingFirst = true;
      head[1] = 0;
      baseCol = line.indent;
      open = { index: 0, cols: [line.indent] };
      continue;
    }
    if (line.marker !== null) {
      baseCol = line.textCol;
      if (MESSAGE_MARKERS.has(line.marker)) {
        messageCol = line.textCol;
        open = { index: i, cols: [line.textCol] };
      } else {
        // A list renderer may wrap an item under its text, under its marker,
        // or (Claude Code) at the left edge of the message.
        open = { index: i, cols: [line.textCol, line.indent] };
        if (messageCol !== null && messageCol < line.indent)
          open.cols.push(messageCol);
      }
      continue;
    }
    if (baseCol !== null && line.indent > baseCol) {
      open = null;
      continue;
    }
    baseCol = line.indent;
    open = { index: i, cols: [line.indent] };
  }

  // Pass 2: within each paragraph, join the breaks the width forced.
  const out: string[] = [];
  let joined = false;
  for (let start = 0; start < lines.length; ) {
    let end = start + 1;
    while (end < lines.length && head[end] === start) end++;
    const floating = floatingFirst && start === 0;
    // The wrap edge: the pane width less the margin, or the widest row when
    // the paragraph was laid out for a wider pane than this one.
    let edge = cols - margin;
    for (let i = floating ? 1 : start; i < end; i++)
      edge = Math.max(edge, lines[i].width);
    const forced = (i: number, width = lines[i].width): boolean => {
      const body = lines[i].body;
      if (body.endsWith("…") || CODE_LINE_END.test(body)) return false;
      const word = terminalDisplayWidth(firstWord(lines[i + 1].body));
      return width + 1 + word > edge;
    };
    const joins: boolean[] = [];
    let written = 0;
    for (let i = floating ? 1 : start; i < end - 1; i++) {
      joins[i] = forced(i);
      if (!joins[i]) written++;
    }
    // Two breaks the width does not explain: the lines were written that
    // way (code, a poem, an address), so none of them is touched.
    const verbatim = written >= 2;
    if (floating && !verbatim) {
      // Row 0 began at an unknown column at or after the text column. Short
      // of that proof, go by the paragraph it leads into: wrapped again
      // below, or a closing line at the indent agents give message text.
      const atLeast = lines[1].indent + terminalDisplayWidth(lines[0].body);
      joins[0] =
        forced(0, atLeast) ||
        (end > 2
          ? joins[1]
          : lines[1].indent <= 2 && forced(0, Number.POSITIVE_INFINITY));
    }
    out.push(lines[start].raw);
    for (let i = start + 1; i < end; i++) {
      if (!verbatim && joins[i - 1]) {
        const glue = joinsWithoutSpace(lines[i - 1], lines[i], edge) ? "" : " ";
        out[out.length - 1] += glue + lines[i].body;
        joined = true;
      } else {
        out.push(lines[i].raw);
      }
    }
    start = end;
  }
  return joined ? out.join("\n") : text;
}

/**
 * The two texts a context menu offers for a selection: `copied` is what Copy
 * writes, `shown` the selection as it is on screen. They differ only where
 * `copyText` rejoined something. Rejoining runs before the trim because the
 * indent of the first line tells a paragraph head from a selection that
 * starts mid-row.
 */
export function selectionCopyChoices(
  raw: string | null,
  copyText?: (selection: string) => string,
): { shown: string; copied: string } {
  const shown = raw?.trim() ?? "";
  if (!raw || !copyText) return { shown, copied: shown };
  return { shown, copied: copyText(raw).trim() };
}

/** What Copy puts on the clipboard for a selection read from a terminal. */
export function terminalCopyText(
  text: string,
  pane: { ptyId: number | null; cols: number },
): string {
  if (pane.ptyId === null || !isAgentActivePty(pane.ptyId)) return text;
  return rejoinWrappedParagraphs(text, { cols: pane.cols });
}
