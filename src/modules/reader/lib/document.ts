/**
 * Turns a source text (Markdown or plain prose) into what the Reader shows and
 * speaks: blocks for layout, words for highlighting and segments for synthesis.
 *
 * A segment is one sentence, a heading, a list item or a table row, never a
 * whole paragraph. Each one is synthesized on its own, so the highlight only
 * has to spread time across the words of one short utterance, and engines that
 * degrade on long inputs never see one.
 *
 * Every word keeps its offsets into the source, so the manifest can point back
 * at the exact characters and a click maps to a word without re-tokenizing.
 */

export type BlockKind =
  | "heading"
  | "paragraph"
  | "list"
  | "quote"
  | "table-row"
  | "code";

export type ReaderBlock = {
  index: number;
  kind: BlockKind;
  /** Heading level (1-6) for headings, nesting depth for list items. */
  level: number;
  /** Ordered-list marker ("3.") or bullet ("-") for list items. */
  marker?: string;
  /** Raw text of a code block, shown but never spoken. */
  code?: string;
  /** First table row of a table, rendered as a header. */
  header?: boolean;
  /** Word range [wordStart, wordEnd). Empty for code blocks. */
  wordStart: number;
  wordEnd: number;
  /** Segment range [segmentStart, segmentEnd). */
  segmentStart: number;
  segmentEnd: number;
};

export type ReaderWord = {
  index: number;
  /** Visible text, inline Markdown removed. */
  text: string;
  /** Offsets into the source text, end exclusive. */
  charStart: number;
  charEnd: number;
  block: number;
  /** Table cell index within its row, 0 elsewhere. */
  cell: number;
  segment: number;
  /** False for tokens shown but not read, such as bare URLs. */
  spoken: boolean;
};

export type ReaderSegment = {
  index: number;
  block: number;
  wordStart: number;
  wordEnd: number;
  /** What the engine is asked to say. */
  text: string;
  /** Stable cache key derived from `text`. */
  key: string;
};

export type InlineCut = {
  /** The cut sits before this word. */
  wordIndex: number;
  kind: "pause" | "stop";
  pauseMs: number;
};

export type ReaderDocument = {
  blocks: ReaderBlock[];
  words: ReaderWord[];
  segments: ReaderSegment[];
  /** Cuts written into the text as `[pause: 2s]` or `[stop]`. */
  inlineCuts: InlineCut[];
};

/** Longest segment sent to an engine in one request. */
export const MAX_SEGMENT_CHARS = 280;
/** A sentence shorter than this joins the next one in the same block. */
export const MIN_SEGMENT_CHARS = 12;
export const MAX_PAUSE_MS = 60_000;

const ABBREVIATIONS = new Set([
  "e.g.",
  "i.e.",
  "etc.",
  "cf.",
  "vs.",
  "vol.",
  "fig.",
  "no.",
  "approx.",
  "aprox.",
  "dept.",
  "est.",
  "inc.",
  "ltd.",
  "mr.",
  "mrs.",
  "ms.",
  "dr.",
  "prof.",
  "st.",
  "sr.",
  "sra.",
  "srta.",
  "dra.",
  "ud.",
  "uds.",
  "ej.",
  "p.ej.",
  "art.",
  "pag.",
  "pág.",
  "av.",
  "a.m.",
  "p.m.",
  "ph.d.",
  "núm.",
]);

const SENTENCE_END = /[.!?…]+["'”’)\]»]*$/u;
const URL_TOKEN = /^(?:https?:\/\/|www\.)\S+$/i;
const PAUSE_TAG =
  /\[(?:pause|pausa)\s*:?\s*(\d+(?:[.,]\d+)?)\s*(ms|s)?\s*\]|\[(?:stop|parar|alto)\]/giu;

type Line = { text: string; start: number };

function splitLines(source: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (let i = 0; i <= source.length; i++) {
    if (i === source.length || source[i] === "\n") {
      lines.push({ text: source.slice(start, i), start });
      start = i + 1;
    }
  }
  return lines;
}

/** Visible text of a run of source plus, per visible char, its source offset. */
type Visible = { text: string; map: number[] };

/**
 * Strips inline Markdown while remembering where each visible character came
 * from: links and images keep their text, emphasis and code markers vanish.
 */
export function visibleText(raw: string, offset: number): Visible {
  let text = "";
  const map: number[] = [];
  const push = (from: number, to: number) => {
    for (let k = from; k < to; k++) {
      text += raw[k];
      map.push(offset + k);
    }
  };
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    // ![alt](url) and [text](url): keep the bracketed text only.
    if (ch === "[" || (ch === "!" && raw[i + 1] === "[")) {
      const open = ch === "!" ? i + 1 : i;
      const close = raw.indexOf("]", open + 1);
      if (close > open && raw[close + 1] === "(") {
        const end = raw.indexOf(")", close + 2);
        if (end > close) {
          push(open + 1, close);
          i = end + 1;
          continue;
        }
      }
    }
    if (ch === "`") {
      i++;
      continue;
    }
    // Emphasis markers touch the word they wrap; "2 * 3", "~/code" and
    // snake_case keep their characters.
    if (ch === "~" && raw[i + 1] === "~") {
      i += 2;
      continue;
    }
    if (ch === "*" && (isMarkup(raw[i - 1]) || isMarkup(raw[i + 1]))) {
      i++;
      continue;
    }
    if (ch === "_" && !(isWordChar(raw[i - 1]) && isWordChar(raw[i + 1]))) {
      i++;
      continue;
    }
    if (ch === "<") {
      const close = raw.indexOf(">", i + 1);
      if (close > i && /^<\/?[a-zA-Z][^<>]*>$/.test(raw.slice(i, close + 1))) {
        text += " ";
        map.push(offset + i);
        i = close + 1;
        continue;
      }
    }
    push(i, i + 1);
    i++;
  }
  return { text, map };
}

