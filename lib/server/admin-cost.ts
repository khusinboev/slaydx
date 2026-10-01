import "server-only";
import type { PoolClient } from "pg";
import type { DateRange } from "./admin-list";
import { getSetting } from "./settings";

/**
 * The ONE canonical definition of AI spend for the admin panel
 * (docs/admin/02-plan.md §6.3 `aiCostUsd`/`aiCoverage`, §6.7, §17.3–17.4).
 * The dashboard, the AI-cost page and the pricing module all build on
 * `spendRowsSql`, so their numbers always agree.
 *
 * The spend row set over a Tashkent date range is:
 *   - every `ai_usage` row with `at` in range (completed, failed and abandoned
 *     jobs, free-LLM calls), plus
 *   - legacy rows: COMPLETED generations with a `cost_json` object, finished in
 *     range, that have NO `ai_usage` row with outcome 'completed' (jobs that
 *     finished before `ai_usage` existed, or whose completed flush was lost).
 *     The guard looks at `ai_usage` regardless of its `at`, so a job is never
 *     counted twice even when the two timestamps straddle a range edge.
 *
 * Every helper takes a caller-provided client so callers can run it inside
 * their `READ ONLY` + `statement_timeout` transaction (§9). Nothing here
 * writes. Only narrow generation columns are read (never `html`, `doc_json`,
 * `values_json`, …).
 */

/** Anything with `pg`'s `query(text, params)` (a `PoolClient` or the `Pool`). */
export type Queryable = Pick<PoolClient, "query">;

/** The two UTC instants of a `parseDateRange` result: `[fromTs, toTsExclusive)`. */
export type SpendRange = Pick<DateRange, "fromTs" | "toTsExclusive">;

/**
 * A SQL fragment (a full `SELECT … UNION ALL SELECT …`) yielding the canonical
 * spend rows with the columns
 * `(at, source, outcome, generation_id, user_id, tool_id, calls, input_tokens, output_tokens, usd, parts)`;
 * wrap it as `FROM (<sql>) s`. `params` fill `$first` and `$first + 1`.
 */
export type SpendRowsSql = { sql: string; params: [string, string]; nextParam: number };

/** Groupings over whole spend rows. */
export type SpendRowGroupBy = "day" | "tool" | "outcome";
/** Groupings over the per-service parts (`CostPart` in lib/generation/types.ts). */
export type SpendPartGroupBy = "provider" | "model" | "kind";
export type SpendGroupBy = SpendRowGroupBy | SpendPartGroupBy;

export const SPEND_GROUP_BY: readonly SpendGroupBy[] = ["day", "tool", "outcome", "provider", "model", "kind"];

export type SpendTotals = {
  /** Number of spend rows (jobs × outcome, free calls). */
  records: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
};

export type SpendGroupRow = SpendTotals & {
  /**
   * day → `YYYY-MM-DD` (Asia/Tashkent); tool → tool id or `free:<endpoint>`;
   * outcome → completed|failed|abandoned|free; provider/model/kind → the part's
   * value. A missing value is `"unknown"` (also: a row with spend but no parts).
   */
  key: string;
  /**
   * Sum of part units (images, grounding queries, TTS characters). Only for
   * provider/model/kind groupings, where one key has one kind of unit; `null`
   * for day/tool/outcome, where units of different kinds would be summed.
   */
  units: number | null;
  /**
   * Calls of parts with no known price, recorded at usd 0: parts marked
   * `priced: false` (fal models without a documented price, job-cost.ts) and
   * LLM parts with tokens but usd 0 (model missing from llm-pricing.ts).
   */
  unpricedCalls: number;
};

export type SpendCoverage = {
  /** COMPLETED jobs finished in range that have cost data (`cost_json` or a completed `ai_usage` row). */
  jobsWithCost: number;
  /** COMPLETED jobs finished in range. */
  jobsCompleted: number;
  /** `jobsWithCost / jobsCompleted × 100`; 0 when there are no completed jobs (check `jobsCompleted`). */
  pct: number;
};

export type ToolSpendCoverage = SpendCoverage & { toolId: string };

/**
 * Known gaps of the spend data, shown next to every AI-cost figure (analysis
 * §4.8; each claim checked against the code cited in the comment).
 */
