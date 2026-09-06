import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  synthesize,
  TtsClientError,
  warmup,
  type TtsEndpoint,
} from "@/modules/tts/lib/client";
import {
  ENGINE_LABELS,
  engineOf,
  MODEL_LABELS,
  MODEL_VOICE_SOURCE,
  PREVIEW_SENTENCES,
  type TtsLanguage,
} from "@/modules/tts/lib/engines";
import {
  engineStatusOf,
  modelStatusOf,
  runningEnginesOf,
  samplePathFor,
  ttsNative,
} from "@/modules/tts/lib/native";
import {
  chunksToSynthesize,
  currentAudioUrl,
  initialPlaybackState,
  isPaused,
  isSpeaking,
  playbackProgress,
  playbackReducer,
  seekTarget,
  type PlaybackEvent,
  type PlaybackState,
} from "@/modules/tts/lib/playback";
import { splitForSpeech } from "@/modules/tts/lib/chunk";
import {
  previewOf,
  type SpeechHistoryEntry,
} from "@/modules/tts/lib/history";
import { isProfileSpeakable, resolveVoice, type VoiceProfile } from "@/modules/tts/lib/voices";
import { useTtsStore } from "@/modules/tts/store/ttsStore";

export type SpeakOptions = {
  voiceId?: string | null;
  language?: TtsLanguage | null;
  /** False for utterances that are not worth remembering, such as the
   *  one-line preview played from Settings. */
  remember?: boolean;
};

export type SpeakResult = {
  chunks: number;
  voiceId: string;
  truncated: boolean;
};

type Session = {
  id: number;
  state: PlaybackState;
  voice: VoiceProfile;
  endpoint: TtsEndpoint;
  samplePath: string | null;
  inFlight: Map<number, AbortController>;
  urls: Map<number, string>;
  attachedUrl: string | null;
  /** Set by a seek that lands on the chunk already loaded. */
  restart: boolean;
};

// One element for the whole window: two overlapping utterances would be noise,
// and a per-utterance element leaks decoders in WKWebView.
let audio: HTMLAudioElement | null = null;
let session: Session | null = null;
let sessionSeq = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const warmed = new Set<string>();

function element(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
    audio.onended = () => {
      const active = session;
      if (!active || active.state.playing === null) return;
      dispatch(active, { type: "ended", index: active.state.playing });
    };
    // The only source of elapsed time: the queue knows chunks, not seconds.
    audio.ontimeupdate = () => {
      if (!session || !audio) return;
      publishTime(audio.currentTime, audio.duration);
    };
    audio.ondurationchange = () => {
      if (!session || !audio) return;
      publishTime(audio.currentTime, audio.duration);
    };
    audio.onerror = () => {
      const active = session;
      if (!active || !audio?.currentSrc) return;
      dispatch(active, {
        type: "error",
        index: active.state.playing ?? active.state.cursor,
        message: "The audio device rejected the generated speech.",
      });
    };
  }
  return audio;
}

function publishTime(elapsed: number, duration: number): void {
  useTtsStore.getState().setSpeech({
    elapsed: Number.isFinite(elapsed) ? elapsed : 0,
    duration: Number.isFinite(duration) ? duration : 0,
  });
}

