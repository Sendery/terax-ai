import { LazyStore } from "@tauri-apps/plugin-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createMark,
  type MarkColor,
  marksForSession,
  parseStoredMarks,
  removeMark,
  renameMark,
  type SessionMark,
  upsertMark,
} from "./marks";

export const MARKS_STORE_PATH = "terax-session-marks.json";
const KEY_MARKS = "marks";

/**
 * Key points the user recorded, persisted workspace-wide.
 *
 * Marks are keyed by session and entry, so they survive reloads and stay
 * attached when a transcript grows. Writes are debounced because renaming from
 * an input fires per keystroke.
 */
export function useSessionMarks(sessionId: string | null) {
  const [marks, setMarks] = useState<SessionMark[]>([]);
  const storeRef = useRef<LazyStore | null>(null);
  const writeTimerRef = useRef(0);

  // Created lazily and kept for the lifetime of the hook, so the store is not
  // reopened on every render.
  const store = useCallback(() => {
    storeRef.current ??= new LazyStore(MARKS_STORE_PATH);
    return storeRef.current;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await store().get(KEY_MARKS);
        if (!cancelled) setMarks(parseStoredMarks(stored));
      } catch {
        // A missing or unreadable store simply means no marks yet.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store]);

  const persist = useCallback(
    (next: SessionMark[]) => {
      setMarks(next);
      if (writeTimerRef.current) window.clearTimeout(writeTimerRef.current);
      writeTimerRef.current = window.setTimeout(() => {
        writeTimerRef.current = 0;
        void store()
          .set(KEY_MARKS, next)
          .then(() => store().save())
          .catch(() => {
            // Losing a mark is preferable to breaking the panel.
          });
      }, 250);
    },
    [store],
  );

  useEffect(() => {
    return () => {
      if (writeTimerRef.current) window.clearTimeout(writeTimerRef.current);
    };
  }, []);

  const bySession = useMemo(
    () => (sessionId ? marksForSession(marks, sessionId) : new Map<string, SessionMark>()),
    [marks, sessionId],
  );

  const add = useCallback(
    (nodeId: string, label: string, color?: MarkColor) => {
      if (!sessionId) return;
      persist(upsertMark(marks, createMark({ sessionId, nodeId, label, color })));
    },
    [marks, persist, sessionId],
  );

  const rename = useCallback(
    (nodeId: string, label: string) => {
      if (!sessionId) return;
      persist(renameMark(marks, sessionId, nodeId, label));
    },
    [marks, persist, sessionId],
  );

  const remove = useCallback(
    (nodeId: string) => {
      if (!sessionId) return;
      persist(removeMark(marks, sessionId, nodeId));
    },
    [marks, persist, sessionId],
  );

  return { marks: bySession, add, rename, remove };
}
