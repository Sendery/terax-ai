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