function detachAudio(): void {
  if (!audio) return;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

function messageOf(err: unknown): string {
  if (err instanceof TtsClientError) return err.message;
  if (err instanceof Error) return err.message;
  return "Speech synthesis failed.";
}

function syncStore(active: Session): void {
  useTtsStore.getState().setSpeech({
    speaking: isSpeaking(active.state),
    paused: isPaused(active.state),
    currentVoice: active.voice,
    progress: playbackProgress(active.state),
    error: active.state.error,
  });
}

function gcUrls(active: Session): void {
  for (const [index, url] of [...active.urls]) {
    if (active.state.ready[index] !== undefined) continue;
    if (url === active.attachedUrl) continue;
    URL.revokeObjectURL(url);
    active.urls.delete(index);
  }
}

function finish(active: Session): void {
  if (session !== active) return;
  session = null;
  detachAudio();
  for (const url of active.urls.values()) URL.revokeObjectURL(url);
  active.urls.clear();
  active.attachedUrl = null;
  useTtsStore.getState().setSpeech({
    speaking: false,
    paused: false,
    currentVoice: null,
    progress: { index: 0, total: 0 },
    elapsed: 0,
    duration: 0,
    error: active.state.error,
  });
  armIdleTimer();
}

function dispatch(active: Session, event: PlaybackEvent): void {
  if (session !== active) return;
  active.state = playbackReducer(active.state, event);
  syncStore(active);
  pump(active);
}

function pump(active: Session): void {
  if (session !== active) return;
  for (const index of chunksToSynthesize(
    active.state,
    new Set(active.inFlight.keys()),
  )) {
    void synthesizeChunk(active, index);
  }

  const url = currentAudioUrl(active.state);
  const el = element();
  if (el && isPaused(active.state) && !el.paused) el.pause();
  if (url && el && (active.attachedUrl !== url || active.restart)) {
    // Assigning the same src again is a no-op in WebKit, so a seek back onto
    // the chunk already loaded rewinds the element by hand instead.
    const sameChunk = active.attachedUrl === url;
    active.restart = false;
    active.attachedUrl = url;
    if (sameChunk) {
      el.currentTime = 0;
    } else {
      el.src = url;
    }
    void el.play().catch((err: unknown) => {
      if (session !== active) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      dispatch(active, {
        type: "error",
        index: active.state.playing ?? active.state.cursor,
        message: messageOf(err),
      });
    });
  }

  if (!isSpeaking(active.state)) {
    finish(active);
    return;
  }
  gcUrls(active);
}

async function synthesizeChunk(active: Session, index: number): Promise<void> {
  const controller = new AbortController();
  active.inFlight.set(index, controller);
  try {
    const blob = await synthesize(
      active.endpoint,
      {
        model: active.voice.model,
        text: active.state.chunks[index],
        language: active.voice.language,
        voice: active.voice.voice,
        samplePath: active.samplePath,
        params: active.voice.params,
      },
      { signal: controller.signal },
    );
    if (session !== active) return;
    const url = URL.createObjectURL(blob);
    active.urls.set(index, url);
    dispatch(active, { type: "synthesized", index, url });
  } catch (err) {
    if (session !== active) return;
    if (err instanceof TtsClientError && err.code === "aborted") return;
    dispatch(active, { type: "error", index, message: messageOf(err) });
  } finally {
    active.inFlight.delete(index);
  }
}

function clearIdleTimer(): void {
  if (idleTimer === null) return;
  clearTimeout(idleTimer);
  idleTimer = null;
}

/** Armed only while an engine is up, so an unused feature holds no timer. */
function armIdleTimer(): void {
  clearIdleTimer();
  const minutes = usePreferencesStore.getState().ttsIdleStopMinutes;
  if (minutes <= 0) return;
  if (useTtsStore.getState().runningEngines.length === 0) return;
  idleTimer = setTimeout(
    () => {
      idleTimer = null;
      void stopEngines();
    },
    minutes * 60_000,
  );
}

/** Shuts the sidecars down so an idle install costs no RAM. */
export async function stopEngines(): Promise<boolean> {
  clearIdleTimer();
  const engines = useTtsStore.getState().runningEngines;
  if (engines.length === 0) return false;
  let stopped = false;
  for (const engine of engines) {
    try {
      await ttsNative.stop(engine);
      stopped = true;
    } catch {
      // Reported by the next status read; nothing useful to show here.
    }
  }
  warmed.clear();
  useTtsStore.getState().setRunningEngines([]);
  return stopped;
}

async function resolveEndpoint(voice: VoiceProfile): Promise<TtsEndpoint> {
  const engine = engineOf(voice.model);
  const status = await ttsNative.status();
  useTtsStore.getState().setStatus(status);
  const entry = engineStatusOf(status, engine);
  if (!entry?.installed) {
    throw new Error(
      `${ENGINE_LABELS[engine]} is not installed yet. Install it in Settings, Voice.`,
    );
  }
  if (!modelStatusOf(status, voice.model)?.downloaded) {
    throw new Error(
      `${MODEL_LABELS[voice.model]} is not downloaded yet. Download it in Settings, Voice.`,
    );
  }
  if (entry.running && entry.port !== null && entry.token) {
    return { port: entry.port, token: entry.token };
  }
  const device = usePreferencesStore.getState().ttsDevice;
  const started = await ttsNative.start(engine, device);
  useTtsStore.getState().setRunningEngines([
    ...new Set([...runningEnginesOf(status), engine]),
  ]);
  return started;
}

async function resolveSamplePath(voice: VoiceProfile): Promise<string | null> {
  if (MODEL_VOICE_SOURCE[voice.model] === "preset") return null;
  if (!voice.sampleId) return null;
  const layout = await ttsNative.layout();
  return samplePathFor(layout, voice.sampleId);
}

/**
 * Speaks `text` with the resolved voice, chunk by chunk. Resolves once the
 * queue is running; playback state is observable through the store.
 */
export async function speakText(
  text: string,
  options: SpeakOptions = {},
): Promise<SpeakResult | null> {
  stopSpeaking();
  clearIdleTimer();
  const store = useTtsStore.getState();
  store.setSpeech({ error: null });
  await store.hydrate();
  const { profiles, defaults } = useTtsStore.getState();
  const { ttsDefaultLanguage } = usePreferencesStore.getState();
  const voice = resolveVoice(
    profiles,
    defaults,
    { ttsDefaultLanguage },
    options,
  );
  if (!voice) {
    const message = "No voice profile is configured. Add one in Settings, Voice.";
    useTtsStore.getState().setSpeech({ error: message });
    throw new Error(message);
  }
  if (!isProfileSpeakable(voice)) {
    const message = `The voice "${voice.name}" still needs ${
      MODEL_VOICE_SOURCE[voice.model] === "preset" ? "a preset" : "a voice sample"
    }.`;
    useTtsStore.getState().setSpeech({ error: message });
    throw new Error(message);
  }

  const { chunks, truncated } = splitForSpeech(text);
  if (chunks.length === 0) return null;

  let endpoint: TtsEndpoint;
  let samplePath: string | null;
  try {
    endpoint = await resolveEndpoint(voice);
    samplePath = await resolveSamplePath(voice);
  } catch (err) {
    const message = messageOf(err);
    useTtsStore.getState().setSpeech({ error: message });
    throw err instanceof Error ? err : new Error(message);
  }

  const warmKey = `${endpoint.port}:${voice.model}`;
  if (!warmed.has(warmKey)) {
    try {
      await warmup(endpoint, voice.model);
      warmed.add(warmKey);
    } catch (err) {
      // A refused warmup is not fatal: /synthesize loads the model too.
      console.debug("tts.warmup", err);
    }
  }

  sessionSeq += 1;
  const active: Session = {
    id: sessionSeq,
    state: initialPlaybackState,
    voice,
    endpoint,
    samplePath,
    inFlight: new Map(),
    urls: new Map(),
    attachedUrl: null,
    restart: false,
  };
  session = active;
  if (options.remember !== false) {
    useTtsStore.getState().remember({
      id: `s-${active.id}`,
      text,
      preview: previewOf(text),
      voiceId: voice.id,
      voiceName: voice.name,
      model: voice.model,
      at: Date.now(),
      chunks: chunks.length,
    });
  }
  dispatch(active, { type: "enqueue", chunks });
  return { chunks: chunks.length, voiceId: voice.id, truncated };
}

/** Speaks the localized preview line with one specific profile. */
export async function previewVoice(
  profile: VoiceProfile,
): Promise<SpeakResult | null> {
  return speakText(PREVIEW_SENTENCES[profile.language], {
    voiceId: profile.id,
    remember: false,
  });
}

/** Pauses the sound without giving up the queue or the audio already made. */
export function pauseSpeaking(): boolean {
  const active = session;
  if (!active || active.state.phase !== "playing") return false;
  dispatch(active, { type: "pause" });
  return true;
}

export function resumeSpeaking(): boolean {
  const active = session;
  if (!active || !isPaused(active.state)) return false;
  dispatch(active, { type: "resume" });
  const el = element();
  // The element still holds the chunk, so this continues where it stopped.
  if (el && currentAudioUrl(active.state)) void el.play().catch(() => {});
  return true;
}

export function togglePauseSpeaking(): boolean {
  return pauseSpeaking() || resumeSpeaking();
}

/**
 * Steps `delta` chunks through the utterance. Stepping back into a chunk whose
 * audio was dropped re-synthesizes it, which is why the window exists.
 */
export function seekSpeaking(delta: number): boolean {
  const active = session;
  if (!active) return false;
  const el = element();
  const target = seekTarget(active.state, delta, el?.currentTime ?? 0);
  if (target === null) return false;
  const from = active.state.playing ?? active.state.cursor;
  // Landing on the chunk already sounding means "play it again from the top".
  if (delta < 0 && target === from && el && el.currentTime > 0) {
    el.currentTime = 0;
    return true;
  }
  if (target === from) return false;
  active.restart = target === from;
  dispatch(active, { type: "seek", index: target });
  return true;
}

/** Aborts in-flight synthesis and silences the element. Safe when idle. */
export function stopSpeaking(): boolean {
  const active = session;
  if (!active) {
    detachAudio();
    return false;
  }
  const was = isSpeaking(active.state);
  for (const controller of active.inFlight.values()) controller.abort();
  active.state = playbackReducer(active.state, { type: "stop" });
  finish(active);
  return was;
}

/** Reads a history entry again, with the voice it was read with. */
export async function replayHistory(
  entry: SpeechHistoryEntry,
): Promise<SpeakResult | null> {
  return speakText(entry.text, { voiceId: entry.voiceId });
}

export function useSpeaker() {
  const speaking = useTtsStore((s) => s.speaking);
  const paused = useTtsStore((s) => s.paused);
  const currentVoice = useTtsStore((s) => s.currentVoice);
  const progress = useTtsStore((s) => s.progress);
  const elapsed = useTtsStore((s) => s.elapsed);
  const duration = useTtsStore((s) => s.duration);
  const history = useTtsStore((s) => s.history);
  const error = useTtsStore((s) => s.error);
  const runningEngines = useTtsStore((s) => s.runningEngines);
  const clearError = useTtsStore((s) => s.clearError);
  const forgetHistory = useTtsStore((s) => s.forgetHistory);
  return {
    speaking,
    paused,
    currentVoice,
    progress,
    elapsed,
    duration,
    history,
    error,
    runningEngines,
    speak: speakText,
    preview: previewVoice,
    replay: replayHistory,
    pause: pauseSpeaking,
    resume: resumeSpeaking,
    togglePause: togglePauseSpeaking,
    seek: seekSpeaking,
    stop: stopSpeaking,
    stopEngines,
    clearError,
    forgetHistory,
  };
}
