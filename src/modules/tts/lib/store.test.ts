import { describe, expect, it } from "vitest";
import {
  KEY_DEFAULTS,
  KEY_VOICES,
  SEED_VERSION,
  parseStoredDefaults,
  parseStoredVoices,
  seedVoicesState,
  toStoredDefaults,
  toStoredVoices,
  TTS_VOICES_STORE_PATH,
} from "./store";
import { DEFAULT_PRESET_IDS, presetId } from "./presets";
import {
  BUILT_IN_EN_ID,
  BUILT_IN_ES_ID,
  BUILT_IN_POCKET_ES_ID,
  createProfile,
  EMPTY_DEFAULTS,
  isVoiceProfile,
  LEGACY_BUILT_INS,
  type VoiceProfile,
} from "./voices";

function profile(over: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    id: "v-1",
    name: "Dora",
    model: "kokoro-82m",
    language: "es-ES",
    voice: "ef_dora",
    sampleId: null,
    params: {},
    style: {},
    createdAt: 10,
    ...over,
  };
}

describe("store shape", () => {
  it("keeps the documented file name and keys", () => {
    expect(TTS_VOICES_STORE_PATH).toBe("terax-tts-voices.json");
    expect(KEY_VOICES).toBe("voices");
    expect(KEY_DEFAULTS).toBe("defaults");
  });
});

