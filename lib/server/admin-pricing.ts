import "server-only";
import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { adminTx } from "./admin-audit";
import { parseReason } from "./admin-accounts";
import type { AdminActor } from "./admin-handler";
import { costCaveats, soumPerUsd, spendCoverageByTool, spendRowsSql, type Queryable, type SpendRange } from "./admin-cost";
import { parseDateRange, type DateRange } from "./admin-list";
import { pool, query, transaction } from "./db";
import { SOUM_PER_COIN } from "./payments";
import { invalidatePricingCache } from "./pricing";
import { getSetting } from "./settings";
import {
  applyPriceAdjust,
  ARTICLE_PRICES,
  basePriceFor,
  isPriceAdjust,
  PRICE_PERCENT_MAX,
  PRICE_PERCENT_MIN,
  PRICE_ROUND_TO,
  THESIS_PRICES,
  TOOL_BY_ID,
  TOOL_GROUPS,
  TOOLS,
  TRANSLATION_BASE_CHARS,
  TRANSLATION_STEP_CHARS,
  type PriceAdjust,
} from "../tools";
import { ARTICLE_TYPES } from "../generation/article/types-registry";
import { ESSAY_LIMITS } from "../generation/essay/types";
import { PRO_SLIDE_DEFAULT, PRO_SLIDE_MAX, PRO_SLIDE_MIN, SLIDE_DEFAULT, SLIDE_INCLUDED, SLIDE_MAX, SLIDE_MIN } from "../generation/slide-params";
import { COURSEWORK_PAGES, INDEPENDENT_PAGES, REFERAT_PAGES } from "../generation/work/registry";
import type { FormValues, ToolGroup, ToolId } from "../types";

/**
 * Pricing and unit economics for the admin panel (docs/admin/02-plan.md §17).
 *
 * Prices: the code formula (`basePriceFor`) is the base; the admin's per-tool
 * adjustment (`tool_pricing`, `applyPriceAdjust`) gives the effective price.
 * Costs: ONLY the canonical spend rows of `admin-cost.ts` (`spendRowsSql`),
 * grouped here by tool and outcome, so this screen agrees with the dashboard
 * and the AI screen for the same range. `cost_json` / `ai_usage` are never
 * read directly.
 *
 * Every metric is defined once, in plain English, next to its SQL. Ranges are
 * Asia/Tashkent calendar days (`parseDateRange`), at most 366 days. Reads run
 * in a READ ONLY transaction with a 10 s statement timeout; the aggregates
 * are cached 60 s per process (keyed by endpoint + params); the current
 * adjustments and the history are always read fresh.
 *
 * Two time bases, on purpose:
 *   - "orders" (jobs, listed price, cash revenue, units, refunds): jobs
 *     CREATED in the range, whatever their status now;
 *   - "outcomes" (completed, failed, AI cost, overhead, coverage): jobs
 *     FINISHED in the range — the same basis as `admin-cost.ts`, so the cost
 *     figures here equal the AI screen's.
 *
 * Two money units, never mixed silently:
 *   - tanga: prices, the ladder and the revenue;
 *   - so'm: every cost (USD × `finance.soum_per_usd`).
 * Margin, markup and the simulator's margin convert tanga to so'm first with
 * `SOUM_PER_COIN` (lib/server/payments.ts: what one tanga costs at top-up), so
 * a change of that rate moves the economics instead of being ignored.
 *
 * Two margins, on purpose (owner decision 2026-10-10):
 *   - PRIMARY `marginPct` (and `markup`, `recommendedPercent`) is on the LISTED
 *     revenue of the COMPLETED jobs — `generations.price` minus what was
 *     refunded, whatever the job was paid with (cash, quota or bonus points).
 *     Cost is the full cost (completed spend + failure overhead) and the
 *     payment fee (`pricing.payment_fee_percent` of the revenue) is deducted;
 *   - `cashMarginPct` keeps the earlier formula: only the wallet cash
 *     (balance + quota deltas) over ALL jobs created in the range, no fee.
 * `bonusCostSoum` is the share of the AI spend that went to jobs paid with
 * points (the marketing cost of the sign-up/top-up bonus).
 *
 * Admin accounts (`admin_accounts.user_id`, any status) test the product with
 * their own jobs: those jobs, their spend rows and their ledger rows are left
 * out of every aggregate here unless the caller asks for `includeAdmins`. The
 * AI cost screen (`admin-ai.ts`) is NOT filtered.
 */

const TZ = "Asia/Tashkent";
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 200;
const DAY_MS = 86_400_000;
const TREND_MAX_DAYS = 90;
/** The list's per-tool sparkline covers at most the last 30 days of the range (§17.6); the 90-day trend is the detail endpoint's. */
export const LIST_TREND_DAYS = 30;
const HISTORY_LIMIT = 100;
/** Jobs read for the simulator's projection; above this the projection is partial (noted in the result). */
const PROJECTION_MAX_JOBS = 20_000;
/** Below this many completed jobs the recommendation is labelled low confidence (§17.4). */
export const LOW_CONFIDENCE_BELOW = 20;
/** Recommended percents are rounded to this step (a 5 % step is what an admin would type). */
const RECOMMEND_STEP = 5;

// ---------------------------------------------------------------------------
// Units (§17.3)

export type PricingUnit = "slide" | "page" | "kchars" | "image" | "term" | "job";

/** The unit each tool's cost is expressed per (§17.3). Typed against `ToolId`: a new tool must be mapped here. */
export const UNIT_OF: Record<ToolId, PricingUnit> = {
  slide: "slide",
  "pro-slide": "slide",
  coursework: "page",
  referat: "page",
  "mustaqil-ish": "page",
  essay: "page",
  article: "page",
  thesis: "page",
  translation: "kchars",
  image: "image",
  glossary: "term",
  resume: "job",
  "texnologik-xarita": "job",
  keys: "job",
  "lesson-plan": "job",
  test: "job",
  crossword: "job",
  flashcards: "job",
  infographic: "job",
  sorting: "job",
  listening: "job",
  podcast: "job",
  greeting: "job",
};

/** Uzbek unit labels for the UI (the client never imports lib/tools). */
export const UNIT_LABELS: Record<PricingUnit, string> = {
  slide: "slayd",
  page: "bet",
  kchars: "1 000 belgi",
  image: "rasm",
  term: "atama",
  job: "ish",
};

/*
 * Units of one job, read from its inputs (`values_json`) INSIDE the aggregate
 * (only the average ever leaves the database):
 *   slide     → `slideCount`;
 *   page      → `pages`: a package "20-25" counts as its midpoint (22.5), a
 *               plain number ("2") as itself;
 *   kchars    → `sourceChars` ÷ 1000 (the server fills `sourceChars` in both
 *               text and file mode, app/api/generations/route.ts);
 *   image     → `imageCount`, 1 when absent (as `basePriceFor` prices it);
 *   term      → `termCount`;
 *   job       → 1.
 * A missing or non-numeric value is NULL, i.e. the job is left out of the
 * average (its units are unknown), never counted as 0.
 */
const NUM_RE = String.raw`'^\s*\d{1,9}(\.\d{1,6})?\s*$'`;
const RANGE_RE = String.raw`'^\d{1,4}\s*-\s*\d{1,4}$'`;
const jsonNumber = (key: string): string => `(CASE WHEN (g.values_json->>'${key}') ~ ${NUM_RE} THEN btrim(g.values_json->>'${key}')::numeric END)`;
const PAGES = `btrim(g.values_json->>'pages')`;
const UNIT_SQL: Record<PricingUnit, string> = {
  slide: jsonNumber("slideCount"),
  page: `(CASE WHEN ${PAGES} ~ ${RANGE_RE}
            THEN (btrim(split_part(${PAGES}, '-', 1))::numeric + btrim(split_part(${PAGES}, '-', 2))::numeric) / 2
          WHEN ${PAGES} ~ ${NUM_RE} THEN ${PAGES}::numeric END)`,
  kchars: `(${jsonNumber("sourceChars")} / 1000)`,
  image: `COALESCE(${jsonNumber("imageCount")}, 1)`,
  term: jsonNumber("termCount"),
  job: "1",
};

/** One `CASE g.tool_id …` over the registry; tool ids are code constants (checked to be plain slugs). */
function unitsSql(): string {
  const branches = TOOLS.map((t) => {
    if (!/^[a-z-]+$/.test(t.id)) throw new Error(`admin-pricing: unexpected tool id ${t.id}`);
    return `WHEN '${t.id}' THEN ${UNIT_SQL[UNIT_OF[t.id]]}`;
  });
  return `(CASE g.tool_id ${branches.join(" ")} ELSE 1 END)`;
}

