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

function hexChannels(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = hexChannels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Perceived luminance (sRGB coefficients) decides whether an active fill needs
// dark or light text so the label stays legible on every palette color.
function luminance(hex: string): number {
  const [r, g, b] = hexChannels(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function tabColorForeground(color: TabColor): "#0a0a0a" | "#ffffff" {
  return luminance(TAB_COLOR_CSS[color]) > 0.52 ? "#0a0a0a" : "#ffffff";
}

export type TabColorStyle = {
  backgroundColor: string;
  borderColor: string;
  color?: string;
};

export function tabColorStyle(color: TabColor, active: boolean): TabColorStyle {
  const hex = TAB_COLOR_CSS[color];
  if (active) {
    return {
      backgroundColor: hex,
      borderColor: hex,
      color: tabColorForeground(color),
    };
  }
  return {
    backgroundColor: hexToRgba(hex, 0.14),
    borderColor: hexToRgba(hex, 0.55),
  };
}

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
