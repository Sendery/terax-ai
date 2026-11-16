import type { CliRunContext } from "@/modules/ai/cli/types";

export function cliInstructionBlocks(
  ctx: Pick<CliRunContext, "persona" | "customInstructions">,
): string[] {
  const blocks: string[] = [];
  const persona = ctx.persona?.instructions.trim();
  if (persona) blocks.push(`## Active agent: ${ctx.persona?.name}\n${persona}`);
  const custom = ctx.customInstructions?.trim();
  if (custom) blocks.push(`## User custom instructions\n${custom}`);
  return blocks;
}
