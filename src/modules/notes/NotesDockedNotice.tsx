import {
  ArrowExpandDiagonal01Icon,
  Note01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";

/** Shown in the inline panel slot while the notes panel is popped out into the
 *  floating window, so the docked-out state is discoverable and reversible. */
export function NotesDockedNotice({
  onFocusWindow,
  onDock,
}: {
  onFocusWindow: () => void;
  onDock: () => void;
}) {
  return (
    <aside
      aria-label="Notes (floating)"
      className="flex h-full min-h-0 flex-col border-l border-border/60 bg-card"
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <HugeiconsIcon
          icon={Note01Icon}
          size={15}
          strokeWidth={1.9}
          className="text-muted-foreground"
        />
        <h2 className="flex-1 text-xs font-semibold tracking-wide text-foreground">
          Notes
        </h2>
      </header>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <HugeiconsIcon
          icon={ArrowExpandDiagonal01Icon}
          size={26}
          strokeWidth={1.5}
          className="text-muted-foreground/50"
        />
        <p className="text-xs text-muted-foreground">
          Notes are open in a floating window.
        </p>
        <div className="flex flex-col gap-1.5">
          <Button variant="secondary" size="sm" onClick={onFocusWindow}>
            Focus notes window
          </Button>
          <Button variant="ghost" size="sm" onClick={onDock}>
            Dock back into panel
          </Button>
        </div>
      </div>
    </aside>
  );
}
