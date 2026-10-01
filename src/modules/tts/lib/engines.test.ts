import { describe, expect, it } from "vitest";
import {
  ENGINE_APPROX_BYTES,
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
  MODEL_LABELS,
  MODEL_LANGUAGES,
  MODEL_PARAMS,
  MODEL_VOICE_SOURCE,
  modelAcceptsParam,
  modelsForLanguage,
  modelsOfEngine,
  modelSupportsLanguage,
  modelSupportsTags,
  PREVIEW_SENTENCES,
  TTS_ENGINES,
  TTS_LANGUAGES,
  TTS_MODELS,
} from "./engines";

describe("engine and model lists", () => {
  it("keeps both lists closed", () => {
    expect(TTS_ENGINES).toEqual(["kokoro", "chatterbox"]);
    expect(TTS_MODELS).toEqual([
      "kokoro-82m",
      "chatterbox-multilingual",
      "chatterbox-turbo",
      "chatterbox-nano",
    ]);
    expect(TTS_LANGUAGES).toEqual(["es-ES", "en-US"]);
  });

  it("derives the engine from the model", () => {
    expect(engineOf("kokoro-82m")).toBe("kokoro");
    expect(engineOf("chatterbox-multilingual")).toBe("chatterbox");
    expect(engineOf("chatterbox-turbo")).toBe("chatterbox");
    expect(engineOf("chatterbox-nano")).toBe("chatterbox");
  });

  it("labels, describes and sizes every entry", () => {
    for (const engine of TTS_ENGINES) {
      expect(ENGINE_LABELS[engine]).toBeTruthy();
      expect(ENGINE_APPROX_BYTES[engine]).toBeGreaterThan(0);
      expect(modelsOfEngine(engine).length).toBeGreaterThan(0);
    }
    for (const model of TTS_MODELS) {
      expect(MODEL_LABELS[model]).toBeTruthy();
      expect(MODEL_APPROX_BYTES[model]).toBeGreaterThan(0);
      expect(MODEL_LANGUAGES[model].length).toBeGreaterThan(0);
      expect(["preset", "clone"]).toContain(MODEL_VOICE_SOURCE[model]);
    }
    for (const language of TTS_LANGUAGES) {
      expect(LANGUAGE_LABELS[language]).toBeTruthy();
      expect(PREVIEW_SENTENCES[language].length).toBeGreaterThan(10);
      expect(KOKORO_PRESET_VOICES[language].length).toBeGreaterThan(0);
    }
  });
});

describe("language support", () => {
  it("keeps the Chatterbox English-only models out of Spanish", () => {
    expect(modelSupportsLanguage("chatterbox-turbo", "en-US")).toBe(true);
    expect(modelSupportsLanguage("chatterbox-turbo", "es-ES")).toBe(false);
    expect(modelSupportsLanguage("chatterbox-nano", "es-ES")).toBe(false);
  });

  it("offers only models that speak the asked language", () => {
    expect(modelsForLanguage("es-ES")).toEqual([
      "kokoro-82m",
      "chatterbox-multilingual",
    ]);
    expect(modelsForLanguage("en-US")).toEqual(TTS_MODELS);
  });
});

describe("params", () => {
  it("gives Kokoro speed only and Chatterbox the expressive trio", () => {
    expect(MODEL_PARAMS["kokoro-82m"].map((p) => p.name)).toEqual(["speed"]);
    expect(MODEL_PARAMS["chatterbox-turbo"].map((p) => p.name)).toEqual([
      "exaggeration",
      "cfgWeight",
      "temperature",
    ]);
    expect(modelAcceptsParam("kokoro-82m", "temperature")).toBe(false);
    expect(modelAcceptsParam("chatterbox-nano", "temperature")).toBe(true);
  });

  it("keeps every default inside its own range", () => {
    for (const model of TTS_MODELS) {
      for (const spec of MODEL_PARAMS[model]) {
        expect(spec.min).toBeLessThan(spec.max);
        expect(spec.step).toBeGreaterThan(0);
        expect(spec.default).toBeGreaterThanOrEqual(spec.min);
        expect(spec.default).toBeLessThanOrEqual(spec.max);
      }
    }
  });
});

describe("expressiveness tags", () => {
  it("carries the 19 documented Chatterbox tags", () => {
    expect(EXPRESSIVENESS_TAGS).toHaveLength(19);
    expect(EXPRESSIVENESS_TAGS.map((t) => t.tag)).toContain("[whispering]");
    expect(new Set(EXPRESSIVENESS_TAGS.map((t) => t.tag)).size).toBe(19);
    for (const tag of EXPRESSIVENESS_TAGS) {
      expect(tag.tag.startsWith("[")).toBe(true);
      expect(tag.tag.endsWith("]")).toBe(true);
    }
  });

  it("flags only the three tags the README documents", () => {
    expect(
      EXPRESSIVENESS_TAGS.filter((t) => t.documented).map((t) => t.tag),
    ).toEqual(["[chuckle]", "[cough]", "[laugh]"]);
  });

  it("offers tags for Turbo and Nano only", () => {
    expect(modelSupportsTags("chatterbox-turbo")).toBe(true);
    expect(modelSupportsTags("chatterbox-nano")).toBe(true);
    expect(modelSupportsTags("chatterbox-multilingual")).toBe(false);
    expect(modelSupportsTags("kokoro-82m")).toBe(false);
  });
});

describe("guards", () => {
  it("refuses anything outside the closed lists", () => {
    expect(isTtsEngineId("kokoro")).toBe(true);
    expect(isTtsEngineId("piper")).toBe(false);
    expect(isTtsModelId("kokoro-82m")).toBe(true);
    expect(isTtsModelId("kokoro-82M")).toBe(false);
    expect(isTtsLanguage("es-ES")).toBe(true);
    expect(isTtsLanguage("es")).toBe(false);
    expect(isTtsDevice("mps")).toBe(true);
    expect(isTtsDevice("gpu")).toBe(false);
    expect(isTtsEngineId(null)).toBe(false);
    expect(isTtsModelId(3)).toBe(false);
  });
});
