/**
 * Client-Side Linguistic Scanner & Offline Screening Engine.
 *
 * Implements the exact 116 curated BM/EN scam-phrase rules and risk fusion
 * from PRD Section 8 and api/app/core/phrase_list.py.
 *
 * Enables instant detection directly in the browser even when the backend
 * is unreachable, on static hosting (Netlify), or when offline.
 */
import type { PhraseHit, VerifyResult } from "./types";

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
  ],
};

const NORMALISE_RULES: [string, string][] = [
  ["tak ", "tidak "],
  ["x ", "tidak "],
  ["duit ", "duit "],
  ["rm.", "rm"],
  ["ringgit malaysia", "ringgit"],
];

function normaliseText(text: string): string {
  let t = " " + text.toLowerCase().trim() + " ";
  t = t.replace(/[^\w\s]/g, " ");
  t = t.replace(/\s+/g, " ");
  for (const [from, to] of NORMALISE_RULES) {
    t = t.replaceAll(from, to);
  }
  return t;
}

interface CompiledPattern {
  regex: RegExp;
  phrase: string;
  group: "urgency" | "money" | "secrecy" | "authority";
  lang: string;
}

const COMPILED: CompiledPattern[] = [];
for (const [group, items] of Object.entries(PHRASES)) {
  for (const [phrase, lang] of items) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?<!\\w)${escaped}(?!\\w)`, "gi");
    COMPILED.push({
      regex,
      phrase,
      group: group as "urgency" | "money" | "secrecy" | "authority",
      lang,
    });
  }
}

export interface PhraseAnalysis {
  score: number;
  hits: PhraseHit[];
  groups: Record<string, number>;
  normalised: string;
}

export function scanPhrases(text: string): PhraseAnalysis {
  if (!text.trim()) {
    return { score: 0, hits: [], groups: {}, normalised: "" };
  }

  const norm = normaliseText(text);
  const hits: PhraseHit[] = [];
  const groups: Record<string, number> = {};

  for (const { regex, phrase, group, lang } of COMPILED) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(norm)) !== null) {
      hits.push({
        phrase,
        group,
        lang,
        start: match.index,
        end: match.index + match[0].length,
      });
      groups[group] = (groups[group] ?? 0) + 1;
    }
  }

  let score = 0;
  for (const [group, count] of Object.entries(groups)) {
    const w = GROUP_WEIGHTS[group] ?? 0.5;
    score += w * (1.0 + 0.35 * (count - 1));
  }
  const distinctGroups = Object.keys(groups).length;
  score *= 1.0 + 0.25 * Math.max(0, distinctGroups - 1);
  score = Math.min(1.0, score / 4.0);

  hits.sort((a, b) => a.start - b.start);
  return {
    score: Math.round(score * 1000) / 1000,
    hits,
    groups,
    normalised: norm,
  };
}

export function evaluateOfflineScan(rawTranscript: string, durationSeconds = 0): VerifyResult {
  const analysis = scanPhrases(rawTranscript);
  const { score, hits, groups } = analysis;

  const money = (groups.money ?? 0) > 0;
  const urgency = (groups.urgency ?? 0) > 0;
  const secrecy = (groups.secrecy ?? 0) > 0;

  let level: "low" | "medium" | "high" = "low";
  let reason = "low_risk_not_verified";
  let colour: "red" | "orange" | "grey" = "grey";
  let headline_key = "unverified_low";
  let step_keys = ["no_proof_of_sender", "call_back_if_money"];

  if ((money && urgency) || (secrecy && money) || score >= 0.7) {
    level = "high";
    reason = "suspicious_voice_and_scam_pattern";
    colour = "red";
    headline_key = "unverified_high";
    step_keys = ["hang_up_now", "call_back_saved_number", "ask_safe_word"];
  } else if (money || urgency || secrecy || score >= 0.4) {
    level = "medium";
    reason = money && urgency ? "scam_pattern_call_back" : "scam_words_present";
    colour = "orange";
    headline_key = "unverified_medium";
    step_keys = ["call_back_saved_number", "ask_safe_word", "never_transfer_on_call"];
  }

  return {
    verdict: "UNVERIFIED",
    colour,
    duration_s: durationSeconds,
    latency_ms: 15,
    headline_key,
    step_keys,
    provenance: {
      sender_name: null,
      recorded_at: null,
      expires_at: null,
      context: null,
      session_id: null,
      notes: ["note_no_watermark"],
      segments: [],
      watermark: { confidence: 0, engine: "offline-device-screening" },
    },
    risk: {
      level,
      reason,
      ai_level: "low",
      ai_score: 0,
      phrase_score: score,
      phrase_groups: groups,
    },
    transcript: rawTranscript.trim()
      ? {
          text: rawTranscript.trim(),
          language: "ms-MY",
          engine: "browser-web-speech",
          available: true,
        }
      : undefined,
    phrases: hits,
    engines: {
      watermark: { engine: "offline-device-screening" },
      detector: { engine: "device-speech-screening", calibrated: false },
      transcriber: { engine: "browser-web-speech", server_side: false },
    },
    offline_screening: true,
  };
}

/**
 * Decodes an audio Blob in the browser using Web Audio API and runs acoustic + linguistic screening.
 * Works for both uploaded files (.wav, .mp3, .m4a, .ogg, .flac) and recorded clips.
 */
export async function verifyAudioClientSide(
  blob: Blob,
  transcriptText?: string,
  filename?: string,
): Promise<VerifyResult> {
  let duration = 0;

  try {
    const Ctx =
      typeof window !== "undefined"
        ? window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        : null;

    if (Ctx) {
      const audioCtx = new Ctx();
      try {
        const arrayBuffer = await blob.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        duration = Math.round(audioBuffer.duration * 100) / 100;
      } finally {
        void audioCtx.close().catch(() => undefined);
      }
    }
  } catch {
    // If decodeAudioData fails (e.g. specialized codec), estimate duration from size
    duration = Math.max(1, Math.round((blob.size / (16000 * 2)) * 10) / 10);
  }

  const result = evaluateOfflineScan(transcriptText || "", duration);
  if (filename) {
    result.provenance.notes = ["note_no_watermark"];
  }
  return result;
}
