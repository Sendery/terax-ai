import { expect, it, vi } from "vitest";
import {
  TerminalSessionController,
  type TerminalEngine,
} from "@/modules/terminal/lib/terminalEngine";

function driver(id = 7): TerminalEngine {
  return {
    id,
    write: vi.fn(async () => {}),
    resize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}

function opening() {
  let finish!: (engine: TerminalEngine) => void;
  const promise = new Promise<TerminalEngine>((resolve) => {
    finish = resolve;
  });
  const onError = vi.fn();
  const onExit = vi.fn();
  const factory = vi.fn(() => promise);
  const session = new TerminalSessionController(
    factory,
    { cols: 80, rows: 24 },
    { onError, onExit },
  );
  return { session, finish, factory, onError, onExit };
}

it("opens one engine, preserves startup input order and replays the latest size", async () => {
  const t = opening();
  expect(t.session.write("first")).toBe(true);
  expect(t.session.write("second")).toBe(true);
  t.session.resize(90, 30);
  t.session.resize(100, 40);
  const engine = driver();
  t.finish(engine);
  await t.session.opened;
  expect(t.factory).toHaveBeenCalledTimes(1);
  expect(engine.resize).toHaveBeenCalledExactlyOnceWith(100, 40);
  expect(engine.write).toHaveBeenCalledExactlyOnceWith("firstsecond");
  expect(t.session.id).toBe(7);
  await t.session.close();
});

it("closes a late successful open exactly once when its pane was already removed", async () => {
  const t = opening();
  const closing = t.session.close();
  expect(t.session.close()).toBe(closing);
  let completed = false;
  void closing.then(() => {
    completed = true;
  });
  await Promise.resolve();
  expect(completed).toBe(false);
  const engine = driver();
  t.finish(engine);
  await closing;
  await expect(t.session.opened).rejects.toThrow("closed");
  expect(engine.close).toHaveBeenCalledTimes(1);
  expect(t.session.write("late")).toBe(false);
  expect(t.session.id).toBeNull();
  expect(t.onError).not.toHaveBeenCalled();
});

it("serializes writes to an attached engine and stops queued writes after close", async () => {
  const t = opening();
  const engine = driver();
  let release!: () => void;
  const first = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(engine.write).mockImplementationOnce(() => first);
  t.finish(engine);
  await t.session.opened;
  t.session.write("a");
  t.session.write("b");
  await Promise.resolve();
  expect(engine.write).toHaveBeenCalledTimes(1);
  await t.session.close();
  release();
  await t.session.settled();
  expect(engine.write).toHaveBeenCalledExactlyOnceWith("a");
  expect(engine.close).toHaveBeenCalledTimes(1);
});

it("rejects startup overflow explicitly while retaining all previously accepted input", async () => {
  const t = opening();
  const accepted = "a".repeat(256 * 1024);
  expect(t.session.write(accepted)).toBe(true);
  expect(t.session.write("b")).toBe(false);
  expect(t.onError).toHaveBeenCalledTimes(1);
  const engine = driver();
  t.finish(engine);
  await t.session.opened;
  expect(engine.write).toHaveBeenCalledExactlyOnceWith(accepted);
  await t.session.close();
});

it("surfaces failed opens and never accepts input after failure", async () => {
  const error = new Error("spawn denied");
  const onError = vi.fn();
  const session = new TerminalSessionController(
    async () => {
      throw error;
    },
    { cols: 80, rows: 24 },
    { onError },
  );
  await expect(session.opened).rejects.toBe(error);
  expect(onError).toHaveBeenCalledExactlyOnceWith(error);
  expect(session.write("ignored")).toBe(false);
  await session.close();
});

it("retains the first engine exit and prevents post-exit input", async () => {
  const onExit = vi.fn();
  let exit!: (code: number) => void;
  const engine = driver();
  const session = new TerminalSessionController(
    async (_size, observer) => {
      exit = observer.onExit;
      return engine;
    },
    { cols: 80, rows: 24 },
    { onExit },
  );
  await session.opened;
  exit(-2);
  exit(0);
  expect(onExit).toHaveBeenCalledExactlyOnceWith(-2);
  expect(session.write("late")).toBe(false);
  await session.close();
});

it("surfaces a write failure once and does not send later queued input", async () => {
  const t = opening();
  const engine = driver();
  const failure = new Error("PTY closed");
  vi.mocked(engine.write).mockRejectedValueOnce(failure);
  t.finish(engine);
  await t.session.opened;
  t.session.write("a");
  t.session.write("b");
  await t.session.settled();
  expect(t.onError).toHaveBeenCalledExactlyOnceWith(failure);
  expect(engine.write).toHaveBeenCalledExactlyOnceWith("a");
  expect(t.session.write("c")).toBe(false);
  await t.session.close();
});

it("does not let new input overtake startup input while resize is pending", async () => {
  const t = opening();
  const engine = driver();
  let release!: () => void;
  let started!: () => void;
  const resizing = new Promise<void>((resolve) => {
    release = resolve;
  });
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  vi.mocked(engine.resize).mockImplementationOnce(() => {
    started();
    return resizing;
  });
  t.session.write("first");
  t.session.resize(100, 40);
  t.finish(engine);
  await began;
  t.session.write("second");
  release();
  await t.session.opened;
  expect(engine.write).toHaveBeenCalledExactlyOnceWith("firstsecond");
  await t.session.close();
});

it("serializes asynchronous resizes so the latest dimensions finish last", async () => {
  const t = opening();
  const engine = driver();
  t.finish(engine);
  await t.session.opened;
  let release!: () => void;
  const first = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(engine.resize).mockImplementationOnce(() => first);
  t.session.resize(90, 30);
  t.session.resize(100, 40);
  await Promise.resolve();
  expect(engine.resize).toHaveBeenCalledTimes(1);
  release();
  await t.session.layoutSettled();
  const calls = vi.mocked(engine.resize).mock.calls;
  expect(calls[calls.length - 1]).toEqual([100, 40]);
  await t.session.close();
});

it("retires an acquired engine exactly once when initial resize fails", async () => {
  const t = opening();
  const engine = driver();
  const error = new Error("resize failed");
  vi.mocked(engine.resize).mockRejectedValueOnce(error);
  t.session.resize(100, 40);
  t.finish(engine);
  await expect(t.session.opened).rejects.toBe(error);
  expect(engine.close).toHaveBeenCalledTimes(1);
  await t.session.close();
  expect(engine.close).toHaveBeenCalledTimes(1);
  expect(t.onError).toHaveBeenCalledExactlyOnceWith(error);
});

it("retires an engine returned after the factory already reported failure", async () => {
  const engine = driver();
  const error = new Error("engine failed during startup");
  const session = new TerminalSessionController(
    async (_size, observer) => {
      observer.onError(error);
      return engine;
    },
    { cols: 80, rows: 24 },
  );
  await expect(session.opened).rejects.toBe(error);
  expect(engine.close).toHaveBeenCalledTimes(1);
  await session.close();
  expect(engine.close).toHaveBeenCalledTimes(1);
});

it("makes a failed late teardown observable through close and its observer", async () => {
  const t = opening();
  const engine = driver();
  const error = new Error("cleanup failed");
  vi.mocked(engine.close).mockRejectedValueOnce(error);
  const closed = t.session.close();
  const settled = Promise.allSettled([closed]);
  t.finish(engine);
  expect((await settled)[0]).toEqual({ status: "rejected", reason: error });
  await expect(t.session.opened).rejects.toThrow("closed");
  expect(t.onError).toHaveBeenCalledExactlyOnceWith(error);
  expect(engine.close).toHaveBeenCalledTimes(1);
});

it("keeps presentation resizing after process exit while rejecting input", async () => {
  const engine = driver();
  let exit!: (code: number) => void;
  const session = new TerminalSessionController(
    async (_size, observer) => {
      exit = observer.onExit;
      return engine;
    },
    { cols: 80, rows: 24 },
  );
  await session.opened;
  exit(0);
  session.resize(100, 30);
  await session.layoutSettled();
  expect(engine.resize).toHaveBeenCalledExactlyOnceWith(100, 30);
  expect(session.write("late")).toBe(false);
  expect(engine.close).not.toHaveBeenCalled();
  await session.close();
});

it("discards queued input when the process exits during an earlier write", async () => {
  const engine = driver();
  let finish!: () => void;
  vi.mocked(engine.write).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  let exit!: (code: number) => void;
  const session = new TerminalSessionController(
    async (_size, observer) => {
      exit = observer.onExit;
      return engine;
    },
    { cols: 80, rows: 24 },
  );
  await session.opened;
  session.write("A");
  session.write("B");
  await Promise.resolve();
  exit(0);
  finish();
  await session.settled();
  expect(engine.write).toHaveBeenCalledExactlyOnceWith("A");
  await session.close();
});
