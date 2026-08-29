export type VisualHistory<T> = {
  past: T[];
  present: T;
  future: T[];
};

const VISUAL_HISTORY_LIMIT = 50;

export function createVisualHistory<T>(present: T): VisualHistory<T> {
  return { past: [], present, future: [] };
}

export function resetVisualHistory<T>(present: T): VisualHistory<T> {
  return createVisualHistory(present);
}

export function commitVisualHistory<T>(
  history: VisualHistory<T>,
  next: T,
): VisualHistory<T> {
  return {
    past: [...history.past, history.present].slice(-VISUAL_HISTORY_LIMIT),
    present: next,
    future: [],
  };
}

export function undoVisualHistory<T>(
  history: VisualHistory<T>,
): VisualHistory<T> {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoVisualHistory<T>(
  history: VisualHistory<T>,
): VisualHistory<T> {
  const next = history.future[0];
  if (next === undefined) return history;
  return {
    past: [...history.past, history.present].slice(-VISUAL_HISTORY_LIMIT),
    present: next,
    future: history.future.slice(1),
  };
}

export function takeVisualHistoryStep<T>(
  history: VisualHistory<T>,
  direction: "undo" | "redo",
): VisualHistory<T> | null {
  const next =
    direction === "undo"
      ? undoVisualHistory(history)
      : redoVisualHistory(history);
  return next === history ? null : next;
}
