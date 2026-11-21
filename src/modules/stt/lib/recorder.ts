import { Downsampler, Segmenter, type SegmenterOptions } from "./segmenter";

/**
 * Microphone capture for live dictation. An AudioWorklet copies the raw mono
 * signal off the audio thread, the main thread resamples it to 16 kHz and the
 * segmenter hands out pieces that end in a pause.
 */

/**
 * The worklet is a static file served by the app (public/stt/dictation-tap.js):
 * the CSP's script-src allows 'self' but not blob: URLs, and worklets are
 * scripts.
 */
const WORKLET_URL = "/stt/dictation-tap.js";

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
  private sink: GainNode | null = null;
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
    // A silent sink to the destination: WebKit only renders nodes the
    // destination pulls, so a tap with no route there would never run.
    const sink = context.createGain();
    sink.gain.value = 0;
    sink.connect(context.destination);
    this.sink = sink;
    let node: AudioWorkletNode | ScriptProcessorNode | null = null;
    if (context.audioWorklet) {
      try {
        await context.audioWorklet.addModule(WORKLET_URL);
        const tap = new AudioWorkletNode(context, "terax-dictation-tap", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        tap.port.onmessage = (event: MessageEvent<Float32Array>) =>
          onSamples(event.data);
        node = tap;
      } catch (err) {
        console.warn("stt.worklet unavailable, using ScriptProcessor", err);
      }
    }
    if (!node) {
      // Older webviews, or a worklet that failed to load.
      const processor = context.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) =>
        onSamples(Float32Array.from(event.inputBuffer.getChannelData(0)));
      node = processor;
    }
    this.source.connect(node);
    node.connect(sink);
    this.node = node;
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
    try {
      this.sink?.disconnect();
    } catch {
      // Already disconnected.
    }
    this.sink = null;
  }
}
