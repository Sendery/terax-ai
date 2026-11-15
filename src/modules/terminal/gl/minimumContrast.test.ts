import { describe, expect, it } from "vitest";
import {
  NativeContrast,
  foregroundContrast,
  contrastExcluded,
  minimumTerminalContrast,
} from "@/modules/terminal/gl/minimumContrast";
const linear = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (c: number) =>
  0.2126 * linear(c & 255) +
  0.7152 * linear((c >>> 8) & 255) +
  0.0722 * linear((c >>> 16) & 255);
const ratio = (a: number, b: number) => {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
describe("native background contrast policy", () => {
  it("uses the existing image preference without changing other backgrounds", () => {
    expect(minimumTerminalContrast("image", "public-image")).toBe(4.5);
    for (const [kind, id] of [
      ["none", "public-image"],
      ["image", null],
      ["image", ""],
    ])
      expect(minimumTerminalContrast(kind, id)).toBe(1);
  });
  it("preserves sufficient contrast and adjusts foreground toward the reachable side", () => {
    expect(foregroundContrast(0xffffff, 0, 4.5)).toBe(null);
    expect(foregroundContrast(0x777777, 0xffffff, 4.5)).toBe(0x6b6b6b);
    for (const background of [0, 0x141414, 0x777777, 0xffffff, 0x2080aa]) {
      const result = foregroundContrast(background, background, 4.5);
      expect(result).not.toBe(null);
      expect(ratio(result ?? 0, background)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("preserves decorative glyph ranges including grapheme first scalars", () => {
    for (const cp of [0x2500, 0x259f, 0xe0a4, 0xe0d6])
      expect(contrastExcluded(cp)).toBe(true);
    for (const cp of [65, 0x24ff, 0x25a0, 0xe0a3, 0xe0d7, 0x1f469])
      expect(contrastExcluded(cp)).toBe(false);
  });
  it("keeps dim text distinct and uses explicit underline color without adjustment", () => {
    const policy = new NativeContrast(4.5);
    policy.prepare(3);
    policy.style(0, 0, 0, false, 0, undefined);
    policy.style(1, 0, 0, true, 0, 0x123456);
    policy.style(2, 0xffffff, 0, true, 0x7f7f7f, undefined);
    expect(ratio(policy.foreground(0), 0)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(policy.foreground(1), 0)).toBeGreaterThanOrEqual(2.25);
    expect(policy.foreground(1)).not.toBe(policy.foreground(0));
    expect(policy.underline(1)).toBe(0x123456);
    expect(policy.foreground(2)).toBe(0x7f7f7f);
    expect(policy.underline(0)).toBe(policy.foreground(0));
  });
  it("bounds cache entries while accepting many valid color combinations", () => {
    const policy = new NativeContrast(4.5);
    policy.prepare(1);
    for (let color = 0; color < 5000; color++)
      policy.style(0, color, color, false, color, undefined);
    expect(
      (Reflect.get(policy, "cache") as Map<unknown, unknown>).size,
    ).toBeLessThanOrEqual(4096);
  });
});
