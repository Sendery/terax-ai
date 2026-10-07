import { describe, expect, it } from "vitest";
import { describeMcp, summarizeMcp } from "./summary";
import type { McpStatus, McpTargetStatus } from "./types";

function status(...states: McpTargetStatus["state"][]): McpStatus {
  const ids = ["claude", "codex", "cursor", "opencode"] as const;
  return {
    command: "/Applications/Terax.app/Contents/MacOS/terax",
    args: ["--mcp"],
    targets: states.map((state, i) => ({ id: ids[i], label: ids[i], state })),
  };
}

describe("summarizeMcp", () => {
  it("is configured only when every installed CLI points at this Terax", () => {
    expect(summarizeMcp(status("current", "current", "not-installed")).tone).toBe("configured");
  });

  it("is partial when some installed CLIs still need it", () => {
    const s = summarizeMcp(status("current", "stale", "not-installed"));
    expect(s.tone).toBe("partial");
    expect(s.pending.map((t) => t.id)).toEqual(["codex"]);
  });

  it("is missing when no installed CLI has it", () => {
    expect(summarizeMcp(status("missing", "unreadable")).tone).toBe("missing");
  });

  it("is unavailable when no supported CLI is installed", () => {
    expect(summarizeMcp(status("not-installed", "not-installed")).tone).toBe("unavailable");
  });
});

describe("describeMcp", () => {
  it("lists each CLI with its state and detail", () => {
    const s = status("current", "stale");
    s.targets[1].detail = "Points at /old/terax";
    const text = describeMcp(s, summarizeMcp(s));
    expect(text.split("\n")).toEqual([
      "Pi-Terax MCP: click to register Terax with the agent CLIs below.",
      "claude: configured",
      "codex: points at another Terax (Points at /old/terax)",
    ]);
  });

  it("says it is checking before the first read", () => {
    expect(describeMcp(null, null)).toContain("checking");
  });
});
