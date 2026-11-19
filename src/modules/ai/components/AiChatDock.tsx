import { cn } from "@/lib/utils";
import type { PresenceState } from "@/lib/usePresence";
import { useCallback, useEffect, useRef } from "react";
import {
  BOTTOM_MAX_H,
  BOTTOM_MIN_H,
  DOCK_MAX_W,
  DOCK_MIN_W,
  clampBottomHeight,
  clampDockWidth,
  dockMaxCss,
  resizeBottom,
  resizeDock,
} from "../lib/chatLayout";
import { useChatLayoutStore } from "../store/chatLayoutStore";
import { useChatStore } from "../store/chatStore";
import { AiChatSurface } from "./AiChatSurface";
import { useChatRelocate } from "./ChatRelocate";
import { PlanDiffReview } from "./PlanDiffReview";

type Edge = "left" | "right" | "top";

const KEY_STEP = 24;

/** Drag (and arrow-key) resizing of a docked chat along one edge. Sizes are
 * written straight to the element while dragging and committed once on
 * release, so a drag never re-renders the conversation. */
function useEdgeResize(edge: Edge, commit: (size: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => () => cancel.current?.(), []);

  const axis = edge === "top" ? "height" : "width";

  const measure = useCallback(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return null;
    const rect = host.getBoundingClientRect();
    const hostSize = axis === "height" ? host.offsetHeight : host.offsetWidth;
    const rendered = axis === "height" ? rect.height : rect.width;
    return {
      el,
      hostSize,
      scale: hostSize > 0 ? rendered / hostSize : 1,
      start: axis === "height" ? el.offsetHeight : el.offsetWidth,
    };
  }, [axis]);

  const next = useCallback(
    (start: number, delta: number, scale: number, hostSize: number) =>
      edge === "top"
        ? resizeBottom(start, delta, scale, hostSize)
        : resizeDock(
            edge === "right" ? "left" : "right",
            start,
            delta,
            scale,
            hostSize,
          ),
    [edge],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const m = measure();
      if (!m) return;
      e.preventDefault();
      cancel.current?.();
      const handle = e.currentTarget as HTMLElement;
      const pointerId = e.pointerId;
      const origin = edge === "top" ? e.clientY : e.clientX;
      let size = m.start;
      let frame = 0;
      handle.setPointerCapture?.(pointerId);
      document.body.style.userSelect = "none";
      document.body.style.cursor = edge === "top" ? "ns-resize" : "ew-resize";

      const onMove = (ev: PointerEvent) => {
        size = next(
          m.start,
          (edge === "top" ? ev.clientY : ev.clientX) - origin,
          m.scale,
          m.hostSize,
        );
        if (frame === 0) {
          frame = requestAnimationFrame(() => {
            frame = 0;
            m.el.style[axis] = `${size}px`;
          });
        }
      };
      const finish = (keep: boolean) => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        handle.releasePointerCapture?.(pointerId);
        if (frame) cancelAnimationFrame(frame);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        cancel.current = null;
        m.el.style[axis] = `${keep ? size : m.start}px`;
        if (keep) commit(size);
      };
      const onUp = (ev: PointerEvent) => finish(ev.type === "pointerup");
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
      cancel.current = () => finish(true);
    },
    [axis, commit, edge, measure, next],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const grow =
        edge === "top"
          ? { ArrowUp: 1, ArrowDown: -1 }
          : edge === "right"
            ? { ArrowRight: 1, ArrowLeft: -1 }
            : { ArrowLeft: 1, ArrowRight: -1 };
      const dir = grow[e.key as keyof typeof grow];
      if (!dir) return;
      e.preventDefault();
      const m = measure();
      if (!m) return;
      const size =
        edge === "top"
          ? clampBottomHeight(m.start + dir * KEY_STEP, m.hostSize)
          : clampDockWidth(m.start + dir * KEY_STEP, m.hostSize);
      m.el.style[axis] = `${size}px`;
      commit(size);
    },
    [axis, commit, edge, measure],
  );

  return { ref, onPointerDown, onKeyDown };
}

const HANDLE_CLASS: Record<Edge, string> = {
  left: "inset-y-0 -left-1 w-2 cursor-ew-resize",
  right: "inset-y-0 -right-1 w-2 cursor-ew-resize",
  top: "inset-x-0 -top-1 h-2 cursor-ns-resize",
};

