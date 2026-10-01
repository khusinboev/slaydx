import "server-only";
import type { PoolClient } from "pg";
import { transaction } from "./db";
import { toJsonb } from "./jsonb";
import { currentLogContext, log } from "./log";

/**
 * Admin audit log writer (docs/admin/02-plan.md §8).
 *
 * `ok` rows are written with the caller's client INSIDE the mutation's
 * transaction: the change and its audit row commit or roll back together.
 * `denied` rows (permission check failed) and `failed` rows (auth failures)
 * have no surrounding change and are written on their own.
 *
 * Callers pass only changed fields in `before`/`after` and never secrets
 * (TOTP secrets, codes, tokens). The table is append-only (028 triggers).
 */

export type AuditOutcome = "ok" | "denied" | "failed";

/** Who acted. The `admin` object from `adminHandler` fits as is. */
export type AuditActor = {
  /** admin_accounts.id; `null` for CLI/system rows. */
  id: string | null;
  userId: string | null;
  role: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
};

export type AuditEntry = {
  action: string;
  targetType?: string | null;
  targetId?: string | number | null;
  outcome?: AuditOutcome;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown> | null;
};

type Queryable = Pick<PoolClient, "query">;

const UA_MAX = 300;

function jsonOrNull(v: unknown): string | null {
  return v === undefined || v === null ? null : toJsonb(v);
}

async function insert(client: Queryable, actor: AuditActor, e: AuditEntry): Promise<string> {
  const outcome = e.outcome ?? "ok";
  const requestId = actor.requestId ?? currentLogContext().reqId ?? null;
  const res = await client.query<{ id: string }>(
    `INSERT INTO admin_audit_log
       (admin_id, actor_user_id, actor_role, action, target_type, target_id, outcome, reason,
        before, after, meta, request_id, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14)
     RETURNING id::text AS id`,
    [
      actor.id,
      actor.userId,
      actor.role,
      e.action.slice(0, 100),
      e.targetType ?? null,
      e.targetId === undefined || e.targetId === null ? null : String(e.targetId).slice(0, 200),
      outcome,
      e.reason ? e.reason.slice(0, 1000) : null,
      jsonOrNull(e.before),
      jsonOrNull(e.after),
      jsonOrNull(e.meta),
      requestId,
      actor.ip ? actor.ip.slice(0, 60) : null,
      actor.userAgent ? actor.userAgent.slice(0, UA_MAX) : null,
    ],
  );
  // Same request id as the response header and the other log lines; no
  // before/after here (they may hold PII that is the subject of the change).
  log(outcome === "ok" ? "info" : "warn", `[admin] ${e.action}`, {
    auditId: res.rows[0]?.id,
    adminId: actor.id,
    outcome,
    targetType: e.targetType ?? undefined,
    targetId: e.targetId === undefined || e.targetId === null ? undefined : String(e.targetId),
  });
  return res.rows[0]!.id;
}

/** Writes one audit row with the caller's client (inside its transaction). */
export async function writeAudit(client: Queryable, actor: AuditActor, entry: AuditEntry): Promise<string> {
  return insert(client, actor, entry);
}

/**
 * A `failed` row outside any transaction (auth failures). Never throws: an
 * audit outage must not turn "wrong code" into a 500 — it is logged instead.
 */
export async function writeFailedAudit(actor: AuditActor, entry: Omit<AuditEntry, "outcome">): Promise<void> {
  try {
    await transaction((client) => insert(client, actor, { ...entry, outcome: "failed" }));
  } catch (e) {
    log("error", "[admin] audit write failed", { action: entry.action, err: e });
  }
}

/** The `denied` row for a failed permission check (§4.4 step 7). Never throws. */
export async function writeDeniedAudit(actor: AuditActor, perm: string, scope: string): Promise<void> {
  try {
    await transaction((client) =>
      insert(client, actor, { action: "auth.denied", outcome: "denied", meta: { permission: perm, scope } }),
    );
  } catch (e) {
    log("error", "[admin] denied audit write failed", { scope, err: e });
  }
}

export type AuditFn = (entry: AuditEntry) => Promise<string>;

/** Runs `fn` in a transaction with an `audit()` bound to the same client and actor. */
export async function adminTx<T>(actor: AuditActor, fn: (client: PoolClient, audit: AuditFn) => Promise<T>): Promise<T> {
  return transaction((client) => fn(client, (entry) => insert(client, actor, entry)));
}

/** CLI/system row: no admin actor; `meta.via` says where it came from (e.g. "cli"). */
export async function writeSystemAudit(
  client: Queryable,
  entry: Omit<AuditEntry, "meta"> & { meta: Record<string, unknown> & { via: string } },
): Promise<string> {
  return insert(client, { id: null, userId: null, role: null, requestId: null }, entry);
}
