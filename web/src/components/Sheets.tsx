"use client";

import { useState } from "react";

import { apiBase, getSavedApiBase, health, reportNumber, setSavedApiBase } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { ServerIcon } from "./Icons";

/** Bottom sheet shell: thumb-reachable on a phone, dismissible by backdrop tap. */
function Sheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        className="absolute inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-xs"
        onClick={onClose}
      />
      <div className="relative w-full rounded-t-3xl border-t border-ink/10 dark:border-white/10 bg-white dark:bg-[#161c28] p-5 pb-8 shadow-2xl text-ink dark:text-slate-100 animate-rise">
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-ink/15 dark:bg-white/20" />
        {children}
      </div>
    </div>
  );
}

/**
 * PDPA-aligned consent before Live Scan (PRD Section 10). It also carries the
 * practical warning about recording the other party, which is an open legal
 * question in the PRD - so we tell the user rather than claim compliance.
 */
export function ConsentSheet({ onAccept, onCancel }: { onAccept: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet onClose={onCancel}>
      <h2 className="text-xl font-bold text-ink dark:text-slate-100">{t("consentTitle")}</h2>
      <p className="mt-3 text-base leading-relaxed text-ink/80 dark:text-slate-300">{t("consentBody")}</p>
      <div className="mt-5 space-y-3">
        <button type="button" className="primary-button" onClick={onAccept}>
          {t("consentAgree")}
        </button>
        <button type="button" className="secondary-button" onClick={onCancel}>
          {t("consentCancel")}
        </button>
      </div>
    </Sheet>
  );
}

const SEMAK_MULE = "https://semakmule.rmp.gov.my/";

export function ReportSheet({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [number, setNumber] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function send() {
    if (number.trim().length < 6) return;
    setState("sending");
    try {
      await reportNumber(number.trim());
      setState("done");
    } catch {
      setState("error");
    }
  }

  return (
    <Sheet onClose={onClose}>
      <h2 className="text-xl font-bold text-ink dark:text-slate-100">{t("reportTitle")}</h2>

      {state === "done" ? (
        <p className="mt-3 text-base text-verdict-green dark:text-emerald-400">{t("reportThanks")}</p>
      ) : (
        <>
          <label className="mt-4 block text-sm font-semibold text-ink/75 dark:text-slate-300" htmlFor="report-number">
            {t("reportNumber")}
          </label>
          <input
            id="report-number"
            className="field mt-1"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="012-345 6789"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
          <button
            type="button"
            className="primary-button mt-4"
            disabled={state === "sending" || number.trim().length < 6}
            onClick={send}
          >
            {t("reportSend")}
          </button>
          {state === "error" && <p className="mt-2 text-base text-verdict-red dark:text-rose-400">{t("offline")}</p>}
        </>
      )}

      <a
        href={SEMAK_MULE}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-4 block text-center text-base font-semibold text-brand dark:text-blue-400 hover:underline"
      >
        {t("semakMule")}
      </a>
    </Sheet>
  );
}

export function ServerSettingsSheet({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState(() => getSavedApiBase() ?? apiBase());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function testConnection(targetUrl: string) {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await health(targetUrl);
      if (res.ok) {
        setTestResult({ ok: true, message: t("serverConnected") });
      } else {
        setTestResult({ ok: false, message: t("serverFailed") });
      }
    } catch (err) {
      setTestResult({
        ok: false,
        message: `${t("serverFailed")}: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setTesting(false);
    }
  }

  function save() {
    setSavedApiBase(url.trim());
    onSaved?.();
    onClose();
  }

  function reset() {
    setSavedApiBase(null);
    setUrl(apiBase());
    setTestResult(null);
    onSaved?.();
    onClose();
  }

  return (
    <Sheet onClose={onClose}>
      <div className="flex items-center gap-2.5">
        <ServerIcon className="h-6 w-6 text-brand dark:text-blue-400" />
        <h2 className="text-xl font-bold text-ink dark:text-slate-100">{t("serverSettingsTitle")}</h2>
      </div>

      <p className="mt-2 text-sm text-ink/70 dark:text-slate-300">
        {t("serverSettingsHint")}
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label className="block text-sm font-semibold text-ink/80 dark:text-slate-200" htmlFor="server-url">
            {t("serverUrlLabel")}
          </label>
          <input
            id="server-url"
            type="url"
            className="field mt-1 w-full text-sm font-mono"
            placeholder={t("serverUrlPlaceholder")}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setTestResult(null);
            }}
          />
        </div>

        {/* Quick helpers */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          <button
            type="button"
            className="rounded-lg border border-ink/15 dark:border-white/15 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-xs font-semibold text-ink/75 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
            onClick={() => {
              const lan = `http://${typeof window !== "undefined" ? window.location.hostname : "127.0.0.1"}:8000`;
              setUrl(lan);
              void testConnection(lan);
            }}
          >
            LAN :8000
          </button>
          <button
            type="button"
            className="rounded-lg border border-ink/15 dark:border-white/15 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-xs font-semibold text-ink/75 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
            onClick={() => {
              setUrl("http://127.0.0.1:8000");
              void testConnection("http://127.0.0.1:8000");
            }}
          >
            127.0.0.1:8000
          </button>
        </div>

        {/* Test Connection Button & Status */}
        <div className="pt-2">
          <button
            type="button"
            className="secondary-button !min-h-[2.75rem] !py-2 text-sm"
            disabled={testing || !url.trim()}
            onClick={() => testConnection(url.trim())}
          >
            {testing ? t("serverTesting") : t("serverTestBtn")}
          </button>

          {testResult && (
            <p
              className={`mt-2 rounded-xl p-2.5 text-xs font-semibold ${
                testResult.ok
                  ? "bg-verdict-greenbg text-verdict-green dark:bg-emerald-950/40 dark:text-emerald-400 border border-verdict-green/30"
                  : "bg-verdict-redbg text-verdict-red dark:bg-rose-950/40 dark:text-rose-400 border border-verdict-red/30"
              }`}
            >
              {testResult.ok ? "✓ " : "⚠️ "}
              {testResult.message}
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 pt-3">
          <button type="button" className="primary-button !min-h-[2.75rem] !py-2.5 text-sm flex-1" onClick={save}>
            {t("serverSaveBtn")}
          </button>
          <button
            type="button"
            className="secondary-button !min-h-[2.75rem] !py-2.5 text-sm shrink-0 px-4"
            onClick={reset}
          >
            {t("serverResetBtn")}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
