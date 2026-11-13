/**
 * On-device voice provenance: sign and verify a WAV with no server at all.
 *
 * The signer's phone splits the 16-bit PCM into 2 s segments, hashes each
 * segment (SHA-256), builds a fingerprint root over the segment hashes, and
 * signs the canonical payload (same layout as api/app/core/crypto.py) with the
 * device's Ed25519 key. Everything needed to check it - public key, sender
 * name, session, expiry, segment hashes, signature - travels inside the WAV in
 * a private RIFF chunk ("svsg"). Audio players ignore unknown chunks.
 *
 * The receiver recomputes every segment hash and verifies the signature:
 *   - signature bad or root mismatch      -> TAMPERED
 *   - any segment hash differs            -> TAMPERED (with the failed segments)
 *   - all good but past expires_at        -> EXPIRED
 *   - all good                            -> VERIFIED
 * A file with no chunk returns null, so the caller falls through to screening.
 */
import * as ed from "@noble/ed25519";

import { encodeWav } from "./audio";
import { decodeAudio, DecodeError } from "./decode";
import { fromHex, signingPayload, toHex, type Identity } from "./device-key";
import type { SegmentResult, VerifyResult } from "./types";

const CHUNK_ID = "svsg";
const SEGMENT_SECONDS = 2;
export const PROVENANCE_ENGINE = "ed25519-embedded-v1 (on-device)";

interface SignedMeta {
  v: 1;
  sender: string;
  pub: string;
  sid: string;
  nonce: string;
  iat: number;
  exp: number;
  ctx: string;
  seg_s: number;
  segs: string[];
  root: string;
  sig: string;
}

interface ParsedWav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** Raw bytes of the "data" chunk. */
  data: Uint8Array;
  /** Bytes of the fmt chunk body, kept so re-written files stay identical. */
  fmt: Uint8Array;
  meta: SignedMeta | null;
}

function ascii(view: DataView, at: number): string {
  return String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
}

export function parseWav(bytes: Uint8Array): ParsedWav | null {
  if (bytes.length < 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(view, 0) !== "RIFF" || ascii(view, 8) !== "WAVE") return null;

  let fmt: Uint8Array | null = null;
  let data: Uint8Array | null = null;
  let meta: SignedMeta | null = null;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = ascii(view, at);
    let size = view.getUint32(at + 4, true);
    const start = at + 8;
    if (start + size > bytes.length) size = bytes.length - start; // truncated / streaming header
    const body = bytes.subarray(start, start + size);
    if (id === "fmt ") fmt = body;
    else if (id === "data") data = body;
    else if (id === CHUNK_ID) {
      try {
        meta = JSON.parse(new TextDecoder().decode(body).replace(/\0+$/, "")) as SignedMeta;
      } catch {
        meta = null;
      }
    }
    at = start + size + (size % 2);
  }
  if (!fmt || !data || fmt.length < 16) return null;
  const fv = new DataView(fmt.buffer, fmt.byteOffset, fmt.byteLength);
  return {
    channels: fv.getUint16(2, true),
    sampleRate: fv.getUint32(4, true),
    bitsPerSample: fv.getUint16(14, true),
    data,
    fmt,
    meta,
  };
}

function buildWav(fmt: Uint8Array, data: Uint8Array, meta: SignedMeta | null): Blob {
  const metaBytes = meta ? new TextEncoder().encode(JSON.stringify(meta)) : new Uint8Array(0);
  const pad = (n: number) => n % 2;
  const total =
    12 +
    8 + fmt.length + pad(fmt.length) +
    8 + data.length + pad(data.length) +
    (meta ? 8 + metaBytes.length + pad(metaBytes.length) : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const writeStr = (o: number, s: string) => {
    for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i);
  };
  writeStr(0, "RIFF");
  view.setUint32(4, total - 8, true);
  writeStr(8, "WAVE");
  let at = 12;
  const chunk = (id: string, body: Uint8Array) => {
    writeStr(at, id);
    view.setUint32(at + 4, body.length, true);
    out.set(body, at + 8);
    at += 8 + body.length + pad(body.length);
  };
  chunk("fmt ", fmt);
  chunk("data", data);
  if (meta) chunk(CHUNK_ID, metaBytes);
  return new Blob([out], { type: "audio/wav" });
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return new Uint8Array(digest);
}

