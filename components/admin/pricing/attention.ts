import type { PricingItem } from "@/lib/admin-api/pricing";
import { COVERAGE_WARN_PCT, MARGIN_LOW_PCT, recommendationState, type RecContext, type RecState } from "./shared";

/**
 * «Diqqat talab qiladi» (docs/admin/pricing-redesign.md §3): at most one entry per tool —
 * its most severe reason — ranked by severity, then by the money at stake over the period
 * (so'm), then by title. Pure: no React, no I/O.
 */

export type AttentionKind = "loss" | "low-margin" | "no-cost" | "unpriced" | "low-coverage" | "below-target" | "overpriced";
export type Severity = "critical" | "warning" | "info";

export type AttentionEntry = {
  item: PricingItem;
  kind: AttentionKind;
  severity: Severity;
  /** So'm at stake over the period; only orders the list. */
  impactSoum: number;
  rec: RecState;
};

/** How many entries the strip shows; the rest are counted. */
export const ATTENTION_LIMIT = 5;

/** An info-level recommendation (margin already healthy) is listed only from this price change up. */
export const INFO_MIN_CHANGE_PCT = 15;

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/** Net listed revenue of the period's completed jobs, so'm. */
const revenueOf = (i: PricingItem): number => (i.avgRevenueSoum ?? 0) * i.completed;

/** So'm between the markup the tool has and the target one, over the completed jobs (fee-adjusted, like the markup). */
function gapToTarget(i: PricingItem, targetMarkup: number): number {
  if (i.markup === null || i.fullCostSoum === null) return 0;
  return Math.abs(targetMarkup - i.markup) * i.fullCostSoum * i.completed;
}

function entry(item: PricingItem, kind: AttentionKind, severity: Severity, impactSoum: number, rec: RecState): AttentionEntry {
  return { item, kind, severity, impactSoum: Math.max(0, impactSoum), rec };
}

/** The tool's most severe reason for attention, or `null` when nothing needs a decision. */
export function attentionOf(item: PricingItem, ctx: RecContext & { targetMarkup: number }): AttentionEntry | null {
  if (item.completed === 0) return null;
  const rec = recommendationState(item, ctx);
  const applicable = rec.kind === "change" && rec.block === null;
  const revenue = revenueOf(item);
  const margin = item.marginPct;

  if (margin !== null && margin < 0) return entry(item, "loss", "critical", (-margin / 100) * revenue, rec);
  if (margin !== null && margin < MARGIN_LOW_PCT) {
    return entry(item, "low-margin", applicable ? "critical" : "info", gapToTarget(item, ctx.targetMarkup), rec);
  }
  if (item.fullCostSoum === null) return entry(item, "no-cost", "warning", revenue, rec);
  if (item.unpricedCalls > 0) return entry(item, "unpriced", "warning", revenue, rec);
  if (item.coveragePct !== null && item.coveragePct < COVERAGE_WARN_PCT) {
    return entry(item, "low-coverage", "warning", (revenue * (100 - item.coveragePct)) / 100, rec);
  }
  if (rec.kind === "change" && Math.abs(rec.changePct) >= INFO_MIN_CHANGE_PCT) {
    return entry(item, rec.direction === "up" ? "below-target" : "overpriced", "info", gapToTarget(item, ctx.targetMarkup), rec);
  }
  return null;
}

/** Every tool that needs attention, most important first. */
export function attentionList(items: ReadonlyArray<PricingItem>, ctx: RecContext & { targetMarkup: number }): AttentionEntry[] {
  return items
    .map((i) => attentionOf(i, ctx))
    .filter((e): e is AttentionEntry => e !== null)
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.impactSoum - a.impactSoum || a.item.title.localeCompare(b.item.title),
    );
}