export const COST_CAVEATS: readonly string[] = Object.freeze([
  // migration 033_ai_usage.sql, lib/server/worker.ts flushJobUsage, lib/server/spend.ts flushFreeUsage
  "AI xarajatlari jadvali (ai_usage) ishga tushgunga qadar xato bilan tugagan yoki tashlab ketilgan ishlar va bepul AI so'rovlari (reja, UDK, tuzatish, sayqal) xarajati yozilmagan — u davr uchun bu xarajat noma'lum.",
  // generations.cost_json was the only copy; lib/server/jobs.ts deletes the row
  "O'sha davrda foydalanuvchi o'chirgan generatsiyalar xarajati ham yo'qolgan: u faqat generatsiya qatorida saqlangan edi.",
  // lib/generation/index.ts buildArtifact: cost only when a paid call was made
  "Tugallangan ishlarning bir qismida xarajat ma'lumoti yo'q (eski yozuvlar yoki birorta pullik AI chaqiruvisiz bajarilgan ishlar) — «Qamrov» ko'rsatkichiga qarang.",
  // lib/generation/llm-pricing.ts costUsd, OPENROUTER_SURCHARGE
  "Narxlar jadvalida yo'q LLM modeli 0 dollar deb hisoblanadi (bunday qismlar «narxlanmagan» deb sanaladi); OpenRouter uchun manba model narxiga 5,5% ustama qo'shiladi.",
  // lib/generation/job-cost.ts FAL_USD_PER_MEGAPIXEL, addUnpricedImage
  "fal.ai rasmlaridan faqat fal-ai/flux/schnell narxlangan (har megapiksel $0.003); boshqa fal modellari soni bilan yoziladi, narxi 0.",
  // lib/generation/tts/types.ts TTS_PRICES.gemini; job-cost.ts IMAGE_DEFAULT_USD
  "Gemini TTS narxi 0 deb yoziladi (bepul sinov kvotasi); jadvalda yo'q Gemini rasm modeli lite narxi ($0.034) bilan hisoblanadi.",
  // lib/generation/job-cost.ts GROUNDING_USD
  "Google qidiruvi (grounding) har so'rov uchun $0.014 dan hisoblanadi: oyiga 5 000 ta bepul so'rov ayirilmaydi, shuning uchun bu qism oshirib ko'rsatiladi.",
  // lib/generation/llm-roles.ts CostMeter.toJson has no parts; spendRowsSql attributes it
  "Eski xarajat yozuvlarida xizmatlar bo'yicha tafsilot yo'q: ular faqat LLM sarfini o'z ichiga oladi va provayder/model kesimida ishning asosiy LLM juftligiga to'liq yoziladi.",
  // ai_usage_job_once_idx (generation_id, outcome) + lib/server/jobs.ts requeue paths
  "Ish qayta urinilsa, har bir natija turi (xato, tashlab ketilgan) uchun faqat birinchi urinish xarajati yoziladi.",
  // finance.soum_per_usd is one current value (lib/server/settings.ts)
  "So'mdagi qiymatlar xarajat qilingan kundagi emas, joriy dollar kursi sozlamasi bo'yicha hisoblanadi.",
]);

// ---------------------------------------------------------------------------
// SQL

const TZ = "Asia/Tashkent";
const BIGINT_MAX = "9223372036854775807";

/** A JSON number at `e` as numeric, 0 for anything else (hand-edited or malformed JSON never throws). */
const jsonNum = (e: string): string => `(CASE WHEN jsonb_typeof(${e}) = 'number' THEN (${e})::numeric ELSE 0 END)`;
/** A non-negative whole count from JSON, clamped to bigint. */
const jsonCount = (e: string): string => `LEAST(GREATEST(trunc(${jsonNum(e)}), 0), ${BIGINT_MAX})::bigint`;

/**
 * Legacy `cost_json` without `parts` (an engine `CostMeter`, LLM calls only)
 * becomes one LLM part attributed to its top provider/model pair, so part
 * groupings still sum to the totals. A cost with no spend gets no part.
 */
