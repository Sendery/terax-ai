import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DragDropEvent } from "@tauri-apps/api/webview";

const native = vi.hoisted(() => ({
  effect: null as null | (() => (() => void) | undefined),
  listener: null as null | ((event: { payload: DragDropEvent }) => void),
  registration: null as Promise<() => void> | null,
  unlisten: vi.fn(),
  setTarget: vi.fn(),
  pasteIntoLeaf: vi.fn(),
}));
vi.mock("react", () => ({
  useEffect: (effect: () => (() => void) | undefined) => {
    native.effect = effect;
  },
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (
      listener: (event: { payload: DragDropEvent }) => void,
    ) => {
      native.listener = listener;
      return native.registration ?? Promise.resolve(native.unlisten);
    },
  }),
}));
vi.mock("@/modules/terminal/lib/dropStore", () => ({
  useTerminalDropStore: { getState: () => ({ setTarget: native.setTarget }) },
}));
vi.mock("@/modules/terminal/lib/rendererPool", () => ({
  pasteIntoLeaf: native.pasteIntoLeaf,
}));
vi.mock("@/lib/platform", () => ({ IS_WINDOWS: false }));

import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { useTerminalFileDrop } from "@/modules/terminal/lib/useTerminalFileDrop";

const viewport = { innerWidth: 800, innerHeight: 600, devicePixelRatio: 2 };
const left = { closest: () => ({ dataset: { paneLeaf: "17" } }) };
const right = { closest: () => ({ dataset: { paneLeaf: "29" } }) };
const elementFromPoint = vi.fn((x: number, y: number) => {
  if (x < 0 || x >= 800 || y < 0 || y >= 600) return null;
  return x < 400 ? left : right;
});
async function TestHarness() {
  useTerminalFileDrop();
  const cleanup = native.effect?.();
  await Promise.resolve();
  return cleanup ?? (() => {});
}
function positioned(
  type: "enter" | "over" | "drop",
  x: number,
  y: number,
  paths: string[] = [],
) {
  const position = new PhysicalPosition(x, y);
  const payload: DragDropEvent =
    type === "over" ? { type, position } : { type, position, paths };
  native.listener?.({ payload });
}
beforeEach(() => {
  native.effect = null;
  native.listener = null;
  native.registration = null;
  native.unlisten.mockReset();
  native.setTarget.mockReset();
  native.pasteIntoLeaf.mockReset();
  elementFromPoint.mockClear();
  viewport.devicePixelRatio = 2;
  vi.stubGlobal("window", viewport);
  vi.stubGlobal("document", { elementFromPoint });
});
afterEach(() => vi.unstubAllGlobals());

describe("terminal OS file drops", () => {
  it("targets the correct Retina split even when physical coordinates fit the CSS viewport", async () => {
    const cleanup = await TestHarness();
    positioned("enter", 600, 200);
    positioned("over", 600, 200);
    expect(native.setTarget.mock.calls).toEqual([[17], [17]]);
    positioned("drop", 600, 200, [
      "/tmp/clean.png",
      "/tmp/My Photos/caf\u00e9 $(literal).png",
    ]);
    expect(native.setTarget).toHaveBeenLastCalledWith(null);
    expect(elementFromPoint).toHaveBeenLastCalledWith(300, 100);
    expect(native.pasteIntoLeaf).toHaveBeenCalledExactlyOnceWith(
      17,
      "/tmp/clean.png '/tmp/My Photos/caf\u00e9 $(literal).png' ",
    );
    cleanup();
  });
  it("preserves logical coordinates on a scale-one display", async () => {
    viewport.devicePixelRatio = 1;
    const cleanup = await TestHarness();
    positioned("drop", 600, 200, ["/tmp/right.png"]);
    expect(native.pasteIntoLeaf).toHaveBeenCalledExactlyOnceWith(
      29,
      "/tmp/right.png ",
    );
    expect(elementFromPoint).toHaveBeenCalledWith(600, 200);
    cleanup();
  });
  it("uses the current display scale and fresh drop location rather than the previous hover", async () => {
    const cleanup = await TestHarness();
    positioned("over", 600, 200);
    expect(native.setTarget).toHaveBeenLastCalledWith(17);
    viewport.devicePixelRatio = 1.5;
    positioned("drop", 900, 150, ["/tmp/right.png"]);
    expect(native.pasteIntoLeaf).toHaveBeenCalledExactlyOnceWith(
      29,
      "/tmp/right.png ",
    );
    expect(elementFromPoint).toHaveBeenLastCalledWith(600, 100);
    cleanup();
  });
  it("ignores empty or outside-pane drops and clears the hover on leave", async () => {
    const cleanup = await TestHarness();
    positioned("over", 600, 200);
    native.listener?.({ payload: { type: "leave" } });
    expect(native.setTarget).toHaveBeenLastCalledWith(null);
    positioned("drop", 600, 200);
    positioned("drop", -1, -1, ["/tmp/not-in-pane.png"]);
    expect(native.pasteIntoLeaf).not.toHaveBeenCalled();
    cleanup();
    expect(native.unlisten).toHaveBeenCalledOnce();
  });
  it("ignores native events after unmount while listener registration is still pending", async () => {
    let complete = (_unlisten: () => void) => {};
    native.registration = new Promise((resolve) => {
      complete = resolve;
    });
    const cleanup = await TestHarness();
    cleanup();
    native.setTarget.mockClear();
    positioned("over", 600, 200);
    positioned("drop", 600, 200, ["/tmp/stale.png"]);
    expect(native.setTarget).not.toHaveBeenCalled();
    expect(native.pasteIntoLeaf).not.toHaveBeenCalled();
    complete(native.unlisten);
    await Promise.resolve();
    expect(native.unlisten).toHaveBeenCalledOnce();
  });
});
