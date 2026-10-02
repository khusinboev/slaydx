"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, adminErrorMessage, adminRequestId, isAbortError } from "@/lib/admin-api/core";
import type { LadderRow, PriceAdjust, PricingItem, TrendPoint } from "@/lib/admin-api/pricing";
import { fmtNumber, fmtPercent, fmtSoum, fmtUsd } from "@/lib/admin-format";
import type { Tone } from "@/components/admin/ui";

/* ───────────────────────────── loading state ───────────────────────────── */

export type LoadState<T> =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error"; message: string; requestId?: string }
  | { status: "ready"; data: T };

type Settled<T> = { load: unknown; reload: number; state: Exclude<LoadState<T>, { status: "loading" }> };

/**
 * Runs `load` whenever its identity changes (memoise it with `useCallback`) or
 * `retry()` is called. The previous request is aborted first, so a stale answer
 * never overwrites a newer one. 403 becomes `forbidden`; an abort is silent.
 */
export function useLoad<T>(load: (signal: AbortSignal) => Promise<T>): [LoadState<T>, () => void] {
  const [reload, setReload] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    load(ctl.signal)
      .then((data) => setSettled({ load, reload, state: { status: "ready", data } }))
      .catch((e: unknown) => {
        if (isAbortError(e) || ctl.signal.aborted) return;
        if (e instanceof ApiError && e.status === 403) {
          setSettled({ load, reload, state: { status: "forbidden" } });
          return;
        }
        setSettled({ load, reload, state: { status: "error", message: adminErrorMessage(e), requestId: adminRequestId(e) } });
      });
    return () => ctl.abort();
  }, [load, reload]);

  const retry = useCallback(() => setReload((n) => n + 1), []);
  const state: LoadState<T> = settled && settled.load === load && settled.reload === reload ? settled.state : { status: "loading" };
  return [state, retry];
}

/* ───────────────────────────── money and labels ───────────────────────────── */

export const soumText = (n: number | null): string => (n === null ? "—" : fmtSoum(Math.round(n)));
export const tangaText = (n: number | null): string => (n === null ? "—" : `${fmtNumber(Math.round(n))} tanga`);
/** AI cost in dollars, always 4 decimals (the amounts are cents and below). */
export const usd4 = (n: number | null): string => (n === null ? "—" : fmtUsd(n, 4));
export const pctText = (n: number | null, digits = 1): string => (n === null ? "—" : fmtPercent(n, { digits }));
export const markupText = (n: number | null): string => (n === null ? "—" : `${fmtNumber(n, { digits: 1, fixed: true })}×`);
export const percentLabel = (p: number): string => `${fmtNumber(p)}%`;

