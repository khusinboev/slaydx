import "server-only";
import type { PoolClient } from "pg";
import type { DateRange } from "./admin-list";
import { TOOL_BY_ID } from "../tools";
import { getSetting } from "./settings";

/**
 * The ONE canonical definition of AI spend for the admin panel
 * (docs/admin/02-plan.md §6.3 `aiCostUsd`/`aiCoverage`, §6.7, §17.3–17.4).
 * The dashboard, the AI-cost page and the pricing module all build on
 * `spendRowsSql`, and per-job figures (generations list and detail) on
 * `spendForJobs`; both come from one rule, so their numbers always agree.
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
 * Coverage is measured from the `ai_usage` rollout (its first row) on: a job that
 * finished before that could not have been measured, so it is reported as
 * "historical" next to the coverage instead of lowering it (`spendCoverage`).
 * The notes shown beside the figures are computed (`costCaveats`), never a fixed list.
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
  /**
   * COMPLETED jobs finished in range, from the `ai_usage` rollout on, that have cost
   * data (`cost_json` or a completed `ai_usage` row). Jobs finished before the
   * rollout are counted separately (`historical*`): they could not have been
   * measured, so they must not drag the coverage down.
   */
  jobsWithCost: number;
  /** COMPLETED jobs finished in range, from the `ai_usage` rollout on. */
  jobsCompleted: number;
  /** `jobsWithCost / jobsCompleted × 100`; 0 when there are no completed jobs (check `jobsCompleted`). */
  pct: number;
  /** First `ai_usage` row (ISO instant) = the day spend measurement started; `null` while the table is empty (then nothing is historical). */
  rolloutAt: string | null;
  /** COMPLETED jobs finished in range BEFORE `rolloutAt`. */
  historicalCompleted: number;
  /** Of those, the ones that still carry a legacy `cost_json`. */
  historicalWithCost: number;
};

export type ToolSpendCoverage = SpendCoverage & { toolId: string };

/**
 * The permanent limits of the data, true for every period. The former ten-sentence
 * list (stale fal.ai / «Gemini TTS is free» rows included) is replaced by
 * `costCaveats`, which computes what applies, with real numbers, and ENDS with
 * these always-true notes (so the AI screen and the pricing screen both show them).
 */
