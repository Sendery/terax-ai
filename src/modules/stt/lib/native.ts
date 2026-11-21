import { invoke } from "@tauri-apps/api/core";
import type { TtsDevice } from "@/modules/tts/lib/engines";
import type {
  TtsEnginePlan,
  TtsStartResult,
  TtsStatus,
} from "@/modules/tts/lib/native";
import type { SttEngineId } from "./catalog";
import type { SttLocalModel } from "./settings";

/** One local dictation engine, as `tts_status` reports it under
 *  `transcribers`. Same shape as a speech engine's entry. */
export type SttEngineStatus = {
  id: SttEngineId;
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

export type SttModelStatus = {
  id: SttLocalModel;
  engine: SttEngineId;
  downloaded: boolean;
  sizeBytes: number;
};

/** The speech status with the dictation engines the backend adds beside the
 *  reading ones. Absent from a backend older than dev.27. */
export type StatusWithTranscribers = TtsStatus & {
  transcribers?: SttEngineStatus[];
  transcriberModels?: SttModelStatus[];
};

export function transcriberStatusOf(
  status: TtsStatus | null | undefined,
  engine: SttEngineId,
): SttEngineStatus | null {
  const list = (status as StatusWithTranscribers | null | undefined)?.transcribers;
  return list?.find((entry) => entry.id === engine) ?? null;
}

export function transcriberModelStatusOf(
  status: TtsStatus | null | undefined,
  model: SttLocalModel,
): SttModelStatus | null {
  const list = (status as StatusWithTranscribers | null | undefined)
    ?.transcriberModels;
  return list?.find((entry) => entry.id === model) ?? null;
}

/** The same Tauri commands the reading engines use, with dictation ids. */
export const sttNative = {
  status: () => invoke<StatusWithTranscribers>("tts_status"),
  installEngine: (engine: SttEngineId, withModel = true) =>
    invoke<number>("tts_install_engine", { engine, withModel }),
  removeEngine: (engine: SttEngineId) =>
    invoke<number>("tts_remove_engine", { engine }),
  downloadModel: (model: SttLocalModel) =>
    invoke<number>("tts_download_model", { model }),
  removeModel: (model: SttLocalModel) =>
    invoke<void>("tts_remove_model", { model }),
  start: (engine: SttEngineId, device: TtsDevice) =>
    invoke<TtsStartResult>("tts_start", { engine, device }),
  stop: (engine: SttEngineId) => invoke<void>("tts_stop", { engine }),
};
