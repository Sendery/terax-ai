/**
 * Voice isolation for the three places Terax handles recorded or synthesized
 * speech: dictation segments, reading chunks and imported voice samples.
 *
 * Cleanup is optional by design: when it is switched on but cannot run (not
 * installed, still downloading, the engine failed), the original audio goes
 * through untouched and the reason is reported once. A dictation or a reading
 * is never lost because the cleanup step was not available.
 */

import type { TtsEndpoint } from "@/modules/tts/lib/client";
import { isolate, TtsClientError } from "@/modules/tts/lib/client";
import type { TtsDevice } from "@/modules/tts/lib/engines";
import { encodeWav16 } from "@/modules/tts/lib/wav";
import {
  CLEANUP_ENGINE_LABELS,
  ISOLATOR_ENGINE,
  ISOLATOR_MODEL,
} from "./catalog";
import { cleanerModelStatusOf, cleanerStatusOf, isolatorNative } from "./native";
import { decodeMonoWav16, isIsolatableRate, MAX_ISOLATE_BYTES } from "./wavPcm";

/** Why cleanup did not run; the message is meant for the person, as is. */
export class CleanupUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CleanupUnavailable";
  }
}

const LABEL = CLEANUP_ENGINE_LABELS[ISOLATOR_ENGINE];

/** The running isolator sidecar, started on `device` when it is installed. */
export async function resolveIsolator(device: TtsDevice): Promise<TtsEndpoint> {
  const status = await isolatorNative.status();
  const entry = cleanerStatusOf(status, ISOLATOR_ENGINE);
  if (!entry) {
    throw new CleanupUnavailable(`This Terax build has no ${LABEL}.`);
  }
  if (!entry.installed) {
    throw new CleanupUnavailable(
      `Audio cleanup is on, but the ${LABEL} is not installed. Install it in Settings, Voice, Advanced.`,
    );
  }
  if (!cleanerModelStatusOf(status, ISOLATOR_MODEL)?.downloaded) {
    throw new CleanupUnavailable(
      `Audio cleanup is on, but the ${LABEL} model is not downloaded yet.`,
    );
  }
  if (entry.plan && !entry.plan.supported) {
    throw new CleanupUnavailable(
      entry.plan.unsupportedReason ?? `The ${LABEL} cannot run on this machine.`,
    );
  }
  if (entry.running && entry.port !== null && entry.token) {
    return { port: entry.port, token: entry.token };
  }
  return isolatorNative.start(ISOLATOR_ENGINE, device);
}

/** The voice in `samples`, at the same rate and length. */
export async function isolatePcm(
  samples: Float32Array,
  sampleRate: number,
  device: TtsDevice,
  signal?: AbortSignal,
): Promise<Float32Array> {
  const wav = encodeWav16(samples, sampleRate);
  const cleaned = await isolateWav(wav, sampleRate, device, signal);
  return decodeMonoWav16(cleaned).samples;
}

/** Cleans a mono 16-bit PCM WAV and returns one of the same shape. */
export async function isolateWav(
  wav: Uint8Array,
  sampleRate: number,
  device: TtsDevice,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!isIsolatableRate(sampleRate)) {
    throw new CleanupUnavailable(
      `Audio at ${sampleRate} Hz cannot be cleaned: the ${LABEL} takes 8 to 48 kHz.`,
    );
  }
  if (wav.byteLength > MAX_ISOLATE_BYTES) {
    throw new CleanupUnavailable(
      `That audio is too long to clean in one piece, so it was used as recorded.`,
    );
  }
  const endpoint = await resolveIsolator(device);
  return isolate(endpoint, ISOLATOR_MODEL, wav, { signal });
}

export type CleanedClip = { bytes: Uint8Array; cleaned: boolean };

/**
 * A synthesized or imported WAV clip, cleaned when `enabled`. `cleaned` is
 * false when cleanup was skipped, so a cache keyed on "cleaned" never stores
 * the raw clip under that key.
 */
export async function cleanClip(
  enabled: boolean,
  bytes: Uint8Array,
  device: TtsDevice,
  onSkip: (reason: string) => void,
  signal?: AbortSignal,
): Promise<CleanedClip> {
  const original: CleanedClip = { bytes, cleaned: false };
  return cleanOrKeep<CleanedClip>(
    enabled,
    original,
    async () => {
      const { sampleRate } = decodeMonoWav16(bytes);
      return { bytes: await isolateWav(bytes, sampleRate, device, signal), cleaned: true };
    },
    onSkip,
    signal,
  );
}

function isAbort(err: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true;
  return err instanceof TtsClientError && err.code === "aborted";
}

/**
 * Runs `clean` when `enabled`, falling back to `original` with `onSkip` told
 * why when cleanup cannot run. A cancellation is rethrown, never swallowed.
 */
export async function cleanOrKeep<T>(
  enabled: boolean,
  original: T,
  clean: () => Promise<T>,
  onSkip: (reason: string) => void,
  signal?: AbortSignal,
): Promise<T> {
  if (!enabled) return original;
  try {
    return await clean();
  } catch (err) {
    if (isAbort(err, signal)) throw err;
    onSkip(err instanceof Error ? err.message : String(err));
    return original;
  }
}

/** Reasons already reported this session, so a dictation of ten segments
 *  raises one warning and not ten. */
const reported = new Set<string>();

export function reportOnce(
  reason: string,
  show: (message: string) => void,
): void {
  if (reported.has(reason)) return;
  reported.add(reason);
  show(reason);
}

/** Test hook: forget what was reported. */
export function resetReported(): void {
  reported.clear();
}
