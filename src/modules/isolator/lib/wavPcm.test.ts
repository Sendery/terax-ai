import { describe, expect, it } from "vitest";
import { encodeWav16 } from "@/modules/tts/lib/wav";
import { decodeMonoWav16, isIsolatableRate } from "./wavPcm";

function withChunkBeforeData(wav: Uint8Array): Uint8Array {
  // RIFF header and fmt chunk (36 bytes), then a 4-byte LIST chunk, then data.
  const list = new Uint8Array([0x4c, 0x49, 0x53, 0x54, 4, 0, 0, 0, 1, 2, 3, 4]);
  const out = new Uint8Array(wav.byteLength + list.byteLength);
  out.set(wav.subarray(0, 36), 0);
  out.set(list, 36);
  out.set(wav.subarray(36), 36 + list.byteLength);
  return out;
}

describe("decodeMonoWav16", () => {
  it("round-trips what encodeWav16 writes, at its rate", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 0.25]);
    const decoded = decodeMonoWav16(encodeWav16(samples, 24_000));
    expect(decoded.sampleRate).toBe(24_000);
    expect(decoded.samples.length).toBe(4);
    decoded.samples.forEach((value, i) => {
      expect(value).toBeCloseTo(samples[i], 3);
    });
  });

  it("walks past chunks that sit before the audio", () => {
    const wav = withChunkBeforeData(encodeWav16(new Float32Array([0.5, -0.5]), 16_000));
    const decoded = decodeMonoWav16(wav);
    expect(decoded.sampleRate).toBe(16_000);
    expect(decoded.samples.length).toBe(2);
    expect(decoded.samples[0]).toBeCloseTo(0.5, 3);
  });

  it("reads a WAV inside a larger buffer", () => {
    const wav = encodeWav16(new Float32Array([0.25]), 48_000);
    const padded = new Uint8Array(wav.byteLength + 8);
    padded.set(wav, 8);
    expect(decodeMonoWav16(padded.subarray(8)).samples[0]).toBeCloseTo(0.25, 3);
  });

  it("refuses what is not mono 16-bit PCM", () => {
    expect(() => decodeMonoWav16(new Uint8Array([1, 2, 3]))).toThrow();
    const stereo = encodeWav16(new Float32Array(4), 16_000);
    new DataView(stereo.buffer).setUint16(22, 2, true);
    expect(() => decodeMonoWav16(stereo)).toThrow(/mono 16-bit/);
    const noData = encodeWav16(new Float32Array(0), 16_000).subarray(0, 36);
    expect(() => decodeMonoWav16(noData)).toThrow(/no audio/);
  });
});

describe("isIsolatableRate", () => {
  it("takes 8 to 48 kHz and nothing else", () => {
    expect(isIsolatableRate(16_000)).toBe(true);
    expect(isIsolatableRate(44_100)).toBe(true);
    expect(isIsolatableRate(48_000)).toBe(true);
    expect(isIsolatableRate(96_000)).toBe(false);
    expect(isIsolatableRate(4_000)).toBe(false);
    expect(isIsolatableRate(22_050.5)).toBe(false);
  });
});
