import { invoke } from "@tauri-apps/api/core";
import type { TtsDevice } from "@/modules/tts/lib/engines";
import type {
  TtsEnginePlan,
  TtsStartResult,
  TtsStatus,
} from "@/modules/tts/lib/native";
import type { CleanupEngineId, CleanupModelId } from "./catalog";

/** One cleanup engine, as `tts_status` reports it under `cleaners`. Same
 *  shape as a speech engine's entry. */
export type CleanupEngineStatus = {
  id: CleanupEngineId;
  installed: boolean;
  specVersion: number | null;
  installedAt: number | null;
  latestSpecVersion: number;
  running: boolean;
  port: number | null;
  /** Per-launch bearer token. Never rendered and never logged. */
  token: string | null;
  device: TtsDevice | null;
  pid: number | null;
  sizeBytes: number;
  plan?: TtsEnginePlan;
  pythonVersion?: string;
  torchBackend?: string | null;
};

export type CleanupModelStatus = {
  id: CleanupModelId;
  engine: CleanupEngineId;
  downloaded: boolean;
  sizeBytes: number;
};

/** The speech status with the cleanup engines. Absent from an older backend. */
export type StatusWithCleaners = TtsStatus & {
  cleaners?: CleanupEngineStatus[];
  cleanerModels?: CleanupModelStatus[];
};

export function cleanerStatusOf(
  status: TtsStatus | null | undefined,
  engine: CleanupEngineId,
): CleanupEngineStatus | null {
  const list = (status as StatusWithCleaners | null | undefined)?.cleaners;
  return list?.find((entry) => entry.id === engine) ?? null;
}

export function cleanerModelStatusOf(
  status: TtsStatus | null | undefined,
  model: CleanupModelId,
): CleanupModelStatus | null {
  const list = (status as StatusWithCleaners | null | undefined)?.cleanerModels;
  return list?.find((entry) => entry.id === model) ?? null;
}

/** The same Tauri commands every speech engine uses, with cleanup ids. */
export const isolatorNative = {
  status: () => invoke<StatusWithCleaners>("tts_status"),
  installEngine: (engine: CleanupEngineId, withModel = true) =>
    invoke<number>("tts_install_engine", { engine, withModel }),
  removeEngine: (engine: CleanupEngineId) =>
    invoke<number>("tts_remove_engine", { engine }),
  downloadModel: (model: CleanupModelId) =>
    invoke<number>("tts_download_model", { model }),
  removeModel: (model: CleanupModelId) =>
    invoke<void>("tts_remove_model", { model }),
  start: (engine: CleanupEngineId, device: TtsDevice) =>
    invoke<TtsStartResult>("tts_start", { engine, device }),
  stop: (engine: CleanupEngineId) => invoke<void>("tts_stop", { engine }),
};
