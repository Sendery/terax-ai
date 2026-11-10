import { bgrToHex, engineColorsFromTokens } from "@/terminal-lab/lib/colors";
import type { TerminalTokens } from "@/styles/tokens";
import { describe, expect, it } from "vitest";

describe("engine theme colors", () => {
  it("converts packed frame colors to six-digit RGB without swapping channels", () => {
    expect(bgrToHex(0x332211)).toBe("#112233");
    expect(bgrToHex(0x000001)).toBe("#010000");
    expect(bgrToHex(0)).toBe("#000000");
  });

  it("uses terminal tokens in ANSI order and resolves computed CSS colors", () => {
    const tokens: TerminalTokens = {
      background: "rgb(1, 2, 3)",
      foreground: "#112233",
      cursor: "rgb(4 5 6)",
      cursorAccent: "#abcdef",
      selection: "#fedcba",
      ansiBlack: "#000000",
      ansiRed: "#111111",
      ansiGreen: "#222222",
      ansiYellow: "#333333",
      ansiBlue: "#444444",
      ansiMagenta: "#555555",
      ansiCyan: "#666666",
      ansiWhite: "#777777",
      ansiBrightBlack: "#888888",
      ansiBrightRed: "#999999",
      ansiBrightGreen: "#aaaaaa",
      ansiBrightYellow: "#bbbbbb",
      ansiBrightBlue: "#cccccc",
      ansiBrightMagenta: "#dddddd",
      ansiBrightCyan: "#eeeeee",
      ansiBrightWhite: "#ffffff",
    };
    const colors = engineColorsFromTokens(tokens);
    expect(colors.foreground).toBe("#112233");
    expect(colors.background).toBe("#010203");
    expect(colors.cursor).toBe("#040506");
    expect(colors.palette).toEqual(
      Array.from(
        { length: 16 },
        (_, index) => `#${index.toString(16).repeat(6)}`,
      ),
    );
    expect(
      Object.values(colors)
        .flat()
        .every((color) => /^#[0-9a-f]{6}$/.test(color)),
    ).toBe(true);
  });
});
