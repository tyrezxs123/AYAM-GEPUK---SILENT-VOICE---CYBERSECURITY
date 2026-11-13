import type { PrepareOut, SessionOut, VerifyResult } from "./types";

const API_STORAGE_KEY = "suarasah.api_base";
const DEFAULT_TIMEOUT_MS = 8000;

export function getSavedApiBase(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(API_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setSavedApiBase(url: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!url || !url.trim()) {
      window.localStorage.removeItem(API_STORAGE_KEY);
    } else {
      window.localStorage.setItem(API_STORAGE_KEY, url.trim().replace(/\/$/, ""));
    }
  } catch {
    /* ignore storage errors */
  }
}

export function isPrivateOrLocal(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)
  );
}

/**
 * Where the API lives.
 *
 * Priority:
 * 1. Explicit user override in localStorage (configured via UI Settings sheet)
 * 2. Build-time NEXT_PUBLIC_API_BASE environment variable
 * 3. Localhost or Private LAN: assume API runs on port 8000 of the same host
 * 4. Deployed web host (Netlify/Vercel/etc.): use relative root "" to allow rewrites,
 *    preventing dead connections to non-existent :8000 on cloud CDNs.
 */
export function apiBase(): string {
  const saved = getSavedApiBase();
  if (saved) return saved;

  const fromEnv = process.env.NEXT_PUBLIC_API_BASE;
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  if (typeof window === "undefined") return "http://localhost:8000";

  const { protocol, hostname } = window.location;

  // On local machines or LAN testing, default to port 8000
  if (isPrivateOrLocal(hostname)) {
    return `${protocol}//${hostname}:8000`;
  }

  // On public or cloud deployments (e.g. *.netlify.app), do not append :8000.
  // Use relative base path to support reverse proxies/redirects.
  return "";
}

export function wsBase(): string {
  const base = apiBase();
  if (!base) {
    if (typeof window === "undefined") return "ws://localhost:8000";
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${wsProto}//${window.location.host}`;
  }
  return base.replace(/^http/, "ws");
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
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res;
  } catch (err: unknown) {
    clearTimeout(timer);
    if ((err as Error)?.name === "AbortError") {
      throw new ApiError(`Sambungan tamat masa (timeout ${timeoutMs / 1000}s). Pastikan pelayan backend aktif.`, 504);
    }
    throw new ApiError(
      `Gagal menyambung ke pelayan backend (${url}). Sila pastikan pelayan berjalan atau tetapkan URL pelayan di Tetapan.`,
      0,
    );
  }
}

async function readError(res: Response): Promise<never> {
  let detail = `${res.status} ${res.statusText}`;
  try {
    const body = await res.json();
    if (body?.detail) {
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    }
  } catch {
    /* body was not JSON */
  }
  throw new ApiError(detail, res.status);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const base = apiBase();
  const res = await fetchWithTimeout(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await readError(res);
  return res.json() as Promise<T>;
}

export async function health(targetUrl?: string): Promise<{ ok: boolean; engines: VerifyResult["engines"]; phrase_rules: number }> {
  const base = targetUrl !== undefined ? targetUrl.replace(/\/$/, "") : apiBase();
  const res = await fetchWithTimeout(`${base}/health`, { method: "GET" }, 5000);
  if (!res.ok) await readError(res);
  return res.json();
}

export async function verifyAudio(
  file: Blob,
  opts: { filename?: string; transcript?: string; source?: "file" | "live" } = {},
): Promise<VerifyResult> {
  const form = new FormData();
  form.append("audio", file, opts.filename ?? "audio.wav");
  form.append("source", opts.source ?? "file");
  if (opts.transcript) form.append("transcript", opts.transcript);

  const base = apiBase();
  const res = await fetchWithTimeout(`${base}/verify`, { method: "POST", body: form }, 15000);
  if (!res.ok) await readError(res);
  return res.json() as Promise<VerifyResult>;
}

export function registerKey(body: {
  display_name: string;
  public_key: string;
  label?: string;
  user_id?: string;
}): Promise<{ user_id: string; device_key_id: string; display_name: string }> {
  return postJson("/keys", body);
}

export function revokeKey(keyId: string): Promise<{ revoked: boolean }> {
  return postJson(`/keys/${keyId}/revoke`, {});
}

export function createSession(body: {
  device_key_id: string;
  context?: string;
  expiry_seconds?: number;
}): Promise<SessionOut> {
  return postJson("/sessions", body);
}

export async function prepareSession(sessionId: string, audio: Blob): Promise<PrepareOut> {
  const form = new FormData();
  form.append("audio", audio, "clip.wav");
  const base = apiBase();
  const res = await fetchWithTimeout(`${base}/sessions/${sessionId}/prepare`, { method: "POST", body: form }, 15000);
  if (!res.ok) await readError(res);
  return res.json() as Promise<PrepareOut>;
}

/** Returns the signed WAV. The server deletes its copy of the audio right after. */
export async function signSession(sessionId: string, signatureHex: string): Promise<Blob> {
  const form = new FormData();
  form.append("signature", signatureHex);
  const base = apiBase();
  const res = await fetchWithTimeout(`${base}/sessions/${sessionId}/sign`, { method: "POST", body: form }, 15000);
  if (!res.ok) await readError(res);
  return res.blob();
}

export function reportNumber(phone: string, category = "voice_clone"): Promise<{ reports_for_this_number: number }> {
  return postJson("/reports", { phone_number: phone, category });
}
