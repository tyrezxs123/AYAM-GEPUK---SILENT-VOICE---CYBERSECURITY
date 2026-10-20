"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { type Lang, type StringKey, t as translate, tKey as translateKey } from "./strings";

const STORAGE_KEY = "suarasah.lang";

interface I18n {
  lang: Lang;
  setLang(lang: Lang): void;
  toggle(): void;
  t(key: StringKey): string;
  tKey(prefix: string, key: string | undefined): string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Bahasa Melayu is the default (PRD F6), not the browser locale.
  const [lang, setLangState] = useState<Lang>("ms");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "ms" || saved === "en") setLangState(saved);
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === "ms" ? "ms-MY" : "en-MY";
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode */
    }
  }, []);

  const value = useMemo<I18n>(
    () => ({
      lang,
      setLang,
      toggle: () => setLang(lang === "ms" ? "en" : "ms"),
      t: (key) => translate(lang, key),
      tKey: (prefix, key) => translateKey(lang, prefix, key),
    }),
    [lang, setLang],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
