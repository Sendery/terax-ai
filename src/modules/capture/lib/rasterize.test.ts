import type { NativeCaptureLease } from "@/modules/capture/lib/captureLease";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSvgMarkup,
  collectForegroundElements,
  compositeCaptureLayers,
  collectCanvasOverlays,
  registerCanvasSnapshotProvider,
  captureScaleFor,
  MAX_CAPTURE_HEIGHT,
  MAX_CAPTURE_PIXELS,
  MAX_CAPTURE_WIDTH,
  validateCaptureDimensions,
} from "./rasterize";

afterEach(() => vi.unstubAllGlobals());

describe("validateCaptureDimensions", () => {
  it("accepts a normal window size", () => {
    expect(validateCaptureDimensions(1512, 982)).toBeNull();
  });

  it("rejects empty and non-integer sizes", () => {
    expect(validateCaptureDimensions(0, 100)).toMatch(/dimensions/i);
    expect(validateCaptureDimensions(100.5, 100)).toMatch(/dimensions/i);
  });

  it("rejects sizes beyond the shared visual QA limits", () => {
    expect(validateCaptureDimensions(MAX_CAPTURE_WIDTH + 1, 10)).toMatch(
      /dimensions/i,
    );
    expect(validateCaptureDimensions(10, MAX_CAPTURE_HEIGHT + 1)).toMatch(
      /dimensions/i,
    );
    expect(validateCaptureDimensions(7_680, 4_320)).toMatch(/dimensions/i);
    expect(7_680 * 4_320).toBeGreaterThan(MAX_CAPTURE_PIXELS);
  });
});

describe("captureScaleFor", () => {
  it("keeps the device pixel ratio when within limits", () => {
    expect(captureScaleFor(1000, 800, 2)).toBe(2);
  });

  it("downscales when the scaled surface would exceed the pixel cap", () => {
    const scale = captureScaleFor(6000, 4000, 2);
    expect(scale).toBeLessThan(2);
    expect(scale).toBeGreaterThan(0);
    expect(
      Math.floor(6000 * scale) * Math.floor(4000 * scale),
    ).toBeLessThanOrEqual(MAX_CAPTURE_PIXELS);
  });

  it("never returns a scale above the requested ratio or below a floor", () => {
    expect(captureScaleFor(100, 100, 3)).toBe(3);
    expect(captureScaleFor(7000, 4000, 4)).toBeGreaterThanOrEqual(0.1);
  });
});

describe("buildSvgMarkup", () => {
  it("wraps serialized content in a sized foreignObject", () => {
    const svg = buildSvgMarkup(320, 200, "<div>hello</div>", "");
    expect(svg).toContain('width="320"');
    expect(svg).toContain('height="200"');
    expect(svg).toContain("<foreignObject");
    expect(svg).toContain("<div>hello</div>");
  });

  it("embeds font css inside a style element when provided", () => {
    const svg = buildSvgMarkup(10, 10, "<div/>", "@font-face{}");
    expect(svg).toContain("<style>@font-face{}</style>");
  });
});

it("composites only pane proxies so a shared source cannot cover DOM split handles", () => {
  const rect = { left: 10, top: 20, width: 100, height: 80 };
  const shared = {
    hasAttribute: (key: string) => key === "data-terax-capture-proxy-source",
    getBoundingClientRect: () => rect,
  };
  const proxy = {
    hasAttribute: () => false,
    getBoundingClientRect: () => rect,
  };
  const root = {
    querySelectorAll: () => [shared, proxy],
  } as unknown as HTMLElement;
  const overlays = collectCanvasOverlays(root, { left: 0, top: 0 } as DOMRect);
  expect(overlays.map((item) => item.canvas)).toEqual([proxy]);
});

it("freezes required pane pixels before asynchronous capture work or a tab switch", () => {
  const host = { style: { visibility: "visible" } };
  const canvas = {
    hasAttribute: (key: string) => key === "data-terax-capture-required",
    closest: () => host,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 80 }),
  } as unknown as HTMLCanvasElement;
  const unregister = registerCanvasSnapshotProvider(canvas, () =>
    host.style.visibility === "visible" ? "data:image/png;base64,frozen" : null,
  );
  const root = { querySelectorAll: () => [canvas] } as unknown as HTMLElement;
  try {
    const [overlay] = collectCanvasOverlays(root, {
      left: 0,
      top: 0,
    } as DOMRect);
    host.style.visibility = "hidden";
    expect(overlay.snapshot).toBe("data:image/png;base64,frozen");
    expect(collectCanvasOverlays(root, { left: 0, top: 0 } as DOMRect)).toEqual(
      [],
    );
  } finally {
    unregister();
  }
});
it("rejects a visible required pane whose snapshot provider is unavailable", () => {
  const canvas = {
    hasAttribute: (key: string) => key === "data-terax-capture-required",
    closest: () => ({ style: { visibility: "visible" } }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 80 }),
  } as unknown as HTMLCanvasElement;
  const root = { querySelectorAll: () => [canvas] } as unknown as HTMLElement;
  expect(() =>
    collectCanvasOverlays(root, { left: 0, top: 0 } as DOMRect),
  ).toThrow("Terminal capture is no longer available.");
});

