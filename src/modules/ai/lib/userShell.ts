import type { UIMessage } from "ai";
import { redactSensitive } from "./redact";

/**
 * Shell commands the user runs from the AI input bar.
 *
 * `!command` runs it and leaves the output in the conversation, where the
 * agent reads it on its next turn. `!!command` runs it for the user's eyes
 * only: the block stays in the transcript but is removed from everything that
 * is sent to a model.
 */
export type UserShellVisibility = "agent" | "private";

export const USER_SHELL_TIMEOUT_SECONDS = 120;
export const USER_SHELL_OUTPUT_MAX_CHARS = 32_000;

export type UserShellBlock = {
  visibility: UserShellVisibility;
  command: string;
  output: string;
  /** null while the command is still running or when a signal ended it. */
  exitCode: number | null;
  state: "running" | "done" | "timeout" | "failed";
};

export function parseUserShellInput(
  input: string,
): { visibility: UserShellVisibility; command: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("!")) return null;
  const visibility: UserShellVisibility = trimmed.startsWith("!!")
    ? "private"
    : "agent";
  const command = trimmed.slice(visibility === "private" ? 2 : 1).trim();
  return command ? { visibility, command } : null;
}

const CLOSE_TAG = "</user-shell>";
const BLOCK_RE =
  /^<user-shell visibility="(agent|private)" state="(running|done|timeout|failed)" exit="(-?\d+|none)">\n\$ ([^\n]*(?:\n(?!---\n)[^\n]*)*)\n---\n([\s\S]*)\n<\/user-shell>$/;

function bound(output: string): string {
  if (output.length <= USER_SHELL_OUTPUT_MAX_CHARS) return output;
  return `[truncated]\n${output.slice(output.length - USER_SHELL_OUTPUT_MAX_CHARS)}`;
}

/** Serialize a block as message text. Output the agent can read is redacted
 *  like any other terminal text; private output never leaves the transcript. */
export function formatUserShellBlock(block: UserShellBlock): string {
  const raw = block.output.replace(/\s+$/, "");
  const shown = block.visibility === "agent" ? redactSensitive(raw) : raw;
  const output = bound(shown).split(CLOSE_TAG).join("</user-shell >");
  const exit = block.exitCode === null ? "none" : String(block.exitCode);
  return `<user-shell visibility="${block.visibility}" state="${block.state}" exit="${exit}">\n$ ${block.command}\n---\n${output}\n${CLOSE_TAG}`;
}

export function parseUserShellBlock(text: string): UserShellBlock | null {
  const match = text.match(BLOCK_RE);
  if (!match) return null;
  return {
    visibility: match[1] as UserShellVisibility,
    state: match[2] as UserShellBlock["state"],
    exitCode: match[3] === "none" ? null : Number(match[3]),
    command: match[4],
    output: match[5],
  };
}

function textOf(message: UIMessage): string {
  return (message.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

export function userShellBlockOf(message: UIMessage): UserShellBlock | null {
  return message.role === "user" ? parseUserShellBlock(textOf(message)) : null;
}

/** The history a model may see: private blocks removed, as are blocks whose
 *  command has not finished and so have nothing to say yet. */
export function withoutPrivateShell<T extends UIMessage>(messages: T[]): T[] {
  let dropped = false;
  const kept = messages.filter((message) => {
    const block = userShellBlockOf(message);
    const hide =
      block !== null &&
      (block.visibility === "private" || block.state === "running");
    if (hide) dropped = true;
    return !hide;
  });
  return dropped ? kept : messages;
}

export function userShellMessage(id: string, block: UserShellBlock): UIMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text: formatUserShellBlock(block) }],
  };
}
