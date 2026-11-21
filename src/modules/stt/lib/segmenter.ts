/**
 * Pure audio plumbing for live dictation: a resampler to 16 kHz and an
 * energy-based segmenter that cuts at pauses. No Web Audio here, so all of it
 * is unit tested.
 */

export const STT_SAMPLE_RATE = 16_000;
/** 20 ms frames at 16 kHz. */
export const FRAME_SAMPLES = 320;
const FRAME_MS = (FRAME_SAMPLES / STT_SAMPLE_RATE) * 1000;

/**
 * Streaming box-filter resampler. Each output sample averages the input
 * samples that fall inside its period, which is the low-pass the 48 kHz to
 * 16 kHz path needs and stays correct for any input rate at or above 16 kHz.
 */
export class Downsampler {
  private readonly ratio: number;
  private acc = 0;
  private count = 0;
  /** Input position (in input samples) where the current output period ends. */
  private boundary: number;
  private position = 0;

  constructor(inputRate: number, outputRate = STT_SAMPLE_RATE) {
    if (!(inputRate > 0) || !(outputRate > 0)) {
      throw new Error(`Invalid sample rates ${inputRate} -> ${outputRate}`);
    }
    this.ratio = inputRate / outputRate;
    this.boundary = this.ratio;
  }

  push(input: Float32Array): Float32Array {
    if (this.ratio <= 1) return Float32Array.from(input);
    const out: number[] = [];
    for (let i = 0; i < input.length; i++) {
      this.acc += input[i];
      this.count += 1;
      this.position += 1;
      if (this.position >= this.boundary) {
        out.push(this.acc / this.count);
        this.acc = 0;
        this.count = 0;
        this.boundary += this.ratio;
      }
    }
    return Float32Array.from(out);
  }
}

export type SegmenterOptions = {
  /** Speech needed in a segment before a pause may close it. */
  minSpeechMs?: number;
  /** Silence that closes a segment. */
  pauseMs?: number;
  /** A segment never grows past this; it is cut at its quietest frame. */
  maxSegmentMs?: number;
  /** Silence kept ahead of the first speech in a segment. */
  preRollMs?: number;
};

const DEFAULTS: Required<SegmenterOptions> = {
  minSpeechMs: 2000,
  pauseMs: 600,
  maxSegmentMs: 28_000,
  preRollMs: 300,
};

export function rmsOf(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

/**
 * Collects 16 kHz audio and hands out segments that end in a pause. Speech is
 * any frame well above the running noise floor; the floor adapts down fast
 * and up slowly, so a fan or a quiet room both work.
 */
export class Segmenter {
  private readonly opts: Required<SegmenterOptions>;
  private readonly onSegment: (pcm: Float32Array) => void;
  private pending = new Float32Array(0);
  private frames: Float32Array[] = [];
  private energies: number[] = [];
  private speechMs = 0;
  private silenceMs = 0;
  private floor = 0.002;
  private everSpoke = false;
  private lastLevel = 0;

  constructor(onSegment: (pcm: Float32Array) => void, options: SegmenterOptions = {}) {
    this.onSegment = onSegment;
    this.opts = { ...DEFAULTS, ...options };
  }

  /** 0..1, for a level meter. */
  get level(): number {
    return this.lastLevel;
  }

  /** Whether the segment being collected holds any speech. */
  get hasSpeech(): boolean {
    return this.speechMs > 0;
  }

  push(samples: Float32Array): void {
    const joined = new Float32Array(this.pending.length + samples.length);
    joined.set(this.pending);
    joined.set(samples, this.pending.length);
    let offset = 0;
    while (joined.length - offset >= FRAME_SAMPLES) {
      this.frame(joined.slice(offset, offset + FRAME_SAMPLES));
      offset += FRAME_SAMPLES;
    }
    this.pending = joined.slice(offset);
  }

  /** Hands out whatever is left. Silence-only audio is dropped. */
  flush(): void {
    if (this.pending.length > 0) {
      this.frames.push(this.pending);
      this.energies.push(rmsOf(this.pending));
      this.pending = new Float32Array(0);
    }
    if (this.speechMs > 0) this.emit(this.frames.length);
    this.reset();
  }

  private isSpeech(energy: number): boolean {
    return energy > Math.max(this.floor * 3, 0.006);
  }

  private frame(frame: Float32Array): void {
    const energy = rmsOf(frame);
    this.lastLevel = Math.min(1, energy * 8);
    const speech = this.isSpeech(energy);
    if (!speech) {
      this.floor =
        energy < this.floor
          ? this.floor * 0.7 + energy * 0.3
          : this.floor * 0.995 + energy * 0.005;
    }

    if (!speech && this.speechMs === 0) {
      // Nothing said yet in this segment: keep only a short pre-roll.
      this.frames.push(frame);
      this.energies.push(energy);
      const keep = Math.max(1, Math.round(this.opts.preRollMs / FRAME_MS));
      if (this.frames.length > keep) {
        this.frames.splice(0, this.frames.length - keep);
        this.energies.splice(0, this.energies.length - keep);
      }
      return;
    }

    this.frames.push(frame);
    this.energies.push(energy);
    if (speech) {
      this.everSpoke = true;
      this.speechMs += FRAME_MS;
      this.silenceMs = 0;
    } else {
      this.silenceMs += FRAME_MS;
    }

    if (this.speechMs >= this.opts.minSpeechMs && this.silenceMs >= this.opts.pauseMs) {
      const all = this.frames.length;
      this.emit(all);
      this.startNext(all);
      return;
    }
    if (this.frames.length * FRAME_MS >= this.opts.maxSegmentMs) {
      this.cutAtQuietest();
    }
  }

  /** Cuts a segment that ran too long at its quietest frame in the last 3 s. */
  private cutAtQuietest(): void {
    const window = Math.min(this.frames.length - 1, Math.round(3000 / FRAME_MS));
    let cut = this.frames.length;
    let quietest = Number.POSITIVE_INFINITY;
    for (let i = this.frames.length - window; i < this.frames.length; i++) {
      if (this.energies[i] < quietest) {
        quietest = this.energies[i];
        cut = i + 1;
      }
    }
    this.emit(cut);
    this.startNext(cut);
  }

  private emit(frameCount: number): void {
    const frames = this.frames.slice(0, frameCount);
    const total = frames.reduce((n, f) => n + f.length, 0);
    if (total === 0) return;
    const pcm = new Float32Array(total);
    let at = 0;
    for (const f of frames) {
      pcm.set(f, at);
      at += f.length;
    }
    this.onSegment(pcm);
  }

  /** Keeps the frames after `cut` as the start of the next segment. */
  private startNext(cut: number): void {
    this.frames = this.frames.slice(cut);
    this.energies = this.energies.slice(cut);
    this.speechMs = 0;
    this.silenceMs = 0;
    for (const energy of this.energies) {
      if (this.isSpeech(energy)) this.speechMs += FRAME_MS;
    }
  }

  private reset(): void {
    this.frames = [];
    this.energies = [];
    this.speechMs = 0;
    this.silenceMs = 0;
    this.pending = new Float32Array(0);
  }

  /** True once any speech was heard since the segmenter was created. */
  get heardSpeech(): boolean {
    return this.everSpoke;
  }
}
