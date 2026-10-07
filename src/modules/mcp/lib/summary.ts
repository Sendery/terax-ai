import type { McpStatus, McpTargetStatus } from "./types";

/** configured: every installed CLI points at this Terax. partial: some do.
 *  missing: none do. unavailable: no supported CLI is installed. */
export type McpTone = "configured" | "partial" | "missing" | "unavailable";

export type McpSummary = {
  tone: McpTone;
  detected: McpTargetStatus[];
  pending: McpTargetStatus[];
};

export function summarizeMcp(status: McpStatus): McpSummary {
  const detected = status.targets.filter((t) => t.state !== "not-installed");
  const pending = detected.filter((t) => t.state !== "current");
  const tone: McpTone =
    detected.length === 0
      ? "unavailable"
      : pending.length === 0
        ? "configured"
        : pending.length === detected.length
          ? "missing"
          : "partial";
  return { tone, detected, pending };
}

const STATE_TEXT: Record<McpTargetStatus["state"], string> = {
  "not-installed": "not installed",
  missing: "not configured",
  current: "configured",
  stale: "points at another Terax",
  unreadable: "config not readable",
};

/** Multi-line hover text: what the button will do, then one line per CLI. */
export function describeMcp(status: McpStatus | null, summary: McpSummary | null): string {
  if (!status || !summary) return "Pi-Terax MCP: checking agent CLIs...";
  const head =
    summary.tone === "configured"
      ? "Pi-Terax MCP is configured for every installed agent CLI."
      : summary.tone === "unavailable"
        ? "Pi-Terax MCP: no supported agent CLI (Claude Code, Codex, Cursor, OpenCode) found."
        : "Pi-Terax MCP: click to register Terax with the agent CLIs below.";
  const lines = status.targets.map((t) => {
    const detail = t.detail ? ` (${t.detail})` : "";
    return `${t.label}: ${STATE_TEXT[t.state]}${detail}`;
  });
  return [head, ...lines].join("\n");
}
