import type { TtsLanguage } from "@/modules/tts/lib/engines";
import type { VoiceProfile } from "@/modules/tts/lib/voices";
import { hashKey, MAX_PAUSE_MS, type ReaderDocument } from "./document";
import { estimateWordTimings, segmentWords, type Timeline } from "./timing";

/**
 * The manifest is the script of a reading: where it stopped, the cut points
 * the user placed, and for every segment already synthesized its audio file
 * and word timings. It is plain JSON in the document's folder, so it can be
 * read and edited outside Terax; anything malformed in it is dropped on load
 * rather than trusted.
 */

export const MANIFEST_VERSION = 1;
export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5] as const;
export const MIN_SPEED = 0.75;
export const MAX_SPEED = 2.5;
export const DEFAULT_PAUSE_MS = 1500;
const MAX_LABEL = 120;
const MAX_CUT_POINTS = 2000;
/** Above this many words the manifest keeps segment timings only. */
export const MAX_WORDS_IN_MANIFEST = 40_000;

export type CutKind = "bookmark" | "pause" | "stop";

export type CutPoint = {
  id: string;
  kind: CutKind;
  /** The cut sits before this word. */
  wordIndex: number;
  label: string;
  /** Silence inserted before the word, for pauses. */
  pauseMs: number;
  /** "text" cuts come from `[pause: 2s]` tags and are rebuilt on every load. */
  source: "user" | "text";
};

export type PlaybackStatus = "idle" | "playing" | "paused" | "finished";

export type ReaderState = {
  title: string;
  sourcePath: string | null;
  voiceId: string | null;
  speed: number;
  lastWordIndex: number;
  lastPositionMs: number;
  status: PlaybackStatus;
  cutPoints: CutPoint[];
  /** Study mode: stop at every bookmark instead of reading through. */
  stopAtBookmarks: boolean;
};

export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1;
  return Math.min(
    MAX_SPEED,
    Math.max(MIN_SPEED, Math.round(speed * 100) / 100),
  );
}

export function stepSpeed(speed: number, direction: 1 | -1): number {
  const current = clampSpeed(speed);
  if (direction > 0) return SPEEDS.find((s) => s > current + 1e-6) ?? MAX_SPEED;
  return [...SPEEDS].reverse().find((s) => s < current - 1e-6) ?? MIN_SPEED;
}

export function defaultReaderState(
  title: string,
  sourcePath: string | null,
): ReaderState {
  return {
    title,
    sourcePath,
    voiceId: null,
    speed: 1,
    lastWordIndex: 0,
    lastPositionMs: 0,
    status: "idle",
    cutPoints: [],
    stopAtBookmarks: false,
  };
}

export function voiceKeyOf(voice: VoiceProfile): string {
  const params = Object.entries(voice.params ?? {})
    .filter(([, v]) => typeof v === "number")
    .sort(([a], [b]) => a.localeCompare(b));
  return hashKey(
    JSON.stringify([
      voice.model,
      voice.language,
      voice.voice,
      voice.sampleId,
      params,
    ]),
  );
}

let cutSeq = 0;
export function newCutId(): string {
  cutSeq += 1;
  return `cut_${Date.now().toString(36)}${cutSeq.toString(36)}`;
}

/** Cuts from the text, rebuilt from the parsed document. */
export function textCuts(doc: ReaderDocument): CutPoint[] {
  return doc.inlineCuts.map((cut) => ({
    id: `text_${cut.wordIndex}`,
    kind: cut.kind,
    wordIndex: cut.wordIndex,
    label:
      cut.kind === "stop"
        ? "Stop (text)"
        : `Pause ${formatSeconds(cut.pauseMs)} (text)`,
    pauseMs: cut.pauseMs,
    source: "text",
  }));
}

function formatSeconds(ms: number): string {
  return `${Math.round(ms / 100) / 10}s`;
}

/** User cuts plus the ones written in the text, ordered by position. */
export function allCuts(
  doc: ReaderDocument,
  user: readonly CutPoint[],
): CutPoint[] {
  return [...textCuts(doc), ...user.filter((c) => c.source === "user")].sort(
    (a, b) =>
      a.wordIndex - b.wordIndex || kindOrder(a.kind) - kindOrder(b.kind),
  );
}

