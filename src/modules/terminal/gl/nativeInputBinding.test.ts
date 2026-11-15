import { afterEach, expect, it, vi } from "vitest";
import { bindNativeInput } from "@/modules/terminal/gl/nativeInputBinding";
import type { EngineSession } from "@/modules/terminal/gl/engineSession";
import type { GridRenderer } from "@/modules/terminal/gl/gridRenderer";
vi.mock("@/lib/platform", () => ({ IS_MAC: true }));
afterEach(() => vi.unstubAllGlobals());
it("keeps the terminal textarea focused after primary pointer default processing", async () => {
  const documentState = {
    activeElement: null as unknown,
    hasFocus: () => true,
  };
  const body = {};
  const node = () => ({
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    remove: vi.fn(),
    focus() {
      documentState.activeElement = this;
    },
  });
  const textarea = node();
  let nodes = 0;
  vi.stubGlobal("document", {
    ...documentState,
    get activeElement() {
      return documentState.activeElement;
    },
    createElement: () => (nodes++ === 0 ? textarea : node()),
  });
  vi.stubGlobal("window", {
    devicePixelRatio: 1,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  const listeners = new Map<string, (event: unknown) => void>();
  const host = {
    append: vi.fn(),
    setPointerCapture: vi.fn(),
    addEventListener: (name: string, handler: (event: unknown) => void) =>
      listeners.set(name, handler),
    removeEventListener: vi.fn(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 92, height: 44 }),
  };
  const session = {
    pane: {},
    cursor: null,
    grid: { cols: 10, rows: 2 },
    setInputFocused: vi.fn(async () => {}),
    select: vi.fn(async () => null),
    getSelection: () => null,
  };
  const binding = bindNativeInput(
    session as unknown as EngineSession,
    {
      cellSize: { width: 8, height: 16 },
      setPaneFocused: vi.fn(),
    } as unknown as GridRenderer,
    host as unknown as HTMLElement,
    {
      font: { family: "monospace", size: 14, weight: "400", letterSpacing: 0 },
      foreground: "#fff",
      background: "#000",
      isActive: () => true,
      onError: vi.fn(),
    },
  );
  const primary = {
    button: 0,
    ctrlKey: false,
    pointerId: 1,
    clientX: 14,
    clientY: 14,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
  listeners.get("pointerdown")?.(primary);
  // A non-focusable host otherwise takes focus away from the textarea.
  if (!primary.defaultPrevented) documentState.activeElement = body;
  expect(documentState.activeElement).toBe(textarea);
  const secondary = { ...primary, button: 2, defaultPrevented: false };
  listeners.get("pointerdown")?.(secondary);
  expect(secondary.defaultPrevented).toBe(false);
  await Promise.resolve();
  binding.dispose();
});

it("routes prompt focus to the editor and blocks late direct input until a program owns the PTY", async () => {
  let active: unknown = null;
  let allowed = false;
  const events = new Map<string, (event: unknown) => void>();
  const node = () => ({
    value: "",
    disabled: false,
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    remove: vi.fn(),
    removeEventListener: vi.fn(),
    addEventListener: (name: string, cb: (event: unknown) => void) =>
      events.set(name, cb),
    focus() {
      active = this;
    },
  });
  const textarea = node();
  let count = 0;
  vi.stubGlobal("document", {
    hasFocus: () => true,
    get activeElement() {
      return active;
    },
    createElement: () => (count++ === 0 ? textarea : node()),
  });
  vi.stubGlobal("window", {
    devicePixelRatio: 1,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  const session = {
    pane: {},
    cursor: null,
    grid: { cols: 10, rows: 2 },
    setInputFocused: vi.fn(async () => {}),
    sendKey: vi.fn(async () => {}),
    scroll: vi.fn(),
    getSelection: () => null,
  };
  const editor = {};
  const focusPrompt = vi.fn(() => {
    active = editor;
  });
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
      font: { family: "monospace", size: 14, weight: "400", letterSpacing: 0 },
      foreground: "#fff",
      background: "#000",
      isActive: () => true,
      allowInput: () => allowed,
      focusPrompt,
      onError: vi.fn(),
    },
  );
  binding.focus();
  expect(active).toBe(editor);
  expect(textarea.disabled).toBe(true);
  textarea.value = "late input";
  const inputEvent = events.get("input");
  if (!inputEvent) throw new Error("Missing input listener");
  inputEvent({
    data: "late input",
    inputType: "insertText",
    isComposing: false,
  });
  expect(session.sendKey).not.toHaveBeenCalled();
  allowed = true;
  binding.updateInputPolicy();
  expect(textarea.disabled).toBe(false);
  expect(active).toBe(textarea);
  textarea.value = "program input";
  inputEvent({
    data: "program input",
    inputType: "insertText",
    isComposing: false,
  });
  expect(session.sendKey).toHaveBeenCalledExactlyOnceWith({
    code: "Unidentified",
    text: "program input",
  });
  allowed = false;
  binding.updateInputPolicy();
  expect(active).toBe(editor);
  expect(textarea.disabled).toBe(true);
  binding.dispose();
});
