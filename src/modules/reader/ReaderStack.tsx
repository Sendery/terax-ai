import type { ReaderTab, Tab } from "@/modules/tabs";
import { LayoutBottomIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { OriginTab } from "./components/ReaderLibrary";
import {
  READER_ICON_BUTTON,
  ReaderLibraryButton,
} from "./components/ReaderLibraryButton";
import { ReaderPane } from "./components/ReaderPane";
import { READ_LABELS } from "./components/ReadMenuItems";
import type { LibraryEntry } from "./lib/native";

/** What a Reader tab's header needs to reach the library and the panel. */
export type ReaderTabBinding = {
  onPick: (tabId: number, entry: LibraryEntry) => void;
  onDeleted: (ids: string[]) => void;
  originTab: (originKey: string | null) => OriginTab | null;
  /** Moves the reading into the panel of the tab it came from. */
  onDockHere: (tabId: number, docId: string) => void;
};

type Props = {
  tabs: Tab[];
  activeId: number;
  onClose: (tabId: number) => void;
  onTitle: (tabId: number, title: string) => void;
  binding?: ReaderTabBinding;
};

/** Mounts only the Reader tab on screen; documents stay in the store. */
export function ReaderStack({
  tabs,
  activeId,
  onClose,
  onTitle,
  binding,
}: Props) {
  const active = tabs.find(
    (t): t is ReaderTab => t.kind === "reader" && t.id === activeId,
  );
  if (!active) return null;
  return (
    <ReaderPane
      key={active.id}
      docId={active.docId}
      visible
      onClose={() => onClose(active.id)}
      onTitle={(title) => {
        if (title !== active.title) onTitle(active.id, title);
      }}
      headerStart={
        binding ? (
          <ReaderLibraryButton
            currentDocId={active.docId}
            originTab={binding.originTab}
            onPick={(entry) => binding.onPick(active.id, entry)}
            onDeleted={binding.onDeleted}
            listenForTab={active.id}
          />
        ) : undefined
      }
      headerEnd={
        binding ? (
          <button
            type="button"
            className={READER_ICON_BUTTON}
            title={`${READ_LABELS.dockHere}: back to the panel of the tab it came from`}
            aria-label={READ_LABELS.dockHere}
            onClick={() => binding.onDockHere(active.id, active.docId)}
          >
            <HugeiconsIcon icon={LayoutBottomIcon} size={14} />
          </button>
        ) : undefined
      }
    />
  );
}
