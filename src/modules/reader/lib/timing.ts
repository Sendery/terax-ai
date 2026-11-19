import type { ReaderDocument, ReaderSegment, ReaderWord } from "./document";

/**
 * Word timings are estimated, not measured: each segment is one short
 * utterance whose real duration is known once its audio exists, and the time
 * is spread over its words by how long they take to say. Pauses after commas
 * and at the end of a sentence get their share too, so the highlight does not
 * run ahead through a list of short words.
 */

export type WordTiming = { index: number; startMs: number; endMs: number };

/** Silence engines put before the first word, as a share of the clip. */
const LEAD_SHARE = 0.03;
const LEAD_MAX_MS = 180;
/** Silence after the last word. */
const TAIL_SHARE = 0.05;
const TAIL_MAX_MS = 320;

/** Speaking rate used before any audio exists, at 1x. */
export const DEFAULT_MS_PER_CHAR = 62;

function spokenWeight(word: ReaderWord): number {
  if (!word.spoken) return 0;
  const letters = word.text.replace(/[^\p{L}\p{N}]/gu, "").length;
  // Digits read as several syllables each; symbols-only tokens ("->") still
  // take a beat.
  const digits = word.text.replace(/[^\p{N}]/gu, "").length;
  return Math.max(1.5, letters + digits * 1.5) + 1;
}

function pauseWeight(word: ReaderWord): number {
  if (!word.spoken) return 0;
  if (/[.!?…]["'”’)\]»]*$/u.test(word.text)) return 4;
  if (/[,;:]["'”’)\]»]*$/u.test(word.text)) return 2.5;
  // Dashes as escapes: the repo keeps the em dash character out of its source.
  if (/[\u2014\u2013-]$/u.test(word.text)) return 1.5;
  return 0;
}

/** Timings of one segment's words, relative to the start of its clip. */
export function estimateWordTimings(
  words: readonly ReaderWord[],
  durationMs: number,
): WordTiming[] {
  if (words.length === 0) return [];
  const duration = Math.max(0, durationMs);
  const lead = Math.min(LEAD_MAX_MS, duration * LEAD_SHARE);
  const tail = Math.min(TAIL_MAX_MS, duration * TAIL_SHARE);
  const span = Math.max(0, duration - lead - tail);
  const weights = words.map((w, i) => ({
    speak: spokenWeight(w),
    // The last word's trailing pause is the clip's tail.
    rest: i === words.length - 1 ? 0 : pauseWeight(w),
  }));
  const total = weights.reduce((n, w) => n + w.speak + w.rest, 0);
  const unit = total > 0 ? span / total : 0;
  const out: WordTiming[] = [];
  let at = lead;
  for (let i = 0; i < words.length; i++) {
    const start = at;
    const end = start + weights[i].speak * unit;
    out.push({
      index: words[i].index,
      startMs: Math.round(start),
      endMs: Math.round(end),
    });
    at = end + weights[i].rest * unit;
  }
  return out;
}

export function segmentWords(
  doc: ReaderDocument,
  segment: ReaderSegment,
): ReaderWord[] {
  return doc.words.slice(segment.wordStart, segment.wordEnd);
}

/** The word sounding at `ms` into a clip: the last one already started. */
export function wordAtTime(
  timings: readonly WordTiming[],
  ms: number,
): number | null {
  if (timings.length === 0) return null;
  let lo = 0;
  let hi = timings.length - 1;
  if (ms < timings[0].startMs) return timings[0].index;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (timings[mid].startMs <= ms) lo = mid;
    else hi = mid - 1;
  }
  return timings[lo].index;
}

/** Where in its clip a word starts, given the clip's timings. */
export function wordStartMs(
  timings: readonly WordTiming[],
  wordIndex: number,
): number {
  const hit = timings.find((t) => t.index === wordIndex);
  return hit ? hit.startMs : 0;
}

/**
 * Milliseconds per character learned from the clips made so far, so the total
 * time shown before everything is synthesized converges on the real one.
 */
export function learnedMsPerChar(
  doc: ReaderDocument,
  durations: ReadonlyMap<number, number>,
): number {
  let chars = 0;
  let ms = 0;
  for (const [index, duration] of durations) {
    const segment = doc.segments[index];
    if (!segment) continue;
    chars += segment.text.length;
    ms += duration;
  }
  if (chars < 40) return DEFAULT_MS_PER_CHAR;
  return ms / chars;
}

export function segmentDurationMs(
  doc: ReaderDocument,
  durations: ReadonlyMap<number, number>,
  index: number,
  msPerChar: number,
): number {
  const known = durations.get(index);
  if (known !== undefined) return known;
  const segment = doc.segments[index];
  return segment ? Math.round(segment.text.length * msPerChar) : 0;
}

export type Timeline = {
  /** Start of each segment in document time (1x, pauses included). */
  starts: number[];
  totalMs: number;
};

/**
 * Document time at 1x: every clip back to back, plus the scripted pauses that
 * sit before a segment. Unknown clips use the learned speaking rate.
 */
export function buildTimeline(
  doc: ReaderDocument,
  durations: ReadonlyMap<number, number>,
  pauseBeforeSegment: ReadonlyMap<number, number> = new Map(),
): Timeline {
  const rate = learnedMsPerChar(doc, durations);
  const starts: number[] = [];
  let at = 0;
  for (const segment of doc.segments) {
    at += pauseBeforeSegment.get(segment.index) ?? 0;
    starts.push(at);
    at += segmentDurationMs(doc, durations, segment.index, rate);
  }
  return { starts, totalMs: at };
}

/** The segment holding document time `ms`, and how far into it. */
export function locate(
  timeline: Timeline,
  ms: number,
): { segment: number; offsetMs: number } | null {
  const { starts } = timeline;
  if (starts.length === 0) return null;
  const target = Math.max(0, Math.min(ms, timeline.totalMs));
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  return { segment: lo, offsetMs: Math.max(0, target - starts[lo]) };
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
