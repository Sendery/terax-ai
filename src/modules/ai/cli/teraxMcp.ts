import { MCP_GROUPS } from "@/modules/commands/lib/mcpSurface";
import { COMMAND_POLICY } from "@/modules/commands/lib/policy";
import type { CommandId } from "@/modules/commands/lib/registry";
import type { CliPermissionMode } from "./types";

/** Name the Terax server is registered under in every CLI. */
export const TERAX_MCP_SERVER = "terax";

/**
 * Terax MCP tools a headless CLI turn may call without a prompt it cannot
 * show. Derived from the MCP surface and the command policy, so a new group
 * is classified by the same rules as everywhere else: read-only tools in the
 * read-only posture, and tools with no approval-gated action when edits are
 * accepted. Full access skips permissions altogether, so it needs no list.
 */
export function teraxToolsFor(permission: CliPermissionMode): string[] {
  if (permission === "full") return [];
  return MCP_GROUPS.filter((group) => {
    if (permission === "default") return group.annotations.readOnlyHint;
    // A tool is pre-approved only when every action it can take is one the
    // built-in agent would run without asking: scheduling a task starts an
    // agent with its own shell, closing a tab or removing a note loses work.
    return Object.values(group.actions).every(
      (action) => !("command" in action) || COMMAND_POLICY[action.command as CommandId] !== "approve",
    );
  }).map((group) => group.name);
}
