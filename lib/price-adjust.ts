import type { ToolId } from "./types";
import { TOOL_IDS } from "./tool-kinds";

/*
 * Admin price adjustment (docs/admin/02-plan.md §17.2, §17.7).
 *
 * Moved out of `lib/tools.ts` (ops sprint WP-B phase 1): `lib/store.ts`
 * applies the session's adjustments on every route, and importing them from
 * `lib/tools.ts` shipped the whole tool registry (~40 kB gz) to admin, login
 * and the public game page. `lib/tools.ts` re-exports everything here, and
 * `priceFor` there stays the single source of displayed prices.
 */

export type PriceAdjust = { percent: number; roundTo: 100 | 500 | 1000 };
export type PriceAdjustMap = Partial<Record<ToolId, PriceAdjust>>;

/** Bounds of `tool_pricing` (032_pricing.sql CHECK constraints). */
export const PRICE_PERCENT_MIN = 25;
export const PRICE_PERCENT_MAX = 1000;
export const PRICE_ROUND_TO: readonly PriceAdjust["roundTo"][] = [100, 500, 1000];

export function isPriceAdjust(v: unknown): v is PriceAdjust {
  if (!v || typeof v !== "object") return false;
  const { percent, roundTo } = v as Record<string, unknown>;
  return (
    typeof percent === "number" &&
    Number.isInteger(percent) &&
    percent >= PRICE_PERCENT_MIN &&
    percent <= PRICE_PERCENT_MAX &&
    (PRICE_ROUND_TO as readonly unknown[]).includes(roundTo)
  );
}

/**
 * Effective price from the base formula and an admin adjustment. 100 % (or
 * no adjustment) is exactly `base`, so an empty `tool_pricing` table changes
 * nothing. An out-of-bounds adjustment can only come from a bug or a
 * hand-edited payload; on the money path the safe answer is the base price.
 */
export function applyPriceAdjust(base: number, adj?: PriceAdjust | null): number {
  if (!adj || adj.percent === 100 || !isPriceAdjust(adj)) return base;
  return Math.max(adj.roundTo, Math.round((base * adj.percent) / 100 / adj.roundTo) * adj.roundTo);
}

/**
 * Validated copy of an untrusted map (the session payload). Unknown tools,
 * invalid entries and 100 % entries (no-ops) are dropped.
 */
export function parsePriceAdjustments(raw: unknown): PriceAdjustMap {
  const out: PriceAdjustMap = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const id of TOOL_IDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, id)) continue;
    const adj = (raw as Record<string, unknown>)[id];
    if (isPriceAdjust(adj) && adj.percent !== 100) out[id] = { percent: adj.percent, roundTo: adj.roundTo };
  }
  return out;
}

/*
 * Client registry. Module-global state is safe here only because it is read
 * exclusively in the browser (`typeof window !== "undefined"`); on the server
 * (SSR, route handlers) the registry is invisible and prices stay base.
 */
let clientAdjustments: PriceAdjustMap = {};

function sameAdjustments(a: PriceAdjustMap, b: PriceAdjustMap): boolean {
  return TOOL_IDS.every((id) => a[id]?.percent === b[id]?.percent && a[id]?.roundTo === b[id]?.roundTo);
}

/**
 * Replaces the client registry (called by `lib/store.ts` on every session
 * refresh). Input is validated. Returns whether the effective map changed,
 * so the store re-renders price displays only when needed.
 */
export function setClientPriceAdjustments(map: unknown): boolean {
  const next = parsePriceAdjustments(map);
  if (sameAdjustments(clientAdjustments, next)) return false;
  clientAdjustments = next;
  return true;
}

/** Adjustment that applies to displayed prices; always `undefined` on the server. */
export function getClientPriceAdjust(toolId: ToolId): PriceAdjust | undefined {
  if (typeof window === "undefined") return undefined;
  return clientAdjustments[toolId];
}

/**
 * Displayed price of a base amount that does not come from `priceFor`
 * (option labels from `ARTICLE_PRICES`, `translationPrice`, `basePrice`, …).
 */
export function clientAdjustedPrice(toolId: ToolId, base: number): number {
  return applyPriceAdjust(base, getClientPriceAdjust(toolId));
}
