"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, adminErrorMessage, adminRequestId, isAbortError } from "@/lib/admin-api/core";
import type { LadderRow, PriceAdjust, PricingItem, TrendPoint } from "@/lib/admin-api/pricing";
import { fmtNumber, fmtPercent, fmtSoum, fmtUsd, todayTashkent } from "@/lib/admin-format";
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
/** AI cost in dollars: 2 decimals like the dashboard and the AI page (4 only below one cent). */
export const usdText = (n: number | null): string => (n === null ? "—" : fmtUsd(n));
export const pctText = (n: number | null, digits = 1): string => (n === null ? "—" : fmtPercent(n, { digits }));
export const markupText = (n: number | null): string => (n === null ? "—" : `${fmtNumber(n, { digits: 1, fixed: true })}×`);
export const percentLabel = (p: number): string => `${fmtNumber(p)}%`;
/** Prices and their rounding step are tanga (the wallet unit), never so'm. */
export const roundToText = (n: number): string => `${fmtNumber(n)} tanga`;

/** The list's sparkline covers at most the last 30 days of the range (server `LIST_TREND_DAYS`). */
export const LIST_TREND_DAYS = 30;
export const listTrendDays = (rangeDays: number): number => Math.min(rangeDays, LIST_TREND_DAYS);

/**
 * Uzbek names of the runtime settings the pricing screen depends on (the
 * settings catalog labels, lib/server/settings.ts); never the raw keys.
 */
export const SETTING_LABEL = {
  fx: "Dollar kursi (so'm)",
  targetMarkup: "Maqsadli ustama (×)",
  paymentFee: "To'lov komissiyasi (%)",
} as const;

/** `YYYY-MM-DD` → `DD.MM` for chart axes. */
export function shortDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}` : iso;
}

/** Margin bands (§17.6): below LOW is red, up to GOOD amber, above GOOD green. */
export const MARGIN_LOW_PCT = 30;
export const MARGIN_GOOD_PCT = 60;

/** Margin colouring (§17.6): < 30 % red, 30–60 % amber, otherwise green; unknown → neutral. */
export function marginTone(marginPct: number | null): Tone {
  if (marginPct === null) return "neutral";
  if (marginPct < MARGIN_LOW_PCT) return "danger";
  if (marginPct <= MARGIN_GOOD_PCT) return "warning";
  return "success";
}

/** Uzbek names of the cost part kinds (`admin-cost.ts` part `kind`). */
const COST_KIND_LABEL: Record<string, string> = {
  llm: "Matn (LLM)",
  image: "Rasm",
  tts: "Ovoz (TTS)",
  grounding: "Google qidiruvi",
  unknown: "Turi yozilmagan",
};
export const costKindLabel = (kind: string): string => COST_KIND_LABEL[kind] ?? kind;

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

/* ───────────────────────────── recommendation ───────────────────────────── */

/** Within ±5 points of the current percent counts as "Mos" (matches the 5 % recommendation step). */
export const REC_OK_POINTS = 5;

/** Why a recommendation is shown but cannot be applied in one click. */
export type RecBlock = "low-confidence" | "changed-in-period" | "edited";

export const REC_BLOCK_TEXT: Record<RecBlock, string> = {
  "low-confidence": "kam ishonch",
  "changed-in-period": "narx davr ichida o'zgargan",
  edited: "yangilang",
};

/** The longer reason, for the sheet and the attention strip. */
export const REC_BLOCK_HINT: Record<RecBlock, string> = {
  "low-confidence": "Tanlama 20 tadan kam tayyor ish: tavsiya taxminiy. Kerak bo'lsa qo'lda o'zgartiring.",
  "changed-in-period": "Narx shu davr ichida o'zgargan: ustama ikki xil narxdagi ishlardan hisoblangan. Davrni o'zgarishdan keyingi kunlardan boshlang.",
  edited: "Narx hozirgina o'zgartirildi: tavsiyani yangi ma'lumot bilan ko'rish uchun sahifani yangilang.",
};

export type RecState =
  | { kind: "none" }
  | { kind: "ok"; target: number }
  | {
      kind: "change";
      /** The recommended adjustment percent (25–1000). */
      target: number;
      direction: "up" | "down";
      /** Price change against the current one, % (target ÷ current − 1). */
      changePct: number;
      /** `null` = may be applied in one click. */
      block: RecBlock | null;
    };

/** What the overview's recommendation was computed against, to tell a stale one apart. */
export type RecContext = {
  /** Each tool's adjustment when the overview was loaded (before any local save), by tool id. */
  basis: ReadonlyMap<string, PriceAdjust>;
  /** First day of the selected range, `YYYY-MM-DD` (Tashkent). */
  rangeFrom: string;
};

/**
 * The recommendation of a row and whether it may be applied in one click. It may not when
 * the sample is small, when the price changed inside the range (the markup then mixes two
 * prices, and `current × target ÷ markup` would compound the change), or when the row was
 * saved after the overview loaded (the recommendation is from before that save).
 */
export function recommendationState(
  item: Pick<PricingItem, "toolId" | "adjust" | "recommendedPercent" | "confidence" | "lastChangeAt">,
  ctx: RecContext,
): RecState {
  const target = item.recommendedPercent;
  if (target === null) return { kind: "none" };
  const current = item.adjust.percent;
  if (Math.abs(target - current) <= REC_OK_POINTS) return { kind: "ok", target };
  const basis = ctx.basis.get(item.toolId);
  const block: RecBlock | null =
    basis !== undefined && (item.adjust.percent !== basis.percent || item.adjust.roundTo !== basis.roundTo)
      ? "edited"
      : item.lastChangeAt !== null && todayTashkent(Date.parse(item.lastChangeAt)) >= ctx.rangeFrom
        ? "changed-in-period"
        : item.confidence === "low"
          ? "low-confidence"
          : null;
  return { kind: "change", target, direction: target > current ? "up" : "down", changePct: (target / current - 1) * 100, block };
}

/** `+121%` / `−10%`: the recommended price change against the current price. */
export function changeText(changePct: number): string {
  const n = Math.round(changePct);
  return `${n > 0 ? "+" : "−"}${fmtNumber(Math.abs(n))}%`;
}

/* ───────────────────────────── client-side sort and filter ───────────────────────────── */

export type PricingSortField = "margin" | "cost" | "volume";
export type PricingSort = { field: PricingSortField; dir: "asc" | "desc"; value: string };

/** Margin ascending first (the problems on top), as in the prototype. */
export const DEFAULT_SORT = "margin_asc";

/** The phone's «Saralash» select (the table headers are not shown there); same values as the headers. */
export const SORT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "margin_asc", label: "Marja: pastdan" },
  { value: "margin_desc", label: "Marja: yuqoridan" },
  { value: "cost_desc", label: "Tannarx: qimmatdan" },
  { value: "cost_asc", label: "Tannarx: arzondan" },
  { value: "volume_desc", label: "Ishlar: ko'pdan" },
  { value: "volume_asc", label: "Ishlar: kamdan" },
];
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
