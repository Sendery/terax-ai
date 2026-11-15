import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasGraphics } from "@/modules/terminal/gl/canvasGraphics";
import type { DecodedGraphics } from "@/modules/terminal/gl/graphicsCodec";
function setup() {
  const contexts: {
    putImageData: ReturnType<typeof vi.fn>;
    drawImage: ReturnType<typeof vi.fn>;
    clearRect: ReturnType<typeof vi.fn>;
  }[] = [];
  const canvases: HTMLCanvasElement[] = [];
  vi.stubGlobal("document", {
    createElement: () => {
      const context = {
        putImageData: vi.fn(),
        drawImage: vi.fn(),
        clearRect: vi.fn(),
      };
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => context,
      } as unknown as HTMLCanvasElement;
      contexts.push(context);
      canvases.push(canvas);
      return canvas;
    },
  });
  vi.stubGlobal(
    "ImageData",
    class {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    },
  );
  return { contexts, canvases, renderer: new CanvasGraphics() };
}
function frame(key = "0:1"): DecodedGraphics {
  return {
    cellWidth: 8,
    cellHeight: 16,
    images: [
      {
        id: 42,
        key,
        width: 3,
        height: 1,
        pixels: new Uint8Array([
          255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
        ]),
      },
    ],
    placements: [
      {
        id: 42,
        key,
        z: 0,
        col: 1,
        row: -1,
        offsetX: 4,
        offsetY: 8,
        sourceX: 1,
        sourceY: 0,
        sourceWidth: 1,
        sourceHeight: 1,
        width: 16,
        height: 32,
      },
    ],
  };
}
afterEach(() => vi.unstubAllGlobals());
describe("bounded software native images", () => {
  it("owns pixels and isolates one-pixel source crops before smooth scaling", () => {
    const h = setup(),
      pane = {},
      f = frame();
    h.renderer.apply(pane, f);
    const pixels = h.contexts[1].putImageData.mock.calls[0][0].data;
    f.images[0].pixels.fill(0);
    expect([...pixels]).toEqual([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
    ]);
    const ctx = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
    h.renderer.draw(ctx, pane, 2, 16, 32);
    expect(h.contexts[0].drawImage).toHaveBeenCalledWith(
      h.canvases[1],
      1,
      0,
      1,
      1,
      0,
      0,
      1,
      1,
    );
    expect(ctx.drawImage).toHaveBeenCalledWith(
      h.canvases[0],
      0,
      0,
      1,
      1,
      24,
      -16,
      32,
      64,
    );
    h.renderer.apply(pane, { ...f, images: [] });
    expect(h.contexts[1].putImageData).toHaveBeenCalledOnce();
    const state = (
      Reflect.get(h.renderer, "panes") as Map<object, unknown>
    ).get(pane);
    expect(state).not.toHaveProperty("frame.images");
    h.renderer.remove(pane);
    expect(h.canvases[1].width).toBe(0);
    h.renderer.dispose();
  });
  it("retains valid generations after invalid crop and releases each replaced bitmap", () => {
    const h = setup(),
      pane = {};
    h.renderer.apply(pane, frame());
    const invalid = frame();
    invalid.placements[0].sourceWidth = 4;
    expect(() => h.renderer.apply(pane, invalid)).toThrow("crop");
    expect(h.renderer.has(pane)).toBe(true);
    expect(h.canvases[1].width).toBe(3);
    h.renderer.apply(pane, frame("0:2"));
    expect(h.canvases[1].width).toBe(0);
    h.renderer.apply(pane, { ...frame("0:2"), images: [], placements: [] });
    expect(h.renderer.has(pane)).toBe(false);
    h.renderer.dispose();
    expect(h.canvases.every((c) => c.width === 0)).toBe(true);
  });
  it("respects all three placement layers and fails capacity before allocating pixels", () => {
    const h = setup(),
      pane = {},
      f = frame();
    f.placements[0].z = -1073741825;
    h.renderer.apply(pane, f);
    const ctx = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
    h.renderer.draw(ctx, pane, 1, 8, 16);
    h.renderer.draw(ctx, pane, 2, 8, 16);
    expect(ctx.drawImage).not.toHaveBeenCalled();
    h.renderer.draw(ctx, pane, 0, 8, 16);
    expect(ctx.drawImage).toHaveBeenCalledOnce();
    Reflect.set(h.renderer, "bytes", 128 * 1024 * 1024);
    const before = h.canvases.length;
    expect(() => h.renderer.apply({}, frame("0:3"))).toThrow("render capacity");
    expect(h.canvases).toHaveLength(before);
    h.renderer.dispose();
  });
});

