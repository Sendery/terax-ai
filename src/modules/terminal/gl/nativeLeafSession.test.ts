import { expect, it, vi } from "vitest";
import { NativeLeafSession } from "@/modules/terminal/gl/nativeLeafSession";
import type { EngineSession } from "@/modules/terminal/gl/engineSession";
import type { GridRenderer } from "@/modules/terminal/gl/gridRenderer";
import { FALLBACK_ENGINE_COLORS } from "@/modules/terminal/gl/appearance";
vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => ({ kind: "local" }),
}));
const renderer = {
  setPaneRect: vi.fn(),
  setPaneFocused: vi.fn(),
} as unknown as GridRenderer;
function driver(id: number, closing: Promise<void> = Promise.resolve()) {
  return {
    id,
    pane: {},
    inputState: {
      version: 0,
      alternateScreen: false,
      mouseTracking: false,
      bracketedPaste: false,
      focusTracking: false,
      modifyOtherKeys: 0,
      kittyFlags: 0,
      cwd: null,
      shellReady: false,
      commandRunning: false,
    },
    close: vi.fn(() => closing),
    write: vi.fn(async () => {}),
    resizeAndWait: vi.fn(async () => {}),
    setColors: vi.fn(),
    requestFull: vi.fn(),
    attachRenderer: vi.fn(),
    getSelection: vi.fn(() => null),
    readText: vi.fn(async () => "history"),
    search: vi.fn(async () => true),
    encodeKey: vi.fn(async () => "\x1b\r"),
    paste: vi.fn(async () => {}),
    submit: vi.fn(async () => {}),
  };
}
function view() {
  return {
    onSession: vi.fn(),
    onFrame: vi.fn(),
    onError: vi.fn(),
    onExit: vi.fn(),
    focus: vi.fn(),
    focused: () => false,
  };
}
const config = () => ({
  renderer,
  size: { cols: 80, rows: 24 },
  colors: FALLBACK_ENGINE_COLORS,
  cwd: "/workspace",
});
it("keeps the same process when a split or move detaches and reattaches its view", async () => {
  const native = driver(9);
  const open = vi.fn(async () => native as unknown as EngineSession);
  const session = new NativeLeafSession(config(), open);
  const first = view();
  const detach = session.attach(first, config());
  await session.opened;
  expect(session.id).toBe(9);
  detach();
  expect(native.close).not.toHaveBeenCalled();
  const next = view();
  session.attach(next, config());
  expect(open).toHaveBeenCalledOnce();
  expect(session.id).toBe(9);
  expect(next.onSession).toHaveBeenCalledWith(native);
  expect(session.write("keep agent running")).toBe(true);
  await session.readText();
  expect(native.write).toHaveBeenCalledWith("keep agent running");
  await session.dispose();
});
it("does not let old view cleanup detach a replacement", async () => {
  const native = driver(9);
  const session = new NativeLeafSession(
    config(),
    async () => native as unknown as EngineSession,
  );
  const old = view();
  const cleanup = session.attach(old, config());
  await session.opened;
  const next = view();
  session.attach(next, config());
  cleanup();
  session.focus();
  expect(next.focus).toHaveBeenCalledOnce();
  expect(native.close).not.toHaveBeenCalled();
  await session.dispose();
});
it("waits for the previous close before opening a replacement process", async () => {
  let finish!: () => void;
  const closing = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const first = driver(9, closing);
  const next = driver(10);
  const open = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(next);
  const session = new NativeLeafSession(config(), open);
  session.attach(view(), config());
  await session.opened;
  const restarted = session.respawn("/next");
  await Promise.resolve();
  expect(open).toHaveBeenCalledOnce();
  finish();
  await restarted;
  expect(open).toHaveBeenCalledTimes(2);
  expect(session.id).toBe(10);
  await session.dispose();
});
it("does not open a replacement after retirement failed", async () => {
  let fail!: (cause: unknown) => void;
  const closing = new Promise<void>((_yes, no) => {
    fail = no;
  });
  const first = driver(9, closing);
  const open = vi.fn(async () => first as unknown as EngineSession);
  const session = new NativeLeafSession(config(), open);
  await session.opened;
  const restarted = session.respawn();
  const result = Promise.allSettled([restarted]);
  const error = new Error("close rejected");
  fail(error);
  expect((await result)[0]).toMatchObject({
    status: "rejected",
    reason: error,
  });
  await expect(session.respawn()).rejects.toBe(error);
  expect(open).toHaveBeenCalledOnce();
  await session.dispose().catch(() => {});
});

