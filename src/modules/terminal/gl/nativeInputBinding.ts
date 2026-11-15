import { IS_MAC } from "@/lib/platform";
import type {
  EngineSession,
  NativeSelectionCommand,
} from "@/modules/terminal/gl/engineSession";
import type {
  GridRenderer,
  RendererFont,
} from "@/modules/terminal/gl/gridRenderer";
import { wheelRows } from "@/modules/terminal/gl/keyInput";
import { createNativeComposition } from "@/modules/terminal/gl/nativeComposition";
import { nativeKeyEvent } from "@/modules/terminal/gl/nativeKeyboard";
import { isSecondaryClick } from "@/modules/terminal/lib/pointer";
import {
  readTerminalClipboard,
  writeTerminalClipboard,
} from "@/modules/terminal/lib/terminalClipboard";

type Appearance = {
  font: RendererFont;
  foreground: string;
  background: string;
};
type Options = Appearance & {
  isActive: () => boolean;
  allowInput?: () => boolean;
  focusPrompt?: () => void;
  onError: (error: unknown) => void;
  onSelection?: (text: string | null) => void;
};
export type NativeInputBinding = {
  focus: () => void;
  dispose: () => void;
  updateAppearance: (appearance: Appearance) => void;
  updateCursor: () => void;
  updateInputPolicy: () => void;
  wordAt: (clientX: number, clientY: number) => Promise<string | null>;
};

