import { readFileSync } from "node:fs";
import { RenderCapacityError } from "@/modules/terminal/gl/renderCapacity";
import { decodeFrame } from "@/modules/terminal/gl/frameCodec";
import { encodeFrame, textRow } from "@/modules/terminal/gl/frameCodec.testing";
import {
  GridRenderer,
  type RenderPane,
} from "@/modules/terminal/gl/gridRenderer";
import { describe, expect, it, vi } from "vitest";

function pane(rect: RenderPane["rect"], ready = true): RenderPane {
  return {
    rect,
    callbacks: { onDrawn: vi.fn(), onNeedFullFrame: vi.fn() },
    grid: ready ? { cols: 4, rows: 2, cells: new Uint32Array(32) } : null,
    header: ready
      ? {
          cursorX: 0,
          cursorY: 0,
          cursorStyle: 0,
          cursorColor: 0,
          blink: false,
          scrolledBack: false,
          defaultFg: 0,
          defaultBg: 0,
        }
      : null,
    vao: ready ? ({} as WebGLVertexArrayObject) : null,
    vbo: null,
    gpuCells: 8,
    undrawn: true,
    focused: true,
  };
}

function draw(panes: RenderPane[], graphics = false) {
  const drawArraysInstanced = vi.fn();
  const uniform1ui = vi.fn();
  const gl = new Proxy(
    { drawArraysInstanced, uniform1ui },
    {
      get(target, key) {
        return Reflect.get(target, key) ?? vi.fn();
      },
    },
  );
  const drawnPanes = new Map<RenderPane, boolean>();
  const renderer = Object.assign(Object.create(GridRenderer.prototype), {
    gl,
    program: {},
    uniforms: { uDefaultBg: "default-bg" },
    graphics: graphics ? { has: () => true, draw: vi.fn() } : undefined,
    drawnPanes,
    panes,
    canvas: { width: 100, height: 100 },
    dpr: 1,
    background: 0,
    blinkOn: true,
    atlas: {
      bind: vi.fn(),
      metrics: { width: 10, height: 20, baseline: 16 },
      columns: 1,
      slotsPerPage: 1,
    },
  }) as { draw: () => void };
  renderer.draw();
  return { drawnPanes, drawArraysInstanced, uniform1ui };
}

describe("GridRenderer display acknowledgement", () => {
  it("does not acknowledge zero-size or fully clipped panes", () => {
    const visible = pane({ x: 0, y: 0, width: 40, height: 40 });
    const empty = pane({ x: 0, y: 0, width: 0, height: 40 });
    const outside = pane({ x: 100, y: 0, width: 40, height: 40 });
    const result = draw([visible, empty, outside]);
    expect([...result.drawnPanes]).toEqual([[visible, true]]);
    expect(result.drawArraysInstanced).toHaveBeenCalledTimes(1);
  });

  it("distinguishes background recovery from an actual terminal draw", () => {
    const background = pane({ x: 0, y: 0, width: 40, height: 40 }, false);
    const result = draw([background]);
    expect([...result.drawnPanes]).toEqual([[background, false]]);
    expect(result.drawArraysInstanced).not.toHaveBeenCalled();
  });
});

it("releases the WebGL context when glyph atlas construction fails", async () => {
  vi.resetModules();
  const loseContext = vi.fn();
  vi.doMock("@/modules/terminal/gl/glyphAtlas", () => ({
    GlyphAtlas: class {
      constructor() {
        throw new Error("2d unavailable");
      }
    },
  }));
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  try {
    const { GridRenderer: Constructor } = await import(
      "@/modules/terminal/gl/gridRenderer"
    );
    const canvas = {
      getContext: () => ({ getExtension: () => ({ loseContext }) }),
    } as unknown as HTMLCanvasElement;
    expect(
      () =>
        new Constructor(canvas, {
          font: {
            family: "monospace",
            size: 14,
            weight: "normal",
            letterSpacing: 0,
          },
          background: 0,
        }),
    ).toThrow("2d unavailable");
    expect(loseContext).toHaveBeenCalledOnce();
  } finally {
    vi.doUnmock("@/modules/terminal/gl/glyphAtlas");
    vi.unstubAllGlobals();
  }
});