/** A neighbour that makes `*` read as emphasis rather than a lone symbol. */
function isMarkup(ch: string | undefined): boolean {
  return ch !== undefined && ch !== " " && ch !== "\t";
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

type Token = { text: string; charStart: number; charEnd: number };

function tokenize(visible: Visible): Token[] {
  const out: Token[] = [];
  const re = /\S+/gu;
  for (const match of visible.text.matchAll(re)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    out.push({
      text: match[0],
      charStart: visible.map[from],
      charEnd: visible.map[to - 1] + 1,
    });
  }
  return out;
}

type PendingCut = { kind: "pause" | "stop"; pauseMs: number };

/** Removes pause tags from a run, returning the cuts in order of position. */
function extractPauseTags(raw: string): {
  cleaned: string;
  cuts: { at: number; cut: PendingCut }[];
} {
  const cuts: { at: number; cut: PendingCut }[] = [];
  // Replace tags with spaces so offsets of everything else stay put.
  const cleaned = raw.replace(
    PAUSE_TAG,
    (match, amount, unit, index: number) => {
      if (amount === undefined) {
        cuts.push({ at: index, cut: { kind: "stop", pauseMs: 0 } });
      } else {
        const value = Number(String(amount).replace(",", "."));
        const ms = unit === "ms" ? value : value * 1000;
        cuts.push({
          at: index,
          cut: {
            kind: "pause",
            pauseMs: Math.max(0, Math.min(MAX_PAUSE_MS, Math.round(ms))),
          },
        });
      }
      return " ".repeat(match.length);
    },
  );
  return { cleaned, cuts };
}

type RawBlock = {
  kind: BlockKind;
  level: number;
  marker?: string;
  header?: boolean;
  code?: string;
  /** Source runs that make up the block, each tokenized separately. */
  runs: { raw: string; start: number; cell: number }[];
};

const FENCE = /^\s{0,3}(```|~~~)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const HRULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;

function tableCells(
  line: Line,
): { raw: string; start: number; cell: number }[] {
  const out: { raw: string; start: number; cell: number }[] = [];
  const text = line.text;
  const first = text.indexOf("|");
  const last = text.lastIndexOf("|");
  let cellStart = first + 1;
  let cell = 0;
  for (let i = first + 1; i <= last; i++) {
    if (text[i] === "|" && text[i - 1] !== "\\") {
      out.push({
        raw: text.slice(cellStart, i),
        start: line.start + cellStart,
        cell,
      });
      cell++;
      cellStart = i + 1;
    }
  }
  return out;
}

function groupBlocks(source: string): RawBlock[] {
  const lines = splitLines(source);
  const blocks: RawBlock[] = [];
  let paragraph: RawBlock | null = null;
  let tableRows = 0;
  const flush = () => {
    if (paragraph) blocks.push(paragraph);
    paragraph = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE.exec(line.text);
    if (fence) {
      flush();
      tableRows = 0;
      const body: string[] = [];
      let j = i + 1;
      while (
        j < lines.length &&
        !lines[j].text.trimStart().startsWith(fence[1])
      ) {
        body.push(lines[j].text);
        j++;
      }
      blocks.push({ kind: "code", level: 0, code: body.join("\n"), runs: [] });
      i = j;
      continue;
    }
    if (line.text.trim() === "") {
      flush();
      tableRows = 0;
      continue;
    }
    if (TABLE_ROW.test(line.text)) {
      flush();
      if (TABLE_RULE.test(line.text)) continue;
      blocks.push({
        kind: "table-row",
        level: 0,
        header:
          tableRows === 0 &&
          i + 1 < lines.length &&
          TABLE_RULE.test(lines[i + 1].text),
        runs: tableCells(line),
      });
      tableRows++;
      continue;
    }
    tableRows = 0;
    if (HRULE.test(line.text)) {
      flush();
      continue;
    }
    const heading = HEADING.exec(line.text);
    if (heading) {
      flush();
      const body = heading[2];
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        runs: [
          {
            raw: body,
            start: line.start + line.text.indexOf(body, heading[1].length),
            cell: 0,
          },
        ],
      });
      continue;
    }
    const item = LIST_ITEM.exec(line.text);
    if (item) {
      flush();
      const body = item[3];
      blocks.push({
        kind: "list",
        level: Math.floor(item[1].replace(/\t/g, "  ").length / 2),
        marker: /^\d/.test(item[2]) ? item[2] : "-",
        runs: [
          {
            raw: body,
            start: line.start + line.text.length - body.length,
            cell: 0,
          },
        ],
      });
      // A wrapped list item continues on indented lines.
      while (
        i + 1 < lines.length &&
        /^\s{2,}\S/.test(lines[i + 1].text) &&
        !LIST_ITEM.test(lines[i + 1].text)
      ) {
        i++;
        blocks[blocks.length - 1].runs.push({
          raw: lines[i].text,
          start: lines[i].start,
          cell: 0,
        });
      }
      continue;
    }
    const quote = QUOTE.exec(line.text);
    if (quote) {
      const body = quote[1];
      const run = {
        raw: body,
        start: line.start + line.text.length - body.length,
        cell: 0,
      };
      if (paragraph && (paragraph as RawBlock).kind === "quote") {
        (paragraph as RawBlock).runs.push(run);
      } else {
        flush();
        paragraph = { kind: "quote", level: 0, runs: [run] };
      }
      continue;
    }
    const run = { raw: line.text, start: line.start, cell: 0 };
    if (paragraph && (paragraph as RawBlock).kind === "paragraph") {
      (paragraph as RawBlock).runs.push(run);
    } else {
      flush();
      paragraph = { kind: "paragraph", level: 0, runs: [run] };
    }
  }
  flush();
  return blocks;
}

function endsSentence(word: string): boolean {
  if (!SENTENCE_END.test(word)) return false;
  if (!word.endsWith(".")) return true;
  const bare = word.replace(/^[("'“‘¿¡«[]+/u, "").toLowerCase();
  if (ABBREVIATIONS.has(bare)) return false;
  // Initials such as "J." keep the sentence open; "3." in a list does not
  // reach here because list markers are not words.
  return bare.replace(/\./g, "").length > 1;
}

function speechToken(word: ReaderWord): string {
  return word.text;
}

/** Cheap 53-bit string hash, rendered as 14 hex chars. */
export function hashKey(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return value.toString(16).padStart(14, "0");
}

function segmentText(words: readonly ReaderWord[], kind: BlockKind): string {
  let out = "";
  let cell = -1;
  for (const word of words) {
    if (!word.spoken) continue;
    if (
      kind === "table-row" &&
      cell !== -1 &&
      word.cell !== cell &&
      !/[,.;:!?]$/.test(out)
    ) {
      out += ",";
    }
    cell = word.cell;
    out += out ? ` ${speechToken(word)}` : speechToken(word);
  }
  return out;
}

/**
 * Cuts one block's words into segments: sentences, merged when tiny, wrapped
 * when long, and always broken where an explicit cut point sits.
 */
function segmentBlock(
  words: readonly ReaderWord[],
  kind: BlockKind,
  breaks: ReadonlySet<number>,
): [number, number][] {
  if (words.length === 0) return [];
  const ranges: [number, number][] = [];
  let start = 0;
  let chars = 0;
  for (let i = 0; i < words.length; i++) {
    if (i > start && breaks.has(words[i].index)) {
      ranges.push([start, i]);
      start = i;
      chars = 0;
    }
    chars += words[i].text.length + 1;
    const last = i === words.length - 1;
    const wholeBlock = kind === "heading" || kind === "table-row";
    if (last) {
      ranges.push([start, i + 1]);
    } else if (!wholeBlock && endsSentence(words[i].text)) {
      ranges.push([start, i + 1]);
      start = i + 1;
      chars = 0;
    } else if (chars + words[i + 1].text.length > MAX_SEGMENT_CHARS) {
      ranges.push([start, i + 1]);
      start = i + 1;
      chars = 0;
    }
  }
  // Fold tiny sentences ("Sí.", "Ok.") into the next one, unless a cut sits
  // between them or the result would be too long.
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const prevChars = words
        .slice(prev[0], prev[1])
        .reduce((n, w) => n + w.text.length + 1, 0);
      const nextChars = words
        .slice(range[0], range[1])
        .reduce((n, w) => n + w.text.length + 1, 0);
      if (
        prevChars < MIN_SEGMENT_CHARS &&
        !breaks.has(words[range[0]].index) &&
        prevChars + nextChars <= MAX_SEGMENT_CHARS
      ) {
        prev[1] = range[1];
        continue;
      }
    }
    merged.push([range[0], range[1]]);
  }
  return merged;
}

/**
 * Parses a source text. `breakBefore` lists word indexes where a cut point
 * forces a new segment (pauses and stops added in the Reader); cuts written
 * into the text always break.
 */
export function parseDocument(
  source: string,
  breakBefore: Iterable<number> = [],
): ReaderDocument {
  const rawBlocks = groupBlocks(source);
  const blocks: ReaderBlock[] = [];
  const words: ReaderWord[] = [];
  const inlineCuts: InlineCut[] = [];
  const pendingByBlock: { word: number; cut: PendingCut }[] = [];
  let pending: PendingCut | null = null;

  for (const raw of rawBlocks) {
    const blockIndex = blocks.length;
    const wordStart = words.length;
    for (const run of raw.runs) {
      const { cleaned, cuts } = extractPauseTags(run.raw);
      const visible = visibleText(cleaned, run.start);
      const tokens = tokenize(visible);
      let cutCursor = 0;
      for (const token of tokens) {
        while (
          cutCursor < cuts.length &&
          run.start + cuts[cutCursor].at < token.charStart
        ) {
          pending = cuts[cutCursor].cut;
          cutCursor++;
        }
        const index = words.length;
        if (pending) {
          pendingByBlock.push({ word: index, cut: pending });
          pending = null;
        }
        words.push({
          index,
          text: token.text,
          charStart: token.charStart,
          charEnd: token.charEnd,
          block: blockIndex,
          cell: run.cell,
          segment: -1,
          spoken: !URL_TOKEN.test(token.text),
        });
      }
      if (cutCursor < cuts.length) pending = cuts[cuts.length - 1].cut;
    }
    blocks.push({
      index: blockIndex,
      kind: raw.kind,
      level: raw.level,
      ...(raw.marker !== undefined && { marker: raw.marker }),
      ...(raw.code !== undefined && { code: raw.code }),
      ...(raw.header && { header: true }),
      wordStart,
      wordEnd: words.length,
      segmentStart: 0,
      segmentEnd: 0,
    });
  }

  for (const { word, cut } of pendingByBlock) {
    inlineCuts.push({ wordIndex: word, kind: cut.kind, pauseMs: cut.pauseMs });
  }

  const breaks = new Set<number>(breakBefore);
  for (const cut of inlineCuts) breaks.add(cut.wordIndex);

  const segments: ReaderSegment[] = [];
  for (const block of blocks) {
    block.segmentStart = segments.length;
    const blockWords = words.slice(block.wordStart, block.wordEnd);
    for (const [from, to] of segmentBlock(blockWords, block.kind, breaks)) {
      const slice = blockWords.slice(from, to);
      const text = segmentText(slice, block.kind);
      const index = segments.length;
      for (const word of slice) word.segment = index;
      segments.push({
        index,
        block: block.index,
        wordStart: slice[0].index,
        wordEnd: slice[slice.length - 1].index + 1,
        text,
        key: hashKey(text),
      });
    }
    block.segmentEnd = segments.length;
  }

  return { blocks, words, segments, inlineCuts };
}

/** Segments with nothing to say (a row of URLs, say) are skipped, not sent. */
export function isSilentSegment(segment: ReaderSegment): boolean {
  return segment.text.trim().length === 0;
}

/** The first word of the block after the one holding `wordIndex`. */
export function nextBlockWord(
  doc: ReaderDocument,
  wordIndex: number,
  direction: 1 | -1,
): number | null {
  const word = doc.words[wordIndex];
  if (!word) return null;
  let block = word.block + direction;
  // Moving back from the middle of a block lands on its own start first.
  if (direction === -1 && doc.blocks[word.block].wordStart < wordIndex) {
    return doc.blocks[word.block].wordStart;
  }
  while (block >= 0 && block < doc.blocks.length) {
    const candidate = doc.blocks[block];
    if (candidate.wordEnd > candidate.wordStart) return candidate.wordStart;
    block += direction;
  }
  return null;
}
