import { describe, expect, it } from "vitest";
import { MODEL_LANGUAGES, presetVoicesOf, TTS_MODELS } from "./engines";
import {
  canonicalVoiceId,
  DEFAULT_PRESET_IDS,
  findVoice,
  isPresetId,
  parsePresetId,
  presetId,
  presetProfile,
  presetProfiles,
} from "./presets";
import {
  BUILT_IN_EN_ID,
  BUILT_IN_ES_ID,
  createProfile,
  defaultVoiceFor,
  EMPTY_DEFAULTS,
  isProfileSpeakable,
  isVoiceProfile,
  profilesByLanguage,
  resolveVoice,
  type VoiceDefaults,
  LEGACY_BUILT_INS,
  type VoiceProfile,
} from "./voices";

const PREFS = { ttsDefaultLanguage: "es-ES" } as const;

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

describe("isVoiceProfile", () => {
  it("accepts a well formed profile", () => {
    expect(isVoiceProfile(profile())).toBe(true);
    expect(
      isVoiceProfile(
        profile({
          model: "chatterbox-turbo",
          language: "en-US",
          voice: null,
          sampleId: "s-1",
          params: { exaggeration: 0.7, cfgWeight: 0.4, temperature: 1 },
          style: { persona: "narrator", tags: ["[laugh]"] },
        }),
      ),
    ).toBe(true);
  });

  it("rejects an unknown model, engine or language", () => {
    expect(isVoiceProfile(profile({ model: "piper-x" as never }))).toBe(false);
    expect(isVoiceProfile(profile({ language: "ja-JP" as never }))).toBe(false);
    // Kokoro has no German voice, so a German Kokoro profile is not usable.
    expect(isVoiceProfile(profile({ language: "de-DE" }))).toBe(false);
    expect(isVoiceProfile(profile({ language: "fr-FR", voice: "ff_siwis" }))).toBe(true);
  });

  it("rejects a model that cannot speak the profile language", () => {
    expect(
      isVoiceProfile(profile({ model: "chatterbox-turbo", sampleId: "s" })),
    ).toBe(false);
  });

  it("rejects params out of range or unknown to the model", () => {
    expect(isVoiceProfile(profile({ params: { speed: 0.4 } }))).toBe(false);
    expect(isVoiceProfile(profile({ params: { speed: 2.5 } }))).toBe(false);
    expect(isVoiceProfile(profile({ params: { speed: 1.5 } }))).toBe(true);
    expect(isVoiceProfile(profile({ params: { temperature: 1 } }))).toBe(false);
    expect(
      isVoiceProfile(profile({ params: { speed: "fast" } as never })),
    ).toBe(false);
  });

  it("rejects non-string tags and unknown style keys", () => {
    expect(isVoiceProfile(profile({ style: { tags: [1] } as never }))).toBe(
      false,
    );
    expect(
      isVoiceProfile(profile({ style: { tags: "[laugh]" } as never })),
    ).toBe(false);
    expect(isVoiceProfile(profile({ style: { mood: "sad" } as never }))).toBe(
      false,
    );
    expect(isVoiceProfile(profile({ style: { persona: 4 } as never }))).toBe(
      false,
    );
  });

  it("rejects broken identity and timestamps", () => {
    expect(isVoiceProfile(profile({ id: "" }))).toBe(false);
    expect(isVoiceProfile(profile({ name: "" }))).toBe(false);
    expect(isVoiceProfile(profile({ createdAt: Number.NaN }))).toBe(false);
    expect(isVoiceProfile(profile({ createdAt: -1 }))).toBe(false);
    expect(isVoiceProfile(null)).toBe(false);
    expect(isVoiceProfile([profile()])).toBe(false);
    expect(isVoiceProfile("Dora")).toBe(false);
  });

  it("keeps every legacy built-in valid, so a migration can compare them", () => {
    for (const built of LEGACY_BUILT_INS) {
      expect(isVoiceProfile(built)).toBe(true);
      expect(isProfileSpeakable(built)).toBe(true);
    }
  });
});

