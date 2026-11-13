/**
 * Microphone capture and WAV encoding, both done by hand.
 *
 * We ask the browser for a 16 kHz AudioContext (the rate every analysis step
 * works at). Most browsers honour it; when one does not, we resample in the
 * main thread so downstream code always sees 16 kHz mono.
 */
export const TARGET_RATE = 16000;

export class MicError extends Error {
  constructor(message: string, readonly kind: "denied" | "unsupported" | "failed") {
    super(message);
  }
}

function concatFloat(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Linear resampling. Good enough for speech at these rates and dependency-free. */
export function resampleLinear(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x;
  const ratio = from / to;
  const n = Math.floor(x.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, x.length - 1);
    const frac = pos - i0;
    out[i] = x[i0] * (1 - frac) + x[i1] * frac;
  }
  return out;
}

export function floatToPcm16(x: Float32Array): Int16Array {
  const out = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const s = Math.max(-1, Math.min(1, x[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** 16-bit PCM WAV, written by hand so there is no codec dependency at all. */
export function encodeWav(samples: Float32Array, rate = TARGET_RATE): Blob {
  const pcm = floatToPcm16(samples);
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  new Int16Array(buffer, 44).set(pcm);

  return new Blob([buffer], { type: "audio/wav" });
}

export interface MicHandle {
  /** Actual capture rate after any resampling: always TARGET_RATE. */
  rate: number;
  stop(): Promise<void>;
  /** Peak level of the most recent frame, 0..1 - used for the level meter. */
  level(): number;
}

export interface MicOptions {
  /**
   * Browser voice processing (echo cancellation, noise suppression, auto gain).
   * Off by default: the acoustic screen needs the room's real noise floor, and
   * noise suppression is exactly what erases it.
   */
  processing?: boolean;
}

/**
 * Opens the microphone and calls `onFrame` with 16 kHz mono float frames.
 * Uses an AudioWorklet where available and falls back to a ScriptProcessor on
 * older WebViews, so capture works on every browser that has getUserMedia.
 */
export async function openMic(onFrame: (frame: Float32Array) => void, opts: MicOptions = {}): Promise<MicHandle> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new MicError("getUserMedia is not available", "unsupported");
  }

  const processing = opts.processing ?? false;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: processing,
        noiseSuppression: processing,
        autoGainControl: processing,
      },
    });
  } catch (err) {
    const name = (err as DOMException)?.name;
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new MicError("Microphone permission denied", "denied");
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      throw new MicError("No microphone found", "unsupported");
    }
    throw new MicError(String(err), "failed");
  }

  const Ctx: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  let ctx: AudioContext;
  try {
    ctx = new Ctx({ sampleRate: TARGET_RATE });
  } catch {
    ctx = new Ctx();
  }
  if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);

  let peak = 0;
  const deliver = (raw: Float32Array) => {
    const frame = ctx.sampleRate !== TARGET_RATE ? resampleLinear(raw, ctx.sampleRate, TARGET_RATE) : raw;
    let p = 0;
    for (let i = 0; i < frame.length; i++) {
      const a = Math.abs(frame[i]);
      if (a > p) p = a;
    }
    peak = p;
    onFrame(frame);
  };

  const source = ctx.createMediaStreamSource(stream);
  let teardown: () => void;

  let worklet: AudioWorkletNode | null = null;
  try {
    if (!ctx.audioWorklet) throw new Error("no worklet");
    await ctx.audioWorklet.addModule("/pcm-worklet.js");
    worklet = new AudioWorkletNode(ctx, "pcm-worklet", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      processorOptions: { chunkSize: 2048 },
    });
  } catch {
    worklet = null;
  }

  if (worklet) {
    const node = worklet;
    node.port.onmessage = (event: MessageEvent<Float32Array>) => deliver(event.data);
    source.connect(node);
    teardown = () => {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
    };
  } else {
    // Deprecated but universal. Routed through a muted gain so nothing is played back.
    const node = ctx.createScriptProcessor(2048, 1, 1);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.onaudioprocess = (event) => deliver(new Float32Array(event.inputBuffer.getChannelData(0)));
    source.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);
    teardown = () => {
      node.onaudioprocess = null;
      source.disconnect();
      node.disconnect();
      mute.disconnect();
    };
  }

  return {
    rate: TARGET_RATE,
    level: () => peak,
    async stop() {
      try {
        teardown();
      } catch {
        /* already torn down */
      }
      stream.getTracks().forEach((track) => track.stop());
      await ctx.close().catch(() => undefined);
    },
  };
}

/** Records until stop() is called, then hands back a 16 kHz mono WAV. */
export async function startRecording(opts: { maxSeconds?: number; onTick?: (seconds: number, level: number) => void } = {}) {
  const chunks: Float32Array[] = [];
  let samples = 0;
  const limit = (opts.maxSeconds ?? 60) * TARGET_RATE;
  let stopped = false;

  const mic = await openMic((frame) => {
    if (stopped || samples >= limit) return;
    const room = limit - samples;
    const keep = frame.length <= room ? frame : frame.subarray(0, room);
    chunks.push(new Float32Array(keep));
    samples += keep.length;
  });

  const timer = opts.onTick
    ? window.setInterval(() => opts.onTick?.(samples / TARGET_RATE, mic.level()), 100)
    : undefined;

  return {
    get seconds() {
      return samples / TARGET_RATE;
    },
    level: mic.level,
    async stop(): Promise<Blob> {
      stopped = true;
      if (timer) window.clearInterval(timer);
      await mic.stop();
      return encodeWav(concatFloat(chunks), TARGET_RATE);
    },
  };
}

export type Recording = Awaited<ReturnType<typeof startRecording>>;
