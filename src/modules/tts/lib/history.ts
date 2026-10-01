import type { TtsModelId } from "@/modules/tts/lib/engines";

export type SpeechHistoryEntry = {
  id: string;
  /** The text as it was spoken, so the entry can be read again verbatim. */
  text: string;
  /** Single-line excerpt for the menu. */
  preview: string;
  voiceId: string;
  voiceName: string;
  model: TtsModelId;
  at: number;
  chunks: number;
};

/** Kept in memory only: what a terminal reads out can be anything the user has
 *  on screen, and none of it belongs on disk without being asked for. */
export const MAX_HISTORY = 10;

const PREVIEW_CHARS = 90;

export function previewOf(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= PREVIEW_CHARS) return line;
  return `${line.slice(0, PREVIEW_CHARS - 1).trimEnd()}…`;
}

/**
 * Puts `entry` at the front, keeping the list at `MAX_HISTORY`. Reading the
 * same text again moves the existing entry rather than filling the history
 * with copies of it.
 */
export function addHistoryEntry(
  list: readonly SpeechHistoryEntry[],
  entry: SpeechHistoryEntry,
): SpeechHistoryEntry[] {
  const rest = list.filter(
    (existing) =>
      existing.text !== entry.text || existing.voiceId !== entry.voiceId,
  );
  return [entry, ...rest].slice(0, MAX_HISTORY);
}