describe("createProfile", () => {
  it("always produces something the guard accepts", () => {
    const created = createProfile({
      name: "  Loud  ",
      model: "kokoro-82m",
      language: "en-US",
      voice: " af_heart ",
      params: { speed: 9, temperature: 1 },
      style: { persona: "  calm  ", tags: ["[laugh]"] },
    });
    expect(isVoiceProfile(created)).toBe(true);
    expect(created.name).toBe("Loud");
    expect(created.voice).toBe("af_heart");
    // Clamped into range, and the param the model rejects is dropped.
    expect(created.params).toEqual({ speed: 2 });
    expect(created.style).toEqual({ persona: "calm" });
    expect(created.id).toMatch(/^v-/);
  });

  it("drops a preset on a cloning model and a sample on a preset one", () => {
    const clone = createProfile({
      name: "Clone",
      model: "chatterbox-turbo",
      language: "en-US",
      voice: "af_heart",
      sampleId: "s-1",
    });
    expect(clone.voice).toBeNull();
    expect(clone.sampleId).toBe("s-1");
    expect(isProfileSpeakable(clone)).toBe(true);

    const preset = createProfile({
      name: "Preset",
      model: "kokoro-82m",
      language: "en-US",
      sampleId: "s-1",
    });
    expect(preset.sampleId).toBeNull();
    expect(isProfileSpeakable(preset)).toBe(false);
  });

  it("keeps tags only for models that read them", () => {
    const kokoro = createProfile({
      name: "K",
      model: "kokoro-82m",
      language: "en-US",
      voice: "af_heart",
      style: { tags: ["[laugh]"] },
    });
    expect(kokoro.style.tags).toBeUndefined();
  });
});

describe("defaultVoiceFor", () => {
  const profiles = [
    profile(),
    profile({
      id: "v-2",
      language: "en-US",
      model: "kokoro-82m",
      voice: "af_heart",
      name: "Heart",
    }),
  ];

  it("returns the profile the language points at", () => {
    const defaults: VoiceDefaults = { "es-ES": "v-1", "en-US": "v-2" };
    expect(defaultVoiceFor(profiles, defaults, "es-ES")?.id).toBe("v-1");
    expect(defaultVoiceFor(profiles, defaults, "en-US")?.id).toBe("v-2");
  });

  it("ignores a dangling id or a cross-language default", () => {
    expect(
      defaultVoiceFor(
        profiles,
        { ...EMPTY_DEFAULTS, "es-ES": "gone" },
        "es-ES",
      ),
    ).toBeNull();
    expect(
      defaultVoiceFor(profiles, { ...EMPTY_DEFAULTS, "es-ES": "v-2" }, "es-ES"),
    ).toBeNull();
  });
});

describe("resolveVoice", () => {
  const es = profile();
  const en = profile({
    id: "v-2",
    name: "Heart",
    language: "en-US",
    voice: "af_heart",
  });
  const extraEn = profile({
    id: "v-3",
    name: "Adam",
    language: "en-US",
    voice: "am_adam",
  });
  const all = [es, en, extraEn];
  const defaults: VoiceDefaults = { "es-ES": "v-1", "en-US": "v-2" };

  it("lets an explicit voice win over every default", () => {
    expect(resolveVoice(all, defaults, PREFS, { voiceId: "v-3" })?.id).toBe(
      "v-3",
    );
    expect(
      resolveVoice(all, defaults, PREFS, { voiceId: "v-3", language: "es-ES" })
        ?.id,
    ).toBe("v-3");
  });

  it("falls back to the default of the asked language", () => {
    expect(resolveVoice(all, defaults, PREFS, { language: "en-US" })?.id).toBe(
      "v-2",
    );
  });

  it("stays in the asked language when it has no default", () => {
    const partial: VoiceDefaults = { "es-ES": "v-1", "en-US": null };
    // The user's own English profile, never the Spanish default.
    expect(resolveVoice(all, partial, PREFS, { language: "en-US" })?.id).toBe(
      "v-2",
    );
  });

  it("falls back to any profile in the asked language", () => {
    expect(
      resolveVoice(all, EMPTY_DEFAULTS, PREFS, { language: "en-US" })?.id,
    ).toBe("v-2");
  });

  it("uses the preferred language when the request names none", () => {
    expect(resolveVoice(all, defaults, PREFS)?.id).toBe("v-1");
    expect(
      resolveVoice(all, defaults, { ttsDefaultLanguage: "en-US" })?.id,
    ).toBe("v-2");
  });

  it("ignores an unknown voice id rather than failing", () => {
    expect(resolveVoice(all, defaults, PREFS, { voiceId: "nope" })?.id).toBe(
      "v-1",
    );
  });

  it("falls back to the catalogue default when nothing else speaks the language", () => {
    expect(resolveVoice([], EMPTY_DEFAULTS, PREFS)?.id).toBe(
      DEFAULT_PRESET_IDS["es-ES"],
    );
    expect(
      resolveVoice([en], EMPTY_DEFAULTS, PREFS, { language: "de-DE" })?.id,
    ).toBe(DEFAULT_PRESET_IDS["de-DE"]);
  });

  it("resolves preset ids and the ids of the old seeded profiles", () => {
    const lola = presetId("pocket-tts", "es-ES", "lola");
    expect(resolveVoice([], { "es-ES": lola }, PREFS)?.voice).toBe("lola");
    expect(resolveVoice([], EMPTY_DEFAULTS, PREFS, { voiceId: lola })?.model).toBe(
      "pocket-tts",
    );
    // A document saved with dev.24's "builtin-es-dora" still reads with Dora.
    const dora = resolveVoice([], EMPTY_DEFAULTS, PREFS, { voiceId: BUILT_IN_ES_ID });
    expect(dora?.id).toBe(presetId("kokoro-82m", "es-ES", "ef_dora"));
    // But an edited copy the user kept wins over the preset.
    const kept = profile({ id: BUILT_IN_ES_ID, name: "Mi Dora" });
    expect(resolveVoice([kept], EMPTY_DEFAULTS, PREFS, { voiceId: BUILT_IN_ES_ID })?.name).toBe(
      "Mi Dora",
    );
  });
});

