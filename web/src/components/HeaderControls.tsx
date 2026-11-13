"use client";

import { useState } from "react";

import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

import { GearIcon, MoonIcon, SunIcon } from "./Icons";
import { SettingsSheet } from "./Sheets";

export function LangSwitch({ className = "" }: { className?: string }) {
  const { lang, setLang, t } = useI18n();

  return (
    <div
      role="group"
      aria-label={t("langSwitch")}
      className={`inline-flex items-center rounded-xl bg-ink/[0.06] p-0.5 dark:bg-white/10 ${className}`}
    >
      {(["ms", "en"] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          className={`rounded-[10px] px-2.5 py-1.5 text-xs font-extrabold tracking-wide transition-all duration-150 ${
            lang === code
              ? "bg-surface text-brand shadow-sm dark:bg-slate-700 dark:text-white"
              : "text-ink/55 hover:text-ink dark:text-slate-400 dark:hover:text-slate-100"
          }`}
        >
          {code === "ms" ? t("langBM") : t("langEN")}
        </button>
      ))}
    </div>
  );
}

export function ThemeSwitch() {
  const { resolvedTheme, toggleTheme } = useTheme();
  const { t } = useI18n();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={t("themeToggle")}
      title={resolvedTheme === "dark" ? t("themeLight") : t("themeDark")}
      className="icon-button"
    >
      {resolvedTheme === "dark" ? <SunIcon className="h-5 w-5 text-amber-400" /> : <MoonIcon className="h-5 w-5" />}
    </button>
  );
}

export function HeaderControls() {
  const { t } = useI18n();
  const [showSettings, setShowSettings] = useState(false);

  return (
    <>
      <div className="flex shrink-0 items-center gap-0.5">
        <LangSwitch className="mr-1" />
        <ThemeSwitch />
        <button type="button" className="icon-button" aria-label={t("settings")} onClick={() => setShowSettings(true)}>
          <GearIcon className="h-5 w-5" strokeWidth={2} />
        </button>
      </div>
      {showSettings && <SettingsSheet onClose={() => setShowSettings(false)} />}
    </>
  );
}
