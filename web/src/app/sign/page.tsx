"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { ErrorBox, LevelMeter, ScanWave, Timer } from "@/components/Feedback";
import { CheckIcon, DownloadIcon, KeyIcon, MicIcon, ScissorsIcon, ShareIcon, ShieldCheckIcon, StopIcon, UploadIcon } from "@/components/Icons";
import { MicError, startRecording, type Recording } from "@/lib/audio";
import { AUDIO_ACCEPT, DecodeError } from "@/lib/decode";
import { clearIdentity, getIdentity } from "@/lib/device-key";
import { setPendingClip } from "@/lib/handoff";
import { addHistory } from "@/lib/history";
import { useI18n } from "@/lib/i18n";
import { makeTamperedCopy, signOnDevice, type SignedClip } from "@/lib/provenance";

type Phase = "register" | "idle" | "recording" | "signing" | "done" | "error";

const DEVICE_KEY = "suarasah.device";
const MAX_SECONDS = 60;

interface Device {
  displayName: string;
  publicKey: string;
  backend: string;
}

function loadDevice(): Device | null {
  try {
    const raw = window.localStorage.getItem(DEVICE_KEY);
    const d = raw ? (JSON.parse(raw) as Partial<Device>) : null;
    return d && d.displayName ? { displayName: d.displayName, publicKey: d.publicKey ?? "", backend: d.backend ?? "" } : null;
  } catch {
    return null;
  }
}

const EXPIRY_CHOICES = [
  { key: "expiry_2m", seconds: 120 },
  { key: "expiry_1d", seconds: 24 * 3600 },
  { key: "expiry_7d", seconds: 7 * 24 * 3600 },
  { key: "expiry_30d", seconds: 30 * 24 * 3600 },
] as const;

const short = (hex: string) => (hex.length > 16 ? `${hex.slice(0, 8)}…${hex.slice(-6)}` : hex);

