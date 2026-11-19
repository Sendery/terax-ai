import { MCP_GROUPS } from "@/modules/commands/lib/mcpSurface";
import { SHELL_COMMAND_IDS } from "@/modules/commands/lib/policy";
import type { CliPermissionMode } from "./types";

/** Name the Terax server is registered under in every CLI. */
export const TERAX_MCP_SERVER = "terax";

/**
 * Terax MCP tools a headless CLI turn may call without a prompt it cannot
 * show. Derived from the MCP surface so a new group is classified by the same
 * rules as everywhere else: read-only tools in the read-only posture, and
 * every tool that cannot execute shell input when edits are accepted. Full
 * access skips permissions altogether, so it needs no list.
 */
export function teraxToolsFor(permission: CliPermissionMode): string[] {
  if (permission === "full") return [];
  const shell = new Set<string>(SHELL_COMMAND_IDS);
  return MCP_GROUPS.filter((group) => {
    if (permission === "default") return group.annotations.readOnlyHint;
    return !Object.values(group.actions).some(
      (action) => "command" in action && shell.has(action.command),
    );
  }).map((group) => group.name);
}
