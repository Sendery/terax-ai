export const TTS_ENGINES = ["kokoro", "chatterbox"] as const;
export type TtsEngineId = (typeof TTS_ENGINES)[number];

export const TTS_MODELS = [
  "kokoro-82m",
  "chatterbox-multilingual",
  "chatterbox-turbo",
  "chatterbox-nano",
] as const;
export type TtsModelId = (typeof TTS_MODELS)[number];

export const TTS_LANGUAGES = ["es-ES", "en-US"] as const;
export type TtsLanguage = (typeof TTS_LANGUAGES)[number];

export const TTS_DEVICES = ["auto", "cpu", "mps", "cuda"] as const;
export type TtsDevice = (typeof TTS_DEVICES)[number];

export const LANGUAGE_LABELS: Record<TtsLanguage, string> = {
  "es-ES": "Spanish",
  "en-US": "English",
};

/** Short localized line used by the voice preview button. */
export const PREVIEW_SENTENCES: Record<TtsLanguage, string> = {
  "es-ES": "Hola, soy tu voz en Terax. Puedo leer en voz alta lo que selecciones.",
  "en-US": "Hi, this is your Terax voice. I can read your selection out loud.",
};

export const DEVICE_LABELS: Record<TtsDevice, string> = {
  auto: "Automatic",
  cpu: "CPU",
  mps: "Apple GPU (MPS)",
  cuda: "NVIDIA GPU (CUDA)",
};

export const ENGINE_LABELS: Record<TtsEngineId, string> = {
  kokoro: "Kokoro",
  chatterbox: "Chatterbox",
};

export const ENGINE_DESCRIPTIONS: Record<TtsEngineId, string> = {
  kokoro:
    "Small and fast on CPU. Speaks from built-in voice presets in English and Spanish.",
  chatterbox:
    "Clones a voice from a short sample and adds expressive control. Much larger and slower.",
};

/** Approximate installed size of the engine venv, wheels included. */
export const ENGINE_APPROX_BYTES: Record<TtsEngineId, number> = {
  kokoro: 700 * 1024 * 1024,
  chatterbox: 2_500 * 1024 * 1024,
};

export const MODEL_ENGINE: Record<TtsModelId, TtsEngineId> = {
  "kokoro-82m": "kokoro",
  "chatterbox-multilingual": "chatterbox",
  "chatterbox-turbo": "chatterbox",
  "chatterbox-nano": "chatterbox",
};

export function engineOf(model: TtsModelId): TtsEngineId {
  return MODEL_ENGINE[model];
}

export const MODEL_LABELS: Record<TtsModelId, string> = {
  "kokoro-82m": "Kokoro-82M",
  "chatterbox-multilingual": "Chatterbox Multilingual",
  "chatterbox-turbo": "Chatterbox Turbo",
  "chatterbox-nano": "Chatterbox Nano",
};

export const MODEL_DESCRIPTIONS: Record<TtsModelId, string> = {
  "kokoro-82m":
    "Preset voices in English and Spanish. The default for both languages.",
  "chatterbox-multilingual":
    "Clones a voice from a sample in the same language as the profile.",
  "chatterbox-turbo":
    "English only, clones from a sample and reads paralinguistic tags.",
  "chatterbox-nano":
    "Smaller English-only sibling of Turbo with the same tag support.",
};

export const MODEL_APPROX_BYTES: Record<TtsModelId, number> = {
  "kokoro-82m": 330 * 1024 * 1024,
  "chatterbox-multilingual": 3_200 * 1024 * 1024,
  "chatterbox-turbo": 4_000 * 1024 * 1024,
  "chatterbox-nano": 3_000 * 1024 * 1024,
};

export const MODEL_LANGUAGES: Record<TtsModelId, readonly TtsLanguage[]> = {
  "kokoro-82m": ["es-ES", "en-US"],
  "chatterbox-multilingual": ["es-ES", "en-US"],
  "chatterbox-turbo": ["en-US"],
  "chatterbox-nano": ["en-US"],
};

export type VoiceSource = "preset" | "clone";

export const MODEL_VOICE_SOURCE: Record<TtsModelId, VoiceSource> = {
  "kokoro-82m": "preset",
  "chatterbox-multilingual": "clone",
  "chatterbox-turbo": "clone",
  "chatterbox-nano": "clone",
};

export const TTS_PARAMS = [
  "speed",
  "exaggeration",
  "cfgWeight",
  "temperature",
] as const;
export type TtsParamName = (typeof TTS_PARAMS)[number];

export type TtsParamSpec = {
  name: TtsParamName;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  default: number;
};

const PARAM_SPECS: Record<TtsParamName, TtsParamSpec> = {
  speed: {
    name: "speed",
    label: "Speed",
    hint: "Playback rate applied while synthesizing.",
    min: 0.5,
    max: 2,
    step: 0.05,
    default: 1,
  },
  exaggeration: {
    name: "exaggeration",
    label: "Exaggeration",
    hint: "How much emotion the delivery pushes.",
    min: 0,
    max: 2,
    step: 0.05,
    default: 0.5,
  },
  cfgWeight: {
    name: "cfgWeight",
    label: "Guidance",
    hint: "Higher values stay closer to the sample, lower ones sound freer.",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
  },
  temperature: {
    name: "temperature",
    label: "Temperature",
    hint: "Randomness between takes.",
    min: 0.05,
    max: 2,
    step: 0.05,
    default: 0.8,
  },
};

