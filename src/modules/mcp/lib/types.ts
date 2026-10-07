/** Mirrors Rust `mcp::config` (serde camelCase / kebab-case). */
type McpTargetState =
  | "not-installed"
  | "missing"
  | "current"
  | "stale"
  | "unreadable";

export type McpTargetStatus = {
  id: "claude" | "codex" | "cursor" | "opencode";
  label: string;
  state: McpTargetState;
  location?: string;
  detail?: string;
};

export type McpStatus = {
  command: string;
  args: string[];
  targets: McpTargetStatus[];
};
