import { useCallback, useEffect, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

export const GRAPH_DEFAULT_WIDTH = 360;
export const GRAPH_MIN_WIDTH = 300;
export const GRAPH_MAX_WIDTH = 620;

const WIDTH_KEY = "terax.sessionGraph.width";
const VISIBLE_KEY = "terax.sessionGraph.visible";

function clampWidth(width: number): number {
  return Math.min(GRAPH_MAX_WIDTH, Math.max(GRAPH_MIN_WIDTH, Math.round(width)));
}

function readWidth(): number {
  try {
    const stored = window.localStorage.getItem(WIDTH_KEY);
    const parsed = stored ? Number.parseInt(stored, 10) : NaN;
    return Number.isFinite(parsed) ? clampWidth(parsed) : GRAPH_DEFAULT_WIDTH;
  } catch {
    return GRAPH_DEFAULT_WIDTH;
  }
}

function readVisible(): boolean {
  try {
    // Closed until asked for, like the scheduler panel: it would otherwise
    // crowd the workspace on first run.
    return window.localStorage.getItem(VISIBLE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Controls the session-graph panel: visibility and width persistence. */
export function useSessionGraphPanel() {
  const graphRef = useRef<PanelImperativeHandle | null>(null);
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

  // Visibility mounts and unmounts the panel rather than collapsing it: two
  // collapsed siblings cannot both stay at zero, the layout solver re-expands
  // one past its own maxSize.
  const showGraph = useCallback(() => persistVisible(true), [persistVisible]);
  const hideGraph = useCallback(() => persistVisible(false), [persistVisible]);
  const toggleGraph = useCallback(
    () => persistVisible(!visible),
    [persistVisible, visible],
  );

  const persistGraphWidth = useCallback((next: number) => {
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
    graphRef,
    widthRef,
    graphVisible: visible,
    showGraph,
    hideGraph,
    toggleGraph,
    persistGraphWidth,
  };
}
