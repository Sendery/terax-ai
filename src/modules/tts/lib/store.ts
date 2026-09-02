import { LazyStore } from "@tauri-apps/plugin-store";
import { TTS_LANGUAGES } from "./engines";
import {
  BUILT_IN_DEFAULTS,
  builtInDefaultsMap,
  EMPTY_DEFAULTS,
  isVoiceProfile,
  type VoiceDefaults,
  type VoiceProfile,
} from "./voices";

export const TTS_VOICES_STORE_PATH = "terax-tts-voices.json";

export const KEY_VOICES = "voices";
export const KEY_DEFAULTS = "defaults";

export type PersistedVoicesState = {
  profiles: VoiceProfile[];
  defaults: VoiceDefaults;
  /** True when the built-in profiles were just written for the first time. */
  seeded: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Stored profiles are untrusted: an invalid or duplicated entry is dropped so
 *  one bad record cannot take the Voice tab down on boot. */
export function parseStoredVoices(value: unknown): VoiceProfile[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const profiles: VoiceProfile[] = [];
  for (const entry of value) {
    if (!isVoiceProfile(entry)) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    profiles.push(entry);
  }
  return profiles;
}

/** A default pointing at a profile that is gone, or at one in another
 *  language, is cleared rather than kept as a dangling id. */
export function parseStoredDefaults(
  value: unknown,
  profiles: readonly VoiceProfile[],
): VoiceDefaults {
  const defaults: VoiceDefaults = { ...EMPTY_DEFAULTS };
  if (!isRecord(value)) return defaults;
  for (const language of TTS_LANGUAGES) {
    const id = value[language];
    if (typeof id !== "string" || id.length === 0) continue;
    const profile = profiles.find((p) => p.id === id);
    if (!profile || profile.language !== language) continue;
    defaults[language] = id;
  }
  return defaults;
}

export function toStoredVoices(profiles: readonly VoiceProfile[]): unknown {
  return profiles.map((profile) => ({
    ...profile,
    params: { ...profile.params },
    style: {
      ...profile.style,
      ...(profile.style.tags ? { tags: [...profile.style.tags] } : {}),
    },
  }));
}

export function toStoredDefaults(defaults: VoiceDefaults): unknown {
  return { ...defaults };
}

/** Pure hydration core. The built-ins are seeded only when the key has never
 *  been written, so emptying the list by hand is not undone on next launch. */
export function seedVoicesState(
  rawVoices: unknown,
  rawDefaults: unknown,
): PersistedVoicesState {
  if (rawVoices === undefined) {
    return {
      profiles: BUILT_IN_DEFAULTS.map((profile) => ({ ...profile })),
      defaults: builtInDefaultsMap(),
      seeded: true,
    };
  }
  const profiles = parseStoredVoices(rawVoices);
  return {
    profiles,
    defaults: parseStoredDefaults(rawDefaults, profiles),
    seeded: false,
  };
}

const store = new LazyStore(TTS_VOICES_STORE_PATH, {
  defaults: {},
  autoSave: 200,
});

/** One `entries()` read instead of two plugin round-trips. */
export async function hydrateVoicesState(): Promise<PersistedVoicesState> {
  let state: PersistedVoicesState;
  try {
    const map = new Map(await store.entries());
    state = seedVoicesState(map.get(KEY_VOICES), map.get(KEY_DEFAULTS));
  } catch {
    return {
      profiles: BUILT_IN_DEFAULTS.map((profile) => ({ ...profile })),
      defaults: builtInDefaultsMap(),
      seeded: false,
    };
  }
  if (state.seeded) {
    await persistVoices(state.profiles);
    await persistDefaults(state.defaults);
  }
  return state;
}

async function write(key: string, value: unknown): Promise<void> {
  try {
    await store.set(key, value);
    await store.save();
  } catch {
    // A failed write must never break the panel; the next write retries.
  }
}

export function persistVoices(
  profiles: readonly VoiceProfile[],
): Promise<void> {
  return write(KEY_VOICES, toStoredVoices(profiles));
}

export function persistDefaults(defaults: VoiceDefaults): Promise<void> {
  return write(KEY_DEFAULTS, toStoredDefaults(defaults));
}
