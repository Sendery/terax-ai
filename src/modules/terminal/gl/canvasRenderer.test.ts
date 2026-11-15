import { renderNativeCapturePixels } from "@/modules/terminal/gl/nativeCapturePixels";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasRenderer } from "@/modules/terminal/gl/canvasRenderer";
import {
  decodeFrame,
  FRAME_FLAG_FULL,
  FRAME_FLAG_GRAPHEMES,
  CELL_GRAPHEME,
  ATTR_BOLD,
  ATTR_INVERSE,
  CURSOR_UNDERLINE,
} from "@/modules/terminal/gl/frameCodec";
import {
  encodeFrame,
  textRow,
  wide,
  TAIL,
  explicit,
} from "@/modules/terminal/gl/frameCodec.testing";
const callbacks = () => ({ onDrawn: vi.fn(), onNeedFullFrame: vi.fn() });
function harness(dpr = 1) {
  let frame: FrameRequestCallback = () => {};
  const contexts: Record<string, ReturnType<typeof vi.fn>>[] = [];
  const painted: { text: string; x: number; y: number }[] = [];
  const canvases: HTMLCanvasElement[] = [];
  function make() {
    let tx = 0,
      ty = 0;
    const stack: [number, number][] = [];
    const ctx = new Proxy(
      {
        measureText: vi.fn(() => ({
          width: 8,
          fontBoundingBoxAscent: 12,
          fontBoundingBoxDescent: 4,
        })),
        save: vi.fn(() => {
          stack.push([tx, ty]);
        }),
        restore: vi.fn(() => {
          [tx, ty] = stack.pop() ?? [0, 0];
        }),
        translate: vi.fn((x: number, y: number) => {
          tx += x;
          ty += y;
        }),
        fillText: vi.fn((text: string, x: number, y: number) => {
          painted.push({ text, x: x + tx, y: y + ty });
        }),
        drawImage: vi.fn(),
        fillRect: vi.fn(),
        putImageData: vi.fn(),
      },
      {
        get(target, key) {
          return Reflect.get(target, key) ?? vi.fn();
        },
      },
    ) as unknown as CanvasRenderingContext2D;
    contexts.push(ctx as unknown as Record<string, ReturnType<typeof vi.fn>>);
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn((kind) => (kind === "2d" ? ctx : null)),
      toDataURL: () => "data:image/png;base64,public",
    } as unknown as HTMLCanvasElement;
    canvases.push(canvas);
    return canvas;
  }
  vi.stubGlobal("window", {
    devicePixelRatio: dpr,
    matchMedia: () => ({
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
  vi.stubGlobal("document", { createElement: make });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frame = cb;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const canvas = make();
  const renderer = new CanvasRenderer(canvas, {
    font: { family: "mono", weight: "normal", size: 14, letterSpacing: 0 },
    background: 0,
  });
  renderer.resize(200, 100);
  return {
    renderer,
    canvas,
    context: contexts[0],
    contexts,
    canvases,
    painted,
    draw: () => frame(0),
  };
}
const full = (text = "hello") =>
  decodeFrame(
    encodeFrame({
      seq: 1,
      cols: 10,
      rows: 2,
      flags: FRAME_FLAG_FULL,
      rowRecords: [textRow(0, text)],
    }),
  );
afterEach(() => vi.unstubAllGlobals());
describe("native software presentation", () => {
  it("applies frames and acknowledges only visible pane drawings", () => {
    const h = harness(),
      a = callbacks(),
      b = callbacks();
    const pane = h.renderer.addPane(a),
      hidden = h.renderer.addPane(b);
    h.renderer.setPaneRect(pane, { x: 0, y: 0, width: 100, height: 40 });
    expect(h.renderer.applyFrame(pane, full())).toBe("applied");
    expect(h.renderer.applyFrame(hidden, full())).toBe("needs-full");
    h.draw();
    expect(a.onDrawn).toHaveBeenCalledWith(true);
    expect(b.onDrawn).not.toHaveBeenCalled();
    expect(h.context.fillText).toHaveBeenCalledWith("h", 0, 12);
    expect(h.canvas.getContext).toHaveBeenCalledWith("2d", { alpha: false });
    h.renderer.dispose();
  });
  it("reconstructs after hiding and changes font without owning the PTY", () => {
    const h = harness(),
      c = callbacks(),
      pane = h.renderer.addPane(c);
    h.renderer.setPaneRect(pane, { x: 0, y: 0, width: 100, height: 40 });
    h.renderer.applyFrame(pane, full());
    h.renderer.setPaneRect(pane, { x: 0, y: 0, width: 0, height: 0 });
    expect(pane.grid).toBe(null);
    h.renderer.setPaneRect(pane, { x: 0, y: 0, width: 100, height: 40 });
    expect(c.onNeedFullFrame).toHaveBeenCalledOnce();
    h.renderer.setFont({
      family: "other",
      weight: "bold",
      size: 18,
      letterSpacing: 2,
    });
    expect(c.onNeedFullFrame).toHaveBeenCalledTimes(2);
    h.renderer.dispose();
  });
  it("rejects partial initialization and limits snapshots to a live visible owned pane", () => {
    const h = harness(2),
      pane = h.renderer.addPane(callbacks());
    h.renderer.setPaneRect(pane, { x: 10, y: 5, width: 40, height: 30 });
    const partial = decodeFrame(
      encodeFrame({
        seq: 2,
        cols: 10,
        rows: 2,
        flags: 0,
        rowRecords: [textRow(0, "a")],
      }),
    );
    expect(h.renderer.applyFrame(pane, partial)).toBe("needs-full");
    h.renderer.applyFrame(pane, full());
    expect(h.renderer.snapshot(pane)).toBe("data:image/png;base64,public");
    h.renderer.removePane(pane);
    expect(h.renderer.snapshot(pane)).toBe(null);
    h.renderer.dispose();
    expect(h.renderer.snapshot()).toBe(null);
  });
});

it("preserves complete styled graphemes across partial frames and font changes", () => {
  const h = harness(),
    pane = h.renderer.addPane(callbacks());
  h.renderer.setPaneRect(pane, { x: 0, y: 0, width: 160, height: 60 });
  const cluster = "e\u0301",
    emoji = "\u{1f469}\u200d\u{1f4bb}";
  const frame = decodeFrame(
    encodeFrame({
      cols: 5,
      rows: 2,
      flags: FRAME_FLAG_FULL | FRAME_FLAG_GRAPHEMES,
      styles: [
        {
          fg: explicit(0x12ff34),
          bg: explicit(0x112233),
          attrs: ATTR_BOLD | ATTR_INVERSE,
        },
      ],
      graphemes: [cluster, emoji],
      rowRecords: [
        {
          y: 0,
          runs: [[0, 3]],
          cells: [CELL_GRAPHEME, wide(CELL_GRAPHEME | 1), TAIL],
        },
      ],
      cursorStyle: CURSOR_UNDERLINE,
    }),
  );
  h.renderer.applyFrame(pane, frame);
  h.draw();
  expect(h.context.fillText).toHaveBeenCalledWith(cluster, 0, 12);
  expect(h.context.fillText).toHaveBeenCalledWith(emoji, 8, 12);
  expect(h.context.fillText).toHaveBeenCalledTimes(2);
  h.renderer.setFont({
    family: "other",
    weight: "normal",
    size: 14,
    letterSpacing: 0,
  });
  h.draw();
  expect(h.context.fillText).toHaveBeenCalledTimes(4);
  const delta = decodeFrame(
    encodeFrame({
      seq: 2,
      cols: 5,
      rows: 2,
      flags: 0,
      rowRecords: [textRow(1, "x")],
    }),
  );
  expect(h.renderer.applyFrame(pane, delta)).toBe("applied");
  h.draw();
  expect(h.context.fillText).toHaveBeenCalledWith(cluster, 0, 12);
  expect(h.context.fillText).toHaveBeenCalledWith("x", 0, 28);
  h.renderer.dispose();
});
it("bounds a whole-window glyph working set and supports an explicit retry", () => {
  const h = harness(),
    c = callbacks(),
    pane = h.renderer.addPane(c);
  h.renderer.setPaneRect(pane, { x: 0, y: 0, width: 100, height: 40 });
  const rows = Array.from({ length: 66 }, (_, y) => ({
    y,
    runs: [[0, 1000]] as [number, number][],
    cells: Array.from({ length: 1000 }, (_, x) => 0x10000 + y * 1000 + x),
  }));
  const large = decodeFrame(
    encodeFrame({
      cols: 1000,
      rows: 66,
      flags: FRAME_FLAG_FULL,
      rowRecords: rows,
    }),
  );
  expect(h.renderer.applyFrame(pane, large)).toBe("needs-full");
  expect(c.onNeedFullFrame).toHaveBeenCalledOnce();
  expect(() => h.renderer.applyFrame(pane, large)).toThrow("render capacity");
  expect(h.renderer.applyFrame(pane, full())).toBe("blocked");
  h.renderer.retryCapacity();
  expect(h.renderer.applyFrame(pane, full())).toBe("applied");
  h.renderer.dispose();
});

it("isolates paint failures per pane and returns credits without reporting a draw", () => {
  const h = harness(),
    failed = { ...callbacks(), onError: vi.fn() },
    other = callbacks();
  const first = h.renderer.addPane(failed),
    second = h.renderer.addPane(other);
  h.renderer.setPaneRect(first, { x: 0, y: 0, width: 80, height: 40 });
  h.renderer.setPaneRect(second, { x: 80, y: 0, width: 80, height: 40 });
  h.renderer.applyFrame(first, full());
  h.renderer.applyFrame(second, full());
  h.context.fillText.mockImplementationOnce(() => {
    throw new Error("canvas allocation failed");
  });
  expect(() => h.draw()).not.toThrow();
  expect(failed.onError).toHaveBeenCalledOnce();
  expect(failed.onDrawn).toHaveBeenCalledWith(false);
  expect(other.onDrawn).toHaveBeenCalledWith(true);
  expect(h.context.save.mock.calls.length).toBe(
    h.context.restore.mock.calls.length,
  );
  expect(h.painted).toContainEqual({ text: "h", x: 80, y: 12 });
  expect(h.renderer.applyFrame(first, full())).toBe("blocked");
  h.renderer.setFont({
    family: "other",
    weight: "normal",
    size: 12,
    letterSpacing: 0,
  });
  expect(h.renderer.applyFrame(first, full())).toBe("applied");
  h.renderer.dispose();
});
it.each(["font", "dpr"])(
  "renews a blocked capacity epoch after %s change",
  (kind) => {
    const h = harness(),
      pane = h.renderer.addPane(callbacks());
    h.renderer.setPaneRect(pane, { x: 0, y: 0, width: 100, height: 40 });
    (Reflect.get(h.renderer, "blocked") as Set<unknown>).add(pane);
    (Reflect.get(h.renderer, "retried") as Set<unknown>).add(pane);
    if (kind === "font")
      h.renderer.setFont({
        family: "other",
        weight: "normal",
        size: 12,
        letterSpacing: 0,
      });
    else {
      window.devicePixelRatio = 2;
      (Reflect.get(h.renderer, "dprChanged") as () => void)();
    }
    expect(h.renderer.applyFrame(pane, full())).toBe("applied");
    h.renderer.dispose();
  },
);

it("changes minimum contrast live without replacing glyphs or session state", () => {
  const h = harness(),
    c = callbacks(),
    pane = h.renderer.addPane(c);
  h.renderer.setPaneRect(pane, { x: 0, y: 0, width: 80, height: 40 });
  const input = decodeFrame(
    encodeFrame({
      cols: 4,
      rows: 2,
      flags: FRAME_FLAG_FULL,
      defaultFg: 0x141414,
      defaultBg: 0x141414,
      rowRecords: [textRow(0, "text")],
    }),
  );
  h.renderer.applyFrame(pane, input);
  const original = pane.grid?.cells[1];
  h.renderer.setMinimumContrastRatio(4.5);
  expect(c.onNeedFullFrame).toHaveBeenCalledOnce();
  h.renderer.applyFrame(pane, input);
  expect(pane.grid?.cells[1]).not.toBe(original);
  h.renderer.setMinimumContrastRatio(1);
  expect(c.onNeedFullFrame).toHaveBeenCalledTimes(2);
  h.renderer.applyFrame(pane, input);
  expect(pane.grid?.cells[1]).toBe(original);
  h.renderer.dispose();
});

it("acknowledges a discarded hidden pane once on its display turn without painting it", () => {
  const h = harness();
  const c = callbacks();
  const pane = h.renderer.addPane(c);
  expect(h.renderer.applyFrame(pane, full())).toBe("needs-full");
  h.renderer.markUndrawn(pane);
  expect(c.onDrawn).not.toHaveBeenCalled();
  expect(h.context.fillText).not.toHaveBeenCalled();
  h.draw();
  expect(c.onDrawn).toHaveBeenCalledExactlyOnceWith(false);
  expect(pane.grid).toBeNull();
  expect(h.context.fillText).not.toHaveBeenCalled();
  h.draw();
  expect(c.onDrawn).toHaveBeenCalledOnce();
  h.renderer.dispose();
});

it("reconstructs full graphemes and image pixels in a disposable capture renderer", () => {
  const h = harness();
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
  const frame = {
    ...decodeFrame(
      encodeFrame({
        cols: 5,
        rows: 2,
        flags: FRAME_FLAG_FULL,
        graphemes: ["e\u0301", "\u{1f469}\u200d\u{1f4bb}"],
        rowRecords: [
          {
            y: 0,
            runs: [[0, 3]],
            cells: [CELL_GRAPHEME, wide(CELL_GRAPHEME | 1), TAIL],
          },
        ],
      }),
    ),
    graphics: {
      cellWidth: 8,
      cellHeight: 16,
      images: [
        {
          id: 1,
          key: "0:1",
          width: 1,
          height: 1,
          pixels: new Uint8Array([1, 2, 3, 255]),
        },
      ],
      placements: [
        {
          id: 1,
          key: "0:1",
          z: 0,
          col: 0,
          row: 1,
          offsetX: 0,
          offsetY: 0,
          sourceX: 0,
          sourceY: 0,
          sourceWidth: 1,
          sourceHeight: 1,
          width: 8,
          height: 16,
        },
      ],
    },
  };
  const count = h.canvases.length;
  const result = renderNativeCapturePixels(
    frame,
    {
      font: { family: "mono", weight: "normal", size: 14, letterSpacing: 0 },
      background: 0,
      cursorFallback: 0xffffff,
      minimumContrastRatio: 4.5,
      width: 40,
      height: 32,
      dpr: 1,
      cellSize: { width: 8, height: 16 },
      focused: false,
    },
    () => true,
  );
  expect(result).toBe("data:image/png;base64,public");
  expect(h.painted.map((item) => item.text)).toEqual([
    "e\u0301",
    "\u{1f469}\u200d\u{1f4bb}",
  ]);
  expect(
    h.contexts.some((ctx) => ctx.putImageData.mock.calls.length === 1),
  ).toBe(true);
  expect(
    h.canvases
      .slice(count)
      .every((canvas) => canvas.width === 0 && canvas.height === 0),
  ).toBe(true);
  expect(h.canvas.width).toBe(200);
  expect(h.renderer.stats.draws).toBe(0);
  h.renderer.dispose();
});
it("rejects missing full image uploads and stale appearance without returning a blank capture", () => {
  const h = harness();
  const options = {
    font: { family: "mono", weight: "normal", size: 14, letterSpacing: 0 },
    background: 0,
    width: 80,
    height: 32,
    dpr: 1,
    cellSize: { width: 8, height: 16 },
    focused: false,
  };
  const frame = {
    ...full(),
    graphics: {
      cellWidth: 8,
      cellHeight: 16,
      images: [],
      placements: [
        {
          id: 1,
          key: "0:missing",
          z: 0,
          col: 0,
          row: 0,
          offsetX: 0,
          offsetY: 0,
          sourceX: 0,
          sourceY: 0,
          sourceWidth: 1,
          sourceHeight: 1,
          width: 8,
          height: 16,
        },
      ],
    },
  };
  const count = h.canvases.length;
  expect(() => renderNativeCapturePixels(frame, options, () => true)).toThrow();
  expect(
    h.canvases
      .slice(count)
      .every((canvas) => canvas.width === 0 && canvas.height === 0),
  ).toBe(true);
  expect(() =>
    renderNativeCapturePixels(full(), { ...options, dpr: 2 }, () => true),
  ).toThrow("appearance");
  expect(() => renderNativeCapturePixels(full(), options, () => false)).toThrow(
    "available",
  );
  expect(h.canvas.width).toBe(200);
  h.renderer.dispose();
});