const LEGACY_PARTS = `CASE
    WHEN jsonb_typeof(g.cost_json->'parts') = 'array' THEN g.cost_json->'parts'
    WHEN ${jsonNum("g.cost_json->'calls'")} > 0 OR ${jsonNum("g.cost_json->'usd'")} > 0 THEN jsonb_build_array(jsonb_build_object(
      'kind', 'llm',
      'provider', COALESCE(g.cost_json->>'provider', 'unknown'),
      'model', COALESCE(g.cost_json->>'model', 'unknown'),
      'calls', ${jsonCount("g.cost_json->'calls'")},
      'inputTokens', ${jsonCount("g.cost_json->'inputTokens'")},
      'outputTokens', ${jsonCount("g.cost_json->'outputTokens'")},
      'units', 0,
      'usd', GREATEST(${jsonNum("g.cost_json->'usd'")}, 0)))
    ELSE '[]'::jsonb
  END`;

function checkRange(range: SpendRange): void {
  const from = Date.parse(range?.fromTs);
  const to = Date.parse(range?.toTsExclusive);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw new Error("admin-cost: invalid range");
}

/**
 * The canonical spend row set (see the module comment). `firstParam` is the
 * index of the first placeholder, so the fragment composes with the caller's
 * own params: `spendRowsSql(range, params.length + 1)` then
 * `params.push(...spend.params)`. The fragment and the params never contain
 * user text: the range instants are validated and passed as `$n`.
 */
export function spendRowsSql(range: SpendRange, firstParam = 1): SpendRowsSql {
  checkRange(range);
  if (!Number.isInteger(firstParam) || firstParam < 1 || firstParam > 60_000) throw new Error("admin-cost: invalid firstParam");
  const from = `$${firstParam}::timestamptz`;
  const to = `$${firstParam + 1}::timestamptz`;
  const sql = `SELECT u.at, u.source, u.outcome, u.generation_id, u.user_id, u.tool_id,
         u.calls::bigint AS calls, u.input_tokens, u.output_tokens, u.usd::numeric AS usd, u.parts
    FROM ai_usage u
   WHERE u.at >= ${from} AND u.at < ${to}
  UNION ALL
  SELECT g.finished_at AS at, 'job'::text AS source, 'completed'::text AS outcome, g.id AS generation_id,
         g.user_id, g.tool_id,
         ${jsonCount("g.cost_json->'calls'")} AS calls,
         ${jsonCount("g.cost_json->'inputTokens'")} AS input_tokens,
         ${jsonCount("g.cost_json->'outputTokens'")} AS output_tokens,
         GREATEST(${jsonNum("g.cost_json->'usd'")}, 0) AS usd,
         ${LEGACY_PARTS} AS parts
    FROM generations g
   WHERE g.status = 'COMPLETED'
     AND jsonb_typeof(g.cost_json) = 'object'
     AND g.finished_at >= ${from} AND g.finished_at < ${to}
     AND NOT EXISTS (SELECT 1 FROM ai_usage x WHERE x.generation_id = g.id AND x.outcome = 'completed')`;
  return { sql, params: [range.fromTs, range.toTsExclusive], nextParam: firstParam + 2 };
}

/** One part's JSON element `p`: is it recorded without a known price? */
const UNPRICED_PART = `((p->>'priced') = 'false'
    OR ((p->>'kind') = 'llm' AND ${jsonNum("p->'usd'")} = 0 AND (${jsonNum("p->'inputTokens'")} + ${jsonNum("p->'outputTokens'")}) > 0))`;

/** `parts` as a JSON array (anything else → empty). */
const PARTS_ARRAY = `(CASE WHEN jsonb_typeof(s.parts) = 'array' THEN s.parts ELSE '[]'::jsonb END)`;

/**
 * The parts of a row for part groupings: its own parts, or — for a row with
 * spend but no parts — one `unknown` pseudo-part carrying the row's totals, so
 * every grouping sums to the same totals.
 */
const EXPLODED_PARTS = `(CASE
    WHEN jsonb_array_length(${PARTS_ARRAY}) > 0 THEN ${PARTS_ARRAY}
    WHEN s.calls > 0 OR s.usd > 0 OR s.input_tokens > 0 OR s.output_tokens > 0 THEN jsonb_build_array(jsonb_build_object(
      'kind', 'unknown', 'provider', 'unknown', 'model', 'unknown',
      'calls', s.calls, 'inputTokens', s.input_tokens, 'outputTokens', s.output_tokens, 'units', 0, 'usd', s.usd))
    ELSE '[]'::jsonb
  END)`;

