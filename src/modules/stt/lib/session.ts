import type { TtsEndpoint } from "@/modules/tts/lib/client";
import type { TtsDevice } from "@/modules/tts/lib/engines";
import { resolveTranscriber, transcribePcm } from "./client";
import { dictionaryContext, finishDictation, modeQuery } from "./postprocess";
import { DictationRecorder } from "./recorder";
import { STT_SAMPLE_RATE } from "./segmenter";
import type {
  SttDictionaryEntry,
  SttLanguage,
  SttLocalModel,
  SttMode,
} from "./settings";

export type LocalDictationSettings = {
  model: SttLocalModel;
  device: TtsDevice;
  language: SttLanguage;
  mode: SttMode;
  dictionary: SttDictionaryEntry[];
  /** Transcribe each segment as soon as a pause closes it. */
  live: boolean;
};

export type SegmentTranscriber = (
  endpoint: TtsEndpoint,
  pcm: Float32Array,
  signal: AbortSignal,
) => Promise<string>;

type Deps = {
  resolve: (signal: AbortSignal) => Promise<TtsEndpoint>;
  transcribe: SegmentTranscriber;
};

/**
 * Orders the segment transcriptions of one dictation. Segments are queued as
 * the recorder cuts them and posted one at a time, in order; with live
 * segments on, all but the last are done by the time the user stops.
 */
export class SegmentQueue {
  private readonly deps: Deps;
  private readonly live: boolean;
  private readonly controller = new AbortController();
  private endpoint: Promise<TtsEndpoint> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private readonly held: Float32Array[] = [];
  private readonly texts: string[] = [];
  private failure: unknown = null;

  constructor(deps: Deps, live: boolean) {
    this.deps = deps;
    this.live = live;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Starts the engine early so the first segment does not wait for it. */
  prepare(): Promise<TtsEndpoint> {
    if (!this.endpoint) {
      this.endpoint = this.deps.resolve(this.controller.signal);
      // Reported when the first segment needs it, not as an unhandled rejection.
      this.endpoint.catch(() => undefined);
    }
    return this.endpoint;
  }

  push(pcm: Float32Array): void {
    if (this.controller.signal.aborted) return;
    if (!this.live) {
      this.held.push(pcm);
      return;
    }
    this.enqueue(pcm);
  }

  private enqueue(pcm: Float32Array): void {
    const index = this.texts.length;
    this.texts.push("");
    this.chain = this.chain.then(async () => {
      if (this.failure || this.controller.signal.aborted) return;
      try {
        const endpoint = await this.prepare();
        this.texts[index] = await this.deps.transcribe(
          endpoint,
          pcm,
          this.controller.signal,
        );
      } catch (err) {
        this.failure = err;
      }
    });
  }

  /** Waits for every segment and returns the transcripts in order. */
  async finish(): Promise<string[]> {
    for (const pcm of this.held.splice(0)) this.enqueue(pcm);
    await this.chain;
    if (this.failure) throw this.failure;
    return [...this.texts];
  }

  cancel(): void {
    this.controller.abort();
  }
}

export type LocalDictation = {
  /** 0..1 loudness for a meter. */
  level: () => number;
  /** Stops recording and resolves with the finished text. */
  stop: () => Promise<string>;
  cancel: () => void;
};

/**
 * Records from the microphone and transcribes on this machine. The engine is
 * started while the user is already speaking.
 */
export async function startLocalDictation(
  settings: LocalDictationSettings,
): Promise<LocalDictation> {
  const query = modeQuery(settings.mode);
  const context = dictionaryContext(settings.dictionary);
  const queue = new SegmentQueue(
    {
      resolve: (signal) => resolveTranscriber(settings.model, settings.device, signal),
      transcribe: async (endpoint, pcm, signal) =>
        (
          await transcribePcm(endpoint, pcm, {
            model: settings.model,
            language: settings.language,
            ...query,
            context,
            signal,
          })
        ).text,
    },
    settings.live,
  );
  // Fails fast when nothing is installed, before the microphone opens.
  const ready = queue.prepare();
  const recorder = new DictationRecorder({
    onSegment: (pcm) => queue.push(pcm),
    holdUntilStop: !settings.live,
  });
  try {
    await Promise.race([
      recorder.start(),
      // An install problem should not wait for the permission prompt.
      ready.then(() => new Promise<void>(() => undefined)),
    ]);
  } catch (err) {
    recorder.cancel();
    queue.cancel();
    throw err;
  }
  ready.catch(() => {
    // The error surfaces from stop(), with the first segment.
  });
  return {
    level: () => recorder.level,
    stop: async () => {
      recorder.stop();
      const parts = await queue.finish();
      return finishDictation(parts, settings.mode, settings.dictionary);
    },
    cancel: () => {
      recorder.cancel();
      queue.cancel();
    },
  };
}

/** Transcribes a finished recording (any format the webview decodes). */
export async function transcribeBlobLocally(
  blob: Blob,
  settings: Omit<LocalDictationSettings, "live">,
): Promise<string> {
  if (typeof OfflineAudioContext === "undefined") {
    throw new Error("This webview cannot decode audio.");
  }
  const decoder = new OfflineAudioContext(1, 1, STT_SAMPLE_RATE);
  const decoded = await decoder.decodeAudioData(await blob.arrayBuffer());
  const frames = Math.max(1, Math.ceil(decoded.duration * STT_SAMPLE_RATE));
  const renderer = new OfflineAudioContext(1, frames, STT_SAMPLE_RATE);
  const source = renderer.createBufferSource();
  source.buffer = decoded;
  source.connect(renderer.destination);
  source.start();
  const rendered = await renderer.startRendering();
  const endpoint = await resolveTranscriber(settings.model, settings.device);
  const result = await transcribePcm(endpoint, rendered.getChannelData(0), {
    model: settings.model,
    language: settings.language,
    ...modeQuery(settings.mode),
    context: dictionaryContext(settings.dictionary),
  });
  return finishDictation([result.text], settings.mode, settings.dictionary);
}
