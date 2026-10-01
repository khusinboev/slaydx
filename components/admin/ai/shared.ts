"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, adminErrorMessage, adminRequestId, isAbortError } from "@/lib/admin-api/core";
import type { AiCostRow, AiGroupBy } from "@/lib/admin-api/ai";
import { fmtIsoDate, fmtNumber, fmtSoum, fmtUsd } from "@/lib/admin-format";

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
 * can never overwrite a newer one. 403 becomes `forbidden`; an abort is silent.
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
  // A result belongs to the request that produced it; anything else is still loading.
  const state: LoadState<T> = settled && settled.load === load && settled.reload === reload ? settled.state : { status: "loading" };
  return [state, retry];
}

/* ───────────────────────────── money and labels ───────────────────────────── */

/** `$0.0042` / `$12.40`: four fraction digits for amounts under a cent (house `fmtUsd`). */
export const usdText = (usd: number): string => fmtUsd(usd);

/** The so'm equivalent at the current `finance.soum_per_usd`. */
export const soumText = (usd: number, soumPerUsd: number): string => fmtSoum(Math.round(usd * soumPerUsd));

export const numText = (n: number | null): string => fmtNumber(n);

/** `YYYY-MM-DD` → `DD.MM` for chart axes. */
export function shortDay(iso: string): string {
  const full = fmtIsoDate(iso);
  return full.length === 10 ? full.slice(0, 5) : full;
}

export const GROUP_BY_OPTIONS: ReadonlyArray<{ value: AiGroupBy; label: string }> = [
  { value: "model", label: "Model" },
  { value: "provider", label: "Provayder" },
  { value: "tool", label: "Vosita" },
  { value: "day", label: "Kun" },
  { value: "kind", label: "Turi" },
];

export const GROUP_BY_VALUES: ReadonlyArray<AiGroupBy> = GROUP_BY_OPTIONS.map((o) => o.value);
export const DEFAULT_GROUP_BY: AiGroupBy = "model";

/** First column header of the cost table. */
export const KEY_HEADER: Record<AiGroupBy, string> = {
  day: "Kun",
  tool: "Vosita",
  provider: "Provayder",
  model: "Model",
  kind: "Turi",
};

/** Display text of a row key: days as DD.MM.YYYY, `unknown` in Uzbek, everything else as is. */
export function keyText(groupBy: AiGroupBy, key: string): string {
  if (groupBy === "day") return fmtIsoDate(key);
  return key === "unknown" ? "noma'lum" : key;
}

/* ───────────────────────────── client-side sort ───────────────────────────── */

export type CostSortField = "key" | "calls" | "input" | "output" | "units" | "usd";
export const COST_SORT_FIELDS: ReadonlyArray<CostSortField> = ["key", "calls", "input", "output", "units", "usd"];
export const DEFAULT_COST_SORT = "usd_desc";

/** `usd_desc` → field + direction; anything not whitelisted falls back to the default. */
export function parseCostSort(raw: string | null): { field: CostSortField; dir: "asc" | "desc"; value: string } {
  const m = /^([a-z]+)_(asc|desc)$/.exec(raw ?? "");
  if (m && (COST_SORT_FIELDS as readonly string[]).includes(m[1])) return { field: m[1] as CostSortField, dir: m[2] as "asc" | "desc", value: raw as string };
  return { field: "usd", dir: "desc", value: DEFAULT_COST_SORT };
}

const FIELD_OF: Record<Exclude<CostSortField, "key">, (r: AiCostRow) => number> = {
  calls: (r) => r.calls,
  input: (r) => r.inputTokens,
  output: (r) => r.outputTokens,
  units: (r) => r.units ?? -1,
  usd: (r) => r.usd,
};

/** Sorted copy; ties keep the key order so the table never shuffles. */
export function sortCostRows(rows: ReadonlyArray<AiCostRow>, sort: { field: CostSortField; dir: "asc" | "desc" }): AiCostRow[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const primary = sort.field === "key" ? a.key.localeCompare(b.key) : FIELD_OF[sort.field](a) - FIELD_OF[sort.field](b);
    return primary !== 0 ? sign * primary : a.key.localeCompare(b.key);
  });
}