function segmentBytes(wav: ParsedWav, seconds: number): number {
  const blockAlign = Math.max(1, wav.channels * (wav.bitsPerSample / 8));
  return Math.max(blockAlign, Math.round(wav.sampleRate * seconds) * blockAlign);
}

async function segmentHashes(wav: ParsedWav, seconds: number): Promise<string[]> {
  const step = segmentBytes(wav, seconds);
  const out: string[] = [];
  for (let at = 0; at < wav.data.length; at += step) {
    out.push(toHex(await sha256(wav.data.subarray(at, Math.min(at + step, wav.data.length)))));
  }
  return out;
}

async function rootOf(segs: string[]): Promise<string> {
  const joined = new Uint8Array(segs.length * 32);
  segs.forEach((h, i) => joined.set(fromHex(h), i * 32));
  return toHex(await sha256(joined));
}

/**
 * Any audio the device can decode -> 16-bit PCM WAV. A 16-bit PCM WAV passes
 * through untouched; everything else (opus, m4a, mp3, flac, video audio...)
 * is decoded and re-encoded as 16 kHz mono.
 */
export async function toPcmWav(audio: Blob): Promise<ParsedWav> {
  const bytes = new Uint8Array(await audio.arrayBuffer());
  const parsed = parseWav(bytes);
  if (parsed && parsed.bitsPerSample === 16 && parsed.data.length > 0 && isPcm(parsed)) return parsed;

  const decoded = await decodeAudio(audio);
  const wav = parseWav(new Uint8Array(await encodeWav(decoded.samples, decoded.rate).arrayBuffer()));
  if (!wav) throw new DecodeError("unsupported");
  return wav;
}

function isPcm(wav: ParsedWav): boolean {
  return new DataView(wav.fmt.buffer, wav.fmt.byteOffset, wav.fmt.byteLength).getUint16(0, true) === 1;
}

function randomHex(n: number): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return toHex(b);
}

export interface SignedClip {
  blob: Blob;
  sessionId: string;
  durationS: number;
  segments: number;
  signatureHex: string;
  fingerprintRoot: string;
  expiresAt: number;
}

/** Signs the audio on this device and returns a WAV that carries its own proof. */
export async function signOnDevice(
  audio: Blob,
  identity: Identity,
  opts: { sender: string; context: string; expirySeconds: number },
): Promise<SignedClip> {
  const wav = await toPcmWav(audio);
  if (wav.data.length === 0) throw new DecodeError("empty");
  const segs = await segmentHashes(wav, SEGMENT_SECONDS);
  const root = await rootOf(segs);
  const now = Math.floor(Date.now() / 1000);
  const meta: SignedMeta = {
    v: 1,
    sender: opts.sender,
    pub: identity.publicKeyHex,
    sid: "sv_" + randomHex(8),
    nonce: randomHex(16),
    iat: now,
    exp: now + Math.max(1, Math.floor(opts.expirySeconds)),
    ctx: opts.context,
    seg_s: SEGMENT_SECONDS,
    segs,
    root,
    sig: "",
  };
  meta.sig = await identity.sign(payloadFor(meta));
  const blockAlign = wav.channels * (wav.bitsPerSample / 8);
  return {
    blob: buildWav(wav.fmt, wav.data, meta),
    sessionId: meta.sid,
    durationS: Math.round((wav.data.length / blockAlign / wav.sampleRate) * 10) / 10,
    segments: segs.length,
    signatureHex: meta.sig,
    fingerprintRoot: root,
    expiresAt: meta.exp,
  };
}

function payloadFor(meta: SignedMeta): Uint8Array {
  return signingPayload({
    sessionId: meta.sid,
    nonceHex: meta.nonce,
    issuedAt: meta.iat,
    expiresAt: meta.exp,
    // The sender's display name is bound into the signature too, so nobody can
    // relabel a genuine clip as coming from someone else.
    context: `${meta.sender}\u001f${meta.ctx}`,
    fingerprintRoot: meta.root,
  });
}

/**
 * Demo helper: copies a signed clip and alters the audio in one segment
 * (keeps the signature), exactly what a scammer splicing words in would do.
 */
