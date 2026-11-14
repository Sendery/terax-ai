import type {
  BenchStats,
  SessionObserver,
} from "@/modules/terminal/gl/engineSession";
import type { DecodedFrame } from "@/modules/terminal/gl/frameCodec";
import { runBench } from "@/terminal-lab/lib/bench";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  observers: [] as SessionObserver[],
  senders: [] as ((id: number, seq: number, drawnAt: number) => Promise<void>)[],
  invoke: vi.fn(async (_credits: { id: number; seq: number }[]) => {}),
  close: vi.fn(async () => {}),
  dispose: vi.fn(),
  benchStats: vi.fn<() => Promise<BenchStats>>(),
  atlasError: false,
  rendererStats: null as null | {
    draws: number;
    contextLosses: number;
    atlasResets: number;
  },
  drawObserver: undefined as
    | undefined
    | ((at: number, ms: number, panes: number) => void),
}));

vi.mock("@/modules/terminal/gl/engineSession", () => ({
  registerLabCredits: (credits: { id: number; seq: number }[]) => mock.invoke(credits),
  EngineSession: {
    openBench: vi.fn(
      async (_renderer, options: { observer: SessionObserver; sendCredit?: (id: number, seq: number, drawnAt: number) => Promise<void> }) => {
        mock.observers.push(options.observer);
        if (options.sendCredit) mock.senders.push(options.sendCredit);
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
    constructor(
      private readonly canvas: HTMLCanvasElement,
      options: {
        onDrawTiming?: (at: number, ms: number, panes: number) => void;
      },
    ) {
      mock.drawObserver = options.onDrawTiming;
      mock.rendererStats = this.stats;
    }
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
  mock.senders.length = 0;
  mock.invoke.mockResolvedValue(undefined);
  mock.atlasError = false;
  mock.drawObserver = undefined;
  mock.rendererStats = null;
  mock.benchStats.mockResolvedValue({
    frames: 2,
    frameBytes: 80,
    bytesFed: 1024,
    encodeMicros: 1,
    sendMicros: 1,
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
    expect(mock.observers[0].onFrameTiming).toBeUndefined();
    expect(mock.observers[0].onCreditReply).toBeUndefined();
    expect(mock.drawObserver).toBeUndefined();
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

it("stops the measured interval before draining late credit replies", async () => {
  const pending = runBench(stage, font, colors, "ascii", 1, 1, {
    profile: true,
  });
  await vi.advanceTimersByTimeAsync(0);
  const o = mock.observers[0];
  received(1);
  o.onFrameTiming?.({
    seq: 1,
    decodeMs: 0,
    applyMs: 0,
    readyAt: performance.now(),
  });
  mock.drawObserver?.(performance.now(), 0, 1);
  drawn(1);
  o.onCredit?.(1, performance.now());
  o.onCreditReply?.(1, performance.now(), true);
  received(2);
  o.onFrameTiming?.({
    seq: 2,
    decodeMs: 0,
    applyMs: 0,
    readyAt: performance.now(),
  });
  mock.drawObserver?.(performance.now(), 0, 1);
  drawn(2);
  o.onCredit?.(2, performance.now());
  o.onExit?.(0);
  await vi.advanceTimersByTimeAsync(32);
  expect(mock.close).not.toHaveBeenCalled();
  if (mock.rendererStats) mock.rendererStats.draws = 99;
  o.onCreditReply?.(2, performance.now(), true);
  await vi.advanceTimersByTimeAsync(16);
  const run = await pending;
  expect(run.profile?.complete).toBe(true);
  expect(run.profile?.frames).toHaveLength(2);
  expect(run.profile?.draws).toHaveLength(2);
  expect(run.rendererDraws).toBe(2);
  expect(run.profileDrainMs).toBeGreaterThan(0);
  expect(run.wallMs).toBeLessThan(run.profileDrainMs ?? 0);
  expectClosed();
});
it("fails a profile with missing replies after the bounded out-of-band drain", async () => {
  const pending = runBench(stage, font, colors, "ascii", 1, 1, {
    profile: true,
  });
  await vi.advanceTimersByTimeAsync(0);
  const o = mock.observers[0];
  for (const seq of [1, 2]) {
    received(seq);
    o.onFrameTiming?.({
      seq,
      decodeMs: 0,
      applyMs: 0,
      readyAt: performance.now(),
    });
    drawn(seq);
    o.onCredit?.(seq, performance.now());
  }
  mock.drawObserver?.(performance.now(), 0, 1);
  o.onExit?.(0);
  await vi.advanceTimersByTimeAsync(5100);
  const run = await pending;
  expect(run.profile?.complete).toBe(false);
  expect(run.profile?.pendingReplies).toBe(2);
  expect(run.error).toContain("incomplete stage profile");
  expect(run.profileDrainMs).toBeGreaterThanOrEqual(5000);
  expect(run.wallMs).toBeLessThan(5000);
  expectClosed();
});


it("waits for batched registration after the final draw and retains bounded dispatch metrics", async () => {
  const pending = runBench(stage, font, colors, "ascii", 1, 1, { profile: false, batchCredits: true });
  await vi.advanceTimersByTimeAsync(0);
  received(1);
  drawn(1);
  const first = mock.senders[0](71, 1, performance.now());
  received(2);
  drawn(2);
  const second = mock.senders[0](71, 2, performance.now());
  mock.observers[0].onExit?.(0);
  await vi.advanceTimersByTimeAsync(16);
  await Promise.all([first, second]);
  const result = await pending;
  expect(result.error).toBeUndefined();
  expect(result.profile).toBeUndefined();
  expect(result.creditBatch).toMatchObject({ complete: true, queued: 2, registered: 2, pending: 0, invocations: 2, drawToDispatchMs: { count: 2 } });
  expectClosed();
});

it("a failed batch cannot pass despite complete frames and unchanged native counters", async () => {
  mock.invoke.mockRejectedValue(new Error("batch command rejected"));
  const pending = runBench(stage, font, colors, "ascii", 1, 1, { profile: false, batchCredits: true });
  await vi.advanceTimersByTimeAsync(0);
  received(1); drawn(1); received(2); drawn(2);
  const sent = Promise.allSettled([mock.senders[0](71, 1, performance.now()), mock.senders[0](71, 2, performance.now())]);
  mock.observers[0].onExit?.(0);
  await vi.advanceTimersByTimeAsync(16);
  expect((await sent).every((item) => item.status === "rejected")).toBe(true);
  const result = await pending;
  expect(result.error).toContain("incomplete credit batch registration");
  expect(result.creditBatch).toMatchObject({ complete: false, failed: 2, pending: 0 });
  expectClosed();
});