/** DOM input for an ordinary native pane; it never encodes a terminal protocol. */
export function bindNativeInput(
  session: EngineSession,
  renderer: GridRenderer,
  host: HTMLElement,
  options: Options,
): NativeInputBinding {
  const textarea = document.createElement("textarea");
  textarea.setAttribute("aria-label", "Terminal input");
  textarea.setAttribute("autocapitalize", "off");
  textarea.setAttribute("autocomplete", "off");
  textarea.setAttribute("autocorrect", "off");
  textarea.spellcheck = false;
  textarea.style.cssText =
    "position:absolute;left:6px;top:6px;width:2px;height:1em;opacity:0;padding:0;border:0;margin:0;resize:none;overflow:hidden;white-space:nowrap;pointer-events:none;caret-color:transparent;";
  const preedit = document.createElement("span");
  preedit.setAttribute("aria-hidden", "true");
  preedit.style.cssText =
    "position:absolute;left:6px;top:6px;display:none;white-space:pre;pointer-events:none;z-index:2;";
  host.append(textarea, preedit);
  renderer.setPaneFocused(session.pane, false);
  const composition = createNativeComposition();
  const pressed = new Set<string>();
  let disposed = false;
  let focusReported = false;
  let compositionTurn: ReturnType<typeof setTimeout> | null = null;
  let wheelCarry = 0;
  let pointer: number | null = null;
  let pendingDrag: NativeSelectionCommand | null = null;
  let dragFrame = 0;
  let selectionBusy = 0;

  const canInput = () => options.allowInput?.() ?? true;
  const report = (error: unknown) => {
    if (disposed) return;
    try {
      options.onError(error);
    } catch {
      console.error("native terminal input observer failed");
    }
  };
  const watch = (promise: Promise<unknown>) => {
    void promise.catch(report);
  };
  const updateCursor = () => {
    const cursor = session.cursor;
    if (!cursor) return;
    const cell = renderer.cellSize;
    const left = `${6 + cursor.x * cell.width}px`;
    const top = `${6 + cursor.y * cell.height}px`;
    textarea.style.left = left;
    textarea.style.top = top;
    preedit.style.left = left;
    preedit.style.top = top;
    preedit.style.lineHeight = `${cell.height}px`;
  };
  const updateAppearance = (appearance: Appearance) => {
    for (const element of [textarea, preedit]) {
      element.style.fontFamily = appearance.font.family;
      element.style.fontWeight = appearance.font.weight;
      element.style.fontSize = `${appearance.font.size}px`;
      element.style.letterSpacing = `${appearance.font.letterSpacing}px`;
    }
    preedit.style.color = appearance.foreground;
    preedit.style.background = appearance.background;
    updateCursor();
  };
  updateAppearance(options);
  const reportFocus = (focused: boolean) => {
    focused =
      focused && canInput() && options.isActive() && document.hasFocus();
    renderer.setPaneFocused(session.pane, focused);
    if (focused === focusReported || disposed) return;
    focusReported = focused;
    watch(session.setInputFocused(focused));
  };
  const focus = () => {
    if (disposed) return;
    textarea.disabled = !canInput();
    if (textarea.disabled) {
      reportFocus(false);
      options.focusPrompt?.();
      return;
    }
    textarea.focus({ preventScroll: true });
    reportFocus(true);
  };
  const updateInputPolicy = () => {
    if (disposed) return;
    textarea.disabled = !canInput();
    if (textarea.disabled) {
      pressed.clear();
      composition.end("");
      textarea.value = "";
      preedit.textContent = "";
      preedit.style.display = "none";
    }
    if (options.isActive()) focus();
    else reportFocus(false);
  };
  const select = (command: NativeSelectionCommand) => {
    selectionBusy++;
    return session
      .select(command)
      .then((text) => {
        if (!disposed) options.onSelection?.(text);
        return text;
      })
      .finally(() => {
        selectionBusy--;
        if (pendingDrag && pointer !== null) scheduleDrag();
      });
  };
  const clearForInput = () => {
    session.scroll(2_147_483_647);
    if (session.getSelection() !== null) watch(select({ kind: "clear" }));
  };
  const committed = (text: string) => {
    if (!text || !canInput()) return;
    clearForInput();
    watch(session.sendKey({ code: "Unidentified", text }));
  };
  const isCopy = (event: KeyboardEvent) =>
    IS_MAC
      ? event.metaKey &&
        !event.altKey &&
        !event.ctrlKey &&
        event.code === "KeyC"
      : event.ctrlKey &&
        event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        event.code === "KeyC";
  const isPaste = (event: KeyboardEvent) =>
    IS_MAC
      ? event.metaKey &&
        !event.altKey &&
        !event.ctrlKey &&
        event.code === "KeyV"
      : event.ctrlKey &&
        event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        event.code === "KeyV";
  const paste = async (text: string) => {
    if (disposed || !text || !canInput()) return;
    clearForInput();
    await session.paste(text);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (!canInput()) {
      event.preventDefault();
      return;
    }
    const decision = composition.onKey(event);
    if (composition.active || event.isComposing || event.keyCode === 229)
      return;
    if (decision.kind === "swallow") {
      event.preventDefault();
      return;
    }
    if (decision.kind === "send") {
      event.preventDefault();
      clearForInput();
      watch(session.write(decision.data));
      return;
    }
    if (isCopy(event)) {
      event.preventDefault();
      const text = session.getSelection();
      if (text !== null) watch(writeTerminalClipboard(text));
      return;
    }
    if (isPaste(event)) {
      event.preventDefault();
      watch(readTerminalClipboard().then(paste));
      return;
    }
    if (
      IS_MAC &&
      event.metaKey &&
      !event.altKey &&
      !event.ctrlKey &&
      event.code === "KeyA"
    ) {
      event.preventDefault();
      watch(select({ kind: "all" }));
      return;
    }
    if (
      event.shiftKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      (event.code === "PageUp" || event.code === "PageDown")
    ) {
      event.preventDefault();
      session.scroll((event.code === "PageUp" ? -1 : 1) * session.grid.rows);
      return;
    }
    const native = nativeKeyEvent(event, IS_MAC);
    if (!native) return;
    event.preventDefault();
    pressed.add(event.code);
    if (!/^(Shift|Control|Alt|Meta|CapsLock|NumLock)$/.test(event.key))
      clearForInput();
    watch(
      session.sendKey({
        ...native,
        legacyShiftEnter:
          event.key === "Enter" &&
          event.shiftKey &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey,
      }),
    );
  };
  const onKeyUp = (event: KeyboardEvent) => {
    composition.onKey(event);
    if (!pressed.delete(event.code)) return;
    const native = nativeKeyEvent(event, IS_MAC);
    if (native) watch(session.sendKey(native));
  };
  const onKeyPress = (event: KeyboardEvent) => {
    if (composition.onKey(event).kind === "swallow") event.preventDefault();
  };
  const onInput = (event: Event) => {
    if (!canInput()) {
      textarea.value = "";
      return;
    }
    const input = event as InputEvent;
    const text = composition.takeInput(input, textarea.value);
    if (composition.active || input.isComposing) return;
    textarea.value = "";
    if (text) committed(text);
  };
  const onCompositionStart = () => {
    if (!canInput()) return;
    composition.start();
    updateCursor();
  };
  const onCompositionUpdate = (event: CompositionEvent) => {
    if (!canInput()) return;
    preedit.textContent = event.data;
    preedit.style.display = event.data ? "block" : "none";
    updateCursor();
  };
  const onCompositionEnd = (event: CompositionEvent) => {
    preedit.textContent = "";
    preedit.style.display = "none";
    textarea.value = "";
    committed(composition.end(event.data));
    if (compositionTurn !== null) clearTimeout(compositionTurn);
    compositionTurn = setTimeout(() => {
      compositionTurn = null;
      composition.finishTurn();
    }, 0);
  };
  const onPaste = (event: ClipboardEvent) => {
    event.preventDefault();
    watch(paste(event.clipboardData?.getData("text/plain") ?? ""));
  };
  const point = (clientX: number, clientY: number) => {
    const box = host.getBoundingClientRect();
    const cell = renderer.cellSize;
    const dpr = window.devicePixelRatio || 1;
    return {
      col: Math.max(
        0,
        Math.min(
          session.grid.cols - 1,
          Math.floor((clientX - box.left - 6) / cell.width),
        ),
      ),
      row: Math.max(
        0,
        Math.min(
          session.grid.rows - 1,
          Math.floor((clientY - box.top - 6) / cell.height),
        ),
      ),
      x: (clientX - box.left) * dpr,
      y: (clientY - box.top) * dpr,
      cellWidth: Math.max(1, Math.round(cell.width * dpr)),
      paddingLeft: Math.round(6 * dpr),
      screenHeight: Math.max(1, Math.round(box.height * dpr)),
    };
  };
  function flushDrag(force = false) {
    if (dragFrame) cancelAnimationFrame(dragFrame);
    dragFrame = 0;
    if (!pendingDrag || (!force && selectionBusy > 0)) return;
    const command = pendingDrag;
    pendingDrag = null;
    watch(select(command));
  }
  function scheduleDrag() {
    if (!dragFrame && !disposed)
      dragFrame = requestAnimationFrame(() => flushDrag());
  }
  const onPointerDown = (event: PointerEvent) => {
    if (isSecondaryClick(event, IS_MAC) || event.button !== 0) return;
    event.preventDefault();
    focus();
    pointer = event.pointerId;
    try {
      host.setPointerCapture(pointer);
    } catch {
      /* A detached host cannot capture. */
    }
    const { col, row, x, y } = point(event.clientX, event.clientY);
    watch(
      select({
        kind: "press",
        col,
        row,
        x,
        y,
        atMs: Math.floor(performance.now()),
      }),
    );
  };
  const onPointerMove = (event: PointerEvent) => {
    if (pointer !== event.pointerId) return;
    pendingDrag = {
      kind: "drag",
      ...point(event.clientX, event.clientY),
      rectangle: event.altKey,
    };
    scheduleDrag();
  };
  const onPointerUp = (event: PointerEvent) => {
    if (pointer !== event.pointerId) return;
    flushDrag(true);
    pointer = null;
    watch(select({ kind: "release" }));
    try {
      host.releasePointerCapture(event.pointerId);
    } catch {
      /* Capture may already have ended. */
    }
  };
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const delta = wheelRows(
      wheelCarry,
      event.deltaY,
      event.deltaMode,
      renderer.cellSize.height,
      session.grid.rows,
    );
    wheelCarry = delta.carry;
    if (delta.rows) session.scroll(delta.rows);
  };
  const onFocus = () => reportFocus(true);
  const onBlur = () => {
    pressed.clear();
    reportFocus(false);
  };
  const onWindowFocus = () => reportFocus(document.activeElement === textarea);
  textarea.addEventListener("keydown", onKeyDown);
  textarea.addEventListener("keyup", onKeyUp);
  textarea.addEventListener("keypress", onKeyPress);
  textarea.addEventListener("input", onInput);
  textarea.addEventListener("compositionstart", onCompositionStart);
  textarea.addEventListener("compositionupdate", onCompositionUpdate);
  textarea.addEventListener("compositionend", onCompositionEnd);
  textarea.addEventListener("paste", onPaste);
  textarea.addEventListener("focus", onFocus);
  textarea.addEventListener("blur", onBlur);
  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerup", onPointerUp);
  host.addEventListener("pointercancel", onPointerUp);
  host.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onWindowFocus);
  updateInputPolicy();
  return {
    focus,
    updateInputPolicy,
    updateAppearance,
    updateCursor,
    wordAt: (clientX, clientY) => {
      const { col, row } = point(clientX, clientY);
      return select({ kind: "word", col, row });
    },
    dispose() {
      disposed = true;
      if (dragFrame) cancelAnimationFrame(dragFrame);
      if (compositionTurn !== null) clearTimeout(compositionTurn);
      textarea.removeEventListener("keydown", onKeyDown);
      textarea.removeEventListener("keyup", onKeyUp);
      textarea.removeEventListener("keypress", onKeyPress);
      textarea.removeEventListener("input", onInput);
      textarea.removeEventListener("compositionstart", onCompositionStart);
      textarea.removeEventListener("compositionupdate", onCompositionUpdate);
      textarea.removeEventListener("compositionend", onCompositionEnd);
      textarea.removeEventListener("paste", onPaste);
      textarea.removeEventListener("focus", onFocus);
      textarea.removeEventListener("blur", onBlur);
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("pointercancel", onPointerUp);
      host.removeEventListener("wheel", onWheel);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onWindowFocus);
      textarea.remove();
      preedit.remove();
    },
  };
}
