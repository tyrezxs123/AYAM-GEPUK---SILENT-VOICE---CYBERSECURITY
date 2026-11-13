"use client";

import { useState } from "react";

import { useI18n } from "@/lib/i18n";
import { isTrusted, trust } from "@/lib/trusted";
import type { Colour, PhraseHit, VerifyResult, Verdict } from "@/lib/types";

import { RiskMeter } from "./Feedback";
import { CheckIcon, ClockIcon, CrossIcon, QuestionIcon, ShieldIcon, WarningIcon } from "./Icons";

export const TONE: Record<Colour, { card: string; head: string; chip: string; badge: string; bar: string }> = {
  green: {
    card: "border-verdict-green/25 bg-verdict-greenbg dark:border-emerald-500/30 dark:bg-emerald-500/10",
    head: "text-verdict-green dark:text-emerald-400",
    chip: "bg-verdict-green text-white dark:bg-emerald-600",
    badge: "bg-verdict-green text-white dark:bg-emerald-500",
    bar: "bg-verdict-green dark:bg-emerald-400",
  },
  red: {
    card: "border-verdict-red/25 bg-verdict-redbg dark:border-rose-500/30 dark:bg-rose-500/10",
    head: "text-verdict-red dark:text-rose-400",
    chip: "bg-verdict-red text-white dark:bg-rose-600",
    badge: "bg-verdict-red text-white dark:bg-rose-500",
    bar: "bg-verdict-red dark:bg-rose-400",
  },
  orange: {
    card: "border-amber-500/30 bg-verdict-orangebg dark:border-amber-500/30 dark:bg-amber-500/10",
    head: "text-verdict-orange dark:text-amber-400",
    chip: "bg-verdict-orange text-white dark:bg-amber-600",
    badge: "bg-amber-500 text-white",
    bar: "bg-amber-500",
  },
  grey: {
    card: "border-ink/10 bg-verdict-greybg dark:border-white/10 dark:bg-white/[0.06]",
    head: "text-verdict-grey dark:text-slate-200",
    chip: "bg-verdict-grey text-white dark:bg-slate-600",
    badge: "bg-verdict-grey text-white dark:bg-slate-600",
    bar: "bg-slate-400 dark:bg-slate-400",
  },
};

function VerdictIcon({ verdict, colour }: { verdict: Verdict; colour: Colour }) {
  const cls = "h-8 w-8";
  if (verdict === "VERIFIED") return <CheckIcon className={cls} strokeWidth={3} />;
  if (verdict === "TAMPERED") return <CrossIcon className={cls} strokeWidth={3} />;
  if (verdict === "REPLAYED" || verdict === "EXPIRED") return <ClockIcon className={cls} />;
  return colour === "red" ? <WarningIcon className={cls} /> : <QuestionIcon className={cls} />;
}

