import { endpointUrl, TtsClientError, type TtsEndpoint } from "@/modules/tts/lib/client";
import type { TtsDevice } from "@/modules/tts/lib/engines";
import { encodeWav16 } from "@/modules/tts/lib/wav";
import { STT_ENGINE_LABELS, STT_MODEL_ENGINE, STT_MODEL_LABELS } from "./catalog";
import {
  sttNative,
  transcriberModelStatusOf,
  transcriberStatusOf,
} from "./native";
import { STT_SAMPLE_RATE } from "./segmenter";
import type { SttLanguage, SttLocalModel } from "./settings";

/** Matches the sidecar's body cap: ten minutes of 16 kHz 16-bit mono. */
export const MAX_TRANSCRIBE_BYTES = 20 * 1024 * 1024;
const TRANSCRIBE_TIMEOUT_MS = 120_000;
const WARMUP_TIMEOUT_MS = 180_000;

export const NOT_INSTALLED_MESSAGE =
  "Install the dictation model in Settings, Dictation.";

export type TranscribeOptions = {
  model: SttLocalModel;
  language: SttLanguage;
  filler: boolean;
  verbatim: boolean;
  digits: boolean;
  /** Hotwords, sent URL-encoded in `X-Terax-Context`. */
  context?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type TranscribeResult = {
  text: string;
  language: string | null;
  audioMs: number;
  elapsedMs: number;
};

export type SelfTest = { ok: boolean; elapsedMs: number };

function flag(value: boolean): string {
  return value ? "1" : "0";
}

export function transcribePath(options: TranscribeOptions): string {
  const query = new URLSearchParams({
    model: options.model,
    language: options.language,
    filler: flag(options.filler),
    verbatim: flag(options.verbatim),
    digits: flag(options.digits),
  });
  return `/transcribe?${query.toString()}`;
}

async function failureOf(res: Response): Promise<TtsClientError> {
  let detail = "";
  try {
    const body = await res.text();
    try {
      const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
      detail =
        typeof parsed.message === "string"
          ? parsed.message
          : typeof parsed.error === "string"
            ? parsed.error
            : body;
    } catch {
      detail = body;
    }
  } catch {
    detail = "";
  }
  const suffix = detail ? `: ${detail}` : "";
  switch (res.status) {
    case 401:
    case 403:
      return new TtsClientError(
        "unauthorized",
        "The dictation engine refused the session token. Restart it in Settings, Dictation.",
        res.status,
      );
    case 404:
      return new TtsClientError(
        "model-missing",
        `The dictation model is not downloaded yet${suffix}`,
        404,
      );
    case 400:
    case 409:
    case 413:
      return new TtsClientError(
        "bad-request",
        `The dictation engine rejected the audio${suffix}`,
        res.status,
      );
    case 503:
      return new TtsClientError(
        "loading",
        `The dictation engine is still loading its model${suffix}`,
        503,
      );
    default:
      return new TtsClientError(
        "server",
        `The dictation engine failed (${res.status})${suffix}`,
        res.status,
      );
  }
}

async function post(
  endpoint: TtsEndpoint,
  path: string,
  body: BodyInit,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Response> {
  const url = endpointUrl(endpoint.port, path);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const res = await fetch(url, {
      method: "POST",
      body,
      signal: controller.signal,
      headers: { ...headers, Authorization: `Bearer ${endpoint.token}` },
    });
    if (!res.ok) throw await failureOf(res);
    return res;
  } catch (err) {
    if (err instanceof TtsClientError) throw err;
    if (timedOut) {
      throw new TtsClientError(
        "timeout",
        `The dictation engine did not answer within ${Math.round(timeoutMs / 1000)}s.`,
      );
    }
    if (signal?.aborted) throw new TtsClientError("aborted", "Dictation was cancelled.");
    const detail = err instanceof Error ? err.message : String(err);
    throw new TtsClientError("network", `Could not reach the dictation engine (${detail}).`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Posts one 16 kHz segment and returns what the engine heard. */
export async function transcribePcm(
  endpoint: TtsEndpoint,
  pcm: Float32Array,
  options: TranscribeOptions,
): Promise<TranscribeResult> {
  const wav = encodeWav16(pcm, STT_SAMPLE_RATE);
  if (wav.byteLength > MAX_TRANSCRIBE_BYTES) {
    throw new TtsClientError(
      "bad-request",
      "That recording is longer than ten minutes. Dictate it in shorter parts.",
    );
  }
  const headers: Record<string, string> = { "Content-Type": "audio/wav" };
  const context = options.context?.trim();
  if (context) headers["X-Terax-Context"] = encodeURIComponent(context);
  const res = await post(
    endpoint,
    transcribePath(options),
    new Blob([wav as Uint8Array<ArrayBuffer>], { type: "audio/wav" }),
    headers,
    options.signal,
    options.timeoutMs ?? TRANSCRIBE_TIMEOUT_MS,
  );
  const parsed = (await res.json()) as Partial<TranscribeResult>;
  const result: TranscribeResult = {
    text: typeof parsed.text === "string" ? parsed.text : "",
    language: typeof parsed.language === "string" ? parsed.language : null,
    audioMs:
      typeof parsed.audioMs === "number"
        ? parsed.audioMs
        : Math.round((pcm.length / STT_SAMPLE_RATE) * 1000),
    elapsedMs: typeof parsed.elapsedMs === "number" ? parsed.elapsedMs : 0,
  };
  recordTranscription(options.model, result);
  return result;
}

/** Loads the model and runs the sidecar's self-test (silence must stay silent). */
export async function warmupTranscriber(
  endpoint: TtsEndpoint,
  model: SttLocalModel,
  signal?: AbortSignal,
): Promise<SelfTest | null> {
  const res = await post(
    endpoint,
    "/warmup",
    JSON.stringify({ model }),
    { "Content-Type": "application/json" },
    signal,
    WARMUP_TIMEOUT_MS,
  );
  const parsed = (await res.json().catch(() => ({}))) as { selfTest?: unknown };
  const selfTest = parsed.selfTest as Partial<SelfTest> | undefined;
  if (!selfTest || typeof selfTest.ok !== "boolean") return null;
  const result = {
    ok: selfTest.ok,
    elapsedMs: typeof selfTest.elapsedMs === "number" ? selfTest.elapsedMs : 0,
  };
  rememberSelfTest(model, result);
  return result;
}

/** Ports whose model is already loaded, so warmup runs once per launch. */
const warmed = new Set<string>();

/**
 * The running dictation sidecar, started with the chosen device when it is
 * installed but stopped. Throws a message meant for a toast otherwise.
 */
export async function resolveTranscriber(
  model: SttLocalModel,
  device: TtsDevice,
  signal?: AbortSignal,
): Promise<TtsEndpoint> {
  const engine = STT_MODEL_ENGINE[model];
  const status = await sttNative.status();
  const entry = transcriberStatusOf(status, engine);
  if (!entry?.installed) throw new Error(NOT_INSTALLED_MESSAGE);
  if (!transcriberModelStatusOf(status, model)?.downloaded) {
    throw new Error(
      `${STT_MODEL_LABELS[model]} is not downloaded yet. Download it in Settings, Dictation.`,
    );
  }
  if (entry.plan && !entry.plan.supported) {
    throw new Error(
      entry.plan.unsupportedReason ??
        `${STT_ENGINE_LABELS[engine]} cannot run on this machine.`,
    );
  }
  const endpoint =
    entry.running && entry.port !== null && entry.token
      ? { port: entry.port, token: entry.token }
      : await sttNative.start(engine, device);
  const key = `${endpoint.port}:${model}`;
  if (!warmed.has(key)) {
    try {
      await warmupTranscriber(endpoint, model, signal);
      warmed.add(key);
    } catch (err) {
      if (signal?.aborted) throw err;
      // /transcribe loads the model too; a refused warmup is not fatal.
      console.debug("stt.warmup", err);
    }
  }
  return endpoint;
}

/** Forgets loaded models, e.g. after the engine was stopped from Settings. */
export function forgetWarmTranscribers(): void {
  warmed.clear();
}

// Measured speed and the last self-test, per model, for Settings. Kept in
// memory and mirrored to localStorage; losing them costs nothing.

const SPEED_KEY = "terax-stt-speed";

export type SttSpeed = {
  audioSeconds: number;
  elapsedSeconds: number;
  selfTest: SelfTest | null;
};

type SpeedMap = Partial<Record<SttLocalModel, SttSpeed>>;

let speedCache: SpeedMap | null = null;
const speedListeners = new Set<() => void>();

function readSpeed(): SpeedMap {
  if (speedCache) return speedCache;
  try {
    const raw = globalThis.localStorage?.getItem(SPEED_KEY);
    speedCache = raw ? (JSON.parse(raw) as SpeedMap) : {};
  } catch {
    speedCache = {};
  }
  return speedCache;
}

function writeSpeed(next: SpeedMap): void {
  speedCache = next;
  try {
    globalThis.localStorage?.setItem(SPEED_KEY, JSON.stringify(next));
  } catch {
    // Private storage or a full quota: the in-memory copy is enough.
  }
  for (const listener of speedListeners) listener();
}

function entryFor(map: SpeedMap, model: SttLocalModel): SttSpeed {
  return map[model] ?? { audioSeconds: 0, elapsedSeconds: 0, selfTest: null };
}

function recordTranscription(model: SttLocalModel, result: TranscribeResult): void {
  if (!(result.audioMs > 0) || !(result.elapsedMs > 0)) return;
  const map = readSpeed();
  const current = entryFor(map, model);
  // A decaying sum: recent dictations count more than old ones.
  const decay = current.audioSeconds > 600 ? 0.5 : 1;
  writeSpeed({
    ...map,
    [model]: {
      ...current,
      audioSeconds: current.audioSeconds * decay + result.audioMs / 1000,
      elapsedSeconds: current.elapsedSeconds * decay + result.elapsedMs / 1000,
    },
  });
}

function rememberSelfTest(model: SttLocalModel, selfTest: SelfTest): void {
  const map = readSpeed();
  writeSpeed({ ...map, [model]: { ...entryFor(map, model), selfTest } });
}

export function sttSpeedOf(model: SttLocalModel): SttSpeed | null {
  return readSpeed()[model] ?? null;
}

export function subscribeSttSpeed(listener: () => void): () => void {
  speedListeners.add(listener);
  return () => speedListeners.delete(listener);
}

/** "35x faster than real time", from what this machine measured. */
export function formatSttSpeed(speed: SttSpeed | null): string | null {
  if (!speed || !(speed.audioSeconds > 0) || !(speed.elapsedSeconds > 0)) return null;
  const factor = speed.audioSeconds / speed.elapsedSeconds;
  if (factor >= 10) return `${Math.round(factor)}x faster than real time`;
  return `${factor.toFixed(1)}x faster than real time`;
}
