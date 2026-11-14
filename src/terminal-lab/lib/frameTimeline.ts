import { type Distribution, distribution } from "@/terminal-lab/lib/stats";

export const TIMELINE_WARMUP_MS = 250;
export const TIMELINE_MINIMUM_DURATION_MS = 5000;

export type FrameTimelineEvent =
  | { kind: "received"; seq: number; bytes: number; at: number }
  | { kind: "drawn" | "credited"; seq: number; at: number };

export type TimelineFrame = {
  seq: number;
  bytes: number;
  receivedAt: number;
  drawnAt: number | null;
  creditedAt: number | null;
};

export type FrameTimelineReport = {
  session: string | number;
  events: FrameTimelineEvent[];
  frames: TimelineFrame[];
  errors: string[];
};

export type TimelineCompleteness = {
  complete: boolean;
  receivedFrames: number;
  receivedBytes: number;
  drawnFrames: number;
  lastReceivedSeq: number | null;
  lastDrawnSeq: number | null;
  errors: string[];
};

/** Draws record only the newest represented sequence; coalesced frames retain their arrivals. */
export class FrameTimeline {
  private readonly events: FrameTimelineEvent[] = [];
  private readonly frames = new Map<number, TimelineFrame>();
  private readonly errors: string[] = [];
  private lastEventAt = 0;
  private lastReceivedSeq = 0;
  private lastDrawnSeq = 0;
  private receivedBytes = 0;

  constructor(readonly session: string | number) {}

  received(seq: number, bytes: number, at: number): void {
    if (!this.record({ kind: "received", seq, bytes, at })) return;
    if (!Number.isSafeInteger(bytes) || bytes <= 0) {
      this.errors.push(`received ${seq}: invalid byte count ${bytes}`);
      return;
    }
    if (this.frames.has(seq)) {
      this.errors.push(`received ${seq}: duplicate sequence`);
      return;
    }
    if (seq !== this.lastReceivedSeq + 1) {
      this.errors.push(
        `received ${seq}: expected sequence ${this.lastReceivedSeq + 1}`,
      );
      return;
    }
    this.frames.set(seq, {
      seq,
      bytes,
      receivedAt: at,
      drawnAt: null,
      creditedAt: null,
    });
    this.lastReceivedSeq = seq;
    this.receivedBytes += bytes;
  }

  drawn(seq: number, at: number): void {
    if (!this.record({ kind: "drawn", seq, at })) return;
    const frame = this.frames.get(seq);
    if (!frame) {
      this.errors.push(`drawn ${seq}: unknown sequence`);
      return;
    }
    if (frame.drawnAt !== null) {
      this.errors.push(`drawn ${seq}: duplicate draw`);
      return;
    }
    if (seq !== this.lastReceivedSeq) {
      this.errors.push(
        `drawn ${seq}: latest received sequence is ${this.lastReceivedSeq}`,
      );
      return;
    }
    frame.drawnAt = at;
    this.lastDrawnSeq = seq;
  }

  credited(seq: number, at: number): void {
    if (!this.record({ kind: "credited", seq, at })) return;
    const frame = this.frames.get(seq);
    if (!frame) {
      this.errors.push(`credited ${seq}: unknown sequence`);
      return;
    }
    if (frame.creditedAt !== null) {
      this.errors.push(`credited ${seq}: duplicate credit`);
      return;
    }
    if (seq > this.lastDrawnSeq) {
      this.errors.push(`credited ${seq}: no draw covers this sequence`);
      return;
    }
    frame.creditedAt = at;
  }

  private record(event: FrameTimelineEvent): boolean {
    this.events.push({ ...event });
    if (!Number.isSafeInteger(event.seq) || event.seq < 1) {
      this.errors.push(`${event.kind}: invalid sequence ${event.seq}`);
      return false;
    }
    if (!Number.isFinite(event.at) || event.at < this.lastEventAt) {
      this.errors.push(
        `${event.kind} ${event.seq}: invalid timestamp ${event.at}`,
      );
      return false;
    }
    this.lastEventAt = event.at;
    return true;
  }

