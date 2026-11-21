import type { SttDictionaryEntry, SttMode } from "./settings";

/**
 * Deterministic tidy-up for the Light tier: no language model involved.
 * Segments are joined, dictionary terms are put back the way the user writes
 * them, and the writing style is applied.
 */

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** One normalised character run per original character, so a match in the
 *  normalised text maps back to the original. */
function foldChar(ch: string): string {
  return ch
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

function foldPattern(text: string): string {
  return Array.from(text.replace(/\s+/g, " ").trim()).map(foldChar).join("");
}

type Folded = { folded: string; origin: number[] };

function fold(text: string): Folded {
  let folded = "";
  const origin: number[] = [];
  let index = 0;
  for (const ch of text) {
    const f = foldChar(ch);
    for (const unit of f) {
      folded += unit;
      origin.push(index);
    }
    index += ch.length;
  }
  origin.push(index);
  return { folded, origin };
}

function isBoundary(text: string, at: number): boolean {
  if (at < 0 || at >= text.length) return true;
  return !WORD_CHAR.test(text[at]);
}

type Replacement = { pattern: string; written: string };

function replacementsOf(entries: SttDictionaryEntry[]): Replacement[] {
  const out: Replacement[] = [];
  for (const entry of entries) {
    const written = entry.written.trim();
    if (!written) continue;
    if (entry.spoken?.trim()) {
      out.push({ pattern: foldPattern(entry.spoken), written });
    }
    // The term itself, so "kokoro" comes back as "Kokoro".
    out.push({ pattern: foldPattern(written), written });
  }
  // Longest first, so "pi terax" wins over "terax".
  return out
    .filter((r) => r.pattern.length > 0)
    .sort((a, b) => b.pattern.length - a.pattern.length);
}

/**
 * Replaces every whole-phrase occurrence of a term's spoken form or of the
 * term itself, ignoring case and accents, with the term as written.
 */
export function applyDictionary(
  text: string,
  entries: SttDictionaryEntry[],
): string {
  const replacements = replacementsOf(entries);
  if (replacements.length === 0 || text.length === 0) return text;
  const source = text.replace(/[ \t]+/g, " ");
  const { folded, origin } = fold(source);
  type Hit = { start: number; end: number; written: string };
  const hits: Hit[] = [];
  const taken = new Uint8Array(folded.length);
  for (const { pattern, written } of replacements) {
    let from = 0;
    for (;;) {
      const at = folded.indexOf(pattern, from);
      if (at < 0) break;
      from = at + 1;
      const end = at + pattern.length;
      if (!isBoundary(folded, at - 1) || !isBoundary(folded, end)) continue;
      let free = true;
      for (let i = at; i < end; i++) {
        if (taken[i]) {
          free = false;
          break;
        }
      }
      if (!free) continue;
      taken.fill(1, at, end);
      hits.push({ start: origin[at], end: origin[end], written });
    }
  }
  if (hits.length === 0) return source;
  hits.sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const hit of hits) {
    out += source.slice(cursor, hit.start) + hit.written;
    cursor = hit.end;
  }
  return out + source.slice(cursor);
}

/** Collapses whitespace and removes the space ASR output sometimes leaves
 *  before punctuation. */
export function tidySpacing(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?)\]}»”])/g, "$1")
    .replace(/([(¿¡«“[{])\s+/g, "$1")
    .trim();
}

/** Joins segment transcripts in order with single spaces. */
export function joinSegments(parts: readonly string[]): string {
  return tidySpacing(
    parts
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join(" "),
  );
}

function protectedWords(entries: SttDictionaryEntry[]): Set<string> {
  return new Set(entries.map((entry) => entry.written.split(" ")[0]));
}

function firstWord(text: string): string {
  const match = /^[\p{L}\p{N}][\p{L}\p{N}'’-]*/u.exec(text);
  return match ? match[0] : "";
}

function lowerFirst(text: string, keep: Set<string>): string {
  const lead = /^[¿¡«“"'(]*/u.exec(text)?.[0] ?? "";
  const rest = text.slice(lead.length);
  const word = firstWord(rest);
  if (!word) return text;
  // Acronyms, names from the dictionary and "I" keep their capitals.
  const second = word[1];
  if (keep.has(word) || word === "I" || (second && second !== second.toLowerCase())) {
    return text;
  }
  return lead + rest[0].toLowerCase() + rest.slice(1);
}

function capitaliseSentences(text: string): string {
  return text.replace(
    /(^|[.!?…]\s+)([¿¡«“"'(]*)(\p{Ll})/gu,
    (_match, before: string, lead: string, ch: string) =>
      `${before}${lead}${ch.toUpperCase()}`,
  );
}

/** Applies a writing style to text that already went through the dictionary. */
export function applyMode(
  text: string,
  mode: SttMode,
  dictionary: SttDictionaryEntry[] = [],
): string {
  const tidy = tidySpacing(text);
  if (!tidy) return tidy;
  switch (mode) {
    case "minimal":
    case "prompt":
      return tidy;
    case "casual": {
      const lowered = lowerFirst(tidy, protectedWords(dictionary));
      // One final period goes; an ellipsis, "?" and "!" carry meaning and stay.
      return /[^.]\.$/.test(lowered) ? lowered.slice(0, -1) : lowered;
    }
    case "formal": {
      const capitalised = capitaliseSentences(tidy);
      return /[.!?…:;)"'»”]$/.test(capitalised) ? capitalised : `${capitalised}.`;
    }
  }
}

/** What each mode asks the model for. */
export function modeQuery(mode: SttMode): {
  filler: boolean;
  verbatim: boolean;
  digits: boolean;
} {
  return {
    filler: false,
    verbatim: mode === "minimal",
    digits: true,
  };
}

/** The whole pipeline: join, dictionary, style. */
export function finishDictation(
  parts: readonly string[],
  mode: SttMode,
  dictionary: SttDictionaryEntry[],
): string {
  return applyMode(applyDictionary(joinSegments(parts), dictionary), mode, dictionary);
}

export const STT_CONTEXT_MAX_CHARS = 2000;

/**
 * The hotword list the engine is biased towards: the written form of every
 * term, comma separated, without duplicates, cut at a whole term before the
 * cap.
 */
export function dictionaryContext(entries: SttDictionaryEntry[]): string {
  const seen = new Set<string>();
  let out = "";
  for (const entry of entries) {
    const term = entry.written.replace(/\s+/g, " ").trim();
    const key = foldPattern(term);
    if (!term || seen.has(key)) continue;
    const next = out ? `${out}, ${term}` : term;
    if (next.length > STT_CONTEXT_MAX_CHARS) break;
    seen.add(key);
    out = next;
  }
  return out;
}
