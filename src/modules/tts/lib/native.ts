import { invoke } from "@tauri-apps/api/core";
import type { TtsDevice, TtsEngineId, TtsModelId } from "./engines";

export type TtsLayout = {
  root: string;
  runtime: string;
  engines: string;
  models: string;
  voices: string;
  logs: string;
};

export type TtsRuntimeInfo = {
  installed: boolean;
  uvVersion: string | null;
  pythonVersion: string | null;
};

export type TtsEngineStatus = {
  id: TtsEngineId;
  installed: boolean;
  specVersion: number | null;
  installedAt: number | null;
  /** Bumped when the pinned requirements change; the UI offers an update when it is ahead of specVersion. */
  latestSpecVersion: number;
  running: boolean;
  port: number | null;
  /** Per-launch bearer token. Never rendered and never logged. */
  token: string | null;
  device: TtsDevice | null;
  pid: number | null;
  sizeBytes: number;
};

export type TtsModelStatus = {
  id: TtsModelId;
  engine: TtsEngineId;
  downloaded: boolean;
  sizeBytes: number;
};

export const TTS_JOB_KINDS = [
  "runtime",
  "engine-install",
  "engine-remove",
  "model-download",
  "purge",
] as const;
export type TtsJobKind = (typeof TTS_JOB_KINDS)[number];

export type TtsJobState = "running" | "done" | "failed" | "cancelled";

export type TtsJob = {
  id: number;
  kind: TtsJobKind;
  engine: TtsEngineId | null;
  model: TtsModelId | null;
  state: TtsJobState;
  startedAtMs: number;
  exitCode: number | null;
};

export type TtsStatus = {
  runtime: TtsRuntimeInfo;
  engines: TtsEngineStatus[];
  models: TtsModelStatus[];
  jobs: TtsJob[];
  diskUsageBytes: number;
};

export type TtsJobLogs = {
  bytes: string;
  nextOffset: number;
  dropped: number;
  exited: boolean;
  exitCode: number | null;
};

export type TtsCacheEntry = {
  dirName: string;
  repo: string;
  sizeBytes: number;
  modifiedMs: number;
  model: TtsModelId | null;
};

export type TtsSampleImport = {
  sampleId: string;
  path: string;
  bytes: number;
};

export type TtsRevealTarget = "root" | "models" | "voices" | "logs";

export type TtsStartResult = { port: number; token: string };

export const ttsNative = {
  layout: () => invoke<TtsLayout>("tts_layout"),
  status: () => invoke<TtsStatus>("tts_status"),
  installRuntime: () => invoke<number>("tts_install_runtime"),
  installEngine: (engine: TtsEngineId) =>
    invoke<number>("tts_install_engine", { engine }),
  removeEngine: (engine: TtsEngineId) =>
    invoke<number>("tts_remove_engine", { engine }),
  downloadModel: (model: TtsModelId) =>
    invoke<number>("tts_download_model", { model }),
  removeModel: (model: TtsModelId) =>
    invoke<void>("tts_remove_model", { model }),
  jobLogs: (jobId: number, since: number) =>
    invoke<TtsJobLogs>("tts_job_logs", { jobId, since }),
  jobCancel: (jobId: number) => invoke<void>("tts_job_cancel", { jobId }),
  start: (engine: TtsEngineId, device: TtsDevice) =>
    invoke<TtsStartResult>("tts_start", { engine, device }),
  stop: (engine: TtsEngineId) => invoke<void>("tts_stop", { engine }),
  stopAll: () => invoke<void>("tts_stop_all"),
  modelsList: () => invoke<TtsCacheEntry[]>("tts_models_list"),
  modelsPurge: (dirName: string) =>
    invoke<void>("tts_models_purge", { dirName }),
  purgeAll: () => invoke<number>("tts_purge_all"),
  revealDir: (which: TtsRevealTarget) =>
    invoke<void>("tts_reveal_dir", { which }),
  /** Tauri maps a JSON number array to `Vec<u8>`. */
  sampleImport: (name: string, wav: Uint8Array) =>
    invoke<TtsSampleImport>("tts_sample_import", {
      name,
      wav: Array.from(wav),
    }),
  sampleRemove: (sampleId: string) =>
    invoke<void>("tts_sample_remove", { sampleId }),
};

export function engineStatusOf(
  status: TtsStatus | null,
  engine: TtsEngineId,
): TtsEngineStatus | null {
  return status?.engines.find((entry) => entry.id === engine) ?? null;
}

export function modelStatusOf(
  status: TtsStatus | null,
  model: TtsModelId,
): TtsModelStatus | null {
  return status?.models.find((entry) => entry.id === model) ?? null;
}

export function runningEnginesOf(status: TtsStatus | null): TtsEngineId[] {
  return (status?.engines ?? [])
    .filter((entry) => entry.running)
    .map((entry) => entry.id);
}

export function runningJobsOf(status: TtsStatus | null): TtsJob[] {
  return (status?.jobs ?? []).filter((job) => job.state === "running");
}

/** Cloned samples live at `<voices>/samples/<sampleId>.wav`, which is the
 *  directory the sidecar is told to accept sample paths from. */
export function samplePathFor(layout: TtsLayout, sampleId: string): string {
  const sep = layout.voices.includes("\\") ? "\\" : "/";
  const base = layout.voices.replace(/[/\\]+$/, "");
  return `${base}${sep}samples${sep}${sampleId}.wav`;
}
