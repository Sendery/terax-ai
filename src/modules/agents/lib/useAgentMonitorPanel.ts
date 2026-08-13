import { useCallback, useEffect, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import {
  AGENT_MONITOR_DEFAULT_WIDTH,
  agentMonitorVisibleFromStoredValue,
  clampAgentMonitorWidth,
} from "@/modules/agents/lib/monitorPanelState";

const WIDTH_KEY = "terax.agent-monitor.width";
const VISIBLE_KEY = "terax.agent-monitor.visible";

function readWidth(): number {
  try {
    const stored = window.localStorage.getItem(WIDTH_KEY);
    const parsed = stored ? Number.parseInt(stored, 10) : Number.NaN;
    return Number.isFinite(parsed)
      ? clampAgentMonitorWidth(parsed)
      : AGENT_MONITOR_DEFAULT_WIDTH;
  } catch {
    return AGENT_MONITOR_DEFAULT_WIDTH;
  }
}

function readVisible(): boolean {
  try {
    return agentMonitorVisibleFromStoredValue(
      window.localStorage.getItem(VISIBLE_KEY),
    );
  } catch {
    return false;
  }
}

export function useAgentMonitorPanel() {
  const agentMonitorRef = useRef<PanelImperativeHandle | null>(null);
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

  const showAgentMonitor = useCallback(
    () => persistVisible(true),
    [persistVisible],
  );
  const hideAgentMonitor = useCallback(
    () => persistVisible(false),
    [persistVisible],
  );
  const toggleAgentMonitor = useCallback(
    () => persistVisible(!visible),
    [persistVisible, visible],
  );

  const persistAgentMonitorWidth = useCallback((next: number) => {
    widthRef.current = clampAgentMonitorWidth(next);
    if (writeTimerRef.current) window.clearTimeout(writeTimerRef.current);
    writeTimerRef.current = window.setTimeout(() => {
      writeTimerRef.current = 0;
      try {
        window.localStorage.setItem(WIDTH_KEY, String(widthRef.current));
      } catch {
        // private mode: width just will not persist
      }
    }, 200);
  }, []);

  useEffect(() => {
    return () => {
      if (writeTimerRef.current) window.clearTimeout(writeTimerRef.current);
    };
  }, []);

  return {
    agentMonitorRef,
    widthRef,
    agentMonitorVisible: visible,
    showAgentMonitor,
    hideAgentMonitor,
    toggleAgentMonitor,
    persistAgentMonitorWidth,
  };
}
