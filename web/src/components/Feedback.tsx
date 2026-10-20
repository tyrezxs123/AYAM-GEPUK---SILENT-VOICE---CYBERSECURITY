"use client";

import { useI18n } from "@/lib/i18n";

import { WarningIcon } from "./Icons";

/**
 * The three-stage progress screen from Flow B: "Checking signature… Checking
 * voice… Checking words…". It tells the user what the app is doing in their own
 * words, which is what makes a 3-5 second wait feel deliberate instead of stuck.
 */
export function Stepper({ active }: { active: number }) {
  const { t } = useI18n();
  const stages = [t("stage_signature"), t("stage_voice"), t("stage_words")] as const;

  return (
    <ol className="space-y-3" aria-live="polite">
      {stages.map((label, i) => {
        const done = i < active;
        const current = i === active;
        return (
          <li key={label} className="flex items-center gap-3">
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold ${
                done
                  ? "border-verdict-green bg-verdict-green dark:border-emerald-500 dark:bg-emerald-600 text-white"
                  : current
                    ? "border-brand text-brand dark:border-blue-400 dark:text-blue-400"
                    : "border-ink/20 text-ink/35 dark:border-white/20 dark:text-slate-500"
              }`}
            >
              {done ? "✓" : i + 1}
            </span>
            <span className={`text-base ${current ? "font-semibold text-ink dark:text-slate-100" : "text-ink/60 dark:text-slate-400"}`}>{label}</span>
            {current && (
              <span className="ml-auto flex h-5 items-end gap-0.5" aria-hidden>
                {[0, 1, 2].map((b) => (
                  <span
                    key={b}
                    className="h-full w-1 origin-bottom rounded-full bg-brand dark:bg-blue-400 animate-pulsebar"
                    style={{ animationDelay: `${b * 0.15}s` }}
                  />
                ))}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Live microphone level, so the user can tell the phone is actually hearing the call. */
export function LevelMeter({ level, bars = 14 }: { level: number; bars?: number }) {
  const lit = Math.round(Math.min(1, level * 2.2) * bars);
  return (
    <div className="flex h-10 items-end gap-1" role="img" aria-hidden>
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className={`w-full rounded-sm transition-all duration-75 ${
            i < lit ? "bg-brand dark:bg-blue-500" : "bg-ink/10 dark:bg-white/10"
          }`}
          style={{ height: `${25 + (i / bars) * 75}%` }}
        />
      ))}
    </div>
  );
}

export function ErrorBox({ message, hint }: { message: string; hint?: string }) {
  const { t } = useI18n();
  return (
    <div className="card border-verdict-red/40 bg-verdict-redbg dark:border-rose-500/40 dark:bg-rose-950/40 text-ink dark:text-slate-100" role="alert">
      <div className="flex items-center gap-2 text-verdict-red dark:text-rose-400">
        <WarningIcon className="h-6 w-6" />
        <span className="text-lg font-bold">{t("errorTitle")}</span>
      </div>
      <p className="mt-2 text-base text-ink dark:text-slate-100">{message}</p>
      {hint && <p className="mt-1 text-sm text-ink/60 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

export function Timer({ seconds, max }: { seconds: number; max?: number }) {
  const mm = Math.floor(seconds / 60);
  const ss = Math.floor(seconds % 60);
  return (
    <p className="text-center text-3xl font-bold tabular-nums text-ink dark:text-slate-100">
      {mm}:{String(ss).padStart(2, "0")}
      {max != null && <span className="text-lg font-normal text-ink/45 dark:text-slate-500"> / {max}s</span>}
    </p>
  );
}
