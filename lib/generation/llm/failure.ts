/**
 * LLM failure observability + JSON-quality helpers (prod incident 2026-10-10).
 *
 * Before this module a failed LLM call became `null` and the engine threw a
 * generic user error, so the real cause (HTTP status / empty / invalid JSON /
 * truncated / safety / timeout / breaker) never reached the worker log.
 *
 * Every failed attempt now produces exactly ONE structured `warn` line
 * (`reportFailure`). The line carries ONLY metadata: provider, model, kind,
 * status, durations, token counts and a short provider error message. It never
 * carries the prompt, the user text or the model output, and never a key
 * (`log()` also redacts secrets). `jobId`/`toolId`/`userId` come from the
 * worker's log context automatically.
 *
 * `describeLastFailure()` gives the engines a one-line summary of the most
 * recent failed attempt of the current job, so the thrown error can carry it
 * as `cause` and the `[worker] job … failed` line shows the root cause.
 */
import { log } from "../../server/log";
import { AI_OUTAGE_ERROR, UserFacingError } from "../../server/user-error";
import { parseLlmJsonDetailed } from "../json";
import type { RepairKind } from "../json-repair";
import { currentJobCost, type JobCost } from "../job-cost";
import type { CircuitBreaker } from "./breaker";

export type FailureKind = "http" | "timeout" | "network" | "empty" | "bad_json" | "truncated" | "safety" | "other";

export type LlmFailure = {
  /** Role (`writer`, `judge`…) or the direct path label (`complete`/`stream`/`grounded`). */
  role: string;
  provider: string;
  model: string;
  /** 1-based attempt number inside the call. */
  attempt: number;
  durationMs: number;
  kind: FailureKind;
  status?: number;
  retryable: boolean;
  /** Short provider error text (clipped to 200 chars, never prompt/output text). */
  message: string;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
};

export type ClassifyInput = {
  status?: number;
  message?: string;
  timedOut?: boolean;
  empty?: boolean;
  safety?: boolean;
  truncated?: boolean;
  badJson?: boolean;
};

const TIMEOUT_RE = /abort|\btimed?\s?out\b/i;
const NETWORK_RE = /fetch failed|network|socket|ECONN\w*|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE|UND_ERR\w*|connect/i;

/** Maps what we know about a failed attempt to one failure kind (flags win over text). */
export function classifyFailure(i: ClassifyInput): FailureKind {
  if (i.safety) return "safety";
  if (i.truncated) return "truncated";
  if (i.badJson) return "bad_json";
  if (i.empty) return "empty";
  if (i.timedOut || (i.status === undefined && i.message && TIMEOUT_RE.test(i.message))) return "timeout";
  if (i.status !== undefined) return "http";
  if (i.message && NETWORK_RE.test(i.message)) return "network";
  return "other";
}

/** Finish reasons that mean the provider refused on policy grounds (retrying will not help). */
const SAFETY_FINISH = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "IMAGE_SAFETY", "refusal", "content_filter"]);

export function isSafetyFinish(reason: string | undefined | null): boolean {
  return Boolean(reason) && SAFETY_FINISH.has(String(reason));
}

/** The provider cut the answer because of the output-token limit. */
export function isMaxTokensFinish(reason: string | undefined | null): boolean {
  return Boolean(reason) && /^(MAX_TOKENS|max_tokens|length)$/.test(String(reason));
}

/**
 * How long an account-level failure keeps a provider's breaker open. The failure lasts until a human pays or fixes the
 * key (2026-11-05: Gemini answered 403 for hours), so each job should not rediscover it; one probe per minute notices
 * the recovery. A job with a deadline and no fallback waits for the cooldown only once `msUntilRetry` is within
 * `BREAKER_WAIT_MAX_MS` (35 s), so during an outage such a job can spend up to 35 s before it fails.
 */
export const ACCOUNT_BREAKER_MS = 60_000;

/** A bare 403 may be one gated model: it takes this many in a row to open the breaker. */
export const BARE_403_STRIKES = 2;

/** The refusal names the account (`Consumer … has been suspended`, «outstanding balance»), not this request. */
const ACCOUNT_TEXT_RE = /balance|billing|payment|arrear|suspended|denied access|API[ _]key/i;

/**
 * Bad key, no balance, billing or a suspended project: the provider is reachable but will refuse every request of this
 * account, so it is not «healthy» (other 4xx are) and retrying is useless. Gemini answers 400 for a bad key.
 */
export function isAccountFailure(status: number | undefined, message?: string): boolean {
  if (status === 401 || status === 402 || status === 403) return true;
  return status === 400 && /API[ _]key (not valid|invalid|expired)|API_KEY_(INVALID|EXPIRED)|Arrearage/i.test(message ?? "");
}

