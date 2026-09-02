import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  MODEL_VOICE_SOURCE,
  type TtsLanguage,
  type TtsModelId,
  type VoiceSource,
} from "@/modules/tts/lib/engines";
import {
  resolveVoice,
  type ResolveVoiceRequest,
  type VoiceProfile,
} from "@/modules/tts/lib/voices";
import { useTtsStore } from "@/modules/tts/store/ttsStore";

export type VoiceListEntry = {
  id: string;
  name: string;
  model: TtsModelId;
  language: TtsLanguage;
  kind: VoiceSource;
  isDefault: boolean;
};

/**
 * Store-bound wrapper over the pure `resolveVoice`, for callers that only
 * carry a request (the command registry, the context menu, the palette).
 */
export async function resolveActiveVoice(
  request: ResolveVoiceRequest = {},
): Promise<VoiceProfile | null> {
  await useTtsStore.getState().hydrate();
  const { profiles, defaults } = useTtsStore.getState();
  const { ttsDefaultLanguage } = usePreferencesStore.getState();
  return resolveVoice(profiles, defaults, { ttsDefaultLanguage }, request);
}

/** Flat voice list with the per-language default marked. */
export async function listVoices(): Promise<VoiceListEntry[]> {
  await useTtsStore.getState().hydrate();
  const { profiles, defaults } = useTtsStore.getState();
  return profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    model: profile.model,
    language: profile.language,
    kind: MODEL_VOICE_SOURCE[profile.model],
    isDefault: defaults[profile.language] === profile.id,
  }));
}
