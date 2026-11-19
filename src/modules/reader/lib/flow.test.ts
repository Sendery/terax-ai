import { describe, expect, it } from "vitest";
import { parseDocument } from "./document";
import {
  exportPlan,
  firstAudible,
  fragmentPlan,
  stepInto,
  stepSegment,
} from "./flow";

const doc = parseDocument(
  "First sentence here. https://only.example.com\n\nSecond sentence there. Third sentence ends.",
);
// Segments: 0 "First...", 1 silent URL, 2 "Second...", 3 "Third...".

describe("stepInto", () => {
  it("plays the next audible segment, skipping silent ones", () => {
    expect(stepInto(doc, 1, new Set(), new Map())).toEqual({
      type: "play",
      segment: 2,
    });
  });

  it("waits for scripted pauses, including one on a silent segment", () => {
    expect(
      stepInto(
        doc,
        1,
        new Set(),
        new Map([
          [1, 400],
          [2, 600],
        ]),
      ),
    ).toEqual({
      type: "gap",
      segment: 2,
      ms: 1000,
    });
  });

  it("stops before a stop segment and finishes past the end", () => {
    expect(stepInto(doc, 2, new Set([2]), new Map())).toEqual({
      type: "stop",
      segment: 2,
    });
    expect(stepInto(doc, 4, new Set(), new Map())).toEqual({ type: "finish" });
  });
});

describe("segment stepping", () => {
  it("finds audible segments and steps over silent ones", () => {
    expect(firstAudible(doc, 1)).toBe(2);
    expect(stepSegment(doc, 0, 1)).toBe(2);
    expect(stepSegment(doc, 2, -1)).toBe(0);
    expect(stepSegment(doc, 3, 5)).toBe(3);
    expect(stepSegment(doc, 0, -1)).toBe(0);
  });
});

describe("exportPlan", () => {
  it("folds pauses into the previous clip and carries chapters", () => {
    const plan = exportPlan(
      doc,
      new Map([[2, 1500]]),
      new Map([[1, "Part two"]]),
    );
    expect(plan).toEqual([
      { segment: 0, pauseAfterMs: 1500 },
      { segment: 2, pauseAfterMs: 0, chapter: "Part two" },
      { segment: 3, pauseAfterMs: 0 },
    ]);
  });
});

describe("fragmentPlan", () => {
  const doc = parseDocument(
    "Prologue line before any heading.\n\n# One\n\nFirst paragraph here. Second sentence here.\n\n- An item in a list.\n\n## Two\n\n```\ncode\n```\n\nLast paragraph of the text.",
  );

  it("cuts a section per heading, with the opening before the first", () => {
    const parts = fragmentPlan(doc, "heading", new Map());
    expect(parts.map((p) => p.title)).toEqual([
      "Prologue line before any heading.",
      "One",
      "Two",
    ]);
    expect(parts[1].steps).toHaveLength(4);
  });

  it("joins a heading to the paragraph it introduces", () => {
    const parts = fragmentPlan(doc, "paragraph", new Map());
    expect(parts.map((p) => p.title)).toEqual([
      "Prologue line before any heading.",
      "One",
      "An item in a list.",
      "Two",
    ]);
    expect(parts[1].steps.map((s) => doc.segments[s.segment].text)).toEqual([
      "One",
      "First paragraph here.",
      "Second sentence here.",
    ]);
  });

  it("gives every sentence its own fragment and drops trailing pauses", () => {
    const pauses = new Map([
      [2, 1500],
      [3, 800],
    ]);
    const parts = fragmentPlan(doc, "sentence", pauses);
    expect(parts).toHaveLength(doc.segments.filter((s) => s.text).length);
    expect(parts.every((p) => p.steps.length === 1)).toBe(true);
    expect(parts.every((p) => p.steps[0].pauseAfterMs === 0)).toBe(true);
    const sections = fragmentPlan(doc, "heading", pauses);
    expect(sections[1].steps[0].pauseAfterMs).toBe(1500);
  });
});
