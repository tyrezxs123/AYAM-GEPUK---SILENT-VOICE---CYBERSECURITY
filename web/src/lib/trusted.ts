/**
 * Trusted senders, kept on the receiver's own phone.
 *
 * A valid signature proves a clip came unchanged from the phone that signed it.
 * It does not prove the display name is the person you think: anyone can sign
 * with their own key and call themselves "Ayah". So trust is tied to the
 * signing KEY, never the name. The same name arriving from a different key is
 * flagged as a possible impersonation, even after "Ayah" has been trusted.
 */
const KEY = "silentvoice.trusted.v2";

export interface TrustedSender {
  name: string;
  /** Hex Ed25519 public key that signed the clip the user chose to trust. */
  key: string;
  sessionId: string;
  firstSeen: number;
}

/** trusted: this exact key was trusted. impostor: the name is trusted, but under a different key. */
export type TrustStatus = "trusted" | "impostor" | "new";

type Store = Record<string, TrustedSender>; // keyed by public key

function read(): Store {
  if (typeof window === "undefined") return {};
  try {
    // Older name-keyed entries are deliberately not migrated: they carry no key.
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

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function trustStatus(name: string | null | undefined, key: string | null | undefined): TrustStatus {
  if (!name || !key) return "new";
  const store = read();
  if (store[key]) return "trusted";
  return Object.values(store).some((s) => sameName(s.name, name)) ? "impostor" : "new";
}

export function trust(name: string, key: string, sessionId: string | null): void {
  if (!name || !key) return;
  const store = read();
  store[key] = { name, key, sessionId: sessionId ?? "", firstSeen: store[key]?.firstSeen ?? Date.now() };
  write(store);
}

export function untrust(key: string): void {
  const store = read();
  delete store[key];
  write(store);
}

export function listTrusted(): TrustedSender[] {
  return Object.values(read()).sort((a, b) => a.name.localeCompare(b.name));
}
