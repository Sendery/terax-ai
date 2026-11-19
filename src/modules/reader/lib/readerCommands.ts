import type {
  ControlHandlers,
  ControlPayloads,
} from "@/modules/commands/lib/controlCommands";
import type { Tab } from "@/modules/tabs";
import {
  type ReaderPlayback,
  useReaderStore,
} from "@/modules/reader/store/readerStore";
import { readerNative } from "./native";
import {
  adoptDocument,
  exportReader,
  loadStored,
  pauseReader,
  playReader,
  seekReaderTo,
  setReaderSpeed,
  stepReader,
  stopReader,
  summarize,
  toggleReader,
  toggleReaderCut,
} from "./player";
import { allCuts } from "./manifest";

type ReaderHandlerKeys =
  | "openReader"
  | "listReader"
  | "readerState"
  | "controlReader"
  | "markReader"
  | "exportReader";

export type ReaderHost = {
  tabs: () => Tab[];
  activeId: () => number;
  openReaderTab: (input: {
    docId: string;
    title: string;
    background?: boolean;
  }) => number;
};

const DOC_ID = /^[0-9a-f]{12}$/;

function failure(message: string): never {
  throw { code: "command_failed", message };
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/**
 * The document a command acts on: the one named, else the one playing, else
 * the Reader tab on screen. A named document not open yet gets a tab in the
 * background so its state has somewhere to live.
 */
async function resolveDoc(
  host: ReaderHost,
  docId: string | undefined,
): Promise<string> {
  if (docId !== undefined) {
    if (!DOC_ID.test(docId))
      failure("docId must be 12 lowercase hex characters, from reader.list");
    const open = host
      .tabs()
      .some((t) => t.kind === "reader" && t.docId === docId);
    const entry = await loadStored(docId).catch(() =>
      failure(`No Reader document ${docId}`),
    );
    if (!open)
      host.openReaderTab({ docId, title: entry.state.title, background: true });
    return docId;
  }
  const active = host.tabs().find((t) => t.id === host.activeId());
  const picked = pickDefaultDoc(
    useReaderStore.getState().playback,
    active?.kind === "reader" ? active.docId : null,
  );
  if (picked) {
    await loadStored(picked);
    return picked;
  }
  return failure(
    "No Reader document is playing or on screen; pass docId (see reader.list).",
  );
}

/**
 * The document a command without docId means: the one sounding, else the
 * Reader tab on screen, else the reading left paused.
 */
export function pickDefaultDoc(
  playback: Pick<ReaderPlayback, "docId" | "phase">,
  onScreen: string | null,
): string | null {
  const sounding =
    playback.phase === "playing" ||
    playback.phase === "loading" ||
    playback.phase === "gap";
  if (playback.docId && sounding) return playback.docId;
  return onScreen ?? playback.docId;
}

export function createReaderHandlers(
  host: ReaderHost,
): Pick<ControlHandlers, ReaderHandlerKeys> {
  return {
    openReader: async (payload: ControlPayloads["reader.open"]) => {
      const { text, path, play } = payload;
      if (
        path !== undefined &&
        !path.startsWith("/") &&
        !/^[A-Za-z]:[\\/]/.test(path)
      ) {
        failure("reader.open path must be absolute");
      }
      const fromStdin = payload.stdin === true && path !== undefined;
      const title =
        payload.title?.trim() ||
        (fromStdin ? "stdin" : path ? basename(path) : undefined);
      const stored = await readerNative.open({ text, path, title });
      // A temporary copy of piped input is not a source worth pointing back at.
      const doc = adoptDocument(
        fromStdin ? { ...stored, sourcePath: null } : stored,
        title,
      );
      const tabId = host.openReaderTab({
        docId: doc.id,
        title: doc.state.title,
      });
      if (play) {
        void playReader(doc.id).catch((err: unknown) => {
          useReaderStore.getState().setPlayback({
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
      return {
        tabId,
        id: doc.id,
        title: doc.state.title,
        words: doc.doc.words.length,
        segments: doc.doc.segments.length,
        lastWordIndex: doc.state.lastWordIndex,
      };
    },
    listReader: async () => ({ documents: await readerNative.list() }),
    readerState: async (payload: ControlPayloads["reader.state"]) => {
      const docId = await resolveDoc(host, payload?.docId);
      return summarize(docId);
    },
    controlReader: async (payload: ControlPayloads["reader.control"]) => {
      const docId = await resolveDoc(host, payload.docId);
      const entry = useReaderStore.getState().docs[docId];
      if (!entry) failure("The document could not be loaded");
      if (payload.speedPercent !== undefined)
        setReaderSpeed(docId, payload.speedPercent / 100);
      const maxWord = entry.doc.words.length - 1;
      if (payload.wordIndex !== undefined && payload.wordIndex > maxWord) {
        failure(
          `wordIndex is past the end; the document has ${entry.doc.words.length} words`,
        );
      }
      switch (payload.op) {
        case "play":
          await playReader(docId, payload.wordIndex);
          break;
        case "pause":
          pauseReader();
          break;
        case "toggle":
          await toggleReader(docId);
          break;
        case "stop":
          stopReader();
          break;
        case "next":
          await stepReader(docId, 1);
          break;
        case "previous":
          await stepReader(docId, -1);
          break;
        case "seek":
          if (payload.wordIndex !== undefined) {
            const playing = useReaderStore.getState().playback;
            const live = playing.docId === docId && playing.phase === "playing";
            if (live) await playReader(docId, payload.wordIndex);
            else {
              const segment = entry.doc.words[payload.wordIndex].segment;
              await seekReaderTo(docId, entry.timeline.starts[segment] ?? 0);
            }
          } else if (payload.positionMs !== undefined) {
            await seekReaderTo(docId, payload.positionMs);
          } else {
            failure("seek needs wordIndex or positionMs");
          }
          break;
      }
      return summarize(docId);
    },
    markReader: async (payload: ControlPayloads["reader.mark"]) => {
      const docId = await resolveDoc(host, payload.docId);
      const entry = useReaderStore.getState().docs[docId];
      if (!entry) failure("The document could not be loaded");
      if (payload.wordIndex >= entry.doc.words.length) {
        failure(
          `wordIndex is past the end; the document has ${entry.doc.words.length} words`,
        );
      }
      const exists = allCuts(entry.doc, entry.state.cutPoints).some(
        (c) =>
          c.source === "user" &&
          c.kind === payload.kind &&
          c.wordIndex === payload.wordIndex,
      );
      const wantPresent = payload.remove !== true;
      if (exists !== wantPresent) {
        toggleReaderCut(docId, payload.kind, payload.wordIndex, {
          ...(payload.label !== undefined ? { label: payload.label } : {}),
          ...(payload.pauseMs !== undefined
            ? { pauseMs: payload.pauseMs }
            : {}),
        });
      }
      return summarize(docId);
    },
    exportReader: async (payload: ControlPayloads["reader.export"]) => {
      const docId = await resolveDoc(host, payload?.docId);
      return exportReader(docId);
    },
  };
}
