import { describe, expect, it } from "vitest";

import {
  BOTTOM_MIN_H,
  DEFAULT_CHAT_LAYOUT,
  DOCK_MAX_W,
  DOCK_MIN_W,
  DOCK_SNAP_PX,
  WORKSPACE_MIN_H,
  WORKSPACE_MIN_W,
  clampBottomHeight,
  clampDockWidth,
  dockHintRect,
  dockMaxCss,
  floatingGeomAtPointer,
  parseChatLayout,
  resizeBottom,
  resizeDock,
  resolveDropTarget,
  type Rect,
} from "./chatLayout";
import { MIN_H, MIN_W } from "./miniWindowGeometry";

const host: Rect = { left: 200, top: 40, width: 1000, height: 700 };

describe("parseChatLayout", () => {
  it("defaults to the floating window for anything unusable", () => {
    expect(parseChatLayout(null)).toEqual(DEFAULT_CHAT_LAYOUT);
    expect(parseChatLayout("left")).toEqual(DEFAULT_CHAT_LAYOUT);
    expect(DEFAULT_CHAT_LAYOUT.mode).toBe("floating");
  });

  it("keeps valid fields and replaces only the broken ones", () => {
    expect(
      parseChatLayout({ mode: "right", dockWidth: "wide", bottomHeight: 250 }),
    ).toEqual({
      mode: "right",
      dockWidth: DEFAULT_CHAT_LAYOUT.dockWidth,
      bottomHeight: 250,
    });
    expect(parseChatLayout({ mode: "top" }).mode).toBe("floating");
  });

  it("clamps stored sizes into range", () => {
    const l = parseChatLayout({
      mode: "left",
      dockWidth: 99999,
      bottomHeight: 3,
    });
    expect(l.dockWidth).toBe(DOCK_MAX_W);
    expect(l.bottomHeight).toBe(BOTTOM_MIN_H);
    expect(parseChatLayout({ dockWidth: Number.NaN }).dockWidth).toBe(
      DEFAULT_CHAT_LAYOUT.dockWidth,
    );
  });
});

describe("clampDockWidth", () => {
  it("respects the dock's own limits on a wide host", () => {
    expect(clampDockWidth(10, 2000)).toBe(DOCK_MIN_W);
    expect(clampDockWidth(5000, 4000)).toBe(DOCK_MAX_W);
    expect(clampDockWidth(512.4, 2000)).toBe(512);
  });

  it("always leaves the workspace its minimum width", () => {
    expect(clampDockWidth(900, 1000)).toBe(1000 - WORKSPACE_MIN_W);
  });

  it("splits a host too narrow for both minimums instead of vanishing", () => {
    expect(clampDockWidth(400, 500)).toBe(250);
    expect(clampDockWidth(50, 500)).toBe(250);
    expect(clampDockWidth(400, 200)).toBe(100);
  });
});

describe("clampBottomHeight", () => {
  it("leaves room for the terminal and the composer", () => {
    expect(clampBottomHeight(2000, 800)).toBe(800 - WORKSPACE_MIN_H);
    expect(clampBottomHeight(10, 800)).toBe(BOTTOM_MIN_H);
    expect(clampBottomHeight(500, 240)).toBe(120);
  });
});

describe("dockMaxCss", () => {
  it("encodes the same limits for the browser", () => {
    expect(dockMaxCss("width")).toBe(
      `max(min(${DOCK_MIN_W}px, 50%), calc(100% - ${WORKSPACE_MIN_W}px))`,
    );
    expect(dockMaxCss("height")).toContain(`calc(100% - ${WORKSPACE_MIN_H}px)`);
  });
});

describe("resizeDock / resizeBottom", () => {
  it("grows a left dock when dragged right and a right dock when dragged left", () => {
    expect(resizeDock("left", 400, 50, 1, 2000)).toBe(450);
    expect(resizeDock("right", 400, -50, 1, 2000)).toBe(450);
    expect(resizeDock("right", 400, 50, 1, 2000)).toBe(350);
  });

  it("converts viewport deltas through the zoom scale", () => {
    expect(resizeDock("left", 400, 100, 2, 2000)).toBe(450);
    expect(resizeDock("left", 400, 100, 0, 2000)).toBe(500);
  });

  it("grows the bottom pane when its top edge moves up", () => {
    expect(resizeBottom(300, -60, 1, 1000)).toBe(360);
    expect(resizeBottom(300, 9999, 1, 1000)).toBe(BOTTOM_MIN_H);
  });
});

describe("resolveDropTarget", () => {
  it("snaps near the left, right and bottom edges", () => {
    expect(resolveDropTarget({ x: host.left + 5, y: 300 }, host)).toBe("left");
    expect(resolveDropTarget({ x: host.left - 10, y: 300 }, host)).toBe("left");
    expect(
      resolveDropTarget({ x: host.left + host.width - 3, y: 300 }, host),
    ).toBe("right");
    expect(
      resolveDropTarget({ x: 700, y: host.top + host.height - 4 }, host),
    ).toBe("bottom");
  });

  it("does not snap in the middle or far outside the host", () => {
    expect(resolveDropTarget({ x: 700, y: 300 }, host)).toBeNull();
    expect(
      resolveDropTarget({ x: host.left - DOCK_SNAP_PX - 1, y: 300 }, host),
    ).toBeNull();
    expect(
      resolveDropTarget({ x: host.left + 5, y: host.top - 1 }, host),
    ).toBeNull();
  });

  it("prefers a side over the bottom in a corner", () => {
    expect(
      resolveDropTarget(
        { x: host.left + 2, y: host.top + host.height - 2 },
        host,
      ),
    ).toBe("left");
  });
});

describe("dockHintRect", () => {
  const layout = { dockWidth: 400, bottomHeight: 300 };

  it("previews a full-height strip on the chosen side", () => {
    expect(dockHintRect("left", host, layout, 1)).toEqual({
      left: host.left,
      top: host.top,
      width: 400,
      height: host.height,
    });
    expect(dockHintRect("right", host, layout, 1)).toEqual({
      left: host.left + host.width - 400,
      top: host.top,
      width: 400,
      height: host.height,
    });
  });

  it("previews a full-width strip at the bottom", () => {
    expect(dockHintRect("bottom", host, layout, 1)).toEqual({
      left: host.left,
      top: host.top + host.height - 300,
      width: host.width,
      height: 300,
    });
  });

  it("scales the preview with the zoom", () => {
    expect(dockHintRect("left", host, layout, 0.5).width).toBe(200);
  });
});

describe("floatingGeomAtPointer", () => {
  const vp = { vw: 1440, vh: 900 };

  it("keeps the grabbed point under the pointer", () => {
    expect(
      floatingGeomAtPointer(
        { x: 700, y: 300 },
        { x: 50, y: 10 },
        { w: 500, h: 400 },
        vp,
      ),
    ).toEqual({ x: 650, y: 290, w: 500, h: 400 });
  });

  it("stays on screen and at least the minimum size", () => {
    const g = floatingGeomAtPointer(
      { x: 1430, y: 890 },
      { x: 900, y: 10 },
      { w: 10, h: 10 },
      vp,
    );
    expect(g.w).toBe(MIN_W);
    expect(g.h).toBe(MIN_H);
    expect(g.x + g.w).toBeLessThanOrEqual(vp.vw);
    expect(g.y + g.h).toBeLessThanOrEqual(vp.vh);
  });
});