export const MODEL_PARAMS: Record<TtsModelId, readonly TtsParamSpec[]> = {
  "kokoro-82m": [PARAM_SPECS.speed],
  "chatterbox-multilingual": [
    PARAM_SPECS.exaggeration,
    PARAM_SPECS.cfgWeight,
    PARAM_SPECS.temperature,
  ],
  "chatterbox-turbo": [
    PARAM_SPECS.exaggeration,
    PARAM_SPECS.cfgWeight,
    PARAM_SPECS.temperature,
  ],
  "chatterbox-nano": [
    PARAM_SPECS.exaggeration,
    PARAM_SPECS.cfgWeight,
    PARAM_SPECS.temperature,
  ],
};

export type ExpressivenessTag = {
  tag: string;
  label: string;
  /** The Chatterbox README only documents three tags; the rest live in the
   *  tokenizer and their quality is not guaranteed. */
  documented: boolean;
};

export const EXPRESSIVENESS_TAGS: readonly ExpressivenessTag[] = [
  { tag: "[advertisement]", label: "Advertisement", documented: false },
  { tag: "[angry]", label: "Angry", documented: false },
  { tag: "[chuckle]", label: "Chuckle", documented: true },
  { tag: "[clear throat]", label: "Clear throat", documented: false },
  { tag: "[cough]", label: "Cough", documented: true },
  { tag: "[crying]", label: "Crying", documented: false },
  { tag: "[dramatic]", label: "Dramatic", documented: false },
  { tag: "[fear]", label: "Fear", documented: false },
  { tag: "[gasp]", label: "Gasp", documented: false },
  { tag: "[groan]", label: "Groan", documented: false },
  { tag: "[happy]", label: "Happy", documented: false },
  { tag: "[laugh]", label: "Laugh", documented: true },
  { tag: "[narration]", label: "Narration", documented: false },
  { tag: "[sarcastic]", label: "Sarcastic", documented: false },
  { tag: "[shush]", label: "Shush", documented: false },
  { tag: "[sigh]", label: "Sigh", documented: false },
  { tag: "[sniff]", label: "Sniff", documented: false },
  { tag: "[surprised]", label: "Surprised", documented: false },
  { tag: "[whispering]", label: "Whispering", documented: false },
];

const TAG_MODELS: readonly TtsModelId[] = ["chatterbox-turbo", "chatterbox-nano"];

export function modelSupportsTags(model: TtsModelId): boolean {
  return TAG_MODELS.includes(model);
}

/** Kokoro presets shipped with the weights, used to offer a voice list before
 *  the sidecar runs and can answer `/voices` itself. */
export const KOKORO_PRESET_VOICES: Record<
  TtsLanguage,
  readonly { id: string; label: string }[]
> = {
  "es-ES": [
    { id: "ef_dora", label: "Dora" },
    { id: "em_alex", label: "Alex" },
    { id: "em_santa", label: "Santa" },
  ],
  "en-US": [
    { id: "af_heart", label: "Heart" },
    { id: "af_bella", label: "Bella" },
    { id: "af_nicole", label: "Nicole" },
    { id: "af_sarah", label: "Sarah" },
    { id: "af_sky", label: "Sky" },
    { id: "am_adam", label: "Adam" },
    { id: "am_michael", label: "Michael" },
    { id: "am_onyx", label: "Onyx" },
    { id: "bf_emma", label: "Emma (British)" },
    { id: "bf_isabella", label: "Isabella (British)" },
    { id: "bm_george", label: "George (British)" },
    { id: "bm_lewis", label: "Lewis (British)" },
  ],
};

export function isTtsEngineId(value: unknown): value is TtsEngineId {
  return (
    typeof value === "string" && (TTS_ENGINES as readonly string[]).includes(value)
  );
}

export function isTtsModelId(value: unknown): value is TtsModelId {
  return (
    typeof value === "string" && (TTS_MODELS as readonly string[]).includes(value)
  );
}

export function isTtsLanguage(value: unknown): value is TtsLanguage {
  return (
    typeof value === "string" &&
    (TTS_LANGUAGES as readonly string[]).includes(value)
  );
}

export function isTtsDevice(value: unknown): value is TtsDevice {
  return (
    typeof value === "string" && (TTS_DEVICES as readonly string[]).includes(value)
  );
}

export function modelSupportsLanguage(
  model: TtsModelId,
  language: TtsLanguage,
): boolean {
  return MODEL_LANGUAGES[model].includes(language);
}

export function modelsForLanguage(language: TtsLanguage): TtsModelId[] {
  return TTS_MODELS.filter((model) => modelSupportsLanguage(model, language));
}

export function modelsOfEngine(engine: TtsEngineId): TtsModelId[] {
  return TTS_MODELS.filter((model) => MODEL_ENGINE[model] === engine);
}

export function paramSpecsOf(model: TtsModelId): readonly TtsParamSpec[] {
  return MODEL_PARAMS[model];
}

export function modelAcceptsParam(
  model: TtsModelId,
  param: TtsParamName,
): boolean {
  return MODEL_PARAMS[model].some((spec) => spec.name === param);
}
