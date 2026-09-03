import { describe, expect, it } from "vitest";
import { TTS_MODELS } from "./engines";
import {
  BUILT_IN_DEFAULTS,
  BUILT_IN_EN_ID,
  BUILT_IN_ES_ID,
  builtInDefaultsMap,
  createProfile,
  defaultVoiceFor,
  EMPTY_DEFAULTS,
  isProfileSpeakable,
  isVoiceProfile,
  profilesByLanguage,
  resolveVoice,
  type VoiceDefaults,
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
    expect(isVoiceProfile(profile({ language: "fr-FR" as never }))).toBe(false);
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
    expect(isVoiceProfile(profile({ style: { tags: "[laugh]" } as never }))).toBe(
      false,
    );
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

  it("keeps every built-in valid", () => {
    for (const built of BUILT_IN_DEFAULTS) {
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
  const profiles = [profile(), profile({ id: "v-2", language: "en-US", model: "kokoro-82m", voice: "af_heart", name: "Heart" })];

  it("returns the profile the language points at", () => {
    const defaults: VoiceDefaults = { "es-ES": "v-1", "en-US": "v-2" };
    expect(defaultVoiceFor(profiles, defaults, "es-ES")?.id).toBe("v-1");
    expect(defaultVoiceFor(profiles, defaults, "en-US")?.id).toBe("v-2");
  });

  it("ignores a dangling id or a cross-language default", () => {
    expect(
      defaultVoiceFor(profiles, { ...EMPTY_DEFAULTS, "es-ES": "gone" }, "es-ES"),
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

  it("uses the preferred language default when the asked one has none", () => {
    const partial: VoiceDefaults = { "es-ES": "v-1", "en-US": null };
    expect(resolveVoice(all, partial, PREFS, { language: "en-US" })?.id).toBe(
      "v-1",
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

  it("returns null when nothing can speak the language", () => {
    expect(resolveVoice([], EMPTY_DEFAULTS, PREFS)).toBeNull();
    expect(
      resolveVoice([en], EMPTY_DEFAULTS, PREFS, { language: "es-ES" }),
    ).toBeNull();
  });
});

describe("built-in defaults", () => {
  it("seeds Spanish Dora and English Heart on Kokoro", () => {
    const [es, en] = BUILT_IN_DEFAULTS;
    expect(es).toMatchObject({
      id: BUILT_IN_ES_ID,
      name: "Dora",
      model: "kokoro-82m",
      language: "es-ES",
      voice: "ef_dora",
    });
    expect(en).toMatchObject({
      id: BUILT_IN_EN_ID,
      name: "Heart",
      model: "kokoro-82m",
      language: "en-US",
      voice: "af_heart",
    });
    expect(builtInDefaultsMap()).toEqual({
      "es-ES": BUILT_IN_ES_ID,
      "en-US": BUILT_IN_EN_ID,
    });
  });

  it("groups profiles by language with every language present", () => {
    const grouped = profilesByLanguage(BUILT_IN_DEFAULTS);
    expect(grouped["es-ES"].map((p) => p.id)).toContain(BUILT_IN_ES_ID);
    expect(grouped["en-US"].map((p) => p.id)).toContain(BUILT_IN_EN_ID);
    expect(grouped["es-ES"][0].id).toBe(BUILT_IN_ES_ID);
    expect(grouped["en-US"][0].id).toBe(BUILT_IN_EN_ID);
  });

  it("ships one usable voice per model, none of them needing a sample", () => {
    for (const model of TTS_MODELS) {
      const voices = BUILT_IN_DEFAULTS.filter((p) => p.model === model);
      expect(voices.length, `${model} has no built-in voice`).toBeGreaterThan(0);
      for (const voice of voices) {
        expect(voice.sampleId).toBeNull();
        expect(isProfileSpeakable(voice)).toBe(true);
      }
    }
  });
});