describe("preset voices", () => {
  it("builds a stable id from model, language and voice, and parses it back", () => {
    const id = presetId("zonos3-mini", "de-DE", "default_09d206a5b067ae71");
    expect(id).toBe("preset:zonos3-mini:de-DE:default_09d206a5b067ae71");
    expect(isPresetId(id)).toBe(true);
    expect(parsePresetId(id)).toEqual({
      model: "zonos3-mini",
      language: "de-DE",
      voice: "default_09d206a5b067ae71",
    });
    expect(parsePresetId("preset:piper:es-ES:x")).toBeNull();
    expect(parsePresetId("preset:kokoro-82m:ja-JP:x")).toBeNull();
    expect(parsePresetId("v-1")).toBeNull();
  });

  it("generates one valid, speakable profile per sample-free voice", () => {
    const all = presetProfiles();
    let expected = 0;
    for (const model of TTS_MODELS) {
      for (const language of MODEL_LANGUAGES[model]) {
        expected += presetVoicesOf(model, language).length;
      }
    }
    expect(all.length).toBe(expected);
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
    for (const voice of all) {
      expect(isVoiceProfile(voice), voice.id).toBe(true);
      expect(isProfileSpeakable(voice), voice.id).toBe(true);
      expect(voice.sampleId).toBeNull();
    }
  });

  it("only knows voices a model speaks in that language", () => {
    expect(presetProfile(presetId("kokoro-82m", "de-DE", "af_heart"))).toBeNull();
    expect(presetProfile(presetId("chatterbox-turbo", "en-US", "builtin"))?.name).toBe(
      "Chatterbox built-in",
    );
  });

  it("maps every legacy built-in to an existing preset", () => {
    for (const built of LEGACY_BUILT_INS) {
      const canonical = canonicalVoiceId(built.id);
      const preset = presetProfile(canonical);
      expect(preset, built.id).not.toBeNull();
      expect(preset?.model).toBe(built.model);
      expect(preset?.language).toBe(built.language);
      expect(preset?.voice).toBe(built.voice);
    }
    expect(canonicalVoiceId("v-1")).toBe("v-1");
    expect(findVoice([], BUILT_IN_EN_ID)?.voice).toBe("af_heart");
  });

  it("has a catalogue default for every language", () => {
    for (const [language, id] of Object.entries(DEFAULT_PRESET_IDS)) {
      expect(presetProfile(id)?.language).toBe(language);
    }
  });

  it("groups profiles by language with every language present", () => {
    const grouped = profilesByLanguage([profile(), profile({ id: "v-2", language: "en-US", voice: "af_heart" })]);
    expect(Object.keys(grouped)).toHaveLength(6);
    expect(grouped["es-ES"].map((p) => p.id)).toEqual(["v-1"]);
    expect(grouped["en-US"].map((p) => p.id)).toEqual(["v-2"]);
    expect(grouped["fr-FR"]).toEqual([]);
  });
});

describe("profiles of the dev.25 models", () => {
  it("keeps a clone model's default voice and drops the sample", () => {
    const profile = createProfile({
      name: "Ximena",
      model: "zonos3-mini",
      language: "es-ES",
      voice: "default_43e790fc116fd62a",
      sampleId: "s-1",
    });
    expect(profile.voice).toBe("default_43e790fc116fd62a");
    expect(profile.sampleId).toBeNull();
    expect(isProfileSpeakable(profile)).toBe(true);
  });

  it("treats another language's default voice as needing a sample", () => {
    const profile = createProfile({
      name: "Wrong",
      model: "zonos3-mini",
      language: "es-ES",
      voice: "default_de4d191ca7574982",
    });
    expect(profile.voice).toBeNull();
    expect(isProfileSpeakable(profile)).toBe(false);
  });

});
