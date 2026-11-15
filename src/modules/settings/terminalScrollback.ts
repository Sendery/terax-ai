export const TERMINAL_SCROLLBACK_DEFAULT = 2000;
export const TERMINAL_SCROLLBACK_MIN = 200;
export const TERMINAL_SCROLLBACK_MAX = 50_000;
export const TERMINAL_SCROLLBACK_PRESETS = [
  500, 1000, 2000, 5000, 10_000, 25_000,
] as const;

export function isScrollbackRows(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= TERMINAL_SCROLLBACK_MIN &&
    value <= TERMINAL_SCROLLBACK_MAX
  );
}
export function validateScrollbackRows(
  value: unknown,
): asserts value is number {
  if (!isScrollbackRows(value))
    throw new Error(
      "Terminal scrollback must be an integer from 200 through 50000 rows.",
    );
}
export function clampScrollback(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    return TERMINAL_SCROLLBACK_DEFAULT;
  return Math.min(
    TERMINAL_SCROLLBACK_MAX,
    Math.max(TERMINAL_SCROLLBACK_MIN, Math.round(value)),
  );
}
