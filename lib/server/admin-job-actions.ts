import "server-only";
import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { adminTx } from "./admin-audit";
import type { AdminActor } from "./admin-handler";
import { bodyHashOf, idempotentMutation, type IdempotentResult } from "./admin-idempotency";
import { refundInTx } from "./refund-tx";
import type { ChargeSplit } from "./credits";

/**
 * Admin job actions (docs/admin/02-plan.md §6.5, §10 T14): cancel a QUEUED
 * job, force-fail a stuck IN_PROGRESS job, refund a FAILED job by hand.
 *
 * Every path locks the generation row (`FOR UPDATE`), changes the state and
 * refunds through `refundInTx` in ONE transaction with the audit row.
 * `refundInTx` is idempotent on `(kind='refund', reference=<job id>)`, which
 * is exactly what makes the worker's own late refund attempt harmless:
 *   - after a force-fail the row is FAILED with `locked_by = NULL`, so the
 *     worker's `failJob(id, lease)` / `commitJobResult` (both fenced on
 *     `locked_by = $lease AND status = 'IN_PROGRESS'`) update nothing and the
 *     worker skips its refund;
 *   - even a refund the worker does attempt finds the refund row and no-ops.
 * A force-failed job writes no `ai_usage` row here: the worker still owns the
 * build and records its spend as `abandoned` when its commit loses the fence.
 */

/** User-visible texts (ledger note / generation error); the actor stays in the audit log. */
export const ADMIN_CANCEL_NOTE = "Administrator tomonidan bekor qilindi";
export const ADMIN_FAIL_ERROR = "Administrator tomonidan to'xtatildi";
export const ADMIN_REFUND_NOTE = "Ma'muriy qaytarish";

