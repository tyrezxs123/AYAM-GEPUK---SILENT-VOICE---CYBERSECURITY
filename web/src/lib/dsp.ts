/**
 * On-device acoustic screening for synthetic speech.
 *
 * READ THIS BEFORE QUOTING ANY NUMBER FROM IT.
 * This is a transparent DSP screen, not a trained deepfake classifier. It looks
 * for the artefacts text-to-speech and voice-clone systems most often leave
 * behind, each individually explainable:
 *
 *   snr_db           studio-clean signal: synthesis has almost no room noise
 *   floor_var_db     real rooms have a restless noise floor; synthesis does not
 *   periodicity      vocoder harmonics are cleaner than a real larynx + room
 *   f0_jitter        synthetic prosody is smoother than natural pitch
 *   hf_ratio         breath and fricative energy above 6 kHz
 *   mod_share        natural speech modulates at a 3-8 Hz syllable rate
 *
 * The weights in scoreFrom() were fitted on a small labelled set (phone and
 * YouTube recordings of real people vs ElevenLabs / Azure / other TTS output),
 * so the result is reported as "screening", never as proof. It mirrors
 * api/app/engines/detector_heuristic.py and runs entirely in the browser.
 *
 * Pure functions only - no DOM - so the same code runs in tests.
 */

export const DSP_RATE = 16000;
const N_FFT = 512;
const HOP = 160; // 10 ms

export interface VoiceFeatures {
  /** p95 - p10 frame energy: how far speech sits above the background. */
  snr_db: number;
  /** Spread of the quietest 20% of frames, in dB. */
  floor_var_db: number;
  /** Mean normalised autocorrelation peak over voiced frames (0..1). */
  periodicity: number;
  /** Median relative frame-to-frame pitch change. */
  f0_jitter: number;
  /** Pitch spread in semitones over voiced frames. */
  f0_range_st: number;
  /** Share of energy above 6 kHz in loud frames. */
  hf_ratio: number;
  /** Variability of spectral flatness in loud frames. */
  flatness_var: number;
  /** Mean spectral flatness inside voiced frames (noise between harmonics). */
  voiced_flatness: number;
  /** 3-8 Hz share of the envelope modulation spectrum. */
  mod_share: number;
  /** Fraction of frames that are voiced. */
  voiced_frac: number;
  /** Fraction of frames more than 50 dB below speech level (digital silence). */
  silence_frac: number;
  /** Fraction of frames more than 65 dB below speech level. */
  deep_silence_frac: number;
  /** p95 - p2 frame energy: depth of the quietest moments. */
  depth_db: number;
  /** Frame-to-frame loudness change inside voiced runs, in dB. */
  shimmer_db: number;
  /** Fraction of frames that carry speech-level energy. */
  active_frac: number;
  /** Peak absolute sample value. */
  peak: number;
}

// --- FFT -------------------------------------------------------------------
const HANN = new Float64Array(N_FFT);
for (let i = 0; i < N_FFT; i++) HANN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N_FFT - 1));

const REV = new Uint16Array(N_FFT);
{
  const bits = Math.log2(N_FFT);
  for (let i = 0; i < N_FFT; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    REV[i] = r;
  }
}
const COS = new Float64Array(N_FFT / 2);
const SIN = new Float64Array(N_FFT / 2);
for (let i = 0; i < N_FFT / 2; i++) {
  COS[i] = Math.cos((2 * Math.PI * i) / N_FFT);
  SIN[i] = Math.sin((2 * Math.PI * i) / N_FFT);
}