const ROW_KEYS: Record<Exclude<SpendRowGroupBy, "day">, string> = {
  tool: "COALESCE(NULLIF(s.tool_id, ''), 'unknown')",
  outcome: "s.outcome",
};

const PART_KEYS: Record<SpendPartGroupBy, string> = {
  provider: "COALESCE(NULLIF(p->>'provider', ''), 'unknown')",
  model: "COALESCE(NULLIF(p->>'model', ''), 'unknown')",
  kind: "COALESCE(NULLIF(p->>'kind', ''), 'unknown')",
};

// ---------------------------------------------------------------------------
// Helpers

type SumRow = {
  records: string | number | null;
  calls: string | number | null;
  input_tokens: string | number | null;
  output_tokens: string | number | null;
  usd: string | number | null;
};
type GroupSqlRow = SumRow & { key: string; units: string | number | null; unpriced_calls: string | number | null };

const n = (v: string | number | null | undefined): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
const usd6 = (v: string | number | null | undefined): number => Number(n(v).toFixed(6));

function toTotals(r: SumRow | undefined): SpendTotals {
  return {
    records: n(r?.records),
    calls: n(r?.calls),
    inputTokens: n(r?.input_tokens),
    outputTokens: n(r?.output_tokens),
    usd: usd6(r?.usd),
  };
}

/** Totals over the canonical spend rows in `range`. An empty range gives zeros. */
export async function spendTotals(db: Queryable, range: SpendRange): Promise<SpendTotals> {
  const spend = spendRowsSql(range);
  const res = await db.query<SumRow>(
    `SELECT count(*) AS records,
            COALESCE(sum(s.calls), 0) AS calls,
            COALESCE(sum(s.input_tokens), 0) AS input_tokens,
            COALESCE(sum(s.output_tokens), 0) AS output_tokens,
            COALESCE(sum(s.usd), 0) AS usd
       FROM (${spend.sql}) s`,
    spend.params,
  );
  return toTotals(res.rows[0]);
}

/**
 * Spend grouped by one dimension. `day` is zero-filled over every Tashkent
 * day of the range, ascending; the other groupings list only keys with rows,
 * by usd descending then key. For every grouping, the sums of `usd`, `calls`
 * and tokens equal `spendTotals` (part groupings: up to the 6-decimal rounding
 * of each stored part).
 */
export async function spendBy(db: Queryable, range: SpendRange, groupBy: SpendGroupBy): Promise<SpendGroupRow[]> {
  if (!SPEND_GROUP_BY.includes(groupBy)) throw new Error("admin-cost: invalid groupBy");
  const spend = spendRowsSql(range);
  // Per-row unpriced calls, so row groupings can report them too.
  const rows = `spend AS (
      SELECT s.*,
             (SELECT COALESCE(sum(${jsonNum("p->'calls'")}), 0)
                FROM jsonb_array_elements(${PARTS_ARRAY}) AS p
               WHERE ${UNPRICED_PART}) AS unpriced_calls
        FROM (${spend.sql}) s)`;

  let sql: string;
  if (groupBy === "day") {
    sql = `WITH ${rows},
      agg AS (
        SELECT (s.at AT TIME ZONE '${TZ}')::date AS d,
               count(*) AS records, sum(s.calls) AS calls, sum(s.input_tokens) AS input_tokens,
               sum(s.output_tokens) AS output_tokens, sum(s.usd) AS usd, sum(s.unpriced_calls) AS unpriced_calls
          FROM spend s
         GROUP BY 1)
      SELECT to_char(days.d, 'YYYY-MM-DD') AS key,
             COALESCE(agg.records, 0) AS records, COALESCE(agg.calls, 0) AS calls,
             COALESCE(agg.input_tokens, 0) AS input_tokens, COALESCE(agg.output_tokens, 0) AS output_tokens,
             COALESCE(agg.usd, 0) AS usd, NULL AS units, COALESCE(agg.unpriced_calls, 0) AS unpriced_calls
        FROM (SELECT gs::date AS d
                FROM generate_series(($1::timestamptz AT TIME ZONE '${TZ}')::date,
                                     (($2::timestamptz AT TIME ZONE '${TZ}') - interval '1 microsecond')::date,
                                     interval '1 day') AS gs) days
        LEFT JOIN agg ON agg.d = days.d
       ORDER BY days.d`;
  } else if (groupBy === "tool" || groupBy === "outcome") {
    sql = `WITH ${rows}
      SELECT ${ROW_KEYS[groupBy]} AS key,
             count(*) AS records, sum(s.calls) AS calls, sum(s.input_tokens) AS input_tokens,
             sum(s.output_tokens) AS output_tokens, sum(s.usd) AS usd, NULL AS units,
             sum(s.unpriced_calls) AS unpriced_calls
        FROM spend s
       GROUP BY 1
       ORDER BY sum(s.usd) DESC, 1`;
  } else {
    // `records` counts the spend rows contributing to the key, not parts.
    sql = `WITH ${rows}
      SELECT ${PART_KEYS[groupBy]} AS key,
             count(DISTINCT s.rid) AS records,
             sum(${jsonCount("p->'calls'")}) AS calls,
             sum(${jsonCount("p->'inputTokens'")}) AS input_tokens,
             sum(${jsonCount("p->'outputTokens'")}) AS output_tokens,
             sum(GREATEST(${jsonNum("p->'usd'")}, 0)) AS usd,
             sum(${jsonCount("p->'units'")}) AS units,
             COALESCE(sum(${jsonCount("p->'calls'")}) FILTER (WHERE ${UNPRICED_PART}), 0) AS unpriced_calls
        FROM (SELECT r.*, row_number() OVER () AS rid FROM spend r) s
        CROSS JOIN LATERAL jsonb_array_elements(${EXPLODED_PARTS}) AS p
       GROUP BY 1
       ORDER BY 6 DESC, 1`;
  }

  const res = await db.query<GroupSqlRow>(sql, spend.params);
  return res.rows.map((r) => ({
    key: String(r.key),
    ...toTotals(r),
    units: r.units === null || r.units === undefined ? null : n(r.units),
    unpricedCalls: n(r.unpriced_calls),
  }));
}

