import type { ApplyResult } from "@/modules/terminal/gl/cellBuffer";
import {
  type DecodedFrame,
  FRAME_FLAG_FULL,
} from "@/modules/terminal/gl/frameCodec";
import { encodeFrame, textRow } from "@/modules/terminal/gl/frameCodec.testing";
import type {
  GridRenderer,
  PaneCallbacks,
  RenderPane,
} from "@/modules/terminal/gl/gridRenderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { command: string; args: unknown };

const ipc = vi.hoisted(() => ({
  calls: [] as { command: string; args: unknown }[],
  open: null as null | {
    resolve: (id: number) => void;
    reject: (error: unknown) => void;
  },
}));

vi.mock("@tauri-apps/api/core", () => {
  class Channel<T> {
    onmessage: (message: T) => void = () => {};
  }
  return {
    Channel,
    invoke: (command: string, args: unknown) => {
      ipc.calls.push({ command, args });
      if (command === "gterm_open" || command === "gterm_bench_open") {
        return new Promise((resolve, reject) => {
          ipc.open = { resolve, reject };
        });
      }
      if (command === "gterm_available") return Promise.resolve(true);
      return Promise.resolve(null);
    },
  };
});

vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => ({ kind: "local" }),
}));

const { EngineSession, engineAvailable } = await import(
  "@/modules/terminal/gl/engineSession"
);

class FakeRenderer {
  panes: { pane: RenderPane; callbacks: PaneCallbacks }[] = [];
  applied: DecodedFrame[] = [];
  nextResult: ApplyResult = "applied";
  undrawn = new Set<RenderPane>();

  addPane(callbacks: PaneCallbacks): RenderPane {
    const pane = { callbacks, header: null, rect: { x: 0, y: 0 } };
    this.panes.push({ pane: pane as unknown as RenderPane, callbacks });
    return pane as unknown as RenderPane;
  }
  removePane(pane: RenderPane) {
    this.panes = this.panes.filter((p) => p.pane !== pane);
  }
  applyFrame(pane: RenderPane, frame: DecodedFrame): ApplyResult {
    this.applied.push(frame);
    if (this.nextResult === "applied") this.undrawn.add(pane);
    return this.nextResult;
  }
  markUndrawn(pane: RenderPane) {
    this.undrawn.add(pane);
  }
  /** One display frame: every pane with something applied is drawn. */
  drawFrame() {
    for (const { pane, callbacks } of this.panes) {
      if (!this.undrawn.delete(pane)) continue;
      callbacks.onDrawn();
    }
  }
}

function frameBuffer(seq: number, full = true): ArrayBuffer {
  return encodeFrame({
    seq,
    cols: 4,
    rows: 2,
    flags: full ? FRAME_FLAG_FULL : 0,
    rowRecords: [textRow(0, "ok")],
  });
}

function channelOf(index: number): { onmessage: (m: unknown) => void } {
  const open = ipc.calls.find(
    (c) => c.command === "gterm_open" || c.command === "gterm_bench_open",
  );
  const args = open?.args as Record<
    string,
    { onmessage: (m: unknown) => void }
  >;
  return index === 0 ? args.onFrame : args.onExit;
}

function credits(): Call[] {
  return ipc.calls.filter((c) => c.command === "gterm_credit");
}

function commands(name: string): Call[] {
  return ipc.calls.filter((c) => c.command === name);
}

async function openSession(renderer: FakeRenderer) {
  const pending = EngineSession.open(renderer as unknown as GridRenderer, {
    cols: 4,
    rows: 2,
  });
  ipc.open?.resolve(9);
  return pending;
}

beforeEach(() => {
  ipc.calls.length = 0;
  ipc.open = null;
});

