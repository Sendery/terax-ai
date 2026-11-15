import { GraphicsRenderer } from "@/modules/terminal/gl/graphicsRenderer";
import type { DecodedGraphics } from "@/modules/terminal/gl/graphicsCodec";
import { RenderCapacityError } from "@/modules/terminal/gl/renderCapacity";
import { describe, expect, it, vi } from "vitest";
function setup() {
  const names = [
    "MAX_TEXTURE_SIZE",
    "NO_ERROR",
    "TEXTURE_2D",
    "TEXTURE2",
    "RGBA",
    "UNSIGNED_BYTE",
    "TEXTURE_MIN_FILTER",
    "TEXTURE_MAG_FILTER",
    "LINEAR",
    "TEXTURE_WRAP_S",
    "TEXTURE_WRAP_T",
    "CLAMP_TO_EDGE",
    "UNPACK_ALIGNMENT",
    "VERTEX_SHADER",
    "FRAGMENT_SHADER",
    "COMPILE_STATUS",
    "LINK_STATUS",
    "BLEND",
    "SRC_ALPHA",
    "ONE_MINUS_SRC_ALPHA",
    "ONE",
    "TRIANGLE_STRIP",
  ];
  const gl = Object.fromEntries(names.map((key, index) => [key, index + 1]));
  const fake = Object.assign(gl, {
    createProgram: vi.fn(() => ({})),
    createShader: vi.fn(() => ({})),
    getShaderParameter: vi.fn(() => true),
    getProgramParameter: vi.fn(() => true),
    getParameter: vi.fn(() => 8192),
    getError: vi.fn(() => gl.NO_ERROR),
    createTexture: vi.fn(() => ({})),
    getUniformLocation: vi.fn((_p: unknown, name: string) => name),
  });
  for (const name of [
    "shaderSource",
    "compileShader",
    "attachShader",
    "deleteShader",
    "deleteProgram",
    "linkProgram",
    "deleteTexture",
    "activeTexture",
    "bindTexture",
    "texParameteri",
    "pixelStorei",
    "texImage2D",
    "useProgram",
    "bindVertexArray",
    "enable",
    "disable",
    "blendFuncSeparate",
    "uniform1i",
    "uniform2f",
    "uniform4f",
    "drawArrays",
  ])
    Object.assign(fake, { [name]: vi.fn() });
  return {
    gl: fake as unknown as WebGL2RenderingContext,
    fake: fake as unknown as Record<string, ReturnType<typeof vi.fn>>,
  };
}
function frame(key = "0:1"): DecodedGraphics {
  return {
    cellWidth: 8,
    cellHeight: 16,
    images: [
      {
        id: 42,
        key,
        width: 1,
        height: 1,
        pixels: new Uint8Array([255, 0, 0, 255]),
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
        sourceX: 0,
        sourceY: 0,
        sourceWidth: 1,
        sourceHeight: 1,
        width: 16,
        height: 32,
      },
    ],
  };
}
describe("shared native image ownership", () => {
  it("owns exact pixels, reuses generation textures and applies native crop/device scale", () => {
    const { gl, fake } = setup(),
      r = new GraphicsRenderer(gl),
      pane = {};
    const f = frame();
    r.apply(pane, f);
    f.images[0].pixels.fill(0);
    const pixels = fake.texImage2D.mock.calls[0][8] as Uint8Array;
    expect([...pixels]).toEqual([255, 0, 0, 255]);
    r.apply(pane, { ...f, images: [] });
    expect(fake.texImage2D).toHaveBeenCalledTimes(1);
    r.draw(pane, 2, 16, 32, 160, 320);
    expect(fake.uniform4f).toHaveBeenCalledWith("uDest", 24, -16, 32, 64);
    expect(fake.uniform4f).toHaveBeenCalledWith("uSource", 0, 0, 1, 1);
    expect(fake.drawArrays).toHaveBeenCalledOnce();
    r.apply(pane, frame("0:2"));
    expect(fake.deleteTexture).toHaveBeenCalledOnce();
    r.remove(pane);
    expect(fake.deleteTexture).toHaveBeenCalledTimes(2);
    expect(r.has(pane)).toBe(false);
  });
  it("handles program allocation failure before a frame becomes drawable", () => {
    const { gl, fake } = setup(),
      r = new GraphicsRenderer(gl),
      pane = {};
    fake.createProgram.mockReturnValue(null);
    expect(() => r.apply(pane, frame())).toThrow(RenderCapacityError);
    expect(r.has(pane)).toBe(false);
    expect(fake.texImage2D).not.toHaveBeenCalled();
  });
  it("handles shader failure through the same explicit capacity path", () => {
    const { gl, fake } = setup(),
      r = new GraphicsRenderer(gl),
      pane = {};
    fake.getShaderParameter.mockReturnValue(false);
    expect(() => r.apply(pane, frame())).toThrow(RenderCapacityError);
    expect(fake.deleteProgram).toHaveBeenCalledOnce();
    expect(r.has(pane)).toBe(false);
  });
  it("drops graphic references on context loss and reconstructs only from full pixel data", () => {
    const { gl, fake } = setup(),
      r = new GraphicsRenderer(gl),
      pane = {};
    r.apply(pane, frame());
    r.dropContext();
    expect(r.has(pane)).toBe(false);
    expect(() => r.apply(pane, { ...frame(), images: [] })).toThrow("missing");
    r.apply(pane, frame());
    expect(fake.texImage2D).toHaveBeenCalledTimes(2);
    r.apply(pane, { ...frame(), images: [], placements: [] });
    expect(r.has(pane)).toBe(false);
  });
  it("keeps previous valid graphics when a cached crop reference is invalid", () => {
    const { gl, fake } = setup(),
      r = new GraphicsRenderer(gl),
      pane = {};
    r.apply(pane, frame());
    const invalid = frame();
    invalid.placements[0].sourceWidth = 2;
    expect(() => r.apply(pane, invalid)).toThrow("crop");
    expect(r.has(pane)).toBe(true);
    expect(fake.deleteTexture).not.toHaveBeenCalled();
  });
});

it("limits magnified one-pixel crops to their own texel centers", () => {
  const { gl, fake } = setup();
  const renderer = new GraphicsRenderer(gl);
  const pane = {};
  const initial = frame();
  const cropped: DecodedGraphics = {
    ...initial,
    images: [
      {
        ...initial.images[0],
        width: 3,
        pixels: new Uint8Array([
          255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
        ]),
      },
    ],
    placements: [
      {
        ...initial.placements[0],
        sourceX: 1,
        sourceWidth: 1,
        width: 160,
        height: 160,
      },
    ],
  };
  renderer.apply(pane, cropped);
  renderer.draw(pane, 2, 16, 32, 320, 320);
  expect(fake.uniform4f).toHaveBeenCalledWith(
    "uSampleBounds",
    0.5,
    0.5,
    0.5,
    0.5,
  );
});
