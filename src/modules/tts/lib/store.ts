import { LazyStore } from "@tauri-apps/plugin-store";
import { TTS_LANGUAGES } from "./engines";
import {
  defaultPresetDefaults,
  isPresetId,
  LEGACY_BUILT_IN_IDS,
  presetProfile,
} from "./presets";
import { parseSpeedSamples, type SpeedSamples } from "./speed";
import {
  isVoiceProfile,
  LEGACY_BUILT_INS,
  type VoiceDefaults,
  type VoiceProfile,
} from "./voices";

export const TTS_VOICES_STORE_PATH = "terax-tts-voices.json";

export const KEY_VOICES = "voices";
export const KEY_DEFAULTS = "defaults";
export const KEY_SEED_VERSION = "seedVersion";
export const KEY_MEASURED_SPEED = "measuredSpeed";

/**
 * 1 was the two Kokoro voices; 2 added one voice per Chatterbox model; 3 added
 * Pocket TTS, OmniVoice and ZONOS3-Mini. 4 (dev.26) stops seeding: preset and
 * default voices are generated, so the seeded copies the user never changed
 * are removed and the defaults that named them point at the preset instead.
 */
export const SEED_VERSION = 4;

export type PersistedVoicesState = {
  profiles: VoiceProfile[];
  speed?: SpeedSamples;
  defaults: VoiceDefaults;
  /** True when the stored state must be written back (first run or a
   *  migration). */
  seeded: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Stored profiles are untrusted: an invalid or duplicated entry is dropped so
 *  one bad record cannot take the Voice tab down on boot. A stored profile can
 *  never claim a preset id. */
export function parseStoredVoices(value: unknown): VoiceProfile[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const profiles: VoiceProfile[] = [];
  for (const entry of value) {
    if (!isVoiceProfile(entry)) continue;
    if (isPresetId(entry.id)) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    profiles.push(entry);
  }
  return profiles;
}

/** A default may name a stored profile or a preset. One pointing at nothing,
 *  or at a voice of another language, is cleared rather than kept. */
export function parseStoredDefaults(
  value: unknown,
  profiles: readonly VoiceProfile[],
): VoiceDefaults {
  const defaults: VoiceDefaults = {};
  if (!isRecord(value)) return defaults;
  for (const language of TTS_LANGUAGES) {
    const id = value[language];
    if (id === null) {
      defaults[language] = null;
      continue;
    }
    if (typeof id !== "string" || id.length === 0) continue;
    const profile = profiles.find((p) => p.id === id) ?? presetProfile(id);
    if (!profile || profile.language !== language) continue;
    defaults[language] = id;
  }
  return defaults;
}

/** Whether a stored legacy built-in is still exactly what was seeded. */
function untouchedLegacy(profile: VoiceProfile): boolean {
  const seeded = LEGACY_BUILT_INS.find((built) => built.id === profile.id);
  if (!seeded) return false;
  const shape = (p: VoiceProfile) =>
    JSON.stringify([
      p.name,
      p.model,
      p.language,
      p.voice,
      p.sampleId,
      Object.entries(p.params).sort(),
      p.style.persona ?? "",
      p.style.instructions ?? "",
      p.style.tags ?? [],
    ]);
  return shape(seeded) === shape(profile);
}

/**
 * Migrates a store written before seed 4: seeded built-ins the user never
 * changed are dropped, and every default that named a dropped one names its
 * preset. Edited built-ins stay as the user's own profiles. Languages with no
 * stored default get the catalogue default.
 */
export function migrateToPresets(
  stored: readonly VoiceProfile[],
  rawDefaults: unknown,
): { profiles: VoiceProfile[]; defaults: VoiceDefaults } {
  const dropped = new Set(
    stored.filter((p) => untouchedLegacy(p)).map((p) => p.id),
  );
  const profiles = stored.filter((p) => !dropped.has(p.id));
  const remapped: Record<string, unknown> = {};
  if (isRecord(rawDefaults)) {
    for (const [language, id] of Object.entries(rawDefaults)) {
      remapped[language] =
        typeof id === "string" && dropped.has(id)
          ? (LEGACY_BUILT_IN_IDS[id] ?? null)
          : id;
    }
  }
  return { profiles, defaults: withCatalogueDefaults(parseStoredDefaults(remapped, profiles)) };
}

/**
 * Every language gets a default voice. A missing or empty one (an install
 * whose voices were all deleted before presets existed) takes the catalogue
 * default, the voice speech falls back to anyway, so Settings shows the voice
 * that actually speaks instead of "not chosen".
 */
export function withCatalogueDefaults(defaults: VoiceDefaults): VoiceDefaults {
  const fallback = defaultPresetDefaults();
  const out = { ...defaults };
  for (const language of TTS_LANGUAGES) {
    if (!out[language]) out[language] = fallback[language];
  }
  return out;
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

/** Pure hydration core. A fresh install stores no profiles and points each
 *  language at its catalogue default; an older store is migrated once. */
export function seedVoicesState(
  rawVoices: unknown,
  rawDefaults: unknown,
  rawSeedVersion?: unknown,
): PersistedVoicesState {
  if (rawVoices === undefined) {
    return { profiles: [], defaults: defaultPresetDefaults(), seeded: true };
  }
  const stored = parseStoredVoices(rawVoices);
  const seenVersion =
    typeof rawSeedVersion === "number" && Number.isFinite(rawSeedVersion)
      ? rawSeedVersion
      : 1;
  if (seenVersion < SEED_VERSION) {
    return { ...migrateToPresets(stored, rawDefaults), seeded: true };
  }
  return {
    profiles: stored,
    defaults: withCatalogueDefaults(parseStoredDefaults(rawDefaults, stored)),
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
    state = seedVoicesState(
      map.get(KEY_VOICES),
      map.get(KEY_DEFAULTS),
      map.get(KEY_SEED_VERSION),
    );
  } catch {
    return { profiles: [], defaults: defaultPresetDefaults(), seeded: false };
  }
  if (state.seeded) {
    await persistVoices(state.profiles);
    await persistDefaults(state.defaults);
    await write(KEY_SEED_VERSION, SEED_VERSION);
  }
  try {
    state.speed = parseSpeedSamples(await store.get(KEY_MEASURED_SPEED));
  } catch {
    state.speed = {};
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

export function persistSpeed(samples: SpeedSamples): Promise<void> {
  return write(KEY_MEASURED_SPEED, samples);
}
