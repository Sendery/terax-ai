import { afterEach, expect, it, vi } from "vitest";
const ui = vi.hoisted(() => ({
  render: vi.fn(),
  unmount: vi.fn(),
  pixels: vi.fn(() => "data:image/png;base64,full"),
}));
vi.mock("react-dom/client", () => ({
  createRoot: () => ({ render: ui.render, unmount: ui.unmount }),
}));
vi.mock("react-dom", () => ({ flushSync: (run: () => void) => run() }));
vi.mock("@/modules/terminal/block/BlockOverlay", () => ({
  BlockOverlaySnapshot: () => null,
}));
vi.mock("@/modules/terminal/gl/nativeCapturePixels", () => ({
  renderNativeCapturePixels: ui.pixels,
}));
import { captureNativePane } from "@/modules/terminal/gl/nativeCaptureProvider";
import type { NativeCaptureFrame } from "@/modules/terminal/gl/engineSession";
import { decodeFrame, FRAME_FLAG_FULL } from "@/modules/terminal/gl/frameCodec";
import { encodeFrame, textRow } from "@/modules/terminal/gl/frameCodec.testing";

function fixture(blocks = true) {
  const bounds = { left: 0, top: 0, width: 44, height: 44 };
  const old = {} as Element;
  const root = {
    isConnected: true,
    getBoundingClientRect: () => bounds,
    querySelectorAll: () => [old],
    querySelector: () => old,
    insertBefore: vi.fn((host: { isConnected: boolean }) => {
      host.isConnected = true;
    }),
  } as unknown as HTMLElement;
  const canvas = {
    getBoundingClientRect: () => ({ left: 6, top: 6, width: 32, height: 32 }),
  } as HTMLCanvasElement;
  const host = {
    style: {},
    inert: false,
    isConnected: false,
    setAttribute: vi.fn(),
    remove: vi.fn(),
  } as unknown as HTMLElement;
  vi.stubGlobal("document", { createElement: () => host });
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  let valid = true;
  const native: NativeCaptureFrame = {
    frame: decodeFrame(
      encodeFrame({
        seq: 7,
        cols: 4,
        rows: 2,
        flags: FRAME_FLAG_FULL,
        rowRecords: [textRow(0, "pub")],
      }),
    ),
    blocks: blocks
      ? {
          seq: 7,
          metadataVersion: 1,
          hasAny: true,
          alternateScreen: false,
          viewportOffset: 0,
          viewportRows: 2,
          blocks: [
            {
              id: "b1",
              command: "public command",
              cwd: "/public",
              exitCode: 0,
              running: false,
              startedAt: 1,
              finishedAt: 2,
              startLine: 1,
              endLine: 1,
              headerLine: 0,
            },
          ],
        }
      : null,
    current: () => valid,
    release: vi.fn(),
  };
  const session = { captureFrame: vi.fn(async () => native) };
  const options = {
    root,
    canvas,
    session,
    blocks,
    promptReady: () => true,
    appearance: {
      font: { family: "mono", weight: "normal", size: 14, letterSpacing: 0 },
      background: 0,
      width: 32,
      height: 32,
      dpr: 1,
      cellSize: { width: 8, height: 16 },
      focused: false,
    },
    scope: { signal: new AbortController().signal, current: () => valid },
  };
  return {
    root,
    canvas,
    host,
    old,
    native,
    options,
    bounds,
    invalidate: () => {
      valid = false;
    },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("freezes pixels and readonly block chrome from the same full and holds ownership until disposal", async () => {
  const f = fixture();
  const lease = await captureNativePane(f.options);
  expect(ui.pixels).toHaveBeenCalledWith(
    f.native.frame,
    f.options.appearance,
    expect.any(Function),
  );
  expect(ui.render.mock.calls[0][0].props.visible.blocks[0]).toMatchObject({
    id: "b1",
    command: "public command",
    headerTop: 7.6,
  });
  expect(f.root.insertBefore).toHaveBeenCalledExactlyOnceWith(f.host, f.old);
  expect(f.host.inert).toBe(true);
  expect(f.native.release).not.toHaveBeenCalled();
  expect(lease.foreground).toBe(f.host);
  expect(lease.excluded).toEqual([f.old, f.host]);
  expect(lease.current()).toBe(true);
  lease.dispose();
  lease.dispose();
  expect(ui.unmount).toHaveBeenCalledOnce();
  expect(f.host.remove).toHaveBeenCalledOnce();
  expect(f.native.release).toHaveBeenCalledOnce();
});
it("does not create block chrome for an ordinary full capture", async () => {
  const f = fixture(false);
  const lease = await captureNativePane(f.options);
  expect(lease.foreground).toBeUndefined();
  expect(ui.render).not.toHaveBeenCalled();
  lease.dispose();
  expect(f.native.release).toHaveBeenCalledOnce();
});
it.each(["privacy", "geometry", "projection", "pixels"] as const)(
  "cleans a capture invalidated by %s without exposing a blank snapshot",
  async (kind) => {
    const f = fixture();
    if (kind === "pixels")
      ui.pixels.mockImplementationOnce(() => {
        throw new Error("pixels unavailable");
      });
    if (kind === "projection" && f.native.blocks) f.native.blocks.seq = 99;
    if (kind === "privacy" || kind === "geometry") {
      f.options.session.captureFrame.mockImplementationOnce(async () => {
        if (kind === "privacy") f.invalidate();
        else f.bounds.width += 1;
        return f.native;
      });
    }
    await expect(captureNativePane(f.options)).rejects.toThrow();
    expect(f.native.release).toHaveBeenCalledOnce();
    expect(f.host.remove).toHaveBeenCalledTimes(0);
    expect(ui.render).not.toHaveBeenCalled();
  },
);
