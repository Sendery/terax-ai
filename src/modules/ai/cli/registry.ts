import type { ParserFactory } from "./parsers/emitter";
import { createClaudeParser } from "./parsers/claude";
import { createCodexParser } from "./parsers/codex";
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
  /** Plan one turn (binary first in argv); cwd is passed out-of-band. */
  planRun: (ctx: CliRunContext) => CliRunPlan;
  createParser: ParserFactory;
};

type BuildArgv = (
  prompt: string,
  opts: { model?: string; permission: CliPermissionMode },
) => string[];

/** CLIs without their own session handling get the flattened transcript as a
 *  single argument, every turn. */
function transcriptRun(buildArgv: BuildArgv): CliAgentDef["planRun"] {
  return (ctx) => ({
    argv: buildArgv(messagesToPrompt(ctx.messages), {
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

const CODEX_SANDBOX: Record<CliPermissionMode, string> = {
  default: "read-only",
  acceptEdits: "workspace-write",
  full: "danger-full-access",
};

export const CLI_AGENTS: Record<CliAgentId, CliAgentDef> = {
  claude: {
    id: "claude",
    label: "Claude Code",
    bin: "claude",
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
    bin: "codex",
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
    bin: "cursor-agent",
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
    bin: "opencode",
    docsUrl: "https://opencode.ai/docs",
    planRun: transcriptRun((prompt, { model }) => {
      const a = ["opencode", "run", "--format", "json"];
      if (model) a.push("-m", model);
      a.push(prompt);
      return a;
    }),
    createParser: createOpenCodeParser,
  },
  pi: {
    id: "pi",
    label: "Pi",
    bin: "pi",
    docsUrl: "https://pi.dev",
    planRun: planPiRun,
    createParser: createPiParser,
  },
};

export const CLI_AGENT_IDS = Object.keys(CLI_AGENTS) as CliAgentId[];
export const CLI_AGENT_BINS = CLI_AGENT_IDS.map((id) => CLI_AGENTS[id].bin);
