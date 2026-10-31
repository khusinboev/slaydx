import "server-only";
import { aiReadOnlyTx } from "./admin-ai";
import { spendByDayPart } from "./admin-cost";
import { query } from "./db";
import { PROVIDERS, isProviderId } from "./providers/registry";

/**
 * Usage per provider for the admin «Provayderlar» page: today / 7 days / 30 days (Tashkent days, the same days every
 * admin page uses), a 14-day series, what each provider was used for (kind) and its busiest models.
 *
 * Two sources, one answer:
 *   - paid usage (calls, tokens, units, USD) comes from the canonical spend rows (`admin-cost.ts spendByDayPart`),
 *     so this page, the cost page and the dashboard never disagree;
 *   - free providers (stock photos, research APIs) spend no money and leave no spend row, so their request and error
 *     counts come from `provider_calls` (migration 062, written by `provider-usage.ts`).
 *
 * A spend part whose provider is not in the registry any more (fal.ai, xAI, OpenRouter, OpenAI text were removed on
 * 2026-10-31) is NOT hidden: it is listed in `other`, so history never disappears from the totals.
 */

const TZ = "Asia/Tashkent";
const DAY_MS = 86_400_000;
/** The longest window the page shows. */
export const USAGE_DAYS = 30;
/** Days of the sparkline series. */
export const SERIES_DAYS = 14;

export type UsageTotals = {
  calls: number;
  /** Failed requests; `null` when the source does not track failures (paid spend rows). */
  errors: number | null;
  inputTokens: number;
  outputTokens: number;
  /** Images / characters / seconds, whatever the provider's unit is. */
  units: number;
  usd: number;
};

export type KindUsage = { kind: string; calls: number; units: number; inputTokens: number; outputTokens: number; usd: number };
export type ModelUsage = { model: string; kind: string; calls: number; usd: number };
export type DayUsage = { day: string; calls: number; usd: number };

export type ProviderUsage = {
  today: UsageTotals;
  d7: UsageTotals;
  d30: UsageTotals;
  /** Newest Tashkent day (of the last 30) with any call; `null` when none. */
  lastDay: string | null;
  /** 30-day usage by kind, biggest spend first. */
  kinds: KindUsage[];
  /** 30-day top models (paid providers), at most 5. */
  models: ModelUsage[];
  /** Last `SERIES_DAYS` days, oldest first, zero-filled. */
  daily: DayUsage[];
};

export type OtherUsage = { provider: string; calls: number; usd: number };

export type ProviderUsageBody = {
  byProvider: Record<string, ProviderUsage>;
  /** 30-day spend of providers that are no longer in the registry. */
  other: OtherUsage[];
  /** 30-day totals over everything (registry providers and `other`). */
  total30: { calls: number; usd: number };
};

const emptyTotals = (errors: number | null): UsageTotals => ({ calls: 0, errors, inputTokens: 0, outputTokens: 0, units: 0, usd: 0 });

/** The registry id a spend part belongs to, `null` for a provider that left the registry. */
export function registryIdOf(provider: string, kind: string): string | null {
  // The ChatGPT image choice is recorded as provider `openai`; the registry entry for it is `openai-image`.
  if (provider === "openai" && kind === "image") return "openai-image";
  return isProviderId(provider) ? provider : null;
}

/** `YYYY-MM-DD` of `at` in Tashkent. */
export function tashkentDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function shiftDay(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}

/** The last `USAGE_DAYS` Tashkent days ending today, oldest first. */
export function usageDays(now: Date): string[] {
  const today = tashkentDay(now);
  return Array.from({ length: USAGE_DAYS }, (_, i) => shiftDay(today, i - (USAGE_DAYS - 1)));
}

type Acc = {
  usage: ProviderUsage;
  kinds: Map<string, KindUsage>;
  models: Map<string, ModelUsage>;
};

function newAcc(free: boolean, days: string[]): Acc {
  const errors = free ? 0 : null;
  return {
    usage: {
      today: emptyTotals(errors),
      d7: emptyTotals(errors),
      d30: emptyTotals(errors),
      lastDay: null,
      kinds: [],
      models: [],
      daily: days.slice(-SERIES_DAYS).map((day) => ({ day, calls: 0, usd: 0 })),
    },
    kinds: new Map(),
    models: new Map(),
  };
}

function add(t: UsageTotals, p: Partial<UsageTotals>): void {
  t.calls += p.calls ?? 0;
  if (t.errors !== null) t.errors += p.errors ?? 0;
  t.inputTokens += p.inputTokens ?? 0;
  t.outputTokens += p.outputTokens ?? 0;
  t.units += p.units ?? 0;
  t.usd += p.usd ?? 0;
}

/** Adds one day's numbers to every window the day belongs to. */
function addDay(acc: Acc, days: string[], day: string, p: Partial<UsageTotals>): void {
  const i = days.indexOf(day);
  if (i < 0) return;
  add(acc.usage.d30, p);
  if (i >= days.length - 7) add(acc.usage.d7, p);
  if (i === days.length - 1) add(acc.usage.today, p);
  if ((p.calls ?? 0) > 0 && (acc.usage.lastDay === null || day > acc.usage.lastDay)) acc.usage.lastDay = day;
  const slot = acc.usage.daily.find((d) => d.day === day);
  if (slot) {
    slot.calls += p.calls ?? 0;
    slot.usd += p.usd ?? 0;
  }
}

const usd6 = (v: number): number => Number(v.toFixed(6));

