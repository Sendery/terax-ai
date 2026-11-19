import { create } from "zustand";
import type { TtsLanguage } from "@/modules/tts/lib/engines";
import type { ReaderDocument } from "@/modules/reader/lib/document";
import type { ReaderState } from "@/modules/reader/lib/manifest";
import type { Timeline } from "@/modules/reader/lib/timing";

export type DocEntry = {
  id: string;
  source: string;
  doc: ReaderDocument;
  state: ReaderState;
  language: TtsLanguage | null;
  /** Voice the cached audio and durations below belong to. */
  voiceKey: string | null;
  /** Clip length per segment key, for `voiceKey`. */
  durations: ReadonlyMap<string, number>;
  /** Segment keys with audio on disk, for `voiceKey`. */
  cached: ReadonlySet<string>;
  timeline: Timeline;
};

export type PlaybackPhase =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  /** Silent on purpose: a scripted pause between two segments. */
  | "gap"
  | "finished";

export type ReaderPlayback = {
  docId: string | null;
  phase: PlaybackPhase;
  segment: number;
  wordIndex: number;
  /** Document time at 1x, pauses included. */
  positionMs: number;
  error: string | null;
  /** Set while an export synthesizes what is missing and writes the file. */
  exporting: { docId: string; done: number; total: number } | null;
};

export const IDLE_PLAYBACK: ReaderPlayback = {
  docId: null,
  phase: "idle",
  segment: 0,
  wordIndex: 0,
  positionMs: 0,
  error: null,
  exporting: null,
};

const FLOATING_KEY = "terax.reader.floatingControls";

function readFloating(): boolean {
  try {
    return globalThis.localStorage?.getItem(FLOATING_KEY) === "1";
  } catch {
    return false;
  }
}

type ReaderStore = {
  docs: Record<string, DocEntry>;
  playback: ReaderPlayback;
  /** Controls float over the workspace instead of docking under the text. */
  floating: boolean;
  putDoc: (entry: DocEntry) => void;
  patchDoc: (id: string, patch: Partial<DocEntry>) => void;
  dropDoc: (id: string) => void;
  setPlayback: (patch: Partial<ReaderPlayback>) => void;
  setFloating: (floating: boolean) => void;
};

export const useReaderStore = create<ReaderStore>((set) => ({
  docs: {},
  playback: IDLE_PLAYBACK,
  floating: readFloating(),
  putDoc: (entry) => set((s) => ({ docs: { ...s.docs, [entry.id]: entry } })),
  patchDoc: (id, patch) =>
    set((s) => {
      const current = s.docs[id];
      if (!current) return s;
      return { docs: { ...s.docs, [id]: { ...current, ...patch } } };
    }),
  dropDoc: (id) =>
    set((s) => {
      if (!s.docs[id]) return s;
      const { [id]: _dropped, ...rest } = s.docs;
      return { docs: rest };
    }),
  setPlayback: (patch) =>
    set((s) => ({ playback: { ...s.playback, ...patch } })),
  setFloating: (floating) => {
    try {
      globalThis.localStorage?.setItem(FLOATING_KEY, floating ? "1" : "0");
    } catch {
      // A private window keeps the choice for this session only.
    }
    set({ floating });
  },
}));
