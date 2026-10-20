"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { ErrorBox, LevelMeter } from "@/components/Feedback";
import { CheckIcon, ClockIcon, PhoneOffIcon, QuestionIcon, StopIcon, WarningIcon } from "@/components/Icons";
import { ConsentSheet, ReportSheet } from "@/components/Sheets";
import { EngineNote, PhraseChips } from "@/components/VerdictCard";
import { useI18n } from "@/lib/i18n";
import { startLiveScan, type LiveScan } from "@/lib/live";
import { speechSupported, startSpeech, type SpeechSession } from "@/lib/speech";
import type { Colour, LiveUpdate } from "@/lib/types";

type Phase = "consent" | "starting" | "scanning" | "stopped" | "error";

const TONE: Record<Colour, string> = {
  green: "border-verdict-green dark:border-emerald-500/50 bg-verdict-greenbg dark:bg-emerald-950/40 text-verdict-green dark:text-emerald-400",
  red: "border-verdict-red dark:border-rose-500/50 bg-verdict-redbg dark:bg-rose-950/40 text-verdict-red dark:text-rose-400",
  orange: "border-verdict-orange dark:border-amber-500/50 bg-verdict-orangebg dark:bg-amber-950/40 text-verdict-orange dark:text-amber-400",
  grey: "border-verdict-grey/40 dark:border-slate-700 bg-verdict-greybg dark:bg-slate-900/60 text-verdict-grey dark:text-slate-300",
};

function StatusIcon({ update }: { update: LiveUpdate | null }) {
  const cls = "h-10 w-10";
  if (!update) return <QuestionIcon className={cls} />;
  if (update.replayed) return <ClockIcon className={cls} />;
  if (update.alert) return <WarningIcon className={cls} />;
  if (update.level === "low") return <CheckIcon className={cls} />;
  return <QuestionIcon className={cls} />;
}

export default function LivePage() {
  const { t, tKey, lang } = useI18n();
  const [phase, setPhase] = useState<Phase>("consent");
  const [update, setUpdate] = useState<LiveUpdate | null>(null);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [asrOn, setAsrOn] = useState(false);

  const scan = useRef<LiveScan | null>(null);
  const speech = useRef<SpeechSession | null>(null);
  const lastAlert = useRef(false);

  const stop = useCallback(async () => {
    speech.current?.stop();
    speech.current = null;
    const current = scan.current;
    scan.current = null;
    await current?.stop();
    setPhase((p) => (p === "error" ? p : "stopped"));
  }, []);

  useEffect(() => {
    return () => {
      speech.current?.stop();
      void scan.current?.stop();
    };
  }, []);

  async function begin() {
    setPhase("starting");
    setError(null);
    setUpdate(null);
    lastAlert.current = false;
    try {
      scan.current = await startLiveScan({
        onLevel: setLevel,
        onMessage: (message) => {
          if (message.type === "update") {
            setUpdate(message);
            // Vibrate once on the transition into red, not on every update.
            if (message.alert && !lastAlert.current && "vibrate" in navigator) {
              navigator.vibrate?.([200, 100, 200, 100, 400]);
            }
            lastAlert.current = message.alert;
          } else if (message.type === "error") {
            setError(message.detail);
            setPhase("error");
          }
        },
        onError: () => {
          setError(t("offline"));
          setPhase("error");
        },
      });

      if (speechSupported()) {
        setAsrOn(true);
        speech.current = startSpeech(lang === "ms" ? "ms-MY" : "en-MY", (text, isFinal) => {
          if (isFinal) scan.current?.sendTranscript(text);
        });
      }
      setPhase("scanning");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  const tone = TONE[update?.colour ?? "grey"];
  const verdictWord = update
    ? update.replayed
      ? t("verdict_REPLAYED")
      : t(`level_${update.level}` as "level_low")
    : t("liveListening");

  return (
    <AppShell title={t("liveTitle")}>
      {phase === "consent" && (
        <>
          <p className="text-base text-ink/70">{t("liveHint")}</p>
          <ConsentSheet onAccept={begin} onCancel={() => history.back()} />
        </>
      )}

      {phase === "error" && error && (
        <div className="space-y-4">
          <ErrorBox message={error} hint={t("apiHint")} />
          <button type="button" className="secondary-button" onClick={() => setPhase("consent")}>
            {t("liveStart")}
          </button>
        </div>
      )}

      {(phase === "starting" || phase === "scanning" || phase === "stopped") && (
        <div className="space-y-5">
          <section className={`card ${tone}`} aria-live="polite">
            <div className="flex items-center gap-3">
              <StatusIcon update={update} />
              <span className="text-2xl font-extrabold tracking-tight">{verdictWord}</span>
            </div>

            <p className="mt-3 text-lg font-semibold leading-snug text-ink dark:text-slate-100">
              {update ? tKey("head", update.headline_key) : t("liveWaiting")}
            </p>

            {update?.alert && (
              <p className="mt-3 flex items-start gap-2 text-lg font-bold text-verdict-red dark:text-rose-400">
                <PhoneOffIcon className="mt-0.5 h-6 w-6 shrink-0" />
                {t("liveRedAlert")}
              </p>
            )}

            {update && (
              <ol className="mt-3 space-y-1.5 text-base text-ink/85 dark:text-slate-200">
                {update.step_keys.map((key) => (
                  <li key={key}>• {tKey("step", key)}</li>
                ))}
              </ol>
            )}
          </section>

          {phase !== "stopped" && (
            <>
              <LevelMeter level={level} />
              <p className="text-center text-sm text-ink/60 dark:text-slate-400">
                {update ? `${update.elapsed_s}s · ${update.latency_ms} ms` : t("liveWaiting")}
              </p>
            </>
          )}

          {update && update.phrases.length > 0 && (
            <section className="space-y-2">
              <p className="text-sm font-bold uppercase tracking-wide text-ink/60 dark:text-slate-400">
                {t("liveFlagged")}
              </p>
              <PhraseChips
                phrases={update.phrases.map((p, i) => ({ ...p, start: i, end: i }))}
              />
            </section>
          )}

          {!asrOn && phase === "scanning" && (
            <p className="text-sm text-ink/50 dark:text-slate-400">{t("noTranscript")}</p>
          )}

          {phase === "stopped" ? (
            <div className="space-y-3">
              <button type="button" className="primary-button" onClick={begin}>
                {t("liveStart")}
              </button>
              <button type="button" className="secondary-button" onClick={() => setShowReport(true)}>
                {t("reportTitle")}
              </button>
            </div>
          ) : (
            <button type="button" className="primary-button" onClick={stop}>
              <StopIcon className="h-6 w-6" />
              {t("liveStop")}
            </button>
          )}

          <p className="text-sm text-ink/50">{t("liveNothingSaved")}</p>
          {update && (
            <EngineNote engine={update.detection.engine} calibrated={update.detection.calibrated} />
          )}
        </div>
      )}

      {showReport && <ReportSheet onClose={() => setShowReport(false)} />}
    </AppShell>
  );
}
