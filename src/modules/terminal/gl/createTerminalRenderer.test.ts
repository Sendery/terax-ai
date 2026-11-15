import { describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  gpu: vi.fn(),
  software: vi.fn(),
}));
vi.mock("@/modules/terminal/gl/gridRenderer", () => ({
  GridRenderer: vi.fn(function (
    this: object,
    canvas: unknown,
    options: unknown,
  ) {
    return fake.gpu.call(this, canvas, options);
  }),
}));
vi.mock("@/modules/terminal/gl/canvasRenderer", () => ({
  CanvasRenderer: vi.fn(function (
    this: object,
    canvas: unknown,
    options: unknown,
  ) {
    return fake.software.call(this, canvas, options);
  }),
}));
import { createTerminalRenderer } from "@/modules/terminal/gl/createTerminalRenderer";
const options = {
  font: { family: "mono", weight: "normal", size: 14, letterSpacing: 0 },
  background: 0,
};
describe("native presentation choice", () => {
  it("uses software directly when GPU preference is disabled", async () => {
    fake.gpu.mockReset();
    fake.software.mockReset();
    const canvas = {},
      renderer = { backend: "canvas" };
    fake.software.mockReturnValue(renderer);
    const make = vi.fn(() => canvas as HTMLCanvasElement);
    expect(await createTerminalRenderer(make, options, false)).toBe(renderer);
    expect(fake.gpu).not.toHaveBeenCalled();
    expect(make).toHaveBeenCalledOnce();
  });
  it("replaces the canvas after a failed GPU constructor", async () => {
    fake.gpu.mockReset();
    fake.software.mockReset();
    fake.gpu.mockImplementation(() => {
      throw new Error("GPU unavailable");
    });
    const canvas1 = {},
      canvas2 = {},
      renderer = { backend: "canvas" };
    fake.software.mockReturnValue(renderer);
    const make = vi
      .fn()
      .mockReturnValueOnce(canvas1)
      .mockReturnValueOnce(canvas2);
    expect(await createTerminalRenderer(make, options, true)).toBe(renderer);
    expect(fake.gpu).toHaveBeenCalledWith(canvas1, options);
    expect(fake.software).toHaveBeenCalledWith(canvas2, options);
  });
  it("does not construct a software backend for a working GPU", async () => {
    fake.gpu.mockReset();
    fake.software.mockReset();
    const renderer = { backend: "webgl" };
    fake.gpu.mockReturnValue(renderer);
    expect(
      await createTerminalRenderer(
        () => ({}) as HTMLCanvasElement,
        options,
        true,
      ),
    ).toBe(renderer);
    expect(fake.software).not.toHaveBeenCalled();
  });
});
