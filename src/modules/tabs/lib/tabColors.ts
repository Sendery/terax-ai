export const TAB_COLORS = [
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "indigo",
  "purple",
  "pink",
] as const;

export type TabColor = (typeof TAB_COLORS)[number];

export function isTabColor(value: unknown): value is TabColor {
  return (
    typeof value === "string" &&
    (TAB_COLORS as readonly string[]).includes(value)
  );
}

export const TAB_COLOR_CSS: Record<TabColor, string> = {
  red: "#ef4444",
  orange: "#f97316",
  amber: "#f59e0b",
  green: "#22c55e",
  teal: "#14b8a6",
  blue: "#3b82f6",
  indigo: "#6366f1",
  purple: "#a855f7",
  pink: "#ec4899",
};

export const TAB_COLOR_LABEL: Record<TabColor, string> = {
  red: "Red",
  orange: "Orange",
  amber: "Amber",
  green: "Green",
  teal: "Teal",
  blue: "Blue",
  indigo: "Indigo",
  purple: "Purple",
  pink: "Pink",
};

export function tabAccessibleLabel(
  title: string,
  color: TabColor | undefined,
  dirty: boolean,
): string | undefined {
  if (!color) return undefined;
  return [title, TAB_COLOR_LABEL[color], dirty ? "Unsaved changes" : undefined]
    .filter(Boolean)
    .join(" - ");
}
