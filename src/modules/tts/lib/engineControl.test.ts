import { describe, expect, it } from "vitest";
import { hasInstalledEngine, isEngineRunning } from "./engineControl";
import type { TtsEngineId, TtsModelId } from "./engines";
import type { TtsEngineStatus, TtsModelStatus, TtsStatus } from "./native";

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
