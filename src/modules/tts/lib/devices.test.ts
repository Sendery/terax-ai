import { describe, expect, it } from "vitest";
import { deviceChoices } from "./devices";
import type { TtsEnginePlan, TtsHardware } from "./native";

const plan = (device: string, supported = true): TtsEnginePlan => ({
  supported,
  unsupportedReason: supported ? null : "no",
  device,
  dtype: null,
  threads: null,
  quantize: false,
  steps: null,
  torchBackend: null,
  notes: [],
});

const mac: TtsHardware = {
  os: "macos",
  arch: "aarch64",
  cpu: "Apple M4 Pro",
  appleSilicon: true,
  performanceCores: 8,
  efficiencyCores: 4,
  logicalCpus: 12,
  memoryBytes: 1,
  avx2: false,
  avx512: false,
  nvidia: null,
};
const linuxGpu: TtsHardware = {
  ...mac,
  os: "linux",
  arch: "x86_64",
  appleSilicon: false,
  nvidia: { name: "RTX", memoryMb: 1, driver: "1" },
};

describe("deviceChoices", () => {
  it("offers nothing where the plan is the only sensible device", () => {
    expect(deviceChoices("zonos3", plan("mlx"), mac)).toEqual([]);
    expect(deviceChoices("pocket", plan("cpu"), mac)).toEqual([]);
    expect(deviceChoices("zonos3", plan("cpu", false), linuxGpu)).toEqual([]);
  });

  it("marks the plan's device as the recommended automatic choice", () => {
    const kokoro = deviceChoices("kokoro", plan("mps"), mac);
    expect(kokoro.map((c) => c.id)).toEqual(["auto", "cpu", "mps"]);
    expect(kokoro[0].label).toBe("Automatic (recommended: Apple GPU)");
    expect(deviceChoices("pocket", plan("cuda"), linuxGpu).map((c) => c.id)).toEqual([
      "auto",
      "cpu",
      "cuda",
    ]);
    expect(deviceChoices("omnivoice", null, null)[0].label).toBe("Automatic");
  });
});