/**
 * Feeds an account failure to the provider's breaker: at once for a bad key (401), no balance (402), a provider-flagged
 * failure or a refusal that names the account; a bare 403 only when it repeats.
 */
export function accountStrike(breaker: Pick<CircuitBreaker, "trip" | "strike">, status: number | undefined, message: string | undefined, flagged = false): void {
  const why = `hisob xatosi ${status ?? ""}`.trim();
  if (flagged || status !== 403 || ACCOUNT_TEXT_RE.test(message ?? "")) breaker.trip(ACCOUNT_BREAKER_MS, why);
  else breaker.strike(BARE_403_STRIKES, ACCOUNT_BREAKER_MS, why);
}

/**
 * ONE warn line when a fallback spec answered: metadata only, greppable (`[llm] fallback used`). The admin usage tables
 * show the same thing as spend under the new provider.
 */
export function reportFallback(f: { role: string; provider: string; model: string }): void {
  try {
    log("warn", "[llm] fallback used", { role: f.role, provider: f.provider, model: f.model });
  } catch {
    // Observability must never change what the call does.
  }
}

/* ------------------------------------------------------------------ *
 * Counters + last failure
 * ------------------------------------------------------------------ */

const counters = new Map<string, number>();

/** In-memory failure counts per (provider, kind) since process start. */
export function failureCounters(): { provider: string; kind: FailureKind; count: number }[] {
  return [...counters.entries()]
    .map(([k, count]) => {
      const [provider, kind] = k.split("|");
      return { provider, kind: kind as FailureKind, count };
    })
    .sort((a, b) => b.count - a.count);
}

export function resetFailureCounters(): void {
  counters.clear();
  perJob = new WeakMap();
  globalSlot = newSlot();
}

/**
 * `byProvider`: the latest failed attempt of each provider since it last answered, for the «every provider is down»
 * verdict. `lastAt`: when `last` happened. `answered`: some provider answered after `last`.
 */
type Slot = { last?: LlmFailure; count: number; byProvider: Map<string, LlmFailure>; lastAt: number; answered: boolean };
const newSlot = (): Slot => ({ count: 0, byProvider: new Map(), lastAt: 0, answered: false });
let perJob = new WeakMap<JobCost, Slot>();
// No job context (route paths, tests): one process-wide slot.
let globalSlot: Slot = newSlot();

function slotFor(): Slot {
  const jc = currentJobCost();
  if (!jc) return globalSlot;
  let s = perJob.get(jc);
  if (!s) {
    s = newSlot();
    perJob.set(jc, s);
  }
  return s;
}

const MSG_MAX = 200;

function clipMessage(s: string): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > MSG_MAX ? `${t.slice(0, MSG_MAX)}…` : t;
}

/**
 * Logs ONE structured warn line for a failed attempt, bumps the counter and
 * remembers the failure for `describeLastFailure`. Never throws.
 */
export function reportFailure(f: LlmFailure): void {
  try {
    const rec: LlmFailure = { ...f, message: clipMessage(f.message) };
    const key = `${rec.provider}|${rec.kind}`;
    counters.set(key, (counters.get(key) ?? 0) + 1);
    const slot = slotFor();
    slot.last = rec;
    slot.byProvider.set(rec.provider, rec);
    slot.lastAt = Date.now();
    slot.answered = false;
    slot.count += 1;
    log("warn", "[llm] attempt failed", {
      role: rec.role,
      provider: rec.provider,
      model: rec.model,
      attempt: rec.attempt,
      durationMs: rec.durationMs,
      kind: rec.kind,
      status: rec.status,
      retryable: rec.retryable,
      error: rec.message,
      finishReason: rec.finishReason,
      inputTokens: rec.inputTokens,
      outputTokens: rec.outputTokens,
    });
  } catch {
    // Observability must never change what the call does.
  }
}

/** A provider answered: its earlier failures say nothing about now. Called by every chain walk. Never throws. */
export function reportSuccess(provider: string): void {
  try {
    const slot = slotFor();
    slot.byProvider.delete(provider);
    slot.answered = true;
  } catch {
    // Observability must never change what the call does.
  }
}

/** The most recent failed attempt of the current job (or process, without a job context). */
export function lastFailure(): LlmFailure | undefined {
  return slotFor().last;
}

/** One-line summary of the last failed attempt, or `undefined` when none was recorded. */
export function describeLastFailure(): string | undefined {
  const slot = slotFor();
  const f = slot.last;
  if (!f) return undefined;
  const parts = [
    `${f.provider}:${f.model}`,
    `kind=${f.kind}`,
    `status=${f.status ?? "-"}`,
    `attempt=${f.attempt}`,
    `retryable=${f.retryable}`,
    `${f.durationMs}ms`,
  ];
  if (f.finishReason) parts.push(`finish=${f.finishReason}`);
  if (f.outputTokens !== undefined) parts.push(`out=${f.outputTokens}`);
  parts.push(`failures=${slot.count}`, f.message);
  return `last LLM attempt: ${parts.join(" ")}`;
}

