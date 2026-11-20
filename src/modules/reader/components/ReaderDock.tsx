import type { LibraryEntry } from "@/modules/reader/lib/native";
import { useReaderStore } from "@/modules/reader/store/readerStore";
import {
  BookOpen01Icon,
  Cancel01Icon,
  LinkSquare02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRef, useState } from "react";
import { READ_LABELS } from "./ReadMenuItems";
import { ReaderLibrary, type OriginTab } from "./ReaderLibrary";
import { READER_ICON_BUTTON, ReaderLibraryButton } from "./ReaderLibraryButton";
import { ReaderPane } from "./ReaderPane";

const ICON = READER_ICON_BUTTON;

const MIN = 0.18;
const MAX = 0.8;

type Props = {
  /** Reading in the panel; null shows the library. */
  docId: string | null;
  /** Share of the workspace height. */
  height: number;
  onResize: (height: number) => void;
  onClose: () => void;
  onPick: (entry: LibraryEntry) => void;
  onDeleted: (ids: string[]) => void;
  onOpenAsTab: (docId: string, title: string) => void;
  /** Hands the keyboard back to the tab's own content. */
  onEscape: () => void;
  originTab: (originKey: string | null) => OriginTab | null;
};

/**
 * The Reader under another tab's content. The content above shrinks to make
 * room, so a terminal keeps every row it shows, and the panel does not take
 * the keyboard until it is clicked.
 */
export function ReaderDock({
  docId,
  height,
  onResize,
  onClose,
  onPick,
  onDeleted,
  onOpenAsTab,
  onEscape,
  originTab,
}: Props) {
  const rootRef = useRef<HTMLElement>(null);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const title = useReaderStore((s) =>
    docId ? (s.docs[docId]?.state.title ?? null) : null,
  );
  const shown = dragHeight ?? height;

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const parent = rootRef.current?.parentElement;
    if (!parent || event.button !== 0) return;
    event.preventDefault();
    const box = parent.getBoundingClientRect();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    let last = height;
    const move = (e: PointerEvent) => {
      last = Math.min(
        MAX,
        Math.max(MIN, (box.bottom - e.clientY) / box.height),
      );
      setDragHeight(last);
    };
    const end = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      setDragHeight(null);
      onResize(last);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  };

  const libraryButton = (
    <ReaderLibraryButton
      currentDocId={docId}
      originTab={originTab}
      onPick={onPick}
      onDeleted={onDeleted}
    />
  );

  const closeButton = (
    <button
      type="button"
      className={ICON}
      title="Close the panel"
      aria-label="Close the Reader panel"
      onClick={onClose}
    >
      <HugeiconsIcon icon={Cancel01Icon} size={14} />
    </button>
  );

  return (
    <section
      ref={rootRef}
      aria-label="Reader panel"
      className="relative flex shrink-0 flex-col border-t bg-background"
      style={{ height: `${shown * 100}%` }}
    >
      <div
        className="group absolute -top-1 right-0 left-0 z-10 flex h-2 cursor-row-resize items-center justify-center"
        onPointerDown={startDrag}
        title="Drag to resize"
      >
        <span className="h-0.5 w-10 rounded-full bg-border transition-colors group-hover:bg-primary/60" />
      </div>
      {docId ? (
        <ReaderPane
          key={docId}
          docId={docId}
          visible
          variant="dock"
          onClose={onClose}
          onTitle={() => {}}
          onEscape={onEscape}
          headerStart={libraryButton}
          headerEnd={
            <>
              <button
                type="button"
                className={ICON}
                title={READ_LABELS.moveToTab}
                aria-label={READ_LABELS.moveToTab}
                onClick={() => onOpenAsTab(docId, title ?? "Reader")}
              >
                <HugeiconsIcon icon={LinkSquare02Icon} size={14} />
              </button>
              {closeButton}
            </>
          }
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1 text-[12px] text-muted-foreground">
            <HugeiconsIcon icon={BookOpen01Icon} size={14} />
            <span className="font-medium text-foreground">Reader</span>
            <span className="flex-1" />
            {closeButton}
          </div>
          <ReaderLibrary
            className="flex-1 p-2"
            currentDocId={null}
            originTab={originTab}
            onPick={onPick}
            onDeleted={onDeleted}
          />
        </div>
      )}
    </section>
  );
}
