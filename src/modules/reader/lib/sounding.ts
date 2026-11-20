import { stopSpeaking, useTtsStore } from "@/modules/tts";
import {
  type ReaderPlayback,
  useReaderStore,
} from "@/modules/reader/store/readerStore";
import { stopReader } from "./player";

function readerSounding(playback: Pick<ReaderPlayback, "docId" | "phase">) {
  return (
    playback.docId !== null &&
    (playback.phase === "playing" ||
      playback.phase === "loading" ||
      playback.phase === "gap")
  );
}

/** Whether anything is sounding now: one-shot speech or a reading. */
export function isSoundingNow(): boolean {
  return (
    useTtsStore.getState().speaking ||
    readerSounding(useReaderStore.getState().playback)
  );
}

/** The same, as a hook, for menus that enable Stop. */
export function useSounding(): boolean {
  const speaking = useTtsStore((s) => s.speaking);
  const reading = useReaderStore((s) => readerSounding(s.playback));
  return speaking || reading;
}

/**
 * The one Stop: silences one-shot speech and the Reader alike. The reading
 * keeps its place, as the Reader's own Stop does. Returns whether anything
 * was sounding.
 */
export function stopEverything(): boolean {
  const was = isSoundingNow();
  stopSpeaking();
  if (readerSounding(useReaderStore.getState().playback)) stopReader();
  return was;
}
