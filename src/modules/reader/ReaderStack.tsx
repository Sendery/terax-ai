import type { ReaderTab, Tab } from "@/modules/tabs";
import { ReaderPane } from "./components/ReaderPane";

type Props = {
  tabs: Tab[];
  activeId: number;
  onClose: (tabId: number) => void;
  onTitle: (tabId: number, title: string) => void;
};

/** Mounts only the Reader tab on screen; documents stay in the store. */
export function ReaderStack({ tabs, activeId, onClose, onTitle }: Props) {
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
    />
  );
}
