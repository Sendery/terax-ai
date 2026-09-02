import { describe, expect, it } from "vitest";
import { formatApproxBytes, formatBytes } from "./format";
import { samplePathFor } from "./native";
import { encodeWav16, SAMPLE_TARGET_RATE, wavDurationSeconds } from "./wav";

function ascii(bytes: Uint8Array, from: number, length: number): string {
  return String.fromCharCode(...bytes.slice(from, from + length));
}

describe("encodeWav16", () => {
  it("writes a mono 16-bit RIFF header at the target rate", () => {
    const wav = encodeWav16(new Float32Array(4), SAMPLE_TARGET_RATE);
    const view = new DataView(wav.buffer);
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(ascii(wav, 8, 4)).toBe("WAVE");
    expect(ascii(wav, 12, 4)).toBe("fmt ");
    expect(ascii(wav, 36, 4)).toBe("data");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint32(28, true)).toBe(48_000);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getUint32(4, true)).toBe(44);
    expect(wav.byteLength).toBe(52);
  });

  it("clamps samples outside the unit range", () => {
    const wav = encodeWav16(
      new Float32Array([0, 1, -1, 2, -2]),
      SAMPLE_TARGET_RATE,
    );
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(32_767);
    expect(view.getInt16(48, true)).toBe(-32_768);
    expect(view.getInt16(50, true)).toBe(32_767);
    expect(view.getInt16(52, true)).toBe(-32_768);
  });

  it("reports the duration it encoded", () => {
    const wav = encodeWav16(new Float32Array(24_000), SAMPLE_TARGET_RATE);
    expect(wavDurationSeconds(wav.byteLength, SAMPLE_TARGET_RATE)).toBe(1);
  });
});

describe("samplePathFor", () => {
  const layout = {
    root: "/data/tts",
    runtime: "/data/tts/runtime",
    engines: "/data/tts/engines",
    models: "/data/tts/models",
    voices: "/data/tts/voices",
    logs: "/data/tts/logs",
  };

  it("points inside the samples directory the sidecar accepts", () => {
    expect(samplePathFor(layout, "s-1")).toBe("/data/tts/voices/samples/s-1.wav");
    expect(samplePathFor({ ...layout, voices: "/data/tts/voices/" }, "s-1")).toBe(
      "/data/tts/voices/samples/s-1.wav",
    );
  });

  it("keeps Windows separators", () => {
    expect(
      samplePathFor({ ...layout, voices: "C:\\data\\tts\\voices" }, "s-1"),
    ).toBe("C:\\data\\tts\\voices\\samples\\s-1.wav");
  });
});

describe("formatBytes", () => {
  it("scales from bytes to gigabytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(330 * 1024 * 1024)).toBe("330 MB");
    expect(formatBytes(4 * 1024 ** 3)).toBe("4.0 GB");
    expect(formatApproxBytes(1024)).toBe("~1.0 KB");
  });
});
