"use client";

import { useState } from "react";

import { useI18n } from "@/lib/i18n";
import type { Colour, PhraseHit, VerifyResult, Verdict } from "@/lib/types";
import { isTrusted, trust } from "@/lib/trusted";

import { CheckIcon, ClockIcon, CrossIcon, QuestionIcon, ShieldIcon, WarningIcon } from "./Icons";

const TONE: Record<Colour, { card: string; head: string; chip: string }> = {
  green: {
    card: "border-verdict-green dark:border-emerald-500/50 bg-verdict-greenbg dark:bg-emerald-950/40 text-ink dark:text-slate-100",
    head: "text-verdict-green dark:text-emerald-400",
    chip: "bg-verdict-green dark:bg-emerald-600 text-white",
  },
  red: {
    card: "border-verdict-red dark:border-rose-500/50 bg-verdict-redbg dark:bg-rose-950/40 text-ink dark:text-slate-100",
    head: "text-verdict-red dark:text-rose-400",
    chip: "bg-verdict-red dark:bg-rose-600 text-white",
  },
  orange: {
    card: "border-verdict-orange dark:border-amber-500/50 bg-verdict-orangebg dark:bg-amber-950/40 text-ink dark:text-slate-100",
    head: "text-verdict-orange dark:text-amber-400",
    chip: "bg-verdict-orange dark:bg-amber-600 text-white",
  },
  grey: {
    card: "border-verdict-grey/40 dark:border-slate-700 bg-verdict-greybg dark:bg-slate-900/60 text-ink dark:text-slate-100",
    head: "text-verdict-grey dark:text-slate-300",
    chip: "bg-verdict-grey dark:bg-slate-700 text-white",
  },
};

function VerdictIcon({ verdict, colour }: { verdict: Verdict; colour: Colour }) {
  const cls = "h-8 w-8";
  if (verdict === "VERIFIED") return <CheckIcon className={cls} />;
  if (verdict === "TAMPERED") return <CrossIcon className={cls} />;
  if (verdict === "REPLAYED" || verdict === "EXPIRED") return <ClockIcon className={cls} />;
  return colour === "red" ? <WarningIcon className={cls} /> : <QuestionIcon className={cls} />;
}

