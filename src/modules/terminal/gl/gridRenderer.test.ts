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

function draw(panes: RenderPane[]) {
  const drawArraysInstanced = vi.fn();
  const gl = new Proxy(
    { drawArraysInstanced },
    {
      get(target, key) {
        return key === "drawArraysInstanced"
          ? target.drawArraysInstanced
          : vi.fn();
      },
    },
  );
  const drawnPanes = new Map<RenderPane, boolean>();
  const renderer = Object.assign(Object.create(GridRenderer.prototype), {
    gl,
    program: {},
    uniforms: {},
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
  return { drawnPanes, drawArraysInstanced };
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