function kindOrder(kind: CutKind): number {
  return kind === "bookmark" ? 0 : kind === "pause" ? 1 : 2;
}

/** Word indexes where a user pause or stop forces a segment break. */
export function userBreaks(cuts: readonly CutPoint[]): number[] {
  return cuts
    .filter((c) => c.source === "user" && c.kind !== "bookmark")
    .map((c) => c.wordIndex);
}

/**
 * Adds a cut of `kind` at a word, or removes it when one of that kind is
 * already there. Text cuts are part of the source and are never toggled off.
 */
export function toggleCut(
  cuts: readonly CutPoint[],
  kind: CutKind,
  wordIndex: number,
  label: string,
  pauseMs = DEFAULT_PAUSE_MS,
): CutPoint[] {
  const existing = cuts.find(
    (c) => c.source === "user" && c.kind === kind && c.wordIndex === wordIndex,
  );
  if (existing) return cuts.filter((c) => c !== existing);
  // A pause and a stop at the same word contradict each other.
  const rest =
    kind === "bookmark"
      ? cuts
      : cuts.filter(
          (c) =>
            !(
              c.source === "user" &&
              c.kind !== "bookmark" &&
              c.wordIndex === wordIndex
            ),
        );
  return [
    ...rest,
    {
      id: newCutId(),
      kind,
      wordIndex,
      label: label.slice(0, MAX_LABEL),
      pauseMs: kind === "pause" ? clampPause(pauseMs) : 0,
      source: "user" as const,
    },
  ].sort((a, b) => a.wordIndex - b.wordIndex);
}

export function clampPause(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_PAUSE_MS;
  return Math.max(0, Math.min(MAX_PAUSE_MS, Math.round(ms)));
}

/** The cut after or before `wordIndex`, for `]` and `[`. */
export function adjacentCut(
  cuts: readonly CutPoint[],
  wordIndex: number,
  direction: 1 | -1,
): CutPoint | null {
  const ordered = [...cuts].sort((a, b) => a.wordIndex - b.wordIndex);
  if (direction > 0)
    return ordered.find((c) => c.wordIndex > wordIndex) ?? null;
  return [...ordered].reverse().find((c) => c.wordIndex < wordIndex) ?? null;
}

/** A label for a new bookmark: the first words from where it sits. */
export function labelAt(
  doc: ReaderDocument,
  wordIndex: number,
  words = 6,
): string {
  return doc.words
    .slice(wordIndex, wordIndex + words)
    .map((w) => w.text)
    .join(" ")
    .slice(0, MAX_LABEL);
}

/** Pause before each segment, for the timeline and the export. */
export function pausesBySegment(
  doc: ReaderDocument,
  cuts: readonly CutPoint[],
): Map<number, number> {
  const out = new Map<number, number>();
  for (const cut of cuts) {
    if (cut.kind !== "pause" || cut.pauseMs <= 0) continue;
    const word = doc.words[cut.wordIndex];
    if (!word) continue;
    const segment = doc.segments[word.segment];
    // Only a cut on a segment's first word is a gap between clips.
    if (!segment || segment.wordStart !== cut.wordIndex) continue;
    out.set(segment.index, (out.get(segment.index) ?? 0) + cut.pauseMs);
  }
  return out;
}