/** Account refusals that some providers answer with a plain 400 (Anthropic credit balance, Gemini bad key). */
const ACCOUNT_400_RE = /credit balance|billing|suspended|spending|api[ _-]?key (?:is )?(?:invalid|not valid|expired|missing)|(?:invalid|expired|missing) api[ _-]?key/i;

/** A failure older than this belongs to an earlier chain run, not to the one that just gave nothing. */
export const OUTAGE_RECENCY_MS = 60_000;

/**
 * The failure of the chain run that just ended, `undefined` when `last` is older news: a provider answered after it (a
 * Gemini 429 in batch 1, the fallback wrote the rest, a quality gate failed later) or it is over a minute old.
 */
function runningFailure(): LlmFailure | undefined {
  const slot = slotFor();
  if (!slot.last || slot.answered || Date.now() - slot.lastAt >= OUTAGE_RECENCY_MS) return undefined;
  return slot.last;
}

/**
 * The provider itself cannot serve anyone now: account (key, balance, suspended), rate/quota, 5xx, network, open breaker.
 * A problem of this one request (bad JSON, empty, safety, other 4xx) is not, and neither is a timeout: a long prompt can
 * time out on a healthy provider.
 */
export function isOutageFailure(f: Pick<LlmFailure, "kind" | "status" | "message">): boolean {
  if (f.kind === "network") return true;
  if (f.kind === "other") return /^circuit breaker/.test(f.message);
  if (f.kind !== "http" || f.status === undefined) return false;
  return [401, 402, 403, 429].includes(f.status) || f.status >= 500 || (f.status === 400 && ACCOUNT_400_RE.test(f.message));
}

/**
 * The chain run that just ended failed on an outage, and so did every provider this job has tried since it last answered.
 * Only inside a job: the process-wide slot of the route paths mixes unrelated requests. Only the «chain gave nothing» throw
 * sites ask this (`errorWithCause`), never a later quality gate.
 */
export function llmOutage(): boolean {
  if (!currentJobCost()) return false;
  const last = runningFailure();
  if (!last || !isOutageFailure(last)) return false;
  return [...slotFor().byProvider.values()].every(isOutageFailure);
}

/**
 * The error of «the chain gave nothing», with the last LLM failure as `cause` for the log. `cause.llmFailure`, the
 * structured record for the owner alert, is set only for the run that just failed: an old failure must not count. The user sees `message`, or `AI_OUTAGE_ERROR` when every provider
 * tried is down: then it is not this document that failed and an instant retry cannot help.
 */
export function errorWithCause(message: string): Error {
  const why = describeLastFailure();
  if (!why) return new Error(message);
  const cause = Object.assign(new Error(why), { llmFailure: runningFailure() });
  return llmOutage() ? new UserFacingError(AI_OUTAGE_ERROR, { cause }) : new Error(message, { cause });
}

/* ------------------------------------------------------------------ *
 * JSON quality
 * ------------------------------------------------------------------ */

export type JsonQuality = "ok" | "truncated" | "bad_json";

