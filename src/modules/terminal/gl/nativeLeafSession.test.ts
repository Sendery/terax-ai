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
    },
    close: vi.fn(() => closing),
    write: vi.fn(async () => {}),
    resizeAndWait: vi.fn(async () => {}),
    setColors: vi.fn(),
    requestFull: vi.fn(),
    attachRenderer: vi.fn(),
    getSelection: vi.fn(() => null),
    readText: vi.fn(async () => "history"),
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