function formatTime(epochSeconds: number | null, lang: string): string {
  if (!epochSeconds) return "—";
  return new Date(epochSeconds * 1000).toLocaleString(lang === "ms" ? "ms-MY" : "en-MY", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

const GROUP_TONE: Record<PhraseHit["group"], string> = {
  money: "bg-verdict-red/10 text-verdict-red dark:bg-rose-500/15 dark:text-rose-300",
  urgency: "bg-amber-500/15 text-verdict-orange dark:bg-amber-500/15 dark:text-amber-300",
  secrecy: "bg-purple-500/10 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300",
  authority: "bg-blue-500/10 text-blue-900 dark:bg-blue-500/15 dark:text-blue-300",
};

const MARK_TONE: Record<PhraseHit["group"], string> = {
  money: "bg-verdict-red/15 text-verdict-red dark:bg-rose-500/25 dark:text-rose-200",
  urgency: "bg-amber-400/30 text-verdict-orange dark:bg-amber-500/25 dark:text-amber-200",
  secrecy: "bg-purple-500/15 text-purple-900 dark:bg-purple-500/25 dark:text-purple-200",
  authority: "bg-blue-500/15 text-blue-900 dark:bg-blue-500/25 dark:text-blue-200",
};

/** Phrase hits as coloured chips, grouped by the four scam categories. */
export function PhraseChips({ phrases }: { phrases: Pick<PhraseHit, "phrase" | "group">[] }) {
  const { tKey } = useI18n();
  if (phrases.length === 0) return null;

  const seen = new Map<string, Pick<PhraseHit, "phrase" | "group">>();
  for (const hit of phrases) if (!seen.has(hit.phrase)) seen.set(hit.phrase, hit);

  return (
    <ul className="flex flex-wrap gap-2">
      {[...seen.values()].map((hit) => (
        <li key={hit.phrase} className={`chip ${GROUP_TONE[hit.group]}`}>
          <span className="font-extrabold">{hit.phrase}</span>
          <span className="opacity-70">· {tKey("group", hit.group)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Transcript with every flagged phrase marked inline, coloured by category. */
export function TranscriptView({ text, phrases, tail }: { text: string; phrases: PhraseHit[]; tail?: string }) {
  if (!text && !tail) return null;
  const sorted = [...phrases].sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let at = 0;

  for (const [i, hit] of sorted.entries()) {
    if (hit.start < at || hit.end > text.length) continue;
    if (hit.start > at) parts.push(<span key={`plain-${i}`}>{text.slice(at, hit.start)}</span>);
    parts.push(
      <mark key={`hit-${i}`} className={`rounded-md px-1 py-0.5 font-bold ${MARK_TONE[hit.group]}`}>
        {text.slice(hit.start, hit.end)}
      </mark>,
    );
    at = hit.end;
  }
  parts.push(<span key="tail">{text.slice(at)}</span>);

  return (
    <p className="text-base leading-relaxed text-ink/85 dark:text-slate-200">
      {parts}
      {tail && <span className="text-ink/40 dark:text-slate-500"> {tail}</span>}
    </p>
  );
}

/** The clip as bars. For signed clips, the 2 s segments that failed are red. */
function Waveform({ result }: { result: VerifyResult }) {
  const peaks = result.waveform;
  if (!peaks || peaks.length === 0) return null;
  const segments = result.verdict === "UNVERIFIED" ? [] : result.provenance.segments;
  const tone = TONE[result.colour];

  return (
    <div className="flex h-14 items-center gap-[2px]" role="img" aria-hidden>
      {peaks.map((p, i) => {
        let failed = false;
        if (segments.length > 0) {
          const seg = segments[Math.min(segments.length - 1, Math.floor((i / peaks.length) * segments.length))];
          failed = !seg.matched;
        }
        return (
          <span
            key={i}
            className={`min-w-[2px] flex-1 rounded-full ${
              failed ? "bg-verdict-red dark:bg-rose-400" : segments.length > 0 && result.verdict === "TAMPERED" ? "bg-ink/20 dark:bg-white/25" : `${tone.bar} opacity-70`
            }`}
            style={{ height: `${Math.max(8, p * 100)}%` }}
          />
        );
      })}
    </div>
  );
}

/** Honest label for whichever engine actually produced the risk level. */
export function EngineNote({ engine, calibrated }: { engine: string; calibrated: boolean }) {
  const { t } = useI18n();
  return (
    <p>
      {t("engineLabel")}: {engine}
      {!calibrated && <> · {t("screeningOnly")}</>}
    </p>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-sm text-ink/55 dark:text-slate-400">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm font-bold">{children}</dd>
    </div>
  );
}

export function VerdictCard({ result, onReport }: { result: VerifyResult; onReport?: () => void }) {
  const { t, tKey, lang } = useI18n();
  const tone = TONE[result.colour];
  const prov = result.provenance;
  const sender = prov.sender_name;
  const signed = result.verdict !== "UNVERIFIED";
  const [trusted, setTrusted] = useState(() => isTrusted(sender));

  const segments = prov.segments;
  const failed = segments.filter((s) => !s.matched);
  const risk = result.risk;
  const phraseLevel = !risk ? "low" : risk.phrase_score >= 0.45 ? "high" : risk.phrase_score > 0 ? "medium" : "low";

  return (
    <div className="space-y-3.5">
      {/* 1. The verdict: colour + icon + word, never colour alone */}
      <section className={`card animate-rise ${tone.card}`} aria-live="polite">
        {result.simulated && (
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-ink/80 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-white dark:bg-white/20">
            {t("sampleBadge")}
          </p>
        )}
        <div className="flex items-center gap-3.5">
          <span className={`flex h-14 w-14 shrink-0 animate-pop items-center justify-center rounded-2xl ${tone.badge}`}>
            <VerdictIcon verdict={result.verdict} colour={result.colour} />
          </span>
          <div className="min-w-0">
            <p className={`text-2xl font-extrabold leading-tight tracking-tight ${tone.head}`}>
              {t(`verdict_${result.verdict}` as "verdict_VERIFIED")}
            </p>
            {risk && <p className={`text-sm font-bold ${tone.head}`}>{t(`level_${risk.level}` as "level_low")}</p>}
            {signed && sender && (
              <p className="truncate text-sm font-semibold text-ink/70 dark:text-slate-300">
                {t("senderLabel")} <strong className="text-ink dark:text-white">{sender}</strong>
              </p>
            )}
          </div>
        </div>

        <p className="mt-3.5 text-lg font-bold leading-snug">{tKey("head", result.headline_key)}</p>
        {risk && risk.reason !== "low_risk_not_verified" && (
          <p className="mt-1 text-base text-ink/75 dark:text-slate-300">{tKey("risk", risk.reason)}</p>
        )}

        {result.waveform && (
          <div className="mt-4">
            <Waveform result={result} />
            {result.verdict === "TAMPERED" && failed.length > 0 && segments.length > 0 && (
              <p className="mt-1.5 text-sm font-semibold text-verdict-red dark:text-rose-400">
                {t("segmentsLabel")}: {failed.map((s) => `${s.seq_no * 2}–${s.seq_no * 2 + 2}s`).join(", ")}
              </p>
            )}
          </div>
        )}
      </section>

      {/* 2. What to do next: the part that actually protects the user */}
      <section className="panel animate-rise" style={{ animationDelay: "60ms" }}>
        <p className="eyebrow">{t("nextSteps")}</p>
        <ol className="mt-3 space-y-3">
          {result.step_keys.map((key, i) => (
            <li key={key} className="flex gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-extrabold text-brand-dark dark:bg-blue-500/15 dark:text-blue-300">
                {i + 1}
              </span>
              <span className="text-base leading-snug">{tKey("step", key)}</span>
            </li>
          ))}
        </ol>

        {result.verdict === "VERIFIED" && sender && (
          <div className="mt-4 border-t border-ink/[0.07] pt-4 dark:border-white/10">
            {trusted ? (
              <p className="flex items-center gap-2 text-base font-bold text-verdict-green dark:text-emerald-400">
                <CheckIcon className="h-5 w-5" /> {t("trustedSender")}
              </p>
            ) : (
              <>
                <p className="mb-3 text-sm text-ink/65 dark:text-slate-400">{t("newSender")}</p>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    trust(sender, prov.session_id);
                    setTrusted(true);
                  }}
                >
                  {t("saveTrusted")}
                </button>
              </>
            )}
          </div>
        )}

        {onReport && result.verdict !== "VERIFIED" && (
          <button type="button" className="secondary-button mt-4" onClick={onReport}>
            {t("reportTitle")}
          </button>
        )}
      </section>

      {/* 3a. Signed clip: the evidence */}
      {signed && (
        <section className="panel animate-rise" style={{ animationDelay: "120ms" }}>
          <p className="eyebrow">{t("signatureEvidence")}</p>
          <dl className="mt-1 divide-y divide-ink/[0.07] dark:divide-white/10">
            <Fact label={t("factSender")}>{sender ?? "—"}</Fact>
            <Fact label={t("factRecorded")}>{formatTime(prov.recorded_at, lang)}</Fact>
            <Fact label={t("factValidUntil")}>{formatTime(prov.expires_at, lang)}</Fact>
            {prov.context && <Fact label={t("contextLabel")}>“{prov.context}”</Fact>}
            {segments.length > 0 && (
              <Fact label={t("factSegments")}>
                <span className={failed.length ? "text-verdict-red dark:text-rose-400" : "text-verdict-green dark:text-emerald-400"}>
                  {segments.length - failed.length}/{segments.length} {t("factSegmentsOk")}
                </span>
              </Fact>
            )}
          </dl>
          {prov.notes.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm text-ink/70 dark:text-slate-300">
              {prov.notes.map((n) => (
                <li key={n}>• {tKey("note", n)}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* 3b. Unsigned clip: the two independent warnings */}
      {risk && (
        <section className="panel animate-rise space-y-4" style={{ animationDelay: "120ms" }}>
          <p className="eyebrow">{t("analysisTitle")}</p>
          <RiskMeter
            label={t("meterVoice")}
            value={risk.ai_score}
            level={risk.ai_level}
            caption={
              result.voice && !result.voice.enough_speech
                ? t("voiceTooShort")
                : result.source === "mic"
                  ? t("voiceMicCaveat")
                  : tKey("voiceCaption", risk.ai_level)
            }
          />
          <RiskMeter
            label={t("meterWords")}
            value={risk.phrase_score}
            level={phraseLevel}
            caption={
              result.transcript && !result.transcript.available
                ? t("noTranscript")
                : (result.phrases?.length ?? 0) === 0
                  ? t("wordsNone")
                  : undefined
            }
          />
          {result.phrases && result.phrases.length > 0 && <PhraseChips phrases={result.phrases} />}
          <p className="flex items-start gap-2 rounded-2xl bg-ink/[0.04] p-3 text-xs leading-snug text-ink/65 dark:bg-white/[0.05] dark:text-slate-400">
            <ShieldIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand dark:text-blue-400" strokeWidth={2} />
            <span>{t("noSignatureNote")}</span>
          </p>
        </section>
      )}

      {result.transcript?.text && (
        <section className="panel animate-rise" style={{ animationDelay: "180ms" }}>
          <p className="eyebrow">{t("transcriptLabel")}</p>
          <div className="mt-2">
            <TranscriptView text={result.transcript.text} phrases={result.phrases ?? []} />
          </div>
        </section>
      )}

      <details className="px-1 text-xs text-ink/45 dark:text-slate-500">
        <summary className="cursor-pointer select-none font-bold hover:text-ink/70 dark:hover:text-slate-300">
          {t("technicalDetails")}
        </summary>
        <div className="mt-2 space-y-1 font-mono text-[11px] leading-relaxed">
          <p>
            {t("engineLabel")}: {prov.watermark.engine}
          </p>
          {result.detection && <EngineNote engine={result.detection.engine} calibrated={result.detection.calibrated} />}
          {result.transcript && result.transcript.engine !== "none" && <p>ASR: {result.transcript.engine}</p>}
          <p>
            {result.duration_s}s · {result.latency_ms} ms{prov.session_id ? ` · ${prov.session_id}` : ""}
          </p>
          {result.detection?.features && Object.keys(result.detection.features).length > 0 && (
            <p className="break-words">
              {["depth_db", "deep_silence_frac", "silence_frac", "snr_db", "f0_jitter"]
                .filter((k) => k in (result.detection?.features ?? {}))
                .map((k) => `${k}=${result.detection?.features[k]}`)
                .join(" · ")}
            </p>
          )}
          <p className="font-sans text-xs">{t("disclaimerBody")}</p>
        </div>
      </details>
    </div>
  );
}