// ---------------------------------------------------------------------------
// Tier ladder (§17.4 simulator, §17.6 table)

export type LadderInput = { label: string; values: FormValues };
export type LadderStep = { label: string; base: number };
export type LadderRow = LadderStep & { effective: number };

const fmtInt = (n: number): string => n.toLocaleString("uz-UZ");

/**
 * Representative inputs per tool, derived from the registry's own tier
 * tables (never hard-coded prices): `ladderFor` prices each one with
 * `basePriceFor`. Tools priced per job have one "Standart" step.
 */
export function ladderInputs(toolId: ToolId): LadderInput[] {
  switch (toolId) {
    case "slide": {
      const counts = [...new Set([SLIDE_MIN, SLIDE_DEFAULT, SLIDE_INCLUDED, SLIDE_MAX])].sort((a, b) => a - b);
      return counts.map((n) => ({ label: `${n} slayd`, values: { slideCount: n } }));
    }
    case "pro-slide": {
      const counts = [...new Set([PRO_SLIDE_MIN, PRO_SLIDE_DEFAULT, PRO_SLIDE_MAX])].sort((a, b) => a - b);
      return counts.map((n) => ({ label: `${n} slayd`, values: { slideCount: n } }));
    }
    case "image":
      // `basePriceFor` prices 1, 2–3 and 4+ images.
      return [1, 2, 4].map((n) => ({ label: `${n} rasm`, values: { imageCount: n } }));
    case "coursework":
      return COURSEWORK_PAGES.map((p) => ({ label: `${p} bet`, values: { pages: p } }));
    case "referat":
      return REFERAT_PAGES.map((p) => ({ label: `${p} bet`, values: { pages: p } }));
    case "mustaqil-ish":
      return INDEPENDENT_PAGES.map((p) => ({ label: `${p} bet`, values: { pages: p } }));
    case "essay": {
      const out: LadderInput[] = [];
      for (let n = ESSAY_LIMITS.pagesMin; n <= ESSAY_LIMITS.pagesMax; n++) {
        // The school context is sized in pages; the price table is per page.
        out.push({ label: `${n} varaq`, values: { essayContext: "school_dtm", pages: n } });
      }
      return out;
    }
    case "article":
      // Every priced package, with an article type that allows it (`normalizeArticlePages`).
      return (Object.keys(ARTICLE_PRICES) as (keyof typeof ARTICLE_PRICES)[]).map((pages) => {
        const type = Object.values(ARTICLE_TYPES).find((t) => (t.pages as readonly string[]).includes(pages));
        return { label: `${pages} bet`, values: { articleType: type?.id ?? "", pages } };
      });
    case "thesis":
      return (Object.keys(THESIS_PRICES) as (keyof typeof THESIS_PRICES)[]).map((pages) => ({
        label: `${pages} bet`,
        values: { articleType: pages === "3-5" ? "conference_extended" : "conference_thesis", pages },
      }));
    case "translation": {
      const chars = [TRANSLATION_BASE_CHARS, TRANSLATION_BASE_CHARS + 2 * TRANSLATION_STEP_CHARS, TRANSLATION_BASE_CHARS + 8 * TRANSLATION_STEP_CHARS];
      // File mode: `translationChars` reads the server-filled `sourceChars`.
      return chars.map((n) => ({ label: `${fmtInt(n)} belgi`, values: { sourceAssetId: "ladder", sourceChars: n } }));
    }
    case "glossary":
      return [10, 20, 40].map((n) => ({ label: `${n} atama`, values: { termCount: n } }));
    default:
      return [{ label: "Standart", values: {} }];
  }
}

/** The ladder priced by the code formula. */
export function ladderFor(toolId: ToolId): LadderStep[] {
  const tool = TOOL_BY_ID[toolId];
  return ladderInputs(toolId).map((s) => ({ label: s.label, base: basePriceFor(tool, s.values) }));
}

export function effectiveLadder(steps: ReadonlyArray<LadderStep>, adj: PriceAdjust | null): LadderRow[] {
  return steps.map((s) => ({ ...s, effective: applyPriceAdjust(s.base, adj) }));
}

// ---------------------------------------------------------------------------
// Adjustments (tool_pricing)

export const DEFAULT_ADJUST: PriceAdjust = { percent: 100, roundTo: 500 };

export function requireToolId(raw: unknown): ToolId {
  if (typeof raw === "string" && Object.prototype.hasOwnProperty.call(TOOL_BY_ID, raw)) return raw as ToolId;
  throw new ApiError("Bunday vosita yo'q", 404, { code: "not_found" });
}

type AdjustRow = { tool_id: string; percent: number; round_to: number };

function rowToAdjust(r: AdjustRow | undefined | null): PriceAdjust {
  if (!r) return { ...DEFAULT_ADJUST };
  const adj = { percent: Number(r.percent), roundTo: Number(r.round_to) };
  // The 032 CHECK constraints make this unreachable; the base price is the safe fallback.
  return isPriceAdjust(adj) ? adj : { ...DEFAULT_ADJUST };
}

async function adjustmentsOf(db: Queryable): Promise<Map<ToolId, PriceAdjust>> {
  const res = await db.query<AdjustRow>("SELECT tool_id, percent, round_to FROM tool_pricing");
  const out = new Map<ToolId, PriceAdjust>();
  for (const r of res.rows) {
    if (Object.prototype.hasOwnProperty.call(TOOL_BY_ID, r.tool_id)) out.set(r.tool_id as ToolId, rowToAdjust(r));
  }
  return out;
}

async function adjustmentOf(db: Queryable, toolId: ToolId): Promise<PriceAdjust> {
  const res = await db.query<AdjustRow>("SELECT tool_id, percent, round_to FROM tool_pricing WHERE tool_id = $1", [toolId]);
  return rowToAdjust(res.rows[0]);
}

/** Test seam for the tanga → so'm rate; production always uses `SOUM_PER_COIN`. */
export type MoneyOptions = { soumPerCoin?: number };

function soumPerCoinOf(opts: MoneyOptions | undefined): number {
  const k = opts?.soumPerCoin ?? SOUM_PER_COIN;
  if (!Number.isFinite(k) || !(k > 0)) throw new Error(`admin-pricing: bad soumPerCoin ${k}`);
  return k;
}

const sameAdjust = (a: PriceAdjust, b: PriceAdjust): boolean => a.percent === b.percent && a.roundTo === b.roundTo;

// ---------------------------------------------------------------------------
// Cache and transaction (plan §9)

type CacheEntry = { expires: number; value: Promise<unknown> };
const cache = new Map<string, CacheEntry>();

/** 60 s in-process cache of a promise; a rejected computation is evicted at once. */
function cached<T>(key: string, compute: () => Promise<T>, now = Date.now()): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;
  if (hit) cache.delete(key);
  if (cache.size >= CACHE_MAX_ENTRIES) {
    for (const [k, e] of cache) if (e.expires <= now) cache.delete(k);
    while (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  }
  const value = compute();
  cache.set(key, { expires: now + CACHE_TTL_MS, value });
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  return value;
}

/** Test seam: forget every cached aggregate. */
export function clearPricingCache(): void {
  cache.clear();
}

/** pg's `statement_timeout` cancel (57014) becomes a clear 503 instead of a 500. */
function mapTimeout(e: unknown): never {
  if ((e as { code?: string } | null)?.code === "57014") {
    throw new ApiError("So'rov juda uzoq davom etdi. Oraliqni qisqartirib qayta urinib ko'ring.", 503, { code: "timeout" });
  }
  throw e;
}

async function readOnlyTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
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

// ---------------------------------------------------------------------------
// Numbers

