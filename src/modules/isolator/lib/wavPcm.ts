/** What the sidecar accepts on `/isolate`; it answers in the same shape. */
export const ISOLATE_MIN_RATE = 8_000;
export const ISOLATE_MAX_RATE = 48_000;
/** Matches the sidecar's body cap. */
export const MAX_ISOLATE_BYTES = 20 * 1024 * 1024;

export type MonoPcm = { samples: Float32Array; sampleRate: number };

function tag(view: DataView, offset: number): string {
  let out = "";
  for (let i = 0; i < 4; i++) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

/**
 * Mono 16-bit PCM WAV to floats in -1..1. Walks the chunk list instead of
 * assuming a 44-byte header, since a WAV written elsewhere may carry `LIST`
 * or `fact` chunks before `data`. Throws on anything else.
 */
export function decodeMonoWav16(bytes: Uint8Array): MonoPcm {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || tag(view, 0) !== "RIFF" || tag(view, 8) !== "WAVE") {
    throw new Error("Not a WAV file.");
  }
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  let format = 0;
  while (offset + 8 <= bytes.byteLength) {
    const id = tag(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      if (size < 16 || body + 16 > bytes.byteLength) throw new Error("Malformed WAV header.");
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === "data") {
      if (format !== 1 || channels !== 1 || bits !== 16) {
        throw new Error("Expected mono 16-bit PCM WAV.");
      }
      const end = Math.min(bytes.byteLength, body + size);
      const frames = Math.floor((end - body) / 2);
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        samples[i] = view.getInt16(body + i * 2, true) / 32768;
      }
      return { samples, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("WAV file has no audio data.");
}

/** Whether `/isolate` takes audio at this rate. */
export function isIsolatableRate(sampleRate: number): boolean {
  return (
    Number.isInteger(sampleRate) &&
    sampleRate >= ISOLATE_MIN_RATE &&
    sampleRate <= ISOLATE_MAX_RATE
  );
}
