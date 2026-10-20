export type Verdict = "VERIFIED" | "TAMPERED" | "REPLAYED" | "EXPIRED" | "UNVERIFIED";
export type Level = "low" | "medium" | "high";
export type Colour = "green" | "red" | "orange" | "grey";

export interface SegmentResult {
  seq_no: number;
  matched: boolean;
  ber: number;
  watermarked: boolean;
}

export interface Provenance {
  sender_name: string | null;
  recorded_at: number | null;
  expires_at: number | null;
  context: string | null;
  session_id: string | null;
  notes: string[];
  segments: SegmentResult[];
  watermark: { confidence: number; engine: string };
}

export interface Risk {
  level: Level;
  reason: string;
  ai_level: Level;
  ai_score: number;
  phrase_score: number;
  phrase_groups: Record<string, number>;
}

export interface PhraseHit {
  phrase: string;
  group: "urgency" | "money" | "secrecy" | "authority";
  lang: string;
  start: number;
  end: number;
}

export interface Engines {
  detector: { engine: string; calibrated: boolean };
  watermark: { engine: string };
  transcriber: { engine: string; server_side: boolean };
}

export interface VerifyResult {
  verdict: Verdict;
  colour: Colour;
  duration_s: number;
  latency_ms: number;
  headline_key: string;
  step_keys: string[];
  provenance: Provenance;
  engines: Engines;
  risk?: Risk;
  detection?: { engine: string; calibrated: boolean; per_chunk: number[]; features: Record<string, number> };
  transcript?: { text: string; language: string; engine: string; available: boolean };
  phrases?: PhraseHit[];
}

export interface SessionOut {
  session_id: string;
  nonce: string;
  wm_ref: number;
  issued_at: number;
  expires_at: number;
  context: string;
  max_seconds: number;
}

export interface PrepareOut {
  session_id: string;
  fingerprint_root: string;
  payload_hex: string;
  segment_count: number;
  duration_s: number;
  watermark_engine: string;
}

export interface LiveUpdate {
  type: "update";
  window: number;
  elapsed_s: number;
  verdict: Verdict;
  level: Level;
  alert: boolean;
  colour: Colour;
  headline_key: string;
  step_keys: string[];
  risk: Risk;
  detection: { engine: string; calibrated: boolean; window_score: number };
  phrases: Pick<PhraseHit, "phrase" | "group" | "lang">[];
  replayed: boolean;
  replay_session_id: string | null;
  latency_ms: number;
}

export interface LiveReady {
  type: "ready";
  engines: Engines;
  server_asr: boolean;
  score_every_s: number;
  window_s: number;
}

export type LiveMessage = LiveReady | LiveUpdate | { type: "error"; detail: string };
