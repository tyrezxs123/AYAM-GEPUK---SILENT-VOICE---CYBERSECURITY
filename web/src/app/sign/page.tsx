"use client";

import { useEffect, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { ErrorBox, LevelMeter, Timer } from "@/components/Feedback";
import { CheckIcon, DownloadIcon, FileIcon, MicIcon, ShareIcon, StopIcon } from "@/components/Icons";
import { ServerSettingsSheet } from "@/components/Sheets";
import { registerKey, revokeKey } from "@/lib/api";
import { startRecording, type Recording } from "@/lib/audio";
import { getIdentity } from "@/lib/device-key";
import { makeTamperedCopy, signOnDevice } from "@/lib/provenance";
import { useI18n } from "@/lib/i18n";

type Phase = "register" | "idle" | "recording" | "signing" | "done" | "error";

const DEVICE_KEY = "suarasah.device";
const MAX_SECONDS = 60;

interface Device {
  userId: string;
  deviceKeyId: string;
  displayName: string;
  backend: string;
}

function loadDevice(): Device | null {
  try {
    const raw = window.localStorage.getItem(DEVICE_KEY);
    return raw ? (JSON.parse(raw) as Device) : null;
  } catch {
    return null;
  }
}

function saveDevice(device: Device): void {
  try {
    window.localStorage.setItem(DEVICE_KEY, JSON.stringify(device));
  } catch {
    /* private mode: the user will re-register next time */
  }
}

const EXPIRY_CHOICES = [
  { key: "expiry_2m", seconds: 120 },
  { key: "expiry_1d", seconds: 24 * 3600 },
  { key: "expiry_7d", seconds: 7 * 24 * 3600 },
  { key: "expiry_30d", seconds: 30 * 24 * 3600 },
] as const;

export default function SignPage() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("register");
  const [device, setDevice] = useState<Device | null>(null);
  const [name, setName] = useState("");
  const [context, setContext] = useState("");
  const [expiry, setExpiry] = useState<number>(7 * 24 * 3600);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [signed, setSigned] = useState<{ blob: Blob; url: string; filename: string } | null>(null);
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [tampered, setTampered] = useState<{ url: string; filename: string } | null>(null);

  const recording = useRef<Recording | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const existing = loadDevice();
    if (existing) {
      setDevice(existing);
      setName(existing.displayName);
      setPhase("idle");
    }
  }, []);

  useEffect(() => {
    return () => {
      if (signed) URL.revokeObjectURL(signed.url);
      void recording.current?.stop();
    };
  }, [signed]);

  async function register() {
    if (name.trim().length < 1) return;
    setError(null);
    try {
      const identity = await getIdentity();
      const res = await registerKey({
        display_name: name.trim(),
        public_key: identity.publicKeyHex,
        label: navigator.userAgent.slice(0, 50),
        user_id: loadDevice()?.userId,
      });
      const next: Device = {
        userId: res.user_id,
        deviceKeyId: res.device_key_id,
        displayName: res.display_name,
        backend: identity.backend,
      };
      saveDevice(next);
      setDevice(next);
      setPhase("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  async function sign(audio: Blob) {
    if (!device) return;
    setPhase("signing");
    setError(null);
    try {
      const identity = await getIdentity();
      // Signed fully on this phone: the WAV carries its own Ed25519 proof,
      // so the receiver can verify it with no server at all.
      const clip = await signOnDevice(audio, identity, {
        sender: device.displayName,
        context: context.trim(),
        expirySeconds: expiry,
      });
      const blob = clip.blob;
      const filename = `suarasah-${device.displayName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${clip.sessionId.slice(-6)}.wav`;
      setSigned({ blob, url: URL.createObjectURL(blob), filename });
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  async function startRecord() {
    setError(null);
    try {
      recording.current = await startRecording({
        maxSeconds: MAX_SECONDS,
        onTick: (s, l) => {
          setSeconds(s);
          setLevel(l);
          if (s >= MAX_SECONDS) void stopRecord();
        },
      });
      setPhase("recording");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  async function stopRecord() {
    const rec = recording.current;
    recording.current = null;
    if (!rec) return;
    const blob = await rec.stop();
    void sign(blob);
  }

  function onPickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    void sign(file);
  }

  async function revoke() {
    if (!device) return;
    if (!window.confirm(t("revokeConfirm"))) return;
    try {
      await revokeKey(device.deviceKeyId);
    } catch {
      /* ignore remote error */
    }
    window.localStorage.removeItem(DEVICE_KEY);
    setDevice(null);
    setName("");
    setPhase("register");
  }

  function reset() {
    setError(null);
    setSeconds(0);
    setSigned(null);
    setTampered(null);
    setPhase(device ? "idle" : "register");
    if (fileInput.current) fileInput.current.value = "";
  }

  async function createTampered() {
    if (!signed) return;
    try {
      const blob = await makeTamperedCopy(signed.blob);
      const filename = signed.filename.replace(/\.wav$/, "-edited.wav");
      const url = URL.createObjectURL(blob);
      setTampered({ url, filename });
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function share() {
    if (!signed) return;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        const file = new File([signed.blob], signed.filename, { type: "audio/wav" });
        await navigator.share({
          files: [file],
          title: signed.filename,
          text: t("signedHint"),
        });
        return;
      } catch {
        /* share dismissed or unsupported, fall back to download */
      }
    }
    const a = document.createElement("a");
    a.href = signed.url;
    a.download = signed.filename;
    a.click();
  }

  return (
    <AppShell title={t("signTitle")}>
      {phase === "register" && (
        <div className="space-y-4">
          <label className="block text-sm sm:text-base font-semibold text-ink dark:text-slate-100" htmlFor="display-name">
            {t("signName")}
          </label>
          <input
            id="display-name"
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("signNamePlaceholder")}
            autoComplete="name"
            maxLength={60}
          />
          <p className="text-xs sm:text-sm text-ink/60 dark:text-slate-400">{t("signNameHint")}</p>
          <button
            type="button"
            className="primary-button"
            disabled={name.trim().length === 0}
            onClick={register}
          >
            {t("signRegister")}
          </button>
        </div>
      )}

      {phase === "idle" && device && (
        <div className="space-y-4 sm:space-y-5">
          <p className="flex items-center gap-2 text-sm sm:text-base text-verdict-green dark:text-emerald-400">
            <CheckIcon className="h-5 w-5 shrink-0" />
            <span className="truncate">
              {t("deviceReady")}: <strong>{device.displayName}</strong>
            </span>
          </p>

          <div>
            <label className="block text-sm sm:text-base font-semibold text-ink dark:text-slate-100" htmlFor="context">
              {t("signContext")}
            </label>
            <input
              id="context"
              className="field mt-1"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder={t("signContextPlaceholder")}
              maxLength={120}
            />
          </div>

          <div>
            <span className="block text-sm sm:text-base font-semibold text-ink dark:text-slate-100">{t("signExpiry")}</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {EXPIRY_CHOICES.map((choice) => (
                <button
                  key={choice.key}
                  type="button"
                  onClick={() => setExpiry(choice.seconds)}
                  className={`chip border-2 transition ${
                    expiry === choice.seconds
                      ? "border-brand bg-brand text-white dark:border-blue-500 dark:bg-blue-600"
                      : "border-ink/15 dark:border-white/15 bg-white dark:bg-[#161c28] text-ink dark:text-slate-200"
                  }`}
                >
                  {t(choice.key as "expiry_7d")}
                </button>
              ))}
            </div>
          </div>

          <button type="button" className="primary-button" onClick={startRecord}>
            <MicIcon className="h-5 w-5 sm:h-6 sm:w-6 shrink-0" />
            <span>{t("signRecord")}</span>
          </button>

          <button type="button" className="secondary-button" onClick={() => fileInput.current?.click()}>
            <FileIcon className="h-5 w-5 sm:h-6 sm:w-6 shrink-0" />
            <span>{t("signUpload")}</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*,.wav,.mp3,.m4a"
            className="hidden"
            onChange={onPickFile}
          />

          <button
            type="button"
            className="w-full text-center text-xs sm:text-sm text-ink/50 dark:text-slate-400 hover:text-verdict-red dark:hover:text-rose-400 pt-2 transition"
            onClick={revoke}
          >
            {t("revokeDevice")}
          </button>
        </div>
      )}

      {phase === "recording" && (
        <div className="space-y-5 sm:space-y-6">
          <Timer seconds={seconds} max={MAX_SECONDS} />
          <LevelMeter level={level} />
          <button type="button" className="primary-button" onClick={stopRecord}>
            <StopIcon className="h-5 w-5 sm:h-6 sm:w-6 shrink-0" />
            <span>{t("signRecordStop")}</span>
          </button>
        </div>
      )}

      {phase === "signing" && (
        <p className="py-10 text-center text-lg sm:text-xl font-semibold text-ink/70 dark:text-slate-300">
          {t("signing")}
        </p>
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
            <button type="button" className="secondary-button flex-1" onClick={reset}>
              {t("back")}
            </button>
          </div>
        </div>
      )}

      {phase === "done" && signed && (
        <div className="space-y-4">
          <div className="card border-verdict-green dark:border-emerald-500/50 bg-verdict-greenbg dark:bg-emerald-950/40">
            <p className="flex items-center gap-2 text-lg sm:text-xl font-bold text-verdict-green dark:text-emerald-400">
              <CheckIcon className="h-6 w-6 sm:h-7 sm:w-7 shrink-0" />
              <span>{t("signed")}</span>
            </p>
            <p className="mt-2 text-sm sm:text-base text-ink/80 dark:text-slate-200">{t("signedHint")}</p>
          </div>

          <audio className="w-full" controls src={signed.url} />

          <button type="button" className="primary-button" onClick={share}>
            <ShareIcon className="h-5 w-5 sm:h-6 sm:w-6 shrink-0" />
            <span>{t("shareWhatsapp")}</span>
          </button>

          <a className="secondary-button" href={signed.url} download={signed.filename}>
            <DownloadIcon className="h-5 w-5 sm:h-6 sm:w-6 shrink-0" />
            <span>{t("download")}</span>
          </a>

          <button type="button" className="secondary-button" onClick={reset}>
            {t("signAnother")}
          </button>

          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 dark:bg-rose-950/20 p-3 sm:p-4 space-y-2">
            <p className="text-xs sm:text-sm font-bold text-rose-700 dark:text-rose-300">✂️ {t("tamperDemoTitle")}</p>
            <p className="text-xs text-ink/70 dark:text-slate-300 leading-relaxed">{t("tamperDemoBody")}</p>
            {tampered ? (
              <a className="secondary-button" href={tampered.url} download={tampered.filename}>
                <DownloadIcon className="h-5 w-5 shrink-0" />
                <span className="truncate">{tampered.filename}</span>
              </a>
            ) : (
              <button type="button" className="secondary-button" onClick={createTampered}>
                <span>{t("tamperDemoButton")}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {showServerSettings && (
        <ServerSettingsSheet
          onClose={() => setShowServerSettings(false)}
          onSaved={() => reset()}
        />
      )}
    </AppShell>
  );
}
