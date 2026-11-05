import "server-only";
import type { PoolClient } from "pg";
import { marketPriceOf } from "../../market/pricing";
import { paramsAsFormValues } from "../../market/params";
import { applyPriceAdjust, basePriceFor, isPriceAdjust, TOOL_BY_ID } from "../../tools";
import type { ToolId } from "../../types";
import { ApiError } from "../api";
import { query } from "../db";
import { log } from "../log";
import { effectivePrice } from "../pricing";
import { getSetting, getSettingInTx } from "../settings";
import type { MarketItemRow } from "./store";

/**
 * The market's server price (docs/market/PLAN.md §4). The one function the catalog, the item page, the purchase and the
 * bot all read: the original is the LIVE `effectivePrice` (base × `tool_pricing`), so the market follows the admin's
 * price changes and the percent is on top, never applied twice.
 *
 * Mid-checkout protection needs no global epoch setting: `marketPriceInTx` recomputes the price inside the charge
 * transaction from committed rows (no cache), so any change of a percent, a step, a floor, an override or `tool_pricing`
 * shows up as a different number and the purchase answers 409 `price_changed`.
 */

export type MarketPriceable = Pick<MarketItemRow, "tool_id" | "params_json" | "price_override" | "original_price">;
export type MarketPrice = { price: number; originalPrice: number };

export type MarketPricingConfig = { percent: number; roundTo: number; minPrice: number; toolPercents: ReadonlyMap<string, number> };

const TTL_MS = 15_000;
type ToolPercentCache = { values: Map<string, number>; expiresAt: number };
const g = globalThis as typeof globalThis & { __slaydxMarketToolPercents?: ToolPercentCache };

async function toolPercents(): Promise<ReadonlyMap<string, number>> {
  const c = g.__slaydxMarketToolPercents;
  if (c && Date.now() < c.expiresAt) return c.values;
  try {
    const rows = await query<{ tool_id: string; percent: number }>("SELECT tool_id, percent FROM market_tool_pricing");
    const values = new Map(rows.map((r) => [r.tool_id, Number(r.percent)]));
    g.__slaydxMarketToolPercents = { values, expiresAt: Date.now() + TTL_MS };
    return values;
  } catch (err) {
    log("warn", "[market] market_tool_pricing o'qilmadi — oxirgi qiymatlar ishlatiladi", { err });
    return c?.values ?? new Map();
  }
}

/** Call after the transaction that wrote `market_tool_pricing` has committed. */
export function invalidateMarketPricingCache(): void {
  g.__slaydxMarketToolPercents = undefined;
}

export async function marketPricingConfig(): Promise<MarketPricingConfig> {
  const [percent, roundTo, minPrice, percents] = await Promise.all([
    getSetting("market.percent"),
    getSetting("market.round_to"),
    getSetting("market.min_price"),
    toolPercents(),
  ]);
  return { percent, roundTo, minPrice, toolPercents: percents };
}

const overrideOf = (item: Pick<MarketItemRow, "price_override">): number | null => (item.price_override === null || item.price_override === undefined ? null : Number(item.price_override));

/** The live original: `effectivePrice`, or the approval snapshot when the formula cannot run (a tool gone from the registry). */
async function originalOf(item: MarketPriceable): Promise<number> {
  const tool = TOOL_BY_ID[item.tool_id as ToolId];
  if (!tool) return Number(item.original_price);
  try {
    return await effectivePrice(tool, paramsAsFormValues(tool.id, item.params_json));
  } catch (err) {
    log("warn", "[market] asl narx hisoblanmadi — surat ishlatiladi", { toolId: item.tool_id, err });
    return Number(item.original_price);
  }
}

