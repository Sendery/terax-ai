import { CLI_BINARIES } from "./binaries";
import { cliInstructionBlocks } from "@/modules/ai/cli/instructions";
import type { ParserFactory } from "./parsers/emitter";
import { createClaudeParser } from "./parsers/claude";
import { type AgyPermissions, agySessionSettings } from "./agy";
import { type McpServerLaunch, readAgyPermissions, readMcpServerLaunch } from "./bridge";
import { copilotMcpConfig, copilotPermissionArgs } from "./copilot";
import { createAgyParser } from "./parsers/agy";
import { createCodexParser } from "./parsers/codex";
import { createCopilotParser } from "./parsers/copilot";
import { createCursorParser } from "./parsers/cursor";
import { createOpenCodeParser } from "./parsers/opencode";
import { createPiParser } from "./parsers/pi";
import { planPiRun } from "./pi";
import { messagesToPrompt } from "./transcript";
import type {
  CliAgentId,
  CliPermissionMode,
  CliRunContext,
  CliRunPlan,
} from "./types";

export type CliAgentDef = {
  id: CliAgentId;
  label: string;
  /** Binary name resolved against the user's login PATH on the Rust side. */
  bin: string;
  /** Where to get/authenticate the CLI (shown when not installed). */
  docsUrl: string;
  /** Read host state the plan needs (settings files) before planning, so
   *  `planRun` itself stays pure. Its result arrives as `ctx.host`. */
  prepare?: () => Promise<unknown>;
  /** Plan one turn (binary first in argv); cwd is passed out-of-band. */
  planRun: (ctx: CliRunContext) => CliRunPlan;
  createParser: ParserFactory;
};

type BuildArgv = (
  prompt: string,
  opts: { model?: string; permission: CliPermissionMode },
) => string[];

/** The flattened transcript, preceded by the persona and custom instructions. */
function transcriptPrompt(ctx: CliRunContext): string {
  const instructions = cliInstructionBlocks(ctx);
  const transcript = messagesToPrompt(ctx.messages);
  return instructions.length
    ? [...instructions, `## Conversation\n${transcript}`].join("\n\n")
    : transcript;
}

/** CLIs without their own session handling get the flattened transcript as a
 *  single argument, every turn. */
function transcriptRun(buildArgv: BuildArgv): CliAgentDef["planRun"] {
  return (ctx) => ({
    argv: buildArgv(transcriptPrompt(ctx), {
      model: ctx.model,
      permission: ctx.permission,
    }),
  });
}

const CLAUDE_PERMISSION: Record<CliPermissionMode, string> = {
  default: "plan",
  acceptEdits: "acceptEdits",
  full: "bypassPermissions",
};

/** Antigravity cannot prompt headless: a tool outside the posture is denied. */
const AGY_PERMISSION: Record<CliPermissionMode, string[]> = {
  default: ["--mode", "plan"],
  acceptEdits: ["--mode", "accept-edits"],
  full: ["--dangerously-skip-permissions"],
};

/** Slash expansion stays on: agy implements `--mode plan` as one, and
 *  disabling it silently drops the read-only posture. */
function planAgyRun(ctx: CliRunContext): CliRunPlan {
  const argv = ["agy", "--output-format", "stream-json", ...AGY_PERMISSION[ctx.permission]];
  const settings = agySessionSettings(
    ctx.host as AgyPermissions | null | undefined,
    ctx.permission,
  );
  if (settings) argv.push("--settings", settings);
  if (ctx.model) argv.push("--model", ctx.model);
  // As `--print=<prompt>` a prompt that starts with "-" is never read as a flag.
  argv.push(`--print=${transcriptPrompt(ctx)}`);
  // The bridge pins `terax --mcp`, started by agy, to the window that asked.
  return { argv, bridge: true };
}

/** Copilot takes the Terax server per turn, so nothing is written to its
 *  config; without a known binary the turn simply runs without Terax. */
