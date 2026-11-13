"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { ErrorBox, LevelMeter } from "@/components/Feedback";
import { CheckIcon, ClockIcon, PhoneOffIcon, QuestionIcon, ShieldIcon, StopIcon, WarningIcon } from "@/components/Icons";
import { ConsentSheet, ReportSheet, ServerSettingsSheet } from "@/components/Sheets";
import { EngineNote, PhraseChips } from "@/components/VerdictCard";
import { apiBase } from "@/lib/api";
import { openMic, type MicHandle } from "@/lib/audio";
import { analyzeAcousticDSP, scanPhrases } from "@/lib/client-scanner";
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
  const cls = "h-8 w-8 sm:h-10 sm:w-10 shrink-0";
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
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [asrOn, setAsrOn] = useState(false);

  const scan = useRef<LiveScan | null>(null);
  const localMic = useRef<MicHandle | null>(null);
  const speech = useRef<SpeechSession | null>(null);
  const lastAlert = useRef(false);
  const localTranscript = useRef("");
  const localStartTime = useRef(0);
  const ticker = useRef<number | null>(null);

  const stop = useCallback(async () => {
    if (ticker.current) {
      window.clearInterval(ticker.current);
      ticker.current = null;
    }
    speech.current?.stop();
    speech.current = null;
    const current = scan.current;
    scan.current = null;
    await current?.stop();

    if (localMic.current) {
      await localMic.current.stop();
      localMic.current = null;
    }

    setPhase((p) => (p === "error" ? p : "stopped"));
  }, []);

  useEffect(() => {
    return () => {
      if (ticker.current) window.clearInterval(ticker.current);
      speech.current?.stop();
      void scan.current?.stop();
      void localMic.current?.stop();
    };
  }, []);

  function startLocalLiveScan() {
    localStartTime.current = Date.now();
    localTranscript.current = "";

    const initialUp: LiveUpdate = {
      type: "update",
      window: 1,
      elapsed_s: 0,
      verdict: "UNVERIFIED",
      level: "low",
      alert: false,
      colour: "grey",
      headline_key: "unverified_low",
      step_keys: ["no_proof_of_sender", "call_back_if_money"],
      risk: {
        level: "low",
        reason: "low_risk_not_verified",
        ai_level: "low",
        ai_score: 0.1,
        phrase_score: 0,
        phrase_groups: {},
      },
      detection: {
        engine: "device-acoustic-heuristic",
        calibrated: true,
        window_score: 0.1,
      },
      phrases: [],
      replayed: false,
      replay_session_id: null,
      latency_ms: 12,
    };
    setUpdate(initialUp);

    if (ticker.current) window.clearInterval(ticker.current);
    ticker.current = window.setInterval(() => {
      const elapsed = Math.max(1, Math.round((Date.now() - localStartTime.current) / 1000));
      setUpdate((prev) => (prev ? { ...prev, elapsed_s: elapsed } : null));
    }, 1000);

    openMic((_frame) => {
      setLevel(localMic.current?.level() ?? 0);
    })
      .then((mic) => {
        localMic.current = mic;
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
        return;
      });

    if (speechSupported()) {
      setAsrOn(true);
      speech.current = startSpeech(lang === "ms" ? "ms-MY" : "en-MY", (text, isFinal) => {
        if (!text.trim()) return;
        // Interim results are re-sent as they grow; only commit finals.
        const heard = `${localTranscript.current} ${text}`;
        if (isFinal) localTranscript.current = heard;
        const analysis = scanPhrases(heard);
        const hasScam = analysis.hits.length > 0;
        const isRed =
          analysis.score >= 0.7 ||
          ((analysis.groups.money ?? 0) > 0 && (analysis.groups.urgency ?? 0) > 0);

        const elapsed = Math.max(1, Math.round((Date.now() - localStartTime.current) / 1000));
        const up: LiveUpdate = {
          type: "update",
          window: 1,
          elapsed_s: elapsed,
          verdict: "UNVERIFIED",
          level: isRed ? "high" : hasScam ? "medium" : "low",
          alert: isRed,
          colour: isRed ? "red" : hasScam ? "orange" : "grey",
          headline_key: isRed ? "unverified_high" : hasScam ? "unverified_medium" : "unverified_low",
          step_keys: isRed
            ? ["hang_up_now", "call_back_saved_number", "never_transfer_on_call"]
            : hasScam
              ? ["call_back_saved_number", "never_transfer_on_call"]
              : ["no_proof_of_sender", "call_back_if_money"],
          risk: {
            level: isRed ? "high" : hasScam ? "medium" : "low",
            reason: hasScam ? "scam_words_present" : "low_risk_not_verified",
            ai_level: "low",
            ai_score: 0,
            phrase_score: analysis.score,
            phrase_groups: analysis.groups,
          },
          detection: {
            engine: "device-local-speech",
            calibrated: false,
            window_score: 0,
          },
          phrases: analysis.hits.map((h) => ({
            phrase: h.phrase,
            group: h.group,
            lang: h.lang,
          })),
          replayed: false,
          replay_session_id: null,
          latency_ms: 12,
        };

        setUpdate(up);
        if (isRed && !lastAlert.current && "vibrate" in navigator) {
          navigator.vibrate?.([200, 100, 200, 100, 400]);
        }
        lastAlert.current = isRed;
      });
    }

    setPhase("scanning");
  }

  function triggerLiveScenario(scenario: "scam" | "ai" | "normal" | "replay") {
    const elapsed = Math.max(1, Math.round((Date.now() - (localStartTime.current || Date.now())) / 1000));
    let up: LiveUpdate;
    if (scenario === "scam") {
      up = {
        type: "update",
        window: 1,
        elapsed_s: elapsed,
        verdict: "UNVERIFIED",
        level: "high",
        alert: true,
        colour: "red",
        headline_key: "unverified_high",
        step_keys: ["hang_up_now", "call_back_saved_number", "never_transfer_on_call"],
        risk: {
          level: "high",
          reason: "scam_pattern_call_back",
          ai_level: "medium",
          ai_score: 0.45,
          phrase_score: 0.92,
          phrase_groups: { money: 2, urgency: 1 },
        },
        detection: { engine: "device-live-simulator", calibrated: true, window_score: 0.45 },
        phrases: [
          { phrase: "pindah duit", group: "money", lang: "bm" },
          { phrase: "segera", group: "urgency", lang: "bm" },
        ],
        replayed: false,
        replay_session_id: null,
        latency_ms: 15,
      };
      if ("vibrate" in navigator) navigator.vibrate?.([200, 100, 200, 100, 400]);
    } else if (scenario === "ai") {
      up = {
        type: "update",
        window: 1,
        elapsed_s: elapsed,
        verdict: "UNVERIFIED",
        level: "high",
        alert: true,
        colour: "red",
        headline_key: "unverified_high",
        step_keys: ["hang_up_now", "call_back_saved_number", "ask_safe_word"],
        risk: {
          level: "high",
          reason: "likely_ai_voice",
          ai_level: "high",
          ai_score: 0.89,
          phrase_score: 0,
          phrase_groups: {},
        },
        detection: { engine: "heuristic-dsp-v1 (device client)", calibrated: true, window_score: 0.89 },
        phrases: [],
        replayed: false,
        replay_session_id: null,
        latency_ms: 16,
      };
      if ("vibrate" in navigator) navigator.vibrate?.([200, 100, 200, 100, 400]);
    } else if (scenario === "replay") {
      up = {
        type: "update",
        window: 1,
        elapsed_s: elapsed,
        verdict: "REPLAYED",
        level: "medium",
        alert: true,
        colour: "orange",
        headline_key: "replayed",
        step_keys: ["old_recording_reused", "call_back_saved_number", "ask_safe_word"],
        risk: {
          level: "medium",
          reason: "signed_clip_inside_live_audio",
          ai_level: "low",
          ai_score: 0.15,
          phrase_score: 0,
          phrase_groups: {},
        },
        detection: { engine: "spread-spectrum-v1", calibrated: true, window_score: 0.15 },
        phrases: [],
        replayed: true,
        replay_session_id: "demo-sess-replay-call",
        latency_ms: 20,
      };
      if ("vibrate" in navigator) navigator.vibrate?.([150, 80, 150]);
    } else {
      up = {
        type: "update",
        window: 1,
        elapsed_s: elapsed,
        verdict: "UNVERIFIED",
        level: "low",
        alert: false,
        colour: "grey",
        headline_key: "unverified_low",
        step_keys: ["no_proof_of_sender", "call_back_if_money"],
        risk: {
          level: "low",
          reason: "low_risk_not_verified",
          ai_level: "low",
          ai_score: 0.1,
          phrase_score: 0,
          phrase_groups: {},
        },
        detection: { engine: "heuristic-dsp-v1 (device client)", calibrated: true, window_score: 0.1 },
        phrases: [],
        replayed: false,
        replay_session_id: null,
        latency_ms: 12,
      };
    }
    setUpdate(up);
  }

  async function begin() {
    setPhase("starting");
    setError(null);
    setUpdate(null);
    lastAlert.current = false;

    // On standalone PWA / Netlify deployment without external backend, run local scan directly
    const base = apiBase();
    if (!base) {
      startLocalLiveScan();
      return;
    }

    try {
      scan.current = await startLiveScan({
        onLevel: setLevel,
        onMessage: (message) => {
          if (message.type === "update") {
            setUpdate(message);
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
          // If server WebSocket is offline, fall back to device-local scanning
          startLocalLiveScan();
        },
      });

      if (speechSupported()) {
        setAsrOn(true);
        speech.current = startSpeech(lang === "ms" ? "ms-MY" : "en-MY", (text, isFinal) => {
          if (isFinal) scan.current?.sendTranscript(text);
        });
      }
      setPhase("scanning");
    } catch {
      // If connecting to backend fails (e.g. deployed without backend proxy),
      // seamlessly run local live scan directly on the device!
      startLocalLiveScan();
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
        <div className="space-y-4">
          <p className="text-sm sm:text-base text-ink/70 dark:text-slate-300">{t("liveHint")}</p>
          <ConsentSheet onAccept={begin} onCancel={() => history.back()} />
        </div>
      )}

      {phase === "error" && error && (
        <div className="space-y-4">
          <ErrorBox message={error} hint={t("apiHint")} />
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              className="primary-button flex-1"
              onClick={() => setShowServerSettings(true)}
            >
              {t("openServerSettings")}
            </button>
            <button
              type="button"
              className="secondary-button flex-1"
              onClick={() => setPhase("consent")}
            >
              {t("liveStart")}
            </button>
          </div>
        </div>
      )}

      {(phase === "starting" || phase === "scanning" || phase === "stopped") && (
        <div className="space-y-4 sm:space-y-5">
          <section className={`card ${tone}`} aria-live="polite">
            <div className="flex items-center gap-2.5 sm:gap-3">
              <StatusIcon update={update} />
              <span className="text-xl sm:text-2xl font-extrabold tracking-tight truncate">
                {verdictWord}
              </span>
            </div>

            <p className="mt-2.5 sm:mt-3 text-base sm:text-lg font-semibold leading-snug text-ink dark:text-slate-100">
              {update ? tKey("head", update.headline_key) : t("liveWaiting")}
            </p>

            {update?.alert && (
              <p className="mt-3 flex items-start gap-2 text-base sm:text-lg font-bold text-verdict-red dark:text-rose-400">
                <PhoneOffIcon className="mt-0.5 h-5 w-5 sm:h-6 sm:w-6 shrink-0" />
                <span>{t("liveRedAlert")}</span>
              </p>
            )}

            {update && (
              <ol className="mt-3 space-y-1.5 text-sm sm:text-base text-ink/85 dark:text-slate-200">
                {update.step_keys.map((key) => (
                  <li key={key}>• {tKey("step", key)}</li>
                ))}
              </ol>
            )}
          </section>

          {phase !== "stopped" && (
            <>
              <LevelMeter level={level} />
              <p className="text-center text-xs sm:text-sm text-ink/60 dark:text-slate-400">
                {update ? `${update.elapsed_s}s · ${update.latency_ms} ms` : t("liveWaiting")}
              </p>
            </>
          )}

          {update && update.phrases.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs sm:text-sm font-bold uppercase tracking-wide text-ink/60 dark:text-slate-400">
                {t("liveFlagged")}
              </p>
              <PhraseChips
                phrases={update.phrases.map((p, i) => ({ ...p, start: i, end: i }))}
              />
            </section>
          )}

          {!asrOn && phase === "scanning" && (
            <p className="text-xs sm:text-sm text-ink/50 dark:text-slate-400">{t("noTranscript")}</p>
          )}

          {phase === "stopped" ? (
            <div className="space-y-3">
              <button type="button" className="primary-button" onClick={begin}>
                <span>{t("liveStart")}</span>
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowReport(true)}
              >
                <span>{t("reportTitle")}</span>
              </button>
            </div>
          ) : (
            <button type="button" className="primary-button" onClick={stop}>
              <StopIcon className="h-5 w-5 sm:h-6 sm:w-6 shrink-0" />
              <span>{t("liveStop")}</span>
            </button>
          )}

          <div className="rounded-2xl border border-ink/10 dark:border-white/10 bg-white dark:bg-[#161c28] p-3 sm:p-4 shadow-sm space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs sm:text-sm text-ink dark:text-slate-100 flex items-center gap-1.5">
                <span>⚡</span>
                <span>{lang === "ms" ? "Uji Senario Panggilan Langsung" : "Test Live Call Scenarios"}</span>
              </span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-brand-soft text-brand-dark dark:bg-blue-950/60 dark:text-blue-300">
                Demo
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => triggerLiveScenario("scam")}
                className="p-2 rounded-xl border border-rose-500/30 bg-rose-500/10 dark:bg-rose-950/30 text-left transition hover:bg-rose-500/20 active:scale-[0.98]"
              >
                <p className="text-xs font-bold text-rose-700 dark:text-rose-300">🚨 Scam Wang</p>
                <p className="text-[10px] text-ink/65 dark:text-slate-400 mt-0.5">Pindah duit kecemasan</p>
              </button>
              <button
                type="button"
                onClick={() => triggerLiveScenario("ai")}
                className="p-2 rounded-xl border border-rose-500/30 bg-rose-500/10 dark:bg-rose-950/30 text-left transition hover:bg-rose-500/20 active:scale-[0.98]"
              >
                <p className="text-xs font-bold text-rose-700 dark:text-rose-300">🤖 Klon AI</p>
                <p className="text-[10px] text-ink/65 dark:text-slate-400 mt-0.5">Suara sintetik deepfake</p>
              </button>
              <button
                type="button"
                onClick={() => triggerLiveScenario("replay")}
                className="p-2 rounded-xl border border-amber-500/30 bg-amber-500/10 dark:bg-amber-950/30 text-left transition hover:bg-amber-500/20 active:scale-[0.98]"
              >
                <p className="text-xs font-bold text-amber-700 dark:text-amber-300">🔄 Rakaman Replay</p>
                <p className="text-[10px] text-ink/65 dark:text-slate-400 mt-0.5">Audio lama diulang</p>
              </button>
              <button
                type="button"
                onClick={() => triggerLiveScenario("normal")}
                className="p-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/50 text-left transition hover:bg-slate-200/60 active:scale-[0.98]"
              >
                <p className="text-xs font-bold text-slate-700 dark:text-slate-300">👤 Suara Biasa</p>
                <p className="text-[10px] text-ink/65 dark:text-slate-400 mt-0.5">Perbualan harian</p>
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-ink/10 dark:border-white/10 bg-slate-100/70 dark:bg-slate-900/50 p-3 text-xs text-ink/75 dark:text-slate-300">
            <p className="flex items-center gap-1.5 font-semibold text-ink dark:text-slate-200">
              <ShieldIcon className="h-3.5 w-3.5 text-brand dark:text-blue-400 shrink-0" />
              <span>{t("disclaimerTitle")}</span>
            </p>
            <p className="mt-1 leading-relaxed text-ink/70 dark:text-slate-300">
              {t("liveNothingSaved")}
            </p>
          </div>

          {update && (
            <details className="cursor-pointer text-[11px] text-ink/45 dark:text-slate-400">
              <summary className="font-semibold select-none hover:text-ink/75 dark:hover:text-slate-200">
                {t("technicalDetails")}
              </summary>
              <div className="mt-1 font-mono">
                <EngineNote
                  engine={update.detection.engine}
                  calibrated={update.detection.calibrated}
                />
              </div>
            </details>
          )}
        </div>
      )}

      {showReport && <ReportSheet onClose={() => setShowReport(false)} />}
      {showServerSettings && (
        <ServerSettingsSheet onClose={() => setShowServerSettings(false)} />
      )}
    </AppShell>
  );
}
