import { afterEach, beforeEach, expect, it, vi } from "vitest";
const harness = vi.hoisted(() => ({
  effects: [] as (() => unknown)[],
  pty: {
    id: 9,
    write: vi.fn(async (_text: string) => {}),
    close: vi.fn(),
    resize: vi.fn(),
  },
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (value: unknown) => ({ current: value }),
  useEffect: (effect: () => unknown) => {
    harness.effects.push(effect);
  },
  useLayoutEffect: () => {},
  useCallback: (callback: unknown) => callback,
  useMemo: (read: () => unknown) => read(),
  useState: (value: unknown) => [value, vi.fn()],
}));
vi.mock("@/modules/terminal/lib/useTerminalFont", () => ({
  useTerminalFont: () => ({
    fontFamily: "monospace",
    fontWeight: 400,
    fontSize: 14,
  }),
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: (select: (value: unknown) => unknown) => select({}),
}));
vi.mock("@/modules/terminal/lib/rendererPool", () => {
  const names = [
    "acquireSlot",
    "applyBackgroundActive",
    "applyCursorBlink",
    "applyLetterSpacing",
    "applyTerminalFont",
    "applyTheme",
    "applyScrollback",
    "applyWebglPreference",
    "configureRendererPool",
    "discardRetainedSlot",
    "disposeLeafSlot",
    "focusSlot",
    "getLiveSlotForLeaf",
    "getSlotForLeaf",
    "isLeafAltScreen",
    "parkLeafSlot",
    "poolAtlasBytes",
    "poolSize",
    "poolSlotStats",
    "refreshLeafSlot",
    "releaseSlot",
    "setSlotFocused",
  ];
  return Object.fromEntries(names.map((name) => [name, vi.fn(() => null)]));
});
vi.mock("@/modules/terminal/lib/pty-bridge", () => ({
  openPty: async () => harness.pty,
}));
vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => ({ kind: "local" }),
}));
vi.mock("@/modules/terminal/lib/agentActivity", () => ({
  ensureAgentActivityListener: () => {},
  isAgentActivePty: () => false,
}));
import {
  captureLeafSubmission,
  disposeSession,
  markSessionReady,
  resetSessionReady,
  respawnSession,
  useTerminalSession,
} from "@/modules/terminal/lib/useTerminalSession";
import {
  registerNativeLeaf,
  takeNativeLeaf,
  type NativeLeaf,
} from "@/modules/terminal/gl/nativeLeafRegistry";

const leafId = 853;
function LegacyHarness() {
  useTerminalSession({ leafId, container: { current: null }, visible: false });
}
function nativeLeaf() {
  return {
    submissionIdentity: {},
    id: 9 as number | null,
    cwd: "/repo",
    shellReady: true as boolean,
    commandRunning: false,
    exited: false,
    focused: false,
    tuiReady: false,
    alternateScreen: false,
    getSelection: () => null,
    write: () => true,
    paste: async () => {},
    submit: vi.fn(async (_text: string) => {}),
    focus: () => {},
    repaint: () => {},
    dispose: async () => {},
    respawn: async () => {},
  } satisfies NativeLeaf;
}
beforeEach(() => {
  harness.effects = [];
  harness.pty.id = 9;
  harness.pty.write.mockClear();
  harness.pty.close.mockClear();
  harness.pty.resize.mockClear();
  vi.stubGlobal("document", { fonts: { ready: Promise.resolve() } });
});
afterEach(() => {
  takeNativeLeaf(leafId);
  disposeSession(leafId);
  resetSessionReady(leafId);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("binds the native submitter to the original owner while opening", async () => {
  const native = nativeLeaf();
  native.id = null;
  native.shellReady = false;
  registerNativeLeaf(leafId, native);
  const captured = captureLeafSubmission(leafId);
  const result = captured?.submitWhenReady("resume", 15000);
  native.submissionIdentity = {};
  native.id = 10;
  native.shellReady = true;
  markSessionReady(leafId);
  expect(await result).toBe(false);
  expect(native.submit).not.toHaveBeenCalled();
});
it("never writes to a replacement registered under the same native leaf id", async () => {
  const first = nativeLeaf();
  registerNativeLeaf(leafId, first);
  const result = captureLeafSubmission(leafId)?.submitWhenReady(
    "resume",
    15000,
  );
  takeNativeLeaf(leafId);
  const next = nativeLeaf();
  next.id = 10;
  registerNativeLeaf(leafId, next);
  markSessionReady(leafId);
  expect(await result).toBe(false);
  expect(first.submit).not.toHaveBeenCalled();
  expect(next.submit).not.toHaveBeenCalled();
});
it("does not turn a native readiness timeout into a submission", async () => {
  vi.useFakeTimers();
  const native = nativeLeaf();
  native.shellReady = false;
  registerNativeLeaf(leafId, native);
  const result = captureLeafSubmission(leafId)?.submitWhenReady("resume", 5);
  await vi.advanceTimersByTimeAsync(5);
  expect(await result).toBe(false);
  expect(native.submit).not.toHaveBeenCalled();
});
it("invalidates legacy captures before respawn while retaining the same leaf and Session object", async () => {
  LegacyHarness();
  harness.effects[0]();
  await respawnSession(leafId, "/repo");
  const old = captureLeafSubmission(leafId);
  const result = old?.submitWhenReady("old resume", 15000);
  await respawnSession(leafId, "/next");
  markSessionReady(leafId);
  expect(await result).toBe(false);
  expect(harness.pty.write).not.toHaveBeenCalled();
  const current = captureLeafSubmission(leafId);
  expect(await current?.submitWhenReady("first\nsecond", 15000)).toBe(true);
  expect(harness.pty.write).toHaveBeenCalledExactlyOnceWith(
    "\x1b[200~first\nsecond\x1b[201~\r",
  );
});
