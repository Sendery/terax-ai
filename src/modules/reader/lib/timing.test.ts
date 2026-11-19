import { describe, expect, it } from "vitest";
import { parseDocument } from "./document";
import {
  buildTimeline,
  DEFAULT_MS_PER_CHAR,
  estimateWordTimings,
  formatClock,
  learnedMsPerChar,
  locate,
  segmentWords,
  wordAtTime,
  wordStartMs,
} from "./timing";

describe("estimateWordTimings", () => {
  const doc = parseDocument("Hi, extraordinary world. Done.");
  const words = segmentWords(doc, doc.segments[0]);

  it("keeps words in order inside the clip", () => {
    const t = estimateWordTimings(words, 3000);
    expect(t).toHaveLength(words.length);
    for (let i = 1; i < t.length; i++)
      expect(t[i].startMs).toBeGreaterThanOrEqual(t[i - 1].endMs);
    expect(t[0].startMs).toBeGreaterThan(0);
    expect(t[t.length - 1].endMs).toBeLessThan(3000);
  });

  it("gives longer words more time and leaves a gap after a comma", () => {
    const t = estimateWordTimings(words, 3000);
    const hi = t[0].endMs - t[0].startMs;
    const extra = t[1].endMs - t[1].startMs;
    expect(extra).toBeGreaterThan(hi);
    expect(t[1].startMs).toBeGreaterThan(t[0].endMs);
  });

  it("handles an empty clip", () => {
    expect(estimateWordTimings([], 1000)).toEqual([]);
    expect(estimateWordTimings(words, 0).every((w) => w.startMs === 0)).toBe(
      true,
    );
  });
});

describe("wordAtTime", () => {
  const timings = [
    { index: 4, startMs: 100, endMs: 300 },
    { index: 5, startMs: 400, endMs: 700 },
    { index: 6, startMs: 800, endMs: 900 },
  ];
  it("returns the last word already started", () => {
    expect(wordAtTime(timings, 0)).toBe(4);
    expect(wordAtTime(timings, 350)).toBe(4);
    expect(wordAtTime(timings, 400)).toBe(5);
    expect(wordAtTime(timings, 5000)).toBe(6);
    expect(wordAtTime([], 10)).toBeNull();
  });
  it("finds where a word starts", () => {
    expect(wordStartMs(timings, 5)).toBe(400);
    expect(wordStartMs(timings, 99)).toBe(0);
  });
});

describe("timeline", () => {
  const doc = parseDocument(
    "First sentence goes here. Second sentence is there. Third one ends it.",
  );

  it("estimates unknown clips and learns the rate from known ones", () => {
    expect(learnedMsPerChar(doc, new Map())).toBe(DEFAULT_MS_PER_CHAR);
    const durations = new Map([
      [0, 2500],
      [1, 2500],
    ]);
    const chars = doc.segments[0].text.length + doc.segments[1].text.length;
    expect(learnedMsPerChar(doc, durations)).toBeCloseTo(5000 / chars, 5);
    // Too little audio to learn from keeps the default.
    expect(learnedMsPerChar(doc, new Map([[0, 2500]]))).toBe(
      DEFAULT_MS_PER_CHAR,
    );
  });

  it("places pauses before their segment and locates times", () => {
    const durations = new Map([
      [0, 1000],
      [1, 1000],
      [2, 1000],
    ]);
    const tl = buildTimeline(doc, durations, new Map([[1, 500]]));
    expect(tl.starts).toEqual([0, 1500, 2500]);
    expect(tl.totalMs).toBe(3500);
    expect(locate(tl, 1600)).toEqual({ segment: 1, offsetMs: 100 });
    expect(locate(tl, 99_999)).toEqual({ segment: 2, offsetMs: 1000 });
    expect(locate(tl, -5)).toEqual({ segment: 0, offsetMs: 0 });
  });
});

describe("formatClock", () => {
  it("formats minutes and hours", () => {
    expect(formatClock(134_000)).toBe("02:14");
    expect(formatClock(3_723_000)).toBe("1:02:03");
    expect(formatClock(-1)).toBe("00:00");
  });
});
