import type { PrepareOut, SessionOut, VerifyResult } from "./types";

/**
 * Where the API lives.
 *
 * Demo reality: the laptop runs the backend and the phone browses to the
 * laptop's LAN IP. Hard-coding localhost would break that, so unless
 * NEXT_PUBLIC_API_BASE is set we reuse the hostname that served this page and
 * swap the port to 8000.
 */
export function apiBase(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_BASE;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (typeof window === "undefined") return "http://localhost:8000";
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:8000`;
}

export function wsBase(): string {
  return apiBase().replace(/^http/, "ws");
}

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

async function readError(res: Response): Promise<never> {
  let detail = `${res.status} ${res.statusText}`;
  try {
    const body = await res.json();
    if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
  } catch {
    /* body was not JSON */
  }
  throw new ApiError(detail, res.status);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await readError(res);
  return res.json() as Promise<T>;
}

export async function health(): Promise<{ ok: boolean; engines: VerifyResult["engines"]; phrase_rules: number }> {
  const res = await fetch(`${apiBase()}/health`);
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
  const res = await fetch(`${apiBase()}/verify`, { method: "POST", body: form });
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
  const res = await fetch(`${apiBase()}/sessions/${sessionId}/prepare`, { method: "POST", body: form });
  if (!res.ok) await readError(res);
  return res.json() as Promise<PrepareOut>;
}

/** Returns the signed WAV. The server deletes its copy of the audio right after. */
export async function signSession(sessionId: string, signatureHex: string): Promise<Blob> {
  const form = new FormData();
  form.append("signature", signatureHex);
  const res = await fetch(`${apiBase()}/sessions/${sessionId}/sign`, { method: "POST", body: form });
  if (!res.ok) await readError(res);
  return res.blob();
}

export function reportNumber(phone: string, category = "voice_clone"): Promise<{ reports_for_this_number: number }> {
  return postJson("/reports", { phone_number: phone, category });
}
