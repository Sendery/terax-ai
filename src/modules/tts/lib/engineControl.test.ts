import { describe, expect, it } from "vitest";
import { hasInstalledEngine, isEngineRunning, modelChoices } from "./engineControl";
import { BUILTIN_VOICE_ID, type TtsEngineId, type TtsModelId } from "./engines";
import type { TtsEngineStatus, TtsModelStatus, TtsStatus } from "./native";
import { BUILT_IN_DEFAULTS, createProfile, type VoiceProfile } from "./voices";

function engine(id: TtsEngineId, over: Partial<TtsEngineStatus> = {}) {
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
  } satisfies TtsEngineStatus;
}

function model(id: TtsModelId, downloaded: boolean): TtsModelStatus {
  return {
    id,
    engine: id === "kokoro-82m" ? "kokoro" : "chatterbox",
    downloaded,
    sizeBytes: downloaded ? 1 : 0,
  };
}

function status(over: Partial<TtsStatus> = {}): TtsStatus {
  return {
    runtime: { installed: true, uvVersion: null, pythonVersion: null },
    engines: [engine("kokoro"), engine("chatterbox")],
    models: [
      model("kokoro-82m", true),
      model("chatterbox-multilingual", true),
      model("chatterbox-turbo", false),
      model("chatterbox-nano", false),
    ],
    jobs: [],
    diskUsageBytes: 0,
    ...over,
  };
}

const PROFILES: VoiceProfile[] = [...BUILT_IN_DEFAULTS];

describe("hasInstalledEngine", () => {
  it("is false until something is installed, so the control stays hidden", () => {
    expect(hasInstalledEngine(null)).toBe(false);
    expect(
      hasInstalledEngine(
        status({ engines: [engine("kokoro", { installed: false })] }),
      ),
    ).toBe(false);
    expect(hasInstalledEngine(status())).toBe(true);
  });
});

describe("isEngineRunning", () => {
  it("reads the engine's own row", () => {
    const running = status({
      engines: [engine("kokoro", { running: true }), engine("chatterbox")],
    });
    expect(isEngineRunning(running, "kokoro")).toBe(true);
    expect(isEngineRunning(running, "chatterbox")).toBe(false);
    expect(isEngineRunning(null, "kokoro")).toBe(false);
  });
});

describe("modelChoices", () => {
  it("offers every model and picks the profile each one would speak with", () => {
    const choices = modelChoices(status(), PROFILES, "es-ES");
    expect(choices.map((c) => c.id)).toEqual([
      "kokoro-82m",
      "chatterbox-multilingual",
      "chatterbox-turbo",
      "chatterbox-nano",
    ]);
    const multilingual = choices.find(
      (c) => c.id === "chatterbox-multilingual",
    );
    // The seeded built-in voice makes chatterbox selectable with no sample.
    expect(multilingual?.blockedReason).toBeNull();
    expect(multilingual?.profileId).toBe(
      PROFILES.find(
        (p) => p.model === "chatterbox-multilingual" && p.language === "es-ES",
      )?.id,
    );
  });

  it("says why a model cannot be picked instead of hiding it", () => {
    const choices = modelChoices(status(), PROFILES, "es-ES");
    // Turbo is English-only and undownloaded: both reasons are real, and the
    // download is the one the user can act on first.
    expect(choices.find((c) => c.id === "chatterbox-turbo")?.blockedReason).toBe(
      "Not downloaded",
    );

    const noEngine = modelChoices(
      status({ engines: [engine("kokoro"), engine("chatterbox", { installed: false })] }),
      PROFILES,
      "es-ES",
    );
    expect(
      noEngine.find((c) => c.id === "chatterbox-multilingual")?.blockedReason,
    ).toBe("Engine not installed");
  });

  it("blocks a model whose only profile still needs a sample", () => {
    const incomplete = createProfile({
      name: "Mine",
      model: "chatterbox-multilingual",
      language: "es-ES",
      voice: null,
      sampleId: null,
    });
    const choices = modelChoices(status(), [incomplete], "es-ES");
    const multilingual = choices.find(
      (c) => c.id === "chatterbox-multilingual",
    );
    expect(multilingual?.profileId).toBeNull();
    expect(multilingual?.blockedReason).toBe("No voice for this language");
  });

  it("accepts a profile on the built-in voice as speakable", () => {
    const builtin = createProfile({
      name: "Mine",
      model: "chatterbox-multilingual",
      language: "es-ES",
      voice: BUILTIN_VOICE_ID,
    });
    expect(builtin.sampleId).toBeNull();
    const choices = modelChoices(status(), [builtin], "es-ES");
    expect(
      choices.find((c) => c.id === "chatterbox-multilingual")?.profileId,
    ).toBe(builtin.id);
  });
});
