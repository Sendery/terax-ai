import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { fmtShortcut, MOD_KEY } from "@/lib/platform";
import { useSounding } from "@/modules/reader/lib/sounding";
import {
  ClipboardPasteIcon,
  Copy01Icon,
  Scissor01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactNode, useState } from "react";
import { type ReadAloudOptions, ReadMenuItems } from "./ReadMenuItems";

/** What the editor and Markdown views give the menu. */
export type ReadContextMenuBinding = {
  /** The selection when the menu opened, or null; a private source gives null. */
  readSelection: () => string | null;
  /** Null when this view can read, else why it cannot (shown, not hidden). */
  blockedReason: () => string | null;
  /** The view reads its whole document when nothing is selected. */
  documentFallback: () => boolean;
  /** The source editor is on screen and takes input (Cut and Paste). */
  editable: () => boolean;
  onReplaceSelection: (text: string) => void;
  onCopy: (text: string) => void;
  readClipboard: () => Promise<string>;
  onRead: (text: string, options: ReadAloudOptions) => void;
  onStop: () => void;
};

type Props = {
  children: ReactNode;
  binding: ReadContextMenuBinding;
};

/**
 * Right-click in the editor and in both Markdown views: the clipboard
 * actions the webview's own menu used to give, plus the reading actions the
 * terminal offers, so "right-click a selection and choose Read here" holds
 * in every text view.
 */
export function ReadContextMenu({ children, binding }: Props) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-44">
        <MenuBody binding={binding} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function MenuBody({ binding }: { binding: ReadContextMenuBinding }) {
  // Read once at mount: the menu mounts on open, and its actions must use
  // the selection the right-click was made on.
  const [snapshot] = useState(() => ({
    selection: binding.readSelection()?.trim() ?? "",
    blocked: binding.blockedReason(),
    documentFallback: binding.documentFallback(),
    editable: binding.editable(),
  }));
  const sounding = useSounding();
  const { selection, blocked, documentFallback, editable } = snapshot;

  return (
    <>
      {editable ? (
        <ContextMenuItem
          disabled={selection.length === 0}
          onSelect={() => {
            binding.onCopy(selection);
            binding.onReplaceSelection("");
          }}
        >
          <HugeiconsIcon icon={Scissor01Icon} size={14} strokeWidth={1.75} />
          <span className="flex-1">Cut</span>
          <ContextMenuShortcut>{fmtShortcut(MOD_KEY, "X")}</ContextMenuShortcut>
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem
        disabled={selection.length === 0}
        onSelect={() => binding.onCopy(selection)}
      >
        <HugeiconsIcon icon={Copy01Icon} size={14} strokeWidth={1.75} />
        <span className="flex-1">Copy</span>
        <ContextMenuShortcut>{fmtShortcut(MOD_KEY, "C")}</ContextMenuShortcut>
      </ContextMenuItem>
      {editable ? (
        <ContextMenuItem
          onSelect={() =>
            void binding.readClipboard().then((text) => {
              if (text) binding.onReplaceSelection(text);
            })
          }
        >
          <HugeiconsIcon
            icon={ClipboardPasteIcon}
            size={14}
            strokeWidth={1.75}
          />
          <span className="flex-1">Paste</span>
          <ContextMenuShortcut>{fmtShortcut(MOD_KEY, "V")}</ContextMenuShortcut>
        </ContextMenuItem>
      ) : null}
      <ContextMenuSeparator />
      {blocked ? (
        <ContextMenuItem disabled>
          <span className="flex-1 text-muted-foreground">{blocked}</span>
        </ContextMenuItem>
      ) : (
        <ReadMenuItems
          selection={selection}
          documentFallback={documentFallback}
          onRead={binding.onRead}
          onStop={binding.onStop}
          canStop={sounding}
        />
      )}
    </>
  );
}
