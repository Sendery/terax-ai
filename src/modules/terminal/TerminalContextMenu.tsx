import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  SelectionActionItems,
  type SelectionActions,
} from "@/modules/ai/components/SelectionActionItems";
import {
  type ReadAloudOptions,
  ReadMenuItems,
} from "@/modules/reader/components/ReadMenuItems";
import { useSounding } from "@/modules/reader/lib/sounding";
import {
  ClipboardPasteIcon,
  Copy01Icon,
  Refresh01Icon,
  TextWrapIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactNode, useState } from "react";
import { selectionCopyChoices } from "./lib/agentCopy";
import { pasteIntoLeaf, repaintLeaf } from "./lib/leafSession";
import {
  readTerminalClipboard,
  writeTerminalClipboard,
} from "./lib/terminalClipboard";

export type { ReadAloudOptions };

/**
 * On macOS xterm's `rightClickSelectsWord` can replace the selection under the
 * pointer before the menu is built, hence the captured selection.
 */
export type TerminalSelectionActions = SelectionActions;

type Props = {
  children: ReactNode;
  leafId: number;
  /** Selection captured before the menu opened, since a right-click can move
   *  the xterm selection on its own. */
  readSelection: () => string | null;
  /** What Copy writes for the selection. An agent pane rejoins the paragraphs
   *  the program wrapped; when that changes the text, "Copy as shown" offers
   *  the selection exactly as it is on screen. */
  copyText?: (selection: string) => string;
  onReadAloud?: (text: string, options: ReadAloudOptions) => void;
  onStopReading?: () => void;
  onRestoreFocus?: () => void;
  onPaste?: () => void;
  onRedraw?: () => void;
  selectionActions?: TerminalSelectionActions;
  /** Private terminals are hidden from the AI and from snapshots; reading them
   *  aloud keeps the same signal and is not offered. */
  privateTerminal?: boolean;
};

/**
 * Terminal pane context menu. The body is a child component so its store
 * subscriptions exist only while the menu is open.
 */
export function TerminalContextMenu({
  children,
  leafId,
  readSelection,
  copyText,
  onReadAloud,
  onStopReading,
  onRestoreFocus,
  onPaste,
  onRedraw,
  selectionActions,
  privateTerminal = false,
}: Props) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        className="min-w-44"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus?.();
        }}
      >
        <MenuBody
          leafId={leafId}
          readSelection={readSelection}
          copyText={copyText}
          onPaste={onPaste}
          onRedraw={onRedraw}
          onReadAloud={onReadAloud}
          onStopReading={onStopReading}
          selectionActions={selectionActions}
          privateTerminal={privateTerminal}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function MenuBody({
  leafId,
  readSelection,
  copyText,
  onPaste,
  onRedraw,
  onReadAloud,
  onStopReading,
  selectionActions,
  privateTerminal,
}: Omit<Props, "children" | "onRestoreFocus">) {
  // Read once at mount: the menu only mounts on open, and the selection must
  // not change under the open menu.
  const [{ shown: selection, copied }] = useState(() =>
    selectionCopyChoices(readSelection(), copyText),
  );
  const sounding = useSounding();
  const offersSpeech = Boolean(onReadAloud) && !privateTerminal;

  return (
    <>
      <ContextMenuItem
        disabled={selection.length === 0}
        onSelect={() => void writeTerminalClipboard(copied)}
      >
        <HugeiconsIcon icon={Copy01Icon} size={14} strokeWidth={1.75} />
        <span className="flex-1">Copy</span>
      </ContextMenuItem>
      {copied !== selection ? (
        <ContextMenuItem
          onSelect={() => void writeTerminalClipboard(selection)}
        >
          <HugeiconsIcon icon={TextWrapIcon} size={14} strokeWidth={1.75} />
          <span className="flex-1">Copy as shown</span>
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem
        onSelect={() => {
          if (onPaste) {
            onPaste();
            return;
          }
          void readTerminalClipboard().then((text) => {
            if (text) pasteIntoLeaf(leafId, text);
          });
        }}
      >
        <HugeiconsIcon icon={ClipboardPasteIcon} size={14} strokeWidth={1.75} />
        <span className="flex-1">Paste</span>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        onSelect={() => (onRedraw ? onRedraw() : repaintLeaf(leafId))}
      >
        <HugeiconsIcon icon={Refresh01Icon} size={14} strokeWidth={1.75} />
        <span className="flex-1">Redraw</span>
      </ContextMenuItem>
      {selectionActions ? (
        <>
          <ContextMenuSeparator />
          <SelectionActionItems
            selection={selection}
            actions={selectionActions}
          />
        </>
      ) : null}
      {offersSpeech && onReadAloud ? (
        <>
          <ContextMenuSeparator />
          <ReadMenuItems
            selection={selection}
            onRead={onReadAloud}
            onStop={onStopReading}
            canStop={sounding}
          />
        </>
      ) : null}
    </>
  );
}
