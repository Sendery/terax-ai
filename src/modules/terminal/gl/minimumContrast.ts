let linear: Float64Array | undefined;
const MAX_CACHE_ENTRIES = 4096;

export function minimumTerminalContrast(
  kind: unknown,
  imageId: unknown,
): number {
  return kind === "image" && imageId ? 4.5 : 1;
}
export function normalizeMinimumContrast(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value)
    ? Math.max(1, Math.min(21, value))
    : 1;
}
export function contrastExcluded(codepoint: number): boolean {
  return (
    (codepoint >= 0x2500 && codepoint <= 0x259f) ||
    (codepoint >= 0xe0a4 && codepoint <= 0xe0d6)
  );
}
function table(): Float64Array {
  linear ??= Float64Array.from({ length: 256 }, (_, i) => {
    const v = i / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return linear;
}
function luminance(color: number): number {
  const t = table();
  return (
    t[color & 255] * 0.2126 +
    t[(color >>> 8) & 255] * 0.7152 +
    t[(color >>> 16) & 255] * 0.0722
  );
}
function ratio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
function shifted(color: number, lighten: boolean): number {
  let next = 0;
  for (let shift = 0; shift < 24; shift += 8) {
    const channel = (color >>> shift) & 255;
    const changed = lighten
      ? channel + Math.ceil((255 - channel) * 0.1)
      : channel - Math.ceil(channel * 0.1);
    next |= changed << shift;
  }
  return next;
}
export function foregroundContrast(
  foreground: number,
  background: number,
  minimum: number,
): number | null {
  const bg = luminance(background),
    fg = luminance(foreground);
  if (ratio(fg, bg) >= minimum) return null;
  const search = (lighten: boolean): number => {
    let candidate = foreground;
    while (ratio(luminance(candidate), bg) < minimum) {
      const next = shifted(candidate, lighten);
      if (next === candidate) break;
      candidate = next;
    }
    return candidate;
  };
  const first = search(fg >= bg);
  if (ratio(luminance(first), bg) >= minimum) return first;
  const other = search(fg < bg);
  return ratio(luminance(first), bg) > ratio(luminance(other), bg)
    ? first
    : other;
}

export class NativeContrast {
  readonly ratio: number;
  private cache = new Map<number, number | null>();
  private styles = new Uint32Array(0);
  constructor(ratio: number) {
    this.ratio = normalizeMinimumContrast(ratio);
  }
  prepare(count: number): void {
    if (this.styles.length < count * 2)
      this.styles = new Uint32Array(count * 2);
  }
  style(
    id: number,
    foreground: number,
    background: number,
    dim: boolean,
    fallback: number,
    underline: number | undefined,
  ): void {
    const key = (foreground * 0x1000000 + background) * 2 + Number(dim);
    let adjusted = this.cache.get(key);
    if (adjusted === undefined) {
      adjusted = foregroundContrast(
        foreground,
        background,
        this.ratio / (dim ? 2 : 1),
      );
      if (this.cache.size >= MAX_CACHE_ENTRIES) this.cache.clear();
      this.cache.set(key, adjusted);
    }
    const fg = adjusted ?? fallback;
    this.styles[id * 2] = fg;
    this.styles[id * 2 + 1] = underline ?? fg;
  }
  foreground(id: number): number {
    return this.styles[id * 2];
  }
  underline(id: number): number {
    return this.styles[id * 2 + 1];
  }
}
