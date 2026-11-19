import { usePreferencesStore } from "@/modules/settings/preferences";
import { usePiModelsStore } from "../cli/piModels";

export const PI_MODEL_ID = "cli-pi-agent";

/** Short label for the trigger: the chosen Pi model, or Pi's own default. */
export function usePiModelLabel(): string {
  const piModel = usePreferencesStore((s) => s.piModel);
  const defaults = usePiModelsStore((s) => s.defaults);
  if (piModel) return piModel.split("/").pop() ?? piModel;
  return defaults?.defaultModel ?? "default";
}
