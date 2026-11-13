/**
 * Live Scan, fully on the device: microphone -> captions -> scam-phrase rules,
 * with the acoustic screen running alongside on a rolling window.
 *
 * Two caption sources, picked automatically:
 *   - the browser's Web Speech API (instant, streaming) where it works;
 *   - the on-device Whisper worker, fed ~8 s chunks, where it does not
 *     (Firefox, Brave, in-app browsers, or Android handing the microphone to
 *     the speech service and leaving us nothing to recognise from).
 *
 * What turns the card red:
 *   - scam language in the captions (money + urgency, impersonation + secrecy...)
 *   - never the acoustic screen alone. Audio that reached us speaker -> air ->
 *     microphone has the room's noise mixed in, which removes the cue the
 *     screen relies on, so here it can raise the level to "medium" at most.
 */
import { transcribe } from "./asr";
import { MicError, openMic, TARGET_RATE, type MicHandle } from "./audio";
import { fuseRisk, scanPhrases, type Fused } from "./client-scanner";
import { analyzeVoice } from "./dsp";
import { speechSupported, startSpeech, type SpeechSession } from "./speech";
import type { Lang } from "./strings";
import type { PhraseHit } from "./types";

export type CaptionSource = "speech-api" | "whisper" | "whisper-loading" | "none";

export interface LiveState extends Fused {
  elapsed_s: number;
  /** Peak microphone level of the latest frame, 0..1. */
  level: number;
  /** False when the microphone has delivered only silence for a few seconds. */
  micAlive: boolean;
  /** Everything heard so far (committed text). */
  transcript: string;
  /** Words still being recognised. */
  interim: string;
  hits: PhraseHit[];
  /** Smoothed acoustic score over the last windows, 0..1. */
  voiceScore: number;
  /** How many windows contained enough speech to score. */
  voiceWindows: number;
  captions: CaptionSource;
  /** 0..1 while the on-device speech model downloads. */
  modelProgress: number | null;
  alert: boolean;
}

export interface LiveEngine {
  stop(): Promise<void>;
}

const RING_SECONDS = 12;
const WINDOW_SECONDS = 6;
const SCORE_EVERY_MS = 2000;
const SMOOTH_WINDOWS = 4;
/** Speaker-to-microphone audio can never push the acoustic screen past "medium". */
const MIC_SCORE_CAP = 0.62;
const ASR_CHUNK_SECONDS = 8;
const ASR_MIN_SECONDS = 5;
/** Give Web Speech this long (while someone is talking) before falling back. */
const SPEECH_GRACE_SECONDS = 7;

const FATAL_SPEECH_ERRORS = new Set(["not-allowed", "service-not-allowed", "audio-capture", "network", "language-not-supported"]);

