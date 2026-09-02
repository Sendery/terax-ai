import {
  isTtsLanguage,
  isTtsModelId,
  MODEL_PARAMS,
  MODEL_VOICE_SOURCE,
  modelSupportsLanguage,
  modelSupportsTags,
  TTS_LANGUAGES,
  type TtsLanguage,
  type TtsModelId,
  type TtsParamName,
} from "./engines";

export type VoiceParams = Partial<Record<TtsParamName, number>>;

export type VoiceStyle = {
  persona?: string;
  instructions?: string;
  tags?: string[];
};

export type VoiceProfile = {
  id: string;
  name: string;
  /** The engine is derived from the model, never stored. */
  model: TtsModelId;
  language: TtsLanguage;
  /** Preset id or comma blend for preset models. */
  voice: string | null;
  /** Imported sample for cloning models. */
  sampleId: string | null;
  params: VoiceParams;
  style: VoiceStyle;
  createdAt: number;
};

export type VoiceDefaults = Record<TtsLanguage, string | null>;

export const EMPTY_DEFAULTS: VoiceDefaults = {
  "es-ES": null,
  "en-US": null,
};

export const MAX_STYLE_TEXT = 2000;
export const MAX_TAGS = 32;
export const MAX_NAME = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidParams(model: TtsModelId, value: unknown): value is VoiceParams {
  if (!isRecord(value)) return false;
  for (const [name, raw] of Object.entries(value)) {
    const spec = MODEL_PARAMS[model].find((s) => s.name === name);
    // A param the model does not accept makes the sidecar reject the request,
    // so the profile is not usable as stored.
    if (!spec) return false;
    if (typeof raw !== "number" || !Number.isFinite(raw)) return false;
    if (raw < spec.min || raw > spec.max) return false;
  }
  return true;
}

function isValidStyle(value: unknown): value is VoiceStyle {
  if (!isRecord(value)) return false;
  const { persona, instructions, tags, ...rest } = value;
  if (Object.keys(rest).length > 0) return false;
  for (const text of [persona, instructions]) {
    if (text === undefined) continue;
    if (typeof text !== "string" || text.length > MAX_STYLE_TEXT) return false;
  }
  if (tags !== undefined) {
    if (!Array.isArray(tags) || tags.length > MAX_TAGS) return false;
    if (tags.some((tag) => typeof tag !== "string" || tag.length === 0)) {
      return false;
    }
  }
  return true;
}

export function isVoiceProfile(value: unknown): value is VoiceProfile {
  if (!isRecord(value)) return false;
  const { id, name, model, language, voice, sampleId, params, style, createdAt } =
    value;
  if (typeof id !== "string" || id.length === 0) return false;
  if (typeof name !== "string" || name.length === 0 || name.length > MAX_NAME) {
    return false;
  }
  if (!isTtsModelId(model)) return false;
  if (!isTtsLanguage(language)) return false;
  if (!modelSupportsLanguage(model, language)) return false;
  if (voice !== null && typeof voice !== "string") return false;
  if (sampleId !== null && typeof sampleId !== "string") return false;
  if (!isValidParams(model, params)) return false;
  if (!isValidStyle(style)) return false;
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return false;
  if (createdAt < 0) return false;
  return true;
}

/** A profile can only be spoken once it carries what its model needs. */
export function isProfileSpeakable(profile: VoiceProfile): boolean {
  if (MODEL_VOICE_SOURCE[profile.model] === "preset") {
    return !!profile.voice && profile.voice.trim().length > 0;
  }
  return !!profile.sampleId;
}

export type VoiceProfileInput = {
  id?: string;
  name: string;
  model: TtsModelId;
  language: TtsLanguage;
  voice?: string | null;
  sampleId?: string | null;
  params?: VoiceParams;
  style?: VoiceStyle;
  createdAt?: number;
};

function newProfileId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `v-${crypto.randomUUID().slice(0, 12)}`;
  }
  return `v-${Math.random().toString(36).slice(2, 14)}`;
}

function clampParams(model: TtsModelId, params: VoiceParams): VoiceParams {
  const out: VoiceParams = {};
  for (const spec of MODEL_PARAMS[model]) {
    const raw = params[spec.name];
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    out[spec.name] = Math.min(spec.max, Math.max(spec.min, raw));
  }
  return out;
}

