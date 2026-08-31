export {
  isTabColor,
  TAB_COLOR_CSS,
  TAB_COLOR_LABEL,
  TAB_COLORS,
  type TabColor,
  tabAccessibleLabel,
  tabColorStyle,
  type TabColorStyle,
} from "./lib/tabColors";
export { labelFor } from "./lib/tabLabel";
export { waitForMermaidTabReplacement } from "./lib/mermaidTabMutation";
export {
  type AiDiffStatus,
  type AiDiffTab,
  applyMarkdownView,
  applyTabPatch,
  DEFAULT_SPACE_ID,
  type EditorTab,
  type GitCommitFileDiffTab,
  type GitDiffTab,
  type GitHistoryTab,
  MAX_PANES_PER_TAB,
  type MarkdownTab,
  type MermaidTab,
  type MermaidVisualLayout,
  nextActiveInSpace,
  type PreviewTab,
  type PrReviewTab,
  type Tab,
  type TabPatch,
  type TerminalTab,
  useTabs,
} from "./lib/useTabs";
export { useWindowTitle } from "./lib/useWindowTitle";
export { useWorkspaceCwd } from "./lib/useWorkspaceCwd";
export { TabBar, TabIcon } from "./TabBar";
