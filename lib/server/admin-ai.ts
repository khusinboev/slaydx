import "server-only";
import type { PoolClient } from "pg";
import { falKey } from "../generation/image-provider-fal";
import { pexelsKey } from "../generation/image-provider-pexels";
import { pixabayKey } from "../generation/image-provider-pixabay";
import { aishaKey } from "../generation/tts/aisha";
import { azureKey, azureRegion } from "../generation/tts/azure";
import { geminiKey } from "../generation/tts/gemini";
import { ApiError } from "./api";
import { COST_CAVEATS, soumPerUsd, spendBy, spendByProviderModel, spendCoverage, spendTotals, type SpendCoverage, type SpendGroupBy, type SpendRange } from "./admin-cost";
import { parseDateRange, type DateRange } from "./admin-list";
import { isStale } from "./admin-heartbeat";
import { env } from "./env";
import { transaction, query } from "./db";

/**
 * AI cost and provider health for the admin panel (docs/admin/02-plan.md §6.7,
 * §7.1 S11, §9, §10 T12).
 *
 * Money comes ONLY from `admin-cost.ts` (the canonical spend definition), so
 * this screen, the dashboard and pricing always agree. This module adds the
 * HTTP-facing parts: parameter parsing, the READ ONLY + statement_timeout
 * transaction, a 60 s in-process cache, provider key presence (booleans only,
 * a key value never leaves this module) and process heartbeats.
 */

/** The API's `groupBy` values; each is a `SpendGroupBy` of the same name (`outcome` is not exposed). */
export const AI_GROUP_BY = ["day", "tool", "provider", "model", "kind"] as const satisfies readonly SpendGroupBy[];
export type AiGroupBy = (typeof AI_GROUP_BY)[number];

/** Default `groupBy` when the param is absent. */
export const AI_DEFAULT_GROUP_BY: AiGroupBy = "day";

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 200;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Cost

export type AiCostRow = {
  /** day → YYYY-MM-DD (Asia/Tashkent); tool → tool id; provider/model/kind → the part's value. */
  key: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Images / grounding queries / TTS characters; `null` for day and tool (units of different kinds). */
  units: number | null;
  usd: number;
  /** Spend rows contributing to this key. */
  records: number;
  /** Calls recorded at usd 0 because no price is known. */
  unpricedCalls: number;
};

export type AiCostTotals = {
  records: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  /** Sum of the rows' `unpricedCalls` (the same for every grouping). */
  unpricedCalls: number;
};

export type AiCostBody = {
  range: { from: string; to: string; days: number };
  groupBy: AiGroupBy;
  rows: AiCostRow[];
  totals: AiCostTotals;
  coverage: SpendCoverage;
  caveats: string[];
  /** `finance.soum_per_usd`: the so'm equivalent of every dollar figure. */
  soumPerUsd: number;
};

type CostPayload = Omit<AiCostBody, "soumPerUsd">;

/** Query parameters of `GET /api/admin/ai/cost`; anything malformed is a 400. */
export function parseAiCostParams(url: URL): { range: DateRange; groupBy: AiGroupBy } {
  const single = (name: string): string | null => {
    const all = url.searchParams.getAll(name);
    if (all.length > 1) throw new ApiError(`Noto'g'ri parametr: ${name}`, 400);
    return all[0] ? all[0] : null;
  };
  const range = parseDateRange(single("from"), single("to"));
  const raw = single("groupBy");
  if (raw !== null && !(AI_GROUP_BY as readonly string[]).includes(raw)) throw new ApiError("Noto'g'ri parametr: groupBy", 400);
  return { range, groupBy: (raw ?? AI_DEFAULT_GROUP_BY) as AiGroupBy };
}

/** pg's `statement_timeout` cancel (57014) becomes a clear 503 instead of a 500. */
function mapTimeout(e: unknown): never {
  if ((e as { code?: string } | null)?.code === "57014") {
    throw new ApiError("So'rov juda uzoq davom etdi. Oraliqni qisqartirib qayta urinib ko'ring.", 503, { code: "timeout" });
  }
  throw e;
}

