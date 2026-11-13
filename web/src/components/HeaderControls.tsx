"use client";

import { useEffect, useState } from "react";

import { health } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { MoonIcon, ServerIcon, SunIcon } from "./Icons";
import { ServerSettingsSheet } from "./Sheets";

export function LangSwitch({ className = "" }: { className?: string }) {
  const { lang, setLang, t } = useI18n();

  return (
    <div
      role="group"
      aria-label={t("langSwitch")}
      className={`inline-flex items-center rounded-xl border border-ink/15 dark:border-white/15 bg-slate-100 dark:bg-slate-800 p-0.5 sm:p-1 ${className}`}
    >
      <button
        type="button"
        onClick={() => setLang("ms")}
        aria-pressed={lang === "ms"}
        className={`rounded-lg px-2 py-1 sm:px-2.5 sm:py-1.5 text-[11px] sm:text-xs font-bold uppercase tracking-wider transition-all duration-150 ${
          lang === "ms"
            ? "bg-brand text-white shadow-sm dark:bg-blue-600"
            : "text-ink/65 dark:text-slate-400 hover:text-ink dark:hover:text-slate-100"
        }`}
      >
        {t("langBM")}
      </button>
      <button
        type="button"
        onClick={() => setLang("en")}
        aria-pressed={lang === "en"}
        className={`rounded-lg px-2 py-1 sm:px-2.5 sm:py-1.5 text-[11px] sm:text-xs font-bold uppercase tracking-wider transition-all duration-150 ${
          lang === "en"
            ? "bg-brand text-white shadow-sm dark:bg-blue-600"
            : "text-ink/65 dark:text-slate-400 hover:text-ink dark:hover:text-slate-100"
        }`}
      >
        {t("langEN")}
      </button>
    </div>
  );
}

export function ThemeSwitch({ className = "" }: { className?: string }) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const { t } = useI18n();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={t("themeToggle")}
      title={resolvedTheme === "dark" ? t("themeLight") : t("themeDark")}
      className={`flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-xl border border-ink/15 dark:border-white/15 bg-white dark:bg-slate-800 text-ink/80 dark:text-slate-200 shadow-sm transition hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-95 ${className}`}
    >
      {resolvedTheme === "dark" ? (
        <SunIcon className="h-4 w-4 sm:h-5 sm:w-5 text-amber-400 animate-rise" />
      ) : (
        <MoonIcon className="h-4 w-4 sm:h-5 sm:w-5 text-slate-700 animate-rise" />
      )}
    </button>
  );
}

export function ServerButton({
  className = "",
  onClick,
}: {
  className?: string;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    health()
      .then((h) => {
        if (mounted) setOnline(h.ok);
      })
      .catch(() => {
        if (mounted) setOnline(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("serverSettings")}
      title={online ? t("serverStatusConnected") : t("serverStatusOffline")}
      className={`relative flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-xl border border-ink/15 dark:border-white/15 bg-white dark:bg-slate-800 text-ink/80 dark:text-slate-200 shadow-sm transition hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-95 ${className}`}
    >
      <ServerIcon className="h-4 w-4 sm:h-5 sm:w-5 text-ink/70 dark:text-slate-300" />
      <span
        className={`absolute -top-1 -right-1 h-3 w-3 rounded-full border-2 border-white dark:border-[#0c1017] ${
          online === true
            ? "bg-emerald-500"
            : online === false
              ? "bg-amber-500 animate-pulse"
              : "bg-slate-400"
        }`}
      />
    </button>
  );
}

export function HeaderControls({ className = "" }: { className?: string }) {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <>
      <div className={`flex items-center gap-1.5 sm:gap-2 ${className}`}>
        <LangSwitch />
        <ThemeSwitch />
        <ServerButton onClick={() => setShowSettings(true)} />
      </div>

      {showSettings && (
        <ServerSettingsSheet
          onClose={() => setShowSettings(false)}
          onSaved={() => {
            // refresh page to apply new server base
            if (typeof window !== "undefined") window.location.reload();
          }}
        />
      )}
    </>
  );
}
