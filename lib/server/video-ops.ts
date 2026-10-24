import "server-only";
import type { PoolClient } from "pg";
import { query, queryOne, transaction } from "./db";
import { log } from "./log";
import { getPhoto } from "./photo";
import { putGenerationFile } from "./storage";
import { refundInTx } from "./refund-tx";
import { refundPartial } from "./credits";
import { toJsonb } from "./jsonb";
import { UserFacingError, userMessage } from "./user-error";
import { isProviderEnabled } from "./providers/resolve";
import { extractMeta } from "../generation/meta";
import { TOOL_BY_ID } from "../tools";
import { refundRatio } from "../generation/delivered";
import { videoCost } from "../generation/llm-pricing";
import {
  VIDEO_ADAPTERS,
  VIDEO_MAX_BYTES,
  VIDEO_OP_DEADLINE_MS,
  VIDEO_SAFETY_MESSAGE,
  VideoProviderError,
  isMp4,
  mp4Seconds,
  videoInputFromValues,
  videoProviderById,
  type VideoAdapter,
  type VideoProviderId,
} from "../generation/video";
import type { AcademicDoc, CostJson, Delivered } from "../generation/types";
import type { FormValues } from "../types";

/**
 * VIDEO JOBS THAT WAIT FOR THEIR PROVIDER (program-17 item 5).
 *
 * A video takes minutes. Holding a worker slot for that whole time would starve every other tool, and the 11-minute
 * job timeout would kill it. So the job is split in two:
 *
 *   1. SUBMIT (`submitVideoJob`, on a worker, seconds). Starts the provider operation, stores its id in `video_ops`
 *      and RELEASES the lease in the same transaction: the generation stays IN_PROGRESS with `locked_by = NULL`.
 *      `reclaimStaleJobs` only looks at rows whose lease is stale, so it never touches a waiting video, and the
 *      claim query does not count such a row as a running job.
 *   2. POLL (`pollDueVideoOps`, the leader's `video-poll` housekeeping step). Asks the provider about every due op
 *      with a backoff and a 20-minute deadline per op. On success it downloads the MP4 and finishes the generation
 *      (`finalizeVideo`); on a provider failure, a safety refusal or the deadline it fails the generation and
 *      refunds it (`failVideo`).
 *
 * Exactly-once. Every terminal step starts with `SELECT … FROM video_ops WHERE generation_id = $1 FOR UPDATE` and
 * proceeds only while `status = 'pending'`, inside the same transaction that writes the file / the FAILED row and the
 * refund. Two concurrent polls therefore serialise on that row lock and the second sees `succeeded` / `failed` and
 * does nothing: one op, at most one finalisation, at most one refund. State lives in the database only, so a restart
 * resumes: a poller that died mid-call just leaves `next_poll_at` in the past (its claim is a short lease).
 */

export type VideoOpsDeps = {
  adapters?: Readonly<Record<VideoProviderId, VideoAdapter>>;
  fetchImpl?: typeof fetch;
};

const adaptersOf = (d: VideoOpsDeps): Readonly<Record<VideoProviderId, VideoAdapter>> => d.adapters ?? VIDEO_ADAPTERS;

/** Seconds until the next poll after `attempts` polls: 10, 15, 20, 30, 45, 60 and then every 60 (the housekeeping tick is 60 s anyway). */
export function videoPollDelaySec(attempts: number): number {
  const ladder = [10, 15, 20, 30, 45, 60];
  return ladder[Math.min(Math.max(0, attempts), ladder.length - 1)]!;
}

/** A poller's claim on an op: if it dies, the op is due again after this. */
const CLAIM_LEASE_SEC = 180;
/** Ops handled per `video-poll` run (each may download a file). */
export const VIDEO_POLL_BATCH = 10;
/** Transient errors (download not ready, 5xx) tolerated before the op is failed ahead of its deadline. */
const MAX_TRANSIENT_ERRORS = 30;

