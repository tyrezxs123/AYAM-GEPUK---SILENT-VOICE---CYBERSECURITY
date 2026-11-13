"use client";

import { useI18n } from "@/lib/i18n";

import { CheckIcon, WarningIcon } from "./Icons";

/**
 * The three-stage progress screen from Flow B: "Checking signature… Checking
 * voice… Checking words…". It tells the user what the app is doing in their own
 * words, which is what makes a few seconds of waiting feel deliberate.
 */
export function Stepper({ active, note }: { active: number; note?: React.ReactNode }) {
  const { t } = useI18n();
  const stages = [t("stage_signature"), t("stage_voice"), t("stage_words")] as const;

  return (
    <div className="panel animate-rise">
      <ScanWave />
      <ol className="mt-5 space-y-3.5" aria-live="polite">
        {stages.map((label, i) => {
          const done = i < active;
          const current = i === active;
          return (
            <li key={label} className="flex items-center gap-3">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold transition-colors ${
                  done
                    ? "bg-verdict-green text-white dark:bg-emerald-500"
                    : current
                      ? "bg-brand text-white dark:bg-blue-500"
                      : "bg-ink/[0.07] text-ink/35 dark:bg-white/10 dark:text-slate-500"
                }`}
              >
                {done ? <CheckIcon className="h-4 w-4" strokeWidth={3} /> : i + 1}
              </span>
              <span className={`text-base ${current ? "font-bold" : done ? "text-ink/70 dark:text-slate-300" : "text-ink/45 dark:text-slate-500"}`}>
                {label}
              </span>
            </li>
          );
        })}
      </ol>
      {note && <div className="mt-4">{note}</div>}
    </div>
  );
}

/** Animated bars with a sweeping highlight: "the clip is being scanned". */
export function ScanWave() {
  const heights = [30, 55, 80, 45, 95, 60, 35, 75, 100, 50, 70, 40, 90, 55, 30, 65, 85, 45, 60, 35, 75, 50, 95, 40];
  return (
    <div className="relative flex h-20 items-center justify-center gap-[5px] overflow-hidden rounded-2xl bg-brand-soft/70 px-4 dark:bg-blue-500/10" aria-hidden>
      {heights.map((h, i) => (
        <span
          key={i}
          className="w-1.5 origin-center animate-pulsebar rounded-full bg-brand/70 dark:bg-blue-400/80"
          style={{ height: `${h * 0.6}%`, animationDelay: `${(i % 6) * 0.12}s` }}
        />
      ))}
      <span className="absolute inset-y-0 left-0 w-1/3 animate-sweep bg-gradient-to-r from-transparent via-white/60 to-transparent dark:via-white/10" />
    </div>
  );
}

/** Thin progress bar with a caption, used while the speech model downloads. */
export function ProgressNote({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs font-semibold text-ink/60 dark:text-slate-400">
        <span>{label}</span>
        {value !== null && <span className="tabular-nums">{Math.round(value * 100)}%</span>}
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink/10 dark:bg-white/10">
        <div
          className={`h-full rounded-full bg-brand dark:bg-blue-400 ${value === null ? "w-1/3 animate-sweep" : "transition-all duration-300"}`}
          style={value === null ? undefined : { width: `${Math.max(3, value * 100)}%` }}
        />
      </div>
    </div>
  );
}

/** Live microphone level, so the user can tell the phone is actually hearing something. */
export function LevelMeter({ level, bars = 28 }: { level: number; bars?: number }) {
  const lit = Math.round(Math.min(1, level * 2.4) * bars);
  return (
    <div className="flex h-12 items-center justify-center gap-[3px]" role="img" aria-hidden>
      {Array.from({ length: bars }, (_, i) => {
        const centre = 1 - Math.abs(i - (bars - 1) / 2) / ((bars - 1) / 2);
        const on = centre * bars >= bars - lit;
        return (
          <span
            key={i}
            className={`w-1.5 rounded-full transition-all duration-100 ${on ? "bg-brand dark:bg-blue-400" : "bg-ink/10 dark:bg-white/10"}`}
            style={{ height: `${on ? 30 + centre * 70 * Math.min(1, level * 3 + 0.25) : 18 + centre * 14}%` }}
          />
        );
      })}
    </div>
  );
}

export function ErrorBox({ message, hint }: { message: string; hint?: string }) {
  const { t } = useI18n();
  return (
    <div className="card animate-rise border-verdict-red/30 bg-verdict-redbg dark:border-rose-500/30 dark:bg-rose-500/10" role="alert">
      <div className="flex items-center gap-2.5 text-verdict-red dark:text-rose-400">
        <WarningIcon className="h-6 w-6 shrink-0" />
        <span className="text-lg font-extrabold">{t("errorTitle")}</span>
      </div>
      <p className="mt-2 text-base">{message}</p>
      {hint && <p className="mt-1.5 text-sm text-ink/60 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

export function Timer({ seconds, max }: { seconds: number; max?: number }) {
  const mm = Math.floor(seconds / 60);
  const ss = Math.floor(seconds % 60);
  return (
    <p className="text-center text-5xl font-extrabold tabular-nums tracking-tight">
      {mm}:{String(ss).padStart(2, "0")}
      {max != null && <span className="ml-1.5 text-base font-semibold text-ink/40 dark:text-slate-500">/ {max}s</span>}
    </p>
  );
}

/** A labelled 0..1 meter with three zones. Used for the two independent warnings. */
export function RiskMeter({
  label,
  value,
  level,
  caption,
}: {
  label: string;
  value: number;
  level: "low" | "medium" | "high";
  caption?: string;
}) {
  const { t } = useI18n();
  const tone =
    level === "high"
      ? "bg-verdict-red dark:bg-rose-500"
      : level === "medium"
        ? "bg-amber-500"
        : "bg-slate-400 dark:bg-slate-500";
  const text =
    level === "high"
      ? "text-verdict-red dark:text-rose-400"
      : level === "medium"
        ? "text-verdict-orange dark:text-amber-400"
        : "text-ink/60 dark:text-slate-400";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-bold">{label}</span>
        <span className={`text-sm font-extrabold ${text}`}>{t(`meter_${level}` as "meter_low")}</span>
      </div>
      <div className="relative mt-1.5 h-2.5 overflow-hidden rounded-full bg-ink/[0.08] dark:bg-white/10">
        <div className={`h-full rounded-full transition-all duration-500 ${tone}`} style={{ width: `${Math.max(4, Math.min(1, value) * 100)}%` }} />
        <span className="absolute inset-y-0 left-[40%] w-px bg-surface/80 dark:bg-canvas-dark/80" />
        <span className="absolute inset-y-0 left-[70%] w-px bg-surface/80 dark:bg-canvas-dark/80" />
      </div>
      {caption && <p className="mt-1.5 text-xs leading-snug text-ink/55 dark:text-slate-400">{caption}</p>}
    </div>
  );
}
