import { describe, expect, it } from "vitest";
import {
  AGENT_MONITOR_DEFAULT_WIDTH,
  AGENT_MONITOR_MAX_WIDTH,
  AGENT_MONITOR_MIN_WIDTH,
  agentMonitorVisibleFromStoredValue,
  clampAgentMonitorWidth,
} from "./monitorPanelState";

describe("agent monitor panel state", () => {
  it("keeps persisted widths within the usable panel range", () => {
    expect(clampAgentMonitorWidth(100)).toBe(AGENT_MONITOR_MIN_WIDTH);
    expect(clampAgentMonitorWidth(401.7)).toBe(402);
    expect(clampAgentMonitorWidth(900)).toBe(AGENT_MONITOR_MAX_WIDTH);
  });

  it("stays hidden until explicitly enabled and restores only its enabled value", () => {
    expect(agentMonitorVisibleFromStoredValue(null)).toBe(false);
    expect(agentMonitorVisibleFromStoredValue("0")).toBe(false);
    expect(agentMonitorVisibleFromStoredValue("1")).toBe(true);
    expect(agentMonitorVisibleFromStoredValue("true")).toBe(false);
    expect(AGENT_MONITOR_DEFAULT_WIDTH).toBeGreaterThanOrEqual(
      AGENT_MONITOR_MIN_WIDTH,
    );
  });
});
