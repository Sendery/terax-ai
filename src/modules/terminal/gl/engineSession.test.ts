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
  resize: null as Promise<unknown> | null,
  text: null as Promise<unknown> | null,
  encoded: null as Promise<unknown> | null,
  selection: null as Promise<unknown> | null,
  search: null as Promise<unknown> | null,
  link: null as Promise<unknown> | null,
  blocks: null as Promise<unknown> | null,
  blockOutput: null as Promise<unknown> | null,
  blockAction: null as Promise<unknown> | null,
  closing: null as Promise<unknown> | null,
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
      if (command === "gterm_resize" && ipc.resize) return ipc.resize;
      if (command === "pty_close" && ipc.closing) return ipc.closing;
      if (command === "gterm_blocks")
        return ipc.blocks ?? Promise.resolve(null);
      if (command === "gterm_block_action")
        return ipc.blockAction ?? Promise.resolve({ kind: "cleared" });
      if (command === "gterm_read_block")
        return ipc.blockOutput ?? Promise.resolve(null);
      if (command === "gterm_link_context")
        return ipc.link ?? Promise.resolve(null);
      if (command === "gterm_search")
        return ipc.search ?? Promise.resolve(true);
      if (command === "gterm_selection")
        return ipc.selection ?? Promise.resolve("native selection");
      if (command === "gterm_encode_input")
        return ipc.encoded ?? Promise.resolve([13]);
      if (command === "gterm_read_text")
        return ipc.text ?? Promise.resolve("native text");
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
  setPaneFocused(_pane: RenderPane, _focused: boolean) {}
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
  ipc.resize = null;
  ipc.text = null;
  ipc.encoded = null;
  ipc.selection = null;
  ipc.search = null;
  ipc.link = null;
  ipc.blocks = null;
  ipc.blockOutput = null;
  ipc.blockAction = null;
  ipc.closing = null;
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
    expect(commands("gterm_resize")).toEqual([
      { command: "gterm_resize", args: { id: 9, cols: 80, rows: 24 } },
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
    expect(commands("gterm_resize")).toEqual([]);
    ipc.open?.resolve(12);
    await pending;
    expect(commands("gterm_resize")).toEqual([
      { command: "gterm_resize", args: { id: 12, cols: 100, rows: 30 } },
    ]);
  });

  it("skips a resize when the latest size matches the opening size", async () => {
    const { session, pending } = deferredSession();
    session.resize(80, 24);
    session.resize(4, 2);
    ipc.open?.resolve(12);
    await pending;
    expect(commands("gterm_resize")).toEqual([]);
  });

  it("does not resize synthetic bench sessions", async () => {
    const { session, pending } = deferredSession(true);
    session.resize(80, 24);
    ipc.open?.resolve(12);
    await pending;
    session.resize(100, 30);
    expect(commands("gterm_resize")).toEqual([]);
    expect(session.grid).toEqual({ cols: 4, rows: 2 });
  });

  it("does not send pending resize or colors after closing", async () => {
    const { session, pending } = deferredSession();
    session.resize(80, 24);
    session.setColors(testColors);
    await session.close();
    ipc.open?.resolve(12);
    await expect(pending).rejects.toThrow("session closed while opening");
    expect(commands("gterm_resize")).toEqual([]);
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
  const sendCredit = vi.fn(
    async (
      _id: number,
      _seq: number,
      _at: number,
      _dispatch: (at: number) => void,
    ) => {},
  );
  const onDrawn = vi.fn();
  const pending = EngineSession.openBench(renderer as unknown as GridRenderer, {
    kind: "ascii",
    megabytes: 1,
    cols: 4,
    rows: 2,
    sendCredit,
    observer: { onDrawn },
  });
  channelOf(0).onmessage(frameBuffer(1));
  renderer.drawFrame();
  channelOf(0).onmessage(frameBuffer(2));
  renderer.drawFrame();
  expect(sendCredit).not.toHaveBeenCalled();
  ipc.open?.resolve(71);
  const session = await pending;
  expect(sendCredit.mock.calls).toEqual([
    [71, 1, onDrawn.mock.calls[0][0], expect.any(Function)],
    [71, 2, onDrawn.mock.calls[1][0], expect.any(Function)],
  ]);
  expect(credits()).toEqual([]);
  await session.close();
  channelOf(0).onmessage(frameBuffer(3));
  renderer.drawFrame();
  expect(sendCredit).toHaveBeenCalledTimes(2);
});