/** Segments that start with a stop cut: playback halts before them. */
export function stopsBySegment(
  doc: ReaderDocument,
  cuts: readonly CutPoint[],
  stopAtBookmarks: boolean,
): Set<number> {
  const out = new Set<number>();
  for (const cut of cuts) {
    if (cut.kind === "pause") continue;
    if (cut.kind === "bookmark" && !stopAtBookmarks) continue;
    const word = doc.words[cut.wordIndex];
    if (!word) continue;
    const segment = doc.segments[word.segment];
    if (!segment) continue;
    // A bookmark mid-sentence stops at the start of its sentence.
    out.add(segment.index);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Serialization, in the spec's snake_case shape.

type ManifestWord = {
  index: number;
  text: string;
  char_start: number;
  char_end: number;
  start_ms: number;
  end_ms: number;
};

type ManifestSegment = {
  index: number;
  key: string;
  chunk_file: string;
  text: string;
  start_ms: number;
  end_ms: number;
  words?: ManifestWord[];
};

type ManifestCut = {
  id: string;
  kind: CutKind;
  label: string;
  word_index: number;
  timestamp_ms: number;
  pause_after_ms: number;
  source: "user" | "text";
};

export type ManifestJson = {
  version: number;
  document_id: string;
  title: string;
  source_path: string | null;
  language: TtsLanguage | null;
  word_count: number;
  segment_count: number;
  voice_id: string | null;
  voice_key: string | null;
  stop_at_bookmarks: boolean;
  playback_state: {
    status: PlaybackStatus;
    last_position_ms: number;
    last_word_index: number;
    speed: number;
  };
  cut_points: ManifestCut[];
  segments: ManifestSegment[];
  updated_at: string;
};

export type ManifestInput = {
  id: string;
  doc: ReaderDocument;
  state: ReaderState;
  language: TtsLanguage | null;
  voiceKey: string | null;
  durations: ReadonlyMap<number, number>;
  timeline: Timeline;
  now?: Date;
};

export function buildManifest(input: ManifestInput): ManifestJson {
  const { doc, state, durations, timeline } = input;
  const withWords = doc.words.length <= MAX_WORDS_IN_MANIFEST;
  const segments: ManifestSegment[] = [];
  for (const segment of doc.segments) {
    const duration = durations.get(segment.index);
    if (duration === undefined || !input.voiceKey) continue;
    const start = timeline.starts[segment.index] ?? 0;
    const entry: ManifestSegment = {
      index: segment.index,
      key: segment.key,
      chunk_file: `chunks/${input.voiceKey}/${segment.key}.wav`,
      text: segment.text,
      start_ms: Math.round(start),
      end_ms: Math.round(start + duration),
    };
    if (withWords) {
      entry.words = estimateWordTimings(
        segmentWords(doc, segment),
        duration,
      ).map((t) => {
        const word = doc.words[t.index];
        return {
          index: t.index,
          text: word.text,
          char_start: word.charStart,
          char_end: word.charEnd,
          start_ms: Math.round(start + t.startMs),
          end_ms: Math.round(start + t.endMs),
        };
      });
    }
    segments.push(entry);
  }
  const cuts = allCuts(doc, state.cutPoints);
  return {
    version: MANIFEST_VERSION,
    document_id: input.id,
    title: state.title,
    source_path: state.sourcePath,
    language: input.language,
    word_count: doc.words.length,
    segment_count: doc.segments.length,
    voice_id: state.voiceId,
    voice_key: input.voiceKey,
    stop_at_bookmarks: state.stopAtBookmarks,
    playback_state: {
      status: state.status === "playing" ? "paused" : state.status,
      last_position_ms: Math.round(state.lastPositionMs),
      last_word_index: state.lastWordIndex,
      speed: state.speed,
    },
    cut_points: cuts.map((cut) => {
      const word = doc.words[cut.wordIndex];
      const segment = word ? doc.segments[word.segment] : undefined;
      return {
        id: cut.id,
        kind: cut.kind,
        label: cut.label,
        word_index: cut.wordIndex,
        timestamp_ms: Math.round(
          segment ? (timeline.starts[segment.index] ?? 0) : 0,
        ),
        pause_after_ms: cut.pauseMs,
        source: cut.source,
      };
    }),
    segments,
    updated_at: (input.now ?? new Date()).toISOString(),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, max: number): string | null {
  return typeof value === "string" ? value.slice(0, max) : null;
}

function int(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.round(value);
  return n < min || n > max ? null : n;
}

const CUT_KINDS: readonly CutKind[] = ["bookmark", "pause", "stop"];
const STATUSES: readonly PlaybackStatus[] = [
  "idle",
  "playing",
  "paused",
  "finished",
];

/**
 * Reads the parts of a stored manifest the Reader trusts. Text cuts are not
 * read back: they are rebuilt from the source, which is the authority.
 */
export function parseManifest(
  raw: string | null | undefined,
  wordCount: number,
  fallbackTitle: string,
  fallbackPath: string | null,
): ReaderState {
  const state = defaultReaderState(fallbackTitle, fallbackPath);
  if (!raw) return state;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return state;
  }
  if (!isObject(json)) return state;
  const title = str(json.title, 200);
  if (title?.trim()) state.title = title;
  const path = str(json.source_path, 4096);
  if (path) state.sourcePath = path;
  state.voiceId = str(json.voice_id, 120);
  state.stopAtBookmarks = json.stop_at_bookmarks === true;
  const maxWord = Math.max(0, wordCount - 1);
  if (isObject(json.playback_state)) {
    const p = json.playback_state;
    state.speed = clampSpeed(typeof p.speed === "number" ? p.speed : 1);
    state.lastWordIndex = int(p.last_word_index, 0, maxWord) ?? 0;
    state.lastPositionMs =
      int(p.last_position_ms, 0, Number.MAX_SAFE_INTEGER) ?? 0;
    const status = p.status;
    if (
      typeof status === "string" &&
      (STATUSES as readonly string[]).includes(status)
    ) {
      state.status =
        status === "playing" ? "paused" : (status as PlaybackStatus);
    }
  }
  if (Array.isArray(json.cut_points)) {
    const seen = new Set<string>();
    for (const entry of json.cut_points.slice(0, MAX_CUT_POINTS)) {
      if (!isObject(entry) || entry.source === "text") continue;
      const kind = entry.kind;
      if (
        typeof kind !== "string" ||
        !(CUT_KINDS as readonly string[]).includes(kind)
      )
        continue;
      const wordIndex = int(entry.word_index, 0, maxWord);
      if (wordIndex === null) continue;
      const id = str(entry.id, 64) ?? newCutId();
      if (seen.has(id)) continue;
      seen.add(id);
      state.cutPoints.push({
        id,
        kind: kind as CutKind,
        wordIndex,
        label: str(entry.label, MAX_LABEL) ?? "",
        pauseMs:
          kind === "pause" ? clampPause(Number(entry.pause_after_ms)) : 0,
        source: "user",
      });
    }
    state.cutPoints.sort((a, b) => a.wordIndex - b.wordIndex);
  }
  return state;
}

// ---------------------------------------------------------------------------

const SPANISH_HINTS = new Set([
  "el",
  "la",
  "los",
  "las",
  "de",
  "que",
  "y",
  "en",
  "un",
  "una",
  "por",
  "con",
  "para",
  "es",
  "del",
  "se",
  "lo",
  "como",
  "más",
  "pero",
  "su",
  "al",
  "este",
  "esta",
  "también",
  "porque",
  "muy",
  "sin",
  "sobre",
  "entre",
  "cuando",
]);
const ENGLISH_HINTS = new Set([
  "the",
  "and",
  "of",
  "to",
  "in",
  "is",
  "that",
  "it",
  "for",
  "with",
  "as",
  "was",
  "on",
  "are",
  "this",
  "be",
  "by",
  "from",
  "or",
  "an",
  "have",
  "not",
  "but",
  "which",
  "you",
  "they",
  "we",
  "can",
  "will",
  "their",
  "there",
]);

/** A cheap guess from stop words, enough to pick a default voice. */
export function guessLanguage(doc: ReaderDocument): TtsLanguage | null {
  let es = 0;
  let en = 0;
  for (const word of doc.words.slice(0, 4000)) {
    const bare = word.text.toLowerCase().replace(/[^\p{L}]/gu, "");
    if (SPANISH_HINTS.has(bare)) es++;
    if (ENGLISH_HINTS.has(bare)) en++;
    if (/[ñáéíóú¿¡]/u.test(word.text.toLowerCase())) es += 0.5;
  }
  if (es + en < 3) return null;
  return es >= en ? "es-ES" : "en-US";
}
