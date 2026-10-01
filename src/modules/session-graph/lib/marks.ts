// User-recorded key points in a session.
//
// A mark pins one entry with a short label so it stays findable and is never
// collapsed by the zoom levels. Marks live on the Terax side rather than in the
// transcript: a running agent owns its session file and holds its leaf in
// memory, so appending a label entry behind it would corrupt its state. Pi's own
// `label` entries are still read and shown, they are simply not written here.

export const MARK_COLORS = ["amber", "green", "blue", "purple", "red"] as const;

export type MarkColor = (typeof MARK_COLORS)[number];

export type SessionMark = {
  sessionId: string;
  nodeId: string;
  label: string;
  color: MarkColor;
  /** When the mark was made, used to keep the last write on a duplicate. */
  at: number;
};

/** Long enough to be meaningful, short enough to render on one row. */
const MAX_LABEL = 60;

export function normalizeLabel(label: string): string {
  return label.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL);
}

export function markKey(sessionId: string, nodeId: string): string {
  // Node ids are only unique within a session.
  return `${sessionId}\u0000${nodeId}`;
}

export function createMark(
  input: { sessionId: string; nodeId: string; label: string; color?: MarkColor },
  now: number = Date.now(),
): SessionMark {
  return {
    sessionId: input.sessionId,
    nodeId: input.nodeId,
    label: normalizeLabel(input.label),
    color: input.color ?? MARK_COLORS[0],
    at: now,
  };
}

function isMarkColor(value: unknown): value is MarkColor {
  return typeof value === "string" && (MARK_COLORS as readonly string[]).includes(value);
}

export function isSessionMark(value: unknown): value is SessionMark {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const mark = value as Record<string, unknown>;
  return (
    typeof mark.sessionId === "string" &&
    mark.sessionId.length > 0 &&
    typeof mark.nodeId === "string" &&
    mark.nodeId.length > 0 &&
    typeof mark.label === "string" &&
    mark.label.length > 0 &&
    isMarkColor(mark.color) &&
    typeof mark.at === "number" &&
    Number.isFinite(mark.at)
  );
}

/**
 * Stored marks are untrusted. An invalid record is dropped so one bad entry
 * cannot take the panel down on boot, and a duplicate keeps the later write.
 */
export function parseStoredMarks(value: unknown): SessionMark[] {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, SessionMark>();
  for (const entry of value) {
    if (!isSessionMark(entry)) continue;
    const key = markKey(entry.sessionId, entry.nodeId);
    const existing = byKey.get(key);
    if (!existing || entry.at >= existing.at) byKey.set(key, entry);
  }
  return [...byKey.values()];
}

export function upsertMark(
  marks: readonly SessionMark[],
  mark: SessionMark,
): SessionMark[] {
  const key = markKey(mark.sessionId, mark.nodeId);
  const index = marks.findIndex((m) => markKey(m.sessionId, m.nodeId) === key);
  if (index === -1) return [...marks, mark];
  const next = marks.slice();
  next[index] = mark;
  return next;
}

export function removeMark(
  marks: readonly SessionMark[],
  sessionId: string,
  nodeId: string,
): SessionMark[] {
  const key = markKey(sessionId, nodeId);
  return marks.filter((m) => markKey(m.sessionId, m.nodeId) !== key);
}

/** Renaming to blank removes the mark: an empty label records nothing. */
export function renameMark(
  marks: readonly SessionMark[],
  sessionId: string,
  nodeId: string,
  label: string,
): SessionMark[] {
  const normalized = normalizeLabel(label);
  if (!normalized) return removeMark(marks, sessionId, nodeId);
  const key = markKey(sessionId, nodeId);
  return marks.map((mark) =>
    markKey(mark.sessionId, mark.nodeId) === key ? { ...mark, label: normalized } : mark,
  );
}

/** Marks of one session, keyed by node id for O(1) lookup while rendering. */
export function marksForSession(
  marks: readonly SessionMark[],
  sessionId: string,
): Map<string, SessionMark> {
  const map = new Map<string, SessionMark>();
  for (const mark of marks) {
    if (mark.sessionId === sessionId) map.set(mark.nodeId, mark);
  }
  return map;
}
