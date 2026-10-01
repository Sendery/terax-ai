/** Chatterbox and Kokoro both work from 24 kHz mono samples. */
export const SAMPLE_TARGET_RATE = 24_000;
/** Matches the cap `tts_sample_import` enforces on the Rust side. */
export const MAX_SAMPLE_BYTES = 16 * 1024 * 1024;

const HEADER_BYTES = 44;

/** Mono 16-bit PCM WAV, the only shape the sidecar accepts for a sample. */
export function encodeWav16(
  samples: Float32Array,
  sampleRate: number,
): Uint8Array {
  const dataLength = samples.length * 2;
  const buffer = new ArrayBuffer(HEADER_BYTES + dataLength);
  const view = new DataView(buffer);

  const writeStr = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataLength, true);

  let offset = HEADER_BYTES;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

export function wavDurationSeconds(bytes: number, sampleRate: number): number {
  return Math.max(0, (bytes - HEADER_BYTES) / 2 / sampleRate);
}

/**
 * Decodes any audio the webview can read and re-renders it as 24 kHz mono.
 * `OfflineAudioContext` does the resample and the downmix, so no hand-rolled
 * interpolation is involved.
 */
export async function toMono24kWav(blob: Blob): Promise<Uint8Array> {
  if (typeof OfflineAudioContext === "undefined") {
    throw new Error("This webview cannot decode audio files.");
  }
  const bytes = await blob.arrayBuffer();
  const decoder = new OfflineAudioContext(1, 1, SAMPLE_TARGET_RATE);
  let decoded: AudioBuffer;
  try {
    decoded = await decoder.decodeAudioData(bytes);
  } catch {
    throw new Error("That file is not audio the webview can decode.");
  }
  const frames = Math.max(1, Math.ceil(decoded.duration * SAMPLE_TARGET_RATE));
  const renderer = new OfflineAudioContext(1, frames, SAMPLE_TARGET_RATE);
  const source = renderer.createBufferSource();
  source.buffer = decoded;
  source.connect(renderer.destination);
  source.start();
  const rendered = await renderer.startRendering();
  const wav = encodeWav16(rendered.getChannelData(0), SAMPLE_TARGET_RATE);
  if (wav.byteLength > MAX_SAMPLE_BYTES) {
    throw new Error(
      "That sample is too long. Trim it to about five minutes or less.",
    );
  }
  return wav;
}
