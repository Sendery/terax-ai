import { invoke } from "@tauri-apps/api/core";
import { TtsClientError } from "@/modules/tts/lib/client";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { TtsJob } from "@/modules/tts/lib/native";
import {
  STT_ENGINES,
  STT_MODEL_ENGINE,
  STT_TIERS,
  type SttEngineId,
} from "./catalog";
import { forgetWarmTranscribers, transcribePcm, warmupTranscriber } from "./client";
import {
  type SttEngineStatus,
  type SttModelStatus,
  sttNative,
  transcriberModelStatusOf,
  transcriberStatusOf,
} from "./native";
import { dictionaryContext, finishDictation, modeQuery } from "./postprocess";
import { STT_SAMPLE_RATE } from "./segmenter";
import { MAX_TRANSCRIBE_FILE_SECONDS, type SttLanguage, type SttMode } from "./settings";

/**
 * The dictation commands agents reach through the bridge (`dictation.*`): the
 * same engine and the same tidy-up the AI chat microphone uses, with an audio
 * file in place of the microphone.
 */

export type DictationEngineReport = Omit<SttEngineStatus, "token">;

export type DictationStatusReport = {
  provider: string;
  model: string;
  language: SttLanguage;
  mode: SttMode;
  liveSegments: boolean;
  dictionaryTerms: number;
  engines: DictationEngineReport[];
  models: SttModelStatus[];
  jobs: TtsJob[];
  tiers: {
    id: string;
    label: string;
    state: "available" | "planned";
    memory: string;
    asr: string;
    refiner: string;
    model: string | null;
  }[];
};

export type DictationTranscribeRequest = {
  path: string;
  spokenLanguage?: SttLanguage;
  writingStyle?: SttMode;
};

export type DictationTranscribeReport = {
  text: string;
  /** What the engine heard before the dictionary and the writing style. */
  raw: string;
  language: string | null;
  model: string;
  mode: SttMode;
  audioMs: number;
  elapsedMs: number;
};

function failed(message: string): { code: "command_failed"; message: string } {
  return { code: "command_failed", message };
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.length > 0) return error;
  return "The dictation engine refused the request.";
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      (error as { code?: unknown }).code === "command_failed"
    ) {
      throw error;
    }
    throw failed(messageOf(error));
  }
}

/** How long a transcription waits for a model that is still loading, inside
 *  the bridge's 15 s answer window. */
const LOADING_WAIT_MS = 10_000;
const LOADING_POLL_MS = 500;

async function whileLoading<T>(run: () => Promise<T>, waitMs = LOADING_WAIT_MS): Promise<T> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      return await run();
    } catch (error) {
      const loading = error instanceof TtsClientError && error.code === "loading";
      if (!loading || Date.now() + LOADING_POLL_MS > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, LOADING_POLL_MS));
    }
  }
}

function withoutToken(entry: SttEngineStatus): DictationEngineReport {
  const { token: _token, ...rest } = entry;
  return rest;
}

export async function dictationStatusCommand(): Promise<DictationStatusReport> {
  const status = await guarded(() => sttNative.status());
  const prefs = usePreferencesStore.getState();
  const engines = new Set<string>(STT_ENGINES);
  return {
    provider: prefs.sttProvider,
    model: prefs.sttLocalModel,
    language: prefs.sttLanguage,
    mode: prefs.sttMode,
    liveSegments: prefs.sttLiveSegments,
    dictionaryTerms: prefs.sttDictionary.length,
    engines: (status.transcribers ?? []).map(withoutToken),
    models: status.transcriberModels ?? [],
    jobs: status.jobs.filter((job) => job.engine !== null && engines.has(job.engine)),
    tiers: STT_TIERS.map((tier) => ({
      id: tier.id,
      label: tier.label,
      state: tier.state,
      memory: tier.memory,
      asr: tier.asr,
      refiner: tier.refiner,
      model: tier.model,
    })),
  };
}