export type AdminGenerationState = {
  id: string;
  userId: string;
  toolId: string;
  topic: string;
  status: string;
  price: number;
  progress: number;
  step: string;
  error: string | null;
  attempts: number;
  lockedBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

type Row = {
  id: string;
  user_id: string;
  tool_id: string;
  topic: string;
  status: string;
  price: string;
  progress: number;
  step: string;
  error: string | null;
  attempts: number;
  locked_by: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
};

/** Narrow columns only (plan §9): no `values_json`, `html`, `doc_json`, `live_json`. */
const COLS = `id, user_id::text AS user_id, tool_id, topic, status, price, progress, step, error, attempts, locked_by,
  created_at, started_at, finished_at`;

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

function toState(r: Row): AdminGenerationState {
  return {
    id: r.id,
    userId: r.user_id,
    toolId: r.tool_id,
    topic: r.topic,
    status: r.status,
    price: Number(r.price),
    progress: Number(r.progress),
    step: r.step,
    error: r.error,
    attempts: Number(r.attempts),
    lockedBy: r.locked_by,
    createdAt: new Date(r.created_at).toISOString(),
    startedAt: iso(r.started_at),
    finishedAt: iso(r.finished_at),
  };
}

async function lockGeneration(client: PoolClient, id: string): Promise<Row> {
  const res = await client.query<Row>(`SELECT ${COLS} FROM generations WHERE id = $1 FOR UPDATE`, [id]);
  const row = res.rows[0];
  if (!row) throw new ApiError("Topilmadi", 404, { code: "not_found" });
  return row;
}

async function reread(client: PoolClient, id: string): Promise<AdminGenerationState> {
  const res = await client.query<Row>(`SELECT ${COLS} FROM generations WHERE id = $1`, [id]);
  return toState(res.rows[0]!);
}

/** What the refund row for this job returned to the user; `null` when there is none. */
async function refundSplit(client: PoolClient, reference: string): Promise<ChargeSplit | null> {
  const res = await client.query<{ points_delta: string; quota_delta: string; balance_delta: string }>(
    `SELECT points_delta, quota_delta, balance_delta FROM transactions WHERE kind = 'refund' AND reference = $1`,
    [reference],
  );
  const r = res.rows[0];
  return r ? { points: Number(r.points_delta), quota: Number(r.quota_delta), balance: Number(r.balance_delta) } : null;
}

export type JobActionResult = { generation: AdminGenerationState; refunded: ChargeSplit | null };

/** Postgres unique_violation (23505) on the named index/constraint. */
function isUniqueViolation(e: unknown, constraint: string): boolean {
  const err = e as { code?: unknown; constraint?: unknown } | null;
  return Boolean(err) && err!.code === "23505" && err!.constraint === constraint;
}

function wrongState(row: Row, expected: string): ApiError {
  return new ApiError(`Ish holati ${row.status}; faqat ${expected} ish uchun mumkin`, 409, { code: "state", status: row.status });
}

export type CancelQueuedResult = {
  /** The job was QUEUED and is now REVOKED. */
  cancelled: boolean;
  /** What the refund returned; `null` when nothing was refunded now (free job, or already refunded). */
  refunded: ChargeSplit | null;
};

/**
 * The one admin "cancel a queued job" step, inside the caller's transaction:
 * QUEUED → REVOKED, then `refundInTx` with `ADMIN_CANCEL_NOTE`. Used by the
 * admin cancel (`cancelJob`) and by blocking a user with "cancel queued jobs"
 * (`admin-users.setUserBlocked`). The caller writes the audit row.
 *
 * The status guard in the UPDATE makes it safe without a prior lock: a job a
 * worker already claimed (IN_PROGRESS) is left alone and nothing is refunded.
 * Callers that need a 409 on the wrong state lock and check the row first.
 */
export async function cancelQueuedInTx(client: PoolClient, job: { id: string; userId: string }): Promise<CancelQueuedResult> {
  const upd = await client.query(
    `UPDATE generations
        SET status = 'REVOKED', step = 'Bekor qilindi', progress = 100, finished_at = now()
      WHERE id = $1 AND status = 'QUEUED'`,
    [job.id],
  );
  if (!upd.rowCount) return { cancelled: false, refunded: null };
  const refundedNow = await refundInTx(client, job.userId, job.id, ADMIN_CANCEL_NOTE);
  return { cancelled: true, refunded: refundedNow ? await refundSplit(client, job.id) : null };
}

/** QUEUED → REVOKED plus the refund, as the user's own cancel does (`cancelGeneration`). */
export async function cancelJob(actor: AdminActor, id: string, reason: string): Promise<JobActionResult> {
  return adminTx(actor, async (client, audit) => {
    const row = await lockGeneration(client, id);
    if (row.status !== "QUEUED") throw wrongState(row, "QUEUED");
    // The row is locked and QUEUED, so this always cancels.
    const { refunded } = await cancelQueuedInTx(client, { id, userId: row.user_id });
    await audit({
      action: "jobs.cancel",
      targetType: "generation",
      targetId: id,
      reason,
      before: { status: "QUEUED" },
      after: { status: "REVOKED", refunded },
    });
    return { generation: await reread(client, id), refunded };
  });
}

/**
 * IN_PROGRESS → FAILED with the lease cleared; the late worker is fenced out
 * (see the module comment). Files and assets of the dead attempt are removed
 * as the queue-TTL path does for a FAILED job.
 */
export async function forceFailJob(actor: AdminActor, id: string, reason: string): Promise<JobActionResult> {
  return adminTx(actor, async (client, audit) => {
    const row = await lockGeneration(client, id);
    if (row.status !== "IN_PROGRESS") throw wrongState(row, "IN_PROGRESS");
    await client.query(
      `UPDATE generations
          SET status = 'FAILED', progress = 100, step = 'Xatolik',
              error = $2, finished_at = now(),
              locked_by = NULL, locked_at = NULL, live_json = NULL
        WHERE id = $1 AND status = 'IN_PROGRESS'`,
      [id, ADMIN_FAIL_ERROR],
    );
    const refundedNow = await refundInTx(client, row.user_id, id, ADMIN_FAIL_ERROR);
    const refunded = refundedNow ? await refundSplit(client, id) : null;
    await client.query("DELETE FROM generation_files WHERE generation_id = $1", [id]);
    await client.query("DELETE FROM generation_assets WHERE generation_id = $1", [id]);
    await audit({
      action: "jobs.fail",
      targetType: "generation",
      targetId: id,
      reason,
      before: { status: "IN_PROGRESS", lockedBy: row.locked_by },
      after: { status: "FAILED", lockedBy: null, refunded },
    });
    return { generation: await reread(client, id), refunded };
  });
}

export type JobRefundResponse = { refunded: ChargeSplit };

/**
 * Manual refund of a FAILED, charged, unrefunded job. COMPLETED jobs are
 * refused (a wallet adjustment is the tool for those), as are uncharged and
 * already refunded ones — all 409 `not_refundable`.
 */
export async function refundJob(
  actor: AdminActor,
  id: string,
  reason: string,
  idempotencyKey: string,
): Promise<IdempotentResult<JobRefundResponse>> {
  const bodyHash = bodyHashOf({ id, reason });
  return idempotentMutation<JobRefundResponse>(actor, { action: "jobs.refund", key: idempotencyKey, bodyHash }, async (client) => {
    const row = await lockGeneration(client, id);
    // The wallet rule (§10 T13): no discretionary money action on one's own
    // account. Cancel/fail of one's own stuck job stay allowed — ordinary ops.
    if (row.user_id === actor.userId) throw new ApiError("O'z ishingiz uchun pul qaytara olmaysiz", 409, { code: "self" });
    const refuse = (why: string) =>
      new ApiError(`Qaytarib bo'lmaydi: ${why}`, 409, { code: "not_refundable", status: row.status });
    if (row.status !== "FAILED") throw refuse(`ish holati ${row.status}`);
    const ALREADY = "pul allaqachon qaytarilgan";
    if (await refundSplit(client, id)) throw refuse(ALREADY);
    // The worker's own refund (`credits.refund`) does not lock the generation
    // row, so it can commit between the check above and the insert below:
    // either `refundInTx` sees its row (READ COMMITTED) and returns false, or
    // the insert hits `transactions_ref_idx`. Both are "already refunded".
    let refundedNow: boolean;
    try {
      refundedNow = await refundInTx(client, row.user_id, id, ADMIN_REFUND_NOTE);
    } catch (e) {
      if (isUniqueViolation(e, "transactions_ref_idx")) throw refuse(ALREADY);
      throw e;
    }
    if (!refundedNow) {
      // No (or a zero) charge row — unless the worker refunded in between.
      throw refuse((await refundSplit(client, id)) ? ALREADY : "ish uchun pul yechilmagan");
    }
    const refunded = (await refundSplit(client, id))!;
    return {
      response: { refunded },
      audit: {
        targetType: "generation",
        targetId: id,
        reason,
        before: { refunded: false },
        after: { refunded: true, ...refunded },
      },
    };
  });
}
