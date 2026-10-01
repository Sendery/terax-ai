import {
  engineOf,
  MODEL_LABELS,
  type TtsEngineId,
  type TtsLanguage,
  type TtsModelId,
  TTS_MODELS,
} from "@/modules/tts/lib/engines";
import {
  engineStatusOf,
  modelStatusOf,
  type TtsStatus,
} from "@/modules/tts/lib/native";
import { isProfileSpeakable, type VoiceProfile } from "@/modules/tts/lib/voices";

export type ModelChoice = {
  id: TtsModelId;
  label: string;
  engine: TtsEngineId;
  /** The profile switching to this model would speak with, if there is one. */
  profileId: string | null;
  /** Null when the model can be picked; otherwise why it cannot. */
  blockedReason: string | null;
};

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

/**
 * The models offered by the status-bar picker, in catalogue order, each already
 * carrying the profile that switching to it would select. A model with no
 * speakable profile in `language` is listed but blocked: the reason belongs in
 * the menu, where it can be read, rather than behind a hidden item.
 */
export function modelChoices(
  status: TtsStatus | null,
  profiles: readonly VoiceProfile[],
  language: TtsLanguage,
): ModelChoice[] {
  return TTS_MODELS.map((id) => {
    const engine = engineOf(id);
    const profile = profiles.find(
      (p) => p.model === id && p.language === language && isProfileSpeakable(p),
    );
    return {
      id,
      label: MODEL_LABELS[id],
      engine,
      profileId: profile?.id ?? null,
      blockedReason: blockedReason(status, id, engine, profile),
    };
  });
}

function blockedReason(
  status: TtsStatus | null,
  model: TtsModelId,
  engine: TtsEngineId,
  profile: VoiceProfile | undefined,
): string | null {
  if (!engineStatusOf(status, engine)?.installed) {
    return "Engine not installed";
  }
  if (!modelStatusOf(status, model)?.downloaded) return "Not downloaded";
  if (!profile) return "No voice for this language";
  return null;
}
