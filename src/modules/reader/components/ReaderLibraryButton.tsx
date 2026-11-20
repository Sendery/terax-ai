import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { LibraryEntry } from "@/modules/reader/lib/native";
import { BookOpen01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { type OriginTab, ReaderLibrary } from "./ReaderLibrary";

export const READER_ICON_BUTTON =
  "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60";

/** Asks the library button of a Reader tab to open (Cmd+Alt+B there). */
export const OPEN_LIBRARY_EVENT = "terax:reader-open-library";

export function requestReaderLibrary(tabId: number): void {
  window.dispatchEvent(
    new CustomEvent<number>(OPEN_LIBRARY_EVENT, { detail: tabId }),
  );
}

type Props = {
  /** Reading shown where the button lives, marked in the list. */
  currentDocId: string | null;
  originTab: (originKey: string | null) => OriginTab | null;
  onPick: (entry: LibraryEntry) => void;
  onDeleted: (ids: string[]) => void;
  /** A Reader tab's id, so the library shortcut can open this popover. */
  listenForTab?: number;
};

/** The book button: every reading so far, in a popover over the header. */
export function ReaderLibraryButton({
  currentDocId,
  originTab,
  onPick,
  onDeleted,
  listenForTab,
}: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (listenForTab === undefined) return;
    const onRequest = (event: Event) => {
      if ((event as CustomEvent<number>).detail === listenForTab)
        setOpen((value) => !value);
    };
    window.addEventListener(OPEN_LIBRARY_EVENT, onRequest);
    return () => window.removeEventListener(OPEN_LIBRARY_EVENT, onRequest);
  }, [listenForTab]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            READER_ICON_BUTTON,
            open && "bg-accent text-foreground",
          )}
          title="Readings"
          aria-label="Readings"
        >
          <HugeiconsIcon icon={BookOpen01Icon} size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="max-h-[min(460px,60vh)] w-[min(420px,90vw)] gap-0 rounded-xl p-2"
      >
        <ReaderLibrary
          currentDocId={currentDocId}
          originTab={originTab}
          onPick={(entry) => {
            setOpen(false);
            onPick(entry);
          }}
          onDeleted={onDeleted}
        />
      </PopoverContent>
    </Popover>
  );
}
