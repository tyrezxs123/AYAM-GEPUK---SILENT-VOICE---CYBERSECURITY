"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { ErrorBox, ProgressNote, RiskMeter } from "@/components/Feedback";
import { CheckIcon, ClockIcon, PhoneOffIcon, QuestionIcon, StopIcon, WarningIcon, WaveIcon } from "@/components/Icons";
import { ConsentSheet, ReportSheet } from "@/components/Sheets";
import { PhraseChips, TONE, TranscriptView } from "@/components/VerdictCard";
import { fuseRisk, scanPhrases } from "@/lib/client-scanner";
import { addHistory } from "@/lib/history";
import { useI18n } from "@/lib/i18n";
import { MicError, startLiveEngine, type LiveEngine, type LiveState } from "@/lib/live-engine";
import type { Colour } from "@/lib/types";

type Phase = "intro" | "consent" | "starting" | "scanning" | "stopped" | "error";
type View = LiveState & { simulated?: boolean; replayed?: boolean };
type Sim = "scam" | "ai" | "replay" | "normal";

const ORB: Record<Colour, string> = {
  green: "bg-verdict-green dark:bg-emerald-500",
  red: "bg-verdict-red dark:bg-rose-500",
  orange: "bg-amber-500",
  grey: "bg-brand dark:bg-blue-500",
};

function simulate(kind: Sim, elapsed: number): View {
  const text =
    kind === "scam"
      ? "Mak, tolong transfer RM3000 ke akaun baru sekarang juga. Jangan bagitahu ayah."
      : kind === "normal"
        ? "Hello, apa khabar? Esok kita jumpa makan tengah hari ya."
        : "";
  const phrases = scanPhrases(text);
  const fused = fuseRisk(kind === "ai" ? 0.92 : kind === "scam" ? 0.3 : 0.08, phrases);
  const base: View = {
    ...fused,
    elapsed_s: elapsed,
    level: 0.3,
    micAlive: true,
    transcript: text,
    interim: "",
    hits: phrases.hits,
    voiceScore: fused.risk.ai_score,
    voiceWindows: 3,
    captions: "none",
    modelProgress: null,
    alert: fused.risk.level === "high",
    simulated: true,
  };
  if (kind === "replay") {
    return {
      ...base,
      replayed: true,
      colour: "orange",
      headline_key: "replayed",
      step_keys: ["old_recording_reused", "call_back_saved_number", "ask_safe_word"],
      alert: false,
    };
  }
  return base;
}

