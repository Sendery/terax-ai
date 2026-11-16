export const TERMINAL_SELECTION_GESTURE_EVENT =
  "terax:terminal-selection-gesture";

export type TerminalSelectionGesture = {
  x: number;
  y: number;
  selection: Promise<string | null>;
  current: () => boolean;
};