it("a queued lab acknowledgement is not reported as sent before its actual dispatch callback", async () => {
  const renderer = new FakeRenderer();
  const onCredit = vi.fn();
  const sendCredit = vi.fn(
    async (
      _id: number,
      _seq: number,
      _at: number,
      _dispatch: (at: number) => void,
    ) => {},
  );
  const opening = EngineSession.openBench(renderer as unknown as GridRenderer, {
    kind: "ascii",
    megabytes: 1,
    cols: 4,
    rows: 2,
    sendCredit,
    observer: { onCredit },
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

it("latches a fatal engine exit, reports it, and rejects later input without native writes", async () => {
  const renderer = new FakeRenderer();
  const onError = vi.fn();
  const onExit = vi.fn();
  const opening = EngineSession.open(renderer as unknown as GridRenderer, {
    cols: 4,
    rows: 2,
    observer: { onError, onExit },
  });
  ipc.open?.resolve(81);
  const session = await opening;
  channelOf(0).onmessage(frameBuffer(1));
  renderer.drawFrame();
  channelOf(1).onmessage(-2);
  channelOf(1).onmessage(0);
  expect(session.exitCode).toBe(-2);
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onExit).toHaveBeenCalledExactlyOnceWith(-2);
  const count = ipc.calls.length;
  await expect(session.write("must not reach PTY")).rejects.toThrow(
    "terminal engine failed",
  );
  session.resize(9, 7);
  session.scroll(-1);
  session.requestFull();
  channelOf(0).onmessage(frameBuffer(2));
  renderer.drawFrame();
  expect(ipc.calls).toHaveLength(count);
  expect(renderer.applied).toHaveLength(1);
  await session.close();
});

it("does not return a usable session if the engine fails before its open id arrives", async () => {
  const renderer = new FakeRenderer();
  const opening = EngineSession.open(renderer as unknown as GridRenderer, {
    cols: 4,
    rows: 2,
  });
  channelOf(1).onmessage(-2);
  ipc.open?.resolve(82);
  await expect(opening).rejects.toThrow("terminal engine failed");
  expect(renderer.panes).toHaveLength(0);
  expect(
    commands("pty_close").some(
      (call) => (call.args as { id: number }).id === 82,
    ),
  ).toBe(true);
});

it("a throwing fatal-error observer cannot prevent the exit callback or leave the pending open usable", async () => {
  const renderer = new FakeRenderer();
  const onError = vi.fn(() => {
    throw new Error("injected observer failure");
  });
  const onExit = vi.fn();
  const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const opening = EngineSession.open(renderer as unknown as GridRenderer, {
      cols: 4,
      rows: 2,
      observer: { onError, onExit },
    });
    expect(() => channelOf(1).onmessage(-2)).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledExactlyOnceWith(-2);
    ipc.open?.resolve(83);
    await expect(opening).rejects.toThrow("terminal engine failed");
    expect(renderer.panes).toHaveLength(0);
  } finally {
    diagnostic.mockRestore();
  }
});

it("a deferred batch cannot dispatch a credit after its session failed", async () => {
  const renderer = new FakeRenderer();
  const onCredit = vi.fn();
  const sendCredit = vi.fn(
    async (
      _id: number,
      _seq: number,
      _drawn: number,
      _dispatch: (at: number) => void,
    ) => {},
  );
  const opening = EngineSession.openBench(renderer as unknown as GridRenderer, {
    kind: "ascii",
    megabytes: 1,
    cols: 4,
    rows: 2,
    sendCredit,
    observer: { onCredit },
  });
  ipc.open?.resolve(84);
  const session = await opening;
  channelOf(0).onmessage(frameBuffer(1));
  renderer.drawFrame();
  channelOf(1).onmessage(-2);
  expect(() => sendCredit.mock.calls[0][3](123)).toThrow(
    "terminal engine failed",
  );
  expect(onCredit).not.toHaveBeenCalled();
  await session.close();
});

it("the real ghostty adapter awaits native resize completion", async () => {
  const { adaptGhosttyEngine } = await import(
    "@/modules/terminal/lib/ghosttyEngine"
  );
  const { TerminalSessionController } = await import(
    "@/modules/terminal/lib/terminalEngine"
  );
  const native = await openSession(new FakeRenderer());
  const owner = new TerminalSessionController(
    async () => adaptGhosttyEngine(native),
    { cols: 4, rows: 2 },
  );
  await owner.opened;
  let finish!: () => void;
  ipc.resize = new Promise<void>((resolve) => {
    finish = resolve;
  });
  owner.resize(80, 24);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  let completed = false;
  const settled = owner.layoutSettled().then(() => {
    completed = true;
  });
  await Promise.resolve();
  expect(completed).toBe(false);
  expect(commands("gterm_resize")).toHaveLength(1);
  owner.resize(100, 30);
  await Promise.resolve();
  expect(commands("gterm_resize")).toHaveLength(1);
  finish();
  await settled;
  expect(commands("gterm_resize").map((c) => c.args)).toEqual([
    { id: 9, cols: 80, rows: 24 },
    { id: 9, cols: 100, rows: 30 },
  ]);
  await owner.close();
});

it("reads bounded text from the native engine without substituting the visible grid", async () => {
  const session = await openSession(new FakeRenderer());
  expect(await session.readText(300)).toBe("native text");
  expect(commands("gterm_read_text")).toEqual([
    { command: "gterm_read_text", args: { id: 9, maxLines: 300 } },
  ]);
  for (const max of [0, -1, 1001, 1.5, Number.NaN])
    await expect(session.readText(max)).rejects.toThrow("line limit");
  expect(commands("gterm_read_text")).toHaveLength(1);
  await session.close();
  await expect(session.readText()).rejects.toThrow("unavailable");
  expect(commands("gterm_read_text")).toHaveLength(1);
});

it("rejects text returned after its session closed and rejects malformed native text", async () => {
  const session = await openSession(new FakeRenderer());
  ipc.text = Promise.resolve({ text: "invalid reply" });
  await expect(session.readText()).rejects.toThrow(
    "invalid terminal text reply",
  );
  let finish!: (text: string) => void;
  ipc.text = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const pending = session.readText();
  const settled = Promise.allSettled([pending]);
  await session.close();
  finish("stale private content");
  const result = (await settled)[0];
  expect(result.status).toBe("rejected");
});

it("reports a retained core failure after a successful process exit", async () => {
  const renderer = new FakeRenderer();
  const onError = vi.fn();
  const onExit = vi.fn();
  const opening = EngineSession.open(renderer as unknown as GridRenderer, {
    cols: 4,
    rows: 2,
    observer: { onError, onExit },
  });
  ipc.open!.resolve(9);
  const session = await opening;
  channelOf(1).onmessage(0);
  const args = commands("gterm_open")[0].args as {
    onFailure: { onmessage: (message: string) => void };
  };
  args.onFailure.onmessage("frame delivery failed");
  args.onFailure.onmessage("duplicate failure");
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onExit).toHaveBeenCalledExactlyOnceWith(0);
  expect(session.exitCode).toBe(0);
  await expect(session.readText()).rejects.toThrow("unavailable");
  await expect(session.write("late")).rejects.toThrow("failed");
  await session.close();
});

it("keeps retained presentation and text available after exit without writing to the dead PTY", async () => {
  const renderer = new FakeRenderer();
  const session = await openSession(renderer);
  channelOf(1).onmessage(0);
  await session.write("late");
  expect(commands("pty_write")).toEqual([]);
  await session.resizeAndWait(80, 24);
  expect(commands("gterm_resize")).toEqual([
    { command: "gterm_resize", args: { id: 9, cols: 80, rows: 24 } },
  ]);
  await expect(session.readText()).resolves.toBe("native text");
  await session.close();
});

it("orders native key encoding with raw input and negotiated paste", async () => {
  const session = await openSession(new FakeRenderer());
  let finish!: (bytes: number[]) => void;
  ipc.encoded = new Promise((resolve) => {
    finish = resolve;
  });
  const key = session.sendKey({ code: "Enter", mods: 1 });
  const raw = session.write("next");
  const paste = session.paste("one\ntwo");
  await Promise.resolve();
  expect(commands("pty_write")).toEqual([]);
  expect(commands("gterm_encode_input")).toHaveLength(1);
  finish([27, 91, 49, 51, 59, 50, 117]);
  await key;
  ipc.encoded = Promise.resolve([112]);
  await Promise.all([raw, paste]);
  const writes = commands("pty_write").map((call) =>
    new TextDecoder().decode(call.args as Uint8Array),
  );
  expect(writes).toEqual(["\x1b[13;2u", "next", "p"]);
  expect(commands("gterm_encode_input")[1].args).toEqual({
    id: 9,
    event: { kind: "paste", text: "one\ntwo" },
  });
  await session.close();
});

it("rejects an invalid native input reply before writing bytes", async () => {
  const session = await openSession(new FakeRenderer());
  ipc.encoded = Promise.resolve([256]);
  await expect(session.sendKey({ code: "Enter" })).rejects.toThrow("invalid");
  expect(commands("pty_write")).toEqual([]);
  await session.close();
});

it("discards encoded input that finishes after its pane was closed", async () => {
  const session = await openSession(new FakeRenderer());
  let finish!: (bytes: number[]) => void;
  ipc.encoded = new Promise((resolve) => {
    finish = resolve;
  });
  const key = session.sendKey({ code: "Enter" });
  const result = Promise.allSettled([key]);
  await Promise.resolve();
  await session.close();
  finish([13]);
  expect((await result)[0].status).toBe("rejected");
  expect(commands("pty_write")).toEqual([]);
});

it("sends no raw write when the native focus or key encoder emits nothing", async () => {
  const session = await openSession(new FakeRenderer());
  ipc.encoded = Promise.resolve([]);
  await session.setInputFocused(true);
  await session.sendKey({ code: "KeyA", action: "release" });
  expect(commands("pty_write")).toEqual([]);
  await session.close();
});

it("includes encode-only queries in the input budget", async () => {
  const session = await openSession(new FakeRenderer());
  let finish!: (bytes: number[]) => void;
  ipc.encoded = new Promise((resolve) => {
    finish = resolve;
  });
  const query = session.encodeKey({ code: "Enter", mods: 1 });
  try {
    await expect(session.write("x".repeat(1024 * 1024))).rejects.toThrow(
      "queue is full",
    );
  } finally {
    finish([13]);
    await query;
    await session.close();
  }
});

it("does not write an encoded key after a process exit during the query", async () => {
  const session = await openSession(new FakeRenderer());
  let finish!: (bytes: number[]) => void;
  ipc.encoded = new Promise((resolve) => {
    finish = resolve;
  });
  const key = session.sendKey({ code: "Enter" });
  const result = Promise.allSettled([key]);
  await Promise.resolve();
  channelOf(1).onmessage(0);
  finish([13]);
  expect((await result)[0].status).toBe("rejected");
  expect(commands("pty_write")).toEqual([]);
  await session.close();
});

it("keeps an acknowledged native selection snapshot available after normal process exit", async () => {
  const session = await openSession(new FakeRenderer());
  expect(session.getSelection()).toBeNull();
  channelOf(1).onmessage(0);
  await expect(session.select({ kind: "all" })).resolves.toBe(
    "native selection",
  );
  expect(session.getSelection()).toBe("native selection");
  ipc.selection = Promise.resolve(null);
  await session.select({ kind: "clear" });
  expect(session.getSelection()).toBeNull();
  await session.close();
});
it("serializes native selection commands instead of applying stale gesture replies", async () => {
  const session = await openSession(new FakeRenderer());
  let finish!: (text: string) => void;
  ipc.selection = new Promise((resolve) => {
    finish = resolve;
  });
  const first = session.select({ kind: "all" });
  const next = session.select({ kind: "clear" });
  await Promise.resolve();
  expect(commands("gterm_selection")).toHaveLength(1);
  finish("selected");
  await first;
  ipc.selection = Promise.resolve(null);
  await next;
  expect(session.getSelection()).toBeNull();
  await session.close();
});
it("does not resurrect selection text after the panel closes", async () => {
  const session = await openSession(new FakeRenderer());
  let finish!: (text: string) => void;
  ipc.selection = new Promise((resolve) => {
    finish = resolve;
  });
  const query = session.select({ kind: "all" });
  const result = Promise.allSettled([query]);
  await Promise.resolve();
  await session.close();
  finish("late private text");
  expect((await result)[0].status).toBe("rejected");
  expect(session.getSelection()).toBeNull();
});
it("rejects malformed selection replies", async () => {
  const session = await openSession(new FakeRenderer());
  ipc.selection = Promise.resolve({ text: "wrong protocol" });
  await expect(session.select({ kind: "read" })).rejects.toThrow("invalid");
  expect(session.getSelection()).toBeNull();
  await session.close();
});

it("invalidates the old selection snapshot if native mutation formatting fails", async () => {
  const session = await openSession(new FakeRenderer());
  await session.select({ kind: "word", col: 0, row: 0 });
  expect(session.getSelection()).toBe("native selection");
  ipc.selection = Promise.reject(new Error("selection exceeds output limit"));
  await expect(session.select({ kind: "all" })).rejects.toThrow("exceeds");
  expect(session.getSelection()).toBeNull();
  await session.close();
});

it("accepts versioned mode events before and after open while rejecting stale state", async () => {
  const renderer = new FakeRenderer();
  const opening = EngineSession.open(renderer as unknown as GridRenderer, {
    cols: 4,
    rows: 2,
  });
  const args = commands("gterm_open")[0].args as {
    onState: { onmessage: (state: unknown) => void };
  };
  const state = {
    version: 1,
    alternateScreen: true,
    mouseTracking: false,
    bracketedPaste: true,
    focusTracking: false,
    modifyOtherKeys: 2,
    kittyFlags: 0,
    cwd: null,
    shellReady: false,
    commandRunning: false,
    blocksEnabled: false,
    blocksMetadataVersion: 0,
    promptVersion: 0,
  };
  args.onState.onmessage(state);
  ipc.open!.resolve(9);
  const session = await opening;
  expect(session.inputState).toEqual(state);
  args.onState.onmessage({ ...state, version: 0, modifyOtherKeys: 0 });
  expect(session.inputState).toEqual(state);
  args.onState.onmessage({ ...state, version: 2, kittyFlags: 3 });
  expect(session.inputState?.kittyFlags).toBe(3);
  await session.close();
  args.onState.onmessage({ ...state, version: 3 });
  expect(session.inputState).toBeNull();
});

it("shares actual native close completion across repeated callers", async () => {
  const session = await openSession(new FakeRenderer());
  let finish!: () => void;
  ipc.closing = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const first = session.close();
  let closed = false;
  const second = session.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  expect(commands("pty_close")).toHaveLength(1);
  finish();
  await Promise.all([first, second]);
  expect(closed).toBe(true);
});
it("submits text using negotiated paste plus one final carriage return in one write", async () => {
  const session = await openSession(new FakeRenderer());
  ipc.encoded = Promise.resolve([112]);
  await session.submit("command");
  expect(
    new TextDecoder().decode(commands("pty_write")[0].args as Uint8Array),
  ).toBe("p\r");
  expect(commands("gterm_encode_input")[0].args).toEqual({
    id: 9,
    event: { kind: "paste", text: "command" },
  });
  await session.close();
});

it("does not republish an earlier selection while a new selection awaits acknowledgement", async () => {
  const session = await openSession(new FakeRenderer());
  let firstDone!: (text: string) => void;
  ipc.selection = new Promise((resolve) => {
    firstDone = resolve;
  });
  const first = session.select({ kind: "read" });
  const second = session.select({ kind: "all" });
  firstDone("stale text");
  await first;
  expect(session.getSelection()).toBeNull();
  let secondDone!: (text: string) => void;
  ipc.selection = new Promise((resolve) => {
    secondDone = resolve;
  });
  await Promise.resolve();
  secondDone("new selected text");
  await second;
  expect(session.getSelection()).toBe("new selected text");
  await session.close();
});

it("reattaches a live core to a new window renderer and recovers pending frame credit", async () => {
  const first = new FakeRenderer();
  const session = await openSession(first);
  const oldPane = session.pane;
  channelOf(0).onmessage(frameBuffer(70));
  const next = new FakeRenderer();
  session.attachRenderer(next as unknown as GridRenderer);
  expect(session.id).toBe(9);
  expect(first.panes).toHaveLength(0);
  expect(next.panes).toHaveLength(1);
  expect(session.pane).not.toBe(oldPane);
  expect(commands("pty_close")).toHaveLength(0);
  expect(credits()).toHaveLength(0);
  next.drawFrame();
  expect(credits().map((call) => call.args)).toEqual([{ id: 9, seq: 70 }]);
  expect(commands("gterm_request_full")).toHaveLength(1);
  channelOf(0).onmessage(frameBuffer(71));
  next.drawFrame();
  expect(next.applied).toHaveLength(1);
  session.attachRenderer(next as unknown as GridRenderer);
  expect(next.panes).toHaveLength(1);
  await session.close();
});

it("invalidates a failed renderer migration while keeping its original pane available for cleanup", async () => {
  const first = new FakeRenderer();
  const session = await openSession(first);
  const old = session.pane;
  const next = new FakeRenderer();
  vi.spyOn(next, "addPane").mockImplementation(() => {
    throw new Error("GPU allocation failed");
  });
  expect(() => session.attachRenderer(next as unknown as GridRenderer)).toThrow(
    "GPU allocation failed",
  );
  expect(first.panes.map((item) => item.pane)).toContain(old);
  await expect(
    session.write("must not reach broken presentation"),
  ).rejects.toThrow();
  await session.close();
  expect(first.panes).toHaveLength(0);
});

it("searches through the native core and rejects stale or malformed replies", async () => {
  const session = await openSession(new FakeRenderer());
  const command = {
    kind: "find",
    query: "needle",
    forward: true,
    incremental: true,
  } as const;
  expect(await session.search(command)).toBe(true);
  expect(commands("gterm_search")).toEqual([
    { command: "gterm_search", args: { id: 9, command } },
  ]);
  ipc.search = Promise.resolve("not a boolean");
  await expect(session.search(command)).rejects.toThrow(
    "invalid terminal search reply",
  );
  let finish!: (found: boolean) => void;
  ipc.search = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  const pending = session.search(command);
  const settled = Promise.allSettled([pending]);
  await session.close();
  finish(true);
  expect((await settled)[0].status).toBe("rejected");
  await expect(session.search(command)).rejects.toThrow("unavailable");
  expect(commands("gterm_search")).toHaveLength(3);
});

it("queries links in the drawn sequence and rejects a late result after close", async () => {
  const renderer = new FakeRenderer();
  const session = await openSession(renderer);
  channelOf(0).onmessage(frameBuffer(1));
  expect(session.drawnSeq).toBeNull();
  expect(session.drawnGrid).toBeNull();
  await expect(session.linkContext(1, 1, 0)).resolves.toBeNull();
  expect(commands("gterm_link_context")).toHaveLength(0);
  renderer.drawFrame();
  expect(session.drawnSeq).toBe(1);
  expect(session.drawnGrid).toEqual({ seq: 1, cols: 4, rows: 2 });
  const reply = {
    seq: 1,
    cols: 4,
    viewportRows: 2,
    text: "ok",
    offset: 1,
    startClipped: false,
    endClipped: false,
    rows: [
      {
        row: 0,
        startCol: 0,
        cells: [
          [0, 1],
          [1, 2],
        ],
      },
    ],
    osc8: null,
  };
  ipc.link = Promise.resolve(reply);
  channelOf(0).onmessage(frameBuffer(2));
  expect(session.drawnSeq).toBe(1);
  await expect(session.linkContext(1, 1, 0)).resolves.toEqual(reply);
  expect(commands("gterm_link_context")[0].args).toEqual({
    id: 9,
    seq: 1,
    col: 1,
    row: 0,
  });
  renderer.drawFrame();
  expect(session.drawnSeq).toBe(2);
  let finish!: (value: unknown) => void;
  ipc.link = new Promise((resolve) => {
    finish = resolve;
  });
  const pending = session.linkContext(2, 1, 0);
  const settled = Promise.allSettled([pending]);
  await session.close();
  finish({ ...reply, seq: 2 });
  expect((await settled)[0].status).toBe("rejected");
});

it("passes the explicit native blocks option to the real open boundary", async () => {
  const opening = EngineSession.open(
    new FakeRenderer() as unknown as GridRenderer,
    {
      cols: 4,
      rows: 2,
      blocks: true,
    },
  );
  const args = commands("gterm_open")[0].args as Record<string, unknown>;
  const pendingOpen = ipc.open;
  if (!pendingOpen) throw new Error("Missing native open fixture");
  pendingOpen.resolve(9);
  const session = await opening;
  expect(args.blocks).toBe(true);
  await session.close();
});

const blockSnapshot = () => ({
  seq: 1,
  metadataVersion: 2,
  hasAny: true,
  alternateScreen: false,
  viewportOffset: 0,
  viewportRows: 2,
  blocks: [
    {
      id: "b1",
      command: "printf one",
      cwd: "/workspace",
      exitCode: 0,
      running: false,
      headerLine: null,
      startLine: 0,
      endLine: 0,
      startedAt: 1,
      finishedAt: 2,
    },
  ],
});
it("queries blocks only for the presented frame and rejects stale or replaced replies", async () => {
  const renderer = new FakeRenderer();
  const session = await openSession(renderer);
  expect(await session.blocks(1)).toBeNull();
  expect(commands("gterm_blocks")).toHaveLength(0);
  channelOf(0).onmessage(frameBuffer(1));
  renderer.drawFrame();
  ipc.blocks = Promise.resolve(blockSnapshot());
  expect(await session.blocks(1)).toEqual(blockSnapshot());
  let resolve!: (value: unknown) => void;
  ipc.blocks = new Promise((r) => {
    resolve = r;
  });
  const pending = session.blocks(1);
  channelOf(0).onmessage(frameBuffer(2));
  renderer.drawFrame();
  resolve(blockSnapshot());
  expect(await pending).toBeNull();
  await session.close();
});
it("validates block IDs before IPC and discards delayed output after close", async () => {
  const session = await openSession(new FakeRenderer());
  await expect(session.readBlock("b0")).rejects.toThrow("invalid");
  expect(commands("gterm_read_block")).toHaveLength(0);
  let resolve!: (value: unknown) => void;
  ipc.blockOutput = new Promise((r) => {
    resolve = r;
  });
  const pending = session.readBlock("b1");
  const rejected = expect(pending).rejects.toThrow("unavailable");
  await session.close();
  resolve({
    command: "printf one",
    cwd: "/workspace",
    exitCode: 0,
    output: "one",
  });
  await rejected;
});
it("shares bounded client admission between presented metadata and block reads", async () => {
  const renderer = new FakeRenderer();
  const session = await openSession(renderer);
  channelOf(0).onmessage(frameBuffer(1));
  renderer.drawFrame();
  let metadata!: (value: unknown) => void;
  let output!: (value: unknown) => void;
  ipc.blocks = new Promise((r) => {
    metadata = r;
  });
  ipc.blockOutput = new Promise((r) => {
    output = r;
  });
  const pending = [
    ...Array.from({ length: 16 }, () => session.blocks(1)),
    ...Array.from({ length: 16 }, () => session.readBlock("b1")),
  ];
  await expect(session.readBlock("b1")).rejects.toThrow("pending");
  await expect(session.blocks(1)).rejects.toThrow("pending");
  metadata(blockSnapshot());
  output(null);
  await Promise.all(pending);
  await session.close();
});

it("orders block selection with pointer selection and snapshots queued commands", async () => {
  const session = await openSession(new FakeRenderer());
  let resolve!: (value: unknown) => void;
  ipc.selection = new Promise((r) => {
    resolve = r;
  });
  const pointer = session.select({ kind: "word", col: 0, row: 0 });
  const command = { kind: "navigate", direction: -1 } as const;
  ipc.blockAction = Promise.resolve({
    kind: "selection",
    applied: true,
    blockId: "b1",
    selection: "block one",
  });
  const block = session.blockAction(command);
  Object.assign(command, { direction: 1 });
  await Promise.resolve();
  expect(commands("gterm_block_action")).toHaveLength(0);
  resolve("pointer word");
  await pointer;
  const reply = await block;
  expect(reply).toMatchObject({ kind: "selection", selection: "block one" });
  expect(commands("gterm_block_action")[0].args).toEqual({
    id: 9,
    command: { kind: "navigate", direction: -1 },
  });
  expect(session.getSelection()).toBe("block one");
  ipc.blockAction = Promise.resolve({
    kind: "selection",
    applied: true,
    blockId: "b1",
    selection: 42,
  });
  await expect(
    session.blockAction({ kind: "select", blockId: "b1" }),
  ).rejects.toThrow("invalid");
  expect(session.getSelection()).toBeNull();
  await session.close();
});
it("does not replace newer pointer selection with an older block receipt", async () => {
  const session = await openSession(new FakeRenderer());
  let resolve!: (value: unknown) => void;
  ipc.blockAction = new Promise((r) => {
    resolve = r;
  });
  const block = session.blockAction({ kind: "select", blockId: "b1" });
  const pointer = session.select({ kind: "word", col: 0, row: 0 });
  await Promise.resolve();
  resolve({
    kind: "selection",
    applied: true,
    blockId: "b1",
    selection: "old block",
  });
  await block;
  expect(await pointer).toBe("native selection");
  expect(session.getSelection()).toBe("native selection");
  await session.close();
});
it("shares block-action admission with output reads and rejects before IPC", async () => {
  const session = await openSession(new FakeRenderer());
  await expect(
    session.blockAction({ kind: "navigate", direction: 0 } as never),
  ).rejects.toThrow("invalid");
  expect(commands("gterm_block_action")).toHaveLength(0);
  let output!: (value: unknown) => void;
  ipc.blockOutput = new Promise((r) => {
    output = r;
  });
  let actionReply!: (value: unknown) => void;
  ipc.blockAction = new Promise((resolve) => {
    actionReply = resolve;
  });
  const pending = Array.from({ length: 31 }, () => session.readBlock("b1"));
  const action = session.blockAction({ kind: "clearSearch" });
  await expect(session.blockAction({ kind: "clearSearch" })).rejects.toThrow(
    "pending",
  );
  await expect(session.readBlock("b1")).rejects.toThrow("pending");
  output(null);
  actionReply({ kind: "cleared" });
  await Promise.all([...pending, action]);
  await session.close();
});
it("rejects delayed block-action replies after its engine is closed", async () => {
  const session = await openSession(new FakeRenderer());
  let resolve!: (value: unknown) => void;
  ipc.blockAction = new Promise((r) => {
    resolve = r;
  });
  const pending = session.blockAction({
    kind: "find",
    blockId: "b1",
    query: "one",
  });
  const rejected = expect(pending).rejects.toThrow("unavailable");
  await Promise.resolve();
  await session.close();
  resolve({ kind: "matches", version: 1, matches: [] });
  await rejected;
});