/** Price shown everywhere. Pass `cfg` when pricing a whole page, so the settings are read once. */
export async function marketPriceForItem(item: MarketPriceable, cfg?: MarketPricingConfig): Promise<MarketPrice> {
  const c = cfg ?? (await marketPricingConfig());
  const original = await originalOf(item);
  const price = marketPriceOf({ original, override: overrideOf(item), percent: c.toolPercents.get(item.tool_id) ?? c.percent, roundTo: c.roundTo, minPrice: c.minPrice });
  return { price, originalPrice: original };
}

/**
 * The same price from committed rows inside the caller's transaction (no 15 s cache). The purchase compares it with
 * `expectedPrice` AFTER locking the item row, so nothing can change the price between the check and the charge.
 */
export async function marketPriceInTx(client: Pick<PoolClient, "query">, item: MarketPriceable): Promise<MarketPrice> {
  const [percent, roundTo, minPrice] = await Promise.all([
    getSettingInTx(client, "market.percent"),
    getSettingInTx(client, "market.round_to"),
    getSettingInTx(client, "market.min_price"),
  ]);
  const toolRow = (await client.query<{ percent: number }>("SELECT percent FROM market_tool_pricing WHERE tool_id = $1", [item.tool_id])).rows[0];
  const adjRow = (await client.query<{ percent: number; round_to: number }>("SELECT percent, round_to FROM tool_pricing WHERE tool_id = $1", [item.tool_id])).rows[0];
  const tool = TOOL_BY_ID[item.tool_id as ToolId];
  let original = Number(item.original_price);
  if (tool) {
    const adj = adjRow ? { percent: Number(adjRow.percent), roundTo: Number(adjRow.round_to) } : null;
    original = applyPriceAdjust(basePriceFor(tool, paramsAsFormValues(tool.id, item.params_json)), isPriceAdjust(adj) ? adj : null);
  }
  const price = marketPriceOf({ original, override: overrideOf(item), percent: toolRow ? Number(toolRow.percent) : percent, roundTo, minPrice });
  return { price, originalPrice: original };
}

/** Per-item absolute price (admin, `pricing.edit`, step-up). `null` clears it. Bumps `price_version`; audit is the caller's. */
export async function setItemPriceOverrideInTx(client: Pick<PoolClient, "query">, itemId: string, price: number | null): Promise<void> {
  if (price !== null && (!Number.isSafeInteger(price) || price < 0)) throw new ApiError("Narx manfiy bo'lmagan butun son bo'lishi kerak", 400);
  const res = await client.query(
    "UPDATE market_items SET price_override = $2, price_version = price_version + 1, updated_at = now() WHERE id = $1",
    [itemId, price],
  );
  if (!res.rowCount) throw new ApiError("Bunday ish yo'q", 404);
}

/** Per-tool share of the original; `null` returns the tool to `market.percent`. Every item of the tool gets a new `price_version`. */
export async function setToolPercentInTx(client: Pick<PoolClient, "query">, toolId: string, percent: number | null, adminId: string | null): Promise<void> {
  if (percent === null) {
    await client.query("DELETE FROM market_tool_pricing WHERE tool_id = $1", [toolId]);
  } else {
    if (!Number.isSafeInteger(percent) || percent < 10 || percent > 100) throw new ApiError("Foiz 10 dan 100 gacha bo'lishi kerak", 400);
    await client.query(
      `INSERT INTO market_tool_pricing (tool_id, percent, updated_by, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (tool_id) DO UPDATE SET percent = EXCLUDED.percent, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [toolId, percent, adminId],
    );
  }
  await client.query("UPDATE market_items SET price_version = price_version + 1, updated_at = now() WHERE tool_id = $1", [toolId]);
}

/** Every per-tool percent, for the admin table. */
export async function listToolPercents(): Promise<{ toolId: string; percent: number }[]> {
  const rows = await query<{ tool_id: string; percent: number }>("SELECT tool_id, percent FROM market_tool_pricing ORDER BY tool_id");
  return rows.map((r) => ({ toolId: r.tool_id, percent: Number(r.percent) }));
}
