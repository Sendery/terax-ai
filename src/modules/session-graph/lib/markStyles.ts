import type { MarkColor } from "./marks";

/**
 * Closed style maps for mark colours.
 *
 * Tailwind only emits classes it can see, so these are written out rather than
 * interpolated. Keeping them in one place also means a mark reads the same in the
 * row, the outline and the scroll rail.
 */
export const MARK_DOT_CLASS: Record<MarkColor, string> = {
  amber: "bg-amber-500",
  green: "bg-emerald-500",
  blue: "bg-sky-500",
  purple: "bg-purple-500",
  red: "bg-red-500",
};

export const MARK_CHIP_CLASS: Record<MarkColor, string> = {
  amber:
    "border-amber-500/40 bg-amber-500/12 text-amber-700 dark:text-amber-300",
  green:
    "border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  blue: "border-sky-500/40 bg-sky-500/12 text-sky-700 dark:text-sky-300",
  purple:
    "border-purple-500/40 bg-purple-500/12 text-purple-700 dark:text-purple-300",
  red: "border-red-500/40 bg-red-500/12 text-red-700 dark:text-red-300",
};

/** Left accent on a marked row, so a key point is visible while scrolling. */
export const MARK_ACCENT_CLASS: Record<MarkColor, string> = {
  amber: "shadow-[inset_2px_0_0_0_var(--color-amber-500)]",
  green: "shadow-[inset_2px_0_0_0_var(--color-emerald-500)]",
  blue: "shadow-[inset_2px_0_0_0_var(--color-sky-500)]",
  purple: "shadow-[inset_2px_0_0_0_var(--color-purple-500)]",
  red: "shadow-[inset_2px_0_0_0_var(--color-red-500)]",
};
