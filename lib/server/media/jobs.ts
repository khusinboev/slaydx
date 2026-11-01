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