export async function makeTamperedCopy(signed: Blob): Promise<Blob> {
  const wav = parseWav(new Uint8Array(await signed.arrayBuffer()));
  if (!wav || !wav.meta) throw new Error("Not a signed clip");
  const data = new Uint8Array(wav.data); // copy
  const step = segmentBytes(wav, wav.meta.seg_s || SEGMENT_SECONDS);
  const target = data.length > step ? 1 : 0; // the 2-4 s segment when it exists
  const start = target * step;
  const end = Math.min(start + step, data.length);
  // Reverse the 16-bit samples in that segment: audibly spliced, same length.
  const samples = new Int16Array(data.buffer, start, Math.floor((end - start) / 2));
  samples.reverse();
  if (samples.length < 2) data[start] ^= 0xff;
  return buildWav(wav.fmt, data, wav.meta);
}

/** Returns a full verdict for a signed clip, or null when the file carries no signature. */
export async function verifyOnDevice(audio: Blob): Promise<VerifyResult | null> {
  const started = performance.now();
  let wav: ParsedWav | null = null;
  try {
    wav = parseWav(new Uint8Array(await audio.arrayBuffer()));
  } catch {
    return null;
  }
  if (!wav || !wav.meta) return null;
  const meta = wav.meta;

  const blockAlign = Math.max(1, wav.channels * (wav.bitsPerSample / 8));
  const duration = Math.round((wav.data.length / blockAlign / wav.sampleRate) * 10) / 10;

  const notes: string[] = [];
  let signatureOk = false;
  try {
    const rootOk = (await rootOf(meta.segs ?? [])) === meta.root;
    if (!rootOk) notes.push("fingerprint_root_mismatch");
    signatureOk = rootOk && (await ed.verifyAsync(fromHex(meta.sig), payloadFor(meta), fromHex(meta.pub)));
  } catch {
    signatureOk = false;
  }
  if (!signatureOk && !notes.includes("fingerprint_root_mismatch")) notes.push("signature_invalid");

  const actual = await segmentHashes(wav, meta.seg_s || SEGMENT_SECONDS);
  const count = Math.max(actual.length, meta.segs?.length ?? 0);
  const segments: SegmentResult[] = [];
  for (let i = 0; i < count; i++) {
    const ok = signatureOk && actual[i] !== undefined && actual[i] === meta.segs[i];
    segments.push({ seq_no: i, matched: ok, ber: ok ? 0 : 0.5, watermarked: actual[i] !== undefined });
  }
  const failed = segments.filter((s) => !s.matched).length;
  if (signatureOk && failed > 0) notes.push("fingerprint_root_mismatch");

  const now = Math.floor(Date.now() / 1000);
  const tampered = !signatureOk || failed > 0;
  const expired = !tampered && now > meta.exp;
  if (expired) notes.push("clip_expired");

  const base = {
    duration_s: duration,
    latency_ms: Math.max(1, Math.round(performance.now() - started)),
    provenance: {
      sender_name: meta.sender || null,
      recorded_at: meta.iat ?? null,
      expires_at: meta.exp ?? null,
      context: meta.ctx || null,
      session_id: meta.sid ?? null,
      signer_key: meta.pub ?? null,
      notes,
      segments,
      watermark: { confidence: tampered ? 1 - failed / Math.max(1, count) : 1, engine: PROVENANCE_ENGINE },
    },
    engines: {
      watermark: { engine: PROVENANCE_ENGINE },
      detector: { engine: "not run (signed clip)", calibrated: true },
      transcriber: { engine: "browser-web-speech", server_side: false },
    },
  };

  if (tampered) {
    return {
      ...base,
      verdict: "TAMPERED",
      colour: "red",
      headline_key: "tampered",
      step_keys: ["do_not_act", "call_back_saved_number", "report_number"],
    };
  }
  if (expired) {
    return {
      ...base,
      verdict: "EXPIRED",
      colour: "orange",
      headline_key: "expired",
      step_keys: ["ask_sender_resend", "call_back_saved_number"],
    };
  }
  return {
    ...base,
    verdict: "VERIFIED",
    colour: "green",
    headline_key: "verified",
    step_keys: ["verified_still_check_money", "save_trusted_sender"],
  };
}
