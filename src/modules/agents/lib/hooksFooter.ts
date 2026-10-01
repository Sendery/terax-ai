export type ClaudeHooksFooter = {
  kind: "ready" | "installing" | "offer";
  /** Only true once an install attempt failed, never merely because none ran. */
  error: boolean;
};

/**
 * What the bell shows about the Claude Code hooks.
 *
 * `installed` and "the install failed" are different facts. Reading a false
 * status as a failure meant a fresh profile opened the panel to a red error
 * about a config it had never tried to write.
 */
export function claudeHooksFooter({
  installed,
  installing,
  failed,
}: {
  installed: boolean | null;
  installing: boolean;
  failed: boolean;
}): ClaudeHooksFooter {
  if (installing) return { kind: "installing", error: false };
  if (installed === true) return { kind: "ready", error: false };
  return { kind: "offer", error: failed };
}
