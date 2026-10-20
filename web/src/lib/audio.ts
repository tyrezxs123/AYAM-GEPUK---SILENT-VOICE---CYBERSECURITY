/**
 * Microphone capture and WAV encoding, both done by hand.
 *
 * We ask the browser for a 16 kHz AudioContext (the rate the whole backend
 * works at). Most browsers honour it; when one does not, we resample in the
 * main thread so the server always receives 16 kHz mono.
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

/** 16-bit PCM WAV. The backend reads this with no codec dependency at all. */
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

/**
 * Opens the microphone and calls `onFrame` with 16 kHz mono float frames.
 * Echo cancellation and noise suppression are left ON: the user is pointing
 * this phone at another phone's speaker, so the room is the signal path.
 */
export async function openMic(onFrame: (frame: Float32Array) => void): Promise<MicHandle> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new MicError("getUserMedia is not available", "unsupported");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err) {
    const name = (err as DOMException)?.name;
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new MicError("Microphone permission denied", "denied");
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
  if (ctx.state === "suspended") await ctx.resume();

  try {
    await ctx.audioWorklet.addModule("/pcm-worklet.js");
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close();
    throw new MicError(`AudioWorklet failed: ${String(err)}`, "unsupported");
  }

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm-worklet", {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    processorOptions: { chunkSize: 2048 },
  });

  let peak = 0;
  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    let frame = event.data;
    if (ctx.sampleRate !== TARGET_RATE) frame = resampleLinear(frame, ctx.sampleRate, TARGET_RATE);
    let p = 0;
    for (let i = 0; i < frame.length; i++) p = Math.max(p, Math.abs(frame[i]));
    peak = p;
    onFrame(frame);
  };
  source.connect(node);

  return {
    rate: TARGET_RATE,
    level: () => peak,
    async stop() {
      try {
        node.port.onmessage = null;
        source.disconnect();
        node.disconnect();
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