it("never allocates a transient oversized scratch while changing crop aspect ratio", () => {
  const h = setup(),
    pane = {},
    base = frame();
  const a: DecodedGraphics = {
    ...base,
    images: [
      {
        ...base.images[0],
        width: 2,
        height: 8192,
        pixels: new Uint8Array(2 * 8192 * 4),
      },
    ],
    placements: [
      {
        ...base.placements[0],
        sourceX: 1,
        sourceY: 0,
        sourceWidth: 1,
        sourceHeight: 8192,
      },
    ],
  };
  h.renderer.apply(pane, a);
  const crop = h.canvases[0],
    areas: number[] = [];
  let width = 0,
    height = 0;
  Object.defineProperty(crop, "width", {
    get: () => width,
    set: (value: number) => {
      width = value;
      areas.push(width * height);
    },
  });
  Object.defineProperty(crop, "height", {
    get: () => height,
    set: (value: number) => {
      height = value;
      areas.push(width * height);
    },
  });
  const ctx = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
  h.renderer.draw(ctx, pane, 2, 8, 16);
  const next = frame("0:2");
  const b: DecodedGraphics = {
    ...next,
    images: [
      {
        ...next.images[0],
        width: 8192,
        height: 2,
        pixels: new Uint8Array(8192 * 2 * 4),
      },
    ],
    placements: [
      {
        ...next.placements[0],
        sourceX: 0,
        sourceY: 1,
        sourceWidth: 8192,
        sourceHeight: 1,
      },
    ],
  };
  h.renderer.apply(pane, b);
  h.renderer.draw(ctx, pane, 2, 8, 16);
  expect(Math.max(...areas)).toBeLessThanOrEqual(8192);
  h.renderer.dispose();
});

it("releases a newly allocated bitmap immediately when pixel upload fails", () => {
  const h = setup();
  const create = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(
    (...args: Parameters<typeof document.createElement>) => {
      const canvas = create(...args);
      if (h.canvases.length === 2)
        h.contexts[1].putImageData.mockImplementationOnce(() => {
          throw new Error("upload failed");
        });
      return canvas;
    },
  );
  expect(() => h.renderer.apply({}, frame())).toThrow("render capacity");
  expect(h.canvases[1].width).toBe(0);
  expect(h.canvases[1].height).toBe(0);
  h.renderer.dispose();
});

it("retains a fractional placeholder crop on a nonzero intermediate canvas", () => {
  const h = setup(),
    pane = {},
    f = frame();
  f.placements[0].sourceY = 0.5;
  f.placements[0].sourceHeight = 0.5;
  h.renderer.apply(pane, f);
  const drawImage = vi.fn();
  h.renderer.draw(
    { drawImage } as unknown as CanvasRenderingContext2D,
    pane,
    2,
    8,
    16,
  );
  expect(h.canvases[0].height).toBe(1);
  expect(h.contexts[0].drawImage).toHaveBeenCalledWith(
    h.canvases[1],
    1,
    0.5,
    1,
    0.5,
    0,
    0,
    1,
    1,
  );
  expect(drawImage.mock.calls[0].slice(1, 5)).toEqual([0, 0, 1, 1]);
  h.renderer.dispose();
});
