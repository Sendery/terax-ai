import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef } from "react";
import {
  createExternalCommandDispatcher,
  type ExternalCommandEvent,
} from "./externalCommandDispatcher";
import {
  createCommandRegistry,
  type CommandHandlers,
  type CommandResult,
} from "./lib/registry";

const EXTERNAL_COMMAND_EVENT = "terax:external-command";

async function respond(
  requestId: string,
  result: CommandResult,
): Promise<void> {
  await invoke("external_command_respond", { requestId, result });
}

export function useExternalCommandBridge(handlers: CommandHandlers): void {
  const registry = useMemo(() => createCommandRegistry(handlers), [handlers]);
  const dispatcherRef = useRef<ReturnType<
    typeof createExternalCommandDispatcher
  > | null>(null);
  if (!dispatcherRef.current) {
    dispatcherRef.current = createExternalCommandDispatcher(respond);
  }
  dispatcherRef.current.setRegistry(registry);

  useEffect(() => {
    let disposed = false;
    const unsub = listen<ExternalCommandEvent>(
      EXTERNAL_COMMAND_EVENT,
      (event) => {
        if (disposed) return;
        void dispatcherRef.current?.handle(event.payload);
      },
    );

    return () => {
      disposed = true;
      void unsub.then((fn) => fn());
    };
  }, []);
}
