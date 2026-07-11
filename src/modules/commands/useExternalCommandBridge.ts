import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo } from "react";
import {
  createCommandRegistry,
  type CommandHandlers,
  type CommandResult,
} from "./lib/registry";

const EXTERNAL_COMMAND_EVENT = "terax:external-command";

type ExternalCommandEvent = {
  requestId: string;
  command: string;
  payload?: unknown;
};

async function respond(
  requestId: string,
  result: CommandResult,
): Promise<void> {
  await invoke("external_command_respond", { requestId, result });
}

export function useExternalCommandBridge(handlers: CommandHandlers): void {
  const registry = useMemo(() => createCommandRegistry(handlers), [handlers]);

  useEffect(() => {
    let disposed = false;
    const unsub = listen<ExternalCommandEvent>(EXTERNAL_COMMAND_EVENT, (event) => {
      if (disposed) return;
      const { requestId, command, payload } = event.payload;
      void registry
        .call({ id: command, payload })
        .then((result) => respond(requestId, result))
        .catch((error: unknown) =>
          respond(requestId, {
            ok: false,
            error: {
              code: "internal_error",
              message:
                error instanceof Error ? error.message : "Command bridge failed",
            },
          }),
        );
    });

    return () => {
      disposed = true;
      void unsub.then((fn) => fn());
    };
  }, [registry]);
}