/** Aggregations run in a bounded, read-only transaction (plan §9). */
export async function aiReadOnlyTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  try {
    return await transaction(async (client) => {
      await client.query("SET TRANSACTION READ ONLY");
      await client.query("SET LOCAL statement_timeout = '10s'");
      return fn(client);
    });
  } catch (e) {
    return mapTimeout(e);
  }
}

type CacheEntry<T> = { at: number; value: T };
const cache = new Map<string, CacheEntry<unknown>>();

/** Test seam: drops every cached response. */
export function clearAiCache(): void {
  cache.clear();
}

async function cached<T>(key: string, load: () => Promise<T>, now: () => number = Date.now): Promise<T> {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  const t = now();
  if (hit && t - hit.at < CACHE_TTL_MS) return hit.value;
  const value = await load();
  cache.delete(key);
  cache.set(key, { at: t, value });
  // Bounded: evict the oldest entry (Map keeps insertion order).
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return value;
}

/** Cost rows, totals, coverage and caveats for `range`, grouped by `groupBy`. */
export async function aiCost(range: DateRange, groupBy: AiGroupBy): Promise<AiCostBody> {
  const key = `cost|${range.fromDay}|${range.toDay}|${groupBy}`;
  const payload = await cached<CostPayload>(key, () =>
    aiReadOnlyTx(async (client) => {
      const spendRange: SpendRange = { fromTs: range.fromTs, toTsExclusive: range.toTsExclusive };
      const rows = await spendBy(client, spendRange, groupBy);
      const totals = await spendTotals(client, spendRange);
      const coverage = await spendCoverage(client, spendRange);
      return {
        range: { from: range.fromDay, to: range.toDay, days: range.days },
        groupBy,
        rows: rows.map((r) => ({
          key: r.key,
          calls: r.calls,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          units: r.units,
          usd: r.usd,
          records: r.records,
          unpricedCalls: r.unpricedCalls,
        })),
        totals: { ...totals, unpricedCalls: rows.reduce((a, r) => a + r.unpricedCalls, 0) },
        coverage,
        caveats: [...COST_CAVEATS],
      };
    }),
  );
  // The rate is read per request (it has its own settings cache), so a changed
  // `finance.soum_per_usd` shows at once even while the aggregates are cached.
  return { ...payload, soumPerUsd: await soumPerUsd() };
}

// ---------------------------------------------------------------------------
// Providers

export const PROVIDER_KEY_NAMES = ["gemini", "anthropic", "openai", "openrouter", "xai", "fal", "pexels", "pixabay", "azureTts", "aisha"] as const;
export type ProviderKeyName = (typeof PROVIDER_KEY_NAMES)[number];
export type ProviderKeys = Record<ProviderKeyName, boolean>;

const present = (v: string | undefined | null): boolean => Boolean(v && v.trim());

/**
 * Which provider keys are configured. Booleans only (T12): the value is read
 * inside `Boolean(...)` and never stored, logged or returned. The accessors are
 * the ones the product code itself calls, so "true" means "the provider is
 * usable by this process". Anthropic, OpenAI and OpenRouter adapters read
 * `process.env` directly (no accessor exists), so the same names are read here.
 * `azureTts` needs both the key and the region, as `ttsConfigured()` does.
 */
export function providerKeys(): ProviderKeys {
  return {
    gemini: present(geminiKey()),
    anthropic: present(process.env.ANTHROPIC_API_KEY),
    openai: present(process.env.OPENAI_API_KEY),
    openrouter: present(process.env.OPENROUTER_API_KEY),
    xai: present(env.xai.key),
    fal: present(falKey()),
    pexels: present(pexelsKey()),
    pixabay: present(pixabayKey()),
    azureTts: present(azureKey()) && present(azureRegion()),
    aisha: present(aishaKey()),
  };
}