const HANDLE_LINE_CLASS: Record<Edge, string> = {
  left: "inset-y-0 left-1 w-px",
  right: "inset-y-0 right-1 w-px",
  top: "inset-x-0 top-1 h-px",
};

function EdgeHandle({
  edge,
  label,
  value,
  min,
  max,
  onPointerDown,
  onKeyDown,
}: {
  edge: Edge;
  label: string;
  value: number;
  min: number;
  max: number;
  onPointerDown: (e: React.PointerEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot take focus or pointer handlers
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={edge === "top" ? "horizontal" : "vertical"}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      data-no-drag
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cn(
        "group/edge absolute z-20 touch-none select-none outline-none",
        HANDLE_CLASS[edge],
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute bg-transparent transition-colors",
          "group-hover/edge:bg-ring/70 group-focus-visible/edge:bg-ring group-active/edge:bg-ring",
          HANDLE_LINE_CLASS[edge],
        )}
      />
    </div>
  );
}

const SURFACE_CLASS =
  "no-scrollbar-deep relative flex min-h-0 shrink-0 flex-col bg-card text-[12px] duration-200 ease-out data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0";

/** The chat as a full-height side panel of the workspace. It is laid out
 * beside the terminal, not over it, so the terminal shrinks to make room. */
export function AiChatDock({
  side,
  state,
}: {
  side: "left" | "right";
  state: PresenceState;
}) {
  const closeMini = useChatStore((s) => s.closeMini);
  const width = useChatLayoutStore((s) => s.dockWidth);
  const setDockWidth = useChatLayoutStore((s) => s.setDockWidth);
  const edge = side === "left" ? "right" : "left";
  const resize = useEdgeResize(edge, setDockWidth);
  const { hint, onDockedHeaderPointerDown } = useChatRelocate(side);

  return (
    <div
      ref={resize.ref}
      data-state={state}
      data-ai-mini-window
      data-chat-layout={side}
      style={{ width: `${width}px`, maxWidth: dockMaxCss("width") }}
      className={cn(
        SURFACE_CLASS,
        "h-full",
        side === "left"
          ? "border-r border-border/60 data-[state=open]:slide-in-from-left-4 data-[state=closed]:slide-out-to-left-4"
          : "border-l border-border/60 data-[state=open]:slide-in-from-right-4 data-[state=closed]:slide-out-to-right-4",
      )}
    >
      <EdgeHandle
        edge={edge}
        label="Resize chat panel"
        value={width}
        min={DOCK_MIN_W}
        max={DOCK_MAX_W}
        onPointerDown={resize.onPointerDown}
        onKeyDown={resize.onKeyDown}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <AiChatSurface
          onClose={closeMini}
          onHeaderPointerDown={onDockedHeaderPointerDown}
        />
        <PlanDiffReview />
      </div>
      {hint}
    </div>
  );
}

/** The chat grown out of the bottom input bar: the conversation sits right
 * above the composer, between it and the terminal. */
export function AiChatBottomPane({ state }: { state: PresenceState }) {
  const closeMini = useChatStore((s) => s.closeMini);
  const height = useChatLayoutStore((s) => s.bottomHeight);
  const setBottomHeight = useChatLayoutStore((s) => s.setBottomHeight);
  const resize = useEdgeResize("top", setBottomHeight);
  const { hint, onDockedHeaderPointerDown } = useChatRelocate("bottom");

  return (
    <div
      ref={resize.ref}
      data-state={state}
      data-ai-mini-window
      data-chat-layout="bottom"
      style={{ height: `${height}px`, maxHeight: dockMaxCss("height") }}
      className={cn(
        SURFACE_CLASS,
        "w-full border-t border-border/60",
        "data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:slide-out-to-bottom-4",
      )}
    >
      <EdgeHandle
        edge="top"
        label="Resize chat panel"
        value={height}
        min={BOTTOM_MIN_H}
        max={BOTTOM_MAX_H}
        onPointerDown={resize.onPointerDown}
        onKeyDown={resize.onKeyDown}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <AiChatSurface
          onClose={closeMini}
          onHeaderPointerDown={onDockedHeaderPointerDown}
        />
        <PlanDiffReview />
      </div>
      {hint}
    </div>
  );
}
