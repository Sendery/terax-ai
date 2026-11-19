export { ReaderDock } from "./components/ReaderDock";
export type { OriginTab } from "./components/ReaderLibrary";
export { ReaderMiniPlayer } from "./components/ReaderMiniPlayer";
export { ReaderStack } from "./ReaderStack";
export {
  hashKey,
  parseDocument,
  type ReaderDocument,
} from "./lib/document";
export { readerKeyAction, READER_KEY_HELP } from "./lib/keys";
export { stepSpeed } from "./lib/manifest";
export { readerNative, type LibraryEntry } from "./lib/native";
export { pickDefaultDoc } from "./lib/readerCommands";
export {
  installReaderMediaSession,
  osMediaControlsAvailable,
} from "./lib/mediaSession";
export { exportWithToast } from "./lib/exportToast";
export {
  closeReaderDoc,
  deleteReaderDocs,
  exportReader,
  isLive,
  loadStored,
  openStored,
  pauseReader,
  playReader,
  resumeReader,
  seekReaderTo,
  setReaderSpeed,
  setReaderOrigin,
  setReaderVoice,
  stepReader,
  stopReader,
  summarize,
  toggleReader,
  toggleReaderCut,
  type ReaderSummary,
} from "./lib/player";
export { useReaderStore } from "./store/readerStore";
