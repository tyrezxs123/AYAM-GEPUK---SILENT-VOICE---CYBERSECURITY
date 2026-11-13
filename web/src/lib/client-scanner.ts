/**
 * Scam-language rules and risk fusion, run on the device.
 *
 * 1. Curated BM/EN scam-phrase rules in four groups (PRD Section 8).
 * 2. Risk fusion: acoustic screening score + phrase groups -> low / medium / high.
 * 3. Demo samples: canned results for the "sample" buttons. They are marked
 *    `simulated` and the UI labels them as samples - they are never produced
 *    by analysing audio.
 *
 * Hard rule kept from the backend (api/app/service.py): nothing in this file
 * can return VERIFIED for analysed audio. Only lib/provenance.ts can.
 */
import type { Level, PhraseHit, Risk, VerifyResult } from "./types";

export const GROUP_WEIGHTS: Record<string, number> = {
  urgency: 0.9,
  money: 1.0,
  secrecy: 1.1,
  authority: 0.8,
};

export const PHRASES: Record<string, [string, string][]> = {
  urgency: [
    ["sekarang juga", "bm"], ["sekarang ni", "bm"], ["cepat sikit", "bm"],
    ["cepat cepat", "bm"], ["segera", "bm"], ["kecemasan", "bm"],
    ["darurat", "bm"], ["tolong saya", "bm"], ["masa tak banyak", "bm"],
    ["dalam 10 minit", "bm"], ["sebelum pukul", "bm"], ["jangan tunggu", "bm"],
    ["kena buat sekarang", "bm"], ["tak boleh tunggu", "bm"], ["last chance", "en"],
    ["right now", "en"], ["immediately", "en"], ["urgent", "en"],
    ["emergency", "en"], ["hurry", "en"], ["within the hour", "en"],
    ["before midnight", "en"], ["time is running out", "en"], ["act fast", "en"],
    ["accident", "en"], ["kemalangan", "bm"], ["masuk hospital", "bm"],
    ["kena tahan", "bm"], ["ditahan polis", "bm"], ["lock up", "en"],
    ["sekarang", "bm"], ["cepat", "bm"], ["hari ini juga", "bm"], ["tolong cepat", "bm"],
    ["as soon as possible", "en"], ["asap", "en"], ["kena tangkap", "bm"], ["ditangkap", "bm"],
  ],
  money: [
    ["transfer", "en"], ["pindah duit", "bm"], ["hantar duit", "bm"],
    ["bank in", "en"], ["masuk duit", "bm"], ["akaun baru", "bm"],
    ["nombor akaun", "bm"], ["account number", "en"], ["duit deposit", "bm"],
    ["bayaran", "bm"], ["deposit", "en"], ["rm", "both"],
    ["ringgit", "both"], ["ribu", "bm"], ["juta", "bm"],
    ["duit segera", "bm"], ["pinjam duit", "bm"], ["tuan rumah", "bm"],
    ["touch n go", "en"], ["tng", "en"], ["duitnow", "en"],
    ["maybank2u", "en"], ["cimb clicks", "en"], ["fpx", "en"],
    ["crypto", "en"], ["usdt", "en"], ["bitcoin", "en"],
    ["top up", "en"], ["gift card", "en"], ["upah", "bm"],
    ["yuran", "bm"], ["cukai", "bm"], ["denda", "bm"],
    ["payment link", "en"], ["link bayaran", "bm"], ["scan qr", "en"],
    ["pindah wang", "bm"], ["hantar wang", "bm"], ["pindahkan duit", "bm"], ["pindahkan wang", "bm"],
    ["transfer duit", "bm"], ["akaun bank", "bm"], ["akaun", "bm"], ["bank account", "en"], ["send money", "en"],
    ["wire", "en"], ["otp", "both"], ["kod tac", "bm"], ["tac", "both"], ["kod pengesahan", "bm"],
    ["nombor pin", "bm"], ["kata laluan", "bm"], ["password", "en"], ["nombor kad", "bm"], ["credit card", "en"],
    ["pinjaman", "bm"], ["loan", "en"], ["hutang", "bm"], ["tebusan", "bm"], ["ransom", "en"],
  ],
  secrecy: [
    ["jangan bagitau", "bm"], ["jangan beritahu", "bm"], ["jangan cakap", "bm"],
    ["rahsia", "bm"], ["antara kita", "bm"], ["jangan bagi tau sesiapa", "bm"],
    ["jangan bagitahu mak", "bm"], ["jangan bagitahu ayah", "bm"],
    ["jangan letak telefon", "bm"], ["jangan tutup telefon", "bm"],
    ["stay on the line", "en"], ["do not tell", "en"], ["dont tell anyone", "en"],
    ["keep this between us", "en"], ["confidential", "en"], ["secret", "en"],
    ["jangan report", "bm"], ["jangan pergi balai", "bm"],
    ["hapus mesej", "bm"], ["delete this message", "en"],
    ["jangan bagitahu", "bm"], ["jangan bagi tahu", "bm"], ["jangan beri tahu", "bm"], ["jangan kasi tahu", "bm"],
    ["jangan cerita", "bm"], ["do not tell anyone", "en"], ["don t tell", "en"], ["dont tell", "en"],
    ["between us", "en"], ["jangan letak", "bm"], ["do not hang up", "en"], ["don t hang up", "en"],
  ],
  authority: [
    ["polis", "bm"], ["pdrm", "bm"], ["balai polis", "bm"],
    ["inspektor", "bm"], ["mahkamah", "bm"], ["peguam", "bm"],
    ["bank negara", "bm"], ["bnm", "en"], ["lhdn", "bm"],
    ["kastam", "bm"], ["imigresen", "bm"], ["jpj", "bm"],
    ["pejabat pos", "bm"], ["kementerian", "bm"], ["ejen bank", "bm"],
    ["pihak bank", "bm"], ["bank officer", "en"], ["police", "en"],
    ["court order", "en"], ["warrant", "en"], ["investigation", "en"],
    ["money laundering", "en"], ["pengubahan wang haram", "bm"],
    ["akaun anda digunakan", "bm"], ["your account is involved", "en"],
    ["macc", "en"], ["sprm", "bm"], ["hospital", "both"],
    ["doktor", "bm"], ["nurse", "en"],
    ["bang negara", "bm"], ["pegawai bank", "bm"], ["pegawai polis", "bm"], ["sarjan", "bm"],
    ["waran tangkap", "bm"], ["arrest warrant", "en"], ["officer", "en"], ["jabatan", "bm"],
  ],
};