describe("parseStoredVoices", () => {
  it("drops invalid entries and keeps the rest", () => {
    const parsed = parseStoredVoices([
      profile(),
      { id: "v-x", name: "Broken" },
      profile({ id: "v-2", language: "en-US", voice: "af_heart", name: "Heart" }),
      null,
      "nope",
      profile({ id: "v-3", model: "chatterbox-turbo" }),
    ]);
    expect(parsed.map((p) => p.id)).toEqual(["v-1", "v-2"]);
  });

  it("drops a duplicate id, keeping the first", () => {
    const parsed = parseStoredVoices([
      profile({ name: "First" }),
      profile({ name: "Second" }),
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("First");
  });

  it("returns nothing for a non-array", () => {
    expect(parseStoredVoices(undefined)).toEqual([]);
    expect(parseStoredVoices({ voices: [] })).toEqual([]);
  });
});

describe("parseStoredDefaults", () => {
  const profiles = [
    profile(),
    profile({ id: "v-2", language: "en-US", voice: "af_heart", name: "Heart" }),
  ];

  it("keeps ids that exist in the right language", () => {
    expect(
      parseStoredDefaults({ "es-ES": "v-1", "en-US": "v-2" }, profiles),
    ).toEqual({ "es-ES": "v-1", "en-US": "v-2" });
  });

  it("accepts a preset of the right language and an explicit null", () => {
    const lola = presetId("pocket-tts", "es-ES", "lola");
    expect(
      parseStoredDefaults({ "es-ES": lola, "en-US": null, "fr-FR": lola }, profiles),
    ).toEqual({ "es-ES": lola, "en-US": null });
  });

  it("drops ids that are gone, empty or in another language", () => {
    expect(
      parseStoredDefaults(
        { "es-ES": "gone", "en-US": "v-1", "fr-FR": "v-2" },
        profiles,
      ),
    ).toEqual(EMPTY_DEFAULTS);
    expect(parseStoredDefaults({ "es-ES": "" }, profiles)).toEqual(
      EMPTY_DEFAULTS,
    );
    expect(parseStoredDefaults({ "es-ES": 7 }, profiles)).toEqual(
      EMPTY_DEFAULTS,
    );
    expect(parseStoredDefaults(null, profiles)).toEqual(EMPTY_DEFAULTS);
  });
});

describe("round trip", () => {
  it("survives serialize and parse with params, style and tags", () => {
    const profiles = [
      createProfile({
        name: "Narrator",
        model: "chatterbox-turbo",
        language: "en-US",
        sampleId: "s-1",
        params: { exaggeration: 0.8, cfgWeight: 0.3, temperature: 1.2 },
        style: {
          persona: "narrator",
          instructions: "slow down on code",
          tags: ["[laugh]", "[sigh]"],
        },
        createdAt: 5,
      }),
      profile(),
    ];
    const defaults = { "es-ES": "v-1", "en-US": profiles[0].id };
    const storedVoices = JSON.parse(
      JSON.stringify(toStoredVoices(profiles)),
    ) as unknown;
    const storedDefaults = JSON.parse(
      JSON.stringify(toStoredDefaults(defaults)),
    ) as unknown;

    const back = parseStoredVoices(storedVoices);
    expect(back).toEqual(profiles);
    expect(back.every(isVoiceProfile)).toBe(true);
    expect(parseStoredDefaults(storedDefaults, back)).toEqual(defaults);
  });

  it("copies nested params, style and tags instead of aliasing them", () => {
    const source = [
      createProfile({
        name: "Narrator",
        model: "chatterbox-nano",
        language: "en-US",
        sampleId: "s-1",
        style: { tags: ["[laugh]"] },
      }),
    ];
    const stored = toStoredVoices(source) as VoiceProfile[];
    expect(stored[0].style.tags).not.toBe(source[0].style.tags);
    expect(stored[0].params).not.toBe(source[0].params);
  });
});

describe("seedVoicesState", () => {
  it("stores no profile on a fresh install and points each language at its preset", () => {
    const seeded = seedVoicesState(undefined, undefined);
    expect(seeded.seeded).toBe(true);
    expect(seeded.profiles).toEqual([]);
    // Kokoro for every language it speaks (the smallest download), Pocket TTS
    // for German.
    expect(seeded.defaults).toEqual(DEFAULT_PRESET_IDS);
    expect(seeded.defaults["es-ES"]).toBe(presetId("kokoro-82m", "es-ES", "ef_dora"));
    expect(seeded.defaults["de-DE"]).toBe(presetId("pocket-tts", "de-DE", "juergen"));
  });

  it("keeps a current store as it is", () => {
    const state = seedVoicesState(
      [profile()],
      { "es-ES": "v-1", "en-US": "v-1" },
      SEED_VERSION,
    );
    expect(state.seeded).toBe(false);
    expect(state.profiles.map((p) => p.id)).toEqual(["v-1"]);
    // A default in the wrong language is dropped, not kept dangling, and the
    // language falls back to its catalogue voice.
    expect(state.defaults["es-ES"]).toBe("v-1");
    expect(state.defaults["en-US"]).toBe(DEFAULT_PRESET_IDS["en-US"]);
  });

  it("migrates seeded built-ins the user never touched to presets", () => {
    const stored = LEGACY_BUILT_INS.map((p) => ({ ...p }));
    const state = seedVoicesState(
      stored,
      { "es-ES": BUILT_IN_ES_ID, "en-US": BUILT_IN_EN_ID },
      3,
    );
    expect(state.seeded).toBe(true);
    expect(state.profiles).toEqual([]);
    expect(state.defaults["es-ES"]).toBe(presetId("kokoro-82m", "es-ES", "ef_dora"));
    expect(state.defaults["en-US"]).toBe(presetId("kokoro-82m", "en-US", "af_heart"));
    // Languages the old store never knew get their catalogue default.
    expect(state.defaults["fr-FR"]).toBe(DEFAULT_PRESET_IDS["fr-FR"]);
  });

  it("keeps a built-in the user edited, with its id and default", () => {
    const edited = LEGACY_BUILT_INS.map((p) =>
      p.id === BUILT_IN_POCKET_ES_ID ? { ...p, params: {}, name: "Lola lenta" } : { ...p },
    );
    const state = seedVoicesState(edited, { "es-ES": BUILT_IN_POCKET_ES_ID }, 3);
    expect(state.profiles.map((p) => p.id)).toEqual([BUILT_IN_POCKET_ES_ID]);
    expect(state.defaults["es-ES"]).toBe(BUILT_IN_POCKET_ES_ID);
    // English had no stored default, so it gets the catalogue one.
    expect(state.defaults["en-US"]).toBe(DEFAULT_PRESET_IDS["en-US"]);
  });

  it("keeps the user's own profiles and gives an emptied default the catalogue voice", () => {
    // An install whose voices were all deleted has null defaults; speech used
    // the catalogue voice anyway, so Settings now names it.
    const state = seedVoicesState(
      [profile(), ...LEGACY_BUILT_INS],
      { "es-ES": "v-1", "en-US": null },
    );
    expect(state.profiles.map((p) => p.id)).toEqual(["v-1"]);
    expect(state.defaults["es-ES"]).toBe("v-1");
    expect(state.defaults["en-US"]).toBe(DEFAULT_PRESET_IDS["en-US"]);
  });

  it("migrates once", () => {
    const first = seedVoicesState(LEGACY_BUILT_INS, { "es-ES": BUILT_IN_ES_ID }, 2);
    const second = seedVoicesState(first.profiles, first.defaults, SEED_VERSION);
    expect(second.seeded).toBe(false);
    expect(second.defaults).toEqual(first.defaults);
  });

  it("never lets a stored profile claim a preset id", () => {
    const sneaky = profile({ id: presetId("kokoro-82m", "es-ES", "ef_dora") });
    expect(parseStoredVoices([sneaky])).toEqual([]);
  });
});
