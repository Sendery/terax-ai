/**
 * Pure helpers for the note edit form: which fields a card exposes for editing,
 * initial draft values, and building a minimal sanitized patch from a draft.
 * No React, no IO. The tagged `kind` and the backing `url` provider are never
 * changed by an edit; editing a link only updates its title and annotation.
 */
import type { NoteCard } from "./cards";
import type { NoteCardPatch } from "./collection";

export type EditableField = "title" | "body" | "note";

export type EditDraft = {
  title: string;
  body: string;
  note: string;
};

/** Ordered editable fields for a card kind. Text cards edit their title and
 *  body; link-backed cards edit their title and a free-form annotation. */
export function editableFields(card: NoteCard): EditableField[] {
  if (card.kind === "text") return ["title", "body"];
  return ["title", "note"];
}

/** Seed a draft from the card's current values. */
export function draftFromCard(card: NoteCard): EditDraft {
  return {
    title: card.title ?? "",
    body: card.kind === "text" ? card.body : "",
    note: "note" in card && card.note ? card.note : "",
  };
}

/**
 * Build a minimal patch containing only fields that apply to the card and
 * actually changed. A text card's body is never blanked (an empty draft body
 * keeps the original); title and annotation may be cleared. Returns an empty
 * patch when nothing valid changed.
 */
export function buildEditPatch(card: NoteCard, draft: EditDraft): NoteCardPatch {
  const patch: NoteCardPatch = {};
  const fields = editableFields(card);

  if (fields.includes("title")) {
    const current = (card.title ?? "").trim();
    const next = draft.title.trim();
    if (next !== current) patch.title = next;
  }

  if (fields.includes("body") && card.kind === "text") {
    const next = draft.body.trim();
    if (next && next !== card.body) patch.body = next;
  }

  if (fields.includes("note")) {
    const current = ("note" in card && card.note ? card.note : "").trim();
    const next = draft.note.trim();
    if (next !== current) patch.note = next;
  }

  return patch;
}

/** Whether a draft carries any effective change for the card. */
export function hasEdit(card: NoteCard, draft: EditDraft): boolean {
  return Object.keys(buildEditPatch(card, draft)).length > 0;
}
