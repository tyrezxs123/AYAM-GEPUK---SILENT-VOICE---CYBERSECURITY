/**
 * The on-device check for one clip: signature -> voice screen -> words.
 *
 * Order matters and mirrors api/app/service.py:
 *   1. A clip that carries a signature is judged by cryptography alone
 *      (VERIFIED / TAMPERED / EXPIRED). Detection never overrides that.
 *   2. Everything else is UNVERIFIED and gets a risk level from two
 *      independent warnings: the acoustic screen and the scam-phrase rules.
 */
import { asrModel, asrSupported, transcribe, type AsrProgress } from "./asr";
import { fuseRisk, scanPhrases, SCREEN_ENGINE, SIGN_ENGINE } from "./client-scanner";
import { decodeAudio, DecodeError, type DecodedAudio } from "./decode";
import { analyzeVoice, waveformPeaks } from "./dsp";
import { verifyOnDevice } from "./provenance";
import type { Lang } from "./strings";
import type { VerifyResult } from "./types";

export type Stage = "signature" | "voice" | "words";

export interface AnalyzeOptions {
  filename?: string;
  /** Text already captured while recording (Web Speech API). */
  transcript?: string;
  source: "file" | "mic";
  lang: Lang;
  onStage?: (stage: Stage) => void;
  onModelProgress?: (p: AsrProgress) => void;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function analyzeClip(blob: Blob, opts: AnalyzeOptions): Promise<VerifyResult> {
  const started = performance.now();

  // 1. Signature. Decoding runs alongside: it is needed for the waveform either way.
  opts.onStage?.("signature");
  const decoding: Promise<DecodedAudio | DecodeError> = decodeAudio(blob).catch((err) =>
    err instanceof DecodeError ? err : new DecodeError("unsupported"),
  );
  const [signed] = await Promise.all([verifyOnDevice(blob).catch(() => null), pause(450)]);
  const decoded = await decoding;

  if (signed) {
    if (!(decoded instanceof DecodeError)) signed.waveform = waveformPeaks(decoded.samples);
    signed.source = opts.source;
    signed.latency_ms = Math.round(performance.now() - started);
    return signed;
  }
  if (decoded instanceof DecodeError) throw decoded;

  // 2. Voice screen.
  opts.onStage?.("voice");
  await pause(30); // let the stepper paint before the DSP loop takes the thread
  const voice = analyzeVoice(decoded.samples);

  // 3. Words: reuse live captions when we have them, else transcribe on-device.
  opts.onStage?.("words");
  let text = (opts.transcript ?? "").trim();
  let transcriber = text ? "browser-web-speech" : "none";
  let available = text.length > 0;
  if (!text && voice.enoughSpeech && asrSupported()) {
    const out = await transcribe(decoded.samples.subarray(0, 120 * decoded.rate), opts.lang, opts.onModelProgress);
    if (out !== null) {
      text = out;
      transcriber = `${asrModel().split("/").pop()} (on-device)`;
      available = true;
    }
  }
  const phrases = scanPhrases(text);
  const fused = fuseRisk(voice.score, phrases);

  return {
    verdict: "UNVERIFIED",
    colour: fused.colour,
    duration_s: decoded.duration,
    latency_ms: Math.round(performance.now() - started),
    headline_key: fused.headline_key,
    step_keys: fused.step_keys,
    provenance: {
      sender_name: null,
      recorded_at: null,
      expires_at: null,
      context: null,
      session_id: null,
      notes: ["no_watermark"],
      segments: [],
      watermark: { confidence: 0, engine: SIGN_ENGINE },
    },
    risk: fused.risk,
    transcript: { text, language: opts.lang === "ms" ? "ms-MY" : "en-MY", engine: transcriber, available },
    phrases: phrases.hits,
    engines: {
      watermark: { engine: SIGN_ENGINE },
      detector: { engine: SCREEN_ENGINE, calibrated: false },
      transcriber: { engine: transcriber, server_side: false },
    },
    detection: {
      engine: SCREEN_ENGINE,
      calibrated: false,
      per_chunk: voice.perChunk,
      features: voice.features as unknown as Record<string, number>,
    },
    voice: { enough_speech: voice.enoughSpeech, speech_seconds: voice.speechSeconds },
    waveform: waveformPeaks(decoded.samples),
    source: opts.source,
  };
}
