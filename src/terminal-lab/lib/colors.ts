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
