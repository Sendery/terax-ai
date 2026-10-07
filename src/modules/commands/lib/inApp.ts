import type { CommandResult } from "./registry";

type CommandCaller = {
  call: (request: { id: string; payload?: unknown }) => Promise<CommandResult>;
};

let current: CommandCaller | null = null;

/** Publish the window's live registry for in-process callers (the built-in
 *  AI agent), the same one the Pi bridge dispatches into. */
export function setInAppCommandRegistry(registry: CommandCaller | null): void {
  current = registry;
}

export async function callAppCommand(
  id: string,
  payload?: unknown,
): Promise<CommandResult> {
  if (!current) {
    return {
      ok: false,
      error: { code: "internal_error", message: "Command registry is not ready" },
    };
  }
  return current.call({ id, payload });
}
