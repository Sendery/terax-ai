/**
 * Typed event contract between the main window and the detachable native notes
 * window. Both directions are validated at the boundary: sync payloads are
 * checked with isNoteCard, and inbound actions are parsed into a closed set with
 * a sanitized patch (no arbitrary keys reach the domain).
 */
import {
  CI_STATES,
  isNoteCard,
  JIRA_STATUS_CATEGORIES,
  type NoteCard,
  PR_STATES,
} from "./cards";
import type { NoteCardPatch } from "./collection";

export const NOTES_WINDOW_LABEL = "notes";
/** main -> notes window: current tab + its notes. */
export const NOTES_SYNC_EVENT = "terax:notes-sync";
/** notes window -> main: a mutation request. */
export const NOTES_ACTION_EVENT = "terax:notes-action";
/** notes window -> main: window mounted, please send current state. */
export const NOTES_READY_EVENT = "terax:notes-window-ready";
/** notes window -> main: window is closing, re-attach the inline panel. */
export const NOTES_CLOSED_EVENT = "terax:notes-window-closed";

export type NotesSyncPayload = {
  tabId: number | null;
  tabTitle: string | null;
  notes: NoteCard[];
};

export type NotesAction =
  | { type: "add-input"; raw: string }
  | { type: "remove"; id: string }
  | { type: "update"; id: string; patch: NoteCardPatch }
  | { type: "move"; id: string; toIndex: number }
  | { type: "refresh"; id: string }
  | { type: "refresh-all" };

export function isNotesSyncPayload(v: unknown): v is NotesSyncPayload {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  const tabOk =
    r.tabId === null || (typeof r.tabId === "number" && Number.isFinite(r.tabId));
  const titleOk = r.tabTitle === null || typeof r.tabTitle === "string";
  if (!tabOk || !titleOk) return false;
  if (!Array.isArray(r.notes)) return false;
  return r.notes.every(isNoteCard);
}

function sanitizePatch(value: unknown): NoteCardPatch {
  const patch: NoteCardPatch = {};
  if (!value || typeof value !== "object") return patch;
  const r = value as Record<string, unknown>;
  if (typeof r.title === "string") patch.title = r.title;
  if (typeof r.note === "string") patch.note = r.note;
  if (typeof r.body === "string") patch.body = r.body;
  if (typeof r.url === "string") patch.url = r.url;
  if (typeof r.statusName === "string") patch.statusName = r.statusName;
  if (PR_STATES.includes(r.prState as never)) {
    patch.prState = r.prState as NoteCardPatch["prState"];
  }
  if (CI_STATES.includes(r.ciState as never)) {
    patch.ciState = r.ciState as NoteCardPatch["ciState"];
  }
  if (JIRA_STATUS_CATEGORIES.includes(r.status as never)) {
    patch.status = r.status as NoteCardPatch["status"];
  }
  return patch;
}

export function parseNotesAction(value: unknown): NotesAction | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  switch (r.type) {
    case "add-input":
      return typeof r.raw === "string" ? { type: "add-input", raw: r.raw } : null;
    case "remove":
      return typeof r.id === "string" && r.id
        ? { type: "remove", id: r.id }
        : null;
    case "update":
      return typeof r.id === "string" && r.id
        ? { type: "update", id: r.id, patch: sanitizePatch(r.patch) }
        : null;
    case "move":
      return typeof r.id === "string" &&
        r.id &&
        typeof r.toIndex === "number" &&
        Number.isFinite(r.toIndex)
        ? { type: "move", id: r.id, toIndex: r.toIndex }
        : null;
    case "refresh":
      return typeof r.id === "string" && r.id
        ? { type: "refresh", id: r.id }
        : null;
    case "refresh-all":
      return { type: "refresh-all" };
    default:
      return null;
  }
}
