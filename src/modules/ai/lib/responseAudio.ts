import type { UIMessage } from "ai";
import { openStored, prepareReaderAudio } from "@/modules/reader/lib/player";
import { usePreferencesStore } from "@/modules/settings/preferences";

export function responseText(message: UIMessage): string {
  return message.role === "assistant"
    ? message.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n\n").trim()
    : "";
}

let queued = Promise.resolve();

export function queueResponseAudio(text: string): void {
  if (!text.trim()) return;
  const current = () => usePreferencesStore.getState().prepareChatAudio;
  queued = queued.then(async () => {
    if (!current()) return;
    const entry = await openStored({ text });
    if (current()) await prepareReaderAudio(entry.id, current);
  }).catch(() => {
    // The inline reader can retry and display an error when the user presses Play.
  });
}
