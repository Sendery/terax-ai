import { describe, expect, it } from "vitest";
import { parseDocument } from "./document";
import { exportPlan, firstAudible, stepInto, stepSegment } from "./flow";

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
