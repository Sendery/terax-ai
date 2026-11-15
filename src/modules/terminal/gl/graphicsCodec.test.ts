import { readFileSync } from "node:fs";
import { decodeFrame } from "@/modules/terminal/gl/frameCodec";
import { decodeGraphics } from "@/modules/terminal/gl/graphicsCodec";
import { describe, expect, it } from "vitest";
function packet(): Uint32Array {
  return new Uint32Array([
    1, 8, 16, 1, 1, 42, 1, 0, 1, 1, 4, 0xff0000ff, 42, 1, 0, 0, 0, 0, 0, 0, 0,
    0, 1, 1, 16, 32,
  ]);
}
describe("native graphics table", () => {
  it("validates RGBA and signed viewport/z without losing the native stamp", () => {
    const value = packet();
    value[15] = 0xffffffff;
    value[17] = 0xffffffff;
    const result = decodeGraphics(value, 0, true);
    expect(result.word).toBe(value.length);
    expect(result.graphics.images[0].pixels).toEqual(
      new Uint8Array([255, 0, 0, 255]),
    );
    expect(result.graphics.placements[0]).toMatchObject({
      key: "0:1",
      z: -1,
      row: -1,
      width: 16,
      height: 32,
    });
    expect(result.graphics.images[0].pixels.buffer).toBe(value.buffer);
  });
  it("rejects every truncated word rather than yielding partial graphics", () => {
    const words = packet();
    for (let end = 0; end < words.length; end++)
      expect(() => decodeGraphics(words.subarray(0, end), 0, true)).toThrow();
  });
  it.each([
    [0, 2],
    [1, 0],
    [2, 513],
    [3, 4097],
    [4, 4097],
    [5, 0],
    [6, 0],
    [8, 8193],
    [9, 0],
    [10, 8],
    [12, 0],
    [13, 2],
    [18, 8],
    [22, 2],
    [24, 0],
  ])("rejects invalid field %s", (index, value) => {
    const words = packet();
    words[index] = value;
    expect(() => decodeGraphics(words, 0, true)).toThrow();
  });
  it("requires uploads on full frames but permits cached references on partial frames", () => {
    const words = packet();
    const partial = new Uint32Array([...words.slice(0, 5), ...words.slice(12)]);
    partial[3] = 0;
    expect(() => decodeGraphics(partial, 0, true)).toThrow();
    expect(decodeGraphics(partial, 0, false).graphics.images).toEqual([]);
  });
  it("decodes the actual Rust snapshot fixture", () => {
    const data = readFileSync(
      new URL(
        "../../../../tests/fixtures/terminal-graphics/direct-rgba.frame",
        import.meta.url,
      ),
    );
    const copy = new Uint8Array(data.length);
    copy.set(data);
    const frame = decodeFrame(copy.buffer);
    expect(frame.graphics?.cellWidth).toBe(8);
    expect(frame.graphics?.cellHeight).toBe(16);
    expect(frame.graphics?.images).toHaveLength(1);
    expect(frame.graphics?.images[0].pixels).toEqual(
      new Uint8Array([255, 0, 0, 255]),
    );
    expect(frame.graphics?.placements[0]).toMatchObject({
      id: 42,
      key: "0:1",
      width: 16,
      height: 32,
      sourceWidth: 1,
      sourceHeight: 1,
    });
  });
});
