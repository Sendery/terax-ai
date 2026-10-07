import type { UIMessage } from "ai";

export function messageText(message: UIMessage): string {
  return (message.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")
    .trim();
}

/** Flatten the chat history into a single prompt. CLIs take one prompt per
 *  run and manage their own context, so we hand them a readable transcript. */
export function messagesToPrompt(messages: UIMessage[]): string {
  const turns = messages
    .map((m) => ({ role: m.role, text: messageText(m) }))
    .filter((t) => t.text);

  if (turns.length === 0) return "";
  if (turns.length === 1) return turns[0].text;

  const last = turns[turns.length - 1];
  const history = turns
    .slice(0, -1)
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text}`)
    .join("\n\n");
  return `Conversation so far:\n${history}\n\nCurrent request:\n${last.text}`;
}