describe("EngineSession credits", () => {
  it("reports only the latest applied sequence as a new drawn update", async () => {
    const renderer = new FakeRenderer();
    const drawn: (number | null)[] = [];
    const pending = EngineSession.open(renderer as unknown as GridRenderer, {
      cols: 4,
      rows: 2,
      observer: { onDrawn: (_at, seq) => drawn.push(seq) },
    });
    ipc.open?.resolve(9);
    await pending;
    channelOf(0).onmessage(frameBuffer(1));
    channelOf(0).onmessage(frameBuffer(2));
    renderer.drawFrame();
    renderer.markUndrawn(renderer.panes[0].pane);
    renderer.drawFrame();
    expect(drawn).toEqual([2, null]);
  });

  it("reports upload failures and releases their credit after a display frame", async () => {
    const renderer = new FakeRenderer();
    const errors: unknown[] = [];
    const pending = EngineSession.open(renderer as unknown as GridRenderer, {
      cols: 4,
      rows: 2,
      observer: { onError: (error) => errors.push(error) },
    });
    ipc.open?.resolve(9);
    await pending;
    vi.spyOn(renderer, "applyFrame").mockImplementationOnce(() => {
      throw new Error("upload failed");
    });
    expect(() => channelOf(0).onmessage(frameBuffer(1))).not.toThrow();
    expect(errors).toHaveLength(1);
    expect(credits()).toHaveLength(0);
    renderer.drawFrame();
    expect(credits()).toHaveLength(1);
  });

  it("returns a credit only after the frame has been drawn", async () => {
    const renderer = new FakeRenderer();
    await openSession(renderer);
    channelOf(0).onmessage(frameBuffer(1));
    expect(renderer.applied).toHaveLength(1);
    expect(credits()).toEqual([]);
    renderer.drawFrame();
    expect(credits()).toEqual([
      { command: "gterm_credit", args: { id: 9, seq: 1 } },
    ]);
    renderer.drawFrame();
    expect(credits()).toHaveLength(1);
  });

  it("holds credits for frames drawn before the session id is known", async () => {
    const renderer = new FakeRenderer();
    const pending = EngineSession.open(renderer as unknown as GridRenderer, {
      cols: 4,
      rows: 2,
    });
    channelOf(0).onmessage(frameBuffer(1));
    renderer.drawFrame();
    expect(credits()).toEqual([]);
    ipc.open?.resolve(3);
    await pending;
    expect(credits()).toEqual([
      { command: "gterm_credit", args: { id: 3, seq: 1 } },
    ]);
  });

  it("acknowledges an undecodable frame after a draw and asks for a full one", async () => {
    const renderer = new FakeRenderer();
    const errors: unknown[] = [];
    const pending = EngineSession.open(renderer as unknown as GridRenderer, {
      cols: 4,
      rows: 2,
      observer: { onError: (e) => errors.push(e) },
    });
    ipc.open?.resolve(5);
    await pending;
    const broken = frameBuffer(4);
    new Uint32Array(broken)[0] = 0;
    channelOf(0).onmessage(broken);
    expect(errors).toHaveLength(1);
    expect(commands("gterm_request_full")).toEqual([
      { command: "gterm_request_full", args: { id: 5 } },
    ]);
    expect(credits()).toEqual([]);
    renderer.drawFrame();
    expect(credits()).toEqual([
      { command: "gterm_credit", args: { id: 5, seq: 4 } },
    ]);
  });

  it("asks once for a full frame until one arrives", async () => {
    const renderer = new FakeRenderer();
    renderer.nextResult = "needs-full";
    await openSession(renderer);
    channelOf(0).onmessage(frameBuffer(1, false));
    channelOf(0).onmessage(frameBuffer(2, false));
    expect(commands("gterm_request_full")).toHaveLength(1);
    renderer.drawFrame();
    expect(credits().map((c) => (c.args as { seq: number }).seq)).toEqual([
      1, 2,
    ]);
    renderer.nextResult = "applied";
    channelOf(0).onmessage(frameBuffer(3, true));
    renderer.nextResult = "needs-full";
    channelOf(0).onmessage(frameBuffer(4, false));
    expect(commands("gterm_request_full")).toHaveLength(2);
  });

  it("re-requests a full frame when the renderer rebuilt the pane", async () => {
    const renderer = new FakeRenderer();
    await openSession(renderer);
    renderer.panes[0].callbacks.onNeedFullFrame();
    expect(commands("gterm_request_full")).toHaveLength(1);
  });

  it("stops crediting and drawing once closed", async () => {
    const renderer = new FakeRenderer();
    const session = await openSession(renderer);
    channelOf(0).onmessage(frameBuffer(1));
    await session.close();
    expect(commands("pty_close")).toEqual([
      { command: "pty_close", args: { id: 9 } },
    ]);
    expect(renderer.panes).toHaveLength(0);
    channelOf(0).onmessage(frameBuffer(2));
    renderer.drawFrame();
    expect(credits()).toEqual([]);
    expect(renderer.applied).toHaveLength(1);
  });

  it("releases the pane when opening fails", async () => {
    const renderer = new FakeRenderer();
    const pending = EngineSession.open(renderer as unknown as GridRenderer, {
      cols: 4,
      rows: 2,
    });
    ipc.open?.reject("engine-unavailable");
    await expect(pending).rejects.toBe("engine-unavailable");
    expect(renderer.panes).toHaveLength(0);
  });

  it("reports the exit code", async () => {
    const renderer = new FakeRenderer();
    const exits: number[] = [];
    const pending = EngineSession.open(renderer as unknown as GridRenderer, {
      cols: 4,
      rows: 2,
      observer: { onExit: (code) => exits.push(code) },
    });
    ipc.open?.resolve(2);
    const session = await pending;
    channelOf(1).onmessage(0);
    expect(exits).toEqual([0]);
    expect(session.exitCode).toBe(0);
  });
});

