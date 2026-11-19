import { TERAX_MCP_SERVER, teraxToolsFor } from "./teraxMcp";
import type { CliPermissionMode } from "./types";

/** The `permissions` block of Antigravity's settings: lists of rule strings. */
export type AgyPermissions = Record<string, string[]>;

export { teraxToolsFor };

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
