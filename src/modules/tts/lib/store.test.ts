import { describe, expect, it } from "vitest";
import {
  KEY_DEFAULTS,
  KEY_VOICES,
  parseStoredDefaults,
  parseStoredVoices,
  seedVoicesState,
  toStoredDefaults,
  toStoredVoices,
  TTS_VOICES_STORE_PATH,
} from "./store";
import {
  BUILT_IN_EN_ID,
  BUILT_IN_ES_ID,
  createProfile,
  EMPTY_DEFAULTS,
  isVoiceProfile,
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
  it("seeds the built-ins the first time, before anything is written", () => {
    const seeded = seedVoicesState(undefined, undefined);
    expect(seeded.seeded).toBe(true);
    expect(seeded.profiles.map((p) => p.id)).toEqual([
      BUILT_IN_ES_ID,
      BUILT_IN_EN_ID,
    ]);
    expect(seeded.defaults).toEqual({
      "es-ES": BUILT_IN_ES_ID,
      "en-US": BUILT_IN_EN_ID,
    });
  });

  it("does not resurrect built-ins once the list was emptied by hand", () => {
    const state = seedVoicesState([], { "es-ES": BUILT_IN_ES_ID });
    expect(state.seeded).toBe(false);
    expect(state.profiles).toEqual([]);
    expect(state.defaults).toEqual(EMPTY_DEFAULTS);
  });

  it("keeps stored profiles and prunes their broken defaults", () => {
    const state = seedVoicesState([profile()], { "es-ES": "v-1", "en-US": "v-1" });
    expect(state.seeded).toBe(false);
    expect(state.profiles.map((p) => p.id)).toEqual(["v-1"]);
    expect(state.defaults).toEqual({ "es-ES": "v-1", "en-US": null });
  });
});
