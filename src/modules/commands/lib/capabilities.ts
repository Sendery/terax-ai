import { MCP_GROUPS } from "./mcpSurface";
import { COMMAND_POLICY } from "./policy";
import { COMMAND_IDS, type CommandId } from "./registry";

/** The part of a command id before the first dot: the area it belongs to. */
export function commandNamespace(id: string): string {
  return id.slice(0, id.indexOf("."));
}

export function commandNamespaces(): string[] {
  return [...new Set(COMMAND_IDS.map(commandNamespace))];
}

/**
 * One line per capability area with the commands behind it, generated from
 * the same grouping the MCP server publishes. Agent-facing descriptions are
 * built from this, so a new command shows up in them without anyone editing
 * prose. Commands that ask the user first are marked with an asterisk.
 */
export function describeCapabilities(): string {
  return MCP_GROUPS.map((group) => {
    const ids = Object.values(group.actions).flatMap((action) =>
      "command" in action ? [action.command] : [],
    );
    const list = ids
      .map((id: CommandId) => (COMMAND_POLICY[id] === "approve" ? `${id}*` : id))
      .join(", ");
    return `- ${group.title}: ${list}`;
  }).join("\n");
}
