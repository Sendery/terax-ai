import { usePreferencesStore } from "@/modules/settings/preferences";
import type {
  TtsEngineId,
  TtsLanguage,
  TtsModelId,
} from "@/modules/tts/lib/engines";
import type { VoiceKind } from "@/modules/tts/lib/catalog";
import { voiceOptionsNow } from "@/modules/tts/lib/useVoiceOptions";
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
  engine: TtsEngineId;
  provider: string;
  language: TtsLanguage;
  kind: VoiceKind;
  /** Generated preset or default voice (true) or a stored profile (false). */
  preset: boolean;
  isDefault: boolean;
  ready: boolean;
  /** What must happen before this voice can speak, or null. */
  missing: string | null;
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

/** The unified voice list (stored profiles and presets) for the enabled
 *  languages, or one language, with readiness and the default marked. */
export async function listVoices(
  language?: TtsLanguage,
): Promise<VoiceListEntry[]> {
  await useTtsStore.getState().hydrate();
  return voiceOptionsNow({ language }).map((option) => ({
    id: option.id,
    name: option.name,
    model: option.model,
    engine: option.engine,
    provider: option.provider,
    language: option.language,
    kind: option.kind,
    preset: option.preset,
    isDefault: option.isDefault,
    ready: option.ready,
    missing: option.missing,
  }));
}
