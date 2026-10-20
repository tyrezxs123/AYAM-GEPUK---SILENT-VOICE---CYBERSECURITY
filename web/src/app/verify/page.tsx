"use client";

import { useEffect, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { ErrorBox, LevelMeter, Stepper, Timer } from "@/components/Feedback";
import { FileIcon, MicIcon, StopIcon } from "@/components/Icons";
import { ReportSheet } from "@/components/Sheets";
import { VerdictCard } from "@/components/VerdictCard";
import { verifyAudio } from "@/lib/api";
import { startRecording, type Recording } from "@/lib/audio";
import { useI18n } from "@/lib/i18n";
import { speechSupported, startSpeech, type SpeechSession } from "@/lib/speech";
import type { VerifyResult } from "@/lib/types";

type Phase = "idle" | "recording" | "checking" | "done" | "error";

const RECORD_LIMIT_SECONDS = 120;

export default function VerifyPage() {
  const { t, lang } = useI18n();
  const [phase, setPhase] = useState<Phase>("idle");
  const [stage, setStage] = useState(0);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [showReport, setShowReport] = useState(false);

  const recording = useRef<Recording | null>(null);
  const speech = useRef<SpeechSession | null>(null);
  const transcript = useRef<string>("");
  const fileInput = useRef<HTMLInputElement>(null);

  // Advance the three stages while the request is in flight. They match the
  // real order the backend runs its engines in, so the labels are not a lie.
  useEffect(() => {
    if (phase !== "checking") return;
    setStage(0);
    const a = window.setTimeout(() => setStage(1), 700);
    const b = window.setTimeout(() => setStage(2), 1800);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [phase]);

  useEffect(() => {
    return () => {
      speech.current?.stop();
      void recording.current?.stop();
    };
  }, []);

  async function check(blob: Blob, filename: string, source: "file" | "live") {
    setPhase("checking");
    setError(null);
    try {
      const out = await verifyAudio(blob, {
        filename,
        source,
        transcript: transcript.current.trim() || undefined,
      });
      setResult(out);
      setPhase("done");
      if (out.colour === "red" && "vibrate" in navigator) navigator.vibrate?.([120, 60, 120]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  function onPickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    transcript.current = "";
    void check(file, file.name, "file");
  }

  async function startRecord() {
    setError(null);
    transcript.current = "";
    try {
      recording.current = await startRecording({
        maxSeconds: RECORD_LIMIT_SECONDS,
        onTick: (s, l) => {
          setSeconds(s);
          setLevel(l);
        },
      });
      // The phone transcribes locally when the backend has no Whisper, so the
      // scam-phrase check still works on a laptop with no GPU.
      if (speechSupported()) {
        speech.current = startSpeech(lang === "ms" ? "ms-MY" : "en-MY", (text, isFinal) => {
          if (isFinal) transcript.current += ` ${text}`;
        });
      }
      setPhase("recording");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  async function stopRecord() {
    const rec = recording.current;
    recording.current = null;
    speech.current?.stop();
    speech.current = null;
    if (!rec) return;
    const blob = await rec.stop();
    // Audio captured off a speakerphone is live audio: a signed clip appearing
    // in it means someone is replaying a recording.
    void check(blob, "live.wav", "live");
  }

  function reset() {
    setResult(null);
    setError(null);
    setSeconds(0);
    setPhase("idle");
    transcript.current = "";
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <AppShell title={t("verifyTitle")}>
      {phase === "idle" && (
        <div className="space-y-4">
          <p className="text-base text-ink/75 dark:text-slate-300">{t("verifyHint")}</p>

          <button type="button" className="primary-button" onClick={() => fileInput.current?.click()}>
            <FileIcon className="h-6 w-6" />
            {t("verifyPick")}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.ogg,.opus,.oga,.flac"
            className="hidden"
            onChange={onPickFile}
          />

          <button type="button" className="secondary-button" onClick={startRecord}>
            <MicIcon className="h-6 w-6" />
            {t("verifyRecord")}
          </button>
        </div>
      )}

      {phase === "recording" && (
        <div className="space-y-6">
          <p className="text-base text-ink/75 dark:text-slate-300">{t("liveHint")}</p>
          <Timer seconds={seconds} max={RECORD_LIMIT_SECONDS} />
          <LevelMeter level={level} />
          <button type="button" className="primary-button" onClick={stopRecord}>
            <StopIcon className="h-6 w-6" />
            {t("verifyStop")}
          </button>
        </div>
      )}

      {phase === "checking" && (
        <div className="space-y-6 py-6">
          <Stepper active={stage} />
        </div>
      )}

      {phase === "error" && error && (
        <div className="space-y-4">
          <ErrorBox message={error} hint={t("apiHint")} />
          <button type="button" className="secondary-button" onClick={reset}>
            {t("verifyAgain")}
          </button>
        </div>
      )}

      {phase === "done" && result && (
        <div className="space-y-5">
          <VerdictCard result={result} onReport={() => setShowReport(true)} />
          <button type="button" className="secondary-button" onClick={reset}>
            {t("verifyAgain")}
          </button>
        </div>
      )}

      {showReport && <ReportSheet onClose={() => setShowReport(false)} />}
    </AppShell>
  );
}
