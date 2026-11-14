import { describe, expect, it } from "vitest";
import {
  FrameTimeline,
  summarizeConcurrentTimelines,
} from "@/terminal-lab/lib/frameTimeline";

function record(timeline: FrameTimeline, seq: number, at: number) {
  timeline.received(seq, 100, at);
  timeline.drawn(seq, at);
  timeline.credited(seq, at);
}

function paced(session: number, step: number) {
  const timeline = new FrameTimeline(session);
  for (let at = 0, seq = 1; at <= 6250; at += step, seq++) {
    record(timeline, seq, at);
  }
  return timeline;
}

describe("frame timeline", () => {
  it("requires final received bytes and final draw, without requiring an exit credit", () => {
    const timeline = new FrameTimeline("pane");
    timeline.received(1, 100, 0);
    expect(timeline.completeness({ frames: 1, frameBytes: 100 }).complete).toBe(
      false,
    );
    timeline.drawn(1, 1);
    expect(timeline.completeness({ frames: 1, frameBytes: 100 }).complete).toBe(
      true,
    );
    expect(timeline.completeness({ frames: 2, frameBytes: 100 }).complete).toBe(
      false,
    );
    expect(timeline.completeness({ frames: 1, frameBytes: 101 }).complete).toBe(
      false,
    );
  });

  it("retains coalesced arrivals but counts only the latest frame as drawn", () => {
    const timeline = new FrameTimeline(1);
    timeline.received(1, 100, 0);
    timeline.received(2, 200, 1);
    timeline.drawn(2, 2);
    timeline.credited(1, 2);
    timeline.credited(2, 2);
    const report = JSON.parse(JSON.stringify(timeline));
    expect(report.frames).toEqual([
      { seq: 1, bytes: 100, receivedAt: 0, drawnAt: null, creditedAt: 2 },
      { seq: 2, bytes: 200, receivedAt: 1, drawnAt: 2, creditedAt: 2 },
    ]);
    expect(report.events).toHaveLength(5);
    expect(report.errors).toEqual([]);
    expect(timeline.completeness({ frames: 2, frameBytes: 300 }).complete).toBe(
      true,
    );
  });

  it("reports duplicate, unknown and invalid order events without inflating counts", () => {
    const timeline = new FrameTimeline(1);
    timeline.drawn(1, 0);
    timeline.received(1, 100, 1);
    timeline.received(1, 100, 2);
    timeline.credited(1, 3);
    timeline.received(2, 100, 4);
    timeline.drawn(1, 5);
    timeline.drawn(2, 6);
    timeline.drawn(2, 7);
    timeline.credited(2, 8);
    timeline.credited(2, 9);
    timeline.received(3, 100, 8);
    const report = timeline.toJSON();
    expect(report.errors).toHaveLength(7);
    expect(report.events).toHaveLength(11);
    expect(report.frames).toHaveLength(2);
    expect(timeline.completeness({ frames: 2, frameBytes: 200 }).complete).toBe(
      false,
    );
  });

  it("rejects missing sequences and nonfinite or negative event values", () => {
    const timeline = new FrameTimeline(1);
    timeline.received(2, 100, 0);
    timeline.received(1, -1, 0);
    timeline.received(1, 100, Number.NaN);
    timeline.received(1, 100, -1);
    expect(timeline.toJSON().errors).toHaveLength(4);
    expect(timeline.toJSON().frames).toEqual([]);
  });

  it("cannot mark an empty stream complete", () => {
    expect(
      new FrameTimeline(1).completeness({ frames: 0, frameBytes: 0 }).complete,
    ).toBe(false);
  });
});

describe("concurrent frame timelines", () => {
  it("uses a shared window and the slowest pane, not the average", () => {
    const result = summarizeConcurrentTimelines([paced(1, 125), paced(2, 250)]);
    expect(result.window).toEqual({
      startAt: 250,
      endAt: 6250,
      durationMs: 6000,
    });
    expect(result.warmupMs).toBe(250);
    expect(result.minimumDurationMs).toBe(5000);
    expect(result.evaluable).toBe(true);
    expect(result.insufficientDuration).toBe(false);
    expect(result.minFramesPerSecond).toBe(4);
    expect(result.sessions.map((s) => s.drawnUpdates)).toEqual([48, 24]);
    expect(result.sessions.map((s) => s.drawIntervalMs.p95)).toEqual([
      125, 250,
    ]);
  });

  it("uses the latest first draw and earliest final draw", () => {
    const a = new FrameTimeline(1);
    const b = new FrameTimeline(2);
    [0, 1000, 6000].forEach((at, i) => {
      record(a, i + 1, at);
    });
    [1000, 2000, 7000].forEach((at, i) => {
      record(b, i + 1, at);
    });
    const result = summarizeConcurrentTimelines([a, b]);
    expect(result.window).toEqual({
      startAt: 1250,
      endAt: 6000,
      durationMs: 4750,
    });
    expect(result.evaluable).toBe(false);
    expect(result.insufficientDuration).toBe(true);
  });

  it("does not hide a long interdraw gap crossing the warmup boundary", () => {
    const timeline = new FrameTimeline(1);
    [0, 1000, 6250].forEach((at, i) => {
      record(timeline, i + 1, at);
    });
    expect(
      summarizeConcurrentTimelines([timeline]).sessions[0].drawIntervalMs,
    ).toEqual({
      count: 2,
      p50: 1000,
      p95: 5250,
      max: 5250,
    });
  });

  it("requires every pane to have draws and rejects erroneous timelines", () => {
    expect(summarizeConcurrentTimelines([]).evaluable).toBe(false);
    expect(
      summarizeConcurrentTimelines([paced(1, 250), new FrameTimeline(2)])
        .window,
    ).toBeNull();
    const timeline = paced(1, 250);
    timeline.credited(999, 6250);
    const result = summarizeConcurrentTimelines([timeline]);
    expect(result.insufficientDuration).toBe(false);
    expect(result.evaluable).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it("rejects duplicate session identities rather than counting one pane twice", () => {
    const result = summarizeConcurrentTimelines([paced(1, 125), paced(1, 250)]);
    expect(result.evaluable).toBe(false);
    expect(result.errors).toContain("duplicate session identity 1");
  });

  it("accepts the preregistered five second boundary without asserting 60 fps", () => {
    const timeline = new FrameTimeline(1);
    [0, 250, 5250].forEach((at, i) => {
      record(timeline, i + 1, at);
    });
    const result = summarizeConcurrentTimelines([timeline]);
    expect(result.window?.durationMs).toBe(5000);
    expect(result.evaluable).toBe(true);
    expect(result.minFramesPerSecond).toBe(0.2);
    expect(result).not.toHaveProperty("passed");
  });
});
