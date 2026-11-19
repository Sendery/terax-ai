import { useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  CHAT_DOCK_HOST_ATTR,
  CHAT_LAYOUT_LABEL,
  dockHintRect,
  floatingGeomAtPointer,
  resolveDropTarget,
  type ChatDockTarget,
  type ChatLayoutMode,
  type Point,
  type Rect,
} from "../lib/chatLayout";
import { defaultGeom } from "../lib/miniWindowGeometry";
import {
  loadGeom,
  saveGeom,
  type MiniWindowDragHooks,
} from "../lib/useMiniWindowGeometry";
import { useChatLayoutStore } from "../store/chatLayoutStore";
import { useChatStore } from "../store/chatStore";

export function switchChatLayout(mode: ChatLayoutMode) {
  useChatLayoutStore.getState().setMode(mode);
  // The bottom pane sits on the composer; without it the pane would float
  // over an empty strip.
  if (mode === "bottom") useChatStore.getState().openPanel();
}

type Host = { rect: Rect; scale: number };

function measureHost(): Host | null {
  const el = document.querySelector<HTMLElement>(`[${CHAT_DOCK_HOST_ATTR}]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const scale = el.offsetWidth > 0 ? r.width / el.offsetWidth : 1;
  return {
    rect: { left: r.left, top: r.top, width: r.width, height: r.height },
    scale,
  };
}

const viewport = () => ({ vw: window.innerWidth, vh: window.innerHeight });

type Hint =
  | { kind: "dock"; target: ChatDockTarget; rect: Rect }
  | {
      kind: "float";
      rect: Rect;
    };

/** A drop preview drawn straight to the DOM: it follows the pointer on every
 * move, which must not re-render the chat. */
function useDropHint() {
  const box = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);

  const show = useCallback((hint: Hint | null) => {
    const el = box.current;
    if (!el) return;
    if (!hint) {
      el.style.opacity = "0";
      return;
    }
    const { rect } = hint;
    el.style.transition =
      hint.kind === "dock"
        ? "opacity 120ms, left 120ms, top 120ms, width 120ms, height 120ms"
        : "opacity 120ms";
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
    el.style.opacity = "1";
    if (label.current) {
      label.current.textContent =
        hint.kind === "dock"
          ? CHAT_LAYOUT_LABEL[hint.target]
          : CHAT_LAYOUT_LABEL.floating;
    }
  }, []);

  const node = createPortal(
    <div
      ref={box}
      aria-hidden
      style={{ opacity: 0 }}
      className="pointer-events-none fixed z-50 flex items-center justify-center rounded-xl border-2 border-primary/60 bg-primary/10 backdrop-blur-[1px]"
    >
      <span
        ref={label}
        className="rounded-md bg-background/90 px-2 py-1 text-[11px] font-medium text-foreground shadow-sm"
      />
    </div>,
    document.body,
  );

  return { node, show };
}

function hintFor(target: ChatDockTarget, host: Host): Hint {
  const { dockWidth, bottomHeight } = useChatLayoutStore.getState();
  return {
    kind: "dock",
    target,
    rect: dockHintRect(
      target,
      host.rect,
      { dockWidth, bottomHeight },
      host.scale,
    ),
  };
}

/** Moving the chat between its presentations by dragging its header: to an
 * edge of the workspace to dock it, anywhere else to float it. */
export function useChatRelocate(mode: ChatLayoutMode) {
  const { node, show } = useDropHint();
  const host = useRef<Host | null>(null);
  const target = useRef<ChatDockTarget | null>(null);
  const cancelDocked = useRef<(() => void) | null>(null);

  useEffect(() => () => cancelDocked.current?.(), []);

  const trackDock = useCallback(
    (p: Point) => {
      host.current ??= measureHost();
      const h = host.current;
      const t = h ? resolveDropTarget(p, h.rect) : null;
      target.current = t;
      show(t && h && t !== mode ? hintFor(t, h) : null);
      return t;
    },
    [mode, show],
  );

  const reset = useCallback(() => {
    host.current = null;
    target.current = null;
    show(null);
  }, [show]);

  const floatingHooks = useMemo<MiniWindowDragHooks>(
    () => ({
      onDragMove: trackDock,
      onDragEnd: (_p, cancelled) => {
        const t = target.current;
        reset();
        if (cancelled || !t) return false;
        switchChatLayout(t);
        return true;
      },
    }),
    [trackDock, reset],
  );

  const onDockedHeaderPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const header = e.currentTarget as HTMLElement;
      if (
        (e.target as HTMLElement).closest(
          "button, input, select, textarea, a, [role], [data-no-drag]",
        )
      )
        return;
      cancelDocked.current?.();
      const pointerId = e.pointerId;
      const start = { x: e.clientX, y: e.clientY };
      const panel = header.parentElement?.getBoundingClientRect();
      const size = loadGeom() ?? defaultGeom(viewport());
      const grab = {
        x: panel ? ((start.x - panel.left) / panel.width) * size.w : size.w / 2,
        y: panel ? Math.min(start.y - panel.top, 40) : 20,
      };
      let armed = false;
      let floatAt: ReturnType<typeof floatingGeomAtPointer> | null = null;

      const onMove = (ev: PointerEvent) => {
        const p = { x: ev.clientX, y: ev.clientY };
        if (!armed) {
          if (Math.abs(p.x - start.x) < 6 && Math.abs(p.y - start.y) < 6)
            return;
          armed = true;
          header.setPointerCapture?.(pointerId);
          document.body.style.userSelect = "none";
        }
        const t = trackDock(p);
        if (t) {
          floatAt = null;
          return;
        }
        floatAt = floatingGeomAtPointer(p, grab, size, viewport());
        show({
          kind: "float",
          rect: {
            left: floatAt.x,
            top: floatAt.y,
            width: floatAt.w,
            height: floatAt.h,
          },
        });
      };
      const finish = (ev: PointerEvent | null) => {
        header.removeEventListener("pointermove", onMove);
        header.removeEventListener("pointerup", onUp);
        header.removeEventListener("pointercancel", onCancel);
        cancelDocked.current = null;
        const t = target.current;
        const geom = floatAt;
        reset();
        if (!armed) return;
        header.releasePointerCapture?.(pointerId);
        document.body.style.userSelect = "";
        if (!ev || ev.type === "pointercancel") return;
        if (t) {
          if (t !== mode) switchChatLayout(t);
          return;
        }
        if (geom) {
          saveGeom(geom);
          switchChatLayout("floating");
        }
      };
      const onUp = (ev: PointerEvent) => finish(ev);
      const onCancel = (ev: PointerEvent) => finish(ev);
      header.addEventListener("pointermove", onMove);
      header.addEventListener("pointerup", onUp);
      header.addEventListener("pointercancel", onCancel);
      cancelDocked.current = () => finish(null);
    },
    [mode, reset, show, trackDock],
  );

  return { hint: node, floatingHooks, onDockedHeaderPointerDown };
}
