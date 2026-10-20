"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { health } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { Engines } from "@/lib/types";
import { HeaderControls } from "@/components/HeaderControls";
import { FileIcon, PenIcon, ShieldIcon, WaveIcon } from "@/components/Icons";

/** Home screen: three buttons, nothing else. Every task is <= 3 taps from here. */
export default function Home() {
  const { t } = useI18n();
  const [engines, setEngines] = useState<Engines | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    health()
      .then((h) => setEngines(h.engines))
      .catch(() => setOffline(true));
  }, []);

  const buttons = [
    {
      href: "/verify",
      label: t("homeVerify"),
      sub: t("homeVerifySub"),
      icon: <FileIcon className="h-8 w-8" />,
      tone: "border-brand bg-brand-soft text-brand-dark dark:border-blue-500/40 dark:bg-blue-950/40 dark:text-blue-300",
    },
    {
      href: "/live",
      label: t("homeLive"),
      sub: t("homeLiveSub"),
      icon: <WaveIcon className="h-8 w-8" />,
      tone: "border-verdict-orange bg-verdict-orangebg text-verdict-orange dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-300",
    },
    {
      href: "/sign",
      label: t("homeSign"),
      sub: t("homeSignSub"),
      icon: <PenIcon className="h-8 w-8" />,
      tone: "border-verdict-green bg-verdict-greenbg text-verdict-green dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-300",
    },
  ];

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-[#0c1017] text-ink dark:text-slate-100 transition-colors duration-200">
      <div className="screen pt-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-brand-dark dark:text-blue-400">
              {t("appName")}
            </h1>
            <p className="mt-1 text-base text-ink/70 dark:text-slate-300">{t("tagline")}</p>
          </div>
          <HeaderControls />
        </div>

        <nav className="mt-7 space-y-4">
          {buttons.map((b) => (
            <Link key={b.href} href={b.href} className={`big-button ${b.tone}`}>
              <span className="shrink-0">{b.icon}</span>
              <span className="min-w-0">
                <span className="block text-xl font-bold leading-tight">{b.label}</span>
                <span className="block text-base leading-snug text-ink/70 dark:text-slate-300">
                  {b.sub}
                </span>
              </span>
            </Link>
          ))}
        </nav>

        <p className="mt-8 rounded-2xl border border-ink/10 dark:border-white/10 bg-white dark:bg-[#161c28] p-4 text-base leading-snug text-ink/75 dark:text-slate-300 shadow-xs">
          {t("homeFooter")}
        </p>

        <footer className="mt-8 space-y-3">
          {offline && (
            <p className="rounded-xl border border-verdict-red/30 bg-verdict-redbg dark:bg-rose-950/40 p-3 text-sm text-verdict-red dark:text-rose-400 text-center font-semibold">
              ⚠️ {t("offline")} {t("apiHint")}
            </p>
          )}

          <div className="rounded-2xl border border-ink/10 dark:border-white/10 bg-slate-100/80 dark:bg-slate-900/60 p-4 text-xs text-ink/75 dark:text-slate-300 shadow-xs">
            <div className="flex items-center gap-2 font-semibold text-ink dark:text-slate-200">
              <ShieldIcon className="h-4 w-4 text-brand dark:text-blue-400 shrink-0" />
              <span>{t("disclaimerTitle")}</span>
            </div>
            <p className="mt-1.5 leading-relaxed text-ink/70 dark:text-slate-300">{t("disclaimerBody")}</p>

            {engines && (
              <details className="mt-2.5 pt-2 border-t border-ink/10 dark:border-white/10 cursor-pointer">
                <summary className="text-[11px] font-semibold text-ink/50 dark:text-slate-400 hover:text-ink/80 dark:hover:text-slate-200 select-none">
                  {t("technicalDetails")}
                </summary>
                <div className="mt-1 space-y-0.5 text-[11px] text-ink/50 dark:text-slate-400 font-mono">
                  <p>{t("engineLabel")}: {engines.watermark.engine}</p>
                  <p>{engines.detector.engine}{!engines.detector.calibrated && ` · ${t("screeningOnly")}`}</p>
                </div>
              </details>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
