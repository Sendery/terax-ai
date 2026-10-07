import { createUIMessageStream, type UIMessage } from "ai";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { allocateSpawnId, killCliAgent, runCliAgent } from "./bridge";
import { ChunkEmitter } from "./parsers/emitter";
import { CLI_AGENTS } from "./registry";
import type { CliAgentId, CliPermissionMode } from "./types";

export type RunCliAgentOptions = {
  cliId: CliAgentId;
  uiMessages: UIMessage[];
  cwd: string | null;
  model?: string;
  permission?: CliPermissionMode;
  chatSessionId?: string | null;
  persona?: { name: string; instructions: string } | null;
  customInstructions?: string;
  planMode?: boolean;
  abortSignal?: AbortSignal;
  onStep?: (step: string | null) => void;
};

/**
 * Drive a wrapped CLI agent and expose it as the same `{ toUIMessageStream }`
 * shape `runAgentStream` returns, so the chat transport is agnostic to whether
 * the turn was served by an API model or a local CLI. The CLI runs its own
 * tool loop end-to-end; we only relay its event stream into the chat UI.
 */
export function runCliAgentStream(opts: RunCliAgentOptions) {
  const def = CLI_AGENTS[opts.cliId];

  return {
    toUIMessageStream: (_o?: { originalMessages?: UIMessage[] }) =>
      createUIMessageStream({
        execute: async ({ writer }) => {
          const emitter = new ChunkEmitter(writer);
          const plan = def.planRun({
            messages: opts.uiMessages,
            cwd: opts.cwd,
            model: opts.model,
            permission:
              opts.permission ??
              usePreferencesStore.getState().cliAgentPermission,
            chatSessionId: opts.chatSessionId ?? null,
            persona: opts.persona ?? null,
            customInstructions: opts.customInstructions,
            planMode: opts.planMode,
            nonce: Date.now().toString(36),
          });
          if (plan.stdin !== undefined && plan.stdin.trim() === "") {
            emitter.error(`${def.label} needs a text message to work on.`);
            emitter.finish();
            return;
          }
          const parser = def.createParser(emitter, { metadata: plan.metadata });
          const id = allocateSpawnId();
          const onAbort = () => void killCliAgent(id);
          opts.abortSignal?.addEventListener("abort", onAbort, { once: true });
          opts.onStep?.(`Running ${def.label}`);
          let code: number | null = null;
          try {
            ({ code } = await runCliAgent(
              {
                id,
                argv: plan.argv,
                cwd: opts.cwd,
                stdin: plan.stdin,
                bridge: plan.bridge,
              },
              {
                onStdout: (line) => parser.onLine(line),
                onStderr: (line) => parser.onStderr?.(line),
              },
            ));
          } catch (e) {
            emitter.error(e instanceof Error ? e.message : String(e));
          } finally {
            opts.abortSignal?.removeEventListener("abort", onAbort);
            parser.onExit?.(opts.abortSignal?.aborted ? null : code);
            emitter.finish();
            opts.onStep?.(null);
          }
        },
        onError: (e) => (e instanceof Error ? e.message : String(e)),
      }),
  };
}