export const VIDEO_DEADLINE_MESSAGE = "Video belgilangan vaqtda tayyor bo‘lmadi. Pul qaytarildi — qayta urinib ko‘ring.";
export const VIDEO_FAILED_MESSAGE = "Provayder videoni yaratmadi. Pul qaytarildi — qayta urinib ko‘ring.";
export const VIDEO_UNAVAILABLE_MESSAGE = "Video xizmati hozir mavjud emas. Pul qaytarildi — keyinroq qayta urinib ko‘ring.";
export const VIDEO_IMAGE_MISSING_MESSAGE = "Boshlang‘ich surat topilmadi. Pul qaytarildi — suratni qayta yuklab, urinib ko‘ring.";

/* ══════════════════════════ 1. submit ══════════════════════════ */

export type VideoJob = { id: string; userId: string; lease: string; values: FormValues };

/**
 * Starts the provider operation of a claimed `video` job and parks the job as «waiting». Throws a `UserFacingError`
 * (or any error) when the job must fail: the worker then runs its normal fail + refund path while it still owns the lease.
 */
export async function submitVideoJob(job: VideoJob, deps: VideoOpsDeps = {}): Promise<"waiting"> {
  const input = videoInputFromValues(job.values);
  const spec = videoProviderById(input.provider);
  const adapter = adaptersOf(deps)[input.provider];

  /*
   * A re-claimed job (the worker died after the provider call, before the handoff committed -- or the lease expired and
   * the row was requeued) must NOT start a second, paid operation: adopt the one already stored.
   */
  const existing = await queryOne<{ status: string }>("SELECT status FROM video_ops WHERE generation_id = $1", [job.id]);
  if (existing) {
    await releaseLease(job, null);
    return "waiting";
  }

  if (!isProviderEnabled(spec.registryId) || !adapter.configured()) throw new UserFacingError(VIDEO_UNAVAILABLE_MESSAGE);

  let image: { mime: string; base64: string } | undefined;
  if (input.imageAssetId) {
    // SQL ownership: another user's upload cannot be read.
    const photo = await getPhoto(job.userId, input.imageAssetId);
    if (!photo) throw new UserFacingError(VIDEO_IMAGE_MISSING_MESSAGE);
    image = { mime: photo.mime, base64: photo.bytes.toString("base64") };
  }

  let opId: string;
  try {
    ({ opId } = await adapter.submit({ prompt: input.prompt, seconds: input.seconds, aspect: input.aspect, ...(image ? { image } : {}) }, { fetchImpl: deps.fetchImpl }));
  } catch (e) {
    const err = e instanceof VideoProviderError ? e : null;
    log("error", "[video] submit failed", { jobId: job.id, provider: input.provider, status: err?.status, safety: err?.safety, err });
    throw new UserFacingError(err?.safety ? VIDEO_SAFETY_MESSAGE : VIDEO_FAILED_MESSAGE);
  }

  await releaseLease(job, { provider: input.provider, opId, seconds: input.seconds });
  log("info", "[video] operation started", { jobId: job.id, provider: input.provider, seconds: input.seconds });
  return "waiting";
}

/** Stores the op (when given) and releases the lease in ONE transaction; refuses when the lease is no longer ours. */
async function releaseLease(job: VideoJob, op: { provider: VideoProviderId; opId: string; seconds: number } | null): Promise<void> {
  await transaction(async (client) => {
    if (op) {
      await client.query(
        `INSERT INTO video_ops (generation_id, provider, op_id, deadline_at, seconds, next_poll_at)
         VALUES ($1, $2, $3, now() + $4::int * interval '1 millisecond', $5, now() + interval '10 seconds')
         ON CONFLICT (generation_id) DO NOTHING`,
        [job.id, op.provider, op.opId, VIDEO_OP_DEADLINE_MS, op.seconds],
      );
    }
    const res = await client.query(
      `UPDATE generations
          SET locked_by = NULL, locked_at = NULL, progress = GREATEST(progress, 10), step = 'Video tayyorlanmoqda'
        WHERE id = $1 AND locked_by = $2 AND status = 'IN_PROGRESS'`,
      [job.id, job.lease],
    );
    if (!res.rowCount) {
      // The lease was lost (reclaimed / force-failed): roll the op row back too. The provider operation, if one was
      // started, is orphaned -- logged so it can be found; it cannot be cancelled through either API.
      if (op) log("error", "[video] lease lost after the provider call -- operation orphaned", { jobId: job.id, provider: op.provider });
      throw new Error("video: lease lost");
    }
  });
}

