import { isSilentSegment, type ReaderDocument } from "./document";

export type FlowStep =
  | { type: "finish" }
  /** Halt before this segment: a stop cut, or a bookmark in study mode. */
  | { type: "stop"; segment: number }
  /** Wait, then play this segment. */
  | { type: "gap"; segment: number; ms: number }
  | { type: "play"; segment: number };

/**
 * What follows when playback reaches segment `next` on its own, as opposed to
 * the user asking for it. Stops and pauses only apply to arriving naturally:
 * pressing play on a stop point reads through it. Silent segments are skipped,
 * but a cut on one still counts.
 */
export function stepInto(
  doc: ReaderDocument,
  next: number,
  stops: ReadonlySet<number>,
  pauses: ReadonlyMap<number, number>,
): FlowStep {
  let ms = 0;
  for (let s = next; s < doc.segments.length; s++) {
    if (stops.has(s))
      return { type: "stop", segment: firstAudible(doc, s) ?? s };
    ms += pauses.get(s) ?? 0;
    if (isSilentSegment(doc.segments[s])) continue;
    return ms > 0
      ? { type: "gap", segment: s, ms }
      : { type: "play", segment: s };
  }
  return { type: "finish" };
}

/** The first segment from `from` that has something to say. */
export function firstAudible(doc: ReaderDocument, from: number): number | null {
  for (let s = Math.max(0, from); s < doc.segments.length; s++) {
    if (!isSilentSegment(doc.segments[s])) return s;
  }
  return null;
}

/** The segment `delta` audible segments away from `from`, clamped. */
export function stepSegment(
  doc: ReaderDocument,
  from: number,
  delta: number,
): number {
  const audible = doc.segments
    .filter((s) => !isSilentSegment(s))
    .map((s) => s.index);
  if (audible.length === 0) return 0;
  let at = audible.findIndex((s) => s >= from);
  if (at === -1) at = audible.length - 1;
  if (delta < 0 && audible[at] > from) at -= 1;
  const target = Math.min(audible.length - 1, Math.max(0, at + delta));
  return audible[target];
}

/**
 * The clips an export concatenates: audible segments in order, with the
 * scripted pauses that precede the next one folded into the gap after each,
 * and chapter titles where a heading or a bookmark starts.
 */
export function exportPlan(
  doc: ReaderDocument,
  pauses: ReadonlyMap<number, number>,
  chapterAt: ReadonlyMap<number, string>,
): { segment: number; pauseAfterMs: number; chapter?: string }[] {
  const out: { segment: number; pauseAfterMs: number; chapter?: string }[] = [];
  let pendingChapter: string | undefined;
  for (const segment of doc.segments) {
    const pause = pauses.get(segment.index) ?? 0;
    if (pause > 0 && out.length > 0) out[out.length - 1].pauseAfterMs += pause;
    const chapter = chapterAt.get(segment.index);
    if (chapter) pendingChapter = chapter;
    if (isSilentSegment(segment)) continue;
    out.push({
      segment: segment.index,
      pauseAfterMs: 0,
      ...(pendingChapter ? { chapter: pendingChapter } : {}),
    });
    pendingChapter = undefined;
  }
  return out;
}

/** How an export is cut into files. */
export const EXPORT_SPLITS = [
  "none",
  "heading",
  "paragraph",
  "sentence",
] as const;
export type ExportSplit = (typeof EXPORT_SPLITS)[number];

export type FragmentStep = { segment: number; pauseAfterMs: number };
export type Fragment = { title: string; steps: FragmentStep[] };

const FRAGMENT_TITLE_WORDS = 8;

function wordsOf(doc: ReaderDocument, from: number, to: number): string {
  return doc.words
    .slice(from, to)
    .filter((w) => w.spoken)
    .map((w) => w.text)
    .join(" ");
}

function shortTitle(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  const head = words.slice(0, FRAGMENT_TITLE_WORDS).join(" ");
  return words.length > FRAGMENT_TITLE_WORDS ? `${head}...` : head;
}

/**
 * Cuts a reading into fragments, each one audio file:
 *
 * - "heading": a section per heading, plus whatever comes before the first;
 * - "paragraph": a fragment per paragraph, list item, quote or table row,
 *   with a heading joined to the block that follows it;
 * - "sentence": a fragment per segment, the unit the audio is made in.
 *
 * Scripted pauses stay inside a fragment; the one after its last segment is
 * dropped, since the gap between two files is the player's business.
 */
export function fragmentPlan(
  doc: ReaderDocument,
  split: Exclude<ExportSplit, "none">,
  pauses: ReadonlyMap<number, number>,
): Fragment[] {
  // For "paragraph", the block each block's audio belongs to: headings join
  // the next block with something to say, or stand alone at the very end.
  const owner = new Map<number, number>();
  let waiting: number[] = [];
  for (const block of doc.blocks) {
    if (block.segmentEnd <= block.segmentStart) continue;
    if (block.kind === "heading") {
      waiting.push(block.index);
      continue;
    }
    for (const heading of waiting) owner.set(heading, block.index);
    waiting = [];
    owner.set(block.index, block.index);
  }
  for (const heading of waiting) owner.set(heading, heading);

  const out: Fragment[] = [];
  let currentKey: number | null = null;
  let section = 0;
  let lastBlock = -1;
  for (const step of exportPlan(doc, pauses, new Map())) {
    const segment = doc.segments[step.segment];
    const block = doc.blocks[segment.block];
    if (
      split === "heading" &&
      block.kind === "heading" &&
      block.index !== lastBlock
    )
      section++;
    lastBlock = block.index;
    const key =
      split === "sentence"
        ? segment.index
        : split === "heading"
          ? section
          : (owner.get(block.index) ?? block.index);
    if (key !== currentKey) {
      out.push({ title: "", steps: [] });
      currentKey = key;
    }
    out[out.length - 1].steps.push({
      segment: step.segment,
      pauseAfterMs: step.pauseAfterMs,
    });
  }
  for (const fragment of out) {
    const last = fragment.steps[fragment.steps.length - 1];
    if (last) last.pauseAfterMs = 0;
    const first = doc.segments[fragment.steps[0].segment];
    const firstBlock = doc.blocks[first.block];
    fragment.title =
      split !== "sentence" && firstBlock.kind === "heading"
        ? wordsOf(doc, firstBlock.wordStart, firstBlock.wordEnd)
        : shortTitle(first.text);
  }
  return out;
}
