import "server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError, json } from "./api";
import { transaction } from "./db";
import { toJsonb } from "./jsonb";
import { writeAudit, type AuditActor, type AuditEntry } from "./admin-audit";

/**
 * `Idempotency-Key` for the admin money mutations (docs/admin/02-plan.md §6.0).
 *
 * Contract: the same key with the same canonical body returns the ORIGINAL
 * response with `Idempotent-Replayed: true` and causes no second effect; the
 * same key with a different body is 422 `idempotency_conflict`. This holds
 * under concurrency.
 *
 * Design (no new table): the original request's audit row is the record.
 * `meta` of that row carries `idempotencyKey`, `bodyHash` and `response`.
 *   1. the mutation runs in ONE transaction that first takes
 *      `pg_advisory_xact_lock(hash(key))` — two parallel requests with the
 *      same key are serialised, the second one starts only after the first
 *      one committed (or rolled back);
 *   2. the prior row is looked up by KEY ONLY, per action, across all admins
 *      (`(action, meta.idempotencyKey)` within `LOOKUP_WINDOW`) — READ
 *      COMMITTED sees the first request's commit at that point. Keys are
 *      UUID v4, so a key seen from ANOTHER admin is a conflict (422), never a
 *      replay of someone else's result;
 *   3. a domain failure (4xx thrown by `run`) rolls back and writes NO audit
 *      row (§8: validation failures are not audited), so the client may retry
 *      the same key with a corrected body.
 * The lookup is a range scan of `admin_audit_action_idx (action, at DESC)`
 * over the last `LOOKUP_WINDOW` and filters on the JSONB key: bounded work
 * without a migration. A key is generated per dialog open and retried within
 * seconds or minutes; after the window it counts as new, and each action has
 * a second guard for that case (the wallet's unique ledger reference, a job's
 * refund row, an order's recorded total).
 */

/** How far back a key is recognised (`interval` literal; no admin retry lives longer). */
export const LOOKUP_WINDOW = "30 days";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const IDEMPOTENCY_HEADER = "Idempotency-Key";
export const REPLAYED_HEADER = "Idempotent-Replayed";

/** The header value, lower-cased; 400 when missing or not a UUID v4. */
export function requireIdempotencyKey(req: Request): string {
  const raw = req.headers.get(IDEMPOTENCY_HEADER)?.trim() ?? "";
  if (!UUID_V4.test(raw)) {
    throw new ApiError("Idempotency-Key sarlavhasi UUID v4 bo'lishi kerak", 400, { code: "idempotency_key" });
  }
  return raw.toLowerCase();
}

/** Deterministic JSON: object keys sorted at every level, so field order in the request does not matter. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = sortKeys((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

/** SHA-256 of the canonical JSON of the VALIDATED fields (not the raw body). */
export function bodyHashOf(canonicalFields: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(canonicalFields)).digest("hex");
}

export type IdempotentOutcome<T> = {
  response: T;
  /** The one `ok` audit row of this mutation; `meta` is extended with the idempotency fields. */
  audit: Omit<AuditEntry, "action" | "outcome">;
};

export type IdempotentResult<T> = { replayed: boolean; response: T };

type PriorRow = { admin_id: string | null; meta: { bodyHash?: unknown; response?: unknown } | null };

export function idempotencyConflict(): ApiError {
  return new ApiError("Bu Idempotency-Key boshqa so'rov uchun ishlatilgan", 422, { code: "idempotency_conflict" });
}

/**
 * Runs `run` once per (action, key) inside one transaction with the audit
 * row, or replays the stored response to the admin who made the original
 * request. `run` throws `ApiError` for domain refusals (nothing is written then).
 */
export async function idempotentMutation<T>(
  actor: AuditActor,
  opts: { action: string; key: string; bodyHash: string },
  run: (client: PoolClient) => Promise<IdempotentOutcome<T>>,
): Promise<IdempotentResult<T>> {
  if (!actor.id) throw new ApiError("Admin hisobi aniqlanmadi", 500);
  const adminId = actor.id;
  return transaction(async (client) => {
    // Serialises same-key requests (whoever sends them); released at COMMIT/ROLLBACK.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`admin-idem:${opts.key}`]);
    const prior = await client.query<PriorRow>(
      `SELECT admin_id::text AS admin_id, meta FROM admin_audit_log
        WHERE action = $1 AND at > now() - $3::interval AND outcome = 'ok' AND meta->>'idempotencyKey' = $2
        ORDER BY at DESC, id DESC
        LIMIT 1`,
      [opts.action, opts.key, LOOKUP_WINDOW],
    );
    const row = prior.rows[0];
    if (row) {
      // Another admin's key or a different body: never replay, never re-apply.
      if (row.admin_id !== adminId || row.meta?.bodyHash !== opts.bodyHash) throw idempotencyConflict();
      return { replayed: true, response: row.meta.response as T };
    }

    const out = await run(client);
    await writeAudit(client, actor, {
      ...out.audit,
      action: opts.action,
      outcome: "ok",
      meta: {
        ...(out.audit.meta ?? {}),
        idempotencyKey: opts.key,
        bodyHash: opts.bodyHash,
        // Stored through the same JSONB sanitiser as every other write.
        response: JSON.parse(toJsonb(out.response)) as unknown,
      },
    });
    return { replayed: false, response: out.response };
  });
}

/** JSON response; a replay carries `Idempotent-Replayed: true` (same status as the original). */
export function idempotentJson<T>(result: IdempotentResult<T>, status: number): Response {
  return json(result.response, {
    status,
    headers: result.replayed ? { [REPLAYED_HEADER]: "true" } : undefined,
  });
}
