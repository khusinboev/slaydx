import { IMAGE_PRICES, PRICING } from "../../generation/llm-pricing";
import { isProviderId, type ProviderId } from "./registry";

/**
 * Routing slots the admin «Provayderlar» page can set (owner request 2026-10-31): WHICH provider and model serve a
 * purpose, in priority order. The registry of slots is data only (no secrets, no I/O), so the generation layer, the
 * loader, the admin API and the tests all read one list.
 *
 *   shape  chain  an ordered list of provider:model (the LLM roles: the first that answers wins, the next is the
 *                 fallback);
 *          model  exactly one model of a fixed provider (the default Gemini text model, the Gemini image model);
 *          order  an ordered list of providers, no models (text-to-speech: which voice provider runs first).
 *
 * A slot WITHOUT a stored row keeps today's behaviour: the `LLM_*` / `GEMINI_*` env value, else the built-in
 * default. A stored row beats the env, the same rule as provider keys (`resolve.ts`).
 *
 * Models are limited to the ones the price book knows (`llm-pricing.ts`): a model without a price would make
 * every cost report show a silent $0, so the admin cannot select it. Adding a priced model makes it selectable.
 */

export const ROUTE_IDS = ["llm.model", "llm.writer", "llm.researcher", "llm.judge", "llm.fast", "image.gemini", "tts.order"] as const;
export type RouteId = (typeof ROUTE_IDS)[number];

export type RouteShape = "chain" | "model" | "order";

export type RouteEntry = { provider: ProviderId; model: string | null };

export type RouteSpec = {
  id: RouteId;
  shape: RouteShape;
  /** Providers allowed in this slot. */
  providers: readonly ProviderId[];
  /** Longest list the admin may save. */
  max: number;
};

export const ROUTE_SPECS: Readonly<Record<RouteId, RouteSpec>> = {
  "llm.model": { id: "llm.model", shape: "model", providers: ["gemini"], max: 1 },
  "llm.writer": { id: "llm.writer", shape: "chain", providers: ["gemini", "anthropic"], max: 4 },
  "llm.researcher": { id: "llm.researcher", shape: "chain", providers: ["gemini", "anthropic"], max: 4 },
  "llm.judge": { id: "llm.judge", shape: "chain", providers: ["gemini", "anthropic"], max: 4 },
  "llm.fast": { id: "llm.fast", shape: "chain", providers: ["gemini", "anthropic"], max: 4 },
  "image.gemini": { id: "image.gemini", shape: "model", providers: ["gemini"], max: 1 },
  "tts.order": { id: "tts.order", shape: "order", providers: ["azure", "aisha", "gemini"], max: 3 },
};

export function isRouteId(v: unknown): v is RouteId {
  return typeof v === "string" && (ROUTE_IDS as readonly string[]).includes(v);
}

export type ModelOption = {
  provider: ProviderId;
  model: string;
  /** Text price per 1M tokens (LLM slots), USD; `null` for image models. */
  inUsdPerM: number | null;
  outUsdPerM: number | null;
  /** USD per image (image slots); `null` for text models. */
  perImageUsd: number | null;
};

/** The row of `PRICING` that applies on `at` (the latest `from <= at`, else the base row). */
function currentRow(provider: string, model: string, at: Date) {
  const rows = PRICING.filter((r) => r.provider === provider && r.model === model);
  const dated = rows.filter((r) => r.from && new Date(r.from).getTime() <= at.getTime()).sort((a, b) => (b.from ?? "").localeCompare(a.from ?? ""));
  return dated[0] ?? rows.find((r) => !r.from) ?? rows[0];
}

/** Every model the admin may pick in `id`'s slot, from the price book. Empty for an `order` slot. */
export function modelOptions(id: RouteId, at: Date = new Date()): ModelOption[] {
  const spec = ROUTE_SPECS[id];
  if (spec.shape === "order") return [];
  if (id === "image.gemini") {
    return Object.keys(IMAGE_PRICES)
      .filter((m) => m.startsWith("gemini-"))
      .map((model) => ({ provider: "gemini" as ProviderId, model, inUsdPerM: null, outUsdPerM: null, perImageUsd: IMAGE_PRICES[model] }));
  }
  const seen = new Set<string>();
  const out: ModelOption[] = [];
  for (const r of PRICING) {
    if (!spec.providers.includes(r.provider as ProviderId)) continue;
    const key = `${r.provider}:${r.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = currentRow(r.provider, r.model, at)!;
    out.push({ provider: r.provider as ProviderId, model: r.model, inUsdPerM: row.inUsdPerM, outUsdPerM: row.outUsdPerM, perImageUsd: null });
  }
  return out;
}

export type RouteCheck = { ok: true; entries: RouteEntry[] } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Validates a candidate value of `id` (the admin request body, and every stored row the loader reads): a JSON array
 * of `{provider, model?}` that respects the slot's shape. Returns the normalised entries or a Uzbek error.
 */
export function checkRoute(id: RouteId, raw: unknown): RouteCheck {
  const spec = ROUTE_SPECS[id];
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "Kamida bitta provayder tanlang" };
  if (raw.length > spec.max) return { ok: false, error: `Eng ko'pi bilan ${spec.max} ta bo'lishi mumkin` };
  if (spec.shape === "model" && raw.length !== 1) return { ok: false, error: "Faqat bitta model tanlanadi" };
  const options = modelOptions(id);
  const seen = new Set<string>();
  const entries: RouteEntry[] = [];
  for (const item of raw) {
    if (!isObj(item)) return { ok: false, error: "Yozuv noto'g'ri" };
    const provider = item.provider;
    if (!isProviderId(provider) || !spec.providers.includes(provider)) return { ok: false, error: "Bu vazifa uchun bunday provayder yaroqsiz" };
    let model: string | null = null;
    if (spec.shape === "order") {
      if (item.model !== undefined && item.model !== null && item.model !== "") return { ok: false, error: "Ovoz tartibida model tanlanmaydi" };
    } else {
      if (typeof item.model !== "string" || !options.some((o) => o.provider === provider && o.model === item.model)) {
        return { ok: false, error: "Model narxlar jadvalida yo'q: faqat ro'yxatdagi modelni tanlang" };
      }
      model = item.model;
    }
    const key = `${provider}:${model ?? ""}`;
    if (seen.has(key)) return { ok: false, error: "Bir xil yozuv ikki marta kiritilgan" };
    seen.add(key);
    entries.push({ provider, model });
  }
  return { ok: true, entries };
}
