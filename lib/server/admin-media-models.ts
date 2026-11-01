import "server-only";
import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { adminTx } from "./admin-audit";
import { parseReason } from "./admin-accounts";
import type { AdminActor } from "./admin-handler";
import { getToolPricing } from "./pricing";
import { ensureProviderKeys } from "./providers/store";
import { getProviderKey, isProviderEnabled } from "./providers/resolve";
import { modelAvailable } from "./media/availability";
import { invalidateMediaOverrides, readOverrides, type ModelOverride } from "./media/overrides";
import { mediaPricing } from "./media/pricing";
import { applyPriceAdjust } from "../price-adjust";
import { costUsd, isValidMarkup, MARKUP_MAX, MARKUP_MIN, normalize } from "../studio-core";
import { MEDIA_CATALOG, MEDIA_PURPOSES, STUDIO_IMAGE_PURPOSE } from "../media/catalog";
import { markupOf, studioImagePrice } from "../media/studio-pricing";

/**
 * Admin «Narxlar» → «Media modellari» (docs/studio/P1-SPEC.md «Admin»): per Studio model the provider cost of ONE unit
 * (USD and so'm), the price the user pays for it at the current markup (+ the tool's `tool_pricing` %, exactly as
 * `effectivePrice` charges), the margin, the enable switch and the markup override.
 *
 * Money rule: the price shown here is computed by the SAME function the server charges with (`studioImagePrice` over
 * `mediaPricing()`), never a second formula. Writes: `pricing.edit` permission (step-up), a reason, an audit row with
 * before/after in the same transaction, an optional `expected` state (409 `stale` when someone changed it meanwhile).
 */

/** Models this block manages: the ones the Studio sells (cost × markup). Other catalog entries keep their tool prices. */
export function managedModelIds(): string[] {
  return [...MEDIA_PURPOSES.byId(STUDIO_IMAGE_PURPOSE)!.allowed];
}

export type MediaModelItem = {
  modelId: string;
  label: string;
  maker: string;
  kind: string;
  /** What one unit is (`rasm`). */
  unit: string;
  costUsd: number;
  costSoum: number;
  /** Provider switched on in «Provayderlar» and keyed. */
  providerReady: boolean;
  /** The admin switch (`media_model_overrides.enabled`; absent = on). */
  enabled: boolean;
  /** Sold right now (the Studio picker lists it). */
  available: boolean;
  /** The model's own markup, `null` = the global one. */
  markupOverride: number | null;
  markup: number;
  /** Price of one unit before / after the tool's `tool_pricing` %. */
  priceBase: number;
  price: number;
  marginSoum: number;
  marginPct: number | null;
  updatedAt: string | null;
};

