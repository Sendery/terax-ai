/**
 * Pure CRUD over an ordered list of NoteCards. Every function is immutable:
 * it returns a new array (or the same reference when nothing changed) and never
 * mutates its inputs. No React, no persistence, no IO.
 */
import type {
  CiState,
  JiraStatusCategory,
  NoteCard,
  PrState,
} from "./cards";

/** Fields a user (or a live enrichment pass) may patch on a card. Only fields
 *  that exist on the targeted card kind take effect. */
export type NoteCardPatch = Partial<{
  title: string;
  note: string;
  body: string;
  url: string;
  prState: PrState;
  ciState: CiState;
  status: JiraStatusCategory;
  statusName: string;
}>;

export function addCard(cards: NoteCard[], card: NoteCard): NoteCard[] {
  return [...cards, card];
}

export function removeCard(cards: NoteCard[], id: string): NoteCard[] {
  if (!cards.some((c) => c.id === id)) return cards;
  return cards.filter((c) => c.id !== id);
}

export function updateCard(
  cards: NoteCard[],
  id: string,
  patch: NoteCardPatch,
  now = Date.now(),
): NoteCard[] {
  const index = cards.findIndex((c) => c.id === id);
  if (index === -1) return cards;
  const current = cards[index];
  // Spread the partial onto the concrete card. Fields absent on this kind are
  // simply ignored by consumers; the tagged `kind` is never overwritten.
  const next = {
    ...current,
    ...patch,
    kind: current.kind,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: Math.max(now, current.updatedAt + 1),
  } as NoteCard;
  const out = cards.slice();
  out[index] = next;
  return out;
}

export function moveCard(
  cards: NoteCard[],
  id: string,
  toIndex: number,
): NoteCard[] {
  const from = cards.findIndex((c) => c.id === id);
  if (from === -1) return cards;
  const clamped = Math.min(Math.max(toIndex, 0), cards.length - 1);
  if (clamped === from) return cards;
  const out = cards.slice();
  const [card] = out.splice(from, 1);
  out.splice(clamped, 0, card);
  return out;
}
