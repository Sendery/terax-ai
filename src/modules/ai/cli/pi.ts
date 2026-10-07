import type { UIMessage } from "ai";
import { messagesToPrompt, messageText } from "./transcript";
import type { CliPermissionMode, CliRunContext, CliRunPlan } from "./types";

/** Recorded on each assistant message Pi served, so the next turn can resume
 *  the same Pi session instead of replaying the whole transcript. */
export type PiTurnMeta = {
  sessionId: string;
  cwd: string | null;
  userTurns: number;
};

export type PiTurnPlan = {
  sessionId: string;
  prompt: string;
  /** True when Pi already holds every earlier turn of this chat. */
  resumed: boolean;
  meta: PiTurnMeta;
};

export type PiModelEntry = {
  provider: string;
  model: string;
  context: string;
  thinking: boolean;
  images: boolean;
};

export type PiDefaults = {
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel?: string;
};

const PI_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
const YES_NO = new Set(["yes", "no"]);
const SESSION_ID_UNSAFE = /[^A-Za-z0-9._-]+/g;

/** A Pi `--model` value Terax is willing to pass: `provider/id`, a bare id or
 *  either with a `:thinking` suffix. Anything else is dropped, never quoted. */
export function isPiModelPattern(value: string): boolean {
  return PI_MODEL_PATTERN.test(value);
}

export function piSessionId(chatSessionId: string | null, nonce: string): string {
  const base = `terax-${chatSessionId ?? "chat"}-${nonce}`
    .replace(SESSION_ID_UNSAFE, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
  return base.slice(0, 120).replace(/[^A-Za-z0-9]+$/, "") || "terax-chat";
}

export function readPiMeta(message: UIMessage | undefined): PiTurnMeta | null {
  const meta = (message?.metadata as { pi?: unknown } | undefined)?.pi;
  if (!meta || typeof meta !== "object") return null;
  const { sessionId, cwd, userTurns } = meta as Record<string, unknown>;
  if (typeof sessionId !== "string" || !sessionId) return null;
  if (cwd !== null && typeof cwd !== "string") return null;
  if (!Number.isSafeInteger(userTurns) || (userTurns as number) < 1) return null;
  return { sessionId, cwd, userTurns: userTurns as number };
}

/**
 * Decide whether this turn continues the Pi session behind the previous
 * answer or starts a fresh one seeded with the transcript.
 *
 * Pi keeps its own history (tool results included), so a resumed turn sends
 * only the new message. That is safe only when the previous message is Pi's
 * answer to exactly the previous user turn, from the same project directory
 * (Pi groups sessions by cwd). An edited, regenerated or model-switched
 * history fails that check and gets a new session instead of a Pi session
 * that silently disagrees with what the user sees.
 */
export function planPiTurn(
  messages: UIMessage[],
  opts: { chatSessionId: string | null; cwd: string | null; nonce: string },
): PiTurnPlan {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUser = i;
      break;
    }
  }
  const upToLast = lastUser >= 0 ? messages.slice(0, lastUser + 1) : [];
  const userTurns = upToLast.filter((m) => m.role === "user").length;
  const previous = lastUser > 0 ? messages[lastUser - 1] : undefined;
  const prior = previous?.role === "assistant" ? readPiMeta(previous) : null;
  const resumed =
    prior !== null &&
    prior.cwd === opts.cwd &&
    prior.userTurns === userTurns - 1;

  const sessionId = resumed
    ? prior.sessionId
    : piSessionId(opts.chatSessionId, opts.nonce);
  const prompt = resumed
    ? messageText(messages[lastUser])
    : messagesToPrompt(upToLast);
  return {
    sessionId,
    prompt,
    resumed,
    meta: { sessionId, cwd: opts.cwd, userTurns: Math.max(1, userTurns) },
  };
}

/** Pi has no permission prompts, so each posture is a tool list. Read-only
 *  is an allowlist: other extensions (MCP adapters, diagram tools, peer
 *  messaging) can write, and a denylist would let them through. The other
 *  postures deny the shell and keep everything else, Terax control included.
 *  Pi ignores names it does not know, so both lists hold on every platform. */
