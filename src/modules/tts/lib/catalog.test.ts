import { describe, expect, it } from "vitest";
import { missingAction, readinessOf, voiceOptions } from "./catalog";
import type { TtsEngineId, TtsModelId } from "./engines";
import type { TtsEnginePlan, TtsEngineStatus, TtsStatus } from "./native";
import { presetId } from "./presets";
import { createProfile, type VoiceProfile } from "./voices";

function engine(id: TtsEngineId, over: Partial<TtsEngineStatus> = {}): TtsEngineStatus {
  return {
    id,
    installed: true,
    specVersion: 1,
    installedAt: 0,
    latestSpecVersion: 1,
    running: false,
    port: null,
    token: null,
    device: null,
    pid: null,
    sizeBytes: 0,
    ...over,
  };
}

const UNSUPPORTED: TtsEnginePlan = {
  supported: false,
  unsupportedReason: "needs Apple Silicon",
  device: "cpu",
  dtype: null,
  threads: null,
  quantize: false,
  steps: null,
  torchBackend: null,
  notes: [],
};

function status(): TtsStatus {
  const downloaded: TtsModelId[] = ["kokoro-82m", "pocket-tts"];
  return {
    runtime: { installed: true, uvVersion: null, pythonVersion: null },
    engines: [
      engine("kokoro"),
      engine("pocket"),
      engine("chatterbox"),
      engine("omnivoice", { installed: false }),
      engine("zonos3", { installed: false, plan: UNSUPPORTED }),
    ],
    models: (
      ["kokoro-82m", "pocket-tts", "chatterbox-multilingual", "omnivoice", "zonos3-mini"] as const
    ).map((id) => ({
      id,
      engine: id === "kokoro-82m" ? "kokoro" : id === "pocket-tts" ? "pocket" : "chatterbox",
      downloaded: downloaded.includes(id),
      sizeBytes: 1,
    })),
    jobs: [],
    diskUsageBytes: 0,
  };
}

const lola = presetId("pocket-tts", "es-ES", "lola");

describe("readinessOf", () => {
  it("names the one thing each voice is missing", () => {
    const s = status();
    const voice = (model: TtsModelId, v: string | null, sampleId: string | null = null): VoiceProfile =>
      createProfile({ name: "x", model, language: "es-ES", voice: v, sampleId });
    expect(readinessOf(voice("pocket-tts", "lola"), s)).toEqual({ state: "ready" });
    expect(readinessOf(voice("chatterbox-multilingual", "builtin"), s).state).toBe("download");
    expect(readinessOf(voice("omnivoice", "auto"), s).state).toBe("install");
    expect(readinessOf(voice("zonos3-mini", "default_43e790fc116fd62a"), s)).toEqual({
      state: "unsupported",
      reason: "needs Apple Silicon",
    });
    const clone = { ...voice("pocket-tts", "lola"), model: "chatterbox-multilingual" as const, voice: null };
    const ready = status();
    ready.models = ready.models.map((m) => ({ ...m, downloaded: true }));
    expect(readinessOf(clone, ready)).toEqual({ state: "sample" });
  });

  it("phrases the action for the UI", () => {
    expect(missingAction({ state: "ready" })).toBeNull();
    expect(missingAction({ state: "download", model: "pocket-tts", bytes: 480 * 1024 * 1024 })).toMatch(
      /^Download /,
    );
    expect(missingAction({ state: "install", engine: "omnivoice", bytes: 5e9 })).toMatch(
      /^Install OmniVoice, /,
    );
    expect(missingAction({ state: "unsupported", reason: "x" })).toBe("Not available on this machine");
    expect(missingAction({ state: "sample" })).toBe("Needs a sample");
  });
});

describe("voiceOptions", () => {
  it("merges the user's profiles with every preset of the language", () => {
    const mine = createProfile({ id: "v-1", name: "Mine", model: "kokoro-82m", language: "es-ES", voice: "ef_dora" });
    const options = voiceOptions([mine], { "es-ES": lola }, status(), { language: "es-ES" });
    expect(options.every((o) => o.language === "es-ES")).toBe(true);
    // Default first, then ready ones, the user's own before generated ones.
    expect(options[0].id).toBe(lola);
    expect(options[0].isDefault).toBe(true);
    expect(options[1].id).toBe("v-1");
    expect(options[1].kind).toBe("custom");
    expect(options[1].preset).toBe(false);
    const readyCount = options.filter((o) => o.ready).length;
    expect(options.slice(0, readyCount).every((o) => o.ready)).toBe(true);
    const zonos = options.find((o) => o.model === "zonos3-mini");
    expect(zonos?.missing).toBe("Not available on this machine");
    expect(zonos?.kind).toBe("default");
    expect(options.find((o) => o.model === "omnivoice" && o.profile.voice === "design-f-young")?.kind).toBe(
      "designed",
    );
  });

  it("limits to the enabled languages and flags Pocket's lazy languages", () => {
    const options = voiceOptions([], {}, status(), { languages: ["de-DE"] });
    expect(new Set(options.map((o) => o.language))).toEqual(new Set(["de-DE"]));
    expect(options.some((o) => o.model === "kokoro-82m")).toBe(false);
    expect(options.find((o) => o.model === "pocket-tts")?.downloadsOnFirstUse).toBe(true);
  });

  it("treats a missing status as nothing installed", () => {
    const options = voiceOptions([], {}, null, { language: "en-US" });
    expect(options.every((o) => o.readiness.state === "install")).toBe(true);
  });
});
