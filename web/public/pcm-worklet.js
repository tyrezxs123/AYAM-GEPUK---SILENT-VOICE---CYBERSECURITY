/**
 * Raw PCM tap for the microphone.
 *
 * Why not MediaRecorder: on Android Chrome it produces WebM/Opus, which the
 * backend's libsndfile cannot decode without ffmpeg. Capturing float PCM here
 * and building the WAV ourselves keeps the upload path dependency-free, and the
 * same frames feed the Live Scan WebSocket.
 */
class PCMWorklet extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.chunkSize = opts.chunkSize || 2048;
    this.buffer = new Float32Array(this.chunkSize);
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) return true;
    const channel = input[0];
    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.offset++] = channel[i];
      if (this.offset === this.chunkSize) {
        this.port.postMessage(this.buffer.slice(0));
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-worklet", PCMWorklet);
