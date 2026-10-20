"use client";

import Link from "next/link";

import { useI18n } from "@/lib/i18n";

import { ArrowLeftIcon } from "./Icons";

/**
 * Header for every screen: a back arrow and the BM/EN toggle.
 * The toggle is on every screen by requirement (PRD F6), not just the home page.
 */
export function AppShell({
  title,
  back = "/",
  children,
}: {
  title?: string;
  back?: string | null;
  children: React.ReactNode;
}) {
  const { t, lang, toggle } = useI18n();

  return (
    <div className="min-h-dvh bg-white">
      <header className="sticky top-0 z-20 border-b border-ink/10 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-md items-center gap-2 px-3 py-2">
          {back ? (
            <Link
              href={back}
              aria-label={t("back")}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-ink/70 active:bg-ink/5"
            >
              <ArrowLeftIcon />
            </Link>
          ) : (
            <span className="h-12 w-2" />
          )}

          <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{title ?? t("appName")}</h1>

          <button
            type="button"
            onClick={toggle}
            aria-label={t("langSwitch")}
            className="h-12 shrink-0 rounded-xl border-2 border-ink/15 px-3 text-sm font-bold uppercase tracking-wide text-ink/75 active:bg-ink/5"
          >
            {lang === "ms" ? "EN" : "BM"}
          </button>
        </div>
      </header>

      <main className="screen pt-4">{children}</main>
    </div>
  );
}
