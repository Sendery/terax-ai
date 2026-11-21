import { describe, expect, it } from "vitest";
import { Downsampler, FRAME_SAMPLES, rmsOf, Segmenter, STT_SAMPLE_RATE } from "./segmenter";

const MS = STT_SAMPLE_RATE / 1000;

function tone(ms: number, amplitude = 0.2): Float32Array {
  const out = new Float32Array(ms * MS);
  for (let i = 0; i < out.length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * 220 * i) / STT_SAMPLE_RATE);
  }
  return out;
}

function silence(ms: number): Float32Array {
  return new Float32Array(ms * MS);
}

/** Feeds audio in uneven chunks, the way the worklet delivers it. */
function feed(segmenter: Segmenter, audio: Float32Array): void {
  for (let i = 0; i < audio.length; i += 128 * 3) {
    segmenter.push(audio.slice(i, i + 128 * 3));
  }
}

describe("Downsampler", () => {
  it("turns 48 kHz into 16 kHz across chunk boundaries", () => {
    const d = new Downsampler(48_000);
    const input = Float32Array.from({ length: 4800 }, (_, i) => (i % 3 === 0 ? 0.3 : 0));
    const out = [...d.push(input.slice(0, 1000)), ...d.push(input.slice(1000))];
    expect(out).toHaveLength(1600);
    // Box filter: each output averages three inputs.
    expect(out[0]).toBeCloseTo(0.1);
    expect(out[1599]).toBeCloseTo(0.1);
  });

  it("handles fractional ratios and passes 16 kHz through", () => {
    const d = new Downsampler(44_100);
    const out = d.push(new Float32Array(44_100).fill(0.5));
    expect(Math.abs(out.length - 16_000)).toBeLessThanOrEqual(1);
    expect(out[10]).toBeCloseTo(0.5);
    expect(new Downsampler(16_000).push(Float32Array.of(1, 2, 3))).toEqual(
      Float32Array.of(1, 2, 3),
    );
    expect(() => new Downsampler(0)).toThrow();
  });
});

describe("Segmenter", () => {
  it("cuts after enough speech and a pause, keeping a short pre-roll", () => {
    const segments: Float32Array[] = [];
    const s = new Segmenter((pcm) => segments.push(pcm));
    feed(s, silence(1000));
    feed(s, tone(2500));
    feed(s, silence(700));
    expect(segments).toHaveLength(1);
    const seconds = segments[0].length / STT_SAMPLE_RATE;
    // 300 ms pre-roll + 2.5 s of speech + the 600 ms pause that closed it.
    expect(seconds).toBeGreaterThan(3.3);
    expect(seconds).toBeLessThan(3.5);
  });

  it("does not cut short phrases at a pause", () => {
    const segments: Float32Array[] = [];
    const s = new Segmenter((pcm) => segments.push(pcm));
    feed(s, tone(800));
    feed(s, silence(800));
    feed(s, tone(800));
    expect(segments).toHaveLength(0);
    s.flush();
    expect(segments).toHaveLength(1);
  });

  it("drops silence-only audio on flush", () => {
    const segments: Float32Array[] = [];
    const s = new Segmenter((pcm) => segments.push(pcm));
    feed(s, silence(3000));
    s.flush();
    expect(segments).toHaveLength(0);
    expect(s.heardSpeech).toBe(false);
  });

  it("flushes the tail after the last pause", () => {
    const segments: Float32Array[] = [];
    const s = new Segmenter((pcm) => segments.push(pcm));
    feed(s, tone(2200));
    feed(s, silence(650));
    feed(s, tone(1000));
    expect(segments).toHaveLength(1);
    s.flush();
    expect(segments).toHaveLength(2);
    expect(segments[1].length / STT_SAMPLE_RATE).toBeLessThan(1.1);
  });

  it("cuts a run-on segment at the cap, at its quietest frame", () => {
    const segments: Float32Array[] = [];
    const s = new Segmenter((pcm) => segments.push(pcm), { maxSegmentMs: 5000 });
    feed(s, tone(3500));
    feed(s, tone(100, 0.01));
    feed(s, tone(3000));
    expect(segments.length).toBeGreaterThanOrEqual(1);
    const first = segments[0].length / STT_SAMPLE_RATE;
    expect(first).toBeLessThanOrEqual(5);
    s.flush();
    const total = segments.reduce((n, p) => n + p.length, 0) / STT_SAMPLE_RATE;
    expect(total).toBeCloseTo(6.6, 1);
  });

  it("reports a level and adapts to a noisy room", () => {
    const segments: Float32Array[] = [];
    const s = new Segmenter((pcm) => segments.push(pcm));
    feed(s, tone(2000, 0.003));
    expect(s.hasSpeech).toBe(false);
    feed(s, tone(2500, 0.2));
    expect(s.level).toBeGreaterThan(0.5);
    expect(s.hasSpeech).toBe(true);
    expect(rmsOf(new Float32Array(FRAME_SAMPLES))).toBe(0);
  });
});