export const COST_CAVEATS: readonly string[] = Object.freeze([
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
  const sql = canonicalRowsSql(`u.at >= ${from} AND u.at < ${to}`, `g.finished_at >= ${from} AND g.finished_at < ${to}`);
  return { sql, params: [range.fromTs, range.toTsExclusive], nextParam: firstParam + 2 };
}

/**
 * THE rule of the module comment, with one constant filter per branch: `u` is
 * `ai_usage`, `g` the legacy `generations` row. Both public forms (by range,
 * by job ids) are built here, so they can never disagree on what counts.
 */
function canonicalRowsSql(usageFilter: string, legacyFilter: string): string {
  return `SELECT u.at, u.source, u.outcome, u.generation_id, u.user_id, u.tool_id,
         u.calls::bigint AS calls, u.input_tokens, u.output_tokens, u.usd::numeric AS usd, u.parts
    FROM ai_usage u
   WHERE ${usageFilter}
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
     AND ${legacyFilter}
     AND NOT EXISTS (SELECT 1 FROM ai_usage x WHERE x.generation_id = g.id AND x.outcome = 'completed')`;
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

/** One canonical spend row of a job (an `ai_usage` outcome, or the legacy `cost_json`). */
export type JobSpendRow = {
  at: string;
  outcome: string;
  usd: number;
  /** `CostPart[]` as stored (legacy CostMeter costs get their one attributed LLM part). */
  parts: unknown;
};

/** A job's canonical spend over all time: totals plus its rows, oldest first. */
export type JobSpend = SpendTotals & { rows: JobSpendRow[] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Callers pass a page of jobs (≤ 100) or one job; a larger set is a bug, not a request. */
const JOB_IDS_MAX = 1_000;

/**
 * Canonical spend of specific jobs, not range-limited (a job's figure never
 * depends on the date filter): the same rule as `spendRowsSql`, filtered by
 * generation id, so it uses `ai_usage_job_once_idx` and the generations
 * primary key instead of scanning all spend. For any set of jobs whose spend
 * rows all fall inside a range, the per-job sums add up to `spendTotals` of
 * that range minus its free calls. Jobs with no spend rows are absent.
 */
export async function spendForJobs(db: Queryable, ids: readonly string[]): Promise<Map<string, JobSpend>> {
  const out = new Map<string, JobSpend>();
  if (ids.length === 0) return out;
  if (ids.length > JOB_IDS_MAX || !ids.every((id) => typeof id === "string" && UUID_RE.test(id))) {
    throw new Error("admin-cost: invalid job ids");
  }
  const sql = canonicalRowsSql("u.generation_id = ANY($1::uuid[])", "g.id = ANY($1::uuid[])");
  const res = await db.query<Omit<SumRow, "records"> & { id: string; at: Date | string; outcome: string; job_usd: string; parts: unknown }>(
    `SELECT s.generation_id::text AS id, s.at, s.outcome, s.calls, s.input_tokens, s.output_tokens, s.usd::text AS usd, s.parts,
            sum(s.usd) OVER (PARTITION BY s.generation_id)::text AS job_usd
       FROM (${sql}) s
      ORDER BY s.generation_id, s.at`,
    [ids],
  );
  for (const r of res.rows) {
    let job = out.get(r.id);
    if (!job) {
      // The job total is summed in SQL (exact numeric), then rounded once, like `spendTotals`.
      job = { records: 0, calls: 0, inputTokens: 0, outputTokens: 0, usd: usd6(r.job_usd), rows: [] };
      out.set(r.id, job);
    }
    job.records += 1;
    job.calls += n(r.calls);
    job.inputTokens += n(r.input_tokens);
    job.outputTokens += n(r.output_tokens);
    job.rows.push({ at: new Date(r.at).toISOString(), outcome: String(r.outcome), usd: usd6(r.usd), parts: r.parts });
  }
  return out;
}

/** Per-key aggregates over exploded parts (`p`); the same list serves every part grouping. */
const PART_AGGREGATES = `count(DISTINCT s.rid) AS records,
             sum(${jsonCount("p->'calls'")}) AS calls,
             sum(${jsonCount("p->'inputTokens'")}) AS input_tokens,
             sum(${jsonCount("p->'outputTokens'")}) AS output_tokens,
             sum(GREATEST(${jsonNum("p->'usd'")}, 0)) AS usd,
             sum(${jsonCount("p->'units'")}) AS units,
             COALESCE(sum(${jsonCount("p->'calls'")}) FILTER (WHERE ${UNPRICED_PART}), 0) AS unpriced_calls`;

/** Spend rows (CTE `spend`) exploded into their parts: `s` is the numbered row, `p` one part. */
const PARTS_FROM = `FROM (SELECT r.*, row_number() OVER () AS rid FROM spend r) s
        CROSS JOIN LATERAL jsonb_array_elements(${EXPLODED_PARTS}) AS p`;

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
      SELECT ${PART_KEYS[groupBy]} AS key, ${PART_AGGREGATES}
        ${PARTS_FROM}
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

export type SpendProviderModelRow = SpendTotals & {
  provider: string;
  model: string;
  units: number;
  unpricedCalls: number;
};

/**
 * Spend per provider/model pair (the pair the provider screens show), from the
 * same exploded parts as the `provider` and `model` groupings, so the sums of
 * `usd`, `calls` and tokens equal `spendTotals` and each provider's (or
 * model's) pairs add up to `spendBy`'s row for it. By usd descending, then
 * provider, model.
 */
export async function spendByProviderModel(db: Queryable, range: SpendRange): Promise<SpendProviderModelRow[]> {
  const spend = spendRowsSql(range);
  const res = await db.query<SumRow & { provider: string; model: string; units: string | number | null; unpriced_calls: string | number | null }>(
    `WITH spend AS (${spend.sql})
      SELECT ${PART_KEYS.provider} AS provider, ${PART_KEYS.model} AS model, ${PART_AGGREGATES}
        ${PARTS_FROM}
       GROUP BY 1, 2
       ORDER BY 7 DESC, 1, 2`,
    spend.params,
  );
  return res.rows.map((r) => ({
    provider: String(r.provider),
    model: String(r.model),
    ...toTotals(r),
    units: n(r.units),
    unpricedCalls: n(r.unpriced_calls),
  }));
}

export type ToolKindSpendRow = { toolId: string; kind: string; usd: number; unpricedCalls: number };

/**
 * Spend per tool and part kind (`llm`, `image`, `tts`, `grounding`, `unknown`) — what a
 * tool's cost is made of — from the same exploded parts as the `kind` grouping, so each
 * tool's kinds add up to `spendBy(…, "tool")`'s row for it (up to the 6-decimal rounding of
 * each stored part). `rowFilter` is an extra SQL condition on the spend row `s` built by
 * the caller from constants (never user text), e.g. the pricing screen's admin filter.
 * By tool, then usd descending, then kind.
 */
export async function spendKindsByTool(db: Queryable, range: SpendRange, rowFilter = "TRUE"): Promise<ToolKindSpendRow[]> {
  const spend = spendRowsSql(range);
  const res = await db.query<{ tool_id: string; kind: string; usd: string | number | null; unpriced_calls: string | number | null }>(
    `WITH spend AS (${spend.sql})
      SELECT ${ROW_KEYS.tool} AS tool_id, ${PART_KEYS.kind} AS kind,
             sum(GREATEST(${jsonNum("p->'usd'")}, 0)) AS usd,
             COALESCE(sum(${jsonCount("p->'calls'")}) FILTER (WHERE ${UNPRICED_PART}), 0) AS unpriced_calls
        ${PARTS_FROM}
       WHERE ${rowFilter}
       GROUP BY 1, 2
       ORDER BY 1, 3 DESC, 2`,
    spend.params,
  );
  return res.rows.map((r) => ({ toolId: String(r.tool_id), kind: String(r.kind), usd: usd6(r.usd), unpricedCalls: n(r.unpriced_calls) }));
}

const HAS_COST = `(jsonb_typeof(g.cost_json) = 'object'
    OR EXISTS (SELECT 1 FROM ai_usage x WHERE x.generation_id = g.id AND x.outcome = 'completed'))`;

/**
 * A job finished at or after the rollout `$3` (NULL = no `ai_usage` row yet, so no
 * rollout and nothing is historical) is measurable ("current"); an earlier one is
 * "historical" — the table did not exist, its absence is not a gap anyone can fix.
 */
const CURRENT = `g.finished_at >= COALESCE($3::timestamptz, '-infinity'::timestamptz)`;

type CoverageSqlRow = {
  tool_id?: string;
  with_cost: string | number | null;
  completed: string | number | null;
  hist_with_cost: string | number | null;
  hist_completed: string | number | null;
};

const COVERAGE_COLUMNS = `count(*) FILTER (WHERE ${CURRENT} AND ${HAS_COST}) AS with_cost,
            count(*) FILTER (WHERE ${CURRENT}) AS completed,
            count(*) FILTER (WHERE NOT (${CURRENT}) AND ${HAS_COST}) AS hist_with_cost,
            count(*) FILTER (WHERE NOT (${CURRENT})) AS hist_completed`;

function toCoverage(r: CoverageSqlRow | undefined, rolloutAt: string | null): SpendCoverage {
  const jobsWithCost = n(r?.with_cost);
  const jobsCompleted = n(r?.completed);
  return {
    jobsWithCost,
    jobsCompleted,
    pct: jobsCompleted > 0 ? (jobsWithCost / jobsCompleted) * 100 : 0,
    rolloutAt,
    historicalCompleted: n(r?.hist_completed),
    historicalWithCost: n(r?.hist_with_cost),
  };
}

/**
 * Jobs finishing within this window BEFORE the first `ai_usage` row still count as
 * measurable: a job's row is flushed just after it finishes, so the job behind the very
 * first row finished slightly earlier than the row's own timestamp.
 */
const ROLLOUT_GRACE = "interval '1 hour'";

/**
 * When AI spend measurement started: the first `ai_usage` row (ISO instant) minus a
 * one-hour grace, or `null` while the table is empty. Jobs that finished before it are
 * "historical" (migration 033 did not exist) and are reported apart from the coverage.
 * Reads one indexed minimum (`ai_usage_at_idx`) — no join with `generations`, so a
 * late row of an OLD job (a backfill, a requeue) cannot move the date back.
 */
export async function spendRollout(db: Queryable): Promise<string | null> {
  const res = await db.query<{ at: Date | string | null }>(`SELECT min(at) - ${ROLLOUT_GRACE} AS at FROM ai_usage`);
  const at = res.rows[0]?.at;
  return at ? new Date(at).toISOString() : null;
}

async function coverageAt(db: Queryable, range: SpendRange, rolloutAt: string | null): Promise<SpendCoverage> {
  const res = await db.query<CoverageSqlRow>(
    `SELECT ${COVERAGE_COLUMNS}
       FROM generations g
      WHERE g.status = 'COMPLETED' AND g.finished_at >= $1::timestamptz AND g.finished_at < $2::timestamptz`,
    [range.fromTs, range.toTsExclusive, rolloutAt],
  );
  return toCoverage(res.rows[0], rolloutAt);
}

async function coverageByToolAt(db: Queryable, range: SpendRange, rolloutAt: string | null): Promise<ToolSpendCoverage[]> {
  const res = await db.query<CoverageSqlRow>(
    `SELECT g.tool_id, ${COVERAGE_COLUMNS}
       FROM generations g
      WHERE g.status = 'COMPLETED' AND g.finished_at >= $1::timestamptz AND g.finished_at < $2::timestamptz
      GROUP BY g.tool_id
      ORDER BY g.tool_id`,
    [range.fromTs, range.toTsExclusive, rolloutAt],
  );
  return res.rows.map((r) => ({ toolId: String(r.tool_id), ...toCoverage(r, rolloutAt) }));
}

/**
 * Telemetry coverage: completed jobs finished in range, from the `ai_usage` rollout
 * on, with cost data ÷ those jobs. Earlier jobs are reported as `historical*` and
 * never lower the percentage.
 */
export async function spendCoverage(db: Queryable, range: SpendRange): Promise<SpendCoverage> {
  checkRange(range);
  return coverageAt(db, range, await spendRollout(db));
}

/** `spendCoverage` per tool (tools with at least one completed job in range), by tool id. */
export async function spendCoverageByTool(db: Queryable, range: SpendRange): Promise<ToolSpendCoverage[]> {
  checkRange(range);
  return coverageByToolAt(db, range, await spendRollout(db));
}

// ---------------------------------------------------------------------------
// Computed caveats

/** `p->>'estimated'` — the part's usd rests on a documented default or estimated tokens. */
const ESTIMATED_PART = `((p->>'estimated') = 'true')`;

const KIND_LABEL: Record<string, string> = {
  llm: "LLM",
  image: "rasm",
  grounding: "Google qidiruvi",
  tts: "ovoz (TTS)",
  unknown: "noma'lum",
};

type FlaggedRow = { kind: string; provider: string; model: string; unpriced_calls: string | number | null; estimated_calls: string | number | null };

/** Names listed in one sentence; the rest is summarised so a long list never floods the panel. */
const LIST_MAX = 5;

function list(items: string[]): string {
  if (items.length <= LIST_MAX) return items.join(", ");
  return `${items.slice(0, LIST_MAX).join(", ")} va yana ${items.length - LIST_MAX} ta`;
}

const decimal = (v: number, digits: number): string => v.toFixed(digits).replace(".", ",");
const usdText = (v: number): string => `$${v >= 1 ? v.toFixed(2) : v.toFixed(4)}`;
const pctText = (v: number): string => `${decimal(v, 1)}%`;
const toolTitle = (id: string): string => (Object.prototype.hasOwnProperty.call(TOOL_BY_ID, id) ? TOOL_BY_ID[id as keyof typeof TOOL_BY_ID].title : id || "noma'lum vosita");
const dayText = (iso: string): string => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const partName = (r: FlaggedRow): string => `${r.provider}:${r.model}`;

/**
 * The known gaps of the spend data for `range`, as Uzbek sentences with the real
 * numbers. Replaces the former static list: an item appears ONLY when it applies, and
 * the always-true `COST_CAVEATS` (the retry gap, today's FX rate on old spend) close the
 * list, so the computed part is exactly what comes before them. Items, in order:
 *   1. NEW jobs (finished after the rollout) without cost data, per tool;
 *   2. HISTORICAL jobs (finished before the first `ai_usage` row) without cost data;
 *   3. LLM models with tokens but no price (recorded at usd 0);
 *   4. other unpriced services (fal models, TTS models missing from the price book);
 *   5. estimated prices (default image price, TTS tokens estimated from audio length);
 *   6. Google Search grounding, billed per query with the free quota NOT deducted;
 *   7. free-LLM calls (outline, UDK, rewrite, polish): their share of the spend;
 *   8. `COST_CAVEATS`, always.
 * Read-only; takes any `Queryable` so the caller's READ ONLY transaction is reused.
 */
export async function costCaveats(db: Queryable, range: SpendRange): Promise<string[]> {
  checkRange(range);
  const out: string[] = [];
  const rolloutAt = await spendRollout(db);

  // 1 + 2: coverage gaps.
  const total = await coverageAt(db, range, rolloutAt);
  const missingNew = total.jobsCompleted - total.jobsWithCost;
  if (missingNew > 0) {
    const gaps = (await coverageByToolAt(db, range, rolloutAt))
      .filter((t) => t.jobsCompleted > t.jobsWithCost)
      .sort((a, b) => b.jobsCompleted - b.jobsWithCost - (a.jobsCompleted - a.jobsWithCost) || a.toolId.localeCompare(b.toolId));
    out.push(
      `${missingNew} ta yangi ishda (${total.jobsCompleted} ta tugallangandan, ${pctText((missingNew / total.jobsCompleted) * 100)}) tannarx umuman yozilmagan: ${list(gaps.map((t) => `${toolTitle(t.toolId)} (${t.jobsWithCost}/${t.jobsCompleted})`))}. Bu vositalarning tannarxi kam baholangan.`,
    );
  }
  const missingOld = total.historicalCompleted - total.historicalWithCost;
  if (missingOld > 0 && rolloutAt) {
    out.push(
      `Tarixiy: AI xarajatlari hisobi ishga tushgunga (${dayText(rolloutAt)}) qadar tugagan ${total.historicalCompleted} ta ishning ${missingOld} tasida tannarx ma'lumoti yo'q. Ular qamrov ko'rsatkichiga kirmaydi va endi tuzatib bo'lmaydi.`,
    );
  }

  // 3 + 4 + 5: parts the price book could not price, or priced by estimate.
  const spend = spendRowsSql(range);
  const flagged = await db.query<FlaggedRow>(
    `WITH spend AS (${spend.sql})
      SELECT ${PART_KEYS.kind} AS kind, ${PART_KEYS.provider} AS provider, ${PART_KEYS.model} AS model,
             COALESCE(sum(${jsonCount("p->'calls'")}) FILTER (WHERE ${UNPRICED_PART}), 0) AS unpriced_calls,
             COALESCE(sum(${jsonCount("p->'calls'")}) FILTER (WHERE ${ESTIMATED_PART}), 0) AS estimated_calls
        ${PARTS_FROM}
       GROUP BY 1, 2, 3
      HAVING bool_or(${UNPRICED_PART}) OR bool_or(${ESTIMATED_PART})
       ORDER BY 4 DESC, 5 DESC, 1, 2, 3`,
    spend.params,
  );
  const unpriced = flagged.rows.filter((r) => n(r.unpriced_calls) > 0);
  const models = unpriced.filter((r) => r.kind === "llm");
  if (models.length) {
    out.push(
      `Narxi noma'lum LLM modellari: ${list(models.map((r) => `${partName(r)} (${n(r.unpriced_calls)} chaqiruv)`))}. Ular 0 dollar deb hisoblangan, haqiqiy xarajat yuqoriroq; model narxlar jadvaliga (llm-pricing.ts) qo'shilishi kerak.`,
    );
  }
  const services = unpriced.filter((r) => r.kind !== "llm");
  if (services.length) {
    out.push(
      `Narxlanmagan xizmatlar: ${list(services.map((r) => `${KIND_LABEL[r.kind] ?? r.kind} ${partName(r)} (${n(r.unpriced_calls)} chaqiruv)`))}. Ular 0 dollar deb yozilgan, haqiqiy xarajat yuqoriroq.`,
    );
  }
  const estimated = flagged.rows.filter((r) => n(r.estimated_calls) > 0);
  if (estimated.length) {
    out.push(
      `Narxi taxminiy xizmatlar: ${list(estimated.map((r) => `${KIND_LABEL[r.kind] ?? r.kind} ${partName(r)} (${n(r.estimated_calls)} chaqiruv)`))}. Narx standart qiymat yoki audio uzunligidan baholangan tokenlar bilan hisoblangan.`,
    );
  }

  // 6: grounding is billed per query, the monthly free quota is not deducted.
  const grounding = await db.query<{ queries: string | number | null; usd: string | number | null }>(
    `WITH spend AS (${spend.sql})
      SELECT COALESCE(sum(${jsonCount("p->'units'")}), 0) AS queries, COALESCE(sum(GREATEST(${jsonNum("p->'usd'")}, 0)), 0) AS usd
        ${PARTS_FROM}
       WHERE p->>'kind' = 'grounding'`,
    spend.params,
  );
  const queries = n(grounding.rows[0]?.queries);
  if (queries > 0) {
    out.push(
      `Google qidiruvi: ${queries} ta so'rov har biri $0.014 dan ${usdText(usd6(grounding.rows[0]?.usd))} deb hisoblangan. Oyiga 5 000 ta bepul so'rov ayirilmagan, shuning uchun bu qism oshirib ko'rsatilgan.`,
    );
  }

  // 7: free-LLM spend belongs to no tool.
  const money = await db.query<{ all_usd: string | number | null; free_usd: string | number | null; free_calls: string | number | null }>(
    `SELECT COALESCE(sum(s.usd), 0) AS all_usd,
            COALESCE(sum(s.usd) FILTER (WHERE s.source = 'free'), 0) AS free_usd,
            COALESCE(sum(s.calls) FILTER (WHERE s.source = 'free'), 0) AS free_calls
       FROM (${spend.sql}) s`,
    spend.params,
  );
  const allUsd = n(money.rows[0]?.all_usd);
  const freeUsd = n(money.rows[0]?.free_usd);
  if (freeUsd > 0 && allUsd > 0) {
    out.push(
      `Bepul AI so'rovlari (reja, UDK, tuzatish, sayqal): ${n(money.rows[0]?.free_calls)} ta chaqiruv, ${usdText(freeUsd)} — jami AI xarajatining ${pctText((freeUsd / allUsd) * 100)}. Bu xarajat hech bir vositaning tannarxiga kirmaydi.`,
    );
  }
  // Always true, whatever the period: shown last, after the computed items.
  out.push(...COST_CAVEATS);
  return out;
}

/**
 * So'm per USD for every admin cost figure: the `finance.soum_per_usd`
 * setting (DB override, else `SOUM_PER_USD` env, else 12 700). Read through
 * the settings cache, not the caller's client: it is one small value.
 */
export async function soumPerUsd(): Promise<number> {
  return getSetting("finance.soum_per_usd");
}
