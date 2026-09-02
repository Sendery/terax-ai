import { create } from "zustand";
import type { TtsEngineId, TtsLanguage } from "@/modules/tts/lib/engines";
import type { TtsStatus } from "@/modules/tts/lib/native";
import {
  hydrateVoicesState,
  persistDefaults,
  persistVoices,
} from "@/modules/tts/lib/store";
import {
  EMPTY_DEFAULTS,
  type VoiceDefaults,
  type VoiceProfile,
} from "@/modules/tts/lib/voices";

export type SpeechProgress = { index: number; total: number };

export type TtsStoreState = {
  hydrated: boolean;
  profiles: VoiceProfile[];
  defaults: VoiceDefaults;
  speaking: boolean;
  currentVoice: VoiceProfile | null;
  progress: SpeechProgress;
  error: string | null;
  /** Engines with a live sidecar, as last observed. Empty until something
   *  in this window speaks or polls, so an unused feature stays silent. */
  runningEngines: TtsEngineId[];
  /** Last runtime status read by any surface in this window. Null until
   *  something reads it, so the ambient snapshot never triggers an IPC call. */
  status: TtsStatus | null;
  hydrate: () => Promise<void>;
  saveProfile: (profile: VoiceProfile) => Promise<void>;
  removeProfile: (id: string) => Promise<void>;
  setDefaultProfile: (
    language: TtsLanguage,
    id: string | null,
  ) => Promise<void>;
  setSpeech: (patch: {
    speaking?: boolean;
    currentVoice?: VoiceProfile | null;
    progress?: SpeechProgress;
    error?: string | null;
  }) => void;
  setRunningEngines: (engines: TtsEngineId[]) => void;
  setStatus: (status: TtsStatus) => void;
  clearError: () => void;
};

let hydration: Promise<void> | null = null;

export const useTtsStore = create<TtsStoreState>((set, get) => ({
  hydrated: false,
  profiles: [],
  defaults: { ...EMPTY_DEFAULTS },
  speaking: false,
  currentVoice: null,
  progress: { index: 0, total: 0 },
  error: null,
  runningEngines: [],
  status: null,

  hydrate: () => {
    if (get().hydrated) return Promise.resolve();
    hydration ??= hydrateVoicesState().then((state) => {
      set({
        profiles: state.profiles,
        defaults: state.defaults,
        hydrated: true,
      });
    });
    return hydration;
  },

  saveProfile: async (profile) => {
    const existing = get().profiles;
    const index = existing.findIndex((p) => p.id === profile.id);
    const profiles =
      index === -1
        ? [...existing, profile]
        : existing.map((p) => (p.id === profile.id ? profile : p));
    set({ profiles });
    await persistVoices(profiles);
    // A profile that changed language leaves a default pointing at the wrong
    // language behind, which resolveVoice would then ignore silently.
    const defaults = get().defaults;
    let repaired: VoiceDefaults | null = null;
    for (const [language, id] of Object.entries(defaults) as [
      TtsLanguage,
      string | null,
    ][]) {
      if (id === profile.id && profile.language !== language) {
        repaired = { ...(repaired ?? defaults), [language]: null };
      }
    }
    if (repaired) {
      set({ defaults: repaired });
      await persistDefaults(repaired);
    }
  },

  removeProfile: async (id) => {
    const profiles = get().profiles.filter((p) => p.id !== id);
    set({ profiles });
    await persistVoices(profiles);
    const defaults = get().defaults;
    const cleared = Object.fromEntries(
      Object.entries(defaults).map(([language, value]) => [
        language,
        value === id ? null : value,
      ]),
    ) as VoiceDefaults;
    if (Object.values(cleared).join() !== Object.values(defaults).join()) {
      set({ defaults: cleared });
      await persistDefaults(cleared);
    }
  },

  setDefaultProfile: async (language, id) => {
    const defaults = { ...get().defaults, [language]: id };
    set({ defaults });
    await persistDefaults(defaults);
  },

  setSpeech: (patch) => set(patch),

  setRunningEngines: (engines) => {
    const current = get().runningEngines;
    if (current.length === engines.length && current.every((e, i) => e === engines[i])) {
      return;
    }
    set({ runningEngines: engines });
  },

  setStatus: (status) => {
    set({ status });
    get().setRunningEngines(
      status.engines.filter((e) => e.running).map((e) => e.id),
    );
  },

  clearError: () => set({ error: null }),
}));
