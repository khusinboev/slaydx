/**
 * Telegram send outcome → what the broadcast engine does with the recipient
 * (docs/bonus/BONUS3.md C-Q5). Pure: no I/O, no `server-only`, unit-testable.
 *
 *   sent        — delivered;
 *   rate_limit  — 429: pause EVERY sender for retry_after + 1 s, re-queue the recipient (not a failure);
 *   transient   — no answer (network / timeout, code 0) or Telegram 5xx: retry this recipient with backoff;
 *   permanent   — Telegram refused for good, with a `kind` kept on the recipient row.
 */

export const FAILURE_KINDS = ["blocked", "deactivated", "chat_not_found", "bad_request", "other"] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

/** The raw Bot API outcome (`callBot`'s `BotResult<unknown>`). */
export type SendOutcome = { ok: true } | { ok: false; code: number; description: string; retryAfter?: number };

export type Verdict =
  | { type: "sent" }
  | { type: "rate_limit"; retryAfterS: number }
  | { type: "transient"; reason: string }
  | { type: "permanent"; kind: FailureKind; reason: string };

/** 429 without `retry_after` is held this long. */
export const DEFAULT_RETRY_AFTER_S = 5;
/** A pathological `retry_after` must not freeze the engine for hours without anybody noticing. */
export const MAX_RETRY_AFTER_S = 3_600;

export function classify(o: SendOutcome): Verdict {
  if (o.ok) return { type: "sent" };
  const code = o.code;
  const d = (o.description ?? "").trim();
  const reason = (d || (code ? `HTTP ${code}` : "javob yo'q")).slice(0, 300);
  if (code === 429) {
    const after = o.retryAfter !== undefined && Number.isFinite(o.retryAfter) && o.retryAfter >= 0 ? o.retryAfter : DEFAULT_RETRY_AFTER_S;
    return { type: "rate_limit", retryAfterS: Math.min(MAX_RETRY_AFTER_S, Math.ceil(after)) };
  }
  if (code === 0 || code >= 500) return { type: "transient", reason };
  const low = d.toLowerCase();
  if (low.includes("user is deactivated")) return { type: "permanent", kind: "deactivated", reason };
  if (code === 403) {
    // «bot was blocked by the user», «bot can't initiate conversation with a user», «bot was kicked …».
    return { type: "permanent", kind: "blocked", reason };
  }
  if (low.includes("chat not found") || low.includes("user not found") || low.includes("peer_id_invalid") || low.includes("chat_id is empty")) {
    return { type: "permanent", kind: "chat_not_found", reason };
  }
  if (code === 400) return { type: "permanent", kind: "bad_request", reason };
  return { type: "permanent", kind: "other", reason };
}

/** Kinds that mean «this user cannot be reached any more» — `users.bot_blocked_at` is set for them. */
export const isUnreachable = (kind: FailureKind): boolean => kind === "blocked" || kind === "deactivated";

/** Admin-facing label (Uzbek) of a failure kind — `failedReasons` of the broadcast detail. */
export function kindLabel(kind: string | null | undefined): string {
  switch (kind) {
    case "blocked":
      return "Bot bloklangan";
    case "deactivated":
      return "Hisob o'chirilgan";
    case "chat_not_found":
      return "Chat topilmadi";
    case "bad_request":
      return "Telegram xabarni rad etdi (yaroqsiz so'rov)";
    case "other":
      return "Boshqa xato";
    default:
      return "Noma'lum xato";
  }
}

/** Retries a recipient gets for transient errors before it is marked failed. */
export const MAX_ATTEMPTS = 6;

/** Seconds to wait before the next attempt, given the attempts made so far (0-based): 10, 20, 40, … capped at 600. */
export const backoffSeconds = (attemptsMade: number): number => Math.min(600, 10 * 2 ** Math.max(0, attemptsMade));
