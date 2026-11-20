import type { TtsEngineId } from "@/modules/tts/lib/engines";
import { engineStatusOf, type TtsStatus } from "@/modules/tts/lib/native";

/** Whether any surface should offer speech at all. */
export function hasInstalledEngine(status: TtsStatus | null): boolean {
  return (status?.engines ?? []).some((entry) => entry.installed);
}

export function isEngineRunning(
  status: TtsStatus | null,
  engine: TtsEngineId,
): boolean {
  return engineStatusOf(status, engine)?.running ?? false;
}
