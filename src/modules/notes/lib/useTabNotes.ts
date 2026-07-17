import { useCallback, useMemo, useState } from "react";
import { createCardFromInput, type NoteCard } from "./cards";
import {
  addCard,
  moveCard,
  type NoteCardPatch,
  removeCard,
  updateCard,
} from "./collection";

const EMPTY: readonly NoteCard[] = Object.freeze([]);

export type TabNotesApi = {
  notes: readonly NoteCard[];
  /** Add a card from raw input (URL -> link card, otherwise free text). */
  addFromInput: (raw: string) => void;
  addCard: (card: NoteCard) => void;
  remove: (id: string) => void;
  update: (id: string, patch: NoteCardPatch) => void;
  move: (id: string, toIndex: number) => void;
};

/**
 * In-memory notes keyed by the runtime tab id. Persistence across restarts is
 * layered on in a later slice; here notes live for the session and are scoped
 * per tab so each tab shows its own list.
 */
export function useTabNotes(activeTabId: number | null): TabNotesApi {
  const [byTab, setByTab] = useState<Map<number, NoteCard[]>>(() => new Map());

  const notes = useMemo<readonly NoteCard[]>(() => {
    if (activeTabId == null) return EMPTY;
    return byTab.get(activeTabId) ?? EMPTY;
  }, [activeTabId, byTab]);

  const mutate = useCallback(
    (fn: (current: NoteCard[]) => NoteCard[]) => {
      if (activeTabId == null) return;
      setByTab((prev) => {
        const current = prev.get(activeTabId) ?? [];
        const next = fn(current);
        if (next === current) return prev;
        const map = new Map(prev);
        map.set(activeTabId, next);
        return map;
      });
    },
    [activeTabId],
  );

  const addFromInputCb = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      mutate((cards) => addCard(cards, createCardFromInput(trimmed)));
    },
    [mutate],
  );

  const addCardCb = useCallback(
    (card: NoteCard) => mutate((cards) => addCard(cards, card)),
    [mutate],
  );
  const removeCb = useCallback(
    (id: string) => mutate((cards) => removeCard(cards, id)),
    [mutate],
  );
  const updateCb = useCallback(
    (id: string, patch: NoteCardPatch) =>
      mutate((cards) => updateCard(cards, id, patch)),
    [mutate],
  );
  const moveCb = useCallback(
    (id: string, toIndex: number) =>
      mutate((cards) => moveCard(cards, id, toIndex)),
    [mutate],
  );

  return {
    notes,
    addFromInput: addFromInputCb,
    addCard: addCardCb,
    remove: removeCb,
    update: updateCb,
    move: moveCb,
  };
}
