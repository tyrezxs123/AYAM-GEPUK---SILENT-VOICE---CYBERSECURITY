"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { explicitApiBase, health, reportNumber, setSavedApiBase } from "@/lib/api";
import { asrModel, asrSupported, warmUpAsr } from "@/lib/asr";
import { clearHistory, listHistory } from "@/lib/history";
import { useI18n } from "@/lib/i18n";
import { listTrusted, untrust, type TrustedSender } from "@/lib/trusted";

import { CheckIcon, CrossIcon, TrashIcon } from "./Icons";

/**
 * Bottom sheet shell: thumb-reachable on a phone, dismissible by backdrop tap.
 * Rendered into <body> through a portal: an ancestor with backdrop-filter (the
 * sticky header) would otherwise become the containing block for `fixed` and
 * push the sheet off-screen.
 */
function Sheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <button type="button" aria-hidden tabIndex={-1} className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className="relative max-h-[88dvh] w-full max-w-md animate-sheet overflow-y-auto rounded-t-[28px] bg-surface p-5 text-ink shadow-2xl dark:bg-surface-dark dark:text-slate-100"
        style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto mb-4 h-1.5 w-11 rounded-full bg-ink/15 dark:bg-white/20" />
        {children}
      </div>
    </div>,
    document.body,
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
      <h2 className="text-xl font-extrabold tracking-tight">{t("consentTitle")}</h2>
      <p className="mt-3 text-base leading-relaxed text-ink/75 dark:text-slate-300">{t("consentBody")}</p>
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
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");

  async function send() {
    if (number.trim().length < 6) return;
    setState("sending");
    await reportNumber(number.trim());
    setState("done");
  }

  return (
    <Sheet onClose={onClose}>
      <h2 className="text-xl font-extrabold tracking-tight">{t("reportTitle")}</h2>

      {state === "done" ? (
        <p className="mt-4 flex items-start gap-2 rounded-2xl bg-verdict-greenbg p-4 text-base font-semibold text-verdict-green dark:bg-emerald-500/10 dark:text-emerald-400">
          <CheckIcon className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{t("reportThanks")}</span>
        </p>
      ) : (
        <>
          <label className="mt-4 block text-sm font-bold text-ink/70 dark:text-slate-300" htmlFor="report-number">
            {t("reportNumber")}
          </label>
          <input
            id="report-number"
            className="field mt-1.5"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="012-345 6789"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
          <button type="button" className="primary-button mt-4" disabled={state === "sending" || number.trim().length < 6} onClick={send}>
            {t("reportSend")}
          </button>
        </>
      )}

      <a
        href={SEMAK_MULE}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-4 block text-center text-base font-bold text-brand hover:underline dark:text-blue-400"
      >
        {t("semakMule")} ↗
      </a>
    </Sheet>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <span className="min-w-0 text-base font-semibold">{label}</span>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Settings: what is stored on this phone, the speech model, and the optional server. */
export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [trusted, setTrusted] = useState<TrustedSender[]>([]);
  const [historyCount, setHistoryCount] = useState(0);
  const [model, setModel] = useState<{ state: "idle" | "loading" | "ready" | "failed"; pct: number }>({ state: "idle", pct: 0 });
  const [url, setUrl] = useState("");
  const [test, setTest] = useState<"idle" | "testing" | "ok" | "fail">("idle");

  useEffect(() => {
    setTrusted(listTrusted());
    setHistoryCount(listHistory().length);
    setUrl(explicitApiBase() ?? "");
  }, []);

  async function loadModel() {
    setModel({ state: "loading", pct: 0 });
    const ok = await warmUpAsr((p) => setModel({ state: "loading", pct: p.total ? p.loaded / p.total : 0 }));
    setModel({ state: ok ? "ready" : "failed", pct: 1 });
  }

  async function testServer() {
    setTest("testing");
    const res = await health(url.trim());
    setTest(res.ok ? "ok" : "fail");
  }

  return (
    <Sheet onClose={onClose}>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-extrabold tracking-tight">{t("settings")}</h2>
        <button type="button" className="icon-button" aria-label={t("close")} onClick={onClose}>
          <CrossIcon className="h-5 w-5" />
        </button>
      </div>

      <section className="mt-4">
        <p className="eyebrow">{t("settingsTrusted")}</p>
        {trusted.length === 0 ? (
          <p className="mt-2 text-sm text-ink/55 dark:text-slate-400">{t("settingsTrustedEmpty")}</p>
        ) : (
          <ul className="mt-1 divide-y divide-ink/[0.07] dark:divide-white/10">
            {trusted.map((s) => (
              <li key={s.name} className="flex items-center justify-between gap-3 py-2.5">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-verdict-greenbg text-sm font-extrabold text-verdict-green dark:bg-emerald-500/15 dark:text-emerald-400">
                    {s.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="truncate text-base font-semibold">{s.name}</span>
                </span>
                <button
                  type="button"
                  className="icon-button text-verdict-red dark:text-rose-400"
                  aria-label={t("remove")}
                  onClick={() => {
                    untrust(s.name);
                    setTrusted(listTrusted());
                  }}
                >
                  <TrashIcon className="h-5 w-5" strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-5 divide-y divide-ink/[0.07] border-y border-ink/[0.07] dark:divide-white/10 dark:border-white/10">
        <Row label={`${t("settingsHistory")} (${historyCount})`}>
          <button
            type="button"
            disabled={historyCount === 0}
            className="rounded-xl bg-ink/[0.06] px-3.5 py-2 text-sm font-bold disabled:opacity-40 dark:bg-white/10"
            onClick={() => {
              clearHistory();
              setHistoryCount(0);
            }}
          >
            {t("settingsClear")}
          </button>
        </Row>

        {asrSupported() && (
          <div className="py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-semibold">{t("settingsModel")}</p>
                <p className="mt-0.5 text-xs text-ink/55 dark:text-slate-400">{t("settingsModelHint")}</p>
              </div>
              <button
                type="button"
                disabled={model.state === "loading" || model.state === "ready"}
                className="shrink-0 rounded-xl bg-ink/[0.06] px-3.5 py-2 text-sm font-bold disabled:opacity-60 dark:bg-white/10"
                onClick={loadModel}
              >
                {model.state === "ready"
                  ? `✓ ${t("settingsModelReady")}`
                  : model.state === "loading"
                    ? `${Math.round(model.pct * 100)}%`
                    : model.state === "failed"
                      ? t("retry")
                      : t("settingsModelLoad")}
              </button>
            </div>
            {model.state === "loading" && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10 dark:bg-white/10">
                <div className="h-full rounded-full bg-brand transition-all dark:bg-blue-400" style={{ width: `${Math.max(4, model.pct * 100)}%` }} />
              </div>
            )}
            <p className="mt-1.5 font-mono text-[11px] text-ink/40 dark:text-slate-500">{asrModel()}</p>
          </div>
        )}
      </section>

      <details className="mt-4">
        <summary className="cursor-pointer select-none text-sm font-bold text-ink/60 dark:text-slate-400">{t("settingsAdvanced")}</summary>
        <p className="mt-2 text-sm text-ink/60 dark:text-slate-400">{t("serverSettingsHint")}</p>
        <input
          type="url"
          className="field mt-2 font-mono text-sm"
          placeholder={t("serverUrlPlaceholder")}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setTest("idle");
          }}
        />
        <div className="mt-2 flex gap-2">
          <button type="button" className="secondary-button !min-h-0 flex-1 !py-2.5 text-sm" disabled={!url.trim() || test === "testing"} onClick={testServer}>
            {test === "testing" ? t("serverTesting") : test === "ok" ? `✓ ${t("serverConnected")}` : test === "fail" ? t("serverFailed") : t("serverTestBtn")}
          </button>
          <button
            type="button"
            className="primary-button !min-h-0 flex-1 !py-2.5 text-sm !shadow-none"
            onClick={() => {
              setSavedApiBase(url.trim() || null);
              onClose();
            }}
          >
            {t("serverSaveBtn")}
          </button>
        </div>
      </details>

      <p className="mt-5 text-center text-xs text-ink/40 dark:text-slate-500">{t("settingsAbout")}</p>
    </Sheet>
  );
}