it("reattaches a retired view without touching its closed renderer pane", async () => {
  let finish!: () => void;
  const closing = new Promise<void>((yes) => {
    finish = yes;
  });
  const first = driver(9, closing);
  first.close.mockImplementation(() => {
    first.id = null as unknown as number;
    return closing;
  });
  const open = vi
    .fn()
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(driver(10));
  const session = new NativeLeafSession(config(), open);
  await session.opened;
  const restart = session.respawn();
  first.attachRenderer.mockClear();
  const nextView = view();
  expect(() => session.attach(nextView, config())).not.toThrow();
  expect(first.attachRenderer).not.toHaveBeenCalled();
  finish();
  await restart;
  await session.dispose();
});
it("does not paste a delayed clipboard into the replacement process", async () => {
  let clipboard!: (text: string) => void;
  const first = driver(9);
  const next = driver(10);
  const session = new NativeLeafSession(
    config(),
    vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(next),
  );
  await session.opened;
  const paste = session.pasteFromClipboard(
    () =>
      new Promise<string>((yes) => {
        clipboard = yes;
      }),
  );
  await session.respawn();
  clipboard("old process paste");
  await paste;
  expect(next.paste).not.toHaveBeenCalled();
  expect(first.paste).not.toHaveBeenCalled();
  await session.dispose();
});
it("closes the process even if detaching the DOM view throws", async () => {
  const native = driver(9);
  const session = new NativeLeafSession(
    config(),
    async () => native as unknown as EngineSession,
  );
  const attached = view();
  session.attach(attached, config());
  await session.opened;
  attached.onSession.mockImplementation((engine) => {
    if (engine === null) throw new Error("DOM teardown failed");
  });
  await session.dispose();
  expect(native.close).toHaveBeenCalled();
});

it("isolates a throwing view frame callback from the native channel", async () => {
  let frame!: () => void;
  const native = driver(9);
  const session = new NativeLeafSession(
    config(),
    async (_renderer, options) => {
      frame = () =>
        options.observer.onFrame?.({
          seq: 1,
          bytes: 0,
          receivedAt: 0,
          frame: null,
        });
      return native as unknown as EngineSession;
    },
  );
  const attached = view();
  attached.onFrame.mockImplementation(() => {
    throw new Error("view frame failed");
  });
  session.attach(attached, config());
  await session.opened;
  expect(() => frame()).not.toThrow();
  expect(attached.onError).toHaveBeenCalled();
  await session.dispose();
});

it("reports actual shell readiness and cwd, including after a view remount", async () => {
  let state!: NonNullable<
    import("@/modules/terminal/gl/engineSession").SessionObserver["onState"]
  >;
  const onReady = vi.fn();
  const onResetReady = vi.fn();
  const native = driver(9);
  const session = new NativeLeafSession(
    { ...config(), onReady, onResetReady },
    async (_renderer, options) => {
      state = options.observer.onState!;
      return native as unknown as EngineSession;
    },
  );
  const first = { ...view(), onCwd: vi.fn() };
  const detach = session.attach(first, { ...config(), onReady, onResetReady });
  await session.opened;
  expect(onReady).not.toHaveBeenCalled();
  expect(session.cwd).toBeNull();
  state({
    ...native.inputState,
    version: 1,
    cwd: "/workspace/one",
    shellReady: true,
    commandRunning: false,
  });
  expect(onReady).toHaveBeenCalledOnce();
  expect(first.onCwd).toHaveBeenCalledWith("/workspace/one");
  expect(session.cwd).toBe("/workspace/one");
  detach();
  const next = { ...view(), onCwd: vi.fn() };
  session.attach(next, { ...config(), onReady, onResetReady });
  expect(next.onCwd).toHaveBeenCalledWith("/workspace/one");
  expect(onReady).toHaveBeenCalledOnce();
  await session.dispose();
});

