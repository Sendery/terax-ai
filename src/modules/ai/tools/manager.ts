import { native } from "@/modules/ai/lib/native";
import {
  MANAGER_CONFIG_PATH,
  parseManagerConfig,
  STARTER_MANAGER_ACTIONS,
} from "@/modules/ai/lib/piTeraxManager";
import { checkReadableCanonical } from "@/modules/ai/lib/security";
import { resolvePath, type ToolContext } from "@/modules/ai/tools/context";
import { tool } from "ai";
import { z } from "zod";

export function buildManagerTools(ctx: ToolContext) {
  return {
    terax_manager_actions: tool({
      description:
        "Discover the Pi-Terax manager's custom interface actions in .terax/pi-terax-commands.json under the active workspace. Returns validated data and useful starter actions; never executes them. Fill placeholders using the user's request and a current app snapshot, then invoke the normal terax_app_command tool, preserving its validation and approvals.",
      inputSchema: z.object({}),
      execute: async () => {
        const root = ctx.getWorkspaceRoot() ?? ctx.getCwd();
        const base = {
          relativePath: MANAGER_CONFIG_PATH,
          starterConfig: STARTER_MANAGER_ACTIONS,
        };
        if (!root)
          return { ...base, configured: null, error: "No active workspace" };
        const configPath = resolvePath(MANAGER_CONFIG_PATH, root);
        try {
          const safety = await checkReadableCanonical(
            configPath,
            native.canonicalize,
          );
          if (!safety.ok)
            return {
              ...base,
              configPath,
              configured: null,
              error: safety.reason,
            };
          const result = await native.readFile(safety.canonical);
          if (result.kind !== "text")
            return {
              ...base,
              configPath,
              configured: null,
              error: "Manager configuration must be a UTF-8 JSON file",
            };
          return {
            ...base,
            configPath,
            configured: parseManagerConfig(result.content),
          };
        } catch (error) {
          return {
            ...base,
            configPath,
            configured: null,
            error:
              error instanceof Error
                ? error.message
                : "Could not load custom actions; use starterConfig",
          };
        }
      },
    }),
  };
}
