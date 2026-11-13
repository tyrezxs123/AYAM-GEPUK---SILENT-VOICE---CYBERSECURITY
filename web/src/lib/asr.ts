/**
 * Client for the on-device Whisper worker (public/asr-worker.js).
 *
 * Everything here is best-effort: if the model cannot be fetched (no network on
 * first use) or the device is too weak, callers get `null` and simply show a
 * verdict without a transcript.
 */
import type { Lang } from "./strings";

export interface AsrProgress {
  loaded: number;
  total: number;
}

interface Pending {
  resolve(text: string): void;
  reject(err: Error): void;
  onProgress?: (p: AsrProgress) => void;
}

let worker: Worker | null = null;
let broken = false;
let seq = 0;
const pending = new Map<number, Pending>();

/** Phones get the 39 MB model, everything else the more accurate 74 MB one. */
export function asrModel(): string {
  if (typeof navigator === "undefined") return "onnx-community/whisper-base";
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return mobile || (memory !== undefined && memory < 4) ? "onnx-community/whisper-tiny" : "onnx-community/whisper-base";
}

export function asrSupported(): boolean {
  return typeof window !== "undefined" && typeof Worker !== "undefined" && typeof WebAssembly !== "undefined" && !broken;
}

function getWorker(): Worker | null {
  if (!asrSupported()) return null;
  if (worker) return worker;
  try {
    worker = new Worker("/asr-worker.js", { type: "module" });
  } catch {
    broken = true;
    return null;
  }
  worker.onmessage = (event: MessageEvent<{ id: number; type: string; text?: string; error?: string; loaded?: number; total?: number }>) => {
    const msg = event.data;
    const job = pending.get(msg.id);
    if (!job) return;
    if (msg.type === "progress") {
      job.onProgress?.({ loaded: msg.loaded ?? 0, total: msg.total ?? 0 });
    } else if (msg.type === "done") {
      pending.delete(msg.id);
      job.resolve(msg.text ?? "");
    } else {
      pending.delete(msg.id);
      job.reject(new Error(msg.error ?? "asr failed"));
    }
  };
  worker.onerror = () => {
    // The module failed to load (offline, blocked CDN): fail every waiter.
    broken = true;
    for (const job of pending.values()) job.reject(new Error("asr worker failed"));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function call(
  type: "load" | "transcribe",
  payload: { samples?: Float32Array; language?: string },
  onProgress?: (p: AsrProgress) => void,
  timeoutMs = 180000,
): Promise<string> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error("asr unavailable"));
  const id = ++seq;
  return new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reject(new Error("asr timeout"));
    }, timeoutMs);
    pending.set(id, {
      resolve: (text) => {
        window.clearTimeout(timer);
        resolve(text);
      },
      reject: (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
      onProgress,
    });
    w.postMessage({ id, type, model: asrModel(), ...payload });
  });
}

/** Starts downloading the model in the background so the first check is fast. */
export function warmUpAsr(onProgress?: (p: AsrProgress) => void): Promise<boolean> {
  return call("load", {}, onProgress).then(
    () => true,
    () => false,
  );
}

/** Whisper hallucinates stock phrases on silence or music; drop the usual ones. */
function clean(text: string): string {
  let t = text.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  // Collapse a word or short phrase repeated 3+ times in a row (a decoding loop).
  t = t.replace(/\b(\S+(?: \S+){0,2})(?:[ ,.]+\1\b){2,}/gi, "$1");
  if (/^(thanks? (you )?for watching|terima kasih( kerana menonton)?|subtitles? by|you)[.! ]*$/i.test(t)) return "";
  return t;
}

/**
 * Transcribes 16 kHz mono audio. Returns null when transcription is not
 * possible on this device right now.
 */
export async function transcribe(
  samples: Float32Array,
  lang: Lang,
  onProgress?: (p: AsrProgress) => void,
): Promise<string | null> {
  if (samples.length < 8000) return "";
  try {
    // Copy: the caller may still need its buffer.
    const text = await call("transcribe", { samples: samples.slice(), language: lang === "ms" ? "malay" : "english" }, onProgress);
    return clean(text);
  } catch (err) {
    console.warn("On-device transcription unavailable:", err);
    return null;
  }
}
