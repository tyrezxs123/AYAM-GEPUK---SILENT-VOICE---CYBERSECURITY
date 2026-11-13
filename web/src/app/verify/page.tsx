"use client";

import { useEffect, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { ErrorBox, LevelMeter, Stepper, Timer } from "@/components/Feedback";
import { FileIcon, MicIcon, StopIcon } from "@/components/Icons";
import { ReportSheet, ServerSettingsSheet } from "@/components/Sheets";
import { VerdictCard } from "@/components/VerdictCard";
import { apiBase, verifyAudio } from "@/lib/api";
import { startRecording, type Recording } from "@/lib/audio";
import { SCENARIO_PRESETS, type ScenarioType, verifyAudioClientSide } from "@/lib/client-scanner";
import { useI18n } from "@/lib/i18n";
import { verifyOnDevice } from "@/lib/provenance";
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

    // 1. Signed clip? Verify its embedded Ed25519 signature right here on the phone.
    try {
      const [signedOut] = await Promise.all([
        verifyOnDevice(blob),
        new Promise((r) => setTimeout(r, 1400)), // let the stepper show its stages
      ]);
      if (signedOut) {
        setResult(signedOut);
        setPhase("done");
        if (signedOut.colour === "red" && "vibrate" in navigator) navigator.vibrate?.([120, 60, 120]);
        return;
      }
    } catch (err) {
      console.warn("On-device signature check failed:", err);
    }

    const base = apiBase();
    if (base) {
      try {
        const out = await verifyAudio(blob, {
          filename,
          source,
          transcript: text || undefined,
        });
        setResult(out);
        setPhase("done");
        if (out.colour === "red" && "vibrate" in navigator) navigator.vibrate?.([120, 60, 120]);
        return;
      } catch (err) {
        console.warn("Backend verify failed, falling back to client screening:", err);
      }
    }

    // Direct, instant client-side verification on Netlify / offline
    try {
      await new Promise((r) => setTimeout(r, 600));
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

  function runScenarioTest(type: ScenarioType) {
    const preset = SCENARIO_PRESETS[type];
    if (!preset) return;
    setResult(preset.result);
    setPhase("done");
    if (preset.result.colour === "red" && "vibrate" in navigator) {
      navigator.vibrate?.([120, 60, 120]);
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

          <div className="mt-5 rounded-2xl border border-ink/10 dark:border-white/10 bg-white dark:bg-[#161c28] p-3 sm:p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs sm:text-sm text-ink dark:text-slate-100 flex items-center gap-1.5">
                <span>⚡</span>
                <span>{lang === "ms" ? "Uji Senario Suara (Semua Kes)" : "Quick Scenario Tests (All Cases)"}</span>
              </span>
              <span className="text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full bg-brand-soft text-brand-dark dark:bg-blue-950/60 dark:text-blue-300">
                {lang === "ms" ? "Demo Pantas" : "Fast Demo"}
              </span>
            </div>
            <p className="text-xs text-ink/70 dark:text-slate-300 leading-relaxed">
              {lang === "ms"
                ? "Ketik senario di bawah untuk melihat penilaian keselamatan, corak risiko, dan tindakan yang disyorkan:"
                : "Tap any scenario below to evaluate voice safety, risk pattern, and recommended actions:"}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => runScenarioTest("ai_voice")}
                className="text-left rounded-xl border border-rose-500/30 bg-rose-500/10 dark:bg-rose-950/30 p-2.5 transition hover:bg-rose-500/20 active:scale-[0.99]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-rose-700 dark:text-rose-300">🤖 {lang === "ms" ? "Klon Suara AI" : "AI Voice Clone"}</span>
                  <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-rose-500 text-white">High Risk</span>
                </div>
                <p className="text-[11px] text-ink/70 dark:text-slate-300 mt-1 line-clamp-1">{SCENARIO_PRESETS.ai_voice[lang === "ms" ? "description_bm" : "description_en"]}</p>
              </button>

              <button
                type="button"
                onClick={() => runScenarioTest("human_voice")}
                className="text-left rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/50 p-2.5 transition hover:bg-slate-200/60 active:scale-[0.99]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-slate-700 dark:text-slate-300">👤 {lang === "ms" ? "Suara Manusia Asli" : "Natural Human Voice"}</span>
                  <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-slate-500 text-white">Low Risk</span>
                </div>
                <p className="text-[11px] text-ink/70 dark:text-slate-300 mt-1 line-clamp-1">{SCENARIO_PRESETS.human_voice[lang === "ms" ? "description_bm" : "description_en"]}</p>
              </button>

              <button
                type="button"
                onClick={() => runScenarioTest("scam_urgency")}
                className="text-left rounded-xl border border-rose-500/30 bg-rose-500/10 dark:bg-rose-950/30 p-2.5 transition hover:bg-rose-500/20 active:scale-[0.99]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-rose-700 dark:text-rose-300">🚨 {lang === "ms" ? "Scam Pindah Duit" : "Urgent Money Scam"}</span>
                  <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-rose-500 text-white">Red Alert</span>
                </div>
                <p className="text-[11px] text-ink/70 dark:text-slate-300 mt-1 line-clamp-1">{SCENARIO_PRESETS.scam_urgency[lang === "ms" ? "description_bm" : "description_en"]}</p>
              </button>

              <button
                type="button"
                onClick={() => runScenarioTest("verified")}
                className="text-left rounded-xl border border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-950/30 p-2.5 transition hover:bg-emerald-500/20 active:scale-[0.99]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-emerald-700 dark:text-emerald-300">✅ {lang === "ms" ? "Tandatangan Sah" : "Verified Audio"}</span>
                  <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-emerald-600 text-white">Verified</span>
                </div>
                <p className="text-[11px] text-ink/70 dark:text-slate-300 mt-1 line-clamp-1">{SCENARIO_PRESETS.verified[lang === "ms" ? "description_bm" : "description_en"]}</p>
              </button>

              <button
                type="button"
                onClick={() => runScenarioTest("tampered")}
                className="text-left rounded-xl border border-rose-500/30 bg-rose-500/10 dark:bg-rose-950/30 p-2.5 transition hover:bg-rose-500/20 active:scale-[0.99]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-rose-700 dark:text-rose-300">✂️ {lang === "ms" ? "Audio Diubah" : "Tampered Clip"}</span>
                  <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-rose-600 text-white">Tampered</span>
                </div>
                <p className="text-[11px] text-ink/70 dark:text-slate-300 mt-1 line-clamp-1">{SCENARIO_PRESETS.tampered[lang === "ms" ? "description_bm" : "description_en"]}</p>
              </button>

              <button
                type="button"
                onClick={() => runScenarioTest("replayed")}
                className="text-left rounded-xl border border-amber-500/30 bg-amber-500/10 dark:bg-amber-950/30 p-2.5 transition hover:bg-amber-500/20 active:scale-[0.99]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-amber-700 dark:text-amber-300">🔄 {lang === "ms" ? "Rakaman Berulang" : "Replayed Call"}</span>
                  <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-amber-600 text-white">Replayed</span>
                </div>
                <p className="text-[11px] text-ink/70 dark:text-slate-300 mt-1 line-clamp-1">{SCENARIO_PRESETS.replayed[lang === "ms" ? "description_bm" : "description_en"]}</p>
              </button>

              <button
                type="button"
                onClick={() => runScenarioTest("expired")}
                className="text-left rounded-xl border border-amber-500/30 bg-amber-500/10 dark:bg-amber-950/30 p-2.5 transition hover:bg-amber-500/20 active:scale-[0.99] sm:col-span-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-amber-700 dark:text-amber-300">⏳ {lang === "ms" ? "Tamat Tempoh (Expired)" : "Expired Signature"}</span>
                  <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-amber-600 text-white">Expired</span>
                </div>
                <p className="text-[11px] text-ink/70 dark:text-slate-300 mt-1 line-clamp-1">{SCENARIO_PRESETS.expired[lang === "ms" ? "description_bm" : "description_en"]}</p>
              </button>
            </div>
          </div>
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

          <div className="rounded-2xl border border-ink/10 dark:border-white/10 bg-white dark:bg-[#161c28] p-3 sm:p-4 shadow-sm space-y-2.5">
            <p className="text-xs font-bold text-ink/70 dark:text-slate-300">
              ⚡ {lang === "ms" ? "Tukar & Uji Senario Lain:" : "Switch & Test Other Scenarios:"}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["ai_voice", "🤖 AI Clone"],
                  ["human_voice", "👤 Human"],
                  ["scam_urgency", "🚨 Scam Call"],
                  ["verified", "✅ Verified"],
                  ["tampered", "✂️ Tampered"],
                  ["replayed", "🔄 Replayed"],
                  ["expired", "⏳ Expired"],
                ] as const
              ).map(([scKey, scLabel]) => (
                <button
                  key={scKey}
                  type="button"
                  onClick={() => runScenarioTest(scKey)}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-ink/10 dark:border-white/10 bg-slate-50 dark:bg-slate-800 text-ink/80 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-95 transition"
                >
                  {scLabel}
                </button>
              ))}
            </div>
          </div>
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
