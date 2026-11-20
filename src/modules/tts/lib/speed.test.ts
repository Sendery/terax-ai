import { describe, expect, it } from "vitest";
import {
  addSpeedSample,
  formatSpeed,
  MAX_SPEED_SAMPLES,
  measuredSpeed,
  parseSpeedSamples,
  wavSecondsFromHeader,
} from "./speed";
import { encodeWav16 } from "./wav";

describe("measured speed", () => {
  it("reports a median once three clips were timed", () => {
    let samples = {};
    samples = addSpeedSample(samples, "pocket", 4, 2);
    samples = addSpeedSample(samples, "pocket", 3.8, 0.27);
    expect(measuredSpeed(samples, "pocket")).toBeNull();
    samples = addSpeedSample(samples, "pocket", 2.4, 0.2);
    // 2.0 (a cold start), 14.07 and 12.0: the median ignores the cold start.
    expect(measuredSpeed(samples, "pocket")).toBe(12);
    expect(measuredSpeed(samples, "kokoro")).toBeNull();
  });

  it("ignores clips too short to time and keeps the newest samples", () => {
    expect(addSpeedSample({}, "kokoro", 0.4, 0.1)).toEqual({});
    expect(addSpeedSample({}, "kokoro", 2, 0)).toEqual({});
    let samples = {};
    for (let i = 0; i < MAX_SPEED_SAMPLES + 5; i++) {
      samples = addSpeedSample(samples, "kokoro", 2, 1);
    }
    expect(parseSpeedSamples(samples).kokoro).toHaveLength(MAX_SPEED_SAMPLES);
  });

  it("parses only valid stored samples", () => {
    expect(parseSpeedSamples({ pocket: [1, "x", -2, 3], piper: [1], kokoro: "no" })).toEqual({
      pocket: [1, 3],
    });
    expect(parseSpeedSamples(null)).toEqual({});
  });

  it("formats with one decimal below ten", () => {
    expect(formatSpeed(13.2)).toBe("13x real time");
    expect(formatSpeed(4.44)).toBe("4.4x real time");
  });

  it("reads the duration from a WAV header", () => {
    const wav = encodeWav16(new Float32Array(48_000), 24_000);
    const seconds = wavSecondsFromHeader(wav.buffer.slice(0, 44) as ArrayBuffer, wav.byteLength);
    expect(seconds).toBeCloseTo(2, 5);
    expect(wavSecondsFromHeader(new ArrayBuffer(10), 10)).toBeNull();
  });
});