export const PI_READ_ONLY_TOOLS: readonly string[] = [
  "read",
  "grep",
  "find",
  "ls",
  "terax_status",
  "terax_get_state",
  "terax_wait",
  "terax_development_guide",
];

const PI_EXCLUDED_TOOLS: Record<
  Exclude<CliPermissionMode, "default">,
  readonly string[]
> = {
  acceptEdits: ["bash", "powershell"],
  full: [],
};

function toolArgs(permission: CliPermissionMode): string[] {
  if (permission === "default") return ["--tools", PI_READ_ONLY_TOOLS.join(",")];
  const excluded = PI_EXCLUDED_TOOLS[permission];
  return excluded.length > 0 ? ["--exclude-tools", excluded.join(",")] : [];
}

const CHAT_SURFACE_PROMPT = `## Terax chat panel
You are running headless inside the Terax app's AI chat panel, not in a terminal. Replies render as Markdown in a chat view, and nothing can be typed into your stdin mid-turn, so never wait for interactive input.
The Pi-Terax tools control the Terax app itself: terax_get_state reads a redacted snapshot, terax_call runs an app command (call it with app.commands first for the catalog of commands and their arguments), terax_wait lets the UI settle. Use them whenever the user asks about or wants to change the Terax window, tabs, panels, notes, scheduled tasks, previews, diagrams or speech.
A user message may start with an <env> block (workspace_root, active_terminal_cwd, active_file); treat it as ground truth about where the user is.`;

function piSystemAppend(ctx: {
  persona?: CliRunContext["persona"];
  customInstructions?: string;
  planMode?: boolean;
}): string {
  const blocks = [CHAT_SURFACE_PROMPT];
  if (ctx.planMode) {
    blocks.push(
      "## Plan mode\nThe user turned on plan mode: investigate and propose a plan, do not change files.",
    );
  }
  const persona = ctx.persona?.instructions.trim();
  if (persona) blocks.push(`## Active agent: ${ctx.persona?.name}\n${persona}`);
  const custom = ctx.customInstructions?.trim();
  if (custom) blocks.push(`## User custom instructions\n${custom}`);
  return blocks.join("\n\n");
}

export function planPiRun(ctx: CliRunContext): CliRunPlan {
  const turn = planPiTurn(ctx.messages, {
    chatSessionId: ctx.chatSessionId,
    cwd: ctx.cwd,
    nonce: ctx.nonce,
  });
  const permission: CliPermissionMode = ctx.planMode ? "default" : ctx.permission;
  const argv = ["pi", "--mode", "json", "--print", "--session-id", turn.sessionId];
  const model = ctx.model?.trim();
  if (model && isPiModelPattern(model)) argv.push("--model", model);
  argv.push(...toolArgs(permission));
  argv.push("--append-system-prompt", piSystemAppend(ctx));
  // The prompt travels over stdin: as an argument, a message starting with
  // "@" is read by Pi as a file to include, and argv is visible to `ps`.
  return {
    argv,
    stdin: turn.prompt,
    bridge: true,
    metadata: { pi: turn.meta },
  };
}

/** Parse the table `pi --list-models` prints. Unknown or malformed rows are
 *  skipped rather than guessed at. */
export function parsePiModelList(lines: readonly string[]): PiModelEntry[] {
  const seen = new Set<string>();
  const out: PiModelEntry[] = [];
  for (const raw of lines) {
    const cols = raw.trim().split(/\s+/);
    if (cols.length !== 6 || cols[0] === "provider") continue;
    const [provider, model, context, , thinking, images] = cols;
    if (!YES_NO.has(thinking) || !YES_NO.has(images)) continue;
    const id = `${provider}/${model}`;
    if (!isPiModelPattern(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({
      provider,
      model,
      context,
      thinking: thinking === "yes",
      images: images === "yes",
    });
  }
  return out;
}

/** "anthropic/claude-opus-5" for Pi's configured default, or null. */
export function piDefaultModelLabel(defaults: PiDefaults | null): string | null {
  if (!defaults?.defaultModel) return null;
  return defaults.defaultProvider
    ? `${defaults.defaultProvider}/${defaults.defaultModel}`
    : defaults.defaultModel;
}
