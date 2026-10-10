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
import { parseLlmJson } from "../json";
import { currentJobCost, type JobCost } from "../job-cost";

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
  globalSlot = { count: 0 };
}

type Slot = { last?: LlmFailure; count: number };
let perJob = new WeakMap<JobCost, Slot>();
// No job context (route paths, tests): one process-wide slot.
let globalSlot: Slot = { count: 0 };

function slotFor(): Slot {
  const jc = currentJobCost();
  if (!jc) return globalSlot;
  let s = perJob.get(jc);
  if (!s) {
    s = { count: 0 };
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

/**
 * `new Error(message, { cause })` with the last LLM failure as cause. The
 * message (shown to the user) is unchanged; the cause is only for the log.
 */
export function errorWithCause(message: string): Error {
  const why = describeLastFailure();
  return why ? new Error(message, { cause: new Error(why) }) : new Error(message);
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
  if (strictParses(text)) return "ok";
  const salvaged = parseLlmJson(text);
  if (salvaged === null || salvaged === undefined) return isMaxTokensFinish(finishReason) ? "truncated" : "bad_json";
  return isMaxTokensFinish(finishReason) ? "truncated" : "ok";
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

export type JsonRetryRun<R extends { text: string; finishReason?: string }> = (o: { system: string; maxTokens: number }) => Promise<R | null>;

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
  const q = checkJson(first.text, first.finishReason);
  if (q === "ok") return first;
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
    });
  } catch {
    return first;
  }
  if (!second) return first;
  const q2 = checkJson(second.text, second.finishReason);
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
