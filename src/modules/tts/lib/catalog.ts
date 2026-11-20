import {
  downloadsOnFirstUse,
  ENGINE_APPROX_BYTES,
  ENGINE_LABELS,
  MODEL_APPROX_BYTES,
  MODEL_ENGINE,
  type TtsEngineId,
  type TtsLanguage,
  type TtsModelId,
} from "./engines";
import { formatApproxBytes } from "./format";
import { engineStatusOf, modelStatusOf, type TtsStatus } from "./native";
import { isPresetId, presetKindOf, type PresetKind, withPresets } from "./presets";
import { isProfileSpeakable, type VoiceDefaults, type VoiceProfile } from "./voices";

/**
 * One list of voices for every surface: Settings, the status-bar pill, the
 * Reader's voice menu, the terminal menu and agents. It merges the user's own
 * profiles with every preset, default and designed voice, and says for each
 * one whether it can speak now and, if not, the single action that is missing.
 */
export type VoiceReadiness =
  | { state: "ready" }
  | { state: "download"; model: TtsModelId; bytes: number }
  | { state: "install"; engine: TtsEngineId; bytes: number }
  | { state: "unsupported"; reason: string }
  | { state: "sample" };

export type VoiceKind = PresetKind | "custom" | "cloned";

export type VoiceOption = {
  id: string;
  name: string;
  language: TtsLanguage;
  model: TtsModelId;
  engine: TtsEngineId;
  provider: string;
  kind: VoiceKind;
  /** True for generated voices; false for the user's stored profiles. */
  preset: boolean;
  profile: VoiceProfile;
  readiness: VoiceReadiness;
  ready: boolean;
  /** What the user must do first, or null when the voice is ready. */
  missing: string | null;
  isDefault: boolean;
  /** The language model downloads on first use (Pocket beyond es/en). */
  downloadsOnFirstUse: boolean;
};

export function readinessOf(
  voice: VoiceProfile,
  status: TtsStatus | null,
): VoiceReadiness {
  const engine = MODEL_ENGINE[voice.model];
  const entry = engineStatusOf(status, engine);
  if (entry?.plan && !entry.plan.supported) {
    return {
      state: "unsupported",
      reason: entry.plan.unsupportedReason ?? "Not available on this machine",
    };
  }
  if (!entry?.installed) {
    return {
      state: "install",
      engine,
      bytes: ENGINE_APPROX_BYTES[engine] + MODEL_APPROX_BYTES[voice.model],
    };
  }
  if (!modelStatusOf(status, voice.model)?.downloaded) {
    return { state: "download", model: voice.model, bytes: MODEL_APPROX_BYTES[voice.model] };
  }
  if (!isProfileSpeakable(voice)) return { state: "sample" };
  return { state: "ready" };
}

export function missingAction(readiness: VoiceReadiness): string | null {
  switch (readiness.state) {
    case "ready":
      return null;
    case "download":
      return `Download ${formatApproxBytes(readiness.bytes)}`;
    case "install":
      return `Install ${ENGINE_LABELS[readiness.engine]}, ${formatApproxBytes(readiness.bytes)}`;
    case "unsupported":
      return "Not available on this machine";
    case "sample":
      return "Needs a sample";
  }
}

function kindOf(profile: VoiceProfile, preset: boolean): VoiceKind {
  if (preset) return presetKindOf(profile.model, profile.voice ?? "");
  return profile.sampleId ? "cloned" : "custom";
}

export type VoiceOptionsQuery = {
  /** Only this language. */
  language?: TtsLanguage;
  /** Only these languages (the enabled ones); ignored when `language` is set. */
  languages?: readonly TtsLanguage[];
};

/**
 * Every voice for the query, the default of each language first, then the
 * ready ones, then the user's own before the generated ones.
 */
export function voiceOptions(
  profiles: readonly VoiceProfile[],
  defaults: VoiceDefaults,
  status: TtsStatus | null,
  query: VoiceOptionsQuery = {},
): VoiceOption[] {
  const languages = query.language ? [query.language] : query.languages;
  const options = withPresets(profiles)
    .filter((p) => !languages || languages.includes(p.language))
    .map((profile, order) => {
      const preset = isPresetId(profile.id);
      const readiness = readinessOf(profile, status);
      const engine = MODEL_ENGINE[profile.model];
      return {
        order,
        option: {
          id: profile.id,
          name: profile.name,
          language: profile.language,
          model: profile.model,
          engine,
          provider: ENGINE_LABELS[engine],
          kind: kindOf(profile, preset),
          preset,
          profile,
          readiness,
          ready: readiness.state === "ready",
          missing: missingAction(readiness),
          isDefault: defaults[profile.language] === profile.id,
          downloadsOnFirstUse: downloadsOnFirstUse(profile.model, profile.language),
        } satisfies VoiceOption,
      };
    });
  options.sort(
    (a, b) =>
      Number(b.option.isDefault) - Number(a.option.isDefault) ||
      Number(b.option.ready) - Number(a.option.ready) ||
      a.order - b.order,
  );
  return options.map((o) => o.option);
}
