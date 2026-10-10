"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { InfoTip } from "./InfoTip";
import { Skeleton } from "./Skeleton";

export type KpiDelta = {
  /** Already formatted, e.g. "+12%" or "-0,4 p.p.". */
  text: string;
  direction: "up" | "down" | "flat";
  /** Good, bad or neutral: a drop in cost is "good" although it points down. */
  tone: "good" | "bad" | "neutral";
};

const DELTA_TONE: Record<KpiDelta["tone"], string> = {
  good: "text-success-text",
  bad: "text-destructive",
  neutral: "text-muted-foreground",
};

const DIRECTION_TEXT: Record<KpiDelta["direction"], string> = {
  up: "oshdi",
  down: "kamaydi",
  flat: "o'zgarmadi",
};

/** One headline number with an optional comparison to the previous period. */
export function KpiTile({
  label,
  value,
  delta,
  hint,
  info,
  loading = false,
}: {
  label: string;
  value: ReactNode;
  delta?: KpiDelta | null;
  /** Small caption under the number (e.g. coverage). */
  hint?: ReactNode;
  /** What the number is computed on, behind a «?» next to the label (`InfoTip`). */
  info?: ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="bg-card flex min-w-0 flex-col gap-1 rounded-xl border px-3.5 py-3" aria-busy={loading || undefined}>
      {info ? (
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">{label}</span>
          <InfoTip label={label}>{info}</InfoTip>
        </span>
      ) : (
        <span className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">{label}</span>
      )}
      {loading ? (
        <>
          <Skeleton className="mt-0.5 h-6 w-24" />
          <Skeleton className="h-3.5 w-14" />
        </>
      ) : (
        <>
          <span className="truncate text-xl font-semibold tabular-nums">{value}</span>
          {delta ? (
            <span className={cn("inline-flex items-center gap-1 text-xs font-semibold tabular-nums", DELTA_TONE[delta.tone])}>
              {delta.direction === "up" ? <ArrowUp className="size-3" aria-hidden="true" /> : null}
              {delta.direction === "down" ? <ArrowDown className="size-3" aria-hidden="true" /> : null}
              {delta.text}
              <span className="sr-only">({DIRECTION_TEXT[delta.direction]})</span>
            </span>
          ) : null}
          {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
        </>
      )}
    </div>
  );
}
