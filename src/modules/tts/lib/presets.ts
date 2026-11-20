import {
  ENGINE_LABELS,
  MODEL_ENGINE,
  MODEL_LANGUAGES,
  MODEL_VOICE_SOURCE,
  presetVoicesOf,
  TTS_LANGUAGES,
  TTS_MODELS,
  type TtsLanguage,
  type TtsModelId,
} from "./engines";
import type { VoiceDefaults, VoiceProfile } from "./voices";

/**
 * Voices a model speaks with nothing to configure (Kokoro and Pocket presets,
 * ZONOS3 default voices, OmniVoice automatic and designed voices, the speaker
 * in Chatterbox's weights) are voices in their own right, not stored profiles.
 * Each one gets a stable id built from its model, language and voice, and is
 * generated on demand. A stored profile exists only once the user customizes a
 * voice or clones a sample.
 */
export const PRESET_PREFIX = "preset:";

export function presetId(
  model: TtsModelId,
  language: TtsLanguage,
  voice: string,
): string {
  return `${PRESET_PREFIX}${model}:${language}:${voice}`;
}

export function isPresetId(id: string | null | undefined): id is string {
  return typeof id === "string" && id.startsWith(PRESET_PREFIX);
}

export type ParsedPresetId = {
  model: TtsModelId;
  language: TtsLanguage;
  voice: string;
};

export function parsePresetId(id: string): ParsedPresetId | null {
  if (!isPresetId(id)) return null;
  const [model, language, ...rest] = id.slice(PRESET_PREFIX.length).split(":");
  const voice = rest.join(":");
  if (!(TTS_MODELS as readonly string[]).includes(model)) return null;
  if (!(TTS_LANGUAGES as readonly string[]).includes(language)) return null;
  if (!voice) return null;
  return {
    model: model as TtsModelId,
    language: language as TtsLanguage,
    voice,
  };
}

/** How a sample-free voice came to be, for labels and filters. */
export type PresetKind = "preset" | "default" | "designed" | "automatic" | "builtin";

export function presetKindOf(model: TtsModelId, voice: string): PresetKind {
  if (MODEL_VOICE_SOURCE[model] === "preset") return "preset";
  if (model === "omnivoice") return voice === "auto" ? "automatic" : "designed";
  if (model === "zonos3-mini") return "default";
  return "builtin";
}

function presetName(model: TtsModelId, label: string): string {
  if (presetKindOf(model, "") === "builtin") {
    return `${ENGINE_LABELS[MODEL_ENGINE[model]]} built-in`;
  }
  return label;
}

function build(
  model: TtsModelId,
  language: TtsLanguage,
  voice: { id: string; label: string },
): VoiceProfile {
  return {
    id: presetId(model, language, voice.id),
    name: presetName(model, voice.label),
    model,
    language,
    voice: voice.id,
    sampleId: null,
    params: {},
    style: {},
    createdAt: 0,
  };
}

let cache: VoiceProfile[] | null = null;

/** Every sample-free voice of every model, in catalogue order. */
export function presetProfiles(): VoiceProfile[] {
  if (cache) return cache;
  const out: VoiceProfile[] = [];
  for (const model of TTS_MODELS) {
    for (const language of MODEL_LANGUAGES[model]) {
      for (const voice of presetVoicesOf(model, language)) {
        out.push(build(model, language, voice));
      }
    }
  }
  cache = out;
  return out;
}

export function presetProfile(id: string): VoiceProfile | null {
  const parsed = parsePresetId(id);
  if (!parsed) return null;
  if (!MODEL_LANGUAGES[parsed.model].includes(parsed.language)) return null;
  const voice = presetVoicesOf(parsed.model, parsed.language).find(
    (v) => v.id === parsed.voice,
  );
  return voice ? build(parsed.model, parsed.language, voice) : null;
}

/** Stored profiles first (the user's own), then every preset. */
export function withPresets(profiles: readonly VoiceProfile[]): VoiceProfile[] {
  return [...profiles, ...presetProfiles()];
}

/** The voice each language reads with on a fresh install: Kokoro where it
 *  speaks the language (the smallest download), Pocket TTS for German. */
export const DEFAULT_PRESET_IDS: Record<TtsLanguage, string> = {
  "es-ES": presetId("kokoro-82m", "es-ES", "ef_dora"),
  "en-US": presetId("kokoro-82m", "en-US", "af_heart"),
  "fr-FR": presetId("kokoro-82m", "fr-FR", "ff_siwis"),
  "de-DE": presetId("pocket-tts", "de-DE", "juergen"),
  "it-IT": presetId("kokoro-82m", "it-IT", "if_sara"),
  "pt-BR": presetId("kokoro-82m", "pt-BR", "pf_dora"),
};

export function defaultPresetDefaults(): VoiceDefaults {
  return { ...DEFAULT_PRESET_IDS };
}

/**
 * Ids of the profiles seeded by dev.24 and earlier, and the preset each one
 * was. Documents, history and agents may still name them; they resolve to the
 * preset from now on.
 */
export const LEGACY_BUILT_IN_IDS: Record<string, string> = {
  "builtin-es-dora": presetId("kokoro-82m", "es-ES", "ef_dora"),
  "builtin-en-heart": presetId("kokoro-82m", "en-US", "af_heart"),
  "builtin-es-chatterbox": presetId("chatterbox-multilingual", "es-ES", "builtin"),
  "builtin-en-chatterbox": presetId("chatterbox-multilingual", "en-US", "builtin"),
  "builtin-en-turbo": presetId("chatterbox-turbo", "en-US", "builtin"),
  "builtin-en-nano": presetId("chatterbox-nano", "en-US", "builtin"),
  "builtin-es-pocket-lola": presetId("pocket-tts", "es-ES", "lola"),
  "builtin-en-pocket-alba": presetId("pocket-tts", "en-US", "alba"),
  "builtin-es-omnivoice": presetId("omnivoice", "es-ES", "auto"),
  "builtin-en-omnivoice": presetId("omnivoice", "en-US", "auto"),
  "builtin-es-zonos3-ximena": presetId("zonos3-mini", "es-ES", "default_43e790fc116fd62a"),
  "builtin-en-zonos3-savannah": presetId("zonos3-mini", "en-US", "default_de4d191ca7574982"),
};

/** A legacy built-in id is read as its preset; any other id is unchanged. */
export function canonicalVoiceId(id: string): string {
  return LEGACY_BUILT_IN_IDS[id] ?? id;
}

/** Looks a voice up by id among stored profiles and presets. */
export function findVoice(
  profiles: readonly VoiceProfile[],
  id: string | null | undefined,
): VoiceProfile | null {
  if (!id) return null;
  const canonical = canonicalVoiceId(id);
  return (
    profiles.find((p) => p.id === id || p.id === canonical) ??
    presetProfile(canonical)
  );
}
