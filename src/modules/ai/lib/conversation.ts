import type { UIMessage } from "ai";
import { native } from "./native";
import { wrapWithCommandMarker } from "./slashCommands";
import {
  USER_SHELL_TIMEOUT_SECONDS,
  type UserShellBlock,
  type UserShellVisibility,
  userShellMessage,
  withoutPrivateShell,
} from "./userShell";

type ChatLike = {
  messages: UIMessage[];
  status: string;
  sendMessage: (message: { text: string }) => Promise<void>;
};

function composeOutput(stdout: string, stderr: string): string {
  const out = stdout.replace(/\s+$/, "");
  const err = stderr.replace(/\s+$/, "");
  if (!err) return out;
  return out ? `${out}\n${err}` : err;
}

function newMessageId(): string {
  return `ush-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Run a command the user typed with `!` or `!!` and record it in the
 * conversation. The block appears at once as running and is replaced when the
 * command ends, so a slow command is never a silent wait.
 */
export async function runUserShell(
  chat: ChatLike,
  request: { visibility: UserShellVisibility; command: string },
  cwd: string | null,
  run: typeof native.runCommand = native.runCommand,
): Promise<UserShellBlock> {
  const id = newMessageId();
  const base = { visibility: request.visibility, command: request.command };
  const put = (block: UserShellBlock) => {
    const message = userShellMessage(id, block);
    const index = chat.messages.findIndex((m) => m.id === id);
    chat.messages =
      index === -1
        ? [...chat.messages, message]
        : chat.messages.map((m) => (m.id === id ? message : m));
    return block;
  };
  put({ ...base, output: "", exitCode: null, state: "running" });
  try {
    const result = await run(request.command, cwd, USER_SHELL_TIMEOUT_SECONDS);
    return put({
      ...base,
      output: composeOutput(result.stdout, result.stderr),
      exitCode: result.exit_code,
      state: result.timed_out ? "timeout" : "done",
    });
  } catch (error) {
    return put({
      ...base,
      output: error instanceof Error ? error.message : String(error),
      exitCode: null,
      state: "failed",
    });
  }
}

const COMPACT_NAME = "compact";

export function compactPrompt(focus: string): string {
  const extra = focus
    ? `\nThe user asked the summary to pay particular attention to: ${focus}`
    : "";
  return `Compact this conversation. Write a summary that replaces everything above it, so a reader with only the summary can continue the work without asking again.
Include: the goal and what the user asked for, decisions taken and why, files and commands touched with their paths, the current state, what is still pending, and any constraint or preference the user stated. Keep exact identifiers, paths, commands and error messages. Leave out pleasantries and anything already superseded.
Do not call tools. Reply with the summary only.${extra}`;
}

const COMPACTED_NOTE =
  "The earlier conversation was compacted. The assistant's next message is the summary to continue from.";

function assistantText(message: UIMessage | undefined): string {
  if (message?.role !== "assistant") return "";
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

export type CompactOutcome =
  | { ok: true; replaced: number }
  | { ok: false; reason: string };

/**
 * Ask the model for a summary of the conversation and replace the history
 * with it. Nothing is replaced unless a summary actually came back, so a
 * failed or stopped run leaves the conversation as it was.
 */
export async function compactConversation(
  chat: ChatLike,
  focus: string,
): Promise<CompactOutcome> {
  const before = chat.messages;
  if (withoutPrivateShell(before).length < 2)
    return { ok: false, reason: "Nothing to compact yet" };
  await chat.sendMessage({
    text: wrapWithCommandMarker(compactPrompt(focus), COMPACT_NAME),
  });
  const last = chat.messages[chat.messages.length - 1];
  const summary = assistantText(last);
  if (chat.status === "error" || !summary) {
    chat.messages = before;
    return { ok: false, reason: "The summary could not be generated" };
  }
  chat.messages = [
    {
      id: `${last.id}-compact`,
      role: "user",
      parts: [
        { type: "text", text: wrapWithCommandMarker(COMPACTED_NOTE, COMPACT_NAME) },
      ],
    },
    { id: last.id, role: "assistant", parts: [{ type: "text", text: summary }] },
  ];
  return { ok: true, replaced: before.length };
}
