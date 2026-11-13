/**
 * Turns whatever the user picked into 16 kHz mono float samples.
 *
 * The browser's own decoders do the heavy lifting, so this accepts everything
 * the device can play: WhatsApp voice notes (.opus / .ogg), .m4a / .aac voice
 * memos, .mp3, .wav, .flac, .webm, and the audio track of .mp4 / .3gp videos.
 * A hand-written PCM WAV reader is the fallback for unusual WAV files the
 * browser refuses (24-bit, 32-bit float, 8-bit).
 */
import { resampleLinear, TARGET_RATE } from "./audio";

export class DecodeError extends Error {
  constructor(readonly kind: "unsupported" | "empty" | "too_large") {
    super(kind);
    this.name = "DecodeError";
  }
}

export interface DecodedAudio {
  /** 16 kHz mono. */
  samples: Float32Array;
  rate: number;
  duration: number;
}

const MAX_BYTES = 80 * 1024 * 1024;
const MAX_SECONDS = 600;

/** Everything a phone's file picker might call "audio", plus video containers. */
export const AUDIO_ACCEPT =
  "audio/*,video/mp4,video/webm,video/3gpp,video/quicktime,.opus,.ogg,.oga,.m4a,.aac,.mp3,.wav,.wave,.flac,.webm,.weba,.mp4,.m4b,.3gp,.amr,.caf,.aif,.aiff,.wma,.mka,.mov";

function mixdown(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += ch[i];
  }
  for (let i = 0; i < out.length; i++) out[i] /= buffer.numberOfChannels;
  return out;
}

type Ctxs = {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
  OfflineAudioContext?: typeof OfflineAudioContext;
  webkitOfflineAudioContext?: typeof OfflineAudioContext;
};

function decodeWith(ctx: BaseAudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
  // Safari still wants the callback form; the promise form covers the rest.
  return new Promise((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(bytes, resolve, reject);
      if (p && typeof p.then === "function") p.then(resolve, reject);
    } catch (err) {
      reject(err);
    }
  });
}

async function decodeWithBrowser(bytes: ArrayBuffer): Promise<Float32Array | null> {
  const w = window as unknown as Ctxs;
  const Offline = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
  if (Offline) {
    try {
      // A 16 kHz offline context makes the browser resample with its own
      // high-quality resampler while decoding.
      const ctx = new Offline(1, TARGET_RATE, TARGET_RATE);
      return mixdown(await decodeWith(ctx, bytes.slice(0)));
    } catch {
      /* some browsers reject low-rate offline contexts; fall through */
    }
  }
  const Live = w.AudioContext ?? w.webkitAudioContext;
  if (!Live) return null;
  const ctx = new Live();
  try {
    const buffer = await decodeWith(ctx, bytes.slice(0));
    return resampleLinear(mixdown(buffer), buffer.sampleRate, TARGET_RATE);
  } catch {
    return null;
  } finally {
    void ctx.close().catch(() => undefined);
  }
}

/** Minimal RIFF reader for PCM WAVs the browser will not decode. */
function decodePcmWav(bytes: Uint8Array): Float32Array | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let format = 1;
  let channels = 1;
  let rate = TARGET_RATE;
  let bits = 16;
  let data: Uint8Array | null = null;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = tag(at);
    let size = view.getUint32(at + 4, true);
    const start = at + 8;
    if (start + size > bytes.length) size = bytes.length - start;
    if (id === "fmt " && size >= 16) {
      format = view.getUint16(start, true);
      channels = Math.max(1, view.getUint16(start + 2, true));
      rate = view.getUint32(start + 4, true);
      bits = view.getUint16(start + 14, true);
      if (format === 0xfffe && size >= 26) format = view.getUint16(start + 24, true); // WAVE_FORMAT_EXTENSIBLE
    } else if (id === "data") {
      data = bytes.subarray(start, start + size);
    }
    at = start + size + (size % 2);
  }
  if (!data || (format !== 1 && format !== 3)) return null;
  const bytesPer = bits / 8;
  const frames = Math.floor(data.length / (bytesPer * channels));
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const o = (i * channels + c) * bytesPer;
      let v = 0;
      if (format === 3) v = bits === 64 ? dv.getFloat64(o, true) : dv.getFloat32(o, true);
      else if (bits === 8) v = (dv.getUint8(o) - 128) / 128;
      else if (bits === 16) v = dv.getInt16(o, true) / 32768;
      else if (bits === 24) v = ((dv.getInt8(o + 2) << 16) | (dv.getUint8(o + 1) << 8) | dv.getUint8(o)) / 8388608;
      else if (bits === 32) v = dv.getInt32(o, true) / 2147483648;
      sum += v;
    }
    mono[i] = sum / channels;
  }
  return resampleLinear(mono, rate, TARGET_RATE);
}

export async function decodeAudio(blob: Blob): Promise<DecodedAudio> {
  if (blob.size === 0) throw new DecodeError("empty");
  if (blob.size > MAX_BYTES) throw new DecodeError("too_large");
  const bytes = await blob.arrayBuffer();

  let samples = await decodeWithBrowser(bytes);
  if (!samples || samples.length === 0) samples = decodePcmWav(new Uint8Array(bytes));
  if (!samples) throw new DecodeError("unsupported");
  if (samples.length === 0) throw new DecodeError("empty");
  if (samples.length > MAX_SECONDS * TARGET_RATE) samples = samples.subarray(0, MAX_SECONDS * TARGET_RATE);

  return { samples, rate: TARGET_RATE, duration: Math.round((samples.length / TARGET_RATE) * 10) / 10 };
}
