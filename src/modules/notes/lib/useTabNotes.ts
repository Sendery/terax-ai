import { useCallback } from "react";
import { createCardFromInput, type NoteCard } from "./cards";
import {
  addCard,
  moveCard,
  type NoteCardPatch,
  removeCard,
  updateCard,
} from "./collection";
import { fetchCardStatus } from "./fetchStatus";

export type TabNotesApi = {
  notes: readonly NoteCard[];
  /** Add a card from raw input (URL -> link card, otherwise free text). */
  addFromInput: (raw: string) => void;
  addCard: (card: NoteCard) => void;
  remove: (id: string) => void;
  update: (id: string, patch: NoteCardPatch) => void;
  move: (id: string, toIndex: number) => void;
  /** Fetch and apply live status (GitHub PR/CI, Jira) for one card. */
  refresh: (id: string) => Promise<void>;
  /** Refresh every live card in the tab. */
  refreshAll: () => Promise<void>;
};

function isLive(card: NoteCard): boolean {
  return card.kind === "github-pr" || card.kind === "jira";
}

/** Immutable updater bound to a single tab's persisted notes. */
export type NotesMutator = (updater: (cards: NoteCard[]) => NoteCard[]) => void;

/**
 * Binds the pure notes CRUD to a backing store — the active tab's persisted
 * `notes` array via `updateTabNotes`. Notes are scoped per workspace + tab and
 * survive restarts because they serialize with the tab.
 */
const EMPTY: readonly NoteCard[] = Object.freeze([]);

export function useTabNotes(
  notes: readonly NoteCard[] | undefined,
  mutate: NotesMutator,
): TabNotesApi {
  const list = notes ?? EMPTY;
  const applyFetched = useCallback(
    async (card: NoteCard) => {
      const patch = await fetchCardStatus(card);
      if (Object.keys(patch).length > 0) {
        mutate((cards) => updateCard(cards, card.id, patch));
      }
    },
    [mutate],
  );

  const addFromInput = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      const card = createCardFromInput(trimmed);
      mutate((cards) => addCard(cards, card));
      // Auto-fetch live status right after adding a PR/Jira card.
      if (isLive(card)) void applyFetched(card);
    },
    [mutate, applyFetched],
  );

  const refresh = useCallback(
    async (id: string) => {
      const card = list.find((c) => c.id === id);
      if (card && isLive(card)) await applyFetched(card);
    },
    [list, applyFetched],
  );

  const refreshAll = useCallback(async () => {
    await Promise.all(list.filter(isLive).map(applyFetched));
  }, [list, applyFetched]);

  const addCardCb = useCallback(
    (card: NoteCard) => mutate((cards) => addCard(cards, card)),
    [mutate],
  );
  const remove = useCallback(
    (id: string) => mutate((cards) => removeCard(cards, id)),
    [mutate],
  );
  const update = useCallback(
    (id: string, patch: NoteCardPatch) =>
      mutate((cards) => updateCard(cards, id, patch)),
    [mutate],
  );
  const move = useCallback(
    (id: string, toIndex: number) =>
      mutate((cards) => moveCard(cards, id, toIndex)),
    [mutate],
  );

  return {
    notes: list,
    addFromInput,
    addCard: addCardCb,
    remove,
    update,
    move,
    refresh,
    refreshAll,
  };
}