function planCopilotRun(ctx: CliRunContext): CliRunPlan {
  const launch = ctx.host as McpServerLaunch | null | undefined;
  const argv = ["copilot", "--output-format", "json", "--no-color", "--no-ask-user"];
  if (launch?.command) {
    argv.push(`--additional-mcp-config=${copilotMcpConfig(launch.command, launch.discovery)}`);
  }
  argv.push(...copilotPermissionArgs(ctx.permission, Boolean(launch?.command)));
  if (ctx.model) argv.push("--model", ctx.model);
  argv.push(`--prompt=${transcriptPrompt(ctx)}`);
  return { argv, bridge: true };
}

const CODEX_SANDBOX: Record<CliPermissionMode, string> = {
  default: "read-only",
  acceptEdits: "workspace-write",
  full: "danger-full-access",
};

export const CLI_AGENTS: Record<CliAgentId, CliAgentDef> = {
  claude: {
    id: "claude",
    label: "Claude Code",
    bin: CLI_BINARIES.claude,
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code",
    planRun: transcriptRun((prompt, { model, permission }) => {
      const a = [
        "claude",
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        "--verbose",
        "--permission-mode",
        CLAUDE_PERMISSION[permission],
      ];
      if (permission === "full") a.push("--dangerously-skip-permissions");
      if (model) a.push("--model", model);
      return a;
    }),
    createParser: createClaudeParser,
  },
  codex: {
    id: "codex",
    label: "Codex",
    bin: CLI_BINARIES.codex,
    docsUrl: "https://github.com/openai/codex",
    planRun: transcriptRun((prompt, { model, permission }) => {
      const a = ["codex", "exec", "--json", "--skip-git-repo-check", "-s", CODEX_SANDBOX[permission]];
      if (model) a.push("-m", model);
      a.push(prompt);
      return a;
    }),
    createParser: createCodexParser,
  },
  cursor: {
    id: "cursor",
    label: "Cursor Agent",
    bin: CLI_BINARIES.cursor,
    docsUrl: "https://docs.cursor.com/cli",
    planRun: transcriptRun((prompt, { model, permission }) => {
      const a = [
        "cursor-agent",
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--stream-partial-output",
      ];
      // Headless cannot answer trust/permission prompts; force-allow so the
      // agent can act. Plan mode stays read-only.
      a.push(permission === "default" ? "--plan" : "-f");
      if (model) a.push("--model", model);
      return a;
    }),
    createParser: createCursorParser,
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    bin: CLI_BINARIES.opencode,
    docsUrl: "https://opencode.ai/docs",
    planRun: transcriptRun((prompt, { model }) => {
      const a = ["opencode", "run", "--format", "json"];
      if (model) a.push("-m", model);
      a.push(prompt);
      return a;
    }),
    createParser: createOpenCodeParser,
  },
  agy: {
    id: "agy",
    label: "Antigravity",
    bin: CLI_BINARIES.agy,
    docsUrl: "https://antigravity.google",
    prepare: () => readAgyPermissions(),
    planRun: planAgyRun,
    createParser: createAgyParser,
  },
  copilot: {
    id: "copilot",
    label: "GitHub Copilot",
    bin: CLI_BINARIES.copilot,
    docsUrl: "https://docs.github.com/en/copilot/how-tos/copilot-cli",
    prepare: () => readMcpServerLaunch(),
    planRun: planCopilotRun,
    createParser: createCopilotParser,
  },
  pi: {
    id: "pi",
    label: "Pi",
    bin: CLI_BINARIES.pi,
    docsUrl: "https://pi.dev",
    planRun: planPiRun,
    createParser: createPiParser,
  },
};

export const CLI_AGENT_IDS = Object.keys(CLI_AGENTS) as CliAgentId[];
export const CLI_AGENT_BINS = CLI_AGENT_IDS.map((id) => CLI_AGENTS[id].bin);
