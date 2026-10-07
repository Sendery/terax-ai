import { tool } from "ai";
import { z } from "zod";
import { callAppCommand, COMMAND_IDS, type CommandId } from "@/modules/commands";

/**
 * Commands that act beyond the visible UI: they schedule or run agent
 * prompts, download or install software, or delete user data. Everything
 * else only moves, opens or reads app surfaces and runs without a prompt,
 * the same contract Pi gets through the bridge.
 */
const NEEDS_APPROVAL: ReadonlySet<CommandId> = new Set<CommandId>([
  "tasks.add",
  "tasks.update",
  "tasks.clone",
  "tasks.reseed",
  "tasks.remove",
  "tasks.run",
  "tasks.setEnabled",
  "tasks.pauseAll",
  "tasks.resumeAll",
  "tasks.wake",
  "tts.install",
  "tts.download",
  "notes.remove",
  "tab.close",
]);

export function appCommandNeedsApproval(command: string): boolean {
  return NEEDS_APPROVAL.has(command as CommandId);
}

async function run(command: string, payload?: unknown) {
  const result = await callAppCommand(command, payload);
  return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error };
}

export function buildAppTools() {
  return {
    terax_app_state: tool({
      description:
        "Read a redacted snapshot of the Terax window: the active space and tab, every tab (id, kind, title, cwd), the sidebar, scheduled tasks and speech status. Terminal text and private terminal details are never included.",
      inputSchema: z.object({}),
      execute: async () => run("app.snapshot"),
    }),

    terax_app_command: tool({
      description:
        "Run a Terax app command: focus, rename, colour, move or close tabs; open files, previews, Mermaid diagrams, git diffs and history; show or hide the sidebar, notes, tasks, session history and agent monitor; manage notes and scheduled tasks; open settings; search content; speak through local TTS; capture a surface as PNG. Call it with command app.commands first to read every command's arguments, types and enum values. Commands that schedule or run agents, install software or delete data ask the user first.",
      inputSchema: z.object({
        command: z.enum(COMMAND_IDS),
        payload: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            "Command arguments as an object; app.commands lists the fields per command.",
          ),
      }),
      needsApproval: ({ command }) => appCommandNeedsApproval(command),
      execute: async ({ command, payload }) => run(command, payload),
    }),
  } as const;
}
