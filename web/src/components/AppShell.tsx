"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useI18n } from "@/lib/i18n";

import { HeaderControls } from "./HeaderControls";
import { ArrowLeftIcon, HomeIcon, LogoMark, PenIcon, ShieldCheckIcon, WaveIcon } from "./Icons";

const TABS = [
  { href: "/", key: "navHome", Icon: HomeIcon },
  { href: "/verify", key: "navVerify", Icon: ShieldCheckIcon },
  { href: "/live", key: "navLive", Icon: WaveIcon },
  { href: "/sign", key: "navSign", Icon: PenIcon },
] as const;

/**
 * The frame every screen sits in: a top bar (brand on Home, back + title
 * elsewhere), the page, and a thumb-reachable tab bar. Every task is at most
 * three taps from Home, and the tab bar keeps the other two one tap away.
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
  const pathname = usePathname() ?? "/";
  const current = pathname.replace(/\/$/, "") || "/";

  return (
    <div className="min-h-dvh w-full max-w-full overflow-x-hidden bg-canvas text-ink transition-colors duration-200 dark:bg-canvas-dark dark:text-slate-100">
      <header className="sticky top-0 z-30 border-b border-ink/[0.06] bg-canvas/85 backdrop-blur-lg dark:border-white/[0.07] dark:bg-canvas-dark/85">
        <div className="mx-auto flex h-14 w-full max-w-md items-center justify-between gap-2 px-3">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {title ? (
              <>
                {back ? (
                  <Link href={back} aria-label={t("back")} className="icon-button -ml-1">
                    <ArrowLeftIcon className="h-5 w-5" />
                  </Link>
                ) : null}
                <h1 className="min-w-0 truncate text-lg font-extrabold tracking-tight">{title}</h1>
              </>
            ) : (
              <Link href="/" className="flex min-w-0 items-center gap-2 pl-1">
                <LogoMark className="h-8 w-8 shrink-0" />
                <span className="truncate text-lg font-extrabold tracking-tight">{t("appName")}</span>
              </Link>
            )}
          </div>
          <HeaderControls />
        </div>
      </header>

      <main className="screen pb-32 pt-4">{children}</main>

      <nav
        aria-label={t("navLabel")}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-ink/[0.06] bg-surface/95 shadow-nav backdrop-blur-lg dark:border-white/[0.08] dark:bg-surface-dark/95"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="mx-auto grid w-full max-w-md grid-cols-4 px-2">
          {TABS.map(({ href, key, Icon }) => {
            const active = href === "/" ? current === "/" : current.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-bold transition ${
                    active ? "text-brand dark:text-blue-400" : "text-ink/50 hover:text-ink/80 dark:text-slate-400 dark:hover:text-slate-200"
                  }`}
                >
                  <span
                    className={`flex h-8 w-14 items-center justify-center rounded-full transition ${
                      active ? "bg-brand-soft dark:bg-blue-500/15" : ""
                    }`}
                  >
                    <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.4 : 2} />
                  </span>
                  <span className="max-w-full truncate px-1">{t(key)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
