import type { CliAgentId } from "./types";

/** Shared by detection and runners, without loading parsers at startup. */
export const CLI_BINARIES: Record<CliAgentId, string> = {
  claude: "claude",
  codex: "codex",
  cursor: "cursor-agent",
  opencode: "opencode",
  pi: "pi",
  agy: "agy",
};
