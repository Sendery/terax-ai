import { clampGeom, type Geom, type Viewport } from "./miniWindowGeometry";

export type ChatLayoutMode = "floating" | "left" | "right" | "bottom";
export type ChatDockTarget = Exclude<ChatLayoutMode, "floating">;

export type ChatLayout = {
  mode: ChatLayoutMode;
  dockWidth: number;
  bottomHeight: number;
};

export type Rect = { left: number; top: number; width: number; height: number };
export type Point = { x: number; y: number };

export const CHAT_LAYOUT_MODES: readonly ChatLayoutMode[] = [
  "floating",
  "left",
  "right",
  "bottom",
];

export const CHAT_LAYOUT_LABEL: Record<ChatLayoutMode, string> = {
  floating: "Floating window",
  left: "Dock left",
  right: "Dock right",
  bottom: "Bottom panel",
};

export const DOCK_MIN_W = 300;
export const DOCK_MAX_W = 960;
const DOCK_DEFAULT_W = 420;
export const BOTTOM_MIN_H = 140;
export const BOTTOM_MAX_H = 1200;
const BOTTOM_DEFAULT_H = 300;
/** Room the terminal keeps beside a side dock. */
export const WORKSPACE_MIN_W = 320;
/** Room the terminal plus the composer keep above and below the bottom pane. */
export const WORKSPACE_MIN_H = 200;
export const DOCK_SNAP_PX = 28;
/** Marks the element the side docks and the bottom pane are laid out in. */
export const CHAT_DOCK_HOST_ATTR = "data-ai-dock-host";

export const DEFAULT_CHAT_LAYOUT: ChatLayout = {
  mode: "floating",
  dockWidth: DOCK_DEFAULT_W,
  bottomHeight: BOTTOM_DEFAULT_H,
};

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

export function isChatLayoutMode(v: unknown): v is ChatLayoutMode {
  return (
    typeof v === "string" &&
    (CHAT_LAYOUT_MODES as readonly string[]).includes(v)
  );
}

/** Accepts anything read back from storage and returns a usable layout;
 * every field falls back on its own so one bad value never loses the rest. */
export function parseChatLayout(raw: unknown): ChatLayout {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CHAT_LAYOUT };
  const r = raw as Record<string, unknown>;
  return {
    mode: isChatLayoutMode(r.mode) ? r.mode : DEFAULT_CHAT_LAYOUT.mode,
    dockWidth: finite(r.dockWidth)
      ? clamp(Math.round(r.dockWidth), DOCK_MIN_W, DOCK_MAX_W)
      : DEFAULT_CHAT_LAYOUT.dockWidth,
    bottomHeight: finite(r.bottomHeight)
      ? clamp(Math.round(r.bottomHeight), BOTTOM_MIN_H, BOTTOM_MAX_H)
      : DEFAULT_CHAT_LAYOUT.bottomHeight,
  };
}

/** Largest size a docked chat may take along an axis of `host` pixels: it
 * leaves the workspace its minimum, but when the host is too small for both
 * minimums the two split it rather than the chat collapsing to nothing.
 * `dockSizeCss` is the same rule for the browser to apply on window resize. */
function dockLimit(host: number, min: number, max: number, keep: number) {
  return Math.max(Math.min(min, host / 2), Math.min(max, host - keep));
}

export function clampDockWidth(width: number, hostWidth: number): number {
  const hi = dockLimit(hostWidth, DOCK_MIN_W, DOCK_MAX_W, WORKSPACE_MIN_W);
  return Math.round(clamp(width, Math.min(DOCK_MIN_W, hi), hi));
}

export function clampBottomHeight(height: number, hostHeight: number): number {
  const hi = dockLimit(hostHeight, BOTTOM_MIN_H, BOTTOM_MAX_H, WORKSPACE_MIN_H);
  return Math.round(clamp(height, Math.min(BOTTOM_MIN_H, hi), hi));
}

/** CSS `max-width` / `max-height` mirroring `dockLimit` against the parent. */
export function dockMaxCss(axis: "width" | "height"): string {
  const [min, keep] =
    axis === "width"
      ? [DOCK_MIN_W, WORKSPACE_MIN_W]
      : [BOTTOM_MIN_H, WORKSPACE_MIN_H];
  return `max(min(${min}px, 50%), calc(100% - ${keep}px))`;
}

/** Pointer deltas arrive in viewport pixels while sizes live inside the
 * zoomed workspace, hence the `scale` (rendered px per CSS px). */
export function resizeDock(
  side: "left" | "right",
  startWidth: number,
  dx: number,
  scale: number,
  hostWidth: number,
): number {
  const delta = dx / (scale > 0 ? scale : 1);
  return clampDockWidth(
    side === "left" ? startWidth + delta : startWidth - delta,
    hostWidth,
  );
}

export function resizeBottom(
  startHeight: number,
  dy: number,
  scale: number,
  hostHeight: number,
): number {
  return clampBottomHeight(
    startHeight - dy / (scale > 0 ? scale : 1),
    hostHeight,
  );
}

/** Which workspace edge a pointer is close enough to snap to, if any. Sides
 * win over the bottom in the corners, since a side dock is the bigger move. */
export function resolveDropTarget(
  p: Point,
  host: Rect,
  threshold = DOCK_SNAP_PX,
): ChatDockTarget | null {
  const right = host.left + host.width;
  const bottom = host.top + host.height;
  if (p.y < host.top || p.y > bottom + threshold) return null;
  if (p.x < host.left - threshold || p.x > right + threshold) return null;
  if (p.x - host.left <= threshold) return "left";
  if (right - p.x <= threshold) return "right";
  if (bottom - p.y <= threshold) return "bottom";
  return null;
}

/** Viewport rect previewing where a docked chat would land. */
export function dockHintRect(
  target: ChatDockTarget,
  host: Rect,
  layout: Pick<ChatLayout, "dockWidth" | "bottomHeight">,
  scale: number,
): Rect {
  const s = scale > 0 ? scale : 1;
  if (target === "bottom") {
    const h = clampBottomHeight(layout.bottomHeight, host.height / s) * s;
    return {
      left: host.left,
      top: host.top + host.height - h,
      width: host.width,
      height: h,
    };
  }
  const w = clampDockWidth(layout.dockWidth, host.width / s) * s;
  return {
    left: target === "left" ? host.left : host.left + host.width - w,
    top: host.top,
    width: w,
    height: host.height,
  };
}

/** Floating geometry for a window undocked by dragging its header: the
 * pointer keeps the same spot on the header it grabbed, clamped on screen. */
export function floatingGeomAtPointer(
  p: Point,
  grabOffset: Point,
  size: { w: number; h: number },
  vp: Viewport,
): Geom {
  const grabX = clamp(grabOffset.x, 0, size.w);
  return clampGeom(
    { x: p.x - grabX, y: p.y - grabOffset.y, w: size.w, h: size.h },
    vp,
  );
}
