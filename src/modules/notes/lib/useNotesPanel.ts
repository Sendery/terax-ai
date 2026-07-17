import { useCallback, useEffect, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

export const NOTES_DEFAULT_WIDTH = 300;
export const NOTES_MIN_WIDTH = 240;
export const NOTES_MAX_WIDTH = 520;

const WIDTH_KEY = "terax.notes.width";
const VISIBLE_KEY = "terax.notes.visible";

function clampWidth(width: number): number {
  return Math.min(NOTES_MAX_WIDTH, Math.max(NOTES_MIN_WIDTH, Math.round(width)));
}

function readWidth(): number {
  try {
    const stored = window.localStorage.getItem(WIDTH_KEY);
    const parsed = stored ? Number.parseInt(stored, 10) : NaN;
    return Number.isFinite(parsed) ? clampWidth(parsed) : NOTES_DEFAULT_WIDTH;
  } catch {
    return NOTES_DEFAULT_WIDTH;
  }
}

function readVisible(): boolean {
  try {
    const stored = window.localStorage.getItem(VISIBLE_KEY);
    if (stored === "0") return false;
    if (stored === "1") return true;
    // First run: show the notes panel so the feature is discoverable. The user
    // can hide it and the choice is remembered.
    return true;
  } catch {
    return true;
  }
}

/** Controls the right-hand notes panel: collapse/expand, width persistence, and
 *  a persisted visibility flag mirrored for the toggle button's aria state. */
export function useNotesPanel() {
  const notesRef = useRef<PanelImperativeHandle | null>(null);
  const widthRef = useRef(readWidth());
  const writeTimerRef = useRef(0);
  const [visible, setVisibleState] = useState<boolean>(readVisible);

  const persistVisible = useCallback((next: boolean) => {
    setVisibleState(next);
    try {
      window.localStorage.setItem(VISIBLE_KEY, next ? "1" : "0");
    } catch {
      // private mode — visibility just won't persist
    }
  }, []);

  const showNotes = useCallback(() => {
    const panel = notesRef.current;
    if (panel && panel.getSize().asPercentage <= 0) {
      panel.resize(`${widthRef.current}px`);
    }
    persistVisible(true);
  }, [persistVisible]);

  const hideNotes = useCallback(() => {
    const panel = notesRef.current;
    if (panel && panel.getSize().asPercentage > 0) panel.collapse();
    persistVisible(false);
  }, [persistVisible]);

  const toggleNotes = useCallback(() => {
    const panel = notesRef.current;
    if (!panel) {
      persistVisible(!visible);
      return;
    }
    if (panel.getSize().asPercentage <= 0) {
      panel.resize(`${widthRef.current}px`);
      persistVisible(true);
    } else {
      panel.collapse();
      persistVisible(false);
    }
  }, [persistVisible, visible]);

  const persistNotesWidth = useCallback((next: number) => {
    widthRef.current = clampWidth(next);
    if (writeTimerRef.current) window.clearTimeout(writeTimerRef.current);
    writeTimerRef.current = window.setTimeout(() => {
      writeTimerRef.current = 0;
      try {
        window.localStorage.setItem(WIDTH_KEY, String(widthRef.current));
      } catch {
        // ignore
      }
    }, 200);
  }, []);

  useEffect(() => {
    return () => {
      if (writeTimerRef.current) window.clearTimeout(writeTimerRef.current);
    };
  }, []);

  return {
    notesRef,
    widthRef,
    notesVisible: visible,
    showNotes,
    hideNotes,
    toggleNotes,
    persistNotesWidth,
  };
}