const num = (v: string | number | null | undefined): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
const numOrNull = (v: string | number | null | undefined): number | null => (v === null || v === undefined ? null : num(v));
const round = (v: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
/** `a ÷ b`, `null` when `b` is 0 (never Infinity/NaN on the wire). */
const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

/** Every Tashkent day of the range as `YYYY-MM-DD`, ascending. */
function daysOf(range: DateRange): string[] {
  const out: string[] = [];
  const start = Date.parse(`${range.fromDay}T00:00:00Z`);
  for (let i = 0; i < range.days; i++) out.push(new Date(start + i * DAY_MS).toISOString().slice(0, 10));
  return out;
}

// ---------------------------------------------------------------------------
// Metric definitions (§17.4)

export type TrendPoint = {
  /** `YYYY-MM-DD`, Asia/Tashkent. */
  day: string;
  /** Average FULL cost per completed job that day, so'm; `null` when no job completed that day. */
  avgCostSoum: number | null;
  /** Completed jobs that day. */
  jobs: number;
};

export type PricingItem = {
  toolId: ToolId;
  title: string;
  group: ToolGroup;
  unit: PricingUnit;
  unitLabel: string;
  adjust: PriceAdjust;
  ladder: LadderRow[];
  /** Jobs created in range (any status). */
  jobs: number;
  /** Jobs finished in range by outcome (the admin-cost basis). */
  completed: number;
  failed: number;
  /** failed ÷ (completed + failed) × 100; `null` when nothing finished. */
  failRate: number | null;
  /** Jobs created in range with a refund ledger row ÷ jobs × 100; `null` without jobs. */
  refundRate: number | null;
  /** `avg(generations.price)` over jobs created in range (tanga); `null` without jobs. */
  avgPrice: number | null;
  /** Σ(−charge − refund) of balance_delta + quota_delta over those jobs ÷ jobs, tanga; points excluded. */
  avgCashRevenue: number | null;
  /** avgCashRevenue × SOUM_PER_COIN: the so'm the CASH margin is computed on. */
  avgCashRevenueSoum: number | null;
  /**
   * Net listed revenue per COMPLETED job, tanga: `generations.price` minus the refunds of the job,
   * whatever it was paid with (cash, quota, points); `null` without completed jobs.
   */
  avgRevenue: number | null;
  /** avgRevenue × SOUM_PER_COIN: the so'm the primary margin, markup and recommendation are computed on. */
  avgRevenueSoum: number | null;
  /** Average units per job (see the units note); `null` when no job has a readable value. */
  avgUnits: number | null;
  /** Completed spend ÷ completed jobs WITH cost data (USD / so'm); `null` without such jobs. */
  avgCostUsd: number | null;
  avgCostSoum: number | null;
  /** Spend of failed + abandoned jobs ÷ completed jobs; `null` when nothing completed. */
  overheadUsd: number | null;
  overheadSoum: number | null;
  /** avgCost + overhead, so'm; `null` when either part is unknown. */
  fullCostSoum: number | null;
  /** fullCostSoum ÷ avgUnits; `null` when either is unknown. */
  costPerUnitSoum: number | null;
  /**
   * PRIMARY margin: (avgRevenueSoum × (1 − f) − fullCostSoum) ÷ avgRevenueSoum × 100, f = `pricing.payment_fee_percent`
   * × (1 − pointsSharePct ÷ 100) — the fee is on the cash share only; `null` without revenue or cost.
   */
  marginPct: number | null;
  /** CASH margin (the earlier formula): (avgCashRevenueSoum − fullCostSoum) ÷ avgCashRevenueSoum × 100; `null` without cash revenue or cost. */
  cashMarginPct: number | null;
  /** avgRevenueSoum × (1 − f) ÷ fullCostSoum (the revenue left after the fee, so the recommendation holds net of it); `null` without revenue or a positive cost. */
  markup: number | null;
  /** Share of the completed jobs' revenue paid with points, %; `null` when no completed job was charged. */
  pointsSharePct: number | null;
  /**
   * Bonus cost, so'm: the AI spend (completed + failure overhead) of the period × pointsSharePct, i.e. what the
   * jobs paid with points cost; `null` without a points share.
   */
  bonusCostSoum: number | null;
  /** Completed jobs with cost data ÷ completed × 100 (`spendCoverageByTool`); `null` without completed jobs. */
  coveragePct: number | null;
  jobsWithCost: number;
  /** Percent that brings the markup to `pricing.target_markup`; `null` without a markup. */
  recommendedPercent: number | null;
  /** Sample size = completed jobs; "low" below LOW_CONFIDENCE_BELOW. */
  sampleSize: number;
  confidence: "low" | "ok";
  /** Daily average full cost per job over the LAST `LIST_TREND_DAYS` days of the range (zero-filled). */
  trend: TrendPoint[];
};

export type PricingTotals = {
  jobs: number;
  completed: number;
  /** Σ cash revenue of the registry tools, tanga. */
  cashRevenue: number;
  /** cashRevenue × SOUM_PER_COIN. */
  cashRevenueSoum: number;
  /** Σ spend of every outcome of the registry tools, USD and so'm (what the margin is on). */
  costUsdTools: number;
  costSoumTools: number;
  /** Spend outside the registry tools in the same range: free-LLM endpoints (`free:*`), unknown tool. */
  costUsdOther: number;
  /** costUsdTools + costUsdOther = `spendTotals` of the range — the dashboard and AI-page figure. */
  costUsdAll: number;
  /** Σ net listed revenue of the completed jobs of the registry tools, tanga (see `PricingItem.avgRevenue`). */
  revenue: number;
  /** revenue × SOUM_PER_COIN. */
  revenueSoum: number;
  /**
   * The headline margin's basis: the revenue of the tools whose cost is KNOWN, and their cost = Σ unit cost (full cost
   * per completed job) × completed jobs — not the raw spend, which would ignore the jobs without cost data.
   */
  marginRevenueSoum: number;
  marginCostSoum: number;
  /** Payment fee on the cash share of marginRevenueSoum, so'm. */
  feeSoum: number;
  /** Completed jobs' revenue (so'm) of tools with NO cost data at all, and their titles: left out of the margin, flagged in the UI. */
  uncoveredRevenueSoum: number;
  uncoveredTools: string[];
  /** PRIMARY: (marginRevenueSoum − feeSoum − marginCostSoum) ÷ marginRevenueSoum × 100; `null` without revenue. */
  marginPct: number | null;
  /** CASH (earlier formula): (cashRevenueSoum − costSoumTools) ÷ cashRevenueSoum × 100; `null` without cash revenue. */
  cashMarginPct: number | null;
  /** Σ per-tool bonus cost, so'm. */
  bonusCostSoum: number;
  /** Points share of the completed jobs' revenue, %; `null` when nothing was charged. */
  pointsSharePct: number | null;
};

export type PricingOverview = {
  range: { from: string; to: string; days: number };
  items: PricingItem[];
  totals: PricingTotals;
  /** `finance.soum_per_usd`. */
  fx: number;
  /** So'm per tanga (`SOUM_PER_COIN`) used to compare tanga revenue with so'm cost. */
  soumPerCoin: number;
  /** `pricing.target_markup`. */
  targetMarkup: number;
  /** `pricing.payment_fee_percent`: deducted from the revenue in the primary margin. */
  paymentFeePercent: number;
  /** `true` when admin accounts' jobs are part of every figure (query `admins=1`). */
  includeAdmins: boolean;
  /** Completed jobs of admin accounts finished in the range, counted whatever `includeAdmins` is. */
  adminJobs: number;
  groups: ReadonlyArray<{ id: ToolGroup; label: string }>;
  caveats: string[];
};

type OrdersRow = { tool_id: string; jobs: string; avg_price: string | null; refunded: string; avg_units: string | null };
type CashRow = { tool_id: string; cash: string };
type RevenueRow = { tool_id: string; completed: string; net_listed: string; net_points: string; net_cash: string };
type OutcomeRow = { tool_id: string; completed: string; failed: string };
type SpendRow = { tool_id: string; outcome: string; usd: string; records: string };
type TrendRow = { tool_id: string; day: string; c_usd: string | null; f_usd: string | null; c_records: string | null; completed: string | null };

type Aggregates = {
  orders: Map<string, { jobs: number; avgPrice: number | null; refunded: number; avgUnits: number | null }>;
  cash: Map<string, number>;
  /** Completed jobs finished in range: net listed revenue and how it was paid (tanga). */
  revenue: Map<string, { completed: number; netListed: number; netPoints: number; netCash: number }>;
  outcomes: Map<string, { completed: number; failed: number }>;
  spend: Map<string, { completedUsd: number; completedRecords: number; failedUsd: number }>;
  coverage: Map<string, { jobsWithCost: number; jobsCompleted: number; pct: number }>;
  trend: Map<string, Map<string, TrendRow>>;
  /** All-in spend of the range (tools or not), without the admin accounts' rows unless they are included. */
  spendAllUsd: number;
  /** Completed jobs of admin accounts finished in range (always counted, filter or not). */
  adminJobs: number;
  /** The computed gaps of the spend data (`costCaveats`): only what applies, with numbers; may be empty. */
  caveats: string[];
};

const IS_ADMIN_JOB = "EXISTS (SELECT 1 FROM admin_accounts aa WHERE aa.user_id = g.user_id)";

/** SQL condition on a job `g`: not an admin account's job (the default view), or any job. */
function jobFilter(includeAdmins: boolean): string {
  return includeAdmins ? "TRUE" : `NOT ${IS_ADMIN_JOB}`;
}

/**
 * SQL condition on a spend row (AI usage record) of table/alias `alias`:
 * every row follows its user: an admin account's rows (its jobs AND its free-LLM
 * calls, which carry the caller's user id, lib/server/spend.ts flushFreeUsage)
 * drop with it; a row with no user at all stays.
 */
function spendFilter(includeAdmins: boolean, alias = "s"): string {
  return includeAdmins ? "TRUE" : `(${alias}.user_id IS NULL OR NOT EXISTS (SELECT 1 FROM admin_accounts aa WHERE aa.user_id = ${alias}.user_id))`;
}

/**
 * Refund sums per job `g` (reference = generation id): points back and cash
 * back (balance + quota). A partial refund counts as it was written.
 */
const REFUNDED_LATERAL = `LEFT JOIN LATERAL (
       SELECT COALESCE(sum(t.points_delta), 0) AS points, COALESCE(sum(t.balance_delta + t.quota_delta), 0) AS cash
         FROM transactions t WHERE t.kind = 'refund' AND t.reference = g.id::text) rf ON true`;

/** The cached part of the overview: pure aggregates for a range (no adjustments, no settings). */
async function aggregates(db: Queryable, range: DateRange, includeAdmins: boolean): Promise<Aggregates> {
  const spendRange: SpendRange = { fromTs: range.fromTs, toTsExclusive: range.toTsExclusive };
  const spend = spendRowsSql(spendRange);
  const bounds = [range.fromTs, range.toTsExclusive];
  const jobs = jobFilter(includeAdmins);
  const spendOk = spendFilter(includeAdmins);

  // jobs: generations created in range (any status). avgPrice: avg(price).
  // refunded: jobs among them with a 'refund' ledger row (full or partial).
  // avgUnits: average of the per-tool units expression (NULLs excluded).
  const orders = await db.query<OrdersRow>(
    `SELECT g.tool_id, count(*) AS jobs, avg(g.price) AS avg_price,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM transactions r WHERE r.kind = 'refund' AND r.reference = g.id::text)) AS refunded,
            avg(${unitsSql()}) AS avg_units
       FROM generations g
      WHERE g.created_at >= $1 AND g.created_at < $2 AND ${jobs}
      GROUP BY g.tool_id`,
    bounds,
  );

  // cash (the CASH margin): Σ(−charge − refund) of balance_delta + quota_delta
  // over the ledger rows that reference those jobs (reference = generation
  // id). Charges are negative deltas and refunds positive, so the sum is the
  // net cash kept. points_delta is left out: points are the bonus, not money
  // (lib/server/spend.ts assertPaidDocument).
  const cash = await db.query<CashRow>(
    `SELECT g.tool_id, sum(-(t.balance_delta + t.quota_delta)) AS cash
       FROM generations g
       JOIN transactions t ON t.kind IN ('charge', 'refund') AND t.reference = g.id::text
      WHERE g.created_at >= $1 AND g.created_at < $2 AND ${jobs}
      GROUP BY g.tool_id`,
    bounds,
  );

  // revenue (the PRIMARY margin): the COMPLETED jobs finished in range, the
  // basis of the cost figures. net_listed = Σ max(price − refunded, 0): the
  // listed price whatever the job was paid with. net_points / net_cash split
  // what the wallet really paid (charge minus refund per job, never below 0)
  // into bonus points and money, for the points share.
  const revenue = await db.query<RevenueRow>(
    `SELECT g.tool_id, count(*) AS completed,
            COALESCE(sum(GREATEST(g.price - rf.points - rf.cash, 0)), 0) AS net_listed,
            COALESCE(sum(GREATEST(ch.points - rf.points, 0)), 0) AS net_points,
            COALESCE(sum(GREATEST(ch.cash - rf.cash, 0)), 0) AS net_cash
       FROM generations g
       LEFT JOIN LATERAL (
         SELECT COALESCE(sum(-t.points_delta), 0) AS points, COALESCE(sum(-(t.balance_delta + t.quota_delta)), 0) AS cash
           FROM transactions t WHERE t.kind = 'charge' AND t.reference = g.id::text) ch ON true
       ${REFUNDED_LATERAL}
      WHERE g.status = 'COMPLETED' AND g.finished_at >= $1 AND g.finished_at < $2 AND ${jobs}
      GROUP BY g.tool_id`,
    bounds,
  );

  // completed / failed: jobs FINISHED in range by current status (admin-cost basis).
  const outcomes = await db.query<OutcomeRow>(
    `SELECT g.tool_id,
            count(*) FILTER (WHERE g.status = 'COMPLETED') AS completed,
            count(*) FILTER (WHERE g.status = 'FAILED') AS failed
       FROM generations g
      WHERE g.finished_at >= $1 AND g.finished_at < $2 AND ${jobs}
      GROUP BY g.tool_id`,
    bounds,
  );

  // AI spend per tool and outcome from the canonical rows: one 'completed'
  // row per completed job with cost data; 'failed' / 'abandoned' rows are the
  // failure overhead. Free-LLM keys (`free:*`) are not tools and are ignored.
  const spendRows = await db.query<SpendRow>(
    `SELECT COALESCE(NULLIF(s.tool_id, ''), 'unknown') AS tool_id, s.outcome,
            COALESCE(sum(s.usd), 0) AS usd, count(*) AS records
       FROM (${spend.sql}) s
      WHERE ${spendOk}
      GROUP BY 1, 2`,
    spend.params,
  );

  // trend: per tool and Tashkent day — completed spend and its record count,
  // failed + abandoned spend, and completed jobs finished that day.
  const trendRows = await db.query<TrendRow>(
    `WITH spend AS (${spend.sql}),
     s AS (
       SELECT COALESCE(NULLIF(tool_id, ''), 'unknown') AS tool_id, (at AT TIME ZONE '${TZ}')::date AS d,
              sum(usd) FILTER (WHERE outcome = 'completed') AS c_usd,
              count(*) FILTER (WHERE outcome = 'completed') AS c_records,
              sum(usd) FILTER (WHERE outcome IN ('failed', 'abandoned')) AS f_usd
         FROM spend WHERE ${spendFilter(includeAdmins, "spend")} GROUP BY 1, 2),
     j AS (
       SELECT g.tool_id, (g.finished_at AT TIME ZONE '${TZ}')::date AS d, count(*) AS completed
         FROM generations g
        WHERE g.status = 'COMPLETED' AND g.finished_at >= $1 AND g.finished_at < $2 AND ${jobs}
        GROUP BY 1, 2)
     SELECT COALESCE(s.tool_id, j.tool_id) AS tool_id, to_char(COALESCE(s.d, j.d), 'YYYY-MM-DD') AS day,
            s.c_usd, s.f_usd, s.c_records, j.completed
       FROM s FULL JOIN j ON j.tool_id = s.tool_id AND j.d = s.d`,
    spend.params,
  );

  // Coverage stays over every completed job: admin-cost.ts owns that definition.
  const coverageRows = await spendCoverageByTool(db, spendRange);
  // All-in spend: the canonical rows, minus the admin accounts' when they are left out.
  const spendAll = await db.query<{ usd: string | null }>(`SELECT COALESCE(sum(s.usd), 0) AS usd FROM (${spend.sql}) s WHERE ${spendOk}`, spend.params);
  const adminJobs = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM generations g
      WHERE g.status = 'COMPLETED' AND g.finished_at >= $1 AND g.finished_at < $2 AND ${IS_ADMIN_JOB}`,
    bounds,
  );

  const out: Aggregates = {
    orders: new Map(),
    cash: new Map(),
    revenue: new Map(),
    outcomes: new Map(),
    spend: new Map(),
    coverage: new Map(),
    trend: new Map(),
    spendAllUsd: round(num(spendAll.rows[0]?.usd), 6),
    adminJobs: num(adminJobs.rows[0]?.n),
    // Like the coverage, the caveats describe the data as a whole (admin-cost.ts owns them), not the admin-filtered view.
    caveats: await costCaveats(db, spendRange),
  };
  for (const r of orders.rows) {
    out.orders.set(r.tool_id, { jobs: num(r.jobs), avgPrice: numOrNull(r.avg_price), refunded: num(r.refunded), avgUnits: numOrNull(r.avg_units) });
  }
  for (const r of cash.rows) out.cash.set(r.tool_id, num(r.cash));
  for (const r of revenue.rows) {
    out.revenue.set(r.tool_id, { completed: num(r.completed), netListed: num(r.net_listed), netPoints: num(r.net_points), netCash: num(r.net_cash) });
  }
  for (const r of outcomes.rows) out.outcomes.set(r.tool_id, { completed: num(r.completed), failed: num(r.failed) });
  for (const r of spendRows.rows) {
    const acc = out.spend.get(r.tool_id) ?? { completedUsd: 0, completedRecords: 0, failedUsd: 0 };
    if (r.outcome === "completed") {
      acc.completedUsd += num(r.usd);
      acc.completedRecords += num(r.records);
    } else if (r.outcome === "failed" || r.outcome === "abandoned") {
      acc.failedUsd += num(r.usd);
    }
    out.spend.set(r.tool_id, acc);
  }
  for (const c of coverageRows) out.coverage.set(c.toolId, { jobsWithCost: c.jobsWithCost, jobsCompleted: c.jobsCompleted, pct: c.pct });
  for (const r of trendRows.rows) {
    let byDay = out.trend.get(r.tool_id);
    if (!byDay) out.trend.set(r.tool_id, (byDay = new Map()));
    byDay.set(r.day, r);
  }
  return out;
}

function cachedAggregates(range: DateRange, includeAdmins: boolean): Promise<Aggregates> {
  return cached(`agg|${range.fromDay}|${range.toDay}|${includeAdmins ? "a" : "n"}`, () => readOnlyTx((c) => aggregates(c, range, includeAdmins)));
}

/** Daily average full cost per job (so'm), zero-filled over `days`. */
function trendOf(byDay: Map<string, TrendRow> | undefined, days: string[], fx: number): TrendPoint[] {
  return days.map((day) => {
    const r = byDay?.get(day);
    const completed = num(r?.completed);
    const cRecords = num(r?.c_records);
    const avgCost = ratio(num(r?.c_usd), cRecords);
    const overhead = ratio(num(r?.f_usd), completed);
    const full = avgCost === null || overhead === null ? null : avgCost + overhead;
    return { day, avgCostSoum: full === null ? null : round(full * fx, 2), jobs: completed };
  });
}

/**
 * The percent that brings the markup to the target: the current percent
 * scaled by target ÷ markup, rounded to a 5 % step and clamped to the
 * 25–1000 bounds. `null` without a markup.
 */
export function recommendedPercent(current: number, markup: number | null, targetMarkup: number): number | null {
  if (markup === null || !(markup > 0) || !(targetMarkup > 0)) return null;
  const raw = (current * targetMarkup) / markup;
  const stepped = Math.round(raw / RECOMMEND_STEP) * RECOMMEND_STEP;
  return Math.min(PRICE_PERCENT_MAX, Math.max(PRICE_PERCENT_MIN, stepped));
}

/**
 * Margin in percent: `(revenue × (1 − fee) − cost) ÷ revenue × 100`, the
 * payment fee being a share of the revenue. `null` without a positive revenue
 * or a known cost (never NaN/Infinity on the wire). The one place the primary
 * margin, the total and the simulator get their arithmetic from.
 */
export function marginPercent(revenueSoum: number | null, costSoum: number | null, feePercent = 0): number | null {
  return revenueSoum === null ? null : marginAfterFee(revenueSoum, costSoum, (revenueSoum * feePercent) / 100);
}

/** `(revenue − fee − cost) ÷ revenue × 100` with the fee already in so'm (a sum over tools with different fee bases). */
export function marginAfterFee(revenueSoum: number, costSoum: number | null, feeSoum: number): number | null {
  if (costSoum === null || !(revenueSoum > 0)) return null;
  return ((revenueSoum - feeSoum - costSoum) / revenueSoum) * 100;
}

/**
 * The payment fee as a percent of the REVENUE: `feePercent` on the cash share only
 * (points never went through the payment system). No known points share = all cash.
 */
export function feeShare(feePercent: number, pointsShare: number | null): number {
  return feePercent * (1 - (pointsShare ?? 0));
}

/** `admins` query value: absent = admin accounts left out; `1` = included; anything else is a 400. */
export function parseIncludeAdminsParam(raw: string | null): boolean {
  if (raw === null || raw === "" || raw === "0") return false;
  if (raw === "1") return true;
  throw new ApiError("Noto'g'ri parametr: admins", 400);
}

/** Query parameters of `GET /api/admin/pricing`; anything malformed is a 400. */
export function parsePricingParams(url: URL): { range: DateRange; includeAdmins: boolean } {
  const single = (name: string): string | null => {
    const all = url.searchParams.getAll(name);
    if (all.length > 1) throw new ApiError(`Noto'g'ri parametr: ${name}`, 400);
    return all[0] ? all[0] : null;
  };
  return { range: parseDateRange(single("from"), single("to")), includeAdmins: parseIncludeAdminsParam(single("admins")) };
}

export async function pricingOverview(range: DateRange, opts?: MoneyOptions & { includeAdmins?: boolean }): Promise<PricingOverview> {
  const k = soumPerCoinOf(opts);
  const includeAdmins = opts?.includeAdmins === true;
  const [agg, adjustments, fx, targetMarkup, feePercent] = await Promise.all([
    cachedAggregates(range, includeAdmins),
    adjustmentsOf(pool()),
    soumPerUsd(),
    getSetting("pricing.target_markup"),
    getSetting("pricing.payment_fee_percent"),
  ]);
  const days = daysOf(range).slice(-LIST_TREND_DAYS);
  const totals: PricingTotals = {
    jobs: 0,
    completed: 0,
    cashRevenue: 0,
    cashRevenueSoum: 0,
    costUsdTools: 0,
    costSoumTools: 0,
    costUsdOther: 0,
    costUsdAll: 0,
    revenue: 0,
    revenueSoum: 0,
    marginRevenueSoum: 0,
    marginCostSoum: 0,
    feeSoum: 0,
    uncoveredRevenueSoum: 0,
    uncoveredTools: [],
    marginPct: null,
    cashMarginPct: null,
    bonusCostSoum: 0,
    pointsSharePct: null,
  };
  let netPoints = 0;
  let netPaid = 0;
  let bonusCostUsd = 0;
  // The headline margin's basis: ONLY tools whose cost is known. Their cost is the unit cost × completed jobs
  // (as in the rows), never the raw spend, so jobs without cost data cannot make the total look cheaper.
  let marginRevenueSoum = 0;
  let marginCostSoum = 0;
  let marginFeeSoum = 0;
  let uncoveredRevenueSoum = 0;
  const uncoveredTools: string[] = [];

  const items: PricingItem[] = TOOLS.map((tool) => {
    const id = tool.id;
    const adjust = adjustments.get(id) ?? { ...DEFAULT_ADJUST };
    const o = agg.orders.get(id) ?? { jobs: 0, avgPrice: null, refunded: 0, avgUnits: null };
    const cash = agg.cash.get(id) ?? 0;
    const rev = agg.revenue.get(id) ?? { completed: 0, netListed: 0, netPoints: 0, netCash: 0 };
    const oc = agg.outcomes.get(id) ?? { completed: 0, failed: 0 };
    const sp = agg.spend.get(id) ?? { completedUsd: 0, completedRecords: 0, failedUsd: 0 };
    const cov = agg.coverage.get(id);

    const avgCashRevenue = ratio(cash, o.jobs);
    const avgCashRevenueSoum = avgCashRevenue === null ? null : avgCashRevenue * k;
    const avgRevenue = ratio(rev.netListed, rev.completed);
    const avgRevenueSoum = avgRevenue === null ? null : avgRevenue * k;
    const avgCostUsd = ratio(sp.completedUsd, sp.completedRecords);
    const overheadUsd = ratio(sp.failedUsd, oc.completed);
    const fullCostUsd = avgCostUsd === null || overheadUsd === null ? null : avgCostUsd + overheadUsd;
    const fullCostSoum = fullCostUsd === null ? null : fullCostUsd * fx;
    const costPerUnitSoum = fullCostSoum === null || o.avgUnits === null || !(o.avgUnits > 0) ? null : fullCostSoum / o.avgUnits;
    // Points share of what the wallet paid for the completed jobs; the AI spend of the period × that share is the bonus cost.
    const pointsShare = ratio(rev.netPoints, rev.netPoints + rev.netCash);
    // The payment fee is charged on the MONEY only: points never went through the payment system.
    const feeOfRevenue = feeShare(feePercent, pointsShare);
    const margin = marginPercent(avgRevenueSoum, fullCostSoum, feeOfRevenue);
    const cashMargin = marginPercent(avgCashRevenueSoum, fullCostSoum);
    // Markup on the revenue left after the fee, so a recommended price reaches the target markup net of the fee.
    const markup = avgRevenueSoum === null || fullCostSoum === null || !(fullCostSoum > 0) ? null : (avgRevenueSoum * (1 - feeOfRevenue / 100)) / fullCostSoum;
    const toolSpendUsd = sp.completedUsd + sp.failedUsd;

    totals.jobs += o.jobs;
    totals.completed += oc.completed;
    totals.cashRevenue += cash;
    totals.revenue += rev.netListed;
    totals.costUsdTools += toolSpendUsd;
    netPoints += rev.netPoints;
    netPaid += rev.netPoints + rev.netCash;
    if (pointsShare !== null) bonusCostUsd += toolSpendUsd * pointsShare;
    if (avgRevenueSoum !== null && fullCostSoum !== null) {
      marginRevenueSoum += avgRevenueSoum * oc.completed;
      marginCostSoum += fullCostSoum * oc.completed;
      marginFeeSoum += (avgRevenueSoum * oc.completed * feeOfRevenue) / 100;
    } else if (avgRevenueSoum !== null) {
      // Completed jobs, but no cost data at all: flagged, not counted as free.
      uncoveredRevenueSoum += avgRevenueSoum * oc.completed;
      uncoveredTools.push(tool.title);
    }

    const r2 = (v: number | null): number | null => (v === null ? null : round(v, 2));
    return {
      toolId: id,
      title: tool.title,
      group: tool.group,
      unit: UNIT_OF[id],
      unitLabel: UNIT_LABELS[UNIT_OF[id]],
      adjust,
      ladder: effectiveLadder(ladderFor(id), adjust),
      jobs: o.jobs,
      completed: oc.completed,
      failed: oc.failed,
      failRate: r2(oc.completed + oc.failed > 0 ? (oc.failed / (oc.completed + oc.failed)) * 100 : null),
      refundRate: r2(o.jobs > 0 ? (o.refunded / o.jobs) * 100 : null),
      avgPrice: r2(o.avgPrice),
      avgCashRevenue: r2(avgCashRevenue),
      avgCashRevenueSoum: r2(avgCashRevenueSoum),
      avgRevenue: r2(avgRevenue),
      avgRevenueSoum: r2(avgRevenueSoum),
      avgUnits: r2(o.avgUnits),
      avgCostUsd: avgCostUsd === null ? null : round(avgCostUsd, 6),
      avgCostSoum: r2(avgCostUsd === null ? null : avgCostUsd * fx),
      overheadUsd: overheadUsd === null ? null : round(overheadUsd, 6),
      overheadSoum: r2(overheadUsd === null ? null : overheadUsd * fx),
      fullCostSoum: r2(fullCostSoum),
      costPerUnitSoum: r2(costPerUnitSoum),
      marginPct: r2(margin),
      cashMarginPct: r2(cashMargin),
      markup: markup === null ? null : round(markup, 3),
      pointsSharePct: r2(pointsShare === null ? null : pointsShare * 100),
      bonusCostSoum: r2(pointsShare === null ? null : toolSpendUsd * pointsShare * fx),
      coveragePct: cov && cov.jobsCompleted > 0 ? round(cov.pct, 2) : null,
      jobsWithCost: cov?.jobsWithCost ?? 0,
      recommendedPercent: recommendedPercent(adjust.percent, markup, targetMarkup),
      sampleSize: oc.completed,
      confidence: oc.completed < LOW_CONFIDENCE_BELOW ? "low" : "ok",
      trend: trendOf(agg.trend.get(id), days, fx),
    };
  });

  totals.costUsdTools = round(totals.costUsdTools, 6);
  totals.costSoumTools = round(totals.costUsdTools * fx, 2);
  // The tools' rows are a subset of the range's spend rows, so the remainder
  // is exactly the free-LLM / unknown spend and tools + other = all.
  totals.costUsdAll = agg.spendAllUsd;
  totals.costUsdOther = round(Math.max(0, agg.spendAllUsd - totals.costUsdTools), 6);
  totals.cashRevenueSoum = round(totals.cashRevenue * k, 2);
  totals.revenueSoum = round(totals.revenue * k, 2);
  totals.marginRevenueSoum = round(marginRevenueSoum, 2);
  totals.marginCostSoum = round(marginCostSoum, 2);
  totals.feeSoum = round(marginFeeSoum, 2);
  totals.uncoveredRevenueSoum = round(uncoveredRevenueSoum, 2);
  totals.uncoveredTools = uncoveredTools;
  const totalMargin = marginAfterFee(marginRevenueSoum, marginCostSoum, marginFeeSoum);
  totals.marginPct = totalMargin === null ? null : round(totalMargin, 2);
  const totalCashMargin = marginPercent(totals.cashRevenueSoum, totals.costSoumTools);
  totals.cashMarginPct = totalCashMargin === null ? null : round(totalCashMargin, 2);
  totals.bonusCostSoum = round(bonusCostUsd * fx, 2);
  totals.pointsSharePct = netPaid > 0 ? round((netPoints / netPaid) * 100, 2) : null;

  return {
    range: { from: range.fromDay, to: range.toDay, days: range.days },
    items,
    totals,
    fx,
    soumPerCoin: k,
    targetMarkup,
    paymentFeePercent: feePercent,
    includeAdmins,
    adminJobs: agg.adminJobs,
    groups: TOOL_GROUPS,
    caveats: agg.caveats,
  };
}

// ---------------------------------------------------------------------------
// Detail: trend, history, ladder (§17.5 GET /pricing/:toolId)

export type PriceHistoryRow = {
  id: string;
  at: string;
  /** Display name of the admin (name, else @username, else "Admin №id"); `null` for a deleted account. */
  admin: string | null;
  oldPercent: number;
  newPercent: number;
  oldRoundTo: number;
  newRoundTo: number;
  reason: string;
};

export type PricingDetail = {
  tool: { toolId: ToolId; title: string; group: ToolGroup; unit: PricingUnit; unitLabel: string; adjust: PriceAdjust };
  range: { from: string; to: string; days: number };
  trend: TrendPoint[];
  history: PriceHistoryRow[];
  ladder: LadderRow[];
  fx: number;
};

/** `days` of `GET /api/admin/pricing/:toolId`: 1..90, default 90. */
export function parseTrendDays(raw: string | null): number {
  if (raw === null || raw === "") return TREND_MAX_DAYS;
  if (!/^\d{1,3}$/.test(raw)) throw new ApiError("Noto'g'ri parametr: days", 400);
  const n = Number(raw);
  if (n < 1 || n > TREND_MAX_DAYS) throw new ApiError(`days 1 dan ${TREND_MAX_DAYS} gacha bo'lishi kerak`, 400);
  return n;
}

type HistoryRow = {
  id: string;
  at: Date | string;
  old_percent: number;
  new_percent: number;
  old_round_to: number;
  new_round_to: number;
  reason: string;
  admin_id: string | null;
  admin_name: string | null;
  admin_username: string | null;
};

function adminLabel(r: Pick<HistoryRow, "admin_id" | "admin_name" | "admin_username">): string | null {
  if (r.admin_id === null) return null;
  const name = r.admin_name?.trim();
  if (name) return name;
  const username = r.admin_username?.trim();
  if (username) return `@${username}`;
  return `Admin №${r.admin_id}`;
}

export async function priceHistory(toolId: ToolId): Promise<PriceHistoryRow[]> {
  const rows = await query<HistoryRow>(
    `SELECT h.id::text AS id, h.at, h.old_percent, h.new_percent, h.old_round_to, h.new_round_to, h.reason,
            h.admin_id::text AS admin_id, u.name AS admin_name, u.username AS admin_username
       FROM tool_price_history h
       LEFT JOIN admin_accounts a ON a.id = h.admin_id
       LEFT JOIN users u ON u.id = a.user_id
      WHERE h.tool_id = $1
      ORDER BY h.at DESC, h.id DESC
      LIMIT ${HISTORY_LIMIT}`,
    [toolId],
  );
  return rows.map((r) => ({
    id: r.id,
    at: new Date(r.at).toISOString(),
    admin: adminLabel(r),
    oldPercent: Number(r.old_percent),
    newPercent: Number(r.new_percent),
    oldRoundTo: Number(r.old_round_to),
    newRoundTo: Number(r.new_round_to),
    reason: r.reason,
  }));
}

export async function pricingDetail(toolId: ToolId, days: number, includeAdmins = false): Promise<PricingDetail> {
  const range = parseDateRange(null, null, { defaultDays: days, maxDays: TREND_MAX_DAYS });
  const [agg, adjust, history, fx] = await Promise.all([cachedAggregates(range, includeAdmins), adjustmentOf(pool(), toolId), priceHistory(toolId), soumPerUsd()]);
  const tool = TOOL_BY_ID[toolId];
  return {
    tool: { toolId, title: tool.title, group: tool.group, unit: UNIT_OF[toolId], unitLabel: UNIT_LABELS[UNIT_OF[toolId]], adjust },
    range: { from: range.fromDay, to: range.toDay, days: range.days },
    trend: trendOf(agg.trend.get(toolId), daysOf(range), fx),
    history,
    ladder: effectiveLadder(ladderFor(toolId), adjust),
    fx,
  };
}

// ---------------------------------------------------------------------------
// Simulator (§17.4, §17.5 POST /pricing/:toolId/simulate)

export type Projection = {
  /** Σ net listed revenue (price minus refunds) of the tool's completed jobs in the window, tanga. */
  revenue30d: number;
  /** revenue30d × SOUM_PER_COIN, so'm. */
  revenue30dSoum: number;
  /** Payment fee on that revenue (`pricing.payment_fee_percent`), so'm. */
  feeSoum: number;
  /** AI cost of the window, so'm: the table's full cost per job × the completed jobs; `null` when no job has cost data. */
  cost30d: number | null;
  /** (revenue30dSoum − feeSoum − cost30d) ÷ revenue30dSoum × 100; `null` without revenue. The table's primary margin. */
  marginPct: number | null;
};

export type Simulation = {
  toolId: ToolId;
  proposed: PriceAdjust;
  ladder: LadderRow[];
  window: { from: string; to: string; days: number };
  /** The last 30 days as they were listed (actual `generations.price` of the completed jobs, minus refunds). */
  current: Projection & { jobs: number };
  /** The same jobs re-priced with `proposed`; cost unchanged. */
  projected: Projection;
  /** `true` when the window held more than PROJECTION_MAX_JOBS jobs and only the first ones were re-priced. */
  partial: boolean;
  fx: number;
  /** So'm per tanga (`SOUM_PER_COIN`). */
  soumPerCoin: number;
  /** `pricing.payment_fee_percent`, deducted from both projections. */
  paymentFeePercent: number;
  /** Whether admin accounts' jobs are in the window (the table's toggle). */
  includeAdmins: boolean;
};

/** `includeAdmins` of a simulate body: absent = false; present it must be a boolean (400 otherwise). */
export function parseIncludeAdminsBody(body: Record<string, unknown>): boolean {
  const v = body.includeAdmins;
  if (v === undefined) return false;
  if (typeof v !== "boolean") throw new ApiError("includeAdmins true yoki false bo'lishi kerak", 400);
  return v;
}

/** Validated `{percent, roundTo}` of a request body (400 with an Uzbek message). */
export function parseAdjustBody(body: Record<string, unknown>): PriceAdjust {
  const percent = body.percent;
  if (typeof percent !== "number" || !Number.isInteger(percent) || percent < PRICE_PERCENT_MIN || percent > PRICE_PERCENT_MAX) {
    throw new ApiError(`Foiz ${PRICE_PERCENT_MIN} dan ${PRICE_PERCENT_MAX} gacha butun son bo'lishi kerak`, 400);
  }
  const roundTo = body.roundTo;
  if (!(PRICE_ROUND_TO as readonly unknown[]).includes(roundTo)) {
    throw new ApiError(`Yaxlitlash ${PRICE_ROUND_TO.join(", ")} dan biri bo'lishi kerak`, 400);
  }
  return { percent, roundTo: roundTo as PriceAdjust["roundTo"] };
}

/**
 * The inputs `basePriceFor` reads, per tool, and nothing else (no topic, no
 * text): the projection re-prices each job exactly as the server would.
 * `sourceChars` falls back to the text length for jobs older than the
 * server-filled field; `sourceAssetId` is set so `translationChars` reads it.
 */
const PRICE_INPUTS_SQL = `jsonb_strip_nulls(jsonb_build_object(
    'pages', g.values_json->'pages', 'workKind', g.values_json->'workKind', 'kind', g.values_json->'kind',
    'slideCount', g.values_json->'slideCount', 'imageCount', g.values_json->'imageCount',
    'essayContext', g.values_json->'essayContext', 'essayKind', g.values_json->'essayKind', 'wordTarget', g.values_json->'wordTarget',
    'articleType', g.values_json->'articleType', 'termCount', g.values_json->'termCount', 'glossaryType', g.values_json->'glossaryType',
    'type', g.values_json->'type',
    'sourceChars', COALESCE(g.values_json->'sourceChars', to_jsonb(length(g.values_json->>'sourceText'))),
    'sourceAssetId', CASE WHEN g.tool_id = 'translation' THEN to_jsonb('projection'::text) END))`;

type ProjectionRow = { price: string; net: string; net_points: string; net_cash: string; inputs: FormValues };
/** `net` = price minus refunds (what the job really kept); `ratio` = net ÷ price, 0 for an unpriced job. */
type ProjectionInputs = {
  jobs: { net: number; ratio: number; base: number }[];
  /** Points share of what the window's jobs paid (0-1; `null` when nothing was charged): the fee applies to the rest. */
  pointsShare: number | null;
  /** The tool's spend rows of the window, as the table's unit cost is built from them. */
  spend: { completedUsd: number; completedRecords: number; failedUsd: number };
  partial: boolean;
  range: DateRange;
};

async function projectionInputs(toolId: ToolId, includeAdmins: boolean): Promise<ProjectionInputs> {
  // Always the last 30 Tashkent days (the simulator's window is fixed by §17.4).
  const range = parseDateRange(null, null, { defaultDays: 30 });
  return cached(`proj|${toolId}|${range.fromDay}|${range.toDay}|${includeAdmins ? "a" : "n"}`, () =>
    readOnlyTx(async (c) => {
      const tool = TOOL_BY_ID[toolId];
      // The same jobs the table's revenue is on: COMPLETED, finished in the window, admin accounts left out by default.
      const rows = await c.query<ProjectionRow>(
        `SELECT g.price::text AS price, GREATEST(g.price - rf.points - rf.cash, 0)::text AS net,
                GREATEST(ch.points - rf.points, 0)::text AS net_points, GREATEST(ch.cash - rf.cash, 0)::text AS net_cash,
                ${PRICE_INPUTS_SQL} AS inputs
           FROM generations g
           LEFT JOIN LATERAL (
             SELECT COALESCE(sum(-t.points_delta), 0) AS points, COALESCE(sum(-(t.balance_delta + t.quota_delta)), 0) AS cash
               FROM transactions t WHERE t.kind = 'charge' AND t.reference = g.id::text) ch ON true
           ${REFUNDED_LATERAL}
          WHERE g.tool_id = $3 AND g.status = 'COMPLETED' AND g.finished_at >= $1 AND g.finished_at < $2 AND ${jobFilter(includeAdmins)}
          ORDER BY g.finished_at, g.id
          LIMIT ${PROJECTION_MAX_JOBS + 1}`,
        [range.fromTs, range.toTsExclusive, toolId],
      );
      const partial = rows.rows.length > PROJECTION_MAX_JOBS;
      let paidPoints = 0;
      let paidTotal = 0;
      const jobs = rows.rows.slice(0, PROJECTION_MAX_JOBS).map((r) => {
        const price = num(r.price);
        const net = num(r.net);
        paidPoints += num(r.net_points);
        paidTotal += num(r.net_points) + num(r.net_cash);
        return { net, ratio: price > 0 ? net / price : 0, base: basePriceFor(tool, r.inputs ?? {}) };
      });
      const spend = spendRowsSql({ fromTs: range.fromTs, toTsExclusive: range.toTsExclusive });
      const cost = await c.query<{ c_usd: string; c_records: string; f_usd: string }>(
        `SELECT COALESCE(sum(s.usd) FILTER (WHERE s.outcome = 'completed'), 0) AS c_usd,
                count(*) FILTER (WHERE s.outcome = 'completed') AS c_records,
                COALESCE(sum(s.usd) FILTER (WHERE s.outcome IN ('failed', 'abandoned')), 0) AS f_usd
           FROM (${spend.sql}) s WHERE s.tool_id = $3 AND ${spendFilter(includeAdmins)}`,
        [...spend.params, toolId],
      );
      const row = cost.rows[0];
      return { jobs, pointsShare: ratio(paidPoints, paidTotal), spend: { completedUsd: num(row?.c_usd), completedRecords: num(row?.c_records), failedUsd: num(row?.f_usd) }, partial, range };
    }),
  );
}

/**
 * Projection formula (the same 30-day window for volume and cost), on the
 * SAME revenue as the table's primary margin:
 *   current.revenue30d   = Σ_completed jobs max(price − refunds, 0)            (what was actually listed and kept)
 *   projected.revenue30d = Σ_completed jobs applyPriceAdjust(basePriceFor(tool, job inputs), proposed) × net ÷ price
 *                          (a job refunded in part stays refunded in the same share; an unpriced job stays unpriced)
 *   cost30d              = (completed spend ÷ completed spend records + failed/abandoned spend ÷ completed jobs) × completed jobs × fx
 *                          — the table's full cost per job × the jobs of the window, NOT the raw spend (jobs without cost data
 *                          would otherwise count as free); `null` when no job has cost data. A price change does not change cost.
 *   revenue30dSoum       = revenue30d × SOUM_PER_COIN                            (tanga → so'm)
 *   feeSoum              = revenue30dSoum × pricing.payment_fee_percent ÷ 100 × (1 − points share of the window)   (money only)
 *   marginPct            = (revenue30dSoum − feeSoum − cost30d) ÷ revenue30dSoum × 100
 * Volume is held constant (no demand elasticity). Revenue is the listed price
 * whatever the job was paid with (points included), as in the table.
 */
export async function simulatePricing(toolId: ToolId, proposed: PriceAdjust, opts?: MoneyOptions & { includeAdmins?: boolean }): Promise<Simulation> {
  const k = soumPerCoinOf(opts);
  const includeAdmins = opts?.includeAdmins === true;
  const [inputs, fx, feePercent] = await Promise.all([projectionInputs(toolId, includeAdmins), soumPerUsd(), getSetting("pricing.payment_fee_percent")]);
  const adj: PriceAdjust | null = proposed.percent === 100 ? null : proposed;
  const sp = inputs.spend;
  const jobsCount = inputs.jobs.length;
  const unitCostUsd = sp.completedRecords > 0 && jobsCount > 0 ? sp.completedUsd / sp.completedRecords + sp.failedUsd / jobsCount : null;
  const cost30d = unitCostUsd === null ? null : round(unitCostUsd * jobsCount * fx, 2);
  let currentRevenue = 0;
  let projectedRevenue = 0;
  for (const j of inputs.jobs) {
    currentRevenue += j.net;
    projectedRevenue += applyPriceAdjust(j.base, adj) * j.ratio;
  }
  const projection = (revenue: number): Projection => {
    const revenueSoum = round(revenue * k, 2);
    const feeOfRevenue = feeShare(feePercent, inputs.pointsShare);
    const margin = marginPercent(revenueSoum, cost30d, feeOfRevenue);
    return {
      revenue30d: revenue,
      revenue30dSoum: revenueSoum,
      feeSoum: round((revenueSoum * feeOfRevenue) / 100, 2),
      cost30d,
      marginPct: margin === null ? null : round(margin, 2),
    };
  };
  return {
    toolId,
    proposed,
    ladder: effectiveLadder(ladderFor(toolId), adj),
    window: { from: inputs.range.fromDay, to: inputs.range.toDay, days: inputs.range.days },
    current: { ...projection(currentRevenue), jobs: inputs.jobs.length },
    projected: projection(Math.round(projectedRevenue)),
    partial: inputs.partial,
    fx,
    soumPerCoin: k,
    paymentFeePercent: feePercent,
    includeAdmins,
  };
}

// ---------------------------------------------------------------------------
// Mutations (§17.5 PUT / DELETE, §8)

export type PricingItemResult = { toolId: ToolId; title: string; adjust: PriceAdjust; ladder: LadderRow[]; history: PriceHistoryRow[] };

async function itemResult(toolId: ToolId): Promise<PricingItemResult> {
  const [adjust, history] = await Promise.all([adjustmentOf(pool(), toolId), priceHistory(toolId)]);
  return { toolId, title: TOOL_BY_ID[toolId].title, adjust, ladder: effectiveLadder(ladderFor(toolId), adjust), history };
}

/** Serialises writers of one tool's row (also when the row does not exist yet, which `FOR UPDATE` cannot lock). */
async function lockTool(client: PoolClient, toolId: ToolId): Promise<PriceAdjust> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`tool_pricing:${toolId}`]);
  return adjustmentOf(client, toolId);
}