it("restores only visible foregrounds intersecting native pixels, without nested duplication", () => {
  vi.stubGlobal("window", {
    getComputedStyle: () => ({ visibility: "visible", display: "block" }),
  });

  const node = (left: number, hidden = false) => ({
    getBoundingClientRect: () => ({ left, top: 20, width: 20, height: 20 }),
    closest: () => ({ style: { visibility: hidden ? "hidden" : "visible" } }),
    contains: () => false,
  });
  const above = node(15);
  const nested = node(16);
  const outside = node(300);
  const hidden = node(15, true);
  above.contains = (other?: unknown) => other === nested;
  const root = {
    querySelectorAll: () => [above, nested, outside, hidden],
  } as unknown as HTMLElement;
  const rect = { left: 10, top: 10, width: 200, height: 100 } as DOMRect;
  const native = {
    canvas: {} as HTMLCanvasElement,
    x: 0,
    y: 0,
    width: 100,
    height: 80,
  };
  const found = collectForegroundElements(root, rect, [native]);
  expect(found.map((item) => item.element)).toEqual([above]);
  expect(found[0]).toMatchObject({ x: 5, y: 10, width: 20, height: 20 });
});
it("paints the frozen DOM foreground after native canvas pixels and clips it to those pixels", async () => {
  const calls: string[] = [];
  const base = { id: "base" };
  const terminal = { id: "terminal" };
  const foreground = { id: "foreground" };
  const context = {
    drawImage: (image: { id: string }) => calls.push(image.id),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  await compositeCaptureLayers(
    context,
    base as unknown as CanvasImageSource,
    [
      {
        canvas: terminal as unknown as HTMLCanvasElement,
        x: 1,
        y: 2,
        width: 30,
        height: 40,
      },
    ],
    [
      {
        image: foreground as unknown as CanvasImageSource,
        x: 1,
        y: 2,
        width: 30,
        height: 40,
      },
    ],
  );
  expect(calls).toEqual(["base", "terminal", "foreground"]);
  expect(context.rect).toHaveBeenCalledExactlyOnceWith(1, 2, 30, 40);
  expect(context.clip).toHaveBeenCalledOnce();
  expect(context.restore).toHaveBeenCalledTimes(2);
});

it("does not promote CSS-hidden foregrounds into visible capture layers", () => {
  const hidden = {
    style: { visibility: "" },
    getBoundingClientRect: () => ({ left: 10, top: 10, width: 20, height: 20 }),
    closest: () => null,
    contains: () => false,
  };
  vi.stubGlobal("window", {
    getComputedStyle: () => ({ visibility: "hidden", display: "block" }),
  });
  expect(
    collectForegroundElements(
      { querySelectorAll: () => [hidden] } as unknown as HTMLElement,
      { left: 0, top: 0, width: 100, height: 100 } as DOMRect,
      [
        {
          canvas: {} as HTMLCanvasElement,
          x: 0,
          y: 0,
          width: 100,
          height: 100,
        },
      ],
    ),
  ).toEqual([]);
});
it("retains pane clipping for an IME foreground instead of bleeding into a neighbor", async () => {
  const pane = {
    parentElement: null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 50, height: 80 }),
  };
  const preedit = {
    parentElement: pane,
    style: {},
    getBoundingClientRect: () => ({ left: 40, top: 10, width: 60, height: 20 }),
    closest: () => ({ style: { visibility: "visible" } }),
    contains: () => false,
  };
  vi.stubGlobal("window", {
    getComputedStyle: (element: unknown) =>
      element === pane
        ? {
            visibility: "visible",
            display: "block",
            overflowX: "hidden",
            overflowY: "hidden",
          }
        : {
            visibility: "visible",
            display: "block",
            overflowX: "visible",
            overflowY: "visible",
          },
  });
  const overlays = [
    { canvas: {} as HTMLCanvasElement, x: 0, y: 0, width: 50, height: 80 },
    { canvas: {} as HTMLCanvasElement, x: 50, y: 0, width: 50, height: 80 },
  ];
  const foreground = collectForegroundElements(
    { querySelectorAll: () => [preedit] } as unknown as HTMLElement,
    { left: 0, top: 0, width: 100, height: 80 } as DOMRect,
    overlays,
  );
  expect(foreground[0].clip).toEqual({ x: 0, y: 0, width: 50, height: 80 });
  const context = {
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  await compositeCaptureLayers(
    context,
    {} as CanvasImageSource,
    overlays,
    foreground.map(({ element, ...item }) => ({
      ...item,
      image: {} as CanvasImageSource,
    })),
  );
  expect(context.rect).toHaveBeenLastCalledWith(0, 0, 50, 80);
});

