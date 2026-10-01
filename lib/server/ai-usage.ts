import "server-only";
import type { CostJson } from "../generation/types";
import { query } from "./db";
import { toJsonb } from "./jsonb";
import { log } from "./log";

/**
 * Append-only AI spend records (`ai_usage`, docs/admin/02-plan.md §17.3,
 * §17.7, WP-X1) for spend that `generations.cost_json` cannot hold: failed and
 * abandoned jobs, the free-LLM endpoints, and a completed job's cost again so
 * it survives the user deleting the generation (no FK on purpose).
 *
 * Telemetry only: never throws, never touches prices or wallets. One row per
 * (generation, outcome) — a repeated flush for the same job and outcome is a
 * no-op thanks to `ai_usage_job_once_idx`.
 */

export type AiUsageSource = "job" | "free";
export type AiUsageOutcome = "completed" | "failed" | "abandoned" | "free";

export type AiUsageInput = {
  source: AiUsageSource;
  outcome: AiUsageOutcome;
  generationId?: string | null;
  userId?: string | number | null;
  /** Tool id, or `free:<endpoint>` for the free endpoints. */
  toolId: string;
  cost: CostJson;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** NUMERIC(12,6) holds < 10^6. */
const MAX_USD = 999_999.999999;
const INT_MAX = 2_147_483_647;

// On globalThis so a test (or a second bundle copy of this module) can flush every write.
const pending: Set<Promise<boolean>> = ((globalThis as typeof globalThis & { __slaydxAiUsagePending?: Set<Promise<boolean>> }).__slaydxAiUsagePending ??= new Set());

function count(n: unknown, max = Number.MAX_SAFE_INTEGER): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.min(Math.trunc(v), max) : 0;
}

/** True when the meter saw anything worth a row (a call, a cost or a part). */
export function hasSpend(cost: CostJson | null | undefined): cost is CostJson {
  if (!cost) return false;
  return count(cost.calls) > 0 || Number(cost.usd) > 0 || (Array.isArray(cost.parts) && cost.parts.length > 0);
}

async function insert(r: AiUsageInput): Promise<boolean> {
  const generationId = typeof r.generationId === "string" && UUID_RE.test(r.generationId) ? r.generationId : null;
  const userId = r.userId !== null && r.userId !== undefined && /^\d{1,18}$/.test(String(r.userId)) ? String(r.userId) : null;
  const usd = Number(r.cost.usd);
  const rows = await query<{ id: string }>(
    `INSERT INTO ai_usage (source, outcome, generation_id, user_id, tool_id, calls, input_tokens, output_tokens, usd, parts)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     ON CONFLICT (generation_id, outcome) WHERE generation_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      r.source,
      r.outcome,
      generationId,
      userId,
      String(r.toolId ?? "").slice(0, 64) || null,
      count(r.cost.calls, INT_MAX),
      count(r.cost.inputTokens),
      count(r.cost.outputTokens),
      Number.isFinite(usd) && usd > 0 ? Math.min(Number(usd.toFixed(6)), MAX_USD) : 0,
      toJsonb(Array.isArray(r.cost.parts) ? r.cost.parts : []),
    ],
  );
  return rows.length > 0;
}

/**
 * Records one spend row. Resolves `true` when a row was written, `false` when
 * there was nothing to record, the (generation, outcome) row already exists,
 * or the write failed (logged as a warning). Never rejects.
 */
export function recordAiUsage(r: AiUsageInput): Promise<boolean> {
  let p: Promise<boolean>;
  try {
    if (!hasSpend(r.cost)) return Promise.resolve(false);
    p = insert(r).catch((err: unknown) => {
      log("warn", "[ai-usage] sarf yozilmadi", {
        outcome: r.outcome,
        toolId: r.toolId,
        genId: r.generationId ?? undefined,
        err,
      });
      return false;
    });
  } catch (err) {
    log("warn", "[ai-usage] sarf yozilmadi", { outcome: r?.outcome, err });
    return Promise.resolve(false);
  }
  pending.add(p);
  void p.finally(() => pending.delete(p));
  return p;
}

/** Test seam: resolves when every write started so far has settled. */
export async function flushAiUsage(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}