function finish(acc: Acc): ProviderUsage {
  const round = (t: UsageTotals) => ({ ...t, usd: usd6(t.usd) });
  acc.usage.today = round(acc.usage.today);
  acc.usage.d7 = round(acc.usage.d7);
  acc.usage.d30 = round(acc.usage.d30);
  acc.usage.daily = acc.usage.daily.map((d) => ({ ...d, usd: usd6(d.usd) }));
  acc.usage.kinds = [...acc.kinds.values()].map((k) => ({ ...k, usd: usd6(k.usd) })).sort((a, b) => b.usd - a.usd || b.calls - a.calls || a.kind.localeCompare(b.kind));
  acc.usage.models = [...acc.models.values()]
    .map((m) => ({ ...m, usd: usd6(m.usd) }))
    .sort((a, b) => b.usd - a.usd || b.calls - a.calls || a.model.localeCompare(b.model))
    .slice(0, 5);
  return acc.usage;
}

type CallRow = { day: string; provider: string; calls: string | number; errors: string | number };

/** Pure fold of the two sources into the response (the query code only fetches rows). Exported for tests. */
export function foldUsage(
  now: Date,
  spend: ReadonlyArray<{ day: string; provider: string; kind: string; model: string; calls: number; units: number; inputTokens: number; outputTokens: number; usd: number }>,
  calls: ReadonlyArray<CallRow>,
): ProviderUsageBody {
  const days = usageDays(now);
  const accs = new Map<string, Acc>();
  const free = new Set(["pexels", "pixabay", "openalex", "googlebooks"]);
  const accOf = (id: string): Acc => {
    let a = accs.get(id);
    if (!a) {
      a = newAcc(free.has(id), days);
      accs.set(id, a);
    }
    return a;
  };
  const other = new Map<string, OtherUsage>();
  let total = { calls: 0, usd: 0 };

  for (const r of spend) {
    if (!days.includes(r.day)) continue;
    total = { calls: total.calls + r.calls, usd: total.usd + r.usd };
    const id = registryIdOf(r.provider, r.kind);
    if (!id) {
      const o = other.get(r.provider) ?? { provider: r.provider, calls: 0, usd: 0 };
      o.calls += r.calls;
      o.usd += r.usd;
      other.set(r.provider, o);
      continue;
    }
    const acc = accOf(id);
    addDay(acc, days, r.day, { calls: r.calls, inputTokens: r.inputTokens, outputTokens: r.outputTokens, units: r.units, usd: r.usd });
    const k = acc.kinds.get(r.kind) ?? { kind: r.kind, calls: 0, units: 0, inputTokens: 0, outputTokens: 0, usd: 0 };
    k.calls += r.calls;
    k.units += r.units;
    k.inputTokens += r.inputTokens;
    k.outputTokens += r.outputTokens;
    k.usd += r.usd;
    acc.kinds.set(r.kind, k);
    const mk = `${r.kind}|${r.model}`;
    const m = acc.models.get(mk) ?? { model: r.model, kind: r.kind, calls: 0, usd: 0 };
    m.calls += r.calls;
    m.usd += r.usd;
    acc.models.set(mk, m);
  }

  for (const r of calls) {
    if (!isProviderId(r.provider) || !days.includes(r.day)) continue;
    const c = Number(r.calls);
    const e = Number(r.errors);
    total = { calls: total.calls + c, usd: total.usd };
    const acc = accOf(r.provider);
    addDay(acc, days, r.day, { calls: c, errors: e });
    const k = acc.kinds.get("requests") ?? { kind: "requests", calls: 0, units: 0, inputTokens: 0, outputTokens: 0, usd: 0 };
    k.calls += c;
    acc.kinds.set("requests", k);
  }

  const byProvider: Record<string, ProviderUsage> = {};
  for (const p of PROVIDERS) byProvider[p.id] = finish(accs.get(p.id) ?? newAcc(free.has(p.id), days));
  return {
    byProvider,
    other: [...other.values()].map((o) => ({ ...o, usd: usd6(o.usd) })).sort((a, b) => b.usd - a.usd || a.provider.localeCompare(b.provider)),
    total30: { calls: total.calls, usd: usd6(total.usd) },
  };
}

type Cache = { key: string; at: number; value: ProviderUsageBody };
const CACHE_TTL_MS = 30_000;
let cache: Cache | null = null;

/** Test seam. */
export function clearProviderUsageCache(): void {
  cache = null;
}

/** Usage of every registry provider (cached 30 s per Tashkent day). */
export async function providerUsage(now: Date = new Date()): Promise<ProviderUsageBody> {
  const days = usageDays(now);
  const key = days[days.length - 1];
  if (cache && cache.key === key && now.getTime() - cache.at < CACHE_TTL_MS) return cache.value;
  const fromTs = new Date(`${days[0]}T00:00:00+05:00`).toISOString();
  const toTsExclusive = new Date(`${shiftDay(key, 1)}T00:00:00+05:00`).toISOString();
  const spend = await aiReadOnlyTx((client) => spendByDayPart(client, { fromTs, toTsExclusive }));
  const calls = await query<CallRow>(
    "SELECT to_char(day, 'YYYY-MM-DD') AS day, provider, calls, errors FROM provider_calls WHERE day >= $1::date AND day <= $2::date",
    [days[0], key],
  );
  const value = foldUsage(now, spend, calls);
  cache = { key, at: now.getTime(), value };
  return value;
}
