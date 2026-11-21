import { describe, expect, it } from "vitest";
import type { TtsEnginePlan, TtsHardware } from "@/modules/tts/lib/native";
import {
  STT_ENGINE_APPROX_BYTES,
  STT_MODEL_APPROX_BYTES,
  STT_MODEL_ENGINE,
  STT_TIERS,
} from "./catalog";
import { sttDeviceChoices } from "./devices";
import { STT_LOCAL_MODELS } from "./settings";

const PLAN: TtsEnginePlan = {
  supported: true,
  unsupportedReason: null,
  device: "mps",
  dtype: "bfloat16",
  threads: null,
  quantize: false,
  steps: null,
  torchBackend: "cpu",
  notes: [],
};

function hardware(overrides: Partial<TtsHardware> = {}): TtsHardware {
  return {
    os: "macos",
    arch: "aarch64",
    cpu: "Apple M4 Pro",
    appleSilicon: true,
    performanceCores: 10,
    efficiencyCores: 4,
    logicalCpus: 14,
    memoryBytes: 48 * 1024 ** 3,
    avx2: false,
    avx512: false,
    nvidia: null,
    ...overrides,
  };
}

describe("dictation tiers", () => {
  it("ships Light with Rumble-2-Flash and lists Medium and High as planned", () => {
    expect(STT_TIERS.map((t) => [t.id, t.state])).toEqual([
      ["light", "available"],
      ["medium", "planned"],
      ["high", "planned"],
    ]);
    expect(STT_TIERS[0].model).toBe("rumble-2-flash");
    expect(STT_TIERS.filter((t) => t.state === "planned").every((t) => t.model === null)).toBe(
      true,
    );
  });

  it("keeps the Light install near 1 GB of weights plus the torch engine", () => {
    for (const model of STT_LOCAL_MODELS) {
      expect(STT_MODEL_APPROX_BYTES[model]).toBeLessThan(1.1 * 1024 ** 3);
      expect(STT_ENGINE_APPROX_BYTES[STT_MODEL_ENGINE[model]]).toBeGreaterThan(0);
    }
  });
});

describe("sttDeviceChoices", () => {
  it("offers the Apple GPU on Apple Silicon, labelled with the plan's pick", () => {
    expect(sttDeviceChoices(PLAN, hardware())).toEqual([
      { id: "auto", label: "Automatic (recommended: Apple GPU)" },
      { id: "cpu", label: "CPU" },
      { id: "mps", label: "Apple GPU (MPS)" },
    ]);
  });

  it("offers CUDA with an NVIDIA card and nothing when unsupported", () => {
    const nvidia = hardware({
      appleSilicon: false,
      nvidia: { name: "RTX 4060", memoryMb: 8192, driver: "560" },
    });
    expect(sttDeviceChoices({ ...PLAN, device: "cuda" }, nvidia).map((c) => c.id)).toEqual([
      "auto",
      "cpu",
      "cuda",
    ]);
    expect(sttDeviceChoices({ ...PLAN, supported: false }, nvidia)).toEqual([]);
    expect(sttDeviceChoices(null, null)[0]).toEqual({ id: "auto", label: "Automatic" });
  });
});
