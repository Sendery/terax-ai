import { afterEach, expect, it, vi } from "vitest";
import { bindNativeInput } from "@/modules/terminal/gl/nativeInputBinding";
import type {
  EngineSession,
  NativeSelectionCommand,
} from "@/modules/terminal/gl/engineSession";
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
    id: 42,
    cursor: null as { x: number; y: number } | null,
    exitCode: null,
    selectionRevision: 0,
    moveCursor: vi.fn(async () => {}),
    grid: { cols: 10, rows: 2 },
    setInputFocused: vi.fn(async () => {}),
    select: vi.fn(
      async (_command: NativeSelectionCommand): Promise<string | null> => null,
    ),
    getSelection: () => null,
    drawnSeq: 9,
  };
  const blockClick = vi.fn(async () => {});
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
      onBlockClick: blockClick,
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
  listeners.get("pointerup")?.({ ...primary, type: "pointerup" });
  await vi.waitFor(() =>
    expect(blockClick).toHaveBeenCalledExactlyOnceWith(9, 0),
  );
  blockClick.mockClear();
  listeners.get("pointerdown")?.(primary);
  listeners.get("pointerup")?.({ ...primary, clientX: 30, type: "pointerup" });
  await Promise.resolve();
  await Promise.resolve();
  expect(blockClick).not.toHaveBeenCalled();
  let release!: () => void;
  let delay = true;
  session.select.mockImplementation((command) =>
    command.kind === "release" && delay
      ? new Promise((resolve) => {
          delay = false;
          release = () => resolve(null);
        })
      : Promise.resolve(null),
  );
  listeners.get("pointerdown")?.(primary);
  listeners.get("pointerup")?.({ ...primary, type: "pointerup" });
  listeners.get("pointerdown")?.({ ...primary, pointerId: 2 });
  release();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(blockClick).not.toHaveBeenCalled();
  listeners.get("pointercancel")?.({
    ...primary,
    pointerId: 2,
    type: "pointercancel",
  });
  await Promise.resolve();
  session.cursor = { x: 4, y: 0 };
  const alt = { ...primary, altKey: true, type: "pointerup" };
  listeners.get("pointerdown")?.(alt);
  session.drawnSeq++;
  listeners.get("pointerup")?.(alt);
  await vi.waitFor(() => expect(session.moveCursor).toHaveBeenCalledTimes(1));
  expect(session.moveCursor.mock.calls[0]).toEqual([
    { col: 1, row: 0, cols: 10, rows: 2, cursorX: 4, cursorY: 0 },
    expect.any(Function),
  ]);
  listeners.get("pointerdown")?.(alt);
  listeners.get("pointerup")?.({ ...alt, clientX: 30 });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(session.moveCursor).toHaveBeenCalledTimes(1);
  delay = true;
  listeners.get("pointerdown")?.(alt);
  listeners.get("pointerup")?.(alt);
  session.id++;
  release();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(session.moveCursor).toHaveBeenCalledTimes(1);
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

it("routes negotiated TUI mouse and wheel, with Shift retaining native selection", async () => {
  const hostEvents = new Map<string, (event: unknown) => void>();
  const inputEvents = new Map<string, (event: unknown) => void>();
  const node = () => ({
    style: {},
    value: "",
    setAttribute: vi.fn(),
    focus: vi.fn(),
    remove: vi.fn(),
    addEventListener: (name: string, cb: (event: unknown) => void) =>
      inputEvents.set(name, cb),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("document", { hasFocus: () => true, createElement: node });
  vi.stubGlobal("window", {
    devicePixelRatio: 2,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  const session = {
    pane: {},
    cursor: null,
    grid: { cols: 10, rows: 2 },
    inputState: {
      mouseTracking: true,
      alternateScreen: true,
      kittyFlags: 0,
      modifyOtherKeys: 0,
    },
    setInputFocused: vi.fn(async () => {}),
    sendMouse: vi.fn(async () => {}),
    sendKey: vi.fn(async () => {}),
    exitCode: null as number | null,
    select: vi.fn(async () => null),
    scroll: vi.fn(),
    getSelection: () => null,
  };
  const binding = bindNativeInput(
    session as unknown as EngineSession,
    {
      cellSize: { width: 8, height: 16 },
      cellPixels: { width: 16, height: 32 },
      setPaneFocused: vi.fn(),
    } as unknown as GridRenderer,
    {
      append: vi.fn(),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      getBoundingClientRect: () => ({
        left: 10,
        top: 20,
        right: 102,
        bottom: 64,
        width: 92,
        height: 44,
      }),
      addEventListener: (name: string, cb: (event: unknown) => void) =>
        hostEvents.set(name, cb),
      removeEventListener: vi.fn(),
    } as unknown as HTMLElement,
    {
      font: { family: "monospace", size: 14, weight: "400", letterSpacing: 0 },
      foreground: "#fff",
      background: "#000",
      isActive: () => true,
      onError: vi.fn(),
    },
  );
  const pointer = {
    button: 2,
    buttons: 2,
    pointerId: 7,
    clientX: 24,
    clientY: 42,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    preventDefault: vi.fn(),
  };
  hostEvents.get("pointerdown")?.(pointer);
  expect(session.sendMouse).toHaveBeenLastCalledWith(
    expect.objectContaining({
      action: "press",
      button: 2,
      x: 16,
      y: 32,
      cellWidth: 16,
      cellHeight: 32,
      screenWidth: 160,
      screenHeight: 64,
    }),
  );
  hostEvents.get("pointerup")?.({ ...pointer, buttons: 0 });
  expect(session.sendMouse).toHaveBeenLastCalledWith(
    expect.objectContaining({ action: "release", button: 2 }),
  );
  expect(session.select).not.toHaveBeenCalled();
  hostEvents.get("wheel")?.({ ...pointer, deltaY: -16, deltaMode: 0 });
  expect(session.sendMouse).toHaveBeenLastCalledWith(
    expect.objectContaining({ action: "press", button: 3 }),
  );
  expect(session.scroll).not.toHaveBeenCalled();
  hostEvents.get("pointerdown")?.({ ...pointer, button: 0, shiftKey: true });
  expect(session.select).toHaveBeenLastCalledWith(
    expect.objectContaining({ kind: "press", col: 1, row: 1 }),
  );
  hostEvents.get("pointerup")?.({
    ...pointer,
    button: 0,
    shiftKey: true,
    type: "pointerup",
  });
  session.inputState.mouseTracking = false;
  hostEvents.get("wheel")?.({ ...pointer, deltaY: 16, deltaMode: 0 });
  expect(session.sendKey).toHaveBeenLastCalledWith({ code: "ArrowDown" });
  expect(session.scroll).not.toHaveBeenCalled();
  session.inputState.alternateScreen = false;
  hostEvents.get("wheel")?.({ ...pointer, deltaY: 16, deltaMode: 0 });
  expect(session.scroll).toHaveBeenCalledWith(1);
  session.inputState.alternateScreen = true;
  session.exitCode = 0;
  session.sendKey.mockClear();
  hostEvents.get("wheel")?.({ ...pointer, deltaY: -16, deltaMode: 0 });
  expect(session.sendKey).not.toHaveBeenCalled();
  binding.dispose();
});