export default function SignPage() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("register");
  const [device, setDevice] = useState<Device | null>(null);
  const [name, setName] = useState("");
  const [context, setContext] = useState("");
  const [expiry, setExpiry] = useState<number>(7 * 24 * 3600);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [signed, setSigned] = useState<{ clip: SignedClip; url: string; filename: string } | null>(null);
  const [tampered, setTampered] = useState<{ blob: Blob; url: string; filename: string } | null>(null);

  const recording = useRef<Recording | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const existing = loadDevice();
    if (existing) {
      setDevice(existing);
      setName(existing.displayName);
      setPhase("idle");
    }
    return () => {
      void recording.current?.stop();
    };
  }, []);

  async function register() {
    if (name.trim().length < 1) return;
    setError(null);
    try {
      const identity = await getIdentity();
      const next: Device = { displayName: name.trim(), publicKey: identity.publicKeyHex, backend: identity.backend };
      try {
        window.localStorage.setItem(DEVICE_KEY, JSON.stringify(next));
      } catch {
        /* private mode: the user will re-register next time */
      }
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
      const [clip] = await Promise.all([
        signOnDevice(audio, identity, { sender: device.displayName, context: context.trim(), expirySeconds: expiry }),
        new Promise((r) => setTimeout(r, 900)),
      ]);
      const filename = `silentvoice-${device.displayName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${clip.sessionId.slice(-6)}.wav`;
      setSigned({ clip, url: URL.createObjectURL(clip.blob), filename });
      setTampered(null);
      addHistory({ kind: "sign", verdict: "SIGNED", colour: "green", label: device.displayName, duration_s: clip.durationS });
      setPhase("done");
    } catch (err) {
      setError(err instanceof DecodeError ? t(`err_${err.kind}` as "err_unsupported") : err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  async function startRecord() {
    setError(null);
    setSeconds(0);
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
      setError(err instanceof MicError && err.kind === "denied" ? t("micDenied") : t("micMissing"));
      setPhase("error");
    }
  }

  async function stopRecord() {
    const rec = recording.current;
    recording.current = null;
    if (!rec) return;
    void sign(await rec.stop());
  }

  async function revoke() {
    if (!window.confirm(t("revokeConfirm"))) return;
    window.localStorage.removeItem(DEVICE_KEY);
    await clearIdentity().catch(() => undefined);
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
    const blob = await makeTamperedCopy(signed.clip.blob);
    setTampered({ blob, url: URL.createObjectURL(blob), filename: signed.filename.replace(/\.wav$/, "-edited.wav") });
  }

  function checkNow(blob: Blob, filename: string) {
    setPendingClip(blob, filename);
    router.push("/verify");
  }

  async function share() {
    if (!signed) return;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        const file = new File([signed.clip.blob], signed.filename, { type: "audio/wav" });
        await navigator.share({ files: [file], title: signed.filename, text: t("signedHint") });
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
          <div className="panel animate-rise">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-verdict-green text-white dark:bg-emerald-600">
              <KeyIcon className="h-7 w-7" strokeWidth={2.2} />
            </span>
            <h2 className="mt-4 text-xl font-extrabold tracking-tight">{t("signIntroTitle")}</h2>
            <p className="mt-1.5 text-base leading-snug text-ink/65 dark:text-slate-400">{t("signIntroBody")}</p>
          </div>
          <div>
            <label className="block text-sm font-bold" htmlFor="display-name">
              {t("signName")}
            </label>
            <input
              id="display-name"
              className="field mt-1.5"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && register()}
              placeholder={t("signNamePlaceholder")}
              autoComplete="name"
              maxLength={60}
            />
            <p className="mt-1.5 text-sm text-ink/55 dark:text-slate-400">{t("signNameHint")}</p>
          </div>
          <button type="button" className="primary-button" disabled={name.trim().length === 0} onClick={register}>
            {t("signRegister")}
          </button>
        </div>
      )}

      {phase === "idle" && device && (
        <div className="space-y-4">
          <div className="panel flex animate-rise items-center gap-3.5 !p-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-verdict-green text-lg font-extrabold text-white dark:bg-emerald-600">
              {device.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-base font-extrabold">
                <span className="truncate">{device.displayName}</span>
                <CheckIcon className="h-4 w-4 shrink-0 text-verdict-green dark:text-emerald-400" strokeWidth={3} />
              </span>
              <span className="block truncate font-mono text-xs text-ink/50 dark:text-slate-400">
                {t("keyLabel")} {short(device.publicKey)}
              </span>
            </span>
            <button type="button" className="shrink-0 text-xs font-bold text-ink/45 hover:text-verdict-red dark:text-slate-500 dark:hover:text-rose-400" onClick={revoke}>
              {t("revokeShort")}
            </button>
          </div>

          <div>
            <label className="block text-sm font-bold" htmlFor="context">
              {t("signContext")}
            </label>
            <input id="context" className="field mt-1.5" value={context} onChange={(e) => setContext(e.target.value)} placeholder={t("signContextPlaceholder")} maxLength={120} />
          </div>

          <div>
            <span className="block text-sm font-bold">{t("signExpiry")}</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {EXPIRY_CHOICES.map((choice) => (
                <button
                  key={choice.key}
                  type="button"
                  onClick={() => setExpiry(choice.seconds)}
                  aria-pressed={expiry === choice.seconds}
                  className={`rounded-xl border px-3.5 py-2 text-sm font-bold transition active:scale-95 ${
                    expiry === choice.seconds
                      ? "border-brand bg-brand text-white dark:border-blue-500 dark:bg-blue-600"
                      : "border-ink/10 bg-surface text-ink dark:border-white/10 dark:bg-surface-dark dark:text-slate-200"
                  }`}
                >
                  {t(choice.key as "expiry_7d")}
                </button>
              ))}
            </div>
          </div>

          <button type="button" className="primary-button" onClick={startRecord}>
            <MicIcon className="h-5 w-5 shrink-0" />
            <span>{t("signRecord")}</span>
          </button>
          <button type="button" className="secondary-button" onClick={() => fileInput.current?.click()}>
            <UploadIcon className="h-5 w-5 shrink-0" />
            <span>{t("signUpload")}</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={AUDIO_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void sign(file);
            }}
          />
          <p className="text-center text-xs text-ink/45 dark:text-slate-500">{t("signFormats")}</p>
        </div>
      )}

      {phase === "recording" && (
        <div className="panel animate-rise space-y-6 !py-8 text-center">
          <p className="flex items-center justify-center gap-2 text-sm font-extrabold uppercase tracking-wider text-verdict-red dark:text-rose-400">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-verdict-red dark:bg-rose-400" />
            {t("recordingNow")}
          </p>
          <Timer seconds={seconds} max={MAX_SECONDS} />
          <LevelMeter level={level} />
          <button type="button" className="primary-button" onClick={stopRecord}>
            <StopIcon className="h-5 w-5 shrink-0" />
            <span>{t("signRecordStop")}</span>
          </button>
        </div>
      )}

      {phase === "signing" && (
        <div className="panel animate-rise text-center">
          <ScanWave />
          <p className="mt-5 text-lg font-extrabold">{t("signing")}</p>
          <p className="mt-1 text-sm text-ink/55 dark:text-slate-400">{t("signingHint")}</p>
        </div>
      )}

      {phase === "error" && error && (
        <div className="space-y-4">
          <ErrorBox message={error} hint={t("errHint")} />
          <button type="button" className="primary-button" onClick={reset}>
            {t("back")}
          </button>
        </div>
      )}

      {phase === "done" && signed && (
        <div className="space-y-3.5">
          <section className="card animate-rise border-verdict-green/25 bg-verdict-greenbg dark:border-emerald-500/30 dark:bg-emerald-500/10">
            <div className="flex items-center gap-3.5">
              <span className="flex h-14 w-14 shrink-0 animate-pop items-center justify-center rounded-2xl bg-verdict-green text-white dark:bg-emerald-500">
                <CheckIcon className="h-8 w-8" strokeWidth={3} />
              </span>
              <div className="min-w-0">
                <p className="text-2xl font-extrabold leading-tight tracking-tight text-verdict-green dark:text-emerald-400">{t("signed")}</p>
                <p className="text-sm text-ink/70 dark:text-slate-300">{t("signedHint")}</p>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
              {[
                [`${signed.clip.durationS}s`, t("factDuration")],
                [String(signed.clip.segments), t("factSegments")],
                [
                  new Date(signed.clip.expiresAt * 1000).toLocaleString(lang === "ms" ? "ms-MY" : "en-MY", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }),
                  t("factValidUntil"),
                ],
              ].map(([v, l]) => (
                <div key={l} className="rounded-2xl bg-white/60 px-2 py-2.5 dark:bg-white/[0.07]">
                  <dd className="truncate text-sm font-extrabold">{v}</dd>
                  <dt className="mt-0.5 text-[11px] font-semibold text-ink/55 dark:text-slate-400">{l}</dt>
                </div>
              ))}
            </dl>
            <p className="mt-3 truncate font-mono text-[11px] text-ink/50 dark:text-slate-400">Ed25519 · {short(signed.clip.signatureHex)}</p>
          </section>

          <audio className="w-full" controls src={signed.url} />

          <button type="button" className="primary-button" onClick={share}>
            <ShareIcon className="h-5 w-5 shrink-0" />
            <span>{t("shareWhatsapp")}</span>
          </button>
          <div className="grid grid-cols-2 gap-2.5">
            <a className="secondary-button" href={signed.url} download={signed.filename}>
              <DownloadIcon className="h-5 w-5 shrink-0" />
              <span className="truncate">{t("download")}</span>
            </a>
            <button type="button" className="secondary-button" onClick={() => checkNow(signed.clip.blob, signed.filename)}>
              <ShieldCheckIcon className="h-5 w-5 shrink-0" />
              <span className="truncate">{t("verifyNow")}</span>
            </button>
          </div>

          <section className="panel">
            <p className="flex items-center gap-2 text-sm font-extrabold">
              <ScissorsIcon className="h-4 w-4 text-verdict-red dark:text-rose-400" strokeWidth={2} />
              {t("tamperDemoTitle")}
            </p>
            <p className="mt-1 text-sm leading-snug text-ink/60 dark:text-slate-400">{t("tamperDemoBody")}</p>
            {tampered ? (
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <a className="secondary-button !min-h-0 !py-3 text-sm" href={tampered.url} download={tampered.filename}>
                  <DownloadIcon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t("download")}</span>
                </a>
                <button type="button" className="secondary-button !min-h-0 !py-3 text-sm" onClick={() => checkNow(tampered.blob, tampered.filename)}>
                  <ShieldCheckIcon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t("verifyNow")}</span>
                </button>
              </div>
            ) : (
              <button type="button" className="secondary-button mt-3 !min-h-0 !py-3 text-sm" onClick={createTampered}>
                {t("tamperDemoButton")}
              </button>
            )}
            {tampered && <audio className="mt-3 w-full" controls src={tampered.url} />}
          </section>

          <button type="button" className="secondary-button" onClick={reset}>
            {t("signAnother")}
          </button>
        </div>
      )}
    </AppShell>
  );
}