function normalizeStyle(model: TtsModelId, style: VoiceStyle): VoiceStyle {
  const out: VoiceStyle = {};
  const persona = style.persona?.trim().slice(0, MAX_STYLE_TEXT);
  const instructions = style.instructions?.trim().slice(0, MAX_STYLE_TEXT);
  if (persona) out.persona = persona;
  if (instructions) out.instructions = instructions;
  if (modelSupportsTags(model) && style.tags && style.tags.length > 0) {
    const tags = [...new Set(style.tags.filter((t) => t.trim().length > 0))];
    if (tags.length > 0) out.tags = tags.slice(0, MAX_TAGS);
  }
  return out;
}

/** Builds a profile that always satisfies `isVoiceProfile`, so the editor can
 *  hand back whatever the user typed without the store rejecting it later. */
export function createProfile(input: VoiceProfileInput): VoiceProfile {
  const name = input.name.trim().slice(0, MAX_NAME) || "New voice";
  const preset = MODEL_VOICE_SOURCE[input.model] === "preset";
  return {
    id: input.id ?? newProfileId(),
    name,
    model: input.model,
    language: input.language,
    voice: preset ? (input.voice?.trim() || null) : null,
    sampleId: preset ? null : (input.sampleId ?? null),
    params: clampParams(input.model, input.params ?? {}),
    style: normalizeStyle(input.model, input.style ?? {}),
    createdAt:
      typeof input.createdAt === "number" && Number.isFinite(input.createdAt)
        ? Math.max(0, input.createdAt)
        : Date.now(),
  };
}

export const BUILT_IN_ES_ID = "builtin-es-dora";
export const BUILT_IN_EN_ID = "builtin-en-heart";

/** Seeded once so "read aloud" is deterministic before the user configures
 *  anything. Both point at Kokoro presets, the smallest download. */
export const BUILT_IN_DEFAULTS: readonly VoiceProfile[] = [
  {
    id: BUILT_IN_ES_ID,
    name: "Dora",
    model: "kokoro-82m",
    language: "es-ES",
    voice: "ef_dora",
    sampleId: null,
    params: {},
    style: {},
    createdAt: 0,
  },
  {
    id: BUILT_IN_EN_ID,
    name: "Heart",
    model: "kokoro-82m",
    language: "en-US",
    voice: "af_heart",
    sampleId: null,
    params: {},
    style: {},
    createdAt: 0,
  },
];

export function builtInDefaultsMap(): VoiceDefaults {
  const defaults: VoiceDefaults = { ...EMPTY_DEFAULTS };
  for (const profile of BUILT_IN_DEFAULTS) {
    defaults[profile.language] = profile.id;
  }
  return defaults;
}

export function defaultVoiceFor(
  profiles: readonly VoiceProfile[],
  defaults: VoiceDefaults,
  language: TtsLanguage,
): VoiceProfile | null {
  const id = defaults[language];
  if (!id) return null;
  const profile = profiles.find((p) => p.id === id);
  if (!profile) return null;
  return profile.language === language ? profile : null;
}

export type ResolveVoiceRequest = {
  voiceId?: string | null;
  language?: TtsLanguage | null;
};

/** Order: explicit voice, then the default for the asked language, then the
 *  default for the preferred language, then any profile in the asked language. */
export function resolveVoice(
  profiles: readonly VoiceProfile[],
  defaults: VoiceDefaults,
  prefs: { ttsDefaultLanguage: TtsLanguage },
  request: ResolveVoiceRequest = {},
): VoiceProfile | null {
  if (request.voiceId) {
    const byId = profiles.find((p) => p.id === request.voiceId);
    if (byId) return byId;
  }
  const asked = request.language ?? prefs.ttsDefaultLanguage;
  const forAsked = defaultVoiceFor(profiles, defaults, asked);
  if (forAsked) return forAsked;
  const preferred = defaultVoiceFor(profiles, defaults, prefs.ttsDefaultLanguage);
  if (preferred) return preferred;
  return profiles.find((p) => p.language === asked) ?? null;
}

export function profilesByLanguage(
  profiles: readonly VoiceProfile[],
): Record<TtsLanguage, VoiceProfile[]> {
  const grouped = {} as Record<TtsLanguage, VoiceProfile[]>;
  for (const language of TTS_LANGUAGES) grouped[language] = [];
  for (const profile of profiles) grouped[profile.language].push(profile);
  return grouped;
}
