import type { FrameTiming } from "@/modules/terminal/gl/engineSession";
import { distribution } from "@/terminal-lab/lib/stats";

type FrameSample = [
  number,
  number,
  number,
  number,
  number,
  number | null,
  number | null,
  number | null,
  boolean | null,
];
type DrawSample = [number, number, number];

/** JavaScript-local durations only; native clocks are never subtracted from these. */
export class StageProfile {
  private readonly samples = new Map<string, FrameSample>();
  private readonly draws: DrawSample[] = [];
  private readonly errors: string[] = [];
  private stoppedAt: number | null = null;

  frame(session: number, timing: FrameTiming): void {
    if (this.stoppedAt !== null) {
      this.errors.push("frame after profile stopped");
      return;
    }
    const { seq, decodeMs, applyMs, readyAt } = timing;
    const key = `${session}:${seq}`;
    if (
      !Number.isSafeInteger(session) ||
      session < 0 ||
      !Number.isSafeInteger(seq) ||
      seq < 1 ||
      ![decodeMs, applyMs, readyAt].every(
        (n) => Number.isFinite(n) && n >= 0,
      ) ||
      this.samples.has(key)
    ) {
      this.errors.push(`invalid or duplicate frame timing ${key}`);
      return;
    }
    this.samples.set(key, [
      session,
      seq,
      decodeMs,
      applyMs,
      readyAt,
      null,
      null,
      null,
      null,
    ]);
  }

  drawn(session: number, seq: number, at: number): void {
    const sample = this.lookup(session, seq);
    if (!sample) return;
    if (sample[5] !== null || !this.validAt(at, sample[4])) {
      this.errors.push(`invalid draw timing ${session}:${seq}`);
      return;
    }
    sample[5] = at;
  }

  credit(session: number, seq: number, at: number): void {
    const sample = this.lookup(session, seq);
    if (!sample) return;
    if (sample[6] !== null || !this.validAt(at, sample[4])) {
      this.errors.push(`invalid credit timing ${session}:${seq}`);
      return;
    }
    sample[6] = at;
  }

  reply(session: number, seq: number, at: number, ok: boolean): void {
    const sample = this.lookup(session, seq);
    if (!sample) return;
    if (
      sample[6] === null ||
      sample[7] !== null ||
      !this.validAt(at, sample[6])
    ) {
      this.errors.push(`invalid credit reply timing ${session}:${seq}`);
      return;
    }
    sample[7] = at;
    sample[8] = ok;
    if (!ok) this.errors.push(`credit command failed ${session}:${seq}`);
  }

  render(at: number, durationMs: number, panes: number): void {
    if (this.stoppedAt !== null) return;
    if (
      ![at, durationMs].every((n) => Number.isFinite(n) && n >= 0) ||
      !Number.isSafeInteger(panes) ||
      panes < 0
    ) {
      this.errors.push("invalid draw submission timing");
      return;
    }
    this.draws.push([at, durationMs, panes]);
  }

  stop(at: number): void {
    this.stoppedAt ??= at;
  }

  get pendingReplies(): number {
    let count = 0;
    for (const sample of this.samples.values())
      if (sample[6] !== null && sample[7] === null) count++;
    return count;
  }

  toJSON() {
    const frames = [...this.samples.values()].map(
      (sample): FrameSample => [...sample],
    );
    return {
      frameColumns: [
        "session",
        "seq",
        "decodeMs",
        "applyMs",
        "readyAt",
        "drawAt",
        "creditSentAt",
        "creditReplyAt",
        "creditReplyOk",
      ],
      frames,
      drawColumns: ["at", "submissionMs", "renderedPanes"],
      draws: this.draws.map((sample): DrawSample => [...sample]),
      stoppedAt: this.stoppedAt,
      decodeMs: distribution(frames.map((s) => s[2])),
      applyMs: distribution(frames.map((s) => s[3])),
      readyToDrawMs: distribution(
        frames.flatMap((s) => (s[5] === null ? [] : [s[5] - s[4]])),
      ),
      creditCommandMs: distribution(
        frames.flatMap((s) =>
          s[6] === null || s[7] === null ? [] : [s[7] - s[6]],
        ),
      ),
      drawSubmissionMs: distribution(this.draws.map((s) => s[1])),
      missingCredits: frames.filter((s) => s[6] === null).length,
      pendingReplies: this.pendingReplies,
      failedReplies: frames.filter((s) => s[8] === false).length,
      complete:
        this.stoppedAt !== null &&
        this.pendingReplies === 0 &&
        frames.every((s) => s[6] !== null) &&
        this.errors.length === 0,
      errors: [...this.errors],
    };
  }

  private lookup(session: number, seq: number): FrameSample | null {
    const sample = this.samples.get(`${session}:${seq}`);
    if (!sample) this.errors.push(`unknown timing sequence ${session}:${seq}`);
    return sample ?? null;
  }

  private validAt(at: number, after: number): boolean {
    return Number.isFinite(at) && at >= after;
  }
}
