import { isMarkdownPath } from "@/lib/utils";
import type { Tab } from "@/modules/tabs";

export const VIEW_MODES = ["raw", "rendered", "side-by-side"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];
export function isViewMode(value: unknown): value is ViewMode {
  return VIEW_MODES.includes(value as ViewMode);
}
export function fileRenderKind(path: string) {
  if (isMarkdownPath(path)) return "markdown";
  const ext = path.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase();
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "mmd" || ext === "mermaid") return "mermaid";
  if (ext === "graphx") return "graphx";
  return null;
}
export function resolveViewMode(tab: {
  kind: string;
  viewMode?: unknown;
}): ViewMode {
  if (isViewMode(tab.viewMode)) return tab.viewMode;
  return tab.kind === "mermaid"
    ? "side-by-side"
    : tab.kind === "markdown" || tab.kind === "graphx"
      ? "rendered"
      : "raw";
}
export function applyRenderableView(tab: Tab, mode: ViewMode): Tab {
  if (!isViewMode(mode)) return tab;
  if (tab.kind === "editor" && !fileRenderKind(tab.path)) return tab;
  if (!["editor", "markdown", "mermaid", "graphx"].includes(tab.kind))
    return tab;
  return { ...tab, viewMode: mode };
}
