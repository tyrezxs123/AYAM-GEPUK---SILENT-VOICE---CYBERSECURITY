/**
 * Trusted senders, kept on the receiver's own phone.
 *
 * This is the MVP answer to the "scammer registers as Ayah" threat (PRD
 * Section 7): a signature proves the clip came unchanged from some registered
 * device, not that the name on it is the person you think. So the first time a
 * name appears we warn, and the receiver decides to trust that specific
 * device key - not the display name.
 */
const KEY = "suarasah.trusted";

export interface TrustedSender {
  /** The session's signing identity: name plus the key that signed it. */
  name: string;
  sessionId: string;
  firstSeen: number;
}

type Store = Record<string, TrustedSender>;

function read(): Store {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Store;
  } catch {
    return {};
  }
}

function write(store: Store): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* private mode: trusting simply does not persist */
  }
}

function idFor(name: string): string {
  return name.trim().toLowerCase();
}

export function isTrusted(name: string | null | undefined): boolean {
  if (!name) return false;
  return idFor(name) in read();
}

export function trust(name: string, sessionId: string | null): void {
  if (!name) return;
  const store = read();
  store[idFor(name)] = {
    name,
    sessionId: sessionId ?? "",
    firstSeen: store[idFor(name)]?.firstSeen ?? Date.now(),
  };
  write(store);
}

export function untrust(name: string): void {
  const store = read();
  delete store[idFor(name)];
  write(store);
}

export function listTrusted(): TrustedSender[] {
  return Object.values(read()).sort((a, b) => a.name.localeCompare(b.name));
}
