import {
  ContextMenuItem,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";
import { fmtShortcut, MOD_KEY } from "@/lib/platform";
import {
  Flowchart01Icon,
  Note01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

/**
 * What a text view's right-click menu does with its selection. Each action
 * receives the selection captured when the menu opened, since a right-click
 * can replace the live selection before the menu is built.
 */
export type SelectionActions = {
  onAsk: (text: string) => void;
  onAddToNote: (text: string) => void;
  onOpenMermaid: (text: string) => void;
};

/** Ask Terax, Add to Note and Open Mermaid, offered for a selection. */
export function SelectionActionItems({
  selection,
  actions,
}: {
  selection: string;
  actions: SelectionActions;
}) {
  const empty = selection.length === 0;
  return (
    <>
      <ContextMenuItem
        disabled={empty}
        onSelect={() => actions.onAsk(selection)}
      >
        <HugeiconsIcon icon={SparklesIcon} size={14} strokeWidth={1.75} />
        <span className="flex-1">Ask Terax</span>
        <ContextMenuShortcut>{fmtShortcut(MOD_KEY, "J")}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem
        disabled={empty}
        onSelect={() => actions.onAddToNote(selection)}
      >
        <HugeiconsIcon icon={Note01Icon} size={14} strokeWidth={1.75} />
        <span className="flex-1">Add to Note</span>
        <ContextMenuShortcut>{fmtShortcut(MOD_KEY, "L")}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem
        disabled={empty}
        onSelect={() => actions.onOpenMermaid(selection)}
      >
        <HugeiconsIcon icon={Flowchart01Icon} size={14} strokeWidth={1.75} />
        <span className="flex-1">Open Mermaid</span>
      </ContextMenuItem>
    </>
  );
}