/** In-place radix-2 FFT of length N_FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  for (let i = 0; i < N_FFT; i++) {
    const j = REV[i];
    if (j > i) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let size = 2; size <= N_FFT; size <<= 1) {
    const half = size >> 1;
    const step = N_FFT / size;
    for (let start = 0; start < N_FFT; start += size) {
      for (let k = 0; k < half; k++) {
        const c = COS[k * step];
        const s = SIN[k * step];
        const a = start + k;
        const b = a + half;
        const tr = re[b] * c + im[b] * s;
        const ti = im[b] * c - re[b] * s;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

function percentile(sorted: Float64Array | number[], p: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return percentile(s, 0.5);
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - m) * (b - m), 0) / values.length);
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/** Extracts the screening features from 16 kHz mono samples. */
export function extractFeatures(x: Float32Array, sr = DSP_RATE): VoiceFeatures {
  const n = x.length < N_FFT ? 1 : 1 + Math.floor((x.length - N_FFT) / HOP);
  const re = new Float64Array(N_FFT);
  const im = new Float64Array(N_FFT);
  const bins = N_FFT / 2 + 1;
  const hfBin = Math.ceil((6000 * N_FFT) / sr);

  const energyDb = new Float64Array(n);
  const total = new Float64Array(n);
  const hf = new Float64Array(n);
  const flat = new Float64Array(n);
  const f0 = new Float64Array(n).fill(NaN);
  const acPeak = new Float64Array(n);

  const lagLo = Math.floor(sr / 350);
  const lagHi = Math.floor(sr / 70);
  const frame = new Float64Array(N_FFT);
  let peak = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > peak) peak = a;
  }

  for (let f = 0; f < n; f++) {
    const start = f * HOP;
    let dc = 0;
    for (let i = 0; i < N_FFT; i++) {
      const v = start + i < x.length ? x[start + i] : 0;
      frame[i] = v;
      dc += v;
    }
    dc /= N_FFT;
    for (let i = 0; i < N_FFT; i++) {
      re[i] = frame[i] * HANN[i];
      im[i] = 0;
    }
    fft(re, im);
    let tot = 0;
    let hfSum = 0;
    let logSum = 0;
    for (let k = 0; k < bins; k++) {
      const p = re[k] * re[k] + im[k] * im[k] + 1e-20;
      tot += p;
      if (k >= hfBin) hfSum += p;
      logSum += Math.log(p);
    }
    total[f] = tot;
    energyDb[f] = 10 * Math.log10(tot + 1e-12);
    hf[f] = hfSum / (tot + 1e-12);
    flat[f] = Math.exp(logSum / bins) / (tot / bins + 1e-20);

    // Autocorrelation pitch, 70-350 Hz. Every frame: it is the costly part,
    // but still well under real time on a phone.
    let e0 = 0;
    for (let i = 0; i < N_FFT; i++) {
      const v = (frame[i] - dc) * HANN[i];
      re[i] = v; // reuse as scratch
      e0 += v * v;
    }
    if (e0 > 1e-7) {
      let best = 0;
      let bestLag = 0;
      for (let lag = lagLo; lag < lagHi; lag++) {
        let s = 0;
        for (let i = 0; i + lag < N_FFT; i++) s += re[i] * re[i + lag];
        if (s > best) {
          best = s;
          bestLag = lag;
        }
      }
      const norm = best / (e0 + 1e-12);
      acPeak[f] = norm;
      if (norm > 0.3 && bestLag > 0) f0[f] = sr / bestLag;
    }
  }

  const sortedE = Float64Array.from(energyDb).sort();
  const p95 = percentile(sortedE, 0.95);
  const p10 = percentile(sortedE, 0.1);
  const p20 = percentile(sortedE, 0.2);

  const loudHf: number[] = [];
  const loudFlat: number[] = [];
  let active = 0;
  let silent = 0;
  let deep = 0;
  for (let f = 0; f < n; f++) {
    if (energyDb[f] > p95 - 35) {
      loudHf.push(hf[f]);
      loudFlat.push(flat[f]);
    }
    if (energyDb[f] > p95 - 25) active++;
    if (energyDb[f] < p95 - 50) silent++;
    if (energyDb[f] < p95 - 65) deep++;
  }

  const quiet: number[] = [];
  for (let f = 0; f < n; f++) if (energyDb[f] <= p20) quiet.push(energyDb[f]);

  const jit: number[] = [];
  const voicedF0: number[] = [];
  const voicedPeak: number[] = [];
  const voicedFlat: number[] = [];
  const shim: number[] = [];
  for (let f = 0; f < n; f++) {
    if (Number.isNaN(f0[f])) continue;
    voicedF0.push(f0[f]);
    voicedPeak.push(acPeak[f]);
    voicedFlat.push(flat[f]);
    if (f > 0 && !Number.isNaN(f0[f - 1])) {
      jit.push(Math.abs(f0[f] - f0[f - 1]) / (f0[f - 1] + 1e-9));
      shim.push(Math.abs(energyDb[f] - energyDb[f - 1]));
    }
  }
  const medF0 = median(voicedF0) || 1;
  const semis = voicedF0.map((v) => 12 * Math.log2(v / medF0));
  const sortedSemi = [...semis].sort((a, b) => a - b);

  // Envelope modulation spectrum via a direct DFT over 0.5-20 Hz (cheap: few bins).
  let modShare = 0.5;
  if (n > 64) {
    const env = new Float64Array(n);
    let m = 0;
    for (let f = 0; f < n; f++) {
      env[f] = Math.sqrt(total[f]);
      m += env[f];
    }
    m /= n;
    const frameRate = sr / HOP;
    let band = 0;
    let ref = 0;
    const df = frameRate / n;
    for (let k = 1; k * df <= 20; k++) {
      const freq = k * df;
      if (freq <= 0.5) continue;
      let cr = 0;
      let ci = 0;
      for (let f = 0; f < n; f++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * f) / (n - 1));
        const v = (env[f] - m) * w;
        const ph = (2 * Math.PI * k * f) / n;
        cr += v * Math.cos(ph);
        ci -= v * Math.sin(ph);
      }
      const mag = Math.hypot(cr, ci);
      ref += mag;
      if (freq >= 3 && freq <= 8) band += mag;
    }
    modShare = band / (ref + 1e-12);
  }

  const r = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
  return {
    snr_db: r(p95 - p10, 2),
    floor_var_db: r(quiet.length > 5 ? std(quiet) : 0, 3),
    periodicity: r(mean(voicedPeak)),
    f0_jitter: r(jit.length > 10 ? median(jit) : 0, 5),
    f0_range_st: r(sortedSemi.length > 10 ? percentile(sortedSemi, 0.9) - percentile(sortedSemi, 0.1) : 0, 3),
    hf_ratio: r(mean(loudHf), 5),
    flatness_var: r(std(loudFlat), 5),
    voiced_flatness: r(mean(voicedFlat), 5),
    mod_share: r(modShare),
    voiced_frac: r(voicedF0.length / n),
    silence_frac: r(silent / n),
    deep_silence_frac: r(deep / n),
    depth_db: r(p95 - percentile(sortedE, 0.02), 2),
    shimmer_db: r(mean(shim), 3),
    active_frac: r(active / n),
    peak: r(peak),
  };
}