/**
 * PUT: `{percent, roundTo, reason}`. In ONE transaction: upsert `tool_pricing`
 * (100 % removes the row — "no row" is the one representation of the base
 * price), insert `tool_price_history` (old → new) and write the audit row
 * `pricing.update` with before/after. An unchanged adjustment is 409 `state`
 * and writes nothing. After COMMIT the pricing cache of this process is
 * dropped; other processes pick the change up within 15 s.
 */
export async function updateToolPricing(admin: AdminActor, rawToolId: unknown, body: Record<string, unknown>): Promise<PricingItemResult> {
  const toolId = requireToolId(rawToolId);
  const next = parseAdjustBody(body);
  const reason = parseReason(body.reason)!;
  await adminTx(admin, async (client, audit) => {
    const prev = await lockTool(client, toolId);
    if (sameAdjust(prev, next)) throw new ApiError("Narx sozlamasi allaqachon shunday", 409, { code: "state" });
    if (next.percent === 100) {
      await client.query("DELETE FROM tool_pricing WHERE tool_id = $1", [toolId]);
    } else {
      await client.query(
        `INSERT INTO tool_pricing (tool_id, percent, round_to, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (tool_id) DO UPDATE SET percent = EXCLUDED.percent, round_to = EXCLUDED.round_to,
           updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [toolId, next.percent, next.roundTo, admin.id],
      );
    }
    await client.query(
      `INSERT INTO tool_price_history (tool_id, old_percent, new_percent, old_round_to, new_round_to, reason, admin_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [toolId, prev.percent, next.percent, prev.roundTo, next.roundTo, reason, admin.id],
    );
    await audit({
      action: "pricing.update",
      targetType: "tool",
      targetId: toolId,
      reason,
      before: { percent: prev.percent, roundTo: prev.roundTo },
      after: { percent: next.percent, roundTo: next.roundTo },
    });
  });
  invalidatePricingCache();
  return itemResult(toolId);
}

/**
 * DELETE: `{reason}` resets the tool to 100 % (row deleted), with history and
 * the audit row `pricing.reset` in the same transaction. A tool already at
 * 100 % is 409 `state` and writes nothing.
 */
export async function resetToolPricing(admin: AdminActor, rawToolId: unknown, body: Record<string, unknown>): Promise<PricingItemResult> {
  const toolId = requireToolId(rawToolId);
  const reason = parseReason(body.reason)!;
  await adminTx(admin, async (client, audit) => {
    const prev = await lockTool(client, toolId);
    const row = await client.query("SELECT 1 FROM tool_pricing WHERE tool_id = $1 FOR UPDATE", [toolId]);
    if (row.rowCount === 0) throw new ApiError("Bu vosita allaqachon 100 % da", 409, { code: "state" });
    await client.query("DELETE FROM tool_pricing WHERE tool_id = $1", [toolId]);
    await client.query(
      `INSERT INTO tool_price_history (tool_id, old_percent, new_percent, old_round_to, new_round_to, reason, admin_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [toolId, prev.percent, DEFAULT_ADJUST.percent, prev.roundTo, DEFAULT_ADJUST.roundTo, reason, admin.id],
    );
    await audit({
      action: "pricing.reset",
      targetType: "tool",
      targetId: toolId,
      reason,
      before: { percent: prev.percent, roundTo: prev.roundTo },
      after: { percent: DEFAULT_ADJUST.percent, roundTo: DEFAULT_ADJUST.roundTo },
    });
  });
  invalidatePricingCache();
  return itemResult(toolId);
}
