import type { CommandResult } from "./lib/registry";

export type ExternalCommandEvent = {
  requestId: string;
  command: string;
  payload?: unknown;
};

type CommandCaller = {
  call: (request: { id: string; payload?: unknown }) => Promise<CommandResult>;
};

export type ExternalCommandResponder = (
  requestId: string,
  result: CommandResult,
) => Promise<void>;

export type ExternalCommandDispatcher = {
  setRegistry: (registry: CommandCaller) => void;
  handle: (event: ExternalCommandEvent) => Promise<void>;
};

function internalError(message: string): CommandResult {
  return { ok: false, error: { code: "internal_error", message } };
}

/**
 * Owns the live registry behind a stable identity.
 *
 * App rebuilds its handler object whenever tabs, panels or the active space
 * change, so a dispatcher bound to that identity would have to resubscribe on
 * every mutation. Tauri's `listen` registers asynchronously, so any request
 * arriving inside that gap is dropped and the caller waits out its timeout.
 * Swapping the registry through this setter keeps the subscription itself
 * untouched for the lifetime of the window.
 */
export function createExternalCommandDispatcher(
  respond: ExternalCommandResponder,
): ExternalCommandDispatcher {
  let registry: CommandCaller | null = null;

  return {
    setRegistry(next) {
      registry = next;
    },
    async handle({ requestId, command, payload }) {
      const current = registry;
      if (!current) {
        await respond(requestId, internalError("Command bridge is not ready"));
        return;
      }
      try {
        await respond(requestId, await current.call({ id: command, payload }));
      } catch (error) {
        await respond(
          requestId,
          internalError(
            error instanceof Error ? error.message : "Command bridge failed",
          ),
        );
      }
    },
  };
}