type Group = PhraseHit["group"];

interface CompiledPattern {
  regex: RegExp;
  phrase: string;
  group: Group;
  lang: string;
}

const COMPILED: CompiledPattern[] = [];
for (const [group, items] of Object.entries(PHRASES)) {
  for (const [phrase, lang] of items) {
    // Words may be separated by any run of spaces or punctuation, so
    // "sekarang, juga" and "RM 3,000" style transcripts still match.
    const words = phrase.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const regex = new RegExp(`(?<![\\p{L}\\p{N}])${words.join("[^\\p{L}\\p{N}]+")}(?![\\p{L}])`, "giu");
    COMPILED.push({ regex, phrase, group: group as Group, lang });
  }
}
// Longest phrases first, so "jangan bagitahu ayah" wins over "jangan bagitahu".
COMPILED.sort((a, b) => b.phrase.length - a.phrase.length);

export interface PhraseAnalysis {
  score: number;
  hits: PhraseHit[];
  groups: Record<string, number>;
}

/** Finds scam phrases. Hit positions index into `text` exactly as given. */
export function scanPhrases(text: string): PhraseAnalysis {
  if (!text.trim()) return { score: 0, hits: [], groups: {} };

  const taken: [number, number][] = [];
  const hits: PhraseHit[] = [];
  const groups: Record<string, number> = {};

  for (const { regex, phrase, group, lang } of COMPILED) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (taken.some(([s, e]) => start < e && end > s)) continue; // already covered by a longer phrase
      taken.push([start, end]);
      hits.push({ phrase, group, lang, start, end });
      groups[group] = (groups[group] ?? 0) + 1;
    }
  }

  let score = 0;
  for (const [group, count] of Object.entries(groups)) {
    const w = GROUP_WEIGHTS[group] ?? 0.5;
    score += w * (1.0 + 0.35 * (count - 1));
  }
  const distinct = Object.keys(groups).length;
  score *= 1.0 + 0.25 * Math.max(0, distinct - 1);
  score = Math.min(1.0, score / 4.0);

  hits.sort((a, b) => a.start - b.start);
  return { score: Math.round(score * 1000) / 1000, hits, groups };
}