/* ══════════════════════════ 2. poll ══════════════════════════ */

type DueOp = { generation_id: string; provider: VideoProviderId; op_id: string; attempts: number; seconds: number };

/**
 * Claims up to `limit` due ops by pushing their `next_poll_at` forward (a lease): another process / tick will not take
 * the same op while this one polls it, and a crashed poller's claim expires by itself.
 */
export async function claimDueOps(limit: number = VIDEO_POLL_BATCH): Promise<DueOp[]> {
  return query<DueOp>(
    `UPDATE video_ops
        SET next_poll_at = now() + $2::int * interval '1 second'
      WHERE generation_id IN (
              SELECT generation_id FROM video_ops
               WHERE status = 'pending' AND next_poll_at <= now()
               ORDER BY next_poll_at
               LIMIT $1
               FOR UPDATE SKIP LOCKED)
      RETURNING generation_id, provider, op_id, attempts, seconds`,
    [limit, CLAIM_LEASE_SEC],
  );
}

export type PollOutcome = "pending" | "succeeded" | "failed" | "skipped";

async function pastDeadline(generationId: string): Promise<boolean> {
  const row = await queryOne<{ late: boolean }>("SELECT deadline_at <= now() AS late FROM video_ops WHERE generation_id = $1 AND status = 'pending'", [generationId]);
  return row?.late === true;
}

/** A typical clip takes about this long; the bar creeps from 10 to 90 over it (and never past 90 while waiting). */
const EXPECTED_WAIT_SEC = 300;

async function reschedule(op: DueOp, error: string | null): Promise<void> {
  await query(
    `UPDATE generations g
        SET progress = LEAST(90, GREATEST(g.progress, 10 + (80 * LEAST(1, EXTRACT(EPOCH FROM now() - v.created_at) / $2::float))::int))
       FROM video_ops v
      WHERE v.generation_id = $1 AND g.id = v.generation_id AND g.status = 'IN_PROGRESS' AND g.locked_by IS NULL`,
    [op.generation_id, EXPECTED_WAIT_SEC],
  );
  await query(
    `UPDATE video_ops
        SET attempts = attempts + 1,
            next_poll_at = now() + $2::int * interval '1 second',
            last_error = COALESCE($3, last_error)
      WHERE generation_id = $1 AND status = 'pending'`,
    [op.generation_id, videoPollDelaySec(op.attempts + 1), error],
  );
}

/** One poll of one claimed op. Never throws for a provider problem: it reschedules or fails the op. */
export async function pollOp(op: DueOp, deps: VideoOpsDeps = {}): Promise<PollOutcome> {
  const adapter = adaptersOf(deps)[op.provider];
  if (!adapter) return "skipped";
  const t = { fetchImpl: deps.fetchImpl };

  const transient = async (e: unknown): Promise<PollOutcome> => {
    const msg = e instanceof Error ? e.message.slice(0, 300) : "xato";
    if (await pastDeadline(op.generation_id)) return (await failVideo(op.generation_id, VIDEO_DEADLINE_MESSAGE, msg)) ? "failed" : "skipped";
    if (op.attempts + 1 >= MAX_TRANSIENT_ERRORS) return (await failVideo(op.generation_id, VIDEO_FAILED_MESSAGE, msg)) ? "failed" : "skipped";
    log("warn", "[video] poll error, will retry", { jobId: op.generation_id, provider: op.provider, attempt: op.attempts + 1, err: e });
    await reschedule(op, msg);
    return "pending";
  };

  let result;
  try {
    result = await adapter.poll(op.op_id, t);
  } catch (e) {
    if (e instanceof VideoProviderError && !e.retryable) {
      log("error", "[video] poll refused", { jobId: op.generation_id, provider: op.provider, status: e.status, err: e });
      return (await failVideo(op.generation_id, e.safety ? VIDEO_SAFETY_MESSAGE : VIDEO_FAILED_MESSAGE, e.message)) ? "failed" : "skipped";
    }
    return transient(e);
  }

  if (result.state === "running") {
    if (await pastDeadline(op.generation_id)) return (await failVideo(op.generation_id, VIDEO_DEADLINE_MESSAGE, "deadline")) ? "failed" : "skipped";
    await reschedule(op, null);
    return "pending";
  }
  if (result.state === "failed") {
    log("warn", "[video] provider failed the operation", { jobId: op.generation_id, provider: op.provider, safety: result.safety, detail: result.message.slice(0, 200) });
    return (await failVideo(op.generation_id, result.safety ? VIDEO_SAFETY_MESSAGE : userMessage(result.message, VIDEO_FAILED_MESSAGE), result.message)) ? "failed" : "skipped";
  }

  let bytes: Uint8Array;
  try {
    bytes = await adapter.download(result.media, t);
  } catch (e) {
    if (e instanceof VideoProviderError && !e.retryable) {
      return (await failVideo(op.generation_id, VIDEO_FAILED_MESSAGE, e.message)) ? "failed" : "skipped";
    }
    return transient(e);
  }
  if (!bytes.byteLength || bytes.byteLength > VIDEO_MAX_BYTES || !isMp4(bytes)) {
    return (await failVideo(op.generation_id, VIDEO_FAILED_MESSAGE, "result is not a usable MP4")) ? "failed" : "skipped";
  }
  return (await finalizeVideo(op.generation_id, bytes)) ? "succeeded" : "skipped";
}

