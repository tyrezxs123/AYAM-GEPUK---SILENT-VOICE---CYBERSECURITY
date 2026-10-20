"use client";

import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { MoonIcon, SunIcon } from "./Icons";

export function LangSwitch({ className = "" }: { className?: string }) {
  const { lang, setLang, t } = useI18n();

  return (
    <div
      role="group"
      aria-label={t("langSwitch")}
      className={`inline-flex items-center rounded-xl border-2 border-ink/15 dark:border-white/15 bg-slate-100 dark:bg-slate-850 p-1 ${className}`}
    >
      <button
        type="button"
        onClick={() => setLang("ms")}
        aria-pressed={lang === "ms"}
        className={`rounded-lg px-2.5 py-1.5 text-xs font-bold uppercase tracking-wider transition-all duration-150 ${
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
        className={`rounded-lg px-2.5 py-1.5 text-xs font-bold uppercase tracking-wider transition-all duration-150 ${
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
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 border-ink/15 dark:border-white/15 bg-white dark:bg-slate-800 text-ink/80 dark:text-slate-200 shadow-sm transition hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-95 ${className}`}
    >
      {resolvedTheme === "dark" ? (
        <SunIcon className="h-5 w-5 text-amber-400 animate-rise" />
      ) : (
        <MoonIcon className="h-5 w-5 text-slate-700 animate-rise" />
      )}
    </button>
  );
}

export function HeaderControls({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <LangSwitch />
      <ThemeSwitch />
    </div>
  );
}