it("snapshots only the requested live pane rectangle after a synchronous redraw", () => {
  const target = pane({ x: 10, y: 20, width: 30, height: 40 });
  const drawImage = vi.fn();
  const image = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage }),
    toDataURL: () => "data:image/png;base64,isolated",
  };
  vi.stubGlobal("document", { createElement: () => image });
  const canvas = {
    width: 200,
    height: 160,
    toDataURL: vi.fn(() => "data:image/png;base64,window"),
  };
  const draw = vi.fn();
  const renderer = Object.assign(Object.create(GridRenderer.prototype), {
    canvas,
    panes: [target],
    dpr: 2,
    disposed: false,
    lost: false,
    draw,
  }) as GridRenderer;
  try {
    expect(renderer.snapshot(target)).toBe("data:image/png;base64,isolated");
    expect(draw).toHaveBeenCalledOnce();
    expect(drawImage).toHaveBeenCalledWith(
      canvas,
      20,
      40,
      60,
      80,
      0,
      0,
      60,
      80,
    );
    expect(image.width).toBe(60);
    expect(image.height).toBe(80);
    target.rect.width = 0;
    expect(renderer.snapshot(target)).toBeNull();
    expect(
      renderer.snapshot(pane({ x: 0, y: 0, width: 10, height: 10 })),
    ).toBeNull();
    expect(draw).toHaveBeenCalledOnce();
    expect(renderer.snapshot()).toBe("data:image/png;base64,window");
  } finally {
    vi.unstubAllGlobals();
  }
});

function capacityRenderer() {
  const a = pane({ x: 0, y: 0, width: 40, height: 40 });
  const b = pane({ x: 40, y: 0, width: 40, height: 40 });
  const lookup = vi.fn((): number => {
    throw new RenderCapacityError();
  });
  const reset = vi.fn();
  const renderer = Object.assign(Object.create(GridRenderer.prototype), {
    panes: [a, b],
    atlas: { lookup, reset },
    lost: false,
    upload: vi.fn(),
    uploadWhole: vi.fn(),
    disposed: false,
    stats: { atlasResets: 0 },
    updateBlink: vi.fn(),
    requestDraw: vi.fn(),
  }) as GridRenderer;
  const frame = decodeFrame(
    encodeFrame({ cols: 1, rows: 1, rowRecords: [textRow(0, "x")] }),
  );
  return { renderer, a, b, frame, lookup, reset };
}
it("bounds shared-capacity recovery and rejects invisible partial grids until explicit retry", () => {
  const { renderer, a, b, frame, lookup, reset } = capacityRenderer();
  expect(renderer.applyFrame(a, frame)).toBe("needs-full");
  expect(renderer.applyFrame(b, frame)).toBe("needs-full");
  expect(() => renderer.applyFrame(a, frame)).toThrow(RenderCapacityError);
  expect(a.grid).toBeNull();
  expect(a.header).toBeNull();
  expect(() => renderer.applyFrame(b, frame)).toThrow(RenderCapacityError);
  const attempts = lookup.mock.calls.length;
  expect(renderer.applyFrame(a, frame)).toBe("blocked");
  expect(renderer.applyFrame(b, frame)).toBe("blocked");
  expect(lookup).toHaveBeenCalledTimes(attempts);
  expect(reset).toHaveBeenCalledTimes(2);
  renderer.retryCapacity();
  lookup.mockReturnValue(1);
  expect(renderer.applyFrame(a, frame)).toBe("applied");
  expect(renderer.applyFrame(b, frame)).toBe("applied");
});
it("allows later cache recovery only after every visible pane has rebuilt successfully", () => {
  const { renderer, a, b, frame, lookup, reset } = capacityRenderer();
  expect(renderer.applyFrame(a, frame)).toBe("needs-full");
  lookup.mockReturnValue(1);
  expect(renderer.applyFrame(a, frame)).toBe("applied");
  expect(renderer.applyFrame(b, frame)).toBe("applied");
  lookup.mockImplementation(() => {
    throw new RenderCapacityError();
  });
  expect(renderer.applyFrame(a, frame)).toBe("needs-full");
  expect(reset).toHaveBeenCalledTimes(2);
});

