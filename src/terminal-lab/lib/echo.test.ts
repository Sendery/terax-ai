import { decodeFrame, FRAME_FLAG_FULL } from "@/modules/terminal/gl/frameCodec";
import {
  encodeFrame,
  type RowSpec,
  textRow,
} from "@/modules/terminal/gl/frameCodec.testing";
import {
  cellMatches,
  type EchoTarget,
  FrameWatchers,
  frameCellAt,
  measureEcho,
} from "@/terminal-lab/lib/echo";
import { describe, expect, it } from "vitest";

function frame(rows: RowSpec[]) {
  return decodeFrame(
    encodeFrame({ cols: 6, rows: 3, flags: FRAME_FLAG_FULL, rowRecords: rows }),
  );
}

describe("frameCellAt", () => {
  it("reads a cell, an unencoded tail and an untouched row", () => {
    const f = frame([textRow(1, "$ a")]);
    expect(frameCellAt(f, 2, 1)).toBe(97);
    expect(frameCellAt(f, 1, 1)).toBe(0);
    expect(frameCellAt(f, 5, 1)).toBe(0);
    expect(frameCellAt(f, 0, 0)).toBeNull();
  });
});

describe("cellMatches", () => {
  it("treats a space as blank", () => {
    expect(cellMatches(32, 0)).toBe(true);
    expect(cellMatches(0, 0)).toBe(true);
    expect(cellMatches(97, 0)).toBe(false);
    expect(cellMatches(97, 97)).toBe(true);
  });
});

describe("FrameWatchers", () => {
  it("resolves at the draw after the frame that shows the cell", async () => {
    const watchers = new FrameWatchers();
    const pending = watchers.waitForCell(2, 1, 97, 1000);
    const event = { seq: 1, bytes: 0, receivedAt: 0 };
    watchers.observer.onDrawn?.(5);
    watchers.observer.onFrame?.({
      ...event,
      frame: frame([textRow(0, "zzz")]),
    });
    watchers.observer.onDrawn?.(6);
    watchers.observer.onFrame?.({
      ...event,
      frame: frame([textRow(1, "$ a")]),
    });
    watchers.observer.onDrawn?.(7);
    await expect(pending).resolves.toBe(7);
  });

  it("gives up after its timeout", async () => {
    const watchers = new FrameWatchers();
    await expect(watchers.waitForCell(0, 0, 97, 5)).resolves.toBeNull();
  });
});

describe("measureEcho", () => {
  it("times each echo and counts misses", async () => {
    let call = 0;
    const target: EchoTarget = {
      cursor: () => ({ x: 2, y: 0 }),
      write: async () => {},
      waitForCell: async (_x, _y, codepoint) => {
        call += 1;
        if (codepoint === 0) return performance.now();
        if (call === 3) return null;
        return performance.now() + 1000;
      },
    };
    const result = await measureEcho(target, 2, 10);
    expect(result.count).toBe(1);
    expect(result.timeouts).toBe(1);
    expect(result.samples[0]).toBeGreaterThan(900);
  });

  it("stops when there is no cursor yet", async () => {
    const result = await measureEcho(
      {
        cursor: () => null,
        write: async () => {},
        waitForCell: async () => null,
      },
      3,
    );
    expect(result).toMatchObject({ count: 0, error: "no cursor yet" });
  });
});
