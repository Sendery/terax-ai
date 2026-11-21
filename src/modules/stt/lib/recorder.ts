import { Downsampler, Segmenter, type SegmenterOptions } from "./segmenter";

/**
 * Microphone capture for live dictation. An AudioWorklet copies the raw mono
 * signal off the audio thread, the main thread resamples it to 16 kHz and the
 * segmenter hands out pieces that end in a pause.
 */

const WORKLET_SOURCE = `
class TeraxDictationTap extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0 && input[0].length > 0) {
      const frames = input[0].length;
      const mono = new Float32Array(frames);
      for (let c = 0; c < input.length; c++) {
        const channel = input[c];
        for (let i = 0; i < frames; i++) mono[i] += channel[i] / input.length;
      }
      this.port.postMessage(mono, [mono.buffer]);
    }
    return true;
  }
}
registerProcessor("terax-dictation-tap", TeraxDictationTap);
`;

export type DictationRecorderOptions = {
  onSegment: (pcm16k: Float32Array) => void;
  segmenter?: SegmenterOptions;
  /** Hands every segment out only at stop (live segments off). */
  holdUntilStop?: boolean;
};

export class DictationRecorder {
  private readonly options: DictationRecorderOptions;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | ScriptProcessorNode | null = null;
  private moduleUrl: string | null = null;
  private segmenter: Segmenter;
  private downsampler: Downsampler | null = null;
  private stopped = false;

  constructor(options: DictationRecorderOptions) {
    this.options = options;
    this.segmenter = this.makeSegmenter();
  }

  private makeSegmenter(): Segmenter {
    const opts = this.options.holdUntilStop
      ? // A segment as long as the recording: cut only at the 28 s cap.
        { ...this.options.segmenter, minSpeechMs: Number.POSITIVE_INFINITY }
      : this.options.segmenter;
    return new Segmenter((pcm) => this.options.onSegment(pcm), opts);
  }

  /** 0..1, the loudness of the last 20 ms. */
  get level(): number {
    return this.segmenter.level;
  }

  static supported(): boolean {
    return (
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof AudioContext !== "undefined"
    );
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    if (this.stopped) {
      this.teardown();
      return;
    }
    const context = new AudioContext();
    this.context = context;
    this.downsampler = new Downsampler(context.sampleRate);
    this.source = context.createMediaStreamSource(this.stream);
    const onSamples = (samples: Float32Array) => {
      if (this.stopped || !this.downsampler) return;
      this.segmenter.push(this.downsampler.push(samples));
    };
    if (context.audioWorklet) {
      this.moduleUrl = URL.createObjectURL(
        new Blob([WORKLET_SOURCE], { type: "application/javascript" }),
      );
      await context.audioWorklet.addModule(this.moduleUrl);
      const node = new AudioWorkletNode(context, "terax-dictation-tap", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      });
      node.port.onmessage = (event: MessageEvent<Float32Array>) =>
        onSamples(event.data);
      this.source.connect(node);
      this.node = node;
    } else {
      // Older webviews without AudioWorklet.
      const node = context.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (event) =>
        onSamples(Float32Array.from(event.inputBuffer.getChannelData(0)));
      this.source.connect(node);
      node.connect(context.destination);
      this.node = node;
    }
    if (context.state === "suspended") await context.resume();
  }

  /** Stops capture and hands out the last segment. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.segmenter.flush();
    this.teardown();
  }

  /** Stops capture and drops whatever was not handed out yet. */
  cancel(): void {
    this.stopped = true;
    this.teardown();
  }

  private teardown(): void {
    if (this.node) {
      if ("port" in this.node) this.node.port.onmessage = null;
      else this.node.onaudioprocess = null;
      try {
        this.node.disconnect();
      } catch {
        // Already disconnected.
      }
      this.node = null;
    }
    try {
      this.source?.disconnect();
    } catch {
      // Already disconnected.
    }
    this.source = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    if (this.context) {
      void this.context.close().catch(() => undefined);
      this.context = null;
    }
    if (this.moduleUrl) {
      URL.revokeObjectURL(this.moduleUrl);
      this.moduleUrl = null;
    }
  }
}
