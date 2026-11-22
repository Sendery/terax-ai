import type { TerminalFileLocation } from "@/modules/terminal/lib/fileLinks";
import type { TerminalSearch } from "@/modules/terminal/lib/terminalSearch";
import { NativeTerminalPane } from "@/modules/terminal/NativeTerminalPane";
import { memo } from "react";
import type {
  ReadAloudOptions,
  TerminalSelectionActions,
} from "./TerminalContextMenu";

export type TerminalPaneHandle = {
  write: (data: string) => void;
  focus: () => void;
  /** Newline encoding the foreground program negotiated, for synthesized
   *  multiline input that must not submit early. */
  shiftEnter: () => string | Promise<string>;
  getBuffer: (maxLines?: number) => string | null | Promise<string | null>;
  getSelection: () => string | null;
};

export type TerminalPaneProps = {
  /** Stable identifier for this leaf (passed back through callbacks). */
  leafId: number;
  /** Tab containing this pane is on screen. */
  visible: boolean;
  /** This leaf is the active pane within its tab — receives auto-focus. */
  focused?: boolean;
  initialCwd?: string;
  homePath?: string | null;
  /** Enable command-block decorations (OSC 133) for this terminal. */
  blocks?: boolean;
  onSearchReady?: (leafId: number, addon: TerminalSearch) => void;
  onExit?: (leafId: number, code: number) => void;
  onCwd?: (leafId: number, cwd: string) => void;
  onOpenFileLink?: (path: string, location?: TerminalFileLocation) => void;
  onReadAloud?: (text: string, options: ReadAloudOptions) => void;
  onStopReading?: () => void;
  /** Ask Terax / Add to Note / Open Mermaid, shared with the selection popup. */
  selectionActions?: TerminalSelectionActions;
  /** Hides Read aloud, the same way a private terminal is hidden from AI. */
  privateTerminal?: boolean;
};

export const TerminalPane = memo(NativeTerminalPane);
