"use client";

import { adminGet, adminSend, type AdminCallOptions } from "./core";

/**
 * Pricing and unit economics API (docs/admin/02-plan.md §17.5, `pricing.view`
 * / `pricing.edit`). Thin typed wrappers over `core.ts` (AbortSignal, 401
 * `reauth` step-up + one retry, 403/404 classes).
 *
 * Types are declared here, not imported from `lib/server/**` or `lib/tools`:
 * the server sends everything the screen needs (titles, units, ladders,
 * effective prices), so the admin client never prices anything itself.
 */

export type PriceRoundTo = 100 | 500 | 1000;
export type PriceAdjust = { percent: number; roundTo: PriceRoundTo };
export const PRICE_ROUND_TO: readonly PriceRoundTo[] = [100, 500, 1000];
export const PRICE_PERCENT_MIN = 25;
export const PRICE_PERCENT_MAX = 1000;

export type PricingUnit = "slide" | "page" | "kchars" | "image" | "term" | "job";
export type ToolGroupId = "umumiy" | "talaba" | "oqituvchi" | "oyinlar" | "media";

export type LadderRow = { label: string; base: number; effective: number };

export type TrendPoint = {
  /** `YYYY-MM-DD` (Asia/Tashkent). */
  day: string;
  /** Average full cost per completed job that day, so'm; `null` when nothing completed. */
  avgCostSoum: number | null;
  jobs: number;
};

export type PricingItem = {
  toolId: string;
  title: string;
  group: ToolGroupId;
  unit: PricingUnit;
  unitLabel: string;
  adjust: PriceAdjust;
  ladder: LadderRow[];
  jobs: number;
  completed: number;
  failed: number;
  failRate: number | null;
  refundRate: number | null;
  avgPrice: number | null;
  avgCashRevenue: number | null;
  avgUnits: number | null;
  avgCostUsd: number | null;
  avgCostSoum: number | null;
  overheadUsd: number | null;
  overheadSoum: number | null;
  fullCostSoum: number | null;
  costPerUnitSoum: number | null;
  marginPct: number | null;
  markup: number | null;
  coveragePct: number | null;
  jobsWithCost: number;
  recommendedPercent: number | null;
  sampleSize: number;
  confidence: "low" | "ok";
  trend: TrendPoint[];
};

export type PricingTotals = {
  jobs: number;
  completed: number;
  cashRevenue: number;
  costUsd: number;
  costSoum: number;
  marginPct: number | null;
};

export type PricingOverview = {
  range: { from: string; to: string; days: number };
  items: PricingItem[];
  totals: PricingTotals;
  /** `finance.soum_per_usd`. */
  fx: number;
  /** `pricing.target_markup`. */
  targetMarkup: number;
  groups: ReadonlyArray<{ id: ToolGroupId; label: string }>;
  caveats: string[];
};

export type PriceHistoryRow = {
  id: string;
  at: string;
  admin: string | null;
  oldPercent: number;
  newPercent: number;
  oldRoundTo: number;
  newRoundTo: number;
  reason: string;
};

export type PricingDetail = {
  tool: { toolId: string; title: string; group: ToolGroupId; unit: PricingUnit; unitLabel: string; adjust: PriceAdjust };
  range: { from: string; to: string; days: number };
  trend: TrendPoint[];
  history: PriceHistoryRow[];
  ladder: LadderRow[];
  fx: number;
};

export type Projection = { revenue30d: number; cost30d: number; marginPct: number | null };

export type Simulation = {
  toolId: string;
  proposed: PriceAdjust;
  ladder: LadderRow[];
  window: { from: string; to: string; days: number };
  current: Projection & { jobs: number };
  projected: Projection;
  partial: boolean;
  fx: number;
};

export type PricingItemResult = { toolId: string; title: string; adjust: PriceAdjust; ladder: LadderRow[]; history: PriceHistoryRow[] };

export function getPricing(params: { from: string; to: string }, opts: AdminCallOptions = {}): Promise<PricingOverview> {
  return adminGet<PricingOverview>("/api/admin/pricing", params, opts);
}

function pathOf(toolId: string): string {
  return `/api/admin/pricing/${encodeURIComponent(toolId)}`;
}

export function getPricingDetail(toolId: string, days: number, opts: AdminCallOptions = {}): Promise<PricingDetail> {
  return adminGet<PricingDetail>(pathOf(toolId), { days }, opts);
}

export function simulatePricing(toolId: string, adjust: PriceAdjust, opts: AdminCallOptions = {}): Promise<Simulation> {
  return adminSend<Simulation>("POST", `${pathOf(toolId)}/simulate`, adjust, opts);
}

/** Sets the adjustment (needs a fresh step-up; the core asks for it). */
export function updatePricing(toolId: string, adjust: PriceAdjust, reason: string, opts: AdminCallOptions = {}): Promise<{ item: PricingItemResult }> {
  return adminSend<{ item: PricingItemResult }>("PUT", pathOf(toolId), { ...adjust, reason }, opts);
}

/** Back to 100 % (the code formula). */
export function resetPricing(toolId: string, reason: string, opts: AdminCallOptions = {}): Promise<{ item: PricingItemResult }> {
  return adminSend<{ item: PricingItemResult }>("DELETE", pathOf(toolId), { reason }, opts);
}
