"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { ChevronRightIcon, FileIcon, MicIcon, PenIcon, ShieldCheckIcon, WaveIcon } from "@/components/Icons";
import { historyStats, listHistory, type HistoryEntry } from "@/lib/history";
import { useI18n } from "@/lib/i18n";
import { listTrusted } from "@/lib/trusted";

const DOT: Record<string, string> = {
  green: "bg-verdict-green dark:bg-emerald-400",
  red: "bg-verdict-red dark:bg-rose-400",
  orange: "bg-amber-500",
  grey: "bg-slate-400",
};

function timeAgo(at: number, lang: string): string {
  const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (mins < 1) return lang === "ms" ? "baru sahaja" : "just now";
  if (mins < 60) return lang === "ms" ? `${mins} min lalu` : `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return lang === "ms" ? `${hours} jam lalu` : `${hours} h ago`;
  const days = Math.round(hours / 24);
  return lang === "ms" ? `${days} hari lalu` : `${days} d ago`;
}

export default function Home() {
  const { t, lang } = useI18n();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [stats, setStats] = useState({ checks: 0, flagged: 0, trusted: 0 });

  useEffect(() => {
    const load = () => {
      setHistory(listHistory().slice(0, 5));
      const s = historyStats();
      setStats({ checks: s.checks, flagged: s.flagged, trusted: listTrusted().length });
    };
    load();
    window.addEventListener("suarasah:history", load);
    return () => window.removeEventListener("suarasah:history", load);
  }, []);

  const actions = [
    { href: "/verify", label: t("homeVerify"), sub: t("homeVerifySub"), Icon: ShieldCheckIcon, tone: "bg-brand text-white" },
    { href: "/live", label: t("homeLive"), sub: t("homeLiveSub"), Icon: WaveIcon, tone: "bg-amber-500 text-white" },
    { href: "/sign", label: t("homeSign"), sub: t("homeSignSub"), Icon: PenIcon, tone: "bg-verdict-green text-white dark:bg-emerald-600" },
  ];

  const KIND_ICON = { file: FileIcon, record: MicIcon, live: WaveIcon, sign: PenIcon } as const;

  return (
    <AppShell>
      <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#0d2580] via-brand to-[#4f86ff] p-5 text-white shadow-lift">
        <div className="pointer-events-none absolute -right-10 -top-12 h-44 w-44 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-16 -left-8 h-40 w-40 rounded-full bg-white/[0.07]" />
        <p className="relative text-xs font-extrabold uppercase tracking-[0.12em] text-white/70">{t("heroEyebrow")}</p>
        <h2 className="relative mt-1.5 text-[1.7rem] font-extrabold leading-[1.15] tracking-tight">{t("tagline")}</h2>
        <p className="relative mt-2 text-sm leading-snug text-white/80">{t("heroSub")}</p>

        <dl className="relative mt-5 grid grid-cols-3 gap-2">
          {[
            [stats.checks, t("statChecks")],
            [stats.flagged, t("statFlagged")],
            [stats.trusted, t("statTrusted")],
          ].map(([value, label]) => (
            <div key={label as string} className="rounded-2xl bg-white/[0.13] px-3 py-2.5 backdrop-blur">
              <dd className="text-2xl font-extrabold tabular-nums leading-none">{value}</dd>
              <dt className="mt-1 text-[11px] font-semibold leading-tight text-white/75">{label}</dt>
            </div>
          ))}
        </dl>
      </section>

      <nav className="mt-4 space-y-2.5">
        {actions.map(({ href, label, sub, Icon, tone }, i) => (
          <Link
            key={href}
            href={href}
            className="panel flex animate-rise items-center gap-3.5 !p-3.5 transition hover:border-brand/30 active:scale-[0.985]"
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${tone}`}>
              <Icon className="h-7 w-7" strokeWidth={2.2} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-extrabold leading-tight tracking-tight">{label}</span>
              <span className="mt-0.5 block text-sm leading-snug text-ink/60 dark:text-slate-400">{sub}</span>
            </span>
            <ChevronRightIcon className="h-5 w-5 shrink-0 text-ink/30 dark:text-slate-500" />
          </Link>
        ))}
      </nav>

      <section className="mt-6">
        <p className="eyebrow px-1">{t("recentTitle")}</p>
        {history.length === 0 ? (
          <p className="panel mt-2 text-sm text-ink/55 dark:text-slate-400">{t("recentEmpty")}</p>
        ) : (
          <ul className="panel mt-2 divide-y divide-ink/[0.07] !py-1 dark:divide-white/10">
            {history.map((e) => {
              const Icon = KIND_ICON[e.kind];
              return (
                <li key={e.id} className="flex items-center gap-3 py-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink/[0.05] text-ink/60 dark:bg-white/[0.07] dark:text-slate-300">
                    <Icon className="h-5 w-5" strokeWidth={2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-extrabold">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[e.colour]}`} />
                      <span className="truncate">
                        {e.verdict === "UNVERIFIED" && e.level ? t(`level_${e.level}` as "level_low") : t(`verdict_${e.verdict}` as "verdict_VERIFIED")}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-ink/55 dark:text-slate-400">
                      {t(`kind_${e.kind}` as "kind_file")} · {e.label}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-ink/45 dark:text-slate-500">{timeAgo(e.at, lang)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-4 rounded-3xl border border-brand/15 bg-brand-soft/60 p-4 dark:border-blue-400/15 dark:bg-blue-500/10">
        <p className="text-sm font-extrabold text-brand-dark dark:text-blue-300">{t("ruleTitle")}</p>
        <p className="mt-1 text-sm leading-snug text-ink/70 dark:text-slate-300">{t("homeFooter")}</p>
      </section>

      <p className="mt-4 px-1 text-xs leading-relaxed text-ink/45 dark:text-slate-500">{t("disclaimerBody")}</p>
    </AppShell>
  );
}