// --- risk fusion -------------------------------------------------------------
export const RISK_HIGH_AT = 0.7;
export const RISK_MEDIUM_AT = 0.4;

export function levelFor(score: number): Level {
  return score >= RISK_HIGH_AT ? "high" : score >= RISK_MEDIUM_AT ? "medium" : "low";
}

export interface Fused {
  risk: Risk;
  colour: "red" | "orange" | "grey";
  headline_key: string;
  step_keys: string[];
}

/**
 * Combines the two independent warnings. The lowest thing this can ever say is
 * "low risk, but the sender is not verified" - never "human", never "safe".
 */
export function fuseRisk(aiScore: number, phrases: PhraseAnalysis): Fused {
  const g = phrases.groups;
  const money = (g.money ?? 0) > 0;
  const urgency = (g.urgency ?? 0) > 0;
  const secrecy = (g.secrecy ?? 0) > 0;
  const authority = g.authority ?? 0;
  const pressure = money || urgency || secrecy;
  // "This is the police / the bank - do not tell anyone": impersonation plus
  // isolation is the Macau-scam signature even before money is mentioned.
  const impersonation = authority > 0 && (secrecy || (authority >= 2 && urgency));
  const distinct = Object.keys(g).length;
  const aiLevel = levelFor(aiScore);

  let level: Level;
  let reason: string;
  let headline = "unverified_low";
  if (aiLevel === "high") {
    level = "high";
    reason = pressure ? "suspicious_voice_and_scam_pattern" : "likely_ai_voice";
    headline = "unverified_high";
  } else if (aiLevel === "medium" && pressure) {
    level = "high";
    reason = "suspicious_voice_and_scam_pattern";
    headline = "unverified_high_scam";
  } else if ((money && urgency) || (money && secrecy) || impersonation || (distinct >= 3 && pressure)) {
    level = "high";
    reason = "scam_pattern_call_back";
    headline = "unverified_high_scam";
  } else if (pressure) {
    level = "medium";
    reason = "scam_words_present";
    headline = "unverified_medium";
  } else if (aiLevel === "medium") {
    level = "medium";
    reason = "voice_uncertain";
    headline = "unverified_medium_voice";
  } else {
    level = "low";
    reason = "low_risk_not_verified";
  }

  const step_keys =
    level === "high"
      ? ["hang_up_now", "call_back_saved_number", money ? "never_transfer_on_call" : "ask_safe_word"]
      : level === "medium"
        ? ["call_back_saved_number", "ask_safe_word", "never_transfer_on_call"]
        : ["no_proof_of_sender", "call_back_if_money"];

  return {
    risk: {
      level,
      reason,
      ai_level: aiLevel,
      ai_score: Math.round(aiScore * 1000) / 1000,
      phrase_score: phrases.score,
      phrase_groups: g,
    },
    colour: level === "high" ? "red" : level === "medium" ? "orange" : "grey",
    headline_key: headline,
    step_keys,
  };
}

// --- demo samples -------------------------------------------------------------
export const SCREEN_ENGINE = "acoustic-screen-v2 (on-device)";
export const SIGN_ENGINE = "ed25519-embedded-v1 (on-device)";

export type ScenarioType =
  | "ai_voice"
  | "human_voice"
  | "scam_urgency"
  | "verified"
  | "tampered"
  | "replayed"
  | "expired";