function fmt(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function LivePage() {
  const { t, tKey, lang } = useI18n();
  const [phase, setPhase] = useState<Phase>("intro");
  const [live, setLive] = useState<LiveState | null>(null);
  const [sim, setSim] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);

  const engine = useRef<LiveEngine | null>(null);
  const latest = useRef<LiveState | null>(null);

  const stop = useCallback(async () => {
    const current = engine.current;
    engine.current = null;
    await current?.stop();
    const last = latest.current;
    if (last && last.elapsed_s >= 3) {
      addHistory({
        kind: "live",
        verdict: "UNVERIFIED",
        colour: last.colour,
        level: last.risk.level,
        label: fmt(last.elapsed_s),
        duration_s: last.elapsed_s,
      });
    }
    setPhase((p) => (p === "error" ? p : "stopped"));
  }, []);

  useEffect(() => {
    return () => {
      void engine.current?.stop();
    };
  }, []);

  async function begin() {
    setPhase("starting");
    setError(null);
    setLive(null);
    setSim(null);
    latest.current = null;
    try {
      engine.current = await startLiveEngine({
        lang,
        onState: (state) => {
          latest.current = state;
          setLive(state);
        },
      });
      setPhase("scanning");
    } catch (err) {
      setError(err instanceof MicError && err.kind === "denied" ? t("micDenied") : t("micMissing"));
      setPhase("error");
    }
  }

  const view: View | null = sim ?? live;
  const colour: Colour = view?.colour ?? "grey";
  const tone = TONE[colour];
  const scanning = phase === "scanning";
  const word = !view
    ? t("liveListening")
    : view.replayed
      ? t("verdict_REPLAYED")
      : view.risk.level === "low" && scanning && !view.simulated
        ? t("liveListening")
        : t(`level_${view.risk.level}` as "level_low");
  const phraseLevel = !view ? "low" : view.risk.phrase_score >= 0.45 ? "high" : view.risk.phrase_score > 0 ? "medium" : "low";
  const Icon = !view ? WaveIcon : view.replayed ? ClockIcon : view.alert ? WarningIcon : view.risk.level === "medium" ? QuestionIcon : scanning ? WaveIcon : CheckIcon;
  const level = scanning && !sim ? Math.min(1, (live?.level ?? 0) * 2.5) : 0;

  return (
    <AppShell title={t("liveTitle")}>
      {(phase === "intro" || phase === "consent") && (
        <div className="space-y-4">
          <div className="panel animate-rise text-center !py-8">
            <span className="relative mx-auto flex h-28 w-28 items-center justify-center">
              <span className="absolute inset-0 animate-ring rounded-full bg-brand/30 dark:bg-blue-400/30" />
              <span className="absolute inset-0 animate-ring rounded-full bg-brand/30 dark:bg-blue-400/30" style={{ animationDelay: "1.1s" }} />
              <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-brand text-white shadow-lift">
                <WaveIcon className="h-10 w-10" strokeWidth={2.2} />
              </span>
            </span>
            <h2 className="mt-5 text-xl font-extrabold tracking-tight">{t("liveIntroTitle")}</h2>
            <p className="mt-2 text-base leading-snug text-ink/65 dark:text-slate-400">{t("liveHint")}</p>
          </div>
          <ol className="panel space-y-3 text-sm">
            {[t("liveStep1"), t("liveStep2"), t("liveStep3")].map((s, i) => (
              <li key={s} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-extrabold text-brand-dark dark:bg-blue-500/15 dark:text-blue-300">
                  {i + 1}
                </span>
                <span className="leading-snug text-ink/80 dark:text-slate-300">{s}</span>
              </li>
            ))}
          </ol>
          <button type="button" className="primary-button" onClick={() => setPhase("consent")}>
            <WaveIcon className="h-5 w-5" />
            {t("liveStart")}
          </button>
          {phase === "consent" && <ConsentSheet onAccept={begin} onCancel={() => setPhase("intro")} />}
        </div>
      )}

      {phase === "error" && error && (
        <div className="space-y-4">
          <ErrorBox message={error} hint={t("micHint")} />
          <button type="button" className="primary-button" onClick={begin}>
            {t("retry")}
          </button>
        </div>
      )}

      {(phase === "starting" || phase === "scanning" || phase === "stopped") && (
        <div className="space-y-3.5">
          <section className={`card text-center transition-colors duration-500 ${tone.card}`} aria-live="polite">
            <div className="flex items-center justify-between text-xs font-extrabold uppercase tracking-wider">
              <span className={`flex items-center gap-1.5 ${scanning ? "text-verdict-red dark:text-rose-400" : "text-ink/45 dark:text-slate-500"}`}>
                <span className={`h-2 w-2 rounded-full ${scanning ? "animate-pulse bg-verdict-red dark:bg-rose-400" : "bg-ink/30 dark:bg-slate-500"}`} />
                {scanning ? t("liveBadge") : phase === "stopped" ? t("liveEnded") : t("liveStarting")}
              </span>
              <span className="tabular-nums text-ink/60 dark:text-slate-400">{fmt(view?.elapsed_s ?? 0)}</span>
            </div>

            <span className="relative mx-auto mt-5 flex h-32 w-32 items-center justify-center">
              {scanning && (
                <>
                  <span className={`absolute inset-2 animate-ring rounded-full opacity-40 ${ORB[colour]}`} />
                  <span
                    className={`absolute inset-2 rounded-full opacity-25 transition-transform duration-100 ${ORB[colour]}`}
                    style={{ transform: `scale(${1 + level * 0.55})` }}
                  />
                </>
              )}
              <span className={`relative flex h-24 w-24 items-center justify-center rounded-full text-white shadow-lg transition-colors duration-500 ${ORB[colour]}`}>
                <Icon className="h-11 w-11" strokeWidth={2.4} />
              </span>
            </span>

            {view?.simulated && (
              <p className="mx-auto mt-4 inline-flex rounded-full bg-ink/80 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-white dark:bg-white/20">
                {t("simBadge")}
              </p>
            )}
            <p className={`mt-3 text-2xl font-extrabold tracking-tight ${tone.head}`}>{word}</p>
            <p className="mt-1 text-base font-semibold leading-snug">
              {view ? (view.risk.level === "low" && !view.replayed && view.transcript === "" && !view.simulated ? t("liveWaiting") : tKey("head", view.headline_key)) : t("liveWaiting")}
            </p>

            {view?.alert && (
              <p className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-verdict-red px-4 py-3 text-base font-extrabold text-white">
                <PhoneOffIcon className="h-5 w-5 shrink-0" />
                <span>{t("liveRedAlert")}</span>
              </p>
            )}
          </section>

          {scanning && live && !live.micAlive && !sim && (
            <p className="rounded-2xl bg-amber-500/10 p-3 text-sm font-semibold text-verdict-orange dark:text-amber-300">{t("liveMicSilent")}</p>
          )}

          {view && (
            <section className="panel space-y-4">
              <RiskMeter label={t("meterWords")} value={view.risk.phrase_score} level={phraseLevel} />
              <RiskMeter
                label={t("meterVoice")}
                value={view.voiceScore}
                level={view.risk.ai_level}
                caption={view.simulated ? undefined : view.voiceWindows === 0 ? t("voiceWaiting") : t("voiceMicCaveat")}
              />
              {view.hits.length > 0 && <PhraseChips phrases={view.hits} />}
            </section>
          )}

          {view && (
            <section className="panel">
              <div className="flex items-center justify-between gap-2">
                <p className="eyebrow">{t("transcriptLabel")}</p>
                {!view.simulated && (
                  <span className="text-[11px] font-semibold text-ink/40 dark:text-slate-500">{t(`captions_${view.captions.replace("-", "_")}` as "captions_none")}</span>
                )}
              </div>
              <div className="mt-2 flex max-h-44 min-h-[3.5rem] flex-col-reverse overflow-y-auto">
                {view.transcript || view.interim ? (
                  <TranscriptView text={view.transcript} phrases={view.hits.filter((h) => h.end <= view.transcript.length)} tail={view.interim} />
                ) : (
                  <p className="text-sm text-ink/45 dark:text-slate-500">{view.captions === "none" && !view.simulated ? t("captionsUnavailable") : t("liveCaptionsEmpty")}</p>
                )}
              </div>
              {view.captions === "whisper-loading" && !view.simulated && (
                <div className="mt-3">
                  <ProgressNote label={t("modelLoading")} value={view.modelProgress} />
                </div>
              )}
            </section>
          )}

          {view && (view.risk.level !== "low" || view.replayed || phase === "stopped") && (
            <section className="panel">
              <p className="eyebrow">{t("nextSteps")}</p>
              <ol className="mt-3 space-y-2.5">
                {view.step_keys.map((key, i) => (
                  <li key={key} className="flex gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-extrabold text-brand-dark dark:bg-blue-500/15 dark:text-blue-300">
                      {i + 1}
                    </span>
                    <span className="text-base leading-snug">{tKey("step", key)}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {phase === "stopped" ? (
            <div className="space-y-3">
              <button type="button" className="primary-button" onClick={begin}>
                <WaveIcon className="h-5 w-5" />
                {t("liveAgain")}
              </button>
              <button type="button" className="secondary-button" onClick={() => setShowReport(true)}>
                {t("reportTitle")}
              </button>
            </div>
          ) : (
            <button type="button" className="danger-button" onClick={stop}>
              <StopIcon className="h-5 w-5 shrink-0" />
              {t("liveStop")}
            </button>
          )}

          <details className="panel group !p-0">
            <summary className="flex cursor-pointer select-none items-center justify-between gap-3 p-4">
              <span>
                <span className="block text-sm font-extrabold">{t("simTitle")}</span>
                <span className="block text-xs text-ink/55 dark:text-slate-400">{t("simHint")}</span>
              </span>
              <span className="text-xl leading-none text-ink/40 transition group-open:rotate-45 dark:text-slate-500">+</span>
            </summary>
            <div className="flex flex-wrap gap-2 px-4 pb-4">
              {(["scam", "ai", "replay", "normal"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => {
                    const s = simulate(kind, live?.elapsed_s ?? 0);
                    setSim(s);
                    if (s.alert && "vibrate" in navigator) navigator.vibrate?.([200, 100, 200, 100, 400]);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className="rounded-xl border border-ink/10 bg-ink/[0.03] px-3 py-2 text-sm font-bold transition hover:bg-ink/[0.07] active:scale-95 dark:border-white/10 dark:bg-white/[0.05] dark:hover:bg-white/10"
                >
                  {t(`sim_${kind}` as "sim_scam")}
                </button>
              ))}
              {sim && (
                <button type="button" onClick={() => setSim(null)} className="rounded-xl px-3 py-2 text-sm font-bold text-brand dark:text-blue-400">
                  {t("simClear")}
                </button>
              )}
            </div>
          </details>

          <p className="px-1 text-xs leading-relaxed text-ink/45 dark:text-slate-500">{t("liveNothingSaved")}</p>
        </div>
      )}

      {showReport && <ReportSheet onClose={() => setShowReport(false)} />}
    </AppShell>
  );
}
