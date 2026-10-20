"use client";

import Link from "next/link";

import { useI18n } from "@/lib/i18n";

import { ArrowLeftIcon } from "./Icons";
import { HeaderControls } from "./HeaderControls";

/**
 * Header for every screen: a back arrow, BM/ENG segmented picker, and Dark/Light toggle.
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
  const { t } = useI18n();

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-[#0c1017] text-ink dark:text-slate-100 transition-colors duration-200">
      <header className="sticky top-0 z-20 border-b border-ink/10 dark:border-white/10 bg-white/95 dark:bg-[#0c1017]/95 backdrop-blur shadow-xs">
        <div className="mx-auto flex w-full max-w-md items-center gap-2 px-3 py-2.5">
          {back ? (
            <Link
              href={back}
              aria-label={t("back")}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink/75 dark:text-slate-300 active:bg-ink/5 dark:active:bg-white/5 transition"
            >
              <ArrowLeftIcon />
            </Link>
          ) : (
            <span className="h-11 w-1" />
          )}

          <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-ink dark:text-slate-100">
            {title ?? t("appName")}
          </h1>

          <HeaderControls />
        </div>
      </header>

      <main className="screen pt-4">{children}</main>
    </div>
  );
}