/** The `video-poll` housekeeping step: polls every due op. Returns how many ops reached a terminal state. */
export async function pollDueVideoOps(deps: VideoOpsDeps = {}, limit: number = VIDEO_POLL_BATCH): Promise<number> {
  const due = await claimDueOps(limit);
  let done = 0;
  for (const op of due) {
    try {
      const outcome = await pollOp(op, deps);
      if (outcome === "succeeded" || outcome === "failed") done++;
    } catch (e) {
      // One op's database / unexpected error must not stop the others; its claim lease expires and it is retried.
      log("error", "[video] poll step failed for one operation", { jobId: op.generation_id, err: e });
    }
  }
  return done;
}

/* ══════════════════════════ 3. terminal steps ══════════════════════════ */

async function lockPendingOp(client: PoolClient, generationId: string): Promise<{ provider: VideoProviderId; seconds: number } | null> {
  const res = await client.query<{ provider: VideoProviderId; seconds: number; status: string }>(
    "SELECT provider, seconds, status FROM video_ops WHERE generation_id = $1 FOR UPDATE",
    [generationId],
  );
  const row = res.rows[0];
  return row && row.status === "pending" ? { provider: row.provider, seconds: Number(row.seconds) } : null;
}

/**
 * Finishes the generation with the downloaded MP4: file + `doc_json` + `delivered` + `cost_json` + COMPLETED, in one
 * transaction guarded by the op row lock. Returns `true` only for the call that actually finished it.
 */
