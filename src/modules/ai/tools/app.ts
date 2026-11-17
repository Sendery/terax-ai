import { tool } from "ai";
import { z } from "zod";
import {
  callAppCommand,
  COMMAND_IDS,
  commandNeedsApproval,
  describeCapabilities,
} from "@/modules/commands";

/** The approval decision lives with the registry (`commands/lib/policy.ts`),
 *  so every caller of a command applies the same one. */
export function appCommandNeedsApproval(
  command: string,
  payload?: unknown,
): boolean {
  return commandNeedsApproval(command, payload);
}

async function run(command: string, payload?: unknown) {
  const result = await callAppCommand(command, payload);
  return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error };
}

export function buildAppTools() {
  return {
    terax_app_state: tool({
      description:
        "Read a redacted snapshot of the Terax window: the active space and tab, every tab (id, kind, title, cwd), the sidebar, scheduled tasks and speech status. Terminal text is not part of it (use terminal.list and terminal.read); private terminal details are never included.",
      inputSchema: z.object({}),
      execute: async () => run("app.snapshot"),
    }),

    terax_app_command: tool({
      description: `Run a Terax app command. Everything the app can do for an agent is listed here by area:\n${describeCapabilities()}\nCall it with command app.commands first to read every command's arguments, types and enum values. Commands marked * run shell input, start agents, install software or delete data, and ask the user first. Private terminals are never available.`,
      inputSchema: z.object({
        command: z.enum(COMMAND_IDS),
        payload: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            "Command arguments as an object; app.commands lists the fields per command.",
          ),
      }),
      needsApproval: ({ command, payload }) =>
        appCommandNeedsApproval(command, payload),
      execute: async ({ command, payload }) => run(command, payload),
    }),
  } as const;
}
