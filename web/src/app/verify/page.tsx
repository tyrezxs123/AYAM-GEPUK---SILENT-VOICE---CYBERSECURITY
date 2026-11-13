"use client";

import { useEffect, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { ErrorBox, LevelMeter, Stepper, Timer } from "@/components/Feedback";
import { FileIcon, MicIcon, StopIcon } from "@/components/Icons";
import { ReportSheet, ServerSettingsSheet } from "@/components/Sheets";
import { VerdictCard } from "@/components/VerdictCard";
import { verifyAudio } from "@/lib/api";
import { startRecording, type Recording } from "@/lib/audio";
import { verifyAudioClientSide } from "@/lib/client-scanner";
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
  const [showServerSettings, setShowServerSettings] = useState(false);

  const recording = useRef<Recording | null>(null);
  const speech = useRef<SpeechSession | null>(null);
  const transcript = useRef<string>("");
  const fileInput = useRef<HTMLInputElement>(null);

  // Advance the three stages while the request is in flight.
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
    const text = transcript.current.trim();

    try {
      const out = await verifyAudio(blob, {
        filename,
        source,
        transcript: text || undefined,
      });
      setResult(out);
      setPhase("done");
      if (out.colour === "red" && "vibrate" in navigator) navigator.vibrate?.([120, 60, 120]);
    } catch {
      // If server is unreachable/offline, or returns 404 (e.g. static hosting on Netlify),
      // run client-side audio decoding and screening so verification ALWAYS succeeds!
      try {
        const clientOut = await verifyAudioClientSide(blob, text, filename);
        setResult(clientOut);
        setPhase("done");
        if (clientOut.colour === "red" && "vibrate" in navigator) {
          navigator.vibrate?.([120, 60, 120]);
        }
      } catch (clientErr) {
        setError(clientErr instanceof Error ? clientErr.message : String(clientErr));
        setPhase("error");
      }
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
      // scam-phrase check still works on a laptop with no GPU or offline.
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
          <p className="text-sm sm:text-base text-ink/75 dark:text-slate-300">{t("verifyHint")}</p>

          <button type="button" className="primary-button" onClick={() => fileInput.current?.click()}>
            <FileIcon className="h-5 w-5 sm:h-6 sm:w-6 shrink-0" />
            <span className="truncate">{t("verifyPick")}</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.ogg,.opus,.oga,.flac"
            className="hidden"
            onChange={onPickFile}
          />

          <button type="button" className="secondary-button" onClick={startRecord}>
            <MicIcon className="h-5 w-5 sm:h-6 sm:w-6 shrink-0" />
            <span className="truncate">{t("verifyRecord")}</span>
          </button>
        </div>
      )}

      {phase === "recording" && (
        <div className="space-y-5 sm:space-y-6">
          <p className="text-sm sm:text-base text-ink/75 dark:text-slate-300">{t("liveHint")}</p>
          <Timer seconds={seconds} max={RECORD_LIMIT_SECONDS} />
          <LevelMeter level={level} />
          <button type="button" className="primary-button" onClick={stopRecord}>
            <StopIcon className="h-5 w-5 sm:h-6 sm:w-6 shrink-0" />
            <span className="truncate">{t("verifyStop")}</span>
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
          <div className="flex flex-col sm:flex-row gap-2">
            <button type="button" className="primary-button flex-1" onClick={() => setShowServerSettings(true)}>
              {t("openServerSettings")}
            </button>
            <button type="button" className="secondary-button flex-1" onClick={reset}>
              {t("verifyAgain")}
            </button>
          </div>
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
      {showServerSettings && (
        <ServerSettingsSheet
          onClose={() => setShowServerSettings(false)}
          onSaved={() => reset()}
        />
      )}
    </AppShell>
  );
}
