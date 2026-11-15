import { IS_MAC } from "@/lib/platform";
import { openExternalUrl } from "@/lib/external-link";
import type { EngineSession } from "@/modules/terminal/gl/engineSession";
import type { GridRenderer } from "@/modules/terminal/gl/gridRenderer";
import type { DecodedFrame } from "@/modules/terminal/gl/frameCodec";
import {
  NativeLinkCoordinator,
  type NativeLinkPoint,
} from "@/modules/terminal/gl/nativeLinkCoordinator";
import type { ResolvedNativeLink } from "@/modules/terminal/gl/nativeLinks";
import type {
  FileLinkStat,
  TerminalFileLocation,
} from "@/modules/terminal/lib/fileLinks";
import { isLinkActivation } from "@/modules/terminal/lib/pointer";
import { currentWorkspaceEnv, workspaceScopeKey } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";

type Options = {
  available: () => boolean;
  active: () => boolean;
  cwd: () => string | null | undefined;
  home: () => string | null | undefined;
  foreground: () => string;
  openFile: (path: string, location?: TerminalFileLocation) => void;
  focus: () => void;
};
export type NativeLinkBinding = {
  onFrame: (frame: DecodedFrame | null | undefined) => void;
  onDrawn: () => void;
  updateLayout: () => void;
  invalidate: () => void;
  dispose: () => void;
};
export function bindNativeLinks(
  session: EngineSession,
  renderer: GridRenderer,
  host: HTMLElement,
  options: Options,
): NativeLinkBinding {
  let disposed = false;
  let layoutReady = false;
  let layoutKey = "";
  let scheduled = 0;
  let refreshWanted = false;
  let pointer: { x: number; y: number } | null = null;
  let pressed: { id: number; x: number; y: number; dragged: boolean } | null =
    null;
  const initialCursor = host.style.cursor;
  const initialTitle = host.title;
  const overlay = document.createElement("div");
  overlay.setAttribute("aria-hidden", "true");
  overlay.setAttribute("data-terax-capture-foreground", "");
  overlay.dataset.nativeLinkHover = "";
  overlay.style.cssText =
    "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:1;";
  host.append(overlay);
  const geometry = () => {
    const box = host.getBoundingClientRect();
    const cell = renderer.cellSize;
    return [
      box.left,
      box.top,
      box.width,
      box.height,
      cell.width,
      cell.height,
    ].join(":");
  };
  const available = () => !disposed && host.isConnected && options.available();
  const paint = (link: ResolvedNativeLink | null) => {
    overlay.replaceChildren();
    host.style.cursor = link ? "pointer" : initialCursor;
    host.title = link
      ? link.target.kind === "url"
        ? link.target.url
        : `${link.target.path}${link.target.location ? `:${link.target.location.line}${link.target.location.column ? `:${link.target.location.column}` : ""}` : ""}`
      : initialTitle;
    if (!link) return;
    const cell = renderer.cellSize;
    for (const range of link.ranges) {
      const line = document.createElement("div");
      line.style.cssText =
        "position:absolute;height:0;border-bottom:1px solid;pointer-events:none;";
      line.style.left = `${6 + range.start * cell.width}px`;
      line.style.top = `${6 + (range.row + 1) * cell.height - 2}px`;
      line.style.width = `${(range.end - range.start) * cell.width}px`;
      line.style.borderColor = options.foreground();
      overlay.append(line);
    }
  };
  const controller = new NativeLinkCoordinator({
    lookup: (point) => session.linkContext(point.seq, point.col, point.row),
    origin: () => {
      const workspace = currentWorkspaceEnv();
      const cwd = options.cwd();
      const home = options.home();
      return {
        key: JSON.stringify([
          session.id,
          workspaceScopeKey(workspace),
          cwd,
          home,
          geometry(),
        ]),
        source: {
          cwd,
          home,
          stat: (path: string) =>
            invoke<FileLinkStat>("fs_stat", { path, workspace }).catch(
              () => null,
            ),
        },
      };
    },
    available,
    active: () => available() && options.active() && document.hasFocus(),
    presentedSeq: () => session.drawnSeq,
    paint,
    openFile: options.openFile,
    openUrl: (uri) => openExternalUrl(uri),
    focus: options.focus,
    isMac: IS_MAC,
  });
  const pointAt = (x: number, y: number): NativeLinkPoint | null => {
    const grid = session.drawnGrid;
    if (!available() || !layoutReady || !grid) return null;
    const box = host.getBoundingClientRect();
    const cell = renderer.cellSize;
    const col = Math.floor((x - box.left - 6) / cell.width);
    const row = Math.floor((y - box.top - 6) / cell.height);
    if (
      col < 0 ||
      row < 0 ||
      col >= grid.cols ||
      row >= grid.rows ||
      x >= box.right - 6 ||
      y >= box.bottom - 6
    )
      return null;
    return { seq: grid.seq, col, row };
  };
  const schedule = () => {
    if (scheduled || disposed || !pointer || pressed) return;
    scheduled = requestAnimationFrame(() => {
      scheduled = 0;
      if (!pointer || pressed) return;
      const point = pointAt(pointer.x, pointer.y);
      if (point) {
        refreshWanted = false;
        void controller.hover(point);
      } else {
        controller.invalidateHover();
        refreshWanted =
          available() && (!layoutReady || session.drawnGrid === null);
      }
    });
  };
  const invalidate = () => {
    controller.invalidate();
    refreshWanted = true;
    schedule();
  };
  const move = (event: PointerEvent) => {
    pointer = { x: event.clientX, y: event.clientY };
    if (pressed) {
      if (
        pressed.id === event.pointerId &&
        Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 3
      ) {
        pressed.dragged = true;
        controller.invalidateHover();
      }
      return;
    }
    schedule();
  };
  const down = (event: PointerEvent) => {
    if (!isLinkActivation(event, IS_MAC)) return;
    const point = pointAt(event.clientX, event.clientY);
    if (!point) return;
    pressed = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      dragged: false,
    };
    controller.begin(point);
  };
  const up = (event: PointerEvent) => {
    if (pressed?.id !== event.pointerId) return;
    const gesture = pressed;
    pressed = null;
    const point = pointAt(event.clientX, event.clientY);
    if (point)
      void controller.end(
        point,
        { button: event.button, ctrlKey: event.ctrlKey },
        gesture.dragged,
      );
    else controller.invalidate();
    schedule();
  };
  const leave = () => {
    pointer = null;
    controller.invalidateHover();
  };
  const cancel = () => {
    pressed = null;
    controller.invalidate();
  };
  const wheel = () => {
    invalidate();
  };
  const blur = () => {
    leave();
    cancel();
  };
  host.addEventListener("pointerenter", move);
  host.addEventListener("pointermove", move);
  host.addEventListener("pointerleave", leave);
  host.addEventListener("pointerdown", down, true);
  host.addEventListener("pointerup", up, true);
  host.addEventListener("pointercancel", cancel, true);
  host.addEventListener("wheel", wheel, { passive: true });
  window.addEventListener("blur", blur);
  return {
    onFrame: (frame) => {
      if (!pointer) return;
      const context = controller.context;
      const affected = new Set(context?.rows.map((row) => row.row));
      if (
        !frame ||
        frame.full ||
        !context ||
        frame.rowWords.some((word) => affected.has(frame.u16[word * 2]))
      ) {
        controller.invalidateHover();
        refreshWanted = true;
      }
    },
    onDrawn: () => {
      layoutReady = true;
      if (refreshWanted) schedule();
    },
    updateLayout: () => {
      const next = geometry();
      if (layoutKey !== next) {
        layoutKey = next;
        layoutReady = false;
        // A geometry-only redraw has no new PTY frame. Request its draw
        // notification so hit testing resumes against the presented grid.
        renderer.markUndrawn(session.pane);
        invalidate();
      }
    },
    invalidate,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      controller.dispose();
      if (scheduled) cancelAnimationFrame(scheduled);
      host.removeEventListener("pointerenter", move);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
      host.removeEventListener("pointerdown", down, true);
      host.removeEventListener("pointerup", up, true);
      host.removeEventListener("pointercancel", cancel, true);
      host.removeEventListener("wheel", wheel);
      window.removeEventListener("blur", blur);
      overlay.remove();
      host.style.cursor = initialCursor;
      host.title = initialTitle;
    },
  };
}
