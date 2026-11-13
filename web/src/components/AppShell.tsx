"use client";

import Link from "next/link";

import { useI18n } from "@/lib/i18n";

import { ArrowLeftIcon } from "./Icons";
import { HeaderControls } from "./HeaderControls";

/**
 * Header for every screen: a back arrow, screen title, BM/ENG segmented picker,
 * Dark/Light toggle, and Server Status indicator.
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
    <div className="min-h-dvh bg-slate-50 dark:bg-[#0c1017] text-ink dark:text-slate-100 transition-colors duration-200 overflow-x-hidden w-full max-w-full">
      <header className="sticky top-0 z-20 border-b border-ink/10 dark:border-white/10 bg-white/95 dark:bg-[#0c1017]/95 backdrop-blur shadow-sm">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-1.5 px-3 py-2 sm:gap-2 sm:px-4 sm:py-2.5">
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-2 flex-1">
            {back ? (
              <Link
                href={back}
                aria-label={t("back")}
                className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-xl text-ink/75 dark:text-slate-300 active:bg-ink/5 dark:active:bg-white/5 transition"
              >
                <ArrowLeftIcon className="h-5 w-5 sm:h-6 sm:w-6" />
              </Link>
            ) : null}

            <h1 className="min-w-0 truncate text-base sm:text-lg font-bold text-ink dark:text-slate-100">
              {title ?? t("appName")}
            </h1>
          </div>

          <div className="shrink-0">
            <HeaderControls />
          </div>
        </div>
      </header>

      <main className="screen pt-4">{children}</main>
    </div>
  );
}
