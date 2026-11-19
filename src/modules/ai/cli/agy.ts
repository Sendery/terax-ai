import { MCP_GROUPS } from "@/modules/commands/lib/mcpSurface";
import { SHELL_COMMAND_IDS } from "@/modules/commands/lib/policy";
import type { CliPermissionMode } from "./types";

/** The `permissions` block of Antigravity's settings: lists of rule strings. */
export type AgyPermissions = Record<string, string[]>;

const TERAX_MCP_SERVER = "terax";

/**
 * Terax MCP tools an agy chat turn may call without a prompt it cannot show.
 * Derived from the MCP surface so a new group is classified by the same
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

/**
 * The `--settings` JSON for one agy turn, or null to pass none.
 *
 * `agy --settings` replaces the permissions block instead of merging it, so
 * the user's own rules are copied in first and Terax's are appended. When
 * those rules could not be read, nothing is passed: the turn keeps the user's
 * rules and only loses headless access to Terax tools.
 */
export function agySessionSettings(
  user: AgyPermissions | null | undefined,
  permission: CliPermissionMode,
): string | null {
  const tools = teraxToolsFor(permission);
  if (!user || tools.length === 0) return null;
  const allow = [...(user.allow ?? [])];
  for (const tool of tools) {
    const rule = `mcp(${TERAX_MCP_SERVER}/${tool})`;
    if (!allow.includes(rule)) allow.push(rule);
  }
  return JSON.stringify({ permissions: { ...user, allow } });
}