// --- scoring ---------------------------------------------------------------
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Maps features to a 0..1 "looks synthetic" score.
 *
 * The dominant, validated cue is how deep the pauses go. A microphone in a real
 * room never reaches silence: on our labelled set every human recording (phone
 * voice memos, YouTube, audiobooks) kept its quietest moments within ~55 dB of
 * speech level, while ElevenLabs, Azure, Google and similar TTS output dropped
 * 60-150 dB. That gap survives MP3 and WhatsApp-style Opus.
 *
 * Known blind spots, by design rather than by accident:
 *   - a voice clone trained on a noisy sample reproduces the noise
 *   - any synthetic voice replayed through a loudspeaker picks up room noise
 * Both score LOW here, which is why the product never says "human" or "real".
 */
export function scoreFrom(f: VoiceFeatures): number {
  const depth = clamp01((f.depth_db - 50) / 20);
  const deep = clamp01(f.deep_silence_frac / 0.04);
  const silent = clamp01((f.silence_frac - 0.01) / 0.08);
  const z = -2.4 + 2.8 * depth + 1.9 * deep + 0.6 * silent;
  return 1 / (1 + Math.exp(-z));
}

export interface VoiceAnalysis {
  /** 0..1, higher = more likely synthetic. */
  score: number;
  features: VoiceFeatures;
  /** Score per ~4 s stretch, for the timeline. */
  perChunk: number[];
  /** False when there is too little speech to say anything. */
  enoughSpeech: boolean;
  /** Seconds of audio that carry speech-level energy. */
  speechSeconds: number;
}

const MAX_ANALYSIS_SECONDS = 60;
const CHUNK_SECONDS = 4;

export function analyzeVoice(samples: Float32Array, sr = DSP_RATE): VoiceAnalysis {
  const x = samples.length > MAX_ANALYSIS_SECONDS * sr ? samples.subarray(0, MAX_ANALYSIS_SECONDS * sr) : samples;
  const features = extractFeatures(x, sr);
  const speechSeconds = (features.active_frac * x.length) / sr;
  const enoughSpeech = x.length >= sr && features.peak >= 0.01 && speechSeconds >= 0.8 && features.voiced_frac > 0.05;

  const perChunk: number[] = [];
  const chunk = CHUNK_SECONDS * sr;
  if (enoughSpeech && x.length >= chunk * 2) {
    for (let at = 0; at + chunk / 2 <= x.length; at += chunk) {
      const seg = x.subarray(at, Math.min(at + chunk, x.length));
      if (seg.length < sr) break;
      perChunk.push(Math.round(scoreFrom(extractFeatures(seg, sr)) * 1000) / 1000);
    }
  }

  const score = enoughSpeech ? scoreFrom(features) : 0;
  return {
    score: Math.round(score * 1000) / 1000,
    features,
    perChunk,
    enoughSpeech,
    speechSeconds: Math.round(speechSeconds * 10) / 10,
  };
}

/** Downsamples to `bars` peak values (0..1) for drawing a waveform. */
export function waveformPeaks(samples: Float32Array, bars = 72): number[] {
  const out: number[] = [];
  const step = Math.max(1, Math.floor(samples.length / bars));
  let max = 1e-6;
  for (let b = 0; b < bars; b++) {
    let p = 0;
    const end = Math.min(samples.length, (b + 1) * step);
    for (let i = b * step; i < end; i += 4) {
      const a = Math.abs(samples[i]);
      if (a > p) p = a;
    }
    out.push(p);
    if (p > max) max = p;
  }
  return out.map((p) => Math.round((p / max) * 100) / 100);
}
