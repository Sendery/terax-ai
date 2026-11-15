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
  usePreferencesStore: (select: (value: unknown) => unknown) => select({ shortcuts: {} }),
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
import { MOD_PROP } from "@/lib/platform";
import { useGlobalShortcuts } from "@/modules/shortcuts/lib/useGlobalShortcuts";
import { getSlotForLeaf } from "@/modules/terminal/lib/rendererPool";
import {
  captureLeafInput,
  canClearActiveLeaf,
  clearActiveLeaf,
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
    exited: false as boolean,
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
  vi.mocked(getSlotForLeaf).mockReturnValue(null);
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

it("guards owned native input while its raw write is pending", async () => {
  const native = nativeLeaf();
  let finish = () => {};
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const written = vi.fn();
  Object.assign(native, {
    writeOwned: async (text: string, current: () => boolean) => {
      await gate;
      if (!current()) throw new Error("retired");
      written(text);
    },
    encodeShiftEnter: async () => "\x1b[13;2u",
    readText: async () => "public",
  });
  registerNativeLeaf(leafId, native);
  const input = captureLeafInput(leafId);
  let caller = true;
  const result = input?.write("task", () => caller);
  const rejected = expect(result).rejects.toThrow("retired");
  caller = false;
  finish();
  await rejected;
  expect(written).not.toHaveBeenCalled();
});
it("discards a native buffer after caller privacy is invalidated", async () => {
  const native = nativeLeaf();
  let finish = (_value: string) => {};
  const buffer = new Promise<string>((resolve) => {
    finish = resolve;
  });
  Object.assign(native, {
    writeOwned: async () => {},
    encodeShiftEnter: async () => "\x1b\r",
    readText: () => buffer,
  });
  registerNativeLeaf(leafId, native);
  const input = captureLeafInput(leafId);
  let caller = true;
  const read = input?.readBuffer(60, () => caller);
  caller = false;
  finish("late private content");
  expect(await read).toBeNull();
});
it("rejects native key encoding from an owner replaced under the same leaf id", async () => {
  const native = nativeLeaf();
  let finish = (_value: string) => {};
  const encoded = new Promise<string>((resolve) => {
    finish = resolve;
  });
  Object.assign(native, {
    writeOwned: async () => {},
    encodeShiftEnter: () => encoded,
    readText: async () => "public",
  });
  registerNativeLeaf(leafId, native);
  const input = captureLeafInput(leafId);
  const keys = input?.shiftEnter();
  const rejected = expect(keys).rejects.toThrow("available");
  native.submissionIdentity = {};
  native.id = 10;
  finish("\x1b[13;2u");
  await rejected;
});
it("marks a legacy command write at its final PTY call", async () => {
  LegacyHarness();
  harness.effects[0]();
  await respawnSession(leafId, "/repo");
  markSessionReady(leafId);
  const attempted = vi.fn(() => {
    expect(harness.pty.write).not.toHaveBeenCalled();
  });
  const result = await captureLeafSubmission(leafId)?.submitWhenReady(
    "pi",
    100,
    () => true,
    attempted,
  );
  expect(result).toBe(true);
  expect(attempted).toHaveBeenCalledOnce();
  expect(harness.pty.write).toHaveBeenCalledExactlyOnceWith("pi\r");
});

function clearTarget(id = leafId, grid = true) {
  const root = {
    getAttribute: () => String(id),
  } as unknown as Element;
  const target = {
    localName: "textarea",
    disabled: false,
    isConnected: true,
    closest: (selector: string) => {
      if (selector === "[data-native-terminal-leaf]") return root;
      if (selector === "[data-native-terminal-grid]")
        return grid ? target : null;
      return null;
    },
  } as unknown as HTMLTextAreaElement;
  Object.assign(document, { activeElement: target });
  return target;
}
function clearNative() {
  const native = Object.assign(nativeLeaf(), {
    focused: true,
    writeOwned: vi.fn(
      async (_text: string, current: () => boolean = () => true) => {
        if (!current()) throw new Error("retired");
      },
    ),
    encodeShiftEnter: vi.fn(async () => "\x1b\r"),
    readText: vi.fn(async () => "public"),
  });
  registerNativeLeaf(leafId, native);
  return native;
}
it("sends clearActive's exact formfeed once to the focused native owner", async () => {
  const native = clearNative();
  const target = clearTarget();
  expect(canClearActiveLeaf(leafId, target)).toBe(true);
  expect(await clearActiveLeaf(leafId)).toBe(true);
  expect(native.writeOwned).toHaveBeenCalledExactlyOnceWith(
    "\x0c",
    expect.any(Function),
  );
  expect(native.readText).not.toHaveBeenCalled();
  expect(native.encodeShiftEnter).not.toHaveBeenCalled();
});
it("does not claim native clearActive for another leaf, editor, or overlay input", async () => {
  const native = clearNative();
  expect(canClearActiveLeaf(leafId, clearTarget(leafId + 1))).toBe(false);
  expect(await clearActiveLeaf(leafId)).toBe(false);
  const editor = { closest: () => null } as unknown as Element;
  Object.assign(document, { activeElement: editor });
  expect(canClearActiveLeaf(leafId, editor)).toBe(false);
  expect(await clearActiveLeaf(leafId)).toBe(false);
  expect(canClearActiveLeaf(leafId, clearTarget(leafId, false))).toBe(false);
  expect(await clearActiveLeaf(leafId)).toBe(false);
  expect(native.writeOwned).not.toHaveBeenCalled();
});
it("does not use a stale event target after focus has moved to an editor", async () => {
  const native = clearNative();
  const previous = clearTarget();
  Object.assign(document, { activeElement: { closest: () => null } });
  expect(canClearActiveLeaf(leafId, previous)).toBe(false);
  expect(await clearActiveLeaf(leafId)).toBe(false);
  expect(native.writeOwned).not.toHaveBeenCalled();
});
it.each(["unfocused", "opening", "exited", "disabled"] as const)(
  "leaves native clearActive unclaimed while %s",
  async (kind) => {
    const native = clearNative();
    const target = clearTarget();
    if (kind === "unfocused") native.focused = false;
    if (kind === "opening") native.id = null;
    if (kind === "exited") native.exited = true;
    if (kind === "disabled") target.disabled = true;
    expect(canClearActiveLeaf(leafId, target)).toBe(false);
    expect(await clearActiveLeaf(leafId)).toBe(false);
    expect(native.writeOwned).not.toHaveBeenCalled();
  },
);
it("keeps clearActive out of the native blocks prompt editor", async () => {
  const native = clearNative();
  const target = clearTarget();
  Object.assign(native, { blockInput: { directInput: false } });
  expect(canClearActiveLeaf(leafId, target)).toBe(false);
  expect(await clearActiveLeaf(leafId)).toBe(false);
  Object.assign(native, { blockInput: { directInput: true } });
  expect(await clearActiveLeaf(leafId)).toBe(true);
  expect(native.writeOwned).toHaveBeenCalledExactlyOnceWith(
    "\x0c",
    expect.any(Function),
  );
});
it.each(["focus", "owner", "registration", "policy", "caller"] as const)(
  "cancels clearActive after %s changes while the owned write is waiting",
  async (kind) => {
    const native = clearNative();
    clearTarget();
    let release = () => {};
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const written = vi.fn();
    native.writeOwned.mockImplementation(async (text, current = () => true) => {
      await wait;
      if (!current()) throw new Error("retired");
      written(text);
    });
    let caller = true;
    const result = clearActiveLeaf(leafId, () => caller);
    expect(native.writeOwned).toHaveBeenCalledOnce();
    if (kind === "focus")
      Object.assign(document, { activeElement: { closest: () => null } });
    if (kind === "owner") native.submissionIdentity = {};
    if (kind === "registration") {
      takeNativeLeaf(leafId);
      registerNativeLeaf(
        leafId,
        Object.assign(nativeLeaf(), { focused: true }),
      );
    }
    if (kind === "policy")
      Object.assign(native, { blockInput: { directInput: false } });
    if (kind === "caller") caller = false;
    release();
    expect(await result).toBe(false);
    expect(written).not.toHaveBeenCalled();
  },
);
it("surfaces a genuine clearActive write rejection without retrying", async () => {
  const native = clearNative();
  clearTarget();
  native.writeOwned.mockRejectedValue(new Error("write failed"));
  await expect(clearActiveLeaf(leafId)).rejects.toThrow("write failed");
  expect(native.writeOwned).toHaveBeenCalledOnce();
});

it("preserves clearActive's formfeed for the focused legacy slot", async () => {
  useTerminalSession({
    leafId,
    container: { current: null },
    visible: true,
    focused: true,
  });
  for (const effect of harness.effects) effect();
  await respawnSession(leafId, "/repo");
  const target = {
    closest: (selector: string) => (selector === ".xterm" ? root : null),
  } as unknown as Element;
  const root = { contains: (value: Element) => value === target };
  vi.mocked(getSlotForLeaf).mockReturnValue({
    term: { element: root },
  } as unknown as NonNullable<ReturnType<typeof getSlotForLeaf>>);
  Object.assign(document, { activeElement: target });
  expect(canClearActiveLeaf(leafId, target)).toBe(true);
  expect(await clearActiveLeaf(leafId)).toBe(true);
  expect(harness.pty.write).toHaveBeenCalledExactlyOnceWith("\x0c");
  Object.assign(document, { activeElement: { closest: () => null } });
  expect(await clearActiveLeaf(leafId)).toBe(false);
  expect(harness.pty.write).toHaveBeenCalledOnce();
});
it("does not send clearActive to a legacy slot owned by another pane", async () => {
  useTerminalSession({
    leafId,
    container: { current: null },
    visible: true,
    focused: true,
  });
  for (const effect of harness.effects) effect();
  await respawnSession(leafId, "/repo");
  const target = { closest: () => ({}) } as unknown as Element;
  vi.mocked(getSlotForLeaf).mockReturnValue({
    term: { element: { contains: () => false } },
  } as unknown as NonNullable<ReturnType<typeof getSlotForLeaf>>);
  Object.assign(document, { activeElement: target });
  expect(canClearActiveLeaf(leafId, target)).toBe(false);
  expect(await clearActiveLeaf(leafId)).toBe(false);
  expect(harness.pty.write).not.toHaveBeenCalled();
});
it.each(["native", "other pane", "editor"] as const)(
  "global clearActive shortcut claims only its focused owner (%s)",
  async (kind) => {
    const native = clearNative();
    const target =
      kind === "editor"
        ? ({ closest: () => null } as unknown as Element)
        : clearTarget(kind === "other pane" ? leafId + 1 : leafId);
    Object.assign(document, { activeElement: target });
    let listener = (_event: KeyboardEvent) => {};
    vi.stubGlobal("window", {
      addEventListener: (_name: string, fn: (event: KeyboardEvent) => void) => {
        listener = fn;
      },
      removeEventListener: vi.fn(),
    });
    const rejected = vi.fn();
    useGlobalShortcuts(
      {
        "terminal.clearActive": () => {
          void clearActiveLeaf(leafId).catch(rejected);
        },
      },
      {
        isDisabled: (id, event) =>
          id === "terminal.clearActive" &&
          !canClearActiveLeaf(leafId, event.target as Element | null),
      },
    );
    harness.effects[0]();
    const event = {
      key: ";",
      code: "Semicolon",
      repeat: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      [`${MOD_PROP}Key`]: true,
      target,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as KeyboardEvent;
    listener(event);
    await Promise.resolve();
    await Promise.resolve();
    if (kind === "native") {
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
      expect(native.writeOwned).toHaveBeenCalledExactlyOnceWith(
        "\x0c",
        expect.any(Function),
      );
    } else {
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
      expect(native.writeOwned).not.toHaveBeenCalled();
    }
    expect(rejected).not.toHaveBeenCalled();
  },
);
