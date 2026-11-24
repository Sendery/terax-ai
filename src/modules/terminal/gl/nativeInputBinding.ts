import { IS_MAC } from "@/lib/platform";
import type {
  EngineSession,
  NativeMouseEvent,
  NativeSelectionCommand,
} from "@/modules/terminal/gl/engineSession";
import type {
  RendererFont,
  TerminalRenderer,
} from "@/modules/terminal/gl/gridRenderer";
import { wheelRows } from "@/modules/terminal/gl/keyInput";
import { createNativeComposition } from "@/modules/terminal/gl/nativeComposition";
import {
  nativeClipboardAction,
  nativeKeyEvent,
  nativeReadlineSequence,
} from "@/modules/terminal/gl/nativeKeyboard";
import { isSecondaryClick, usesTerminalContextMenu } from "@/modules/terminal/lib/pointer";
import { terminalCopyText } from "@/modules/terminal/lib/agentCopy";
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
  onBlockClick?: (seq: number, row: number) => Promise<void>;
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
  renderer: TerminalRenderer,
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
  preedit.setAttribute("data-terax-capture-foreground", "");
  preedit.style.cssText =
    "position:absolute;left:6px;top:6px;display:none;white-space:pre;pointer-events:none;z-index:2;";
  host.append(textarea, preedit);
  renderer.setPaneFocused(session.pane, false);
  const composition = createNativeComposition();
  const pressed = new Set<string>();
  let disposed = false;
  let blockPress: { seq: number; row: number; x: number; y: number } | null =
    null;
  let altPress: {
    id: number | null;
    x: number;
    y: number;
    at: number;
    width: number;
    height: number;
    cursorX: number;
    cursorY: number;
    cols: number;
    rows: number;
  } | null = null;
  let focusReported = false;
  let compositionTurn: ReturnType<typeof setTimeout> | null = null;
  let wheelCarry = 0;
  let wheelCarryX = 0;
  let pointer: number | null = null;
  let pendingDrag: NativeSelectionCommand | null = null;
  let dragFrame = 0;
  let selectionBusy = 0;
  let selectionGeneration = 0;
  let mousePointer: number | null = null;
  let mouseButton: number | null = null;
  let lastMouse: NativeMouseEvent | null = null;
  let pendingMotion: NativeMouseEvent | null = null;
  let motionFrame = 0;
  let motionBusy = false;
  let dragPosition: { x: number; y: number; alt: boolean } | null = null;
  let autoscrollTimer: ReturnType<typeof setTimeout> | null = null;

  const canInput = () => options.allowInput?.() ?? true;
  const report = (error: unknown) => {
    if (disposed || session.exitCode != null) return;
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
      focused &&
      canInput() &&
      options.isActive() &&
      !document.hidden &&
      document.hasFocus();
    renderer.setPaneFocused(session.pane, focused);
    if (focused === focusReported || disposed) return;
    focusReported = focused;
    if (session.exitCode == null) watch(session.setInputFocused(focused));
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
    else onBlur();
  };
  const select = (command: NativeSelectionCommand) => {
    if (command.kind !== "read" && command.kind !== "release")
      selectionGeneration++;
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
    if (!text || !canInput() || session.exitCode != null) return;
    clearForInput();
    watch(session.sendKey({ code: "Unidentified", text }));
  };
  const canPaste = () =>
    !disposed &&
    canInput() &&
    session.exitCode == null &&
    options.isActive() &&
    !document.hidden &&
    document.hasFocus() &&
    document.activeElement === textarea;
  const paste = async (text: string) => {
    if (!text || !canPaste()) return;
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
      if (session.exitCode == null) watch(session.write(decision.data));
      return;
    }
    if (nativeClipboardAction(event, IS_MAC) === "copy") {
      event.preventDefault();
      const text = session.getSelection();
      if (text !== null)
        watch(
          writeTerminalClipboard(
            terminalCopyText(text, {
              ptyId: session.id,
              cols: session.grid.cols,
            }),
          ),
        );
      return;
    }
    if (nativeClipboardAction(event, IS_MAC) === "paste") {
      if (!canPaste()) {
        event.preventDefault();
        return;
      }
      // WebKit must receive the Cmd+V gesture; readText can open a modal
      // permission menu. Its paste event supplies the text exactly once.
      if (IS_MAC) return;
      event.preventDefault();
      const owner = session.id;
      watch(
        readTerminalClipboard().then((text) => {
          if (session.id === owner) return paste(text);
        }),
      );
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
    if (session.exitCode != null) {
      event.preventDefault();
      return;
    }
    const readline = nativeReadlineSequence(event, IS_MAC, session.inputState);
    if (readline) {
      event.preventDefault();
      clearForInput();
      watch(session.write(readline));
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
    if (native && session.exitCode == null) watch(session.sendKey(native));
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
    if (event.defaultPrevented) return;
    event.preventDefault();
    if (!canPaste()) return;
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
  const reportsMouse = (event: {
    shiftKey: boolean;
    metaKey: boolean;
    ctrlKey: boolean;
  }) =>
    canInput() &&
    session.exitCode == null &&
    Boolean(session.inputState?.mouseTracking) &&
    !event.shiftKey &&
    !(IS_MAC ? event.metaKey : event.ctrlKey);
  const mouseEvent = (
    event: MouseEvent,
    action: NativeMouseEvent["action"],
    button: number | null,
  ): NativeMouseEvent => {
    const box = host.getBoundingClientRect();
    const cell = renderer.cellPixels ?? renderer.cellSize;
    const dpr = window.devicePixelRatio || 1;
    return {
      action,
      button,
      buttons: event.buttons ?? 0,
      mods:
        (event.shiftKey ? 1 : 0) |
        (event.altKey ? 2 : 0) |
        (event.ctrlKey ? 4 : 0) |
        (event.metaKey ? 8 : 0),
      x: Math.max(0, (event.clientX - box.left - 6) * dpr),
      y: Math.max(0, (event.clientY - box.top - 6) * dpr),
      cellWidth: Math.max(1, Math.round(cell.width)),
      cellHeight: Math.max(1, Math.round(cell.height)),
      screenWidth: Math.max(1, Math.round(cell.width * session.grid.cols)),
      screenHeight: Math.max(1, Math.round(cell.height * session.grid.rows)),
    };
  };
  const stopAutoscroll = () => {
    if (autoscrollTimer !== null) clearTimeout(autoscrollTimer);
    autoscrollTimer = null;
    dragPosition = null;
  };
  const autoscroll = () => {
    autoscrollTimer = null;
    if (disposed || pointer === null || !dragPosition || selectionBusy) {
      if (!disposed && pointer !== null && dragPosition)
        autoscrollTimer = setTimeout(autoscroll, 40);
      return;
    }
    const box = host.getBoundingClientRect();
    const { x, y, alt } = dragPosition;
    const distance =
      y < box.top + 6
        ? y - box.top - 6
        : y > box.bottom - 6
          ? y - box.bottom + 6
          : 0;
    if (!distance) return;
    session.scroll(
      Math.sign(distance) *
        Math.min(
          10,
          Math.max(1, Math.ceil(Math.abs(distance) / renderer.cellSize.height)),
        ),
    );
    watch(select({ kind: "drag", ...point(x, y), rectangle: alt }));
    autoscrollTimer = setTimeout(autoscroll, 40);
  };
  const scheduleMotion = () => {
    if (motionFrame || motionBusy || disposed || !pendingMotion) return;
    motionFrame = requestAnimationFrame(() => {
      motionFrame = 0;
      const motion = pendingMotion;
      pendingMotion = null;
      if (!motion || disposed) return;
      motionBusy = true;
      watch(
        session.sendMouse(motion).finally(() => {
          motionBusy = false;
          scheduleMotion();
        }),
      );
    });
  };
  const flushMotion = () => {
    if (motionFrame) cancelAnimationFrame(motionFrame);
    motionFrame = 0;
    if (pendingMotion) watch(session.sendMouse(pendingMotion));
    pendingMotion = null;
  };
  const onPointerDown = (event: PointerEvent) => {
    const secondary = isSecondaryClick(event, IS_MAC);
    if (
      reportsMouse(event) &&
      !(secondary && usesTerminalContextMenu(event, IS_MAC, session.getSelection() !== null))
    ) {
      if (event.button < 0 || event.button > 4) return;
      event.preventDefault();
      focus();
      mousePointer = event.pointerId;
      mouseButton = event.button <= 2 ? event.button : event.button + 4;
      try {
        host.setPointerCapture(event.pointerId);
      } catch {
        /* Detached host. */
      }
      flushMotion();
      lastMouse = mouseEvent(event, "press", mouseButton);
      watch(session.sendMouse(lastMouse));
      return;
    }

    if (secondary || event.button !== 0) return;
    event.preventDefault();
    focus();
    pointer = event.pointerId;
    try {
      host.setPointerCapture(pointer);
    } catch {
      /* A detached host cannot capture. */
    }
    const { col, row, x, y } = point(event.clientX, event.clientY);
    const seq = session.drawnSeq;
    const cursor = session.cursor;
    altPress =
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      seq !== null &&
      cursor &&
      canInput()
        ? {
            id: session.id,
            x: event.clientX,
            y: event.clientY,
            at: performance.now(),
            width: renderer.cellSize.width,
            height: renderer.cellSize.height,
            cursorX: cursor.x,
            cursorY: cursor.y,
            ...session.grid,
          }
        : null;
    blockPress =
      options.onBlockClick && seq != null && !event.metaKey && !event.ctrlKey
        ? { seq, row, x: event.clientX, y: event.clientY }
        : null;
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
    if (
      mousePointer === event.pointerId ||
      (pointer === null && reportsMouse(event))
    ) {
      pendingMotion = mouseEvent(
        event,
        "motion",
        event.buttons & 1
          ? 0
          : event.buttons & 4
            ? 1
            : event.buttons & 2
              ? 2
              : event.buttons & 8
                ? 7
                : event.buttons & 16
                  ? 8
                  : null,
      );
      lastMouse = pendingMotion;
      scheduleMotion();
      return;
    }
    if (pointer !== event.pointerId) return;
    if (
      blockPress &&
      Math.hypot(event.clientX - blockPress.x, event.clientY - blockPress.y) > 4
    )
      blockPress = null;
    if (
      altPress &&
      Math.hypot(event.clientX - altPress.x, event.clientY - altPress.y) > 4
    )
      altPress = null;
    dragPosition = { x: event.clientX, y: event.clientY, alt: event.altKey };
    if (autoscrollTimer === null) autoscrollTimer = setTimeout(autoscroll, 40);
    pendingDrag = {
      kind: "drag",
      ...point(event.clientX, event.clientY),
      rectangle: event.altKey,
    };
    scheduleDrag();
  };
  const onPointerUp = (event: PointerEvent) => {
    if (mousePointer === event.pointerId) {
      flushMotion();
      watch(session.sendMouse(mouseEvent(event, "release", mouseButton)));
      mousePointer = null;
      mouseButton = null;
      lastMouse = null;
      try {
        host.releasePointerCapture(event.pointerId);
      } catch {
        /* Already released. */
      }
      return;
    }
    if (pointer !== event.pointerId) return;
    stopAutoscroll();
    flushDrag(true);
    pointer = null;
    const click = blockPress;
    const alt = altPress;
    const duration = alt ? performance.now() - alt.at : Infinity;
    altPress = null;
    blockPress = null;
    const released = select({ kind: "release" });
    const generation = selectionGeneration;
    const revision = session.selectionRevision;
    const completed = released.then(async (text) => {
      const current = () =>
        !disposed &&
        options.isActive() &&
        document.hasFocus() &&
        document.activeElement === textarea &&
        session.exitCode == null &&
        generation === selectionGeneration &&
        session.selectionRevision === revision &&
        session.id === alt?.id &&
        session.grid.cols === alt?.cols &&
        session.grid.rows === alt?.rows &&
        session.cursor?.x === alt?.cursorX &&
        session.cursor?.y === alt?.cursorY &&
        renderer.cellSize.width === alt?.width &&
        renderer.cellSize.height === alt?.height &&
        canInput();
      if (
        alt &&
        event.altKey &&
        event.type !== "pointercancel" &&
        duration < 500 &&
        (text?.length ?? 0) <= 1 &&
        Math.hypot(event.clientX - alt.x, event.clientY - alt.y) <= 4 &&
        current()
      ) {
        const { col, row } = point(event.clientX, event.clientY);
        await session.moveCursor(
          {
            col,
            row,
            cols: alt.cols,
            rows: alt.rows,
            cursorX: alt.cursorX,
            cursorY: alt.cursorY,
          },
          current,
        );
        return;
      }
      if (
        !disposed &&
        click &&
        generation === selectionGeneration &&
        session.selectionRevision === revision &&
        event.type !== "pointercancel" &&
        Math.hypot(event.clientX - click.x, event.clientY - click.y) <= 4
      ) {
        await options.onBlockClick?.(click.seq, click.row);
      }
    });
    watch(completed);
    try {
      host.releasePointerCapture(event.pointerId);
    } catch {
      /* Capture may already have ended. */
    }
  };
  const onWheel = (event: WheelEvent) => {
    selectionGeneration++;
    event.preventDefault();
    const delta = wheelRows(
      wheelCarry,
      event.deltaY,
      event.deltaMode,
      renderer.cellSize.height,
      session.grid.rows,
    );
    wheelCarry = delta.carry;
    if (reportsMouse(event)) {
      const horizontal = wheelRows(
        wheelCarryX,
        event.deltaX || 0,
        event.deltaMode,
        renderer.cellSize.width,
        session.grid.cols,
      );
      wheelCarryX = horizontal.carry;
      if (horizontal.rows)
        watch(
          session.sendMouse({
            ...mouseEvent(event, "press", horizontal.rows < 0 ? 5 : 6),
            repeat: Math.min(32, Math.abs(horizontal.rows)),
          }),
        );
    }
    if (delta.rows && reportsMouse(event)) {
      watch(
        session.sendMouse({
          ...mouseEvent(event, "press", delta.rows < 0 ? 3 : 4),
          repeat: Math.min(32, Math.abs(delta.rows)),
        }),
      );
    } else if (
      delta.rows &&
      session.inputState?.alternateScreen &&
      session.exitCode == null &&
      canInput()
    ) {
      watch(
        session.sendKey({ code: delta.rows < 0 ? "ArrowUp" : "ArrowDown" }),
      );
    } else if (delta.rows) session.scroll(delta.rows);
  };
  const onContextMenu = (event: MouseEvent) => {
    if (reportsMouse(event) && !usesTerminalContextMenu(event, IS_MAC, session.getSelection() !== null))
      event.preventDefault();
  };
  const onFocus = () => reportFocus(true);
  const onBlur = () => {
    stopAutoscroll();
    if (pointer !== null) {
      flushDrag(true);
      pointer = null;
      blockPress = null;
      altPress = null;
      watch(select({ kind: "release" }));
    }
    if (mousePointer !== null) {
      flushMotion();
      if (lastMouse && session.exitCode == null)
        watch(
          session.sendMouse({
            ...lastMouse,
            action: "release",
            buttons: 0,
            button: mouseButton,
          }),
        );
      mousePointer = null;
      mouseButton = null;
      lastMouse = null;
    }
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
  host.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onWindowFocus);
  document.addEventListener("visibilitychange", onWindowFocus);
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
      stopAutoscroll();
      if (motionFrame) cancelAnimationFrame(motionFrame);
      pendingMotion = null;
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
      host.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("visibilitychange", onWindowFocus);
      textarea.remove();
      preedit.remove();
    },
  };
}