function leasedCanvas() {
  const native = {
    style: { visibility: "hidden" },
    contains: (_node: unknown) => true,
  } as unknown as HTMLElement;
  const canvas = {
    hasAttribute: (key: string) => key === "data-terax-capture-required",
    closest: () => native,
    getBoundingClientRect: () => ({ left: 6, top: 6, width: 100, height: 80 }),
  } as unknown as HTMLCanvasElement;
  const root = {
    contains: (node: unknown) => node === native || node === canvas,
    querySelectorAll: () => [canvas],
  } as unknown as HTMLElement;
  const lease = {
    root: native,
    canvas,
    snapshot: "data:image/png;base64,full",
    excluded: [],
    current: () => true,
    dispose: vi.fn(),
  } satisfies NativeCaptureLease;
  return { root, native, canvas, lease };
}
it("opts in only the explicitly leased hidden native canvas", () => {
  const f = leasedCanvas();
  const rect = { left: 0, top: 0 } as DOMRect;
  expect(collectCanvasOverlays(f.root, rect)).toEqual([]);
  expect(collectCanvasOverlays(f.root, rect, [f.lease])).toEqual([
    {
      canvas: f.canvas,
      snapshot: f.lease.snapshot,
      required: true,
      x: 6,
      y: 6,
      width: 100,
      height: 80,
    },
  ]);
  expect(collectCanvasOverlays(f.root, rect)).toEqual([]);
});
it("refuses a stale or foreign native lease instead of returning blank pixels", () => {
  const f = leasedCanvas();
  const rect = { left: 0, top: 0 } as DOMRect;
  expect(() =>
    collectCanvasOverlays(f.root, rect, [{ ...f.lease, current: () => false }]),
  ).toThrow("available");
  expect(() =>
    collectCanvasOverlays(f.root, rect, [
      { ...f.lease, root: {} as HTMLElement },
    ]),
  ).toThrow("available");
});
it("substitutes only frozen block foregrounds for the leased pane", () => {
  const f = leasedCanvas();
  const previous = {
    style: {},
    closest: () => f.native,
    contains: () => false,
  } as unknown as HTMLElement;
  const frozen = {
    style: { visibility: "hidden" },
    closest: () => f.native,
    contains: () => false,
    parentElement: null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 112, height: 92 }),
  } as unknown as HTMLElement;
  const other = {
    style: {},
    closest: () => ({ style: { visibility: "hidden" } }),
    contains: () => false,
  } as unknown as HTMLElement;
  const root = {
    contains: () => true,
    querySelectorAll: () => [previous, frozen, other],
  } as unknown as HTMLElement;
  vi.stubGlobal("window", {
    getComputedStyle: () => ({ visibility: "hidden", display: "block" }),
  });
  const lease = { ...f.lease, foreground: frozen, excluded: [previous] };
  const overlay = { canvas: f.canvas, x: 6, y: 6, width: 100, height: 80 };
  const found = collectForegroundElements(
    root,
    { left: 0, top: 0, width: 112, height: 92 } as DOMRect,
    [overlay],
    [lease],
  );
  expect(found.map((item) => item.element)).toEqual([frozen]);
});
it("cancels native snapshot image loading without drawing late pixels", async () => {
  const images: {
    src: string;
    onload: (() => void) | null;
    onerror: (() => void) | null;
  }[] = [];
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        images.push(this);
      }
    },
  );
  const controller = new AbortController();
  const context = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
  const pending = compositeCaptureLayers(
    context,
    {} as CanvasImageSource,
    [
      {
        canvas: {} as HTMLCanvasElement,
        snapshot: "data:image/png;base64,full",
        required: true,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      },
    ],
    [],
    { signal: controller.signal, current: () => true },
  );
  const rejected = expect(pending).rejects.toThrow("cancel");
  controller.abort();
  await Promise.resolve();
  expect(images[0].src).toBe("");
  expect(images[0].onload).toBeNull();
  await rejected;
  expect(context.drawImage).toHaveBeenCalledOnce();
});