export async function dictationInstallCommand(
  engine: SttEngineId = "rumble",
  withModel = true,
): Promise<{ jobId: number }> {
  // The runtime comes first when it is missing, then the engine and, unless
  // told otherwise, its model, all in one job.
  const jobId = await guarded(() => sttNative.installEngine(engine, withModel));
  return { jobId };
}

/**
 * Fire and forget, like `tts.start`: loading the model outlasts the bridge's
 * timeout, so the caller polls `dictation.status` until the engine runs.
 */
export function dictationStartCommand(engine: SttEngineId = "rumble"): {
  engine: SttEngineId;
  starting: true;
} {
  const { sttDevice, sttLocalModel } = usePreferencesStore.getState();
  void sttNative
    .start(engine, sttDevice)
    .then((endpoint) => warmupTranscriber(endpoint, sttLocalModel))
    .catch((error) => console.warn("dictation.start", messageOf(error)));
  return { engine, starting: true };
}

export async function dictationStopCommand(
  engine: SttEngineId = "rumble",
): Promise<{ stopped: SttEngineId[] }> {
  const status = await guarded(() => sttNative.status());
  if (!transcriberStatusOf(status, engine)?.running) return { stopped: [] };
  await guarded(() => sttNative.stop(engine));
  forgetWarmTranscribers();
  return { stopped: [engine] };
}

/** Mono 16 kHz samples of any audio the webview can decode. */
export async function decodeTo16k(bytes: ArrayBuffer): Promise<Float32Array> {
  const context = new OfflineAudioContext(1, 1, STT_SAMPLE_RATE);
  // decodeAudioData resamples to the context's rate.
  const buffer = await context.decodeAudioData(bytes);
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
  const mono = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < channel.length; i++) {
      mono[i] += channel[i] / buffer.numberOfChannels;
    }
  }
  return mono;
}

export async function dictationTranscribeCommand(
  request: DictationTranscribeRequest,
): Promise<DictationTranscribeReport> {
  return guarded(async () => {
    const prefs = usePreferencesStore.getState();
    const model = prefs.sttLocalModel;
    const engine = STT_MODEL_ENGINE[model];
    const status = await sttNative.status();
    const entry = transcriberStatusOf(status, engine);
    if (!entry?.installed) {
      throw new Error("The dictation engine is not installed. Run dictation.install first.");
    }
    if (!transcriberModelStatusOf(status, model)?.downloaded) {
      throw new Error(`The ${model} model is not downloaded. Run dictation.install first.`);
    }
    if (!entry.running || entry.port === null || !entry.token) {
      throw new Error(
        "The dictation engine is not running. Run dictation.start and poll dictation.status until it runs.",
      );
    }
    const bytes = await invoke<ArrayBuffer>("stt_read_audio_file", { path: request.path });
    let pcm: Float32Array;
    try {
      pcm = await decodeTo16k(bytes);
    } catch (error) {
      throw new Error(`Could not decode ${request.path} as audio (${messageOf(error)}).`);
    }
    const seconds = pcm.length / STT_SAMPLE_RATE;
    if (seconds > MAX_TRANSCRIBE_FILE_SECONDS) {
      throw new Error(
        `The clip lasts ${Math.round(seconds)} s; dictation.transcribe takes up to ${MAX_TRANSCRIBE_FILE_SECONDS} s.`,
      );
    }
    const mode = request.writingStyle ?? prefs.sttMode;
    const endpoint = { port: entry.port, token: entry.token };
    // Right after dictation.start the model may still be loading.
    const result = await whileLoading(() =>
      transcribePcm(endpoint, pcm, {
        model,
        language: request.spokenLanguage ?? prefs.sttLanguage,
        ...modeQuery(mode),
        context: dictionaryContext(prefs.sttDictionary),
      }),
    );
    return {
      text: finishDictation([result.text], mode, prefs.sttDictionary),
      raw: result.text,
      language: result.language,
      model,
      mode,
      audioMs: result.audioMs,
      elapsedMs: result.elapsedMs,
    };
  });
}
