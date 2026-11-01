/**
 * `media_jobs` rows (migration 065, docs/studio/P0-SPEC.md §5): one per provider operation the core makes for a job.
 *
 * `beginMediaJob` is idempotent on `idempotency_key`: a retried step gets its existing row back (`fresh: false`) and
 * decides from its status — an async op that is already `pending` is resumed, never submitted a second time. Sync calls
 * (images, speech chunks) simply run again: their earlier output was never stored, and the job is charged once anyway.
 *
 * Telemetry only for sync kinds: a failed write here is logged and never fails the user's job.
 */
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { query, queryOne } from "../db";
import { scrubSecrets } from "../../generation/video/types";

export type MediaJobStatus = "submitting" | "pending" | "succeeded" | "failed";

export type MediaJobRow = {
  id: string;
  generation_id: string | null;
  purpose: string;
  model_id: string;
  provider: string;
  upstream_model: string;
  idempotency_key: string;
  op_id: string | null;
  status: MediaJobStatus;
  attempts: number;
  errors: number;
  next_poll_at: Date | null;
  deadline_at: Date | null;
  params: Record<string, unknown>;
  outputs: unknown;
  last_error: string | null;
};

export type BeginInput = {
  generationId: string | null;
  purpose: string;
  modelId: string;
  provider: string;
  upstreamModel: string;
  idempotencyKey: string;
  params: Record<string, unknown>;
  costUsd?: number | null;
  deadlineAt?: Date | null;
};

export async function beginMediaJob(i: BeginInput): Promise<{ row: MediaJobRow; fresh: boolean }> {
  const inserted = await queryOne<MediaJobRow>(
    `INSERT INTO media_jobs (id, generation_id, purpose, model_id, provider, upstream_model, idempotency_key, params, cost_usd, deadline_at, attempts)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, 1)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING *`,
    [randomUUID(), i.generationId, i.purpose, i.modelId, i.provider, i.upstreamModel, i.idempotencyKey, JSON.stringify(i.params), i.costUsd ?? null, i.deadlineAt ?? null],
  );
  if (inserted) return { row: inserted, fresh: true };
  const row = await queryOne<MediaJobRow>(
    "UPDATE media_jobs SET attempts = attempts + 1 WHERE idempotency_key = $1 RETURNING *",
    [i.idempotencyKey],
  );
  if (!row) throw new Error(`media_jobs: row ${i.idempotencyKey} vanished`);
  return { row, fresh: false };
}

/** Async op accepted by the provider: park it for the poll loop. */
export async function parkMediaJob(id: string, opId: string, nextPollAt: Date): Promise<void> {
  await query("UPDATE media_jobs SET status = 'pending', op_id = $2, next_poll_at = $3 WHERE id = $1 AND status IN ('submitting', 'pending')", [id, opId, nextPollAt]);
}

export type MediaOutputMeta = { mime: string; size: number; sha256?: string };

export async function finishMediaJob(id: string, outputs: readonly MediaOutputMeta[]): Promise<void> {
  await query(
    "UPDATE media_jobs SET status = 'succeeded', outputs = $2::jsonb, next_poll_at = NULL, finished_at = now() WHERE id = $1 AND status <> 'succeeded'",
    [id, JSON.stringify(outputs)],
  );
}

export async function failMediaJob(id: string, error: string, secrets: readonly string[] = []): Promise<void> {
  await query(
    "UPDATE media_jobs SET status = 'failed', errors = errors + 1, last_error = left($2, 500), next_poll_at = NULL, finished_at = now() WHERE id = $1 AND status <> 'succeeded'",
    [id, scrubSecrets(error, secrets)],
  );
}

/** Rows of one generation, oldest first (admin / tests). */
export async function mediaJobsOf(generationId: string): Promise<MediaJobRow[]> {
  return query<MediaJobRow>("SELECT * FROM media_jobs WHERE generation_id = $1 ORDER BY created_at, idempotency_key", [generationId]);
}

/* ── async ops (video, docs/studio/P0-SPEC.md §6.4): the poll loop's side of a parked row ── */

type Queryable = Pick<PoolClient, "query">;

export async function mediaJobByKey(idempotencyKey: string): Promise<MediaJobRow | null> {
  return queryOne<MediaJobRow>("SELECT * FROM media_jobs WHERE idempotency_key = $1", [idempotencyKey]);
}

/** `mediaJobByKey` inside the caller's transaction. */
export async function mediaJobByKeyTx(client: Queryable, idempotencyKey: string): Promise<MediaJobRow | null> {
  return (await client.query<MediaJobRow>("SELECT * FROM media_jobs WHERE idempotency_key = $1", [idempotencyKey])).rows[0] ?? null;
}

