import { invoke } from "@tauri-apps/api/core";

/** A document as stored under the speech directory's `reader/<id>/`. */
export type StoredDocument = {
  id: string;
  /** Normalized source text. */
  source: string;
  /** Raw manifest.json, null for a document never played. */
  manifest: string | null;
  title: string | null;
  sourcePath: string | null;
};

export type LibraryEntry = {
  id: string;
  title: string | null;
  sourcePath: string | null;
  updatedAtMs: number;
  wordCount: number | null;
  lastWordIndex: number | null;
  /** Stable Reader key of the tab the reading was made in. */
  originKey: string | null;
  originLabel: string | null;
};

export type ExportSegment = {
  key: string;
  pauseAfterMs: number;
  chapter?: string;
};

export type ExportResult = {
  path: string;
  durationMs: number;
  chapters: { title: string; startMs: number }[];
};

export const readerNative = {
  open: (args: { text?: string; path?: string; title?: string }) =>
    invoke<StoredDocument>("reader_open", {
      text: args.text ?? null,
      path: args.path ?? null,
      title: args.title ?? null,
    }),
  load: (id: string) => invoke<StoredDocument>("reader_load", { id }),
  saveManifest: (id: string, manifest: string) =>
    invoke<void>("reader_save_manifest", { id, manifest }),
  list: () => invoke<LibraryEntry[]>("reader_list"),
  remove: (id: string) => invoke<void>("reader_delete", { id }),
  chunksPresent: (id: string, voiceKey: string, keys: string[]) =>
    invoke<string[]>("reader_chunks_present", { id, voiceKey, keys }),
  chunkGet: (id: string, voiceKey: string, key: string) =>
    invoke<ArrayBuffer>("reader_chunk_get", { id, voiceKey, key }),
  chunkPut: (id: string, voiceKey: string, key: string, bytes: Uint8Array) =>
    invoke<void>("reader_chunk_put", bytes, {
      headers: {
        "x-reader-id": id,
        "x-reader-voice": voiceKey,
        "x-reader-key": key,
      },
    }),
  exportAudio: (
    id: string,
    voiceKey: string,
    segments: ExportSegment[],
    fileName: string,
  ) =>
    invoke<ExportResult>("reader_export", { id, voiceKey, segments, fileName }),
};

/**
 * Length of a PCM WAV clip from its header, walking the RIFF chunks rather
 * than assuming the 44-byte layout, since engines may add LIST chunks.
 */
export function wavDurationMs(bytes: ArrayBuffer): number | null {
  if (bytes.byteLength < 12) return null;
  const view = new DataView(bytes);
  const tag = (at: number) =>
    String.fromCharCode(
      view.getUint8(at),
      view.getUint8(at + 1),
      view.getUint8(at + 2),
      view.getUint8(at + 3),
    );
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let byteRate = 0;
  let at = 12;
  while (at + 8 <= bytes.byteLength) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt " && body + 16 <= bytes.byteLength) {
      byteRate = view.getUint32(body + 8, true);
    } else if (id === "data") {
      if (byteRate <= 0) return null;
      const available = Math.min(size, bytes.byteLength - body);
      return Math.round((available / byteRate) * 1000);
    }
    at = body + size + (size % 2);
  }
  return null;
}
