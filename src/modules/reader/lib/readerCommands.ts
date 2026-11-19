import type {
  ControlHandlers,
  ControlPayloads,
} from "@/modules/commands/lib/controlCommands";
import type { Tab } from "@/modules/tabs";
import {
  type DocEntry,
  type ReaderPlayback,
  useReaderStore,
} from "@/modules/reader/store/readerStore";
import { readerNative } from "./native";
import {
  adoptDocument,
  deleteReaderDocs,
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
  | "exportReader"
  | "dockReader"
  | "deleteReader";

export type ReaderHost = {
  tabs: () => Tab[];
  activeId: () => number;
  openReaderTab: (input: {
    docId: string;
    title: string;
    background?: boolean;
  }) => number;
  /**
   * Puts a document in the panel under a tab, recording that tab as where the
   * reading belongs when it has no open home yet. False for a Reader tab,
   * which has no panel.
   */
  dockReading: (tabId: number, entry: DocEntry) => boolean;
  /** Records the tab a document opened from, when it has no open home yet. */
  recordOrigin: (tabId: number, entry: DocEntry) => void;
  /** Shows the library in a tab's panel. */
  showLibrary: (tabId: number) => void;
  /** Closes a tab's panel, stopping the reading if nothing else shows it. */
  closeDock: (tabId: number) => void;
  /** Lets panels and Reader tabs go of deleted documents. */
  forgetDeleted: (ids: string[]) => void;
};

const DOC_ID = /^[0-9a-f]{12}$/;

function failure(message: string): never {
  throw { code: "command_failed", message };
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** A name for text that came without one: its first words. */
export function titleFromText(text: string): string | undefined {
  const firstLine =
    text
      .split("\n")
      .map((line) => line.replace(/^\s*(#+|[-*+>]|\d+[.)])\s*/, "").trim())
      .find((line) => line.length > 0) ?? "";
  const words = firstLine.split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;
  const head = words.slice(0, 6).join(" ");
  return words.length > 6 ? `${head}...` : head;
}

/** The document a tab shows: its own for a Reader tab, else its panel's. */
export function docShownBy(tab: Tab | undefined): string | null {
  if (!tab) return null;
  if (tab.kind === "reader") return tab.docId;
  return tab.readerDock?.docId ?? null;
}

function shownSomewhere(tabs: readonly Tab[], docId: string): boolean {
  return tabs.some((t) => docShownBy(t) === docId);
}

function isSounding(playback: Pick<ReaderPlayback, "docId" | "phase">) {
  return (
    playback.phase === "playing" ||
    playback.phase === "loading" ||
    playback.phase === "gap"
  );
}

/**
 * The document a command without docId means: the one sounding, else the
 * one on screen (Reader tab or panel), else the reading left paused.
 */
export function pickDefaultDoc(
  playback: Pick<ReaderPlayback, "docId" | "phase">,
  onScreen: string | null,
): string | null {
  if (playback.docId && isSounding(playback)) return playback.docId;
  return onScreen ?? playback.docId;
}

function requireDocId(docId: string): void {
  if (!DOC_ID.test(docId))
    failure("docId must be 12 lowercase hex characters, from reader.list");
}

function targetTab(host: ReaderHost, tabId: number | undefined): Tab {
  const id = tabId ?? host.activeId();
  const tab = host.tabs().find((t) => t.id === id);
  if (!tab) failure(`No tab ${id}; see the snapshot for tab ids`);
  return tab;
}

/**
 * The document a command acts on: the one named, else the default above.
 * Reading commands never change the screen. Acting on a named document that
 * nothing shows docks it under the tab on screen (a background Reader tab
 * when that is itself a Reader tab), so its state has somewhere to live.
 */
async function resolveDoc(
  host: ReaderHost,
  docId: string | undefined,
  show: boolean,
): Promise<string> {
  if (docId !== undefined) {
    requireDocId(docId);
    const entry = await loadStored(docId).catch(() =>
      failure(`No Reader document ${docId}`),
    );
    if (show && !shownSomewhere(host.tabs(), docId)) {
      const docked = host.dockReading(host.activeId(), entry);
      if (!docked)
        host.openReaderTab({
          docId,
          title: entry.state.title,
          background: true,
        });
    }
    return docId;
  }
  const active = host.tabs().find((t) => t.id === host.activeId());
  const picked = pickDefaultDoc(
    useReaderStore.getState().playback,
    docShownBy(active),
  );
  if (picked) {
    await loadStored(picked);
    return picked;
  }
  return failure(
    "No Reader document is playing or on screen; pass docId (see reader.list).",
  );
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
      const placement = payload.placement ?? "dock";
      const hostTab =
        placement === "dock" ? targetTab(host, payload.tabId) : null;
      const fromStdin = payload.stdin === true && path !== undefined;
      const title =
        payload.title?.trim() ||
        (fromStdin
          ? "stdin"
          : path
            ? basename(path)
            : text
              ? titleFromText(text)
              : undefined);
      const stored = await readerNative.open({ text, path, title });
      // A temporary copy of piped input is not a source worth pointing back at.
      const doc = adoptDocument(
        fromStdin ? { ...stored, sourcePath: null } : stored,
        title,
      );
      let tabId: number;
      let placed: "dock" | "tab" = "tab";
      if (hostTab && host.dockReading(hostTab.id, doc)) {
        tabId = hostTab.id;
        placed = "dock";
      } else {
        host.recordOrigin(host.activeId(), doc);
        tabId = host.openReaderTab({
          docId: doc.id,
          title: doc.state.title,
        });
      }
      if (play) {
        void playReader(doc.id).catch((err: unknown) => {
          useReaderStore.getState().setPlayback({
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
      return {
        tabId,
        placement: placed,
        id: doc.id,
        title: doc.state.title,
        words: doc.doc.words.length,
        segments: doc.doc.segments.length,
        lastWordIndex: doc.state.lastWordIndex,
      };
    },
    listReader: async () => {
      const tabs = host.tabs();
      const documents = await readerNative.list();
      return {
        documents: documents.map((d) => ({
          ...d,
          originTabId:
            tabs.find(
              (t) =>
                d.originKey !== null &&
                t.kind !== "reader" &&
                t.readerKey === d.originKey,
            )?.id ?? null,
          shownInTabIds: tabs
            .filter((t) => docShownBy(t) === d.id)
            .map((t) => t.id),
        })),
      };
    },
    readerState: async (payload: ControlPayloads["reader.state"]) => {
      const docId = await resolveDoc(host, payload?.docId, false);
      return summarize(docId);
    },
    controlReader: async (payload: ControlPayloads["reader.control"]) => {
      const { playback } = useReaderStore.getState();
      // Pause and stop act on what plays; naming another document must not
      // silence the one that is sounding.
      if (
        (payload.op === "pause" || payload.op === "stop") &&
        payload.docId !== undefined
      ) {
        requireDocId(payload.docId);
        if (playback.docId !== payload.docId) {
          await loadStored(payload.docId).catch(() =>
            failure(`No Reader document ${payload.docId}`),
          );
          return summarize(payload.docId);
        }
      }
      const docId = await resolveDoc(host, payload.docId, true);
      const entry = useReaderStore.getState().docs[docId];
      if (!entry) failure("The document could not be loaded");
      const maxWord = entry.doc.words.length - 1;
      if (payload.wordIndex !== undefined && payload.wordIndex > maxWord) {
        failure(
          `wordIndex is past the end; the document has ${entry.doc.words.length} words`,
        );
      }
      if (payload.speedPercent !== undefined)
        setReaderSpeed(docId, payload.speedPercent / 100);
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
            const now = useReaderStore.getState().playback;
            if (now.docId === docId && isSounding(now))
              await playReader(docId, payload.wordIndex);
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
      const docId = await resolveDoc(host, payload.docId, true);
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
      const options = {
        ...(payload.label !== undefined ? { label: payload.label } : {}),
        ...(payload.pauseMs !== undefined ? { pauseMs: payload.pauseMs } : {}),
      };
      const wantPresent = payload.remove !== true;
      if (exists !== wantPresent) {
        toggleReaderCut(docId, payload.kind, payload.wordIndex, options);
      } else if (
        exists &&
        (payload.label !== undefined || payload.pauseMs !== undefined)
      ) {
        // Marking an existing cut again with a new label or length updates it.
        toggleReaderCut(docId, payload.kind, payload.wordIndex);
        toggleReaderCut(docId, payload.kind, payload.wordIndex, options);
      }
      return summarize(docId);
    },
    exportReader: async (payload: ControlPayloads["reader.export"]) => {
      const docId = await resolveDoc(host, payload?.docId, true);
      return exportReader(docId);
    },
    dockReader: async (payload: ControlPayloads["reader.dock"]) => {
      const tab = targetTab(host, payload.tabId);
      if (tab.kind === "reader")
        failure("A Reader tab has no panel; pick another tab");
      if (payload.close) {
        host.closeDock(tab.id);
        return { tabId: tab.id, open: false, docId: null };
      }
      if (payload.docId !== undefined) {
        requireDocId(payload.docId);
        const entry = await loadStored(payload.docId).catch(() =>
          failure(`No Reader document ${payload.docId}`),
        );
        host.dockReading(tab.id, entry);
        return { tabId: tab.id, open: true, docId: entry.id };
      }
      host.showLibrary(tab.id);
      return { tabId: tab.id, open: true, docId: null };
    },
    deleteReader: async (payload: ControlPayloads["reader.delete"]) => {
      let ids: string[];
      if (payload.all) {
        ids = (await readerNative.list()).map((d) => d.id);
      } else if (payload.docId !== undefined) {
        requireDocId(payload.docId);
        ids = [payload.docId];
      } else {
        return failure("Pass docId, or all to empty the library");
      }
      await deleteReaderDocs(ids);
      host.forgetDeleted(ids);
      return { deleted: ids.length, ids };
    },
  };
}
