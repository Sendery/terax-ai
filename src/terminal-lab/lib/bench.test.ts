import type {
  BenchStats,
  SessionObserver,
} from "@/modules/terminal/gl/engineSession";
import type { DecodedFrame } from "@/modules/terminal/gl/frameCodec";
import { runBench } from "@/terminal-lab/lib/bench";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  observers: [] as SessionObserver[],
  close: vi.fn(async () => {}),
  dispose: vi.fn(),
  benchStats: vi.fn<() => Promise<BenchStats>>(),
  atlasError: false,
}));

vi.mock("@/modules/terminal/gl/engineSession", () => ({
  EngineSession: {
    openBench: vi.fn(
      async (_renderer, options: { observer: SessionObserver }) => {
        mock.observers.push(options.observer);
        return { pane: {}, close: mock.close, benchStats: mock.benchStats };
      },
    ),
  },
}));

vi.mock("@/modules/terminal/gl/gridRenderer", () => ({
  GridRenderer: class {
    cellSize = { width: 8, height: 18 };
    stats = { draws: 2, contextLosses: 0, atlasResets: 0 };
    dispose = mock.dispose;
    constructor(private readonly canvas: HTMLCanvasElement) {}
    resize(width: number, height: number) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    setPaneRect() {}
    get atlasInfo() {
      if (mock.atlasError) throw new Error("atlas metadata unavailable");
      return { glyphs: 10, textureBytes: 1024 };
    }
  },
}));

const font = { family: "monospace", weight: "400", size: 14, letterSpacing: 0 };
const colors = {
  background: 0,
  cursor: 0xffffff,
  engine: {
    foreground: "#ffffff",
    background: "#000000",
    palette: Array(16).fill("#000000"),
  },
};

let canvas: {
  width: number;
  height: number;
  style: { cssText: string };
  remove: ReturnType<typeof vi.fn>;
};
let stage: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  vi.clearAllMocks();
  mock.observers.length = 0;
  mock.atlasError = false;
  mock.benchStats.mockResolvedValue({
    frames: 2,
    frameBytes: 80,
    bytesFed: 1024,
    encodeMicros: 1,
    creditWaitMicros: 1,
    credits: 1,
    scrollbackRows: 0,
  });
  canvas = { width: 0, height: 0, style: { cssText: "" }, remove: vi.fn() };
  stage = {
    replaceChildren: vi.fn(),
    getBoundingClientRect: () => ({ width: 800, height: 224 }),
  } as unknown as HTMLElement;
  vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16),
  );
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function received(seq: number) {
  mock.observers[0].onFrame?.({
    seq,
    bytes: 40,
    receivedAt: performance.now(),
    frame: { seq } as DecodedFrame,
  });
}

function drawn(seq: number) {
  mock.observers[0].onDrawn?.(performance.now(), seq);
}

function expectClosed() {
  expect(mock.close).toHaveBeenCalledTimes(1);
  expect(mock.dispose).toHaveBeenCalledTimes(1);
  expect(canvas.remove).toHaveBeenCalledTimes(1);
}

describe("engine benchmark coordination", () => {
  it("waits for the final arrival and its actual draw after exit with stable Rust counters", async () => {
    let settled = false;
    const pending = runBench(stage, font, colors, "ascii", 1, 1);
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    received(1);
    drawn(1);
    mock.observers[0].onExit?.(0);
    await vi.advanceTimersByTimeAsync(16);
    expect(mock.benchStats).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    expect(mock.close).not.toHaveBeenCalled();

    received(2);
    await vi.advanceTimersByTimeAsync(16);
    expect(settled).toBe(false);
    expect(mock.close).not.toHaveBeenCalled();

    drawn(2);
    await vi.advanceTimersByTimeAsync(16);
    const result = await pending;
    expect(settled).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.frames).toBe(2);
    expect(result.frameBytes).toBe(80);
    expect(result.completeness?.[0].complete).toBe(true);
    expect(result.timelines?.[0].frames.map((frame) => frame.drawnAt)).toEqual([
      0, 32,
    ]);
    expectClosed();
  });

  it("preserves nonzero exit and observer errors even when all frames were drawn", async () => {
    const pending = runBench(stage, font, colors, "sgr", 1, 1);
    await vi.advanceTimersByTimeAsync(0);
    received(1);
    drawn(1);
    received(2);
    drawn(2);
    mock.observers[0].onError?.(new Error("credit transport failed"));
    mock.observers[0].onExit?.(-1);
    await vi.advanceTimersByTimeAsync(0);
    const result = await pending;
    expect(result.error).toContain("session 0: Error: credit transport failed");
    expect(result.error).toContain("session 0 exited -1");
    expect(result.completeness?.[0].complete).toBe(true);
    expectClosed();
  });

  it("reports a bounded barrier failure when final bytes arrived but never drew", async () => {
    const pending = runBench(stage, font, colors, "tui", 1, 1);
    await vi.advanceTimersByTimeAsync(0);
    received(1);
    drawn(1);
    received(2);
    mock.observers[0].onExit?.(0);
    await vi.advanceTimersByTimeAsync(5024);
    const result = await pending;
    expect(result.error).toContain(
      "engine final-frame receive/draw barrier failed",
    );
    expect(result.completeness?.[0].complete).toBe(false);
    expectClosed();
  });

  it("closes sessions and the renderer if result metadata throws", async () => {
    mock.atlasError = true;
    const pending = runBench(stage, font, colors, "ascii", 1, 1);
    const rejected = expect(pending).rejects.toThrow(
      "atlas metadata unavailable",
    );
    await vi.advanceTimersByTimeAsync(0);
    received(1);
    drawn(1);
    received(2);
    drawn(2);
    mock.observers[0].onExit?.(0);
    await vi.advanceTimersByTimeAsync(0);
    await rejected;
    expectClosed();
  });
});