export async function startLiveEngine(opts: {
  lang: Lang;
  onState(state: LiveState): void;
}): Promise<LiveEngine> {
  const startedAt = Date.now();
  let stopped = false;

  // --- audio buffers ---------------------------------------------------------
  const ring = new Float32Array(RING_SECONDS * TARGET_RATE);
  let ringFill = 0; // total samples ever written
  let asrChunks: Float32Array[] = [];
  let asrLength = 0;
  let lastLoudAt = 0;
  let voicedSeconds = 0;

  // --- captions --------------------------------------------------------------
  let committed = "";
  let interim = "";
  let speech: SpeechSession | null = null;
  let speechGotResult = false;
  let speechDead = !speechSupported();
  let whisperOn = false;
  let whisperBusy = false;
  let whisperReady = false;
  let whisperFailed = false;
  let modelProgress: number | null = null;

  // --- acoustic screen -------------------------------------------------------
  let scores: number[] = [];
  let voiceWindows = 0;
  let wasAlert = false;

  const mic: MicHandle = await openMic((frame) => {
    if (stopped) return;
    // ring buffer
    const at = ringFill % ring.length;
    const first = Math.min(frame.length, ring.length - at);
    ring.set(frame.subarray(0, first), at);
    if (first < frame.length) ring.set(frame.subarray(first), 0);
    ringFill += frame.length;

    let peak = 0;
    for (let i = 0; i < frame.length; i++) {
      const a = Math.abs(frame[i]);
      if (a > peak) peak = a;
    }
    if (peak > 0.004) lastLoudAt = Date.now();
    if (peak > 0.02) voicedSeconds += frame.length / TARGET_RATE;

    // Audio waiting for the Whisper fallback. While Web Speech is doing the
    // job we only keep a short tail, so memory stays bounded.
    asrChunks.push(frame.slice());
    asrLength += frame.length;
    const keep = (whisperOn ? 30 : ASR_CHUNK_SECONDS) * TARGET_RATE;
    while (asrLength > keep && asrChunks.length > 1) {
      asrLength -= asrChunks[0].length;
      asrChunks.shift();
    }
  });

  function lastSeconds(seconds: number): Float32Array {
    const want = Math.min(seconds * TARGET_RATE, ringFill, ring.length);
    const out = new Float32Array(want);
    const end = ringFill % ring.length;
    const start = (end - want + ring.length) % ring.length;
    if (start + want <= ring.length) out.set(ring.subarray(start, start + want));
    else {
      const head = ring.length - start;
      out.set(ring.subarray(start), 0);
      out.set(ring.subarray(0, want - head), head);
    }
    return out;
  }

  function emit(): void {
    if (stopped) return;
    const text = interim ? `${committed} ${interim}`.trim() : committed;
    const phrases = scanPhrases(text);
    const smoothed = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const voiceScore = Math.min(smoothed, MIC_SCORE_CAP);
    const fused = fuseRisk(voiceScore, phrases);
    const alert = fused.risk.level === "high";
    if (alert && !wasAlert && typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate?.([200, 100, 200, 100, 400]);
    }
    wasAlert = alert;

    const captions: CaptionSource = whisperOn
      ? whisperFailed
        ? "none"
        : whisperReady
          ? "whisper"
          : "whisper-loading"
      : speechDead
        ? "none"
        : "speech-api";

    opts.onState({
      ...fused,
      elapsed_s: Math.round((Date.now() - startedAt) / 1000),
      level: mic.level(),
      micAlive: Date.now() - lastLoudAt < 3500 || Date.now() - startedAt < 3500,
      transcript: committed,
      interim,
      hits: phrases.hits,
      voiceScore: Math.round(voiceScore * 1000) / 1000,
      voiceWindows,
      captions,
      modelProgress,
      alert,
    });
  }

  // --- Web Speech --------------------------------------------------------------
  if (!speechDead) {
    speech = startSpeech(
      opts.lang === "ms" ? "ms-MY" : "en-MY",
      (text, isFinal) => {
        if (stopped || whisperOn) return;
        speechGotResult = true;
        if (isFinal) {
          committed = `${committed} ${text}`.trim();
          interim = "";
        } else {
          interim = text.trim();
        }
        emit();
      },
      (error) => {
        if (FATAL_SPEECH_ERRORS.has(error)) speechDead = true;
      },
    );
  }

  // --- Whisper fallback ----------------------------------------------------------
  async function whisperTick(): Promise<void> {
    if (!whisperOn || whisperBusy || whisperFailed || stopped) return;
    if (asrLength < ASR_MIN_SECONDS * TARGET_RATE) return;
    whisperBusy = true;

    const take = Math.min(asrLength, ASR_CHUNK_SECONDS * TARGET_RATE);
    const chunk = new Float32Array(take);
    let filled = 0;
    while (filled < take && asrChunks.length) {
      const head = asrChunks[0];
      const n = Math.min(head.length, take - filled);
      chunk.set(head.subarray(0, n), filled);
      filled += n;
      if (n === head.length) asrChunks.shift();
      else asrChunks[0] = head.subarray(n);
    }
    asrLength -= take;

    let peak = 0;
    for (let i = 0; i < chunk.length; i += 8) peak = Math.max(peak, Math.abs(chunk[i]));
    if (peak < 0.01) {
      whisperBusy = false; // silence: nothing to transcribe
      return;
    }

    const text = await transcribe(chunk, opts.lang, (p) => {
      modelProgress = p.total ? p.loaded / p.total : null;
      emit();
    });
    whisperBusy = false;
    if (stopped) return;
    if (text === null) {
      whisperFailed = true;
    } else {
      whisperReady = true;
      modelProgress = null;
      if (text) committed = `${committed} ${text}`.trim();
    }
    emit();
  }

  // --- timers ------------------------------------------------------------------
  const fast = window.setInterval(() => {
    if (stopped) return;
    const elapsed = (Date.now() - startedAt) / 1000;
    if (!whisperOn) {
      // Web Speech is missing, has failed, or has stayed silent while someone
      // is clearly talking: let the on-device model take over the captions.
      const silentTreatment = !speechGotResult && voicedSeconds >= SPEECH_GRACE_SECONDS && elapsed >= SPEECH_GRACE_SECONDS;
      if (speechDead || silentTreatment) {
        whisperOn = true;
        speech?.stop();
        speech = null;
        interim = "";
      }
    }
    void whisperTick();
    emit();
  }, 400);

  const slow = window.setInterval(() => {
    if (stopped || ringFill < 3 * TARGET_RATE) return;
    const voice = analyzeVoice(lastSeconds(WINDOW_SECONDS));
    if (!voice.enoughSpeech || voice.speechSeconds < 1.5) return;
    voiceWindows++;
    scores = [...scores, voice.score].slice(-SMOOTH_WINDOWS);
    emit();
  }, SCORE_EVERY_MS);

  emit();

  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      window.clearInterval(fast);
      window.clearInterval(slow);
      speech?.stop();
      asrChunks = [];
      await mic.stop();
    },
  };
}

export { MicError };
