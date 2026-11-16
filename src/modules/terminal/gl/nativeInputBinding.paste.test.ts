import type { EngineSession } from "@/modules/terminal/gl/engineSession";
import type { GridRenderer } from "@/modules/terminal/gl/gridRenderer";
import { bindNativeInput } from "@/modules/terminal/gl/nativeInputBinding";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ isMac: true }));
const clipboard = vi.hoisted(() => ({
  read: vi.fn<() => Promise<string>>(),
  write: vi.fn(),
}));
vi.mock("@/lib/platform", () => ({
  get IS_MAC() {
    return platform.isMac;
  },
}));
vi.mock("@/modules/terminal/lib/terminalClipboard", () => ({
  readTerminalClipboard: clipboard.read,
  writeTerminalClipboard: clipboard.write,
}));
beforeEach(() => {
  platform.isMac = true;
  clipboard.read.mockReset().mockResolvedValue("helper text");
  clipboard.write.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const events = new Map<string, (event: unknown) => void>();
  const state = {
    visible: true,
    hidden: false,
    focused: true,
    allowed: true,
    active: null as unknown,
  };
  const node = () => ({
    value: "",
    disabled: false,
    style: {},
    setAttribute: vi.fn(),
    remove: vi.fn(),
    addEventListener: (name: string, handler: (event: unknown) => void) =>
      events.set(name, handler),
    removeEventListener: (name: string) => events.delete(name),
    focus() {
      state.active = this;
    },
  });
  const textarea = node();
  let count = 0;
  vi.stubGlobal("document", {
    get hidden() {
      return state.hidden;
    },
    get activeElement() {
      return state.active;
    },
    hasFocus: () => state.focused,
    createElement: () => (count++ === 0 ? textarea : node()),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  const session = {
    id: 42,
    pane: {},
    cursor: null,
    exitCode: null as number | null,
    setInputFocused: vi.fn(async () => {}),
    getSelection: () => null,
    paste: vi.fn(async (_text: string) => {}),
    sendKey: vi.fn(async () => {}),
    scroll: vi.fn(),
    write: vi.fn(async () => {}),
  };
  const binding = bindNativeInput(
    session as unknown as EngineSession,
    {
      cellSize: { width: 8, height: 16 },
      setPaneFocused: vi.fn(),
    } as unknown as GridRenderer,
    {
      append: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLElement,
    {
      font: { family: "mono", size: 14, weight: "400", letterSpacing: 0 },
      foreground: "#fff",
      background: "#000",
      isActive: () => state.visible,
      allowInput: () => state.allowed,
      onError: vi.fn(),
    },
  );
  const keydown = events.get("keydown");
  const keyup = events.get("keyup");
  const paste = events.get("paste");
  if (!keydown || !keyup || !paste)
    throw new Error("Missing native clipboard listeners");
  const key = (overrides: Record<string, unknown> = {}) => ({
    type: "keydown",
    key: "v",
    code: "KeyV",
    keyCode: 86,
    metaKey: platform.isMac,
    ctrlKey: !platform.isMac,
    shiftKey: !platform.isMac,
    altKey: false,
    isComposing: false,
    repeat: false,
    getModifierState: () => false,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...overrides,
  });
  const sendPaste = (text = "event text", cancelled = false) => {
    const event = {
      defaultPrevented: cancelled,
      preventDefault() {
        this.defaultPrevented = true;
      },
      clipboardData: {
        getData: vi.fn((type: string) =>
          type === "text/plain" ? text : "<b>unwanted HTML</b>",
        ),
      },
    };
    paste(event);
    return event;
  };
  return {
    state,
    session,
    binding,
    keydown,
    keyup,
    key,
    sendPaste,
    textarea,
    events,
  };
}

it.each([false, true])(
  "lets macOS Cmd+V (Shift=%s) deliver the paste event once without readText",
  async (shiftKey) => {
    const f = fixture();
    const event = f.key({ shiftKey });
    f.keydown(event);
    expect(event.defaultPrevented).toBe(false);
    expect(clipboard.read).not.toHaveBeenCalled();
    expect(f.session.paste).not.toHaveBeenCalled();
    const paste = f.sendPaste("one\r\ntwo\nthree\rfour");
    expect(paste.defaultPrevented).toBe(true);
    expect(paste.clipboardData.getData).toHaveBeenCalledExactlyOnceWith(
      "text/plain",
    );
    f.keyup(f.key({ type: "keyup", shiftKey }));
    await Promise.resolve();
    expect(f.session.paste).toHaveBeenCalledExactlyOnceWith(
      "one\r\ntwo\nthree\rfour",
    );
    expect(f.session.sendKey).not.toHaveBeenCalled();
    expect(f.session.write).not.toHaveBeenCalled();
    expect(f.textarea.value).toBe("");
    f.binding.dispose();
  },
);

it.each(["Linux", "Windows"])(
  "retains %s helper shortcuts and cancels their default paste delivery",
  async () => {
    platform.isMac = false;
    const f = fixture();
    for (const overrides of [
      {},
      { key: "Insert", code: "Insert", ctrlKey: false, shiftKey: true },
    ]) {
      const event = f.key(overrides);
      f.keydown(event);
      // Model default browser delivery: a cancelled keydown cannot also paste.
      if (!event.defaultPrevented) f.sendPaste("duplicate default");
      expect(event.defaultPrevented).toBe(true);
      await Promise.resolve();
    }
    expect(clipboard.read).toHaveBeenCalledTimes(2);
    expect(f.session.paste.mock.calls).toEqual([
      ["helper text"],
      ["helper text"],
    ]);
    expect(f.session.sendKey).not.toHaveBeenCalled();
    f.binding.dispose();
  },
);

it.each([
  "pane-hidden",
  "document-hidden",
  "window-blurred",
  "other-input",
  "exited",
  "disabled",
  "disposed",
] as const)(
  "rejects %s paste ownership before reading or delivering clipboard data",
  async (reason) => {
    const f = fixture();
    if (reason === "pane-hidden") f.state.visible = false;
    if (reason === "document-hidden") f.state.hidden = true;
    if (reason === "window-blurred") f.state.focused = false;
    if (reason === "other-input") f.state.active = {};
    if (reason === "exited") f.session.exitCode = 0;
    if (reason === "disabled") f.state.allowed = false;
    if (reason === "disposed") f.binding.dispose();
    const key = f.key();
    f.keydown(key);
    expect(key.defaultPrevented).toBe(true);
    const event = f.sendPaste();
    expect(event.clipboardData.getData).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(clipboard.read).not.toHaveBeenCalled();
    expect(f.session.paste).not.toHaveBeenCalled();
    f.binding.dispose();
  },
);

it.each([
  "pane-hidden",
  "document-hidden",
  "window-blurred",
  "other-input",
  "exited",
  "disabled",
  "disposed",
  "replaced",
] as const)(
  "rejects a delayed non-Mac read after its owner becomes %s",
  async (reason) => {
    platform.isMac = false;
    let finish!: (text: string) => void;
    clipboard.read.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const f = fixture();
    f.keydown(f.key());
    expect(clipboard.read).toHaveBeenCalledTimes(1);
    if (reason === "pane-hidden") f.state.visible = false;
    if (reason === "document-hidden") f.state.hidden = true;
    if (reason === "window-blurred") f.state.focused = false;
    if (reason === "other-input") f.state.active = {};
    if (reason === "exited") f.session.exitCode = 0;
    if (reason === "disabled") f.state.allowed = false;
    if (reason === "disposed") f.binding.dispose();
    if (reason === "replaced") f.session.id++;
    finish("late clipboard");
    await Promise.resolve();
    expect(f.session.paste).not.toHaveBeenCalled();
    expect(f.session.scroll).not.toHaveBeenCalled();
    f.binding.dispose();
  },
);

it("respects a cancelled paste event and leaves empty clipboard input inert", () => {
  const f = fixture();
  const cancelled = f.sendPaste("already handled", true);
  expect(cancelled.clipboardData.getData).not.toHaveBeenCalled();
  f.sendPaste("");
  expect(f.session.paste).not.toHaveBeenCalled();
  expect(f.session.scroll).not.toHaveBeenCalled();
  f.binding.dispose();
});
