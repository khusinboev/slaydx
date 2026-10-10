"use client";

import { adminGet, type AdminCallOptions } from "./core";

/**
 * AI cost and provider health API (docs/admin/02-plan.md §6.7, `ai.view`).
 * Thin typed wrappers over `core.ts` (AbortSignal, 401/403 handling).
 *
 * Types are declared here, not imported from `lib/server/**`: admin client
 * code must not reach server modules (tests/admin-boundary.test.mts).
 */

export type AiGroupBy = "day" | "tool" | "provider" | "model" | "kind";

export type AiCostRow = {
  /** day → `YYYY-MM-DD`; tool → tool id or `free:<endpoint>`; provider/model/kind → the part's value. */
  key: string;
  /** groupBy=tool: the Uzbek tool title (free endpoints "Bepul AI: …"); `null` for the other groupings. */
  title: string | null;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Images, grounding queries or TTS characters; `null` for day and tool groupings. */
  units: number | null;
  usd: number;
  records: number;
  /** Calls recorded at 0 dollars because no price is known. */
  unpricedCalls: number;
};

export type AiCostTotals = {
  records: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  unpricedCalls: number;
};

export type AiCoverage = {
  /** Completed jobs finished in range, from the `ai_usage` rollout on, that have cost data. */
  jobsWithCost: number;
  /** Completed jobs finished in range, from the rollout on. */
  jobsCompleted: number;
  pct: number;
  /** First `ai_usage` row (ISO instant); `null` while the table is empty. */
  rolloutAt: string | null;
  /** Completed jobs finished in range BEFORE the rollout — reported apart, never part of `pct`. */
  historicalCompleted: number;
  /** Of those, the ones that still have a legacy `cost_json`. */
  historicalWithCost: number;
};

export type AiCostResponse = {
  range: { from: string; to: string; days: number };
  groupBy: AiGroupBy;
  rows: AiCostRow[];
  totals: AiCostTotals;
  coverage: AiCoverage;
  caveats: string[];
  /** `finance.soum_per_usd`: the so'm equivalent of every dollar figure. */
  soumPerUsd: number;
};

export type AiProviderKeyName = "gemini" | "anthropic" | "openai" | "openrouter" | "xai" | "fal" | "pexels" | "pixabay" | "azureTts" | "aisha";

export type AiProcess = { process: string; role: "web" | "worker"; lastSeenAt: string; stale: boolean };
export type AiBreaker = { process: string; name: string; state: "closed" | "open" | "half-open"; openUntil: string | null; failures: number; stale: boolean };
export type AiLimiter = { process: string; name: string; active: number; waiting: number; max: number; stale: boolean };
export type AiUsage24h = { provider: string; model: string; calls: number; usd: number };

export type AiProvidersResponse = {
  keys: Record<AiProviderKeyName, boolean>;
  processes: AiProcess[];
  breakers: AiBreaker[];
  limiters: AiLimiter[];
  usage24h: AiUsage24h[];
  soumPerUsd: number;
};

/** GET /api/admin/ai/cost. Errors: 400 bad range/groupBy, 403 `forbidden`, 503 `timeout`. */
export function getAiCost(params: { from: string; to: string; groupBy: AiGroupBy }, opts?: AdminCallOptions): Promise<AiCostResponse> {
  return adminGet<AiCostResponse>("/api/admin/ai/cost", params, opts);
}

/** GET /api/admin/ai/providers. Provider keys arrive as booleans only. */
export function getAiProviders(opts?: AdminCallOptions): Promise<AiProvidersResponse> {
  return adminGet<AiProvidersResponse>("/api/admin/ai/providers", undefined, opts);
}
