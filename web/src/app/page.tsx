"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { health } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { Engines } from "@/lib/types";
import { FileIcon, PenIcon, WaveIcon } from "@/components/Icons";

/** Home screen: three buttons, nothing else. Every task is <= 3 taps from here. */
export default function Home() {
  const { t, lang, toggle } = useI18n();
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
      tone: "border-brand bg-brand-soft text-brand-dark",
    },
    {
      href: "/live",
      label: t("homeLive"),
      sub: t("homeLiveSub"),
      icon: <WaveIcon className="h-8 w-8" />,
      tone: "border-verdict-orange bg-verdict-orangebg text-verdict-orange",
    },
    {
      href: "/sign",
      label: t("homeSign"),
      sub: t("homeSignSub"),
      icon: <PenIcon className="h-8 w-8" />,
      tone: "border-verdict-green bg-verdict-greenbg text-verdict-green",
    },
  ];

  return (
    <div className="min-h-dvh bg-white">
      <div className="screen pt-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-brand-dark">{t("appName")}</h1>
            <p className="mt-1 text-base text-ink/70">{t("tagline")}</p>
          </div>
          <button
            type="button"
            onClick={toggle}
            aria-label={t("langSwitch")}
            className="h-12 shrink-0 rounded-xl border-2 border-ink/15 px-3 text-sm font-bold uppercase text-ink/75 active:bg-ink/5"
          >
            {lang === "ms" ? "EN" : "BM"}
          </button>
        </div>

        <nav className="mt-7 space-y-4">
          {buttons.map((b) => (
            <Link key={b.href} href={b.href} className={`big-button ${b.tone}`}>
              <span className="shrink-0">{b.icon}</span>
              <span className="min-w-0">
                <span className="block text-xl font-bold leading-tight">{b.label}</span>
                <span className="block text-base leading-snug text-ink/65">{b.sub}</span>
              </span>
            </Link>
          ))}
        </nav>

        <p className="mt-8 rounded-xl bg-ink/5 p-4 text-base leading-snug text-ink/70">
          {t("homeFooter")}
        </p>

        <footer className="mt-6 space-y-1 text-xs text-ink/45">
          {offline && <p className="text-verdict-red">{t("offline")} {t("apiHint")}</p>}
          {engines && (
            <>
              <p>
                {t("engineLabel")}: {engines.watermark.engine}
              </p>
              <p>
                {engines.detector.engine}
                {!engines.detector.calibrated && ` · ${t("screeningOnly")}`}
              </p>
            </>
          )}
          <p>{t("privacyNote")}</p>
        </footer>
      </div>
    </div>
  );
}
