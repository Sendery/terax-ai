import { useCallback, useEffect, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

export const TASKS_DEFAULT_WIDTH = 340;
export const TASKS_MIN_WIDTH = 280;
export const TASKS_MAX_WIDTH = 560;

const WIDTH_KEY = "terax.tasks.width";
const VISIBLE_KEY = "terax.tasks.visible";

function clampWidth(width: number): number {
  return Math.min(TASKS_MAX_WIDTH, Math.max(TASKS_MIN_WIDTH, Math.round(width)));
}

function readWidth(): number {
  try {
    const stored = window.localStorage.getItem(WIDTH_KEY);
    const parsed = stored ? Number.parseInt(stored, 10) : NaN;
    return Number.isFinite(parsed) ? clampWidth(parsed) : TASKS_DEFAULT_WIDTH;
  } catch {
    return TASKS_DEFAULT_WIDTH;
  }
}

function readVisible(): boolean {
  try {
    // Unlike notes, the scheduler panel stays closed until asked for: it costs
    // nothing when unused and would otherwise crowd the workspace on first run.
    return window.localStorage.getItem(VISIBLE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Controls the scheduled tasks panel: collapse/expand, width persistence, and
 *  a persisted visibility flag mirrored for the toggle button's aria state. */
export function useTasksPanel() {
  const tasksRef = useRef<PanelImperativeHandle | null>(null);
  const widthRef = useRef(readWidth());
  const writeTimerRef = useRef(0);
  const [visible, setVisibleState] = useState<boolean>(readVisible);

  const persistVisible = useCallback((next: boolean) => {
    setVisibleState(next);
    try {
      window.localStorage.setItem(VISIBLE_KEY, next ? "1" : "0");
    } catch {
      // private mode: visibility just will not persist
    }
  }, []);

  // Visibility mounts and unmounts the panel rather than collapsing it. Two
  // collapsed siblings cannot both stay at zero: the layout solver still has to
  // fill the group, and it re-expands one of them past its own maxSize.
  const showTasks = useCallback(() => persistVisible(true), [persistVisible]);

  const hideTasks = useCallback(() => persistVisible(false), [persistVisible]);

  const toggleTasks = useCallback(
    () => persistVisible(!visible),
    [persistVisible, visible],
  );

  const persistTasksWidth = useCallback((next: number) => {
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
    tasksRef,
    widthRef,
    tasksVisible: visible,
    showTasks,
    hideTasks,
    toggleTasks,
    persistTasksWidth,
  };
}