function strictParses(text: string): boolean {
  const t = text.replace(/```(?:json|JSON)?/g, "").trim();
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

/**
 * `ok` — the text is complete JSON (or unfinished-looking but the provider
 * did not hit the token limit and a lenient parse works); `truncated` — the
 * provider stopped at the output-token limit and the text is not valid JSON
 * (the lenient repair may still salvage a part); `bad_json` — nothing usable
 * can be parsed at all.
 */
export function checkJson(text: string, finishReason?: string): JsonQuality {
  return inspectJson(text, finishReason).quality;
}

/** `checkJson` plus the names of the syntax repairs the lenient parser needed (empty for a clean answer). */
export function inspectJson(text: string, finishReason?: string): { quality: JsonQuality; repairs: RepairKind[] } {
  if (strictParses(text)) return { quality: "ok", repairs: [] };
  const salvaged = parseLlmJsonDetailed(text);
  if (salvaged === null || salvaged.value === null || salvaged.value === undefined) {
    return { quality: isMaxTokensFinish(finishReason) ? "truncated" : "bad_json", repairs: [] };
  }
  return { quality: isMaxTokensFinish(finishReason) ? "truncated" : "ok", repairs: salvaged.repairs };
}

/**
 * ONE warn line when an answer parsed only after syntax repairs, so production can count which
 * strategy rescued it (`grep "json repaired"`). Metadata only - never the answer text.
 */
export function reportRepair(ctx: { role: string; provider: string; model: string }, repairs: RepairKind[], finishReason?: string): void {
  if (repairs.length === 0) return;
  try {
    log("warn", "[llm] json repaired", { role: ctx.role, provider: ctx.provider, model: ctx.model, repairs: repairs.join(","), finishReason });
  } catch {
    // Observability must never change what the call does.
  }
}

export const STRICT_JSON_REMINDER =
  "\n\nIMPORTANT: Return ONLY one complete, valid JSON value as the whole response. No markdown fences, no commentary. Close every bracket and string. Keep the content compact so the answer is not cut off.";

/** Output-token ceiling for the truncation retry. */
export const TRUNCATION_RETRY_MAX_TOKENS = 16_000;

/** 1.6× the previous limit, bounded. */
export function biggerMaxTokens(current: number): number {
  return Math.min(TRUNCATION_RETRY_MAX_TOKENS, Math.max(current, Math.ceil(current * 1.6)));
}

/** Minimum job time left for a JSON-quality retry to start (ms). */
export const JSON_RETRY_MIN_LEFT_MS = 12_000;

/**
 * `retry: true` marks the second (stricter) attempt: the provider call should make it as parseable as
 * it can (Gemini: non-streaming JSON mode with a response schema, see `llm.ts llmStream`).
 */
export type JsonRetryRun<R extends { text: string; finishReason?: string }> = (o: { system: string; maxTokens: number; retry?: boolean }) => Promise<R | null>;

/**
 * JSON-quality retry shared by the direct (`llm.ts`) and the role (`llm-roles.ts`)
 * paths. Runs `run` once; when the answer is not complete JSON it runs ONE more
 * attempt with a stricter reminder (and a larger output limit when the first one
 * was cut by the limit) and keeps the better of the two. Never throws for the
 * retry itself: a failure of the second attempt (deadline, error) returns the
 * first result — the retry is an improvement, never a requirement.
 *
 * `onPaid` receives the first result when a retry follows, so the caller can
 * keep the usage of every paid attempt.
 */
export async function withJsonRetry<R extends { text: string; finishReason?: string }>(
  run: JsonRetryRun<R>,
  base: { system: string; maxTokens: number; json?: boolean; deadline?: number },
  ctx: { role: string; provider: (r: R) => string; model: (r: R) => string; tokens?: (r: R) => { inputTokens: number; outputTokens: number } | undefined },
  merge: (first: R, second: R) => R,
): Promise<R | null> {
  const first = await run({ system: base.system, maxTokens: base.maxTokens });
  if (!first || !base.json) return first;
  const { quality: q, repairs: repairs1 } = inspectJson(first.text, first.finishReason);
  if (q === "ok") {
    reportRepair({ role: ctx.role, provider: ctx.provider(first), model: ctx.model(first) }, repairs1, first.finishReason);
    return first;
  }
  const tk = ctx.tokens?.(first);
  reportFailure({
    role: ctx.role,
    provider: ctx.provider(first),
    model: ctx.model(first),
    attempt: 1,
    durationMs: 0,
    kind: q,
    retryable: true,
    message: q === "truncated" ? "answer cut at the output-token limit" : "answer is not parseable JSON",
    finishReason: first.finishReason,
    inputTokens: tk?.inputTokens,
    outputTokens: tk?.outputTokens,
  });
  if (base.deadline !== undefined && base.deadline - Date.now() < JSON_RETRY_MIN_LEFT_MS) return first;
  let second: R | null = null;
  try {
    second = await run({
      system: base.system + STRICT_JSON_REMINDER,
      maxTokens: q === "truncated" ? biggerMaxTokens(base.maxTokens) : base.maxTokens,
      retry: true,
    });
  } catch {
    return first;
  }
  if (!second) return first;
  const { quality: q2, repairs: repairs2 } = inspectJson(second.text, second.finishReason);
  if (q2 === "ok") reportRepair({ role: ctx.role, provider: ctx.provider(second), model: ctx.model(second) }, repairs2, second.finishReason);
  const rank = (x: JsonQuality) => (x === "ok" ? 2 : x === "truncated" ? 1 : 0);
  if (q2 !== "ok") {
    const tk2 = ctx.tokens?.(second);
    reportFailure({
      role: ctx.role,
      provider: ctx.provider(second),
      model: ctx.model(second),
      attempt: 2,
      durationMs: 0,
      kind: q2,
      retryable: false,
      message: q2 === "truncated" ? "retry still cut at the output-token limit" : "retry still not parseable JSON",
      finishReason: second.finishReason,
      inputTokens: tk2?.inputTokens,
      outputTokens: tk2?.outputTokens,
    });
  }
  // `merge(winner, other)`: the winner is returned and carries the usage of the other (both were paid for).
  return rank(q2) >= rank(q) ? merge(second, first) : merge(first, second);
}