function formatTime(epochSeconds: number | null, lang: string): string {
  if (!epochSeconds) return "";
  return new Date(epochSeconds * 1000).toLocaleString(lang === "ms" ? "ms-MY" : "en-MY", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Phrase hits as coloured chips, grouped by the four scam categories. */
export function PhraseChips({ phrases }: { phrases: PhraseHit[] }) {
  const { tKey } = useI18n();
  if (phrases.length === 0) return null;

  const seen = new Map<string, PhraseHit>();
  for (const hit of phrases) if (!seen.has(hit.phrase)) seen.set(hit.phrase, hit);

  const tone: Record<PhraseHit["group"], string> = {
    money: "bg-verdict-red/10 text-verdict-red dark:bg-rose-950/50 dark:text-rose-300",
    urgency: "bg-verdict-orange/10 text-verdict-orange dark:bg-amber-950/50 dark:text-amber-300",
    secrecy: "bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300",
    authority: "bg-blue-100 text-blue-900 dark:bg-blue-950/50 dark:text-blue-300",
  };

  return (
    <ul className="flex flex-wrap gap-2">
      {[...seen.values()].map((hit) => (
        <li key={hit.phrase} className={`chip ${tone[hit.group]}`}>
          <span className="font-bold">{hit.phrase}</span>
          <span className="opacity-70">· {tKey("group", hit.group)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Transcript with every flagged phrase marked inline. */
export function TranscriptView({ text, phrases }: { text: string; phrases: PhraseHit[] }) {
  if (!text) return null;
  const sorted = [...phrases].sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let at = 0;

  for (const [i, hit] of sorted.entries()) {
    if (hit.start < at) continue;
    if (hit.start > at) parts.push(<span key={`plain-${i}`}>{text.slice(at, hit.start)}</span>);
    parts.push(
      <mark key={`hit-${i}`} className="rounded bg-yellow-200 dark:bg-yellow-500/30 px-0.5 font-semibold text-ink dark:text-yellow-200">
        {text.slice(hit.start, hit.end)}
      </mark>,
    );
    at = hit.end;
  }
  parts.push(<span key="tail">{text.slice(at)}</span>);

  return <p className="text-base leading-relaxed text-ink/85 dark:text-slate-200">{parts}</p>;
}

/** Which 2 s segments failed, as a strip - the TAMPERED evidence. */
function SegmentStrip({ result }: { result: VerifyResult }) {
  const { t } = useI18n();
  const segments = result.provenance.segments;
  if (segments.length === 0 || result.verdict === "UNVERIFIED") return null;
  const failed = segments.filter((s) => !s.matched);
  if (failed.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-sm font-bold uppercase tracking-wide text-ink/55">{t("segmentsLabel")}</p>
      <div className="flex gap-1" role="img" aria-label={`${failed.length}/${segments.length}`}>
        {segments.map((s) => (
          <span
            key={s.seq_no}
            title={`${s.seq_no * 2}-${s.seq_no * 2 + 2}s`}
            className={`h-8 flex-1 rounded ${s.matched ? "bg-verdict-green/35" : "bg-verdict-red"}`}
          />
        ))}
      </div>
      <p className="text-sm text-ink/65">
        {failed.map((s) => `${s.seq_no * 2}–${s.seq_no * 2 + 2}s`).join(", ")}
      </p>
    </div>
  );
}

/** Honest label for whichever engine actually produced the risk level. */
export function EngineNote({ engine, calibrated }: { engine: string; calibrated: boolean }) {
  const { t } = useI18n();
  return (
    <p className="text-xs leading-snug text-ink/50">
      {t("engineLabel")}: {engine}
      {!calibrated && <> · {t("screeningOnly")}</>}
    </p>
  );
}

export function VerdictCard({ result, onReport }: { result: VerifyResult; onReport?: () => void }) {
  const { t, tKey, lang } = useI18n();
  const tone = TONE[result.colour];
  const sender = result.provenance.sender_name;
  const [trusted, setTrusted] = useState(() => isTrusted(sender));

  return (
    <div className="space-y-4 animate-rise">
      <section className={`card ${tone.card}`} aria-live="polite">
        <div className={`flex items-center gap-3 ${tone.head}`}>
          <VerdictIcon verdict={result.verdict} colour={result.colour} />
          <span className="text-2xl font-extrabold tracking-tight">
            {t(`verdict_${result.verdict}` as "verdict_VERIFIED")}
          </span>
        </div>

        <p className="mt-3 text-lg font-semibold leading-snug">
          {tKey("head", result.headline_key)}
        </p>

        {result.verdict === "VERIFIED" && sender && (
          <p className="mt-3 text-base">
            {t("senderLabel")} <strong>{sender}</strong> {t("recordedAt")}{" "}
            <strong>{formatTime(result.provenance.recorded_at, lang)}</strong>
          </p>
        )}

        {result.provenance.context && (
          <p className="mt-2 text-base text-ink/75">
            {t("contextLabel")}: <em>“{result.provenance.context}”</em>
          </p>
        )}

        {result.risk && (
          <p className="mt-3 text-base">
            <span className={`chip ${tone.chip}`}>{t(`level_${result.risk.level}` as "level_low")}</span>{" "}
            <span className="align-middle">{tKey("risk", result.risk.reason)}</span>
          </p>
        )}
      </section>

      {/* Next steps: the part that actually protects the user */}
      <section className="card border-ink/15 dark:border-white/10 bg-white dark:bg-[#161c28]">
        <ol className="space-y-3">
          {result.step_keys.map((key, i) => (
            <li key={key} className="flex gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft dark:bg-blue-950/60 text-sm font-bold text-brand-dark dark:text-blue-300">
                {i + 1}
              </span>
              <span className="text-base leading-snug text-ink/90 dark:text-slate-200">{tKey("step", key)}</span>
            </li>
          ))}
        </ol>

        {result.verdict === "VERIFIED" && sender && (
          <div className="mt-4 border-t border-ink/10 dark:border-white/10 pt-4">
            {trusted ? (
              <p className="text-base font-semibold text-verdict-green dark:text-emerald-400">✓ {t("trustedSender")}</p>
            ) : (
              <>
                <p className="mb-3 text-base text-ink/75 dark:text-slate-300">{t("newSender")}</p>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    trust(sender, result.provenance.session_id);
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

      <SegmentStrip result={result} />

      {result.phrases && result.phrases.length > 0 && (
        <section className="space-y-2">
          <p className="text-sm font-bold uppercase tracking-wide text-ink/60 dark:text-slate-400">{t("liveFlagged")}</p>
          <PhraseChips phrases={result.phrases} />
        </section>
      )}

      {result.transcript && (
        <section className="space-y-2">
          <p className="text-sm font-bold uppercase tracking-wide text-ink/60 dark:text-slate-400">
            {t("transcriptLabel")}
          </p>
          {result.transcript.text ? (
            <TranscriptView text={result.transcript.text} phrases={result.phrases ?? []} />
          ) : (
            <p className="text-base text-ink/55 dark:text-slate-400">{t("noTranscript")}</p>
          )}
        </section>
      )}

      <section className="space-y-2 border-t border-ink/10 dark:border-white/10 pt-4">
        <div className="rounded-xl border border-ink/10 dark:border-white/10 bg-slate-100/70 dark:bg-slate-900/50 p-3 text-xs text-ink/75 dark:text-slate-300">
          <p className="flex items-center gap-1.5 font-semibold text-ink dark:text-slate-200">
            <ShieldIcon className="h-3.5 w-3.5 text-brand dark:text-blue-400 shrink-0" />
            <span>{t("disclaimerTitle")}</span>
          </p>
          <p className="mt-1 leading-relaxed text-ink/70 dark:text-slate-300">{t("disclaimerBody")}</p>
        </div>

        <details className="cursor-pointer text-[11px] text-ink/45 dark:text-slate-400">
          <summary className="font-semibold select-none hover:text-ink/75 dark:hover:text-slate-200">
            {t("technicalDetails")} ({result.latency_ms} ms)
          </summary>
          <div className="mt-1 space-y-0.5 font-mono">
            {result.detection && (
              <EngineNote engine={result.detection.engine} calibrated={result.detection.calibrated} />
            )}
            <p>
              {t("engineLabel")}: {result.provenance.watermark.engine} · {result.latency_ms} ms ·{" "}
              {result.duration_s} s
            </p>
          </div>
        </details>
      </section>
    </div>
  );
}
