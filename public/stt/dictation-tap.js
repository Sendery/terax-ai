// Copies the microphone signal, mixed to mono, off the audio thread for
// Settings-free dictation (src/modules/stt/lib/recorder.ts). Served from the
// app itself because the CSP does not allow worklets from blob: URLs.
class TeraxDictationTap extends AudioWorkletProcessor {
  process(inputs, outputs) {
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
    // The output stays silent; it exists so the graph keeps pulling this node.
    const output = outputs[0];
    if (output) for (const channel of output) channel.fill(0);
    return true;
  }
}
registerProcessor("terax-dictation-tap", TeraxDictationTap);