export type AiProcess = { process: string; role: "web" | "worker"; lastSeenAt: string; stale: boolean };
export type AiBreaker = { process: string; name: string; state: "closed" | "open" | "half-open"; openUntil: string | null; failures: number; stale: boolean };
export type AiLimiter = { process: string; name: string; active: number; waiting: number; max: number; stale: boolean };
export type AiUsage24h = { provider: string; model: string; calls: number; usd: number };

export type AiProvidersBody = {
  keys: ProviderKeys;
  processes: AiProcess[];
  breakers: AiBreaker[];
  limiters: AiLimiter[];
  usage24h: AiUsage24h[];
  /** `finance.soum_per_usd` for the so'm equivalent of `usd`. */
  soumPerUsd: number;
};

type HeartbeatRow = {
  process_id: string;
  role: string;
  last_seen_at: Date | string;
  breakers: unknown;
  limiters: unknown;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nonNegInt = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(Math.round(v), 1_000_000_000)) : 0);
const text = (v: unknown, max = 120): string | null => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : null);
const BREAKER_STATES = ["closed", "open", "half-open"] as const;

/** Heartbeat JSONB is written by our own code, but a hand-edited row must not break the page. */
export function parseBreakers(raw: unknown, process: string, stale: boolean): AiBreaker[] {
  if (!Array.isArray(raw)) return [];
  const out: AiBreaker[] = [];
  for (const b of raw.slice(0, 200)) {
    if (!isObj(b)) continue;
    const name = text(b.name);
    if (!name) continue;
    const state = (BREAKER_STATES as readonly unknown[]).includes(b.state) ? (b.state as AiBreaker["state"]) : "closed";
    const openUntil = typeof b.openUntil === "string" && Number.isFinite(Date.parse(b.openUntil)) ? b.openUntil : null;
    out.push({ process, name, state, openUntil, failures: nonNegInt(b.failures), stale });
  }
  return out;
}

export function parseLimiters(raw: unknown, process: string, stale: boolean): AiLimiter[] {
  if (!Array.isArray(raw)) return [];
  const out: AiLimiter[] = [];
  for (const l of raw.slice(0, 200)) {
    if (!isObj(l)) continue;
    const name = text(l.name);
    if (!name) continue;
    out.push({ process, name, active: nonNegInt(l.active), waiting: nonNegInt(l.waiting), max: nonNegInt(l.max), stale });
  }
  return out;
}

/** Key presence, per-process breakers and limiters, and the last 24 hours of spend by provider/model. */
export async function aiProviders(nowMs: number = Date.now()): Promise<AiProvidersBody> {
  const beats = await query<HeartbeatRow>(
    `SELECT process_id, role, last_seen_at, breakers, limiters
       FROM process_heartbeats
      ORDER BY process_id
      LIMIT 200`,
  );

  const processes: AiProcess[] = [];
  const breakers: AiBreaker[] = [];
  const limiters: AiLimiter[] = [];
  for (const b of beats) {
    const stale = isStale(b.last_seen_at, nowMs);
    processes.push({
      process: b.process_id,
      role: b.role === "worker" ? "worker" : "web",
      lastSeenAt: new Date(b.last_seen_at).toISOString(),
      stale,
    });
    breakers.push(...parseBreakers(b.breakers, b.process_id, stale));
    limiters.push(...parseLimiters(b.limiters, b.process_id, stale));
  }

  // Rolling window; cached 60 s like every aggregate, keyed by the minute.
  const usage24h = await cached<AiUsage24h[]>(`usage24h|${Math.floor(nowMs / CACHE_TTL_MS)}`, () =>
    aiReadOnlyTx((client) =>
      spendByProviderModel(client, { fromTs: new Date(nowMs - DAY_MS).toISOString(), toTsExclusive: new Date(nowMs).toISOString() }).then((rows) =>
        rows.map((r) => ({ provider: r.provider, model: r.model, calls: r.calls, usd: r.usd })),
      ),
    ),
  );

  return { keys: providerKeys(), processes, breakers, limiters, usage24h, soumPerUsd: await soumPerUsd() };
}