const HAS_COST = `(jsonb_typeof(g.cost_json) = 'object'
    OR EXISTS (SELECT 1 FROM ai_usage x WHERE x.generation_id = g.id AND x.outcome = 'completed'))`;

type CoverageSqlRow = { tool_id?: string; with_cost: string | number | null; completed: string | number | null };

function toCoverage(r: CoverageSqlRow | undefined): SpendCoverage {
  const jobsWithCost = n(r?.with_cost);
  const jobsCompleted = n(r?.completed);
  return { jobsWithCost, jobsCompleted, pct: jobsCompleted > 0 ? (jobsWithCost / jobsCompleted) * 100 : 0 };
}

/** Telemetry coverage: completed jobs finished in range with cost data ÷ completed jobs finished in range. */
export async function spendCoverage(db: Queryable, range: SpendRange): Promise<SpendCoverage> {
  checkRange(range);
  const res = await db.query<CoverageSqlRow>(
    `SELECT count(*) FILTER (WHERE ${HAS_COST}) AS with_cost, count(*) AS completed
       FROM generations g
      WHERE g.status = 'COMPLETED' AND g.finished_at >= $1::timestamptz AND g.finished_at < $2::timestamptz`,
    [range.fromTs, range.toTsExclusive],
  );
  return toCoverage(res.rows[0]);
}

/** `spendCoverage` per tool (tools with at least one completed job in range), by tool id. */
export async function spendCoverageByTool(db: Queryable, range: SpendRange): Promise<ToolSpendCoverage[]> {
  checkRange(range);
  const res = await db.query<CoverageSqlRow>(
    `SELECT g.tool_id, count(*) FILTER (WHERE ${HAS_COST}) AS with_cost, count(*) AS completed
       FROM generations g
      WHERE g.status = 'COMPLETED' AND g.finished_at >= $1::timestamptz AND g.finished_at < $2::timestamptz
      GROUP BY g.tool_id
      ORDER BY g.tool_id`,
    [range.fromTs, range.toTsExclusive],
  );
  return res.rows.map((r) => ({ toolId: String(r.tool_id), ...toCoverage(r) }));
}

/**
 * So'm per USD for every admin cost figure: the `finance.soum_per_usd`
 * setting (DB override, else `SOUM_PER_USD` env, else 12 700). Read through
 * the settings cache, not the caller's client: it is one small value.
 */
export async function soumPerUsd(): Promise<number> {
  return getSetting("finance.soum_per_usd");
}
