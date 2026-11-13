/**
 * Optional backend client.
 *
 * SilentVoice runs as a standalone PWA: signing, verification, the voice screen
 * and the scam-phrase rules all happen on the device (see lib/analysis.ts,
 * lib/provenance.ts, lib/live-engine.ts). A FastAPI backend (../api) can be
 * attached in Settings -> Advanced for unsigned-audio checks with a trained
 * model; nothing in the app requires it.
 */
import type { VerifyResult } from "./types";

const API_STORAGE_KEY = "silentvoice.api_base";
const DEFAULT_TIMEOUT_MS = 8000;

export function getSavedApiBase(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(API_STORAGE_KEY) ?? window.localStorage.getItem("suarasah.api_base");
  } catch {
    return null;
  }
}

export function setSavedApiBase(url: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!url || !url.trim()) {
      window.localStorage.removeItem(API_STORAGE_KEY);
      window.localStorage.removeItem("suarasah.api_base");
    } else {
      window.localStorage.setItem(API_STORAGE_KEY, url.trim().replace(/\/$/, ""));
    }
  } catch {
    /* ignore storage errors */
  }
}

/** The backend URL, only when someone explicitly configured one. Never guessed. */
export function explicitApiBase(): string | null {
  const saved = getSavedApiBase();
  if (saved) return saved;
  const fromEnv = process.env.NEXT_PUBLIC_API_BASE;
  return fromEnv ? fromEnv.replace(/\/$/, "") : null;
}

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    throw new ApiError((err as Error)?.name === "AbortError" ? "timeout" : "unreachable", 0);
  } finally {
    clearTimeout(timer);
  }
}

/** True only when a backend really answers at `targetUrl`. */
export async function health(targetUrl: string): Promise<{ ok: boolean }> {
  const base = targetUrl.trim().replace(/\/$/, "");
  if (!base) return { ok: false };
  try {
    const res = await fetchWithTimeout(`${base}/health`, { method: "GET" }, 4000);
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}

/** Sends unsigned audio to the configured backend. Throws when there is none or it fails. */
export async function verifyAudio(
  file: Blob,
  opts: { filename?: string; transcript?: string; source?: "file" | "live" } = {},
): Promise<VerifyResult> {
  const base = explicitApiBase();
  if (!base) throw new ApiError("no backend configured", 404);

  const form = new FormData();
  form.append("audio", file, opts.filename ?? "audio.wav");
  form.append("source", opts.source ?? "file");
  if (opts.transcript) form.append("transcript", opts.transcript);

  const res = await fetchWithTimeout(`${base}/verify`, { method: "POST", body: form }, 15000);
  if (!res.ok) throw new ApiError(`${res.status} ${res.statusText}`, res.status);
  return res.json() as Promise<VerifyResult>;
}

/**
 * Reports a number. With a backend it is stored there (hashed); without one the
 * report is acknowledged locally and the sheet points the user to PDRM Semak Mule.
 */
export async function reportNumber(phone: string, category = "voice_clone"): Promise<void> {
  const base = explicitApiBase();
  if (!base) return;
  try {
    await fetchWithTimeout(`${base}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone_number: phone, category }),
    });
  } catch {
    /* the local acknowledgement still stands */
  }
}
