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
  /** Compact icon badge surface, icon color, and inset ring */
  iconWell: string;
  /** Optional ratio meter fill & track */
  meterFill: string;
  meterTrack: string;
}

export const toneStyles: Record<Tone, TonePalette> = {
  default: {
    iconWell:
      "bg-muted/80 text-muted-foreground ring-border/80",
    meterFill: "bg-muted-foreground/70",
    meterTrack: "bg-muted",
  },
  primary: {
    iconWell:
      "bg-primary/10 text-primary ring-primary/20 dark:bg-primary/18 dark:text-violet-300 dark:ring-violet-400/25",
    meterFill: "bg-primary",
    meterTrack: "bg-primary/15",
  },
  success: {
    iconWell:
      "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:bg-emerald-500/18 dark:text-emerald-300 dark:ring-emerald-400/25",
    meterFill: "bg-emerald-500",
    meterTrack: "bg-emerald-500/15",
  },
  warning: {
    iconWell:
      "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:bg-amber-500/18 dark:text-amber-300 dark:ring-amber-400/25",
    meterFill: "bg-amber-500",
    meterTrack: "bg-amber-500/15",
  },
  danger: {
    iconWell:
      "bg-destructive/10 text-destructive ring-destructive/20 dark:bg-destructive/18 dark:ring-destructive/25",
    meterFill: "bg-destructive",
    meterTrack: "bg-destructive/15",
  },
  info: {
    iconWell:
      "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:bg-sky-500/18 dark:text-sky-300 dark:ring-sky-400/25",
    meterFill: "bg-sky-500",
    meterTrack: "bg-sky-500/15",
  },
  violet: {
    iconWell:
      "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:bg-violet-500/18 dark:text-violet-300 dark:ring-violet-400/25",
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
      <span className="font-semibold text-foreground/90 tabular-nums">
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
    <span className="inline-flex items-center">
      {parts.map((part, index) => (
        <React.Fragment key={index}>
          {index > 0 && (
            <span
              aria-hidden="true"
              className="mx-1.5 select-none text-muted-foreground/45"
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
        "@container/stat relative col-span-6 min-w-0 gap-1.5 overflow-hidden rounded-xl border border-border/80 bg-card px-3.5 py-2.5 ring-0 shadow-2xs xl:col-span-3",
        className,
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-md ring-1 ring-inset",
              palette.iconWell,
            )}
          >
            <Icon className="size-3.5" />
          </span>
          <p className="truncate text-xs font-medium leading-4 text-muted-foreground">
            {label}
          </p>
          {badge && !loading && <div className="shrink-0">{badge}</div>}
        </div>

        <div className="flex shrink-0 items-baseline gap-1.5">
          {loading ? (
            <Skeleton className="h-5 w-12 shrink-0 rounded-md" />
          ) : (
            <p className="text-lg font-semibold leading-none tracking-tight text-foreground tabular-nums sm:text-xl">
              {value}
            </p>
          )}
        </div>
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
        <div
          title={typeof hint === "string" ? hint : undefined}
          className="min-w-0 truncate border-t border-border/50 pt-1.5 text-[11px] leading-4 text-muted-foreground"
        >
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
        "grid w-full grid-cols-12 items-stretch gap-2.5",
        className,
      )}
    >
      {children}
    </div>
  );
}