describe("EngineSession commands", () => {
  it("sends resize, scroll and input to the session", async () => {
    const renderer = new FakeRenderer();
    const session = await openSession(renderer);
    session.resize(4, 2);
    session.resize(80, 24);
    session.scroll(-3);
    session.scroll(0);
    await session.write("ls\r");
    expect(commands("pty_resize")).toEqual([
      { command: "pty_resize", args: { id: 9, cols: 80, rows: 24 } },
    ]);
    expect(commands("gterm_scroll")).toEqual([
      { command: "gterm_scroll", args: { id: 9, delta: -3 } },
    ]);
    const write = commands("pty_write")[0];
    expect(Array.from(write.args as Uint8Array)).toEqual([108, 115, 13]);
  });

  it("opens a bench session with the payload arguments", async () => {
    const renderer = new FakeRenderer();
    const pending = EngineSession.openBench(
      renderer as unknown as GridRenderer,
      { kind: "sgr", megabytes: 8, cols: 100, rows: 30 },
    );
    ipc.open?.resolve(11);
    await pending;
    expect(commands("gterm_bench_open")[0].args).toMatchObject({
      kind: "sgr",
      megabytes: 8,
      cols: 100,
      rows: 30,
    });
  });

  it("reports availability", async () => {
    await expect(engineAvailable()).resolves.toBe(true);
  });
});

const testColors = {
  foreground: "#112233",
  background: "#445566",
  cursor: "#778899",
  palette: Array.from({ length: 16 }, (_, i) => `#${i.toString(16).repeat(6)}`),
};

type OpeningSession = Awaited<ReturnType<typeof EngineSession.open>>;

function deferredSession(isBench = false) {
  const renderer = new FakeRenderer();
  const session = Reflect.construct(EngineSession, [
    renderer,
    {},
    { cols: 4, rows: 2 },
    isBench,
  ]) as OpeningSession;
  const start = Reflect.get(session, "start") as (
    command: string,
    args: Record<string, unknown>,
  ) => Promise<Awaited<ReturnType<typeof EngineSession.open>>>;
  const pending = start.call(
    session,
    isBench ? "gterm_bench_open" : "gterm_open",
    { cols: 4, rows: 2 },
  );
  return { session, pending };
}

describe("EngineSession opening synchronization", () => {
  it("sends only the latest resize when opening completes", async () => {
    const { session, pending } = deferredSession();
    session.resize(80, 24);
    session.resize(100, 30);
    expect(commands("pty_resize")).toEqual([]);
    ipc.open?.resolve(12);
    await pending;
    expect(commands("pty_resize")).toEqual([
      { command: "pty_resize", args: { id: 12, cols: 100, rows: 30 } },
    ]);
  });

  it("skips a resize when the latest size matches the opening size", async () => {
    const { session, pending } = deferredSession();
    session.resize(80, 24);
    session.resize(4, 2);
    ipc.open?.resolve(12);
    await pending;
    expect(commands("pty_resize")).toEqual([]);
  });

  it("does not resize synthetic bench sessions", async () => {
    const { session, pending } = deferredSession(true);
    session.resize(80, 24);
    ipc.open?.resolve(12);
    await pending;
    session.resize(100, 30);
    expect(commands("pty_resize")).toEqual([]);
    expect(session.grid).toEqual({ cols: 4, rows: 2 });
  });

  it("does not send pending resize or colors after closing", async () => {
    const { session, pending } = deferredSession();
    session.resize(80, 24);
    session.setColors(testColors);
    await session.close();
    ipc.open?.resolve(12);
    await expect(pending).rejects.toThrow("session closed while opening");
    expect(commands("pty_resize")).toEqual([]);
    expect(commands("gterm_set_colors")).toEqual([]);
    expect(commands("pty_close")).toHaveLength(1);
  });

  it("coalesces theme changes before open and sends later changes", async () => {
    const { session, pending } = deferredSession();
    session.setColors({ ...testColors, foreground: "#ffffff" });
    session.setColors(testColors);
    expect(commands("gterm_set_colors")).toEqual([]);
    ipc.open?.resolve(12);
    await pending;
    expect(commands("gterm_set_colors")).toEqual([
      { command: "gterm_set_colors", args: { id: 12, colors: testColors } },
    ]);
    session.setColors({ ...testColors, background: "#000000" });
    expect(commands("gterm_set_colors")).toHaveLength(2);
  });

  it("passes initial colors to both kinds of session", async () => {
    const renderer = new FakeRenderer();
    const normal = EngineSession.open(renderer as unknown as GridRenderer, {
      cols: 4,
      rows: 2,
      colors: testColors,
    });
    ipc.open?.resolve(12);
    await normal;
    const bench = EngineSession.openBench(renderer as unknown as GridRenderer, {
      cols: 4,
      rows: 2,
      colors: testColors,
      kind: "ascii",
      megabytes: 1,
    });
    ipc.open?.resolve(13);
    await bench;
    expect(commands("gterm_open")[0].args).toMatchObject({
      colors: testColors,
    });
    expect(commands("gterm_bench_open")[0].args).toMatchObject({
      colors: testColors,
    });
    expect(commands("gterm_set_colors")).toEqual([]);
  });
});

