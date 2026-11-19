import {
  type ReaderPlayback,
  useReaderStore,
} from "@/modules/reader/store/readerStore";
import {
  pauseReader,
  resumeReader,
  seekReaderTo,
  skipReader,
  stepReader,
  stopReader,
} from "./player";

/**
 * The Reader as the operating system sees it, through the Media Session API:
 * macOS shows it in Now Playing (Control Center, the menu bar, the lock
 * screen) and routes the media keys, AirPods and headphone buttons to it;
 * Windows does the same through its media overlay and Linux through MPRIS.
 * Each OS draws its own controls; the Reader only says what plays and what
 * each button does.
 */

const SKIP_MS = 10_000;
const ACTIONS: MediaSessionAction[] = [
  "play",
  "pause",
  "stop",
  "previoustrack",
  "nexttrack",
  "seekbackward",
  "seekforward",
  "seekto",
];

/** Whether this webview exposes the OS media controls at all. */
export function osMediaControlsAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "mediaSession" in navigator &&
    typeof MediaMetadata !== "undefined"
  );
}

function sounding(playback: ReaderPlayback): boolean {
  return (
    playback.phase === "playing" ||
    playback.phase === "loading" ||
    playback.phase === "gap"
  );
}

function setHandlers(docId: string | null): void {
  const session = navigator.mediaSession;
  const bind = (
    action: MediaSessionAction,
    handler: MediaSessionActionHandler | null,
  ) => {
    try {
      session.setActionHandler(action, handler);
    } catch {
      // An action this OS does not support is simply not offered.
    }
  };
  if (!docId) {
    for (const action of ACTIONS) bind(action, null);
    return;
  }
  const report = (err: unknown) => console.warn("reader.mediaSession", err);
  bind("play", () => void resumeReader(docId).catch(report));
  bind("pause", () => pauseReader());
  bind("stop", () => stopReader());
  bind("previoustrack", () => void stepReader(docId, -1).catch(report));
  bind("nexttrack", () => void stepReader(docId, 1).catch(report));
  bind(
    "seekbackward",
    (details) =>
      void skipReader(
        docId,
        -(details.seekOffset ?? SKIP_MS / 1000) * 1000,
      ).catch(report),
  );
  bind(
    "seekforward",
    (details) =>
      void skipReader(
        docId,
        (details.seekOffset ?? SKIP_MS / 1000) * 1000,
      ).catch(report),
  );
  bind("seekto", (details) => {
    if (typeof details.seekTime === "number")
      void seekReaderTo(docId, details.seekTime * 1000).catch(report);
  });
}

let installed = false;

/**
 * Keeps the OS media controls in step with the Reader. Metadata changes per
 * sentence, not per word: the sentence being read shows as the artist line.
 * Returns the unsubscribe, for tests and hot reload.
 */
export function installReaderMediaSession(): () => void {
  if (installed || !osMediaControlsAvailable()) return () => {};
  installed = true;
  const session = navigator.mediaSession;
  let boundDoc: string | null = null;
  let shownKey = "";

  const sync = () => {
    const { playback, docs } = useReaderStore.getState();
    const entry = playback.docId ? docs[playback.docId] : undefined;
    const active = entry && playback.phase !== "idle" ? entry : undefined;
    const docId = active ? active.id : null;
    if (docId !== boundDoc) {
      boundDoc = docId;
      setHandlers(docId);
    }
    if (!active) {
      if (shownKey !== "") {
        shownKey = "";
        session.metadata = null;
        session.playbackState = "none";
      }
      return;
    }
    const sentence = active.doc.segments[playback.segment]?.text ?? "";
    const key = `${active.id}|${active.state.title}|${playback.segment}`;
    if (key !== shownKey) {
      shownKey = key;
      session.metadata = new MediaMetadata({
        title: active.state.title,
        artist:
          sentence.length > 140 ? `${sentence.slice(0, 137)}...` : sentence,
        album: "Terax Reader",
        artwork: [{ src: "/logo.png", sizes: "512x512", type: "image/png" }],
      });
    }
    session.playbackState = sounding(playback) ? "playing" : "paused";
    const total = active.timeline.totalMs;
    if (total > 0 && typeof session.setPositionState === "function") {
      try {
        session.setPositionState({
          duration: total / 1000,
          position: Math.min(total, Math.max(0, playback.positionMs)) / 1000,
          playbackRate: active.state.speed,
        });
      } catch {
        // A position the OS rejects (rounding past the end) is skipped.
      }
    }
  };

  sync();
  const unsubscribe = useReaderStore.subscribe(sync);
  return () => {
    unsubscribe();
    setHandlers(null);
    installed = false;
  };
}