it("defers hidden panes without atlas work and requests a complete frame on reveal", () => {
  const { renderer, a, b, frame, lookup, reset } = capacityRenderer();
  renderer.setPaneRect(b, { x: 40, y: 0, width: 0, height: 40 });
  expect(renderer.applyFrame(b, frame)).toBe("needs-full");
  expect(lookup).not.toHaveBeenCalled();
  expect(b.grid).toBeNull();
  expect(renderer.applyFrame(a, frame)).toBe("needs-full");
  expect(b.callbacks.onNeedFullFrame).not.toHaveBeenCalled();
  lookup.mockReturnValue(1);
  expect(renderer.applyFrame(a, frame)).toBe("applied");
  expect(renderer.applyFrame(b, frame)).toBe("needs-full");
  expect(reset).toHaveBeenCalledOnce();
  const before = lookup.mock.calls.length;
  renderer.setPaneRect(b, { x: 40, y: 0, width: 40, height: 40 });
  expect(b.callbacks.onNeedFullFrame).toHaveBeenCalledOnce();
  expect(renderer.applyFrame(b, frame)).toBe("applied");
  expect(lookup).toHaveBeenCalledTimes(before + 1);
});

it("defers graphic frames during context loss and accepts the recovered full frame", () => {
  const target = pane({ x: 0, y: 0, width: 40, height: 40 });
  const lookup = vi.fn((): number => {
    throw new Error("lost atlas must not be touched");
  });
  const graphics = {
    apply: vi.fn((): void => {
      throw new Error("lost graphics must not be touched");
    }),
  };
  const renderer = Object.assign(Object.create(GridRenderer.prototype), {
    lost: true,
    atlas: { lookup },
    graphics,
    panes: [target],
    upload: vi.fn(),
    updateBlink: vi.fn(),
    requestDraw: vi.fn(),
  }) as GridRenderer;
  const bytes = readFileSync(
    new URL(
      "../../../../tests/fixtures/terminal-graphics/direct-rgba.frame",
      import.meta.url,
    ),
  );
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const frame = decodeFrame(copy.buffer);
  expect(renderer.applyFrame(target, frame)).toBe("needs-full");
  expect(renderer.applyFrame(target, frame)).toBe("needs-full");
  expect(lookup).not.toHaveBeenCalled();
  expect(graphics.apply).not.toHaveBeenCalled();
  expect(target.grid).toBe(null);
  expect(target.header).toBe(null);
  expect(target.undrawn).toBe(true);
  Reflect.set(renderer, "lost", false);
  lookup.mockReturnValue(1);
  graphics.apply.mockImplementation(() => {});
  expect(renderer.applyFrame(target, frame)).toBe("applied");
  expect(graphics.apply).toHaveBeenCalledExactlyOnceWith(
    target,
    frame.graphics,
  );
  expect(target.grid?.cols).toBe(frame.cols);
});

it("preserves exact theme RGB identity when drawing images below cell backgrounds", () => {
  const target = pane({ x: 0, y: 0, width: 40, height: 40 });
  if (!target.header) throw new Error("fixture header missing");
  target.header.defaultBg = 0x55aa73;
  const result = draw([target], true);
  expect(result.uniform1ui).toHaveBeenCalledWith("default-bg", 0x55aa73);
});