const ENGINES = {
  watermark: { engine: SIGN_ENGINE },
  detector: { engine: SCREEN_ENGINE, calibrated: false },
  transcriber: { engine: "sample", server_side: false },
};

function unsignedSample(text: string, aiScore: number, duration: number): VerifyResult {
  const phrases = scanPhrases(text);
  const fused = fuseRisk(aiScore, phrases);
  return {
    verdict: "UNVERIFIED",
    colour: fused.colour,
    duration_s: duration,
    latency_ms: 0,
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
    transcript: { text, language: "ms-MY", engine: "sample", available: true },
    phrases: phrases.hits,
    engines: ENGINES,
    detection: { engine: SCREEN_ENGINE, calibrated: false, per_chunk: [], features: {} },
    simulated: true,
  };
}

function signedSample(
  verdict: "VERIFIED" | "TAMPERED" | "REPLAYED" | "EXPIRED",
  o: { sender: string; context: string; ageS: number; expiresInS: number; segments: boolean[]; notes: string[]; steps: string[]; colour: "green" | "red" | "orange" },
): VerifyResult {
  const now = Math.floor(Date.now() / 1000);
  return {
    verdict,
    colour: o.colour,
    duration_s: o.segments.length * 2,
    latency_ms: 0,
    headline_key: verdict.toLowerCase(),
    step_keys: o.steps,
    provenance: {
      sender_name: o.sender,
      recorded_at: now - o.ageS,
      expires_at: now + o.expiresInS,
      context: o.context,
      session_id: `sample-${verdict.toLowerCase()}`,
      notes: o.notes,
      segments: o.segments.map((matched, i) => ({ seq_no: i, matched, ber: matched ? 0 : 0.5, watermarked: true })),
      watermark: { confidence: 1, engine: SIGN_ENGINE },
    },
    engines: ENGINES,
    simulated: true,
  };
}

/** Built on demand so timestamps are fresh each time a sample is opened. */
export function scenarioSample(type: ScenarioType): VerifyResult {
  switch (type) {
    case "ai_voice":
      return unsignedSample("Hello, ini saya. Saya guna nombor baru, simpan nombor ini ya.", 0.93, 4.8);
    case "human_voice":
      return unsignedSample("Hello, apa khabar? Jumpa esok makan tengah hari ya.", 0.09, 3.5);
    case "scam_urgency":
      return unsignedSample(
        "Mak, tolong transfer RM3000 ke akaun baru sekarang juga! Saya kena tahan polis, jangan bagitahu ayah.",
        0.31,
        6.2,
      );
    case "verified":
      return signedSample("VERIFIED", {
        sender: "Ayah",
        context: "Untuk Mak sahaja",
        ageS: 3600,
        expiresInS: 7 * 86400,
        segments: [true, true, true],
        notes: [],
        steps: ["verified_still_check_money", "save_trusted_sender"],
        colour: "green",
      });
    case "tampered":
      return signedSample("TAMPERED", {
        sender: "Ayah",
        context: "Pengesahan bank",
        ageS: 7200,
        expiresInS: 5 * 86400,
        segments: [true, false, true, true],
        notes: ["fingerprint_root_mismatch"],
        steps: ["do_not_act", "call_back_saved_number", "report_number"],
        colour: "red",
      });
    case "replayed":
      return signedSample("REPLAYED", {
        sender: "Ayah",
        context: "Pindahan lepas",
        ageS: 14 * 86400,
        expiresInS: 3 * 86400,
        segments: [true, true],
        notes: ["signed_clip_inside_live_audio"],
        steps: ["old_recording_reused", "call_back_saved_number", "ask_safe_word"],
        colour: "orange",
      });
    case "expired":
      return signedSample("EXPIRED", {
        sender: "Kakak",
        context: "Kehadiran",
        ageS: 20 * 86400,
        expiresInS: -5 * 86400,
        segments: [true, true],
        notes: ["clip_expired"],
        steps: ["ask_sender_resend", "call_back_saved_number"],
        colour: "orange",
      });
  }
}
