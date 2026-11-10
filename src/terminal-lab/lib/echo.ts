import type {
  FrameEvent,
  SessionObserver,
} from "@/modules/terminal/gl/engineSession";
import {
  CELL_CODEPOINT_MASK,
  createRowView,
  type DecodedFrame,
  readRow,
} from "@/modules/terminal/gl/frameCodec";
import { type Distribution, distribution } from "@/terminal-lab/lib/stats";

/**
 * Codepoint at a cell as the frame carries it: 0 for an empty cell or one
 * past the encoded cells, null when the frame does not touch that row.
 */
export function frameCellAt(
  frame: DecodedFrame,
  x: number,
  y: number,
): number | null {
  const row = createRowView();
  for (let i = 0; i < frame.rowCount; i++) {
    readRow(frame, i, row);
    if (row.y !== y) continue;
    if (x >= row.cellCount) return 0;
    return frame.u32[row.cellsAt + x] & CELL_CODEPOINT_MASK;
  }
  return null;
}

/** Codepoint 0 waits for a blank cell, which a shell may draw as a space. */
export function cellMatches(codepoint: number, wanted: number): boolean {
  if (wanted === 0) return codepoint === 0 || codepoint === 32;
  return codepoint === wanted;
}

/** Something the echo measurement can type into and watch. */
export type EchoTarget = {
  cursor: () => { x: number; y: number } | null;
  write: (text: string) => Promise<void>;
  /** Resolves with the time the cell was first drawn holding `codepoint`. */
  waitForCell: (
    x: number,
    y: number,
    codepoint: number,
    timeoutMs: number,
  ) => Promise<number | null>;
};

type Watch = {
  x: number;
  y: number;
  codepoint: number;
  seen: boolean;
  resolve: (at: number | null) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Engine side of `EchoTarget.waitForCell`, fed by a session observer. */
export class FrameWatchers {
  private watches = new Set<Watch>();

  readonly observer: SessionObserver = {
    onFrame: (event: FrameEvent) => {
      const frame = event.frame;
      if (!frame) return;
      for (const watch of this.watches) {
        if (watch.seen) continue;
        const cp = frameCellAt(frame, watch.x, watch.y);
        if (cp !== null && cellMatches(cp, watch.codepoint)) watch.seen = true;
      }
    },
    onDrawn: (at: number) => {
      for (const watch of this.watches) {
        if (!watch.seen) continue;
        this.finish(watch, at);
      }
    },
  };

  waitForCell(
    x: number,
    y: number,
    codepoint: number,
    timeoutMs: number,
  ): Promise<number | null> {
    return new Promise((resolve) => {
      const watch: Watch = {
        x,
        y,
        codepoint,
        seen: false,
        resolve,
        timer: setTimeout(() => this.finish(watch, null), timeoutMs),
      };
      this.watches.add(watch);
    });
  }

  private finish(watch: Watch, at: number | null): void {
    if (!this.watches.delete(watch)) return;
    clearTimeout(watch.timer);
    watch.resolve(at);
  }
}

export type EchoResult = Distribution & {
  samples: number[];
  timeouts: number;
  error?: string;
};

const PROBE = "a";
const ERASE = "\x7f";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Types one printable byte at the prompt, times it until the frame that shows
 * it has been drawn, erases it, and repeats.
 */
export async function measureEcho(
  target: EchoTarget,
  count: number,
  timeoutMs = 2000,
): Promise<EchoResult> {
  const samples: number[] = [];
  let timeouts = 0;
  const probe = PROBE.codePointAt(0) ?? 0;
  await sleep(300);
  for (let i = 0; i < count; i++) {
    const cursor = target.cursor();
    if (!cursor) {
      return {
        ...distribution(samples),
        samples,
        timeouts,
        error: "no cursor yet",
      };
    }
    const shown = target.waitForCell(cursor.x, cursor.y, probe, timeoutMs);
    const start = performance.now();
    await target.write(PROBE);
    const at = await shown;
    if (at === null) timeouts += 1;
    else samples.push(at - start);
    const erased = target.waitForCell(cursor.x, cursor.y, 0, timeoutMs);
    await target.write(ERASE);
    await erased;
    await sleep(40);
  }
  return { ...distribution(samples), samples, timeouts };
}
