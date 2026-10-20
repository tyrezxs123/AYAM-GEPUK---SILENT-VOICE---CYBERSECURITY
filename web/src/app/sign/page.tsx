"use client";

import { useEffect, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { ErrorBox, LevelMeter, Timer } from "@/components/Feedback";
import { CheckIcon, DownloadIcon, FileIcon, MicIcon, ShareIcon, StopIcon } from "@/components/Icons";
import { createSession, prepareSession, registerKey, revokeKey, signSession } from "@/lib/api";
import { startRecording, type Recording } from "@/lib/audio";
import { getIdentity, sameBytes, signingPayload } from "@/lib/device-key";
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
      // Creates the Ed25519 pair on first use. The private key never leaves
      // this device - only the public key is sent.
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
      const session = await createSession({
        device_key_id: device.deviceKeyId,
        context: context.trim(),
        expiry_seconds: expiry,
      });
      const prepared = await prepareSession(session.session_id, audio);

      // Rebuild the payload locally and refuse to sign anything else: the
      // backend must not be able to steer this key at audio it did not show us.
      const payload = signingPayload({
        sessionId: session.session_id,
        nonceHex: session.nonce,
        issuedAt: session.issued_at,
        expiresAt: session.expires_at,
        context: session.context,
        fingerprintRoot: prepared.fingerprint_root,
      });
      const fromServer = new Uint8Array(
        prepared.payload_hex.match(/.{2}/g)?.map((b) => parseInt(b, 16)) ?? [],
      );
      if (!sameBytes(payload, fromServer)) {
        throw new Error("Signing payload mismatch — refused to sign.");
      }

      const signature = await identity.sign(payload);
      const blob = await signSession(session.session_id, signature);
      const filename = `suarasah-${device.displayName.replace(/\s+/g, "-").toLowerCase()}.wav`;
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

  async function share() {
    if (!signed) return;
    const file = new File([signed.blob], signed.filename, { type: "audio/wav" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "SuaraSah" });
        return;
      } catch {
        /* user dismissed the share sheet */
      }
    }
    // Fall back to a plain download when Web Share cannot take files.
    const a = document.createElement("a");
    a.href = signed.url;
    a.download = signed.filename;
    a.click();
  }

  async function revoke() {
    if (!device || !window.confirm(t("revokeConfirm"))) return;
    try {
      await revokeKey(device.deviceKeyId);
      window.localStorage.removeItem(DEVICE_KEY);
      setDevice(null);
      setPhase("register");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  function reset() {
    if (signed) URL.revokeObjectURL(signed.url);
    setSigned(null);
    setSeconds(0);
    setError(null);
    setPhase("idle");
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <AppShell title={t("signTitle")}>
      {phase === "register" && (
        <div className="space-y-4">
          <label className="block text-base font-semibold text-ink dark:text-slate-100" htmlFor="display-name">
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
          <p className="text-sm text-ink/60 dark:text-slate-400">{t("signNameHint")}</p>
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
        <div className="space-y-5">
          <p className="flex items-center gap-2 text-base text-verdict-green dark:text-emerald-400">
            <CheckIcon className="h-5 w-5" />
            {t("deviceReady")}: <strong>{device.displayName}</strong>
          </p>

          <div>
            <label className="block text-base font-semibold text-ink dark:text-slate-100" htmlFor="context">
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

          <fieldset>
            <legend className="text-base font-semibold text-ink dark:text-slate-100">{t("signExpiry")}</legend>
            <div className="mt-2 flex gap-2">
              {EXPIRY_CHOICES.map((choice) => (
                <button
                  key={choice.key}
                  type="button"
                  onClick={() => setExpiry(choice.seconds)}
                  className={`flex-1 rounded-xl border-2 px-2 py-3 text-base font-semibold transition ${
                    expiry === choice.seconds
                      ? "border-brand bg-brand-soft text-brand-dark dark:border-blue-400 dark:bg-blue-950/60 dark:text-blue-300"
                      : "border-ink/15 dark:border-white/15 text-ink/70 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  }`}
                >
                  {t(choice.key)}
                </button>
              ))}
            </div>
          </fieldset>

          <button type="button" className="primary-button" onClick={startRecord}>
            <MicIcon className="h-6 w-6" />
            {t("signRecord")}
          </button>
          <p className="text-center text-sm text-ink/55 dark:text-slate-400">{t("maxSeconds")}</p>

          <button type="button" className="secondary-button" onClick={() => fileInput.current?.click()}>
            <FileIcon className="h-6 w-6" />
            {t("signUpload")}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.ogg,.opus,.flac"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void sign(file);
            }}
          />

          <button type="button" className="mt-2 text-sm text-verdict-red dark:text-rose-400 underline" onClick={revoke}>
            {t("revokeDevice")}
          </button>
        </div>
      )}

      {phase === "recording" && (
        <div className="space-y-6">
          <Timer seconds={seconds} max={MAX_SECONDS} />
          <LevelMeter level={level} />
          <button type="button" className="primary-button" onClick={stopRecord}>
            <StopIcon className="h-6 w-6" />
            {t("signRecordStop")}
          </button>
        </div>
      )}

      {phase === "signing" && (
        <p className="py-10 text-center text-xl font-semibold text-ink/70 dark:text-slate-300">{t("signing")}</p>
      )}

      {phase === "error" && error && (
        <div className="space-y-4">
          <ErrorBox message={error} hint={t("apiHint")} />
          <button type="button" className="secondary-button" onClick={reset}>
            {t("back")}
          </button>
        </div>
      )}

      {phase === "done" && signed && (
        <div className="space-y-4">
          <div className="card border-verdict-green dark:border-emerald-500/50 bg-verdict-greenbg dark:bg-emerald-950/40">
            <p className="flex items-center gap-2 text-xl font-bold text-verdict-green dark:text-emerald-400">
              <CheckIcon className="h-7 w-7" />
              {t("signed")}
            </p>
            <p className="mt-2 text-base text-ink/80 dark:text-slate-200">{t("signedHint")}</p>
          </div>

          <audio className="w-full" controls src={signed.url} />

          <button type="button" className="primary-button" onClick={share}>
            <ShareIcon className="h-6 w-6" />
            {t("shareWhatsapp")}
          </button>

          <a className="secondary-button" href={signed.url} download={signed.filename}>
            <DownloadIcon className="h-6 w-6" />
            {t("download")}
          </a>

          <button type="button" className="secondary-button" onClick={reset}>
            {t("signAnother")}
          </button>
        </div>
      )}
    </AppShell>
  );
}