it("writes final reports and checkpoints as compact JSON with the same bounded transport", async () => {
  const { submitLabReport, labStatus } = await import(
    "@/modules/terminal/gl/engineSession"
  );
  const report = {
    bench: [{ kind: "ascii", events: [{ kind: "drawn", seq: 1, at: 10 }] }],
    errors: [],
  };
  await submitLabReport(report);
  await labStatus({ checkpoint: report });
  expect(ipc.calls[ipc.calls.length - 2]).toEqual({
    command: "gterm_lab_report",
    args: { json: JSON.stringify(report) },
  });
  expect(ipc.calls[ipc.calls.length - 1]).toEqual({
    command: "gterm_lab_status",
    args: { json: JSON.stringify({ checkpoint: report }) },
  });
});

it("profiles decode/apply locally and credit response only after drawing", async () => {
  const renderer = new FakeRenderer();
  const timing = vi.fn();
  const replies = vi.fn();
  const clock = vi.spyOn(performance, "now");
  clock.mockReturnValue(10);
  try {
    const pending = EngineSession.open(renderer as unknown as GridRenderer, {
      cols: 4,
      rows: 2,
      observer: { onFrameTiming: timing, onCreditReply: replies },
    });
    ipc.open?.resolve(9);
    const session = await pending;
    const apply = renderer.applyFrame.bind(renderer);
    vi.spyOn(renderer, "applyFrame").mockImplementationOnce((pane, frame) => {
      const result = apply(pane, frame);
      clock.mockReturnValue(15);
      return result;
    });
    channelOf(0).onmessage(frameBuffer(1));
    expect(timing).toHaveBeenCalledWith({
      seq: 1,
      decodeMs: 0,
      applyMs: 5,
      readyAt: 15,
    });
    expect(replies).not.toHaveBeenCalled();
    expect(credits()).toHaveLength(0);
    clock.mockReturnValue(20);
    renderer.drawFrame();
    await Promise.resolve();
    expect(replies).toHaveBeenCalledWith(1, 20, true);
    await session.close();
  } finally {
    clock.mockRestore();
  }
});

it("uses the lab credit sender only after draw and after a delayed bench id arrives", async () => {
  const renderer = new FakeRenderer();
  const sendCredit = vi.fn(async (_id: number, _seq: number, _at: number, _dispatch: (at: number) => void) => {});
  const onDrawn = vi.fn();
  const pending = EngineSession.openBench(renderer as unknown as GridRenderer, {
    kind: "ascii", megabytes: 1, cols: 4, rows: 2, sendCredit, observer: { onDrawn },
  });
  channelOf(0).onmessage(frameBuffer(1));
  renderer.drawFrame();
  channelOf(0).onmessage(frameBuffer(2));
  renderer.drawFrame();
  expect(sendCredit).not.toHaveBeenCalled();
  ipc.open?.resolve(71);
  const session = await pending;
  expect(sendCredit.mock.calls).toEqual([[71, 1, onDrawn.mock.calls[0][0], expect.any(Function)], [71, 2, onDrawn.mock.calls[1][0], expect.any(Function)]]);
  expect(credits()).toEqual([]);
  await session.close();
  channelOf(0).onmessage(frameBuffer(3));
  renderer.drawFrame();
  expect(sendCredit).toHaveBeenCalledTimes(2);
});

it("a queued lab acknowledgement is not reported as sent before its actual dispatch callback", async () => {
  const renderer = new FakeRenderer();
  const onCredit = vi.fn();
  const sendCredit = vi.fn(async (_id: number, _seq: number, _at: number, _dispatch: (at: number) => void) => {});
  const opening = EngineSession.openBench(renderer as unknown as GridRenderer, {
    kind: "ascii", megabytes: 1, cols: 4, rows: 2, sendCredit, observer: { onCredit },
  });
  ipc.open?.resolve(72);
  const session = await opening;
  channelOf(0).onmessage(frameBuffer(1));
  renderer.drawFrame();
  expect(onCredit).not.toHaveBeenCalled();
  sendCredit.mock.calls[0][3](123);
  expect(onCredit).toHaveBeenCalledExactlyOnceWith(1, 123);
  await session.close();
});
