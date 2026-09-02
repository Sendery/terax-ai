export { SpeakingPill } from "./components/SpeakingPill";
export {
  collapseWhitespace,
  DEFAULT_MAX_CHARS,
  DEFAULT_MAX_TOTAL,
  splitForSpeech,
  stripTerminalNoise,
  type SplitResult,
} from "./lib/chunk";
export {
  assertLoopbackUrl,
  endpointUrl,
  health,
  synthesize,
  TtsClientError,
  voices as sidecarVoices,
  warmup,
  type TtsClientErrorCode,
  type TtsEndpoint,
  type TtsPresetVoice,
} from "./lib/client";
export {
  DEVICE_LABELS,
  ENGINE_APPROX_BYTES,
  ENGINE_DESCRIPTIONS,
  ENGINE_LABELS,
  engineOf,
  EXPRESSIVENESS_TAGS,
  isTtsDevice,
  isTtsEngineId,
  isTtsLanguage,
  isTtsModelId,
  KOKORO_PRESET_VOICES,
  LANGUAGE_LABELS,
  MODEL_APPROX_BYTES,
  MODEL_DESCRIPTIONS,
  MODEL_ENGINE,
  MODEL_LABELS,
  MODEL_LANGUAGES,
  MODEL_PARAMS,
  MODEL_VOICE_SOURCE,
  modelsForLanguage,
  modelsOfEngine,
  modelSupportsLanguage,
  modelSupportsTags,
  PREVIEW_SENTENCES,
  TTS_DEVICES,
  TTS_ENGINES,
  TTS_LANGUAGES,
  TTS_MODELS,
  type ExpressivenessTag,
  type TtsDevice,
  type TtsEngineId,
  type TtsLanguage,
  type TtsModelId,
  type TtsParamSpec,
  type VoiceSource,
} from "./lib/engines";
export {
  ttsDownloadCommand,
  ttsInstallCommand,
  ttsSpeakCommand,
  ttsStartCommand,
  ttsStatusCommand,
  ttsStopCommand,
  ttsStopSpeakingCommand,
  ttsVoicesCommand,
} from "./lib/commands";
export {
  engineStatusOf,
  modelStatusOf,
  runningEnginesOf,
  runningJobsOf,
  samplePathFor,
  ttsNative,
  type TtsCacheEntry,
  type TtsEngineStatus,
  type TtsJob,
  type TtsJobLogs,
  type TtsLayout,
  type TtsModelStatus,
  type TtsStatus,
} from "./lib/native";
export {
  chunksToSynthesize,
  initialPlaybackState,
  playbackProgress,
  playbackReducer,
  PREFETCH_DEPTH,
  type PlaybackEvent,
  type PlaybackState,
} from "./lib/playback";
export { formatApproxBytes, formatBytes } from "./lib/format";
export { hydrateVoicesState, TTS_VOICES_STORE_PATH } from "./lib/store";
export {
  previewVoice,
  speakText,
  stopEngines,
  stopSpeaking,
  useSpeaker,
  type SpeakOptions,
  type SpeakResult,
} from "./lib/useSpeaker";
export { TTS_POLL_MS, useTtsRuntime } from "./lib/useTtsRuntime";
export {
  BUILT_IN_DEFAULTS,
  createProfile,
  defaultVoiceFor,
  isProfileSpeakable,
  isVoiceProfile,
  profilesByLanguage,
  resolveVoice,
  type VoiceDefaults,
  type VoiceParams,
  type VoiceProfile,
  type VoiceStyle,
} from "./lib/voices";
export { useTtsStore, type TtsStoreState } from "./store/ttsStore";
export { encodeWav16, SAMPLE_TARGET_RATE, toMono24kWav } from "./lib/wav";
export {
  listVoices,
  resolveActiveVoice,
  type VoiceListEntry,
} from "./lib/activeVoice";
