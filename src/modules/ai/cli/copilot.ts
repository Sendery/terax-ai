import { TERAX_MCP_SERVER, teraxToolsFor } from "./teraxMcp";
import type { CliPermissionMode } from "./types";

/**
 * Permission flags for one headless Copilot turn. Copilot cannot ask in
 * non-interactive mode, so anything not allowed here is denied: read-only is
 * plan mode plus Terax's read-only tool; accepting edits allows file writes
 * and every Terax tool that cannot execute shell input (Copilot still runs
 * the shell commands it recognises as read-only); full allows everything.
 */
export function copilotPermissionArgs(
  permission: CliPermissionMode,
  withTerax: boolean,
): string[] {
  if (permission === "full") return ["--allow-all"];
  const args = permission === "default" ? ["--mode", "plan"] : ["--allow-tool=write"];
  if (withTerax) {
    for (const tool of teraxToolsFor(permission)) {
      args.push(`--allow-tool=${TERAX_MCP_SERVER}(${tool})`);
    }
  }
  return args;
}

/**
 * The Terax server for this turn only, through `--additional-mcp-config`, so
 * Copilot reaches the window that asked without Terax editing
 * ~/.copilot/mcp-config.json. `discovery` pins the server to this instance.
 */
export function copilotMcpConfig(command: string, discovery?: string | null): string {
  return JSON.stringify({
    mcpServers: {
      [TERAX_MCP_SERVER]: {
        type: "local",
        command,
        args: ["--mcp"],
        tools: ["*"],
        ...(discovery ? { env: { TERAX_PI_DISCOVERY: discovery } } : {}),
      },
    },
  });
}
