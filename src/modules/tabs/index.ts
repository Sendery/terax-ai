export { TabBar, TabIcon } from "./TabBar";
export { labelFor } from "./lib/tabLabel";
export {
  TAB_COLORS,
  TAB_COLOR_CSS,
  TAB_COLOR_LABEL,
  isTabColor,
  tabAccessibleLabel,
  type TabColor,
} from "./lib/tabColors";
export {
  MAX_PANES_PER_TAB,
  DEFAULT_SPACE_ID,
  useTabs,
  nextActiveInSpace,
  applyTabPatch,
  applyMarkdownView,
  type Tab,
  type TerminalTab,
  type EditorTab,
  type PreviewTab,
  type MarkdownTab,
  type AiDiffTab,
  type GitDiffTab,
  type GitHistoryTab,
  type GitCommitFileDiffTab,
  type AiDiffStatus,
  type TabPatch,
} from "./lib/useTabs";
export { useWorkspaceCwd } from "./lib/useWorkspaceCwd";
export { useWindowTitle } from "./lib/useWindowTitle";