export type MediaModelsOverview = {
  soumPerUsd: number;
  markup: number;
  step: number;
  markupMin: number;
  markupMax: number;
  models: MediaModelItem[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function mediaModelsOverview(): Promise<MediaModelsOverview> {
  await ensureProviderKeys();
  const [pricing, overrides, adj] = await Promise.all([mediaPricing(), readOverrides(), getToolPricing("studio-image")]);
  const models = managedModelIds().map((id): MediaModelItem => {
    const entry = MEDIA_CATALOG.byId(id)!;
    const one = { modelId: id, imageCount: 1 };
    const usd = costUsd(entry.cost, normalize(entry.params, one));
    const costSoum = round2(usd * pricing.soumPerUsd);
    const priceBase = studioImagePrice(one, pricing)!;
    const price = applyPriceAdjust(priceBase, adj);
    const o = overrides.get(id);
    return {
      modelId: id,
      label: entry.label,
      maker: entry.maker,
      kind: entry.kind,
      unit: "rasm",
      costUsd: usd,
      costSoum,
      providerReady: entry.routes.some((r) => isProviderEnabled(r.provider) && Boolean(getProviderKey(r.provider))),
      enabled: o?.enabled !== false,
      available: modelAvailable(id, overrides),
      markupOverride: o?.markup ?? null,
      markup: markupOf(pricing, id),
      priceBase,
      price,
      marginSoum: round2(price - costSoum),
      marginPct: price > 0 ? round2(((price - costSoum) / price) * 100) : null,
      updatedAt: o?.updatedAt ?? null,
    };
  });
  return { soumPerUsd: pricing.soumPerUsd, markup: pricing.markup, step: pricing.step, markupMin: MARKUP_MIN, markupMax: MARKUP_MAX, models };
}

type State = { enabled: boolean; markup: number | null };

function stateOf(o: ModelOverride | undefined): State {
  return { enabled: o?.enabled !== false, markup: o?.markup ?? null };
}

const sameState = (a: State, b: State) => a.enabled === b.enabled && a.markup === b.markup;

export function requireManagedModel(raw: unknown): string {
  if (typeof raw === "string" && managedModelIds().includes(raw)) return raw;
  throw new ApiError("Bunday media model yo'q", 404, { code: "not_found" });
}

/** `{enabled, markup}` of a body: `enabled` boolean, `markup` a number 1–20 or `null` (= the global markup). */
export function parseModelState(body: Record<string, unknown>, label = ""): State {
  const { enabled, markup } = body;
  if (typeof enabled !== "boolean") throw new ApiError(`${label}enabled true yoki false bo'lishi kerak`, 400);
  if (markup !== null && !isValidMarkup(markup)) throw new ApiError(`${label}Ustama ${MARKUP_MIN} dan ${MARKUP_MAX} gacha son bo'lishi kerak (yoki umumiy ustama uchun bo'sh)`, 400);
  // NUMERIC(6,3): what is stored is what is compared afterwards.
  return { enabled, markup: markup === null ? null : Math.round((markup as number) * 1000) / 1000 };
}

/** Optional `expected: {enabled, markup}`: the state the admin was looking at (absent = no check). */
function parseExpectedState(raw: unknown): State | null {
  if (raw === undefined) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ApiError("expected {enabled, markup} bo'lishi kerak", 400);
  return parseModelState(raw as Record<string, unknown>, "expected: ");
}

async function lockModel(client: PoolClient, modelId: string): Promise<State> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`media_model_overrides:${modelId}`]);
  return stateOf((await readOverrides(client)).get(modelId));
}

/**
 * PUT `{modelId, enabled, markup, reason, expected?}`. In ONE transaction: upsert / delete the override row (the
 * default state — on, global markup — is «no row») and write the audit row `media_model.update` with before/after.
 * Unchanged → 409 `state`; `expected` no longer current → 409 `stale`; both write nothing. After COMMIT this process's
 * override cache is dropped (others within 30 s; the `expectedPrice` guard covers the gap).
 */
export async function updateMediaModel(admin: AdminActor, body: Record<string, unknown>): Promise<MediaModelsOverview> {
  const modelId = requireManagedModel(body.modelId);
  const next = parseModelState(body);
  const expected = parseExpectedState(body.expected);
  const reason = parseReason(body.reason)!;
  await adminTx(admin, async (client, audit) => {
    const prev = await lockModel(client, modelId);
    if (expected && !sameState(prev, expected)) {
      throw new ApiError("Model sozlamasi boshqa admin tomonidan o'zgartirilgan. Sahifani yangilab, qayta ko'rib chiqing.", 409, { code: "stale" });
    }
    if (sameState(prev, next)) throw new ApiError("Model sozlamasi allaqachon shunday", 409, { code: "state" });
    if (next.enabled && next.markup === null) {
      await client.query("DELETE FROM media_model_overrides WHERE model_id = $1", [modelId]);
    } else {
      await client.query(
        `INSERT INTO media_model_overrides (model_id, enabled, markup, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (model_id) DO UPDATE SET enabled = EXCLUDED.enabled, markup = EXCLUDED.markup,
           updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [modelId, next.enabled ? null : false, next.markup, admin.id],
      );
    }
    await audit({ action: "media_model.update", targetType: "media_model", targetId: modelId, reason, before: prev, after: next });
  });
  invalidateMediaOverrides();
  return mediaModelsOverview();
}
