import { useMemo } from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useTtsStore } from "@/modules/tts/store/ttsStore";
import { type VoiceOption, type VoiceOptionsQuery, voiceOptions } from "./catalog";

/** The unified voice list, limited to the enabled languages unless a
 *  language is named. Re-renders when profiles, defaults or status change. */
export function useVoiceOptions(query: VoiceOptionsQuery = {}): VoiceOption[] {
  const profiles = useTtsStore((s) => s.profiles);
  const defaults = useTtsStore((s) => s.defaults);
  const status = useTtsStore((s) => s.status);
  const enabled = usePreferencesStore((s) => s.ttsLanguages);
  const { language, languages } = query;
  return useMemo(
    () =>
      voiceOptions(profiles, defaults, status, {
        language,
        languages: languages ?? enabled,
      }),
    [profiles, defaults, status, language, languages, enabled],
  );
}

/** The same list outside React (commands, menus built on demand). */
export function voiceOptionsNow(query: VoiceOptionsQuery = {}): VoiceOption[] {
  const { profiles, defaults, status } = useTtsStore.getState();
  const enabled = usePreferencesStore.getState().ttsLanguages;
  return voiceOptions(profiles, defaults, status, {
    language: query.language,
    languages: query.languages ?? enabled,
  });
}
