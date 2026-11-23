import type { AgentHarness, AgentIntegration } from "./types";

export type HarnessIntegration = {
  harness: AgentHarness;
  integration: AgentIntegration;
  authority: "Pi extension" | "Native hook" | "PTY detection";
  lifecycle: "native" | "detected";
};

export function integrationForAgent(agent: string): HarnessIntegration {
  switch (agent.toLowerCase()) {
    case "pi":
      return {
        harness: "pi",
        integration: "pi-extension",
        authority: "Pi extension",
        lifecycle: "native",
      };
    case "claude":
      return {
        harness: "claude",
        integration: "claude-hook",
        authority: "Native hook",
        lifecycle: "native",
      };
    case "codex":
      return {
        harness: "codex",
        integration: "pty-detection",
        authority: "PTY detection",
        lifecycle: "detected",
      };
    // Known by the command that started them. Whatever they report arrives as
    // a terminal notification, never through a hook Terax installed.
    case "copilot":
    case "agy":
    case "grok":
      return {
        harness: agent.toLowerCase() as "copilot" | "agy" | "grok",
        integration: "pty-detection",
        authority: "PTY detection",
        lifecycle: "detected",
      };
    default:
      return {
        harness: "generic",
        integration: "pty-detection",
        authority: "PTY detection",
        lifecycle: "detected",
      };
  }
}