/** `YYYY-MM-DD` → `DD.MM` for chart axes. */
export function shortDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}` : iso;
}

/** Margin colouring (§17.6): < 30 % red, 30–60 % amber, otherwise green; unknown → neutral. */
export function marginTone(marginPct: number | null): Tone {
  if (marginPct === null) return "neutral";
  if (marginPct < 30) return "danger";
  if (marginPct <= 60) return "warning";
  return "success";
}

/** "3 000 – 8 000" over a ladder column; one value when every step is the same. */
export function ladderRange(ladder: ReadonlyArray<LadderRow>, key: "base" | "effective"): string {
  if (ladder.length === 0) return "—";
  const values = ladder.map((s) => s[key]);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return lo === hi ? fmtNumber(lo) : `${fmtNumber(lo)} – ${fmtNumber(hi)}`;
}

export const isDefaultAdjust = (adj: PriceAdjust): boolean => adj.percent === 100;

/** Sparkline input: days without a completed job are drawn at 0. */
export const trendValues = (trend: ReadonlyArray<TrendPoint>): number[] => trend.map((p) => p.avgCostSoum ?? 0);

/**
 * Trend direction over the period: the average of the second half's known
 * days against the first half's, in percent; `null` when either half has no
 * data.
 */
export function trendChangePct(trend: ReadonlyArray<TrendPoint>): number | null {
  const known = (points: ReadonlyArray<TrendPoint>) => points.map((p) => p.avgCostSoum).filter((v): v is number => v !== null);
  const mid = Math.floor(trend.length / 2);
  const first = known(trend.slice(0, mid));
  const second = known(trend.slice(mid));
  if (first.length === 0 || second.length === 0) return null;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const a = avg(first);
  if (a <= 0) return null;
  return ((avg(second) - a) / a) * 100;
}

/* ───────────────────────────── recommendation chip ───────────────────────────── */

export type Recommendation =
  | { kind: "none" }
  | { kind: "ok"; percent: number }
  | { kind: "up" | "down"; percent: number; diff: number };

/** Within ±5 % of the current percent counts as "Mos" (matches the 5 % recommendation step). */
export function recommendationOf(item: Pick<PricingItem, "adjust" | "recommendedPercent">): Recommendation {
  if (item.recommendedPercent === null) return { kind: "none" };
  const diff = item.recommendedPercent - item.adjust.percent;
  if (Math.abs(diff) <= 5) return { kind: "ok", percent: item.recommendedPercent };
  return { kind: diff > 0 ? "up" : "down", percent: item.recommendedPercent, diff };
}

export function recommendationText(rec: Recommendation): string {
  if (rec.kind === "none") return "—";
  if (rec.kind === "ok") return "Mos";
  return rec.kind === "up" ? `+${fmtNumber(rec.diff)}% tavsiya` : `−${fmtNumber(-rec.diff)}% tavsiya`;
}

/* ───────────────────────────── client-side sort and filter ───────────────────────────── */

export type PricingSortField = "margin" | "cost" | "volume";
export type PricingSort = { field: PricingSortField; dir: "asc" | "desc"; value: string };

/** Margin ascending first (the problems on top), as in the prototype. */
export const DEFAULT_SORT = "margin_asc";
const SORT_FIELDS: ReadonlyArray<PricingSortField> = ["margin", "cost", "volume"];

export function parseSort(raw: string | null): PricingSort {
  const m = /^([a-z]+)_(asc|desc)$/.exec(raw ?? "");
  if (m && (SORT_FIELDS as readonly string[]).includes(m[1])) return { field: m[1] as PricingSortField, dir: m[2] as "asc" | "desc", value: raw as string };
  return { field: "margin", dir: "asc", value: DEFAULT_SORT };
}

const FIELD_OF: Record<PricingSortField, (i: PricingItem) => number | null> = {
  margin: (i) => i.marginPct,
  cost: (i) => i.fullCostSoum,
  volume: (i) => i.jobs,
};

/** Sorted copy; unknown values (`null`) sink to the bottom in either direction; ties keep the title order. */
export function sortItems(items: ReadonlyArray<PricingItem>, sort: PricingSort): PricingItem[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const get = FIELD_OF[sort.field];
  return [...items].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    if (va === null && vb === null) return a.title.localeCompare(b.title);
    if (va === null) return 1;
    if (vb === null) return -1;
    return va !== vb ? sign * (va - vb) : a.title.localeCompare(b.title);
  });
}

export function filterByGroup(items: ReadonlyArray<PricingItem>, group: string): PricingItem[] {
  return group ? items.filter((i) => i.group === group) : [...items];
}

/** Coverage below this share of completed jobs triggers the caveat banner (§17.6). */
export const COVERAGE_WARN_PCT = 90;

/** Tools whose cost coverage is known and below the threshold. */
export function lowCoverage(items: ReadonlyArray<PricingItem>): PricingItem[] {
  return items.filter((i) => i.coveragePct !== null && i.coveragePct < COVERAGE_WARN_PCT);
}

export const PROPAGATION_NOTE = "Yangi buyurtmalarga 15 soniya ichida qo'llanadi; navbatdagi ishlar eski narxda qoladi.";

/** A change of more than ±50 percentage points needs the typed confirmation (§17.6). */
export const BIG_CHANGE_PP = 50;
