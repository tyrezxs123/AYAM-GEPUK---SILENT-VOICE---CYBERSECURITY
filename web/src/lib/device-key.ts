/**
 * The device identity: an Ed25519 key pair that never leaves this phone.
 *
 * Preferred path: WebCrypto Ed25519 with a NON-EXTRACTABLE private key, stored
 * in IndexedDB as a CryptoKey. Even code running on this page cannot read the
 * private bytes back out; it can only ask the browser to sign with it.
 *
 * Fallback path (PRD risk register: "Ed25519 not supported in a browser"):
 * @noble/ed25519 with the seed in IndexedDB. That is weaker - the seed is
 * readable by this origin's scripts - so getIdentity() reports which path is
 * in use and the UI can say so.
 */
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";

// @noble/ed25519 v2 needs a sha512 implementation wired in explicitly.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const DB_NAME = "suarasah";
const STORE = "identity";
const KEY_ID = "device-key-v1";

export type KeyBackend = "webcrypto-ed25519" | "noble-ed25519";

export interface Identity {
  publicKeyHex: string;
  backend: KeyBackend;
  sign(message: Uint8Array): Promise<string>;
}

// --- IndexedDB -------------------------------------------------------------
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearIdentity(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- hex helpers -----------------------------------------------------------
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// --- WebCrypto availability ------------------------------------------------
async function webCryptoEd25519Works(): Promise<boolean> {
  if (typeof crypto === "undefined" || !crypto.subtle) return false;
  try {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    return !!pair.privateKey;
  } catch {
    return false;
  }
}

interface StoredWebCrypto {
  backend: "webcrypto-ed25519";
  privateKey: CryptoKey;
  publicKeyHex: string;
}

interface StoredNoble {
  backend: "noble-ed25519";
  seed: Uint8Array;
  publicKeyHex: string;
}

type Stored = StoredWebCrypto | StoredNoble;

function identityFrom(stored: Stored): Identity {
  if (stored.backend === "webcrypto-ed25519") {
    return {
      publicKeyHex: stored.publicKeyHex,
      backend: stored.backend,
      async sign(message) {
        const sig = await crypto.subtle.sign(
          { name: "Ed25519" },
          stored.privateKey,
          message as unknown as BufferSource,
        );
        return toHex(new Uint8Array(sig));
      },
    };
  }
  return {
    publicKeyHex: stored.publicKeyHex,
    backend: stored.backend,
    async sign(message) {
      return toHex(await ed.signAsync(message, stored.seed));
    },
  };
}

/** Creates the key pair on first use, then reuses it forever on this device. */
export async function getIdentity(): Promise<Identity> {
  const existing = await idbGet<Stored>(KEY_ID);
  if (existing) return identityFrom(existing);

  if (await webCryptoEd25519Works()) {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
    const stored: StoredWebCrypto = {
      backend: "webcrypto-ed25519",
      privateKey: pair.privateKey,
      publicKeyHex: toHex(new Uint8Array(raw)),
    };
    await idbPut(KEY_ID, stored);
    return identityFrom(stored);
  }

  const seed = ed.utils.randomPrivateKey();
  const stored: StoredNoble = {
    backend: "noble-ed25519",
    seed,
    publicKeyHex: toHex(await ed.getPublicKeyAsync(seed)),
  };
  await idbPut(KEY_ID, stored);
  return identityFrom(stored);
}

// --- the canonical signing payload ----------------------------------------
const DOMAIN = "SuaraSah/v1/voice-session";

function field(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length, false);
  out.set(bytes, 4);
  return out;
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Rebuilds the exact bytes the backend expects us to sign. Must stay identical
 * to api/app/core/crypto.py:signing_payload.
 *
 * This is why we rebuild rather than signing whatever the server hands over:
 * a compromised backend could otherwise ask this device to sign a payload that
 * describes someone else's audio.
 */
export function signingPayload(input: {
  sessionId: string;
  nonceHex: string;
  issuedAt: number;
  expiresAt: number;
  context: string;
  fingerprintRoot: string;
}): Uint8Array {
  return concat([
    field(utf8(DOMAIN)),
    field(utf8(input.sessionId)),
    field(fromHex(input.nonceHex)),
    field(utf8(String(Math.trunc(input.issuedAt)))),
    field(utf8(String(Math.trunc(input.expiresAt)))),
    field(utf8(input.context ?? "")),
    field(fromHex(input.fingerprintRoot)),
  ]);
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
