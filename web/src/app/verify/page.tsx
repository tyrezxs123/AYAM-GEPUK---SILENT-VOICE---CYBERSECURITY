"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { ErrorBox, LevelMeter, ProgressNote, Stepper, Timer } from "@/components/Feedback";
import { MicIcon, StopIcon, UploadIcon } from "@/components/Icons";
import { ReportSheet } from "@/components/Sheets";
import { VerdictCard } from "@/components/VerdictCard";
import { analyzeClip, type Stage } from "@/lib/analysis";
import { MicError, startRecording, type Recording } from "@/lib/audio";
import { scenarioSample, type ScenarioType } from "@/lib/client-scanner";
import { AUDIO_ACCEPT, DecodeError } from "@/lib/decode";
import { takePendingClip } from "@/lib/handoff";
import { recordResult } from "@/lib/history";
import { useI18n } from "@/lib/i18n";
import type { VerifyResult } from "@/lib/types";

type Phase = "idle" | "recording" | "checking" | "done" | "error";

const RECORD_LIMIT_SECONDS = 120;
const STAGE_INDEX: Record<Stage, number> = { signature: 0, voice: 1, words: 2 };
const SAMPLES: ScenarioType[] = ["ai_voice", "human_voice", "scam_urgency", "verified", "tampered", "replayed", "expired"];