export async function finalizeVideo(generationId: string, bytes: Uint8Array): Promise<boolean> {
  const out = await transaction(async (client) => {
    const op = await lockPendingOp(client, generationId);
    if (!op) return null;

    const g = await client.query<{ user_id: string; values_json: FormValues }>(
      "SELECT user_id, values_json FROM generations WHERE id = $1 AND status = 'IN_PROGRESS' AND locked_by IS NULL FOR UPDATE",
      [generationId],
    );
    const row = g.rows[0];
    if (!row) {
      // Failed by an admin / deleted while the provider worked: nothing to deliver; close the op so it is not polled again.
      await client.query("UPDATE video_ops SET status = 'failed', finished_at = now(), last_error = 'generation is no longer waiting' WHERE generation_id = $1", [generationId]);
      return null;
    }
    const input = videoInputFromValues(row.values_json);
    const tool = TOOL_BY_ID.video;
    const delivered = deliveredSeconds(mp4Seconds(bytes), op.seconds);
    const actual = mp4Seconds(bytes) || op.seconds;
    const { usd, priced } = videoCost(op.provider, actual);
    const model = videoProviderById(op.provider).short;
    const cost: CostJson = {
      provider: op.provider,
      model,
      inputTokens: 0,
      outputTokens: 0,
      calls: 1,
      usd,
      parts: [{ kind: "video", provider: op.provider, model, calls: 1, inputTokens: 0, outputTokens: 0, units: Math.round(actual), usd, ...(priced ? {} : { priced: false as const }) }],
    };
    const doc: AcademicDoc = {
      meta: extractMeta(tool, row.values_json),
      titlePage: false,
      toc: false,
      sections: [{ id: "options", title: "Sozlamalar", blocks: [{ kind: "p", text: `${videoProviderById(op.provider).short} · ${input.seconds} soniya · ${input.aspect}` }] }],
      video: { provider: op.provider, prompt: input.prompt, aspect: input.aspect, requestedSeconds: op.seconds, seconds: actual, fromImage: Boolean(input.imageAssetId) },
    };
    const fileName = "video.mp4";
    await putGenerationFile(generationId, { bytes, mime: "video/mp4", fileName }, client);
    await client.query(
      `UPDATE generations
          SET status = 'COMPLETED', progress = 100, step = 'Tayyor', html = '', doc_json = $2, file_name = $3,
              preview = NULL, format = 'mp4', delivered_json = $4, cost_json = $5,
              finished_at = now(), locked_by = NULL, locked_at = NULL, error = NULL, live_json = NULL
        WHERE id = $1`,
      [generationId, toJsonb(doc), fileName, delivered ? toJsonb(delivered) : null, toJsonb(cost)],
    );
    await client.query("UPDATE video_ops SET status = 'succeeded', finished_at = now() WHERE generation_id = $1", [generationId]);
    return { userId: String(row.user_id), delivered };
  });
  if (!out) return false;

  log("info", "[video] finished", { jobId: generationId, bytes: bytes.byteLength });
  // A clip shorter than the seconds paid for: the difference is refunded (the `delivered` mechanism of every tool).
  const ratio = refundRatio(out.delivered ?? undefined);
  if (out.delivered && ratio !== null) {
    const ok = await refundPartial(out.userId, generationId, ratio, `${out.delivered.want} soniyadan ${out.delivered.got} soniya yaratildi — farq qaytarildi`).catch((e) => {
      log("error", "[video] partial refund failed", { jobId: generationId, alert: "REFUND_FAILED", err: e });
      return false;
    });
    log("warn", "[video] short clip refunded", { jobId: generationId, ratio, refunded: ok });
  }
  return true;
}

/** `want` seconds were paid for; a clip more than a second shorter is a shortfall (a longer one is never charged extra). */
export function deliveredSeconds(actual: number, want: number): Delivered | undefined {
  if (!(actual > 0) || !(want > 0) || actual + 1 >= want) return undefined;
  return { got: Math.floor(actual), want, unit: "soniya" };
}

/**
 * Fails a waiting video and refunds it, in ONE transaction guarded by the op row lock (so a deadline firing together
 * with a late success is decided by whoever locks the row first). `message` is what the user sees (Uzbek, safe);
 * `detail` is the raw reason, kept in `video_ops.last_error` for the operator only.
 */
export async function failVideo(generationId: string, message: string, detail: string): Promise<boolean> {
  const safe = userMessage(message, VIDEO_FAILED_MESSAGE);
  return transaction(async (client) => {
    const op = await lockPendingOp(client, generationId);
    if (!op) return false;
    const g = await client.query<{ user_id: string }>(
      `UPDATE generations
          SET status = 'FAILED', progress = 100, step = 'Xatolik', error = $2, finished_at = now(),
              locked_by = NULL, locked_at = NULL, live_json = NULL
        WHERE id = $1 AND status = 'IN_PROGRESS' AND locked_by IS NULL
        RETURNING user_id`,
      [generationId, safe],
    );
    await client.query("UPDATE video_ops SET status = 'failed', finished_at = now(), last_error = $2 WHERE generation_id = $1", [generationId, detail.slice(0, 500)]);
    const row = g.rows[0];
    if (row) await refundInTx(client, String(row.user_id), generationId, `Xatolik: ${safe}`.slice(0, 200));
    return true;
  });
}

/** Waiting videos and how many are in flight (for the admin / health views and tests). */
export async function videoInFlight(): Promise<number> {
  const row = await queryOne<{ n: string }>("SELECT count(*)::text AS n FROM generations WHERE tool_id = 'video' AND status = 'IN_PROGRESS'");
  return Number(row?.n ?? 0);
}
