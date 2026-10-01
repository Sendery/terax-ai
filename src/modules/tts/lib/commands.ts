import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  listVoices,
  resolveActiveVoice,
  type VoiceListEntry,
} from "@/modules/tts/lib/activeVoice";
import { splitForSpeech } from "@/modules/tts/lib/chunk";
import {
  engineOf,
  type TtsEngineId,
  type TtsLanguage,
  type TtsModelId,
} from "@/modules/tts/lib/engines";
import {
  runningEnginesOf,
  ttsNative,
  type TtsEngineStatus,
  type TtsJob,
  type TtsModelStatus,
  type TtsRuntimeInfo,
} from "@/modules/tts/lib/native";
import { speakText, stopSpeaking } from "@/modules/tts/lib/useSpeaker";
import { useTtsStore } from "@/modules/tts/store/ttsStore";

/** Engine status as the command registry reports it: the per-launch bearer
 *  token never leaves the window. */
export type TtsEngineReport = Omit<TtsEngineStatus, "token">;

export type TtsSpeechReport = {
  speaking: boolean;
  voiceId: string | null;
  progress: { index: number; total: number };
  error: string | null;
};

export type TtsStatusReport = {
  runtime: TtsRuntimeInfo;
  engines: TtsEngineReport[];
  models: TtsModelStatus[];
  jobs: TtsJob[];
  diskUsageBytes: number;
  speech: TtsSpeechReport;
};

export type TtsSpeakRequest = {
  text: string;
  voiceId?: string;
  language?: TtsLanguage;
};

export type TtsSpeakReport = {
  voiceId: string;
  chunks: number;
  truncated: boolean;
  started: true;
};

/** The registry's `command_failed` shape: a failure the caller can act on,
 *  as opposed to an internal error. */
function failed(message: string): { code: "command_failed"; message: string } {
  return { code: "command_failed", message };
}

function speechReport(): TtsSpeechReport {
  const { speaking, currentVoice, progress, error } = useTtsStore.getState();
  return {
    speaking,
    voiceId: currentVoice?.id ?? null,
    progress,
    error,
  };
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.length > 0) return error;
  return "The local speech stack refused the request.";
}

function reportError(error: unknown): void {
  useTtsStore.getState().setSpeech({ error: messageOf(error) });
}

/** A rejected `tts_*` invoke is a caller-visible failure, not an app bug: the
 *  engine is missing, the model is not downloaded, the sidecar is gone. */
async function fromNative<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw failed(messageOf(error));
  }
}

export async function ttsStatusCommand(): Promise<TtsStatusReport> {
  const status = await fromNative(() => ttsNative.status());
  useTtsStore.getState().setStatus(status);
  return {
    runtime: status.runtime,
    engines: status.engines.map((engine) => ({
      id: engine.id,
      installed: engine.installed,
      specVersion: engine.specVersion,
      installedAt: engine.installedAt,
      latestSpecVersion: engine.latestSpecVersion,
      running: engine.running,
      port: engine.port,
      device: engine.device,
      pid: engine.pid,
      sizeBytes: engine.sizeBytes,
    })),
    models: status.models,
    jobs: status.jobs,
    diskUsageBytes: status.diskUsageBytes,
    speech: speechReport(),
  };
}

/**
 * Fire and forget: loading a model takes far longer than the bridge's 15 s UI
 * timeout, so the command reports that the start was requested and the caller
 * polls `tts.status`. A failure lands in the store's error field.
 */
export function ttsStartCommand(engine: TtsEngineId): {
  engine: TtsEngineId;
  starting: true;
} {
  const device = usePreferencesStore.getState().ttsDevice;
  void ttsNative
    .start(engine, device)
    .then(() => {
      const running = useTtsStore.getState().runningEngines;
      if (running.includes(engine)) return;
      useTtsStore.getState().setRunningEngines([...running, engine]);
    })
    .catch(reportError);
  return { engine, starting: true };
}

export async function ttsStopCommand(
  engine?: TtsEngineId,
): Promise<{ stopped: TtsEngineId[] }> {
  const status = await fromNative(() => ttsNative.status());
  useTtsStore.getState().setStatus(status);
  const running = runningEnginesOf(status);
  const targets = engine
    ? running.filter((candidate) => candidate === engine)
    : running;
  if (targets.length === 0) return { stopped: [] };
  const voice = useTtsStore.getState().currentVoice;
  if (voice && targets.includes(engineOf(voice.model))) stopSpeaking();
  const stopped: TtsEngineId[] = [];
  for (const target of targets) {
    try {
      await ttsNative.stop(target);
      stopped.push(target);
    } catch (error) {
      reportError(error);
    }
  }
  useTtsStore
    .getState()
    .setRunningEngines(running.filter((id) => !stopped.includes(id)));
  return { stopped };
}

export async function ttsInstallCommand(
  engine: TtsEngineId,
): Promise<{ jobId: number }> {
  // The Rust side installs the runtime first when it is missing.
  const jobId = await fromNative(() => ttsNative.installEngine(engine));
  return { jobId };
}

export async function ttsDownloadCommand(
  model: TtsModelId,
): Promise<{ jobId: number }> {
  const jobId = await fromNative(() => ttsNative.downloadModel(model));
  return { jobId };
}

export async function ttsVoicesCommand(): Promise<{
  voices: VoiceListEntry[];
}> {
  return { voices: await fromNative(() => listVoices()) };
}

/**
 * Resolves the voice first so a missing profile is a caller error, then starts
 * the queue without waiting: the engine start and the first synthesis together
 * outlast the bridge's UI timeout. Progress is observable through `tts.status`.
 */
export async function ttsSpeakCommand(
  request: TtsSpeakRequest,
): Promise<TtsSpeakReport> {
  const voice = await resolveActiveVoice({
    voiceId: request.voiceId,
    language: request.language,
  });
  if (!voice) {
    throw failed(
      "No voice profile matches the request. Add one in Settings, Voice, or call tts.voices.",
    );
  }
  const { chunks, truncated } = splitForSpeech(request.text);
  if (chunks.length === 0) {
    throw failed("The text has nothing speakable in it.");
  }
  void speakText(request.text, { voiceId: voice.id }).catch(() => {
    // speakText already routes the message into the store error field.
  });
  return {
    voiceId: voice.id,
    chunks: chunks.length,
    truncated,
    started: true,
  };
}

export function ttsStopSpeakingCommand(): { stopped: boolean } {
  return { stopped: stopSpeaking() };
}