export default function VerifyPage() {
  const { t, lang } = useI18n();
  const [phase, setPhase] = useState<Phase>("idle");
  const [stage, setStage] = useState(0);
  const [modelPct, setModelPct] = useState<number | null | undefined>(undefined);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [showReport, setShowReport] = useState(false);
  const [dragging, setDragging] = useState(false);

  const recording = useRef<Recording | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const langRef = useRef(lang);
  langRef.current = lang;

  const check = useCallback(
    async (blob: Blob, filename: string, source: "file" | "mic") => {
      setPhase("checking");
      setStage(0);
      setModelPct(undefined);
      setError(null);
      setClipUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });
      try {
        const out = await analyzeClip(blob, {
          filename,
          source,
          lang: langRef.current,
          onStage: (s) => setStage(STAGE_INDEX[s]),
          onModelProgress: (p) => setModelPct(p.total ? p.loaded / p.total : null),
        });
        setResult(out);
        setPhase("done");
        recordResult(out, source === "mic" ? "record" : "file", filename);
        if (out.colour === "red" && "vibrate" in navigator) navigator.vibrate?.([120, 60, 120]);
      } catch (err) {
        const kind = err instanceof DecodeError ? err.kind : "unsupported";
        setError(t(`err_${kind}` as "err_unsupported"));
        setPhase("error");
      }
    },
    [t],
  );

  // A clip handed over from the Sign screen ("check it now").
  useEffect(() => {
    const clip = takePendingClip();
    if (clip) void check(clip.blob, clip.filename, "file");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      void recording.current?.stop();
    };
  }, []);

  function showSample(type: ScenarioType) {
    setClipUrl(null);
    setResult(scenarioSample(type));
    setPhase("done");
    window.scrollTo({ top: 0 });
  }

  function onPickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void check(file, file.name, "file");
  }

  async function startRecord() {
    setError(null);
    setSeconds(0);
    try {
      recording.current = await startRecording({
        maxSeconds: RECORD_LIMIT_SECONDS,
        onTick: (s, l) => {
          setSeconds(s);
          setLevel(l);
        },
      });
      setPhase("recording");
    } catch (err) {
      setError(err instanceof MicError && err.kind === "denied" ? t("micDenied") : t("micMissing"));
      setPhase("error");
    }
  }

  async function stopRecord() {
    const rec = recording.current;
    recording.current = null;
    if (!rec) return;
    const blob = await rec.stop();
    void check(blob, t("recordingLabel"), "mic");
  }

  function reset() {
    setResult(null);
    setError(null);
    setSeconds(0);
    setPhase("idle");
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <AppShell title={t("verifyTitle")}>
      {phase === "idle" && (
        <div className="space-y-3.5">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void check(file, file.name, "file");
            }}
            className={`flex w-full animate-rise flex-col items-center rounded-[28px] border-2 border-dashed px-5 py-8 text-center transition active:scale-[0.99] ${
              dragging
                ? "border-brand bg-brand-soft dark:bg-blue-500/20"
                : "border-brand/35 bg-surface hover:border-brand hover:bg-brand-soft/40 dark:border-blue-400/35 dark:bg-surface-dark dark:hover:bg-blue-500/10"
            }`}
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand text-white shadow-lift">
              <UploadIcon className="h-8 w-8" strokeWidth={2.2} />
            </span>
            <span className="mt-4 text-xl font-extrabold tracking-tight">{t("verifyPick")}</span>
            <span className="mt-1 text-sm leading-snug text-ink/60 dark:text-slate-400">{t("verifyHint")}</span>
            <span className="mt-3 text-[11px] font-bold uppercase tracking-wider text-ink/40 dark:text-slate-500">{t("verifyFormats")}</span>
          </button>
          <input ref={fileInput} type="file" accept={AUDIO_ACCEPT} className="hidden" onChange={onPickFile} />

          <button type="button" className="secondary-button" onClick={startRecord}>
            <MicIcon className="h-5 w-5 shrink-0" />
            <span className="truncate">{t("verifyRecord")}</span>
          </button>

          <details className="panel group !p-0">
            <summary className="flex cursor-pointer select-none items-center justify-between gap-3 p-4">
              <span>
                <span className="block text-sm font-extrabold">{t("samplesTitle")}</span>
                <span className="block text-xs text-ink/55 dark:text-slate-400">{t("samplesHint")}</span>
              </span>
              <span className="text-xl leading-none text-ink/40 transition group-open:rotate-45 dark:text-slate-500">+</span>
            </summary>
            <div className="flex flex-wrap gap-2 px-4 pb-4">
              {SAMPLES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => showSample(type)}
                  className="rounded-xl border border-ink/10 bg-ink/[0.03] px-3 py-2 text-sm font-bold transition hover:bg-ink/[0.07] active:scale-95 dark:border-white/10 dark:bg-white/[0.05] dark:hover:bg-white/10"
                >
                  {t(`sample_${type}` as "sample_ai_voice")}
                </button>
              ))}
            </div>
          </details>
        </div>
      )}

      {phase === "recording" && (
        <div className="panel animate-rise space-y-6 !py-8 text-center">
          <p className="flex items-center justify-center gap-2 text-sm font-extrabold uppercase tracking-wider text-verdict-red dark:text-rose-400">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-verdict-red dark:bg-rose-400" />
            {t("recordingNow")}
          </p>
          <Timer seconds={seconds} max={RECORD_LIMIT_SECONDS} />
          <LevelMeter level={level} />
          <p className="text-sm text-ink/60 dark:text-slate-400">{t("liveHint")}</p>
          <button type="button" className="danger-button" onClick={stopRecord}>
            <StopIcon className="h-5 w-5 shrink-0" />
            <span className="truncate">{t("verifyStop")}</span>
          </button>
        </div>
      )}

      {phase === "checking" && (
        <Stepper
          active={stage}
          note={stage === 2 && modelPct !== undefined ? <ProgressNote label={t("modelLoading")} value={modelPct} /> : undefined}
        />
      )}

      {phase === "error" && error && (
        <div className="space-y-4">
          <ErrorBox message={error} hint={t("errHint")} />
          <button type="button" className="primary-button" onClick={reset}>
            {t("verifyAgain")}
          </button>
        </div>
      )}

      {phase === "done" && result && (
        <div className="space-y-4">
          <VerdictCard result={result} onReport={() => setShowReport(true)} />
          {clipUrl && !result.simulated && <audio className="w-full" controls src={clipUrl} />}
          <button type="button" className="primary-button" onClick={reset}>
            {t("verifyAgain")}
          </button>
        </div>
      )}

      {showReport && <ReportSheet onClose={() => setShowReport(false)} />}
    </AppShell>
  );
}