it("retires the native process even if readiness-reset notification throws", async () => {
  const onResetReady = vi.fn();
  const native = driver(9);
  const session = new NativeLeafSession(
    { ...config(), onResetReady },
    async () => native as unknown as EngineSession,
  );
  await session.opened;
  onResetReady.mockImplementation(() => {
    throw new Error("readiness observer failed");
  });
  await session.dispose();
  expect(native.close).toHaveBeenCalled();
});

it("ignores readiness from an opening process already being replaced", async () => {
  const onReady = vi.fn();
  const onResetReady = vi.fn();
  const observers: import("@/modules/terminal/gl/engineSession").SessionObserver[] =
    [];
  let release!: (engine: EngineSession) => void;
  let called!: () => void;
  const acquired = new Promise<void>((yes) => {
    called = yes;
  });
  const first = new Promise<EngineSession>((yes) => {
    release = yes;
  });
  const open = vi.fn(async (_renderer, options) => {
    observers.push(options.observer);
    called();
    return observers.length === 1
      ? first
      : (driver(10) as unknown as EngineSession);
  });
  const session = new NativeLeafSession(
    { ...config(), onReady, onResetReady },
    open,
  );
  await acquired;
  const restart = session.respawn();
  observers[0].onState?.({
    ...driver(9).inputState,
    version: 1,
    cwd: "/stale",
    shellReady: true,
  });
  expect(onReady).not.toHaveBeenCalled();
  release(driver(9) as unknown as EngineSession);
  await restart;
  observers[1].onState?.({
    ...driver(10).inputState,
    version: 1,
    cwd: "/current",
    shellReady: true,
  });
  expect(onReady).toHaveBeenCalledOnce();
  expect(session.cwd).toBe("/current");
  await session.dispose();
});
it("does not mark an exited shell ready from a delayed state message", async () => {
  const onReady = vi.fn();
  let observer!: import("@/modules/terminal/gl/engineSession").SessionObserver;
  const session = new NativeLeafSession(
    { ...config(), onReady },
    async (_renderer, options) => {
      observer = options.observer;
      return driver(9) as unknown as EngineSession;
    },
  );
  await session.opened;
  observer.onExit?.(0);
  observer.onState?.({
    ...driver(9).inputState,
    version: 1,
    cwd: "/finished",
    shellReady: true,
  });
  expect(onReady).not.toHaveBeenCalled();
  expect(session.shellReady).toBe(false);
  await session.dispose();
});

it("keeps search after process exit and isolates old adapters from respawn", async () => {
  const first = driver(9);
  const next = driver(10);
  let exit!: (code: number) => void;
  const open = vi.fn(
    async (
      _renderer: GridRenderer,
      options: {
        observer: import("@/modules/terminal/gl/engineSession").SessionObserver;
      },
    ): Promise<EngineSession> => {
      exit = (code) => options.observer.onExit?.(code);
      return (open.mock.calls.length === 1
        ? first
        : next) as unknown as EngineSession;
    },
  );
  const session = new NativeLeafSession(config(), open);
  await session.opened;
  const oldSearch = session.search;
  exit(0);
  await expect(oldSearch.findNext("history")).resolves.toBe(true);
  expect(first.search).toHaveBeenCalledOnce();
  await session.respawn();
  expect(session.search).not.toBe(oldSearch);
  await expect(oldSearch.clearDecorations()).resolves.toBeUndefined();
  await expect(oldSearch.findNext("old query")).rejects.toThrow(
    "no longer available",
  );
  expect(next.search).not.toHaveBeenCalled();
  await expect(session.search.findNext("new query")).resolves.toBe(true);
  expect(next.search).toHaveBeenCalledOnce();
  await session.dispose();
});

it("rejects an in-flight result when respawn replaces its owner", async () => {
  let finish!: (found: boolean) => void;
  const first = driver(9);
  first.search.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  const next = driver(10);
  const open = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(next);
  const session = new NativeLeafSession(config(), open);
  await session.opened;
  const pending = session.search.findNext("old query");
  const settled = Promise.allSettled([pending]);
  await Promise.resolve();
  expect(first.search).toHaveBeenCalledOnce();
  await session.respawn();
  finish(true);
  expect((await settled)[0].status).toBe("rejected");
  expect(next.search).not.toHaveBeenCalled();
  await session.dispose();
});