/**
 * The INSERT half of `beginMediaJob` inside the caller's transaction: a fresh 'submitting' row (attempts 1), or `null`
 * when the key already exists (the caller decides; nothing is bumped).
 */
export async function insertMediaJobTx(client: Queryable, i: BeginInput): Promise<MediaJobRow | null> {
  const res = await client.query<MediaJobRow>(
    `INSERT INTO media_jobs (id, generation_id, purpose, model_id, provider, upstream_model, idempotency_key, params, cost_usd, deadline_at, attempts)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, 1)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING *`,
    [randomUUID(), i.generationId, i.purpose, i.modelId, i.provider, i.upstreamModel, i.idempotencyKey, JSON.stringify(i.params), i.costUsd ?? null, i.deadlineAt ?? null],
  );
  return res.rows[0] ?? null;
}

/**
 * Fails a row ONLY while it is still 'submitting' (the guard of an async submit): a row another worker has parked in
 * the meantime ('pending', with its op id) is never overwritten. Returns whether it failed the row.
 */
export async function failSubmittingMediaJob(id: string, error: string): Promise<boolean> {
  const res = await query<{ id: string }>(
    "UPDATE media_jobs SET status = 'failed', errors = errors + 1, last_error = left($2, 500), next_poll_at = NULL, finished_at = now() WHERE id = $1 AND status = 'submitting' RETURNING id",
    [id, scrubSecrets(error, [])],
  );
  return res.length > 0;
}

/**
 * Claims up to `limit` due 'pending' rows of `purpose` by pushing their `next_poll_at` forward by `leaseSec` (a lease,
 * as on `video_ops`): another poller does not take the same op meanwhile, and a crashed poller's claim expires.
 */
export async function claimDueMediaJobs(purpose: string, limit: number, leaseSec: number): Promise<MediaJobRow[]> {
  if (limit <= 0) return [];
  return query<MediaJobRow>(
    `UPDATE media_jobs
        SET next_poll_at = now() + $3::int * interval '1 second'
      WHERE id IN (
              SELECT id FROM media_jobs
               WHERE status = 'pending' AND purpose = $1 AND next_poll_at <= now()
               ORDER BY next_poll_at
               LIMIT $2
               FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [purpose, limit, leaseSec],
  );
}

/** One more poll of a still-pending row: `attempts + 1`, `errors + 1` when `error` is given, next poll in `delaySec`. */
export async function rescheduleMediaJob(id: string, delaySec: number, error: string | null): Promise<void> {
  await query(
    `UPDATE media_jobs
        SET attempts = attempts + 1,
            errors = errors + CASE WHEN $3::text IS NULL THEN 0 ELSE 1 END,
            next_poll_at = now() + $2::int * interval '1 second',
            last_error = COALESCE(left($3, 500), last_error)
      WHERE id = $1 AND status = 'pending'`,
    [id, delaySec, error === null ? null : scrubSecrets(error, [])],
  );
}

/** A pending row whose `deadline_at` has passed. */
export async function mediaJobPastDeadline(id: string): Promise<boolean> {
  const row = await queryOne<{ late: boolean }>("SELECT deadline_at <= now() AS late FROM media_jobs WHERE id = $1 AND status = 'pending'", [id]);
  return row?.late === true;
}

/** Row lock inside the caller's transaction (terminal steps serialise on it, as on `video_ops`). */
export async function lockMediaJobByKey(client: Queryable, idempotencyKey: string): Promise<MediaJobRow | null> {
  return (await client.query<MediaJobRow>("SELECT * FROM media_jobs WHERE idempotency_key = $1 FOR UPDATE", [idempotencyKey])).rows[0] ?? null;
}

/** `finishMediaJob` inside the caller's transaction. */
export async function finishMediaJobTx(client: Queryable, id: string, outputs: readonly MediaOutputMeta[]): Promise<void> {
  await client.query(
    "UPDATE media_jobs SET status = 'succeeded', outputs = $2::jsonb, next_poll_at = NULL, finished_at = now() WHERE id = $1 AND status <> 'succeeded'",
    [id, JSON.stringify(outputs)],
  );
}

/** `failMediaJob` inside the caller's transaction. */
export async function failMediaJobTx(client: Queryable, id: string, error: string): Promise<void> {
  await client.query(
    "UPDATE media_jobs SET status = 'failed', errors = errors + 1, last_error = left($2, 500), next_poll_at = NULL, finished_at = now() WHERE id = $1 AND status <> 'succeeded'",
    [id, scrubSecrets(error, [])],
  );
}
