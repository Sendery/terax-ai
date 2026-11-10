import type { EngineColors } from "@/modules/terminal/gl/engineSession";
import type { TerminalTokens } from "@/styles/tokens";

/**
 * A computed CSS colour (`rgb(r, g, b)`, `rgba(...)`, `#rrggbb`) as the
 * frame format's 0x00BBGGRR, or `fallback` when it cannot be read.
 */
export function cssColorToBgr(value: string, fallback: number): number {
  const text = value.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return ((n >>> 16) & 0xff) | (n & 0xff00) | ((n & 0xff) << 16);
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
  if (!rgb) return fallback;
  const channel = (s: string) =>
    Math.max(0, Math.min(255, Math.round(Number.parseFloat(s))));
  return channel(rgb[1]) | (channel(rgb[2]) << 8) | (channel(rgb[3]) << 16);
}

let probe: CanvasRenderingContext2D | null = null;

/** Any CSS colour, including `oklch()` and `color()`, through a 1x1 canvas. */
export function readCssColor(value: string, fallback: number): number {
  const parsed = cssColorToBgr(value, -1);
  if (parsed >= 0) return parsed;
  probe ??= document
    .createElement("canvas")
    .getContext("2d", { willReadFrequently: true });
  if (!probe) return fallback;
  probe.canvas.width = 1;
  probe.canvas.height = 1;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  return a === 0 ? fallback : r | (g << 8) | (b << 16);
}

export const FALLBACK_ENGINE_COLORS: EngineColors = {
  foreground: "#d0d0d0",
  background: "#141414",
  cursor: "#d0d0d0",
  palette: [
    "#000000",
    "#cd0000",
    "#00cd00",
    "#cdcd00",
    "#0000ee",
    "#cd00cd",
    "#00cdcd",
    "#e5e5e5",
    "#7f7f7f",
    "#ff0000",
    "#00ff00",
    "#ffff00",
    "#5c5cff",
    "#ff00ff",
    "#00ffff",
    "#ffffff",
  ],
};

export function bgrToHex(color: number): string {
  return `#${[color & 255, (color >>> 8) & 255, (color >>> 16) & 255]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function engineColorsFromTokens(tokens: TerminalTokens): EngineColors {
  const resolve = (value: string, fallback: string) =>
    bgrToHex(readCssColor(value, cssColorToBgr(fallback, 0)));
  const palette = [
    tokens.ansiBlack,
    tokens.ansiRed,
    tokens.ansiGreen,
    tokens.ansiYellow,
    tokens.ansiBlue,
    tokens.ansiMagenta,
    tokens.ansiCyan,
    tokens.ansiWhite,
    tokens.ansiBrightBlack,
    tokens.ansiBrightRed,
    tokens.ansiBrightGreen,
    tokens.ansiBrightYellow,
    tokens.ansiBrightBlue,
    tokens.ansiBrightMagenta,
    tokens.ansiBrightCyan,
    tokens.ansiBrightWhite,
  ];
  return {
    foreground: resolve(tokens.foreground, FALLBACK_ENGINE_COLORS.foreground),
    background: resolve(tokens.background, FALLBACK_ENGINE_COLORS.background),
    cursor: resolve(tokens.cursor, FALLBACK_ENGINE_COLORS.cursor ?? "#d0d0d0"),
    palette: palette.map((value, index) =>
      resolve(value, FALLBACK_ENGINE_COLORS.palette[index]),
    ),
  };
}
