export const AGENT_MONITOR_DEFAULT_WIDTH = 340;
export const AGENT_MONITOR_MIN_WIDTH = 280;
export const AGENT_MONITOR_MAX_WIDTH = 560;

export function clampAgentMonitorWidth(width: number): number {
  return Math.min(
    AGENT_MONITOR_MAX_WIDTH,
    Math.max(AGENT_MONITOR_MIN_WIDTH, Math.round(width)),
  );
}

export function agentMonitorVisibleFromStoredValue(value: string | null): boolean {
  return value === "1";
}
