import { TTS_ENGINES, type TtsEngineId } from "./engines";

/**
 * Real-time factor measured on this machine: seconds of audio produced per
 * second of synthesis, from the synthesis requests Terax actually made. The
 * first request of a session also loads the model, so a median over the last
 * few samples is reported rather than an average a cold start would drag down.
 */
export type SpeedSamples = Partial<Record<TtsEngineId, number[]>>;

export const MAX_SPEED_SAMPLES = 12;
export const MIN_SPEED_SAMPLES = 3;
/** Clips shorter than this are dominated by fixed overhead. */
export const MIN_AUDIO_SECONDS = 1;

export function addSpeedSample(
  samples: SpeedSamples,
  engine: TtsEngineId,
  audioSeconds: number,
  wallSeconds: number,
): SpeedSamples {
  if (!(audioSeconds >= MIN_AUDIO_SECONDS) || !(wallSeconds > 0)) return samples;
  const factor = audioSeconds / wallSeconds;
  if (!Number.isFinite(factor)) return samples;
  const list = [...(samples[engine] ?? []), Math.round(factor * 100) / 100];
  return { ...samples, [engine]: list.slice(-MAX_SPEED_SAMPLES) };
}

/** Median real-time factor, or null until enough clips were timed. */
export function measuredSpeed(
  samples: SpeedSamples,
  engine: TtsEngineId,
): number | null {
  const list = samples[engine] ?? [];
  if (list.length < MIN_SPEED_SAMPLES) return null;
  const sorted = [...list].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100;
}

export function parseSpeedSamples(value: unknown): SpeedSamples {
  const out: SpeedSamples = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const engine of TTS_ENGINES) {
    const list = (value as Record<string, unknown>)[engine];
    if (!Array.isArray(list)) continue;
    const clean = list
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0)
      .slice(-MAX_SPEED_SAMPLES);
    if (clean.length > 0) out[engine] = clean;
  }
  return out;
}

/** "13x real time" style label; one decimal below 10. */
export function formatSpeed(factor: number): string {
  const shown = factor >= 10 ? Math.round(factor).toString() : factor.toFixed(1);
  return `${shown}x real time`;
}

/** Seconds of audio in a 16-bit PCM WAV, read from its header. */
export function wavSecondsFromHeader(header: ArrayBuffer, totalBytes: number): number | null {
  if (header.byteLength < 44) return null;
  const view = new DataView(header);
  const channels = view.getUint16(22, true);
  const rate = view.getUint32(24, true);
  const bits = view.getUint16(34, true);
  if (!channels || !rate || !bits) return null;
  return (totalBytes - 44) / (rate * channels * (bits / 8));
}
