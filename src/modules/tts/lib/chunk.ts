export type SplitOptions = {
  /** Target size of one chunk, so the first audio starts early. */
  maxChars?: number;
  /** Hard cap on the text that gets spoken at all. */
  maxTotal?: number;
};

export type SplitResult = {
  chunks: string[];
  /** True when the text was longer than `maxTotal` and got cut. */
  truncated: boolean;
};

export const DEFAULT_MAX_CHARS = 400;
export const DEFAULT_MAX_TOTAL = 8192;
const MIN_CHUNK_CHARS = 24;

// OSC first: its payload can contain anything, including bytes that would
// otherwise read as a CSI sequence.
const ESC = "\\u001B";
const OSC = new RegExp(`${ESC}\\][\\s\\S]*?(?:\\u0007|${ESC}\\\\|\\u009C)`, "g");
const DCS = new RegExp(`${ESC}P[\\s\\S]*?(?:${ESC}\\\\|\\u009C)`, "g");
const CSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g");
const ESC_TWO_CHAR = new RegExp(`${ESC}[ -~]`, "g");
const ESC_LONE = new RegExp(ESC, "g");
// Everything but tab and newline; CR is normalized before this runs.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const SENTENCE_PUNCT = new Set([".", "!", "?", ";", ":"]);
const CLOSERS = new Set(['"', "'", "”", "’", ")", "]", "}", "»"]);

/** Lower-cased, dots included: abbreviations that must not end a sentence. */
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
]);

export function stripTerminalNoise(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(OSC, "")
    .replace(DCS, "")
    .replace(CSI, "")
    .replace(ESC_TWO_CHAR, "")
    .replace(ESC_LONE, "")
    .replace(CONTROL, "");
}

export function collapseWhitespace(text: string): string {
  return text
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n[ \n]*/g, "\n")
    .trim();
}

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || ch === " " || ch === "\n";
}

/** Reads the word ending at `end` (inclusive), letters and dots only. */
function trailingToken(text: string, end: number): string {
  let start = end;
  while (start >= 0 && /[\p{L}.]/u.test(text[start])) start--;
  return text.slice(start + 1, end + 1);
}

function endsAbbreviation(text: string, dotIndex: number): boolean {
  const token = trailingToken(text, dotIndex).toLowerCase();
  if (token.length === 0) return false;
  if (ABBREVIATIONS.has(token)) return true;
  // Initials such as "J. Smith" keep the sentence open.
  return token.replace(/\./g, "").length === 1;
}

/**
 * Splits on sentence punctuation and newlines. A mark only closes a sentence
 * when whitespace follows it, which is what keeps `main.ts`, `3.14` and
 * `http://host` intact; abbreviations are checked separately.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") {
      const piece = text.slice(start, i).trim();
      if (piece) out.push(piece);
      start = i + 1;
      continue;
    }
    if (!SENTENCE_PUNCT.has(ch)) continue;
    let end = i + 1;
    while (
      end < text.length &&
      (SENTENCE_PUNCT.has(text[end]) || CLOSERS.has(text[end]))
    ) {
      end++;
    }
    if (!isSpace(text[end])) continue;
    if (ch === "." && endsAbbreviation(text, i)) continue;
    const piece = text.slice(start, end).trim();
    if (piece) out.push(piece);
    start = end;
    i = end - 1;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

function mergeTiny(pieces: readonly string[], maxChars: number): string[] {
  const out: string[] = [];
  for (const piece of pieces) {
    const last = out[out.length - 1];
    if (
      last !== undefined &&
      piece.length < MIN_CHUNK_CHARS &&
      last.length + 1 + piece.length <= maxChars
    ) {
      out[out.length - 1] = `${last} ${piece}`;
      continue;
    }
    out.push(piece);
  }
  return out;
}

function wrapLong(piece: string, maxChars: number): string[] {
  if (piece.length <= maxChars) return [piece];
  const out: string[] = [];
  let current = "";
  for (const word of piece.split(" ")) {
    if (word.length > maxChars) {
      if (current) {
        out.push(current);
        current = "";
      }
      for (let i = 0; i < word.length; i += maxChars) {
        out.push(word.slice(i, i + maxChars));
      }
      continue;
    }
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current = `${current} ${word}`;
    } else {
      out.push(current);
      current = word;
    }
  }
  if (current) out.push(current);
  return out;
}

function capTotal(
  text: string,
  maxTotal: number,
): { text: string; truncated: boolean } {
  if (text.length <= maxTotal) return { text, truncated: false };
  const cut = text.slice(0, maxTotal);
  const boundary = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("\n"));
  const kept = boundary > maxTotal - 120 ? cut.slice(0, boundary) : cut;
  return { text: kept.trim(), truncated: true };
}

export function splitForSpeech(
  text: string,
  options: SplitOptions = {},
): SplitResult {
  const maxTotal = Math.max(1, options.maxTotal ?? DEFAULT_MAX_TOTAL);
  const maxChars = Math.min(
    Math.max(40, options.maxChars ?? DEFAULT_MAX_CHARS),
    maxTotal,
  );
  const cleaned = collapseWhitespace(stripTerminalNoise(text));
  const { text: capped, truncated } = capTotal(cleaned, maxTotal);
  if (capped.length === 0) return { chunks: [], truncated };
  const merged = mergeTiny(splitSentences(capped), maxChars);
  const chunks = merged.flatMap((piece) => wrapLong(piece, maxChars));
  return { chunks: chunks.filter((c) => c.length > 0), truncated };
}