  /** Rust's final counters are stable after exit; the final draw may still be pending. */
  completeness(expected: {
    frames: number;
    frameBytes: number;
  }): TimelineCompleteness {
    const errors = [...this.errors];
    if (!Number.isSafeInteger(expected.frames) || expected.frames < 1) {
      errors.push("expected frames must be a positive integer");
    }
    if (!Number.isSafeInteger(expected.frameBytes) || expected.frameBytes < 1) {
      errors.push("expected frameBytes must be a positive integer");
    }
    if (this.frames.size !== expected.frames) {
      errors.push(`received ${this.frames.size}/${expected.frames} frames`);
    }
    if (this.receivedBytes !== expected.frameBytes) {
      errors.push(
        `received ${this.receivedBytes}/${expected.frameBytes} bytes`,
      );
    }
    if (!this.lastReceivedSeq || this.lastDrawnSeq !== this.lastReceivedSeq) {
      errors.push("final received sequence has not been drawn");
    }
    return {
      complete: errors.length === 0,
      receivedFrames: this.frames.size,
      receivedBytes: this.receivedBytes,
      drawnFrames: [...this.frames.values()].filter(
        (frame) => frame.drawnAt !== null,
      ).length,
      lastReceivedSeq: this.lastReceivedSeq || null,
      lastDrawnSeq: this.lastDrawnSeq || null,
      errors,
    };
  }

  toJSON(): FrameTimelineReport {
    return {
      session: this.session,
      events: this.events.map((event) => ({ ...event })),
      frames: [...this.frames.values()].map((frame) => ({ ...frame })),
      errors: [...this.errors],
    };
  }
}

export type ConcurrentTimelineSummary = {
  warmupMs: number;
  minimumDurationMs: number;
  window: { startAt: number; endAt: number; durationMs: number } | null;
  insufficientDuration: boolean;
  evaluable: boolean;
  minFramesPerSecond: number | null;
  sessions: {
    session: string | number;
    drawnUpdates: number;
    framesPerSecond: number | null;
    drawIntervalMs: Distribution;
  }[];
  errors: string[];
};

/** Count updates in (start, end]; include each update's preceding gap even across warmup. */
export function summarizeConcurrentTimelines(
  timelines: readonly FrameTimeline[],
): ConcurrentTimelineSummary {
  const reports = timelines.map((timeline) => timeline.toJSON());
  const errors = reports.flatMap((report) =>
    report.errors.map((error) => `session ${report.session}: ${error}`),
  );
  const identities = new Set<string | number>();
  for (const report of reports) {
    if (identities.has(report.session)) {
      errors.push(`duplicate session identity ${report.session}`);
    }
    identities.add(report.session);
  }
  const draws = reports.map((report) =>
    report.frames.flatMap((frame) =>
      frame.drawnAt === null ? [] : [frame.drawnAt],
    ),
  );
  const missingDraws = reports.filter((_, index) => draws[index].length === 0);
  for (const report of missingDraws)
    errors.push(`session ${report.session}: no drawn frames`);
  if (reports.length === 0) errors.push("no sessions");
  const hasWindow = reports.length > 0 && missingDraws.length === 0;
  const startAt = hasWindow
    ? Math.max(...draws.map((stamps) => stamps[0])) + TIMELINE_WARMUP_MS
    : 0;
  const endAt = hasWindow
    ? Math.min(...draws.map((stamps) => stamps[stamps.length - 1]))
    : 0;
  const window = hasWindow
    ? { startAt, endAt, durationMs: Math.max(0, endAt - startAt) }
    : null;
  const insufficientDuration =
    !window || window.durationMs < TIMELINE_MINIMUM_DURATION_MS;
  const sessions = reports.map((report, index) => {
    const stamps = draws[index];
    const inWindow = (at: number) =>
      window !== null && at > window.startAt && at <= window.endAt;
    const drawnUpdates = stamps.filter(inWindow).length;
    const gaps = stamps.flatMap((at, i) =>
      i > 0 && inWindow(at) ? [at - stamps[i - 1]] : [],
    );
    return {
      session: report.session,
      drawnUpdates,
      framesPerSecond:
        window && window.durationMs > 0
          ? (drawnUpdates * 1000) / window.durationMs
          : null,
      drawIntervalMs: distribution(gaps),
    };
  });
  return {
    warmupMs: TIMELINE_WARMUP_MS,
    minimumDurationMs: TIMELINE_MINIMUM_DURATION_MS,
    window,
    insufficientDuration,
    evaluable: !insufficientDuration && errors.length === 0,
    minFramesPerSecond:
      window && window.durationMs > 0
        ? Math.min(...sessions.map((session) => session.framesPerSecond ?? 0))
        : null,
    sessions,
    errors,
  };
}
