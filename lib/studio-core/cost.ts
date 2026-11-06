import type { NormalizedParams } from "./params";

/**
 * CostRule — what ONE job costs us at the provider, in USD, read from the provider's price page
 * (docs/studio/P0-SPEC.md §3.3). It is the QUOTE; the actual spend of a call is metered separately (`ai_usage`), and a
 * test keeps the two in agreement for every model both know.
 *
 *   job     flat per job;
 *   output  per produced item (image), × the `countParam` value (1 when absent); `by` swaps the unit price by a param
 *           value (quality, resolution);
 *   second  per second of output (video, music), × the `secondsParam` value; `by` as above; × the `countParam` value
 *           (1 when absent) when one job makes several clips (Studio P6 sound-effect variants); `unitSeconds`: the
 *           provider bills whole units of that many seconds, rounded up, at least one (fal dubbing, VEED: per started
 *           minute, so 15 s costs a full minute and the quote must say so);
 *   kchar   per 1 000 characters of the `textParam` value (speech).
 */
export type CostTable = { param: string; table: Readonly<Record<string, number>> };

export type CostRule =
  | { per: "job"; usd: number }
  | { per: "output"; usd: number; countParam?: string; by?: CostTable }
  | { per: "second"; usd: number; secondsParam: string; countParam?: string; by?: CostTable; unitSeconds?: number }
  | { per: "kchar"; usd: number; textParam: string };

function unit(usd: number, by: CostTable | undefined, p: NormalizedParams): number {
  if (!by) return usd;
  const hit = by.table[String(p[by.param])];
  return hit === undefined ? usd : hit;
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Seconds the provider bills: the length itself, or the whole units it starts (at least one). */
function billed(seconds: number, unitSeconds: number | undefined): number {
  return unitSeconds ? Math.max(1, Math.ceil(seconds / unitSeconds)) * unitSeconds : seconds;
}

export function costUsd(rule: CostRule, p: NormalizedParams): number {
  switch (rule.per) {
    case "job":
      return rule.usd;
    case "output":
      return unit(rule.usd, rule.by, p) * (rule.countParam ? num(p[rule.countParam], 1) : 1);
    case "second":
      return unit(rule.usd, rule.by, p) * billed(num(p[rule.secondsParam], 0), rule.unitSeconds) * (rule.countParam ? num(p[rule.countParam], 1) : 1);
    case "kchar":
      return (rule.usd * String(p[rule.textParam] ?? "").length) / 1000;
  }
}
