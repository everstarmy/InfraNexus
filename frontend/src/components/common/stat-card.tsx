import React from "react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type Tone =
  | "default"
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "violet";

interface TonePalette {
  /** CSS variable assignment for the curved left-border crescent arc */
  accentVar: string;
  /** Tactile icon badge surface, icon color, and inset ring */
  iconWell: string;
  /** Optional ratio meter fill & track */
  meterFill: string;
  meterTrack: string;
}

export const toneStyles: Record<Tone, TonePalette> = {
  default: {
    accentVar:
      "[--stat-accent:color-mix(in_oklch,var(--muted-foreground)_45%,var(--border))]",
    iconWell:
      "bg-muted/80 text-muted-foreground ring-border/80",
    meterFill: "bg-muted-foreground/70",
    meterTrack: "bg-muted",
  },
  primary: {
    accentVar:
      "[--stat-accent:var(--primary)] dark:[--stat-accent:oklch(0.68_0.22_303)]",
    iconWell:
      "bg-primary/10 text-primary ring-primary/20 dark:bg-primary/15 dark:text-purple-300 dark:ring-purple-400/25",
    meterFill: "bg-primary dark:bg-purple-400",
    meterTrack: "bg-primary/15",
  },
  success: {
    accentVar: "[--stat-accent:var(--color-emerald-500)]",
    iconWell:
      "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-400/25",
    meterFill: "bg-emerald-500",
    meterTrack: "bg-emerald-500/15",
  },
  warning: {
    accentVar: "[--stat-accent:var(--color-amber-500)]",
    iconWell:
      "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:bg-amber-500/15 dark:text-amber-400 dark:ring-amber-400/25",
    meterFill: "bg-amber-500",
    meterTrack: "bg-amber-500/15",
  },
  danger: {
    accentVar: "[--stat-accent:var(--destructive)]",
    iconWell:
      "bg-destructive/10 text-destructive ring-destructive/20 dark:bg-destructive/15 dark:ring-destructive/30",
    meterFill: "bg-destructive",
    meterTrack: "bg-destructive/15",
  },
  info: {
    accentVar: "[--stat-accent:var(--color-sky-500)]",
    iconWell:
      "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:bg-sky-500/15 dark:text-sky-400 dark:ring-sky-400/25",
    meterFill: "bg-sky-500",
    meterTrack: "bg-sky-500/15",
  },
  violet: {
    accentVar: "[--stat-accent:var(--color-violet-500)]",
    iconWell:
      "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:bg-violet-500/15 dark:text-violet-400 dark:ring-violet-400/25",
    meterFill: "bg-violet-500",
    meterTrack: "bg-violet-500/15",
  },
};

const METRIC_TOKEN_REGEX = /^([^\d]*?)(\d[\d,.]*%?)(.*)$/;

function renderStructuredSegment(segment: string) {
  const match = segment.match(METRIC_TOKEN_REGEX);
  if (!match) return segment;
  const [, prefix, numberToken, suffix] = match;
  return (
    <>
      {prefix}
      <span className="font-semibold text-foreground tabular-nums">
        {numberToken}
      </span>
      {suffix}
    </>
  );
}

function renderHint(hint: React.ReactNode) {
  if (typeof hint !== "string") return hint;
  if (!hint.includes(" · ")) {
    return renderStructuredSegment(hint);
  }
  const parts = hint.split(" · ");
  return (
    <span className="inline-flex flex-wrap items-center gap-y-0.5">
      {parts.map((part, index) => (
        <React.Fragment key={index}>
          {index > 0 && (
            <span
              aria-hidden="true"
              className="mx-1.5 select-none text-muted-foreground/50"
            >
              {"·"}
            </span>
          )}
          <span className="inline-flex items-baseline">
            {renderStructuredSegment(part)}
          </span>
        </React.Fragment>
      ))}
    </span>
  );
}

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  hint?: React.ReactNode;
  tone?: Tone;
  ratio?: number;
  badge?: React.ReactNode;
  loading?: boolean;
  className?: string;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  tone = "default",
  ratio,
  badge,
  loading,
  className,
}: StatCardProps) {
  const palette = toneStyles[tone] ?? toneStyles.default;
  const clampedRatio =
    ratio !== undefined
      ? Math.round(Math.min(Math.max(ratio, 0), 1) * 100)
      : undefined;

  return (
    <Card
      data-slot="stat-card"
      data-tone={tone}
      role="group"
      aria-label={label}
      aria-busy={loading || undefined}
      className={cn(
        "@container/stat relative col-span-6 min-w-0 gap-1.5 overflow-hidden rounded-2xl border-0 bg-card py-3 pl-4 pr-3.5 ring-0 shadow-[inset_3.5px_0_0_0_var(--stat-accent),inset_0_0_0_1px_var(--border),0_1px_2px_0_rgb(0_0_0/0.03)] transition-shadow duration-150 sm:py-3.5 sm:pl-4.5 sm:pr-4 xl:col-span-3",
        palette.accentVar,
        className,
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2.5">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="min-w-0 text-xs font-medium leading-4 text-muted-foreground [overflow-wrap:anywhere]">
            {label}
          </p>
          <div className="flex min-w-0 flex-wrap items-baseline gap-1.5">
            {loading ? (
              <Skeleton className="h-7 w-16 shrink-0 rounded-md" />
            ) : (
              <p className="min-w-0 text-xl font-bold leading-7 tracking-tight text-foreground tabular-nums [overflow-wrap:anywhere] @min-[13rem]/stat:text-2xl">
                {value}
              </p>
            )}
            {badge && !loading && <div className="shrink-0">{badge}</div>}
          </div>
        </div>

        <span
          aria-hidden="true"
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset @min-[13rem]/stat:size-9",
            palette.iconWell,
          )}
        >
          <Icon className="size-4 @min-[13rem]/stat:size-4.5" />
        </span>
      </div>

      {clampedRatio !== undefined && (
        <div
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={clampedRatio}
          className={cn(
            "h-1 w-full overflow-hidden rounded-full",
            palette.meterTrack,
          )}
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500 ease-out",
              palette.meterFill,
            )}
            style={{ width: `${clampedRatio}%` }}
          />
        </div>
      )}

      {(hint != null || loading) && (
        <div className="min-w-0 text-xs leading-4 text-muted-foreground [overflow-wrap:anywhere]">
          {loading ? (
            <Skeleton className="h-3.5 w-full max-w-32 rounded" />
          ) : (
            renderHint(hint)
          )}
        </div>
      )}
    </Card>
  );
}

export function StatGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="stat-grid"
      className={cn(
        "grid w-full grid-cols-12 items-stretch gap-2.5 sm:gap-3.5",
        className,
      )}
    >
      {children}
    </div>
  );
}
