import { useSelectionAskAi } from "@/modules/ai/hooks/useSelectionAskAi";
import { TERMINAL_SELECTION_GESTURE_EVENT } from "@/modules/terminal/lib/selectionGesture";
import { afterEach, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  effects: [] as (() => unknown)[],
  show: vi.fn(),
}));
vi.mock("react", () => ({
  useCallback: <T>(callback: T) => callback,
  useEffect: (effect: () => unknown) => hooks.effects.push(effect),
  useRef: <T>(value: T) => ({ current: value }),
  useState: <T>(value: T) => [value, hooks.show],
}));
let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  hooks.effects.length = 0;
  hooks.show.mockClear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function SelectionPopupHarness() {
  let text: string | null = "owned native text";
  const listeners = new Map<string, (event: unknown) => void>();
  const add = vi.fn((name: string, listener: (event: unknown) => void) =>
    listeners.set(name, listener),
  );
  vi.stubGlobal("document", {
    addEventListener: add,
    removeEventListener: vi.fn(),
  });
  const ask = vi.fn(),
    note = vi.fn();
  const hook = useSelectionAskAi({
    captureActiveSelection: () => text,
    askFromSelection: ask,
    addSelectionToNote: note,
  });
  const dispose = hooks.effects.shift()?.();
  cleanup = typeof dispose === "function" ? (dispose as () => void) : undefined;
  return {
    hook,
    ask,
    note,
    add,
    emit: (name: string, event: unknown) => listeners.get(name)?.(event),
    text: (value: string | null) => {
      text = value;
    },
  };
}
it("connects the native event without requiring a compatibility mouseup", async () => {
  const f = SelectionPopupHarness();
  let resolve!: (text: string | null) => void;
  const selection = new Promise<string | null>((yes) => {
    resolve = yes;
  });
  f.emit(TERMINAL_SELECTION_GESTURE_EVENT, {
    detail: { x: 7, y: 9, selection, current: () => true },
  });
  expect(hooks.show).toHaveBeenLastCalledWith(null);
  resolve("owned native text");
  await selection;
  expect(hooks.show).toHaveBeenLastCalledWith({ x: 7, y: 9 });
  f.hook.onAddToNoteFromSelection();
  expect(f.note).toHaveBeenCalledTimes(1);
  expect(f.add).toHaveBeenCalledWith("pointerdown", expect.any(Function), true);
});
it("invalidates a pending native gesture on a later pointer and guards Mermaid like other actions", async () => {
  const f = SelectionPopupHarness();
  let resolve!: (text: string | null) => void;
  const selection = new Promise<string | null>((yes) => {
    resolve = yes;
  });
  f.emit(TERMINAL_SELECTION_GESTURE_EVENT, {
    detail: { x: 7, y: 9, selection, current: () => true },
  });
  f.emit("pointerdown", { target: { closest: () => null } });
  resolve("owned native text");
  await selection;
  expect(hooks.show.mock.calls.every(([position]) => position === null)).toBe(
    true,
  );
  const ready = Promise.resolve("owned native text");
  f.emit(TERMINAL_SELECTION_GESTURE_EVENT, {
    detail: { x: 7, y: 9, selection: ready, current: () => true },
  });
  await ready;
  f.emit("pointerdown", { target: { closest: () => ({}) } });
  const mermaid = vi.fn();
  f.hook.runSelectionAction(mermaid);
  expect(mermaid).toHaveBeenCalledTimes(1);
});
it("retains the deferred editor and legacy popup path", () => {
  vi.useFakeTimers();
  const f = SelectionPopupHarness();
  f.emit("mouseup", {
    button: 0,
    clientX: 17,
    clientY: 19,
    target: {
      closest: (selector: string) =>
        selector === ".cm-editor" ? {} : null,
    },
  });
  expect(hooks.show).not.toHaveBeenCalled();
  vi.runOnlyPendingTimers();
  expect(hooks.show).toHaveBeenLastCalledWith({ x: 17, y: 19 });
  f.hook.onAskFromSelection();
  expect(f.ask).toHaveBeenCalledTimes(1);
});
