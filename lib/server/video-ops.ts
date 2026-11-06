import "server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { query, queryOne, transaction } from "./db";
import { log } from "./log";
import { getPhoto } from "./photo";
import { putGenerationFile } from "./storage";
import { refundInTx } from "./refund-tx";
import { toJsonb } from "./jsonb";
import { UserFacingError, userMessage } from "./user-error";
import { recordProviderFailure } from "./provider-failures";
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
  encodeVideoValues,
  isMp4,
  mp4Seconds,
  videoInputFromValues,
  videoProviderById,
  type VideoAdapter,
  type VideoInput,
  type VideoPollResult,
  type VideoProviderId,
} from "../generation/video";
import type { AcademicDoc, CostJson, Delivered } from "../generation/types";
import type { FormValues } from "../types";
import { MediaError, costUsd, normalize, submitWithRoutes, type AdapterAsset, type AdapterDeps, type CatalogEntry, type MediaAdapter, type NormalizedParams } from "../studio-core";
import { studioVideoAdapters, videoMediaAdapters, videoRoute } from "../media/adapters/video";
import { MEDIA_CATALOG } from "../media/catalog";
import { OWN_AUDIO_PARAM, SECOND_IMAGE_PARAM, STUDIO_EFFECT_SECONDS, STUDIO_VIDEO_PURPOSE, effectPhotos, isAvatarModel } from "../media/catalog-video";
import { avatarAudioAsset } from "./media/avatar-audio";
import { isEffectEntry, studioVideoEntry, studioVideoImageParams } from "../media/studio-video-pricing";
import { VIDEO_TOOLS_SQL } from "../tool-kinds";
import { modelAvailable } from "./media/availability";
import { mediaOverrides } from "./media/overrides";
import { breakerHealth } from "./media/run";
import { mediaCoreSwitches } from "./media/switches";
import {
  claimDueMediaJobs,
  failMediaJobTx,
  failSubmittingMediaJob,
  finishMediaJobTx,
  insertMediaJobTx,
  lockMediaJobByKey,
  mediaJobByKeyTx,
  mediaJobPastDeadline,
  parkMediaJob,
  rescheduleMediaJob,
  type MediaJobRow,
} from "./media/jobs";

/**
 * VIDEO JOBS THAT WAIT FOR THEIR PROVIDER (program-17 item 5).
 *
 * A video takes minutes. Holding a worker slot for that whole time would starve every other tool, and the 11-minute
 * job timeout would kill it. So the job is split in two:
 *
 *   1. SUBMIT (`submitVideoJob`, on a worker, seconds). Writes the `video_ops` row as 'submitting' BEFORE the provider
 *      is called, starts the operation, stores its id ('pending') and RELEASES the lease: the generation stays
 *      IN_PROGRESS with `locked_by = NULL`. `reclaimStaleJobs` only looks at rows whose lease is stale, so it never
 *      touches a waiting video, and the claim query does not count such a row as a running job. A 'submitting' row
 *      found on a re-claim means the previous worker died between the call and the update: the provider may be
 *      working on a paid operation nobody knows the id of, so the job is FAILED and refunded -- never submitted twice.
 *   2. POLL (`pollDueVideoOps`, its OWN leader-locked loop `video-poll-loop.ts`, never part of housekeeping or the job
 *      tick). Asks the provider about every due op with a backoff and a 20-minute deadline per op. On success it downloads the MP4 and finishes the generation
 *      (`finalizeVideo`); on a provider failure, a safety refusal or the deadline it fails the generation and
 *      refunds it (`failVideo`).
 *
 * Exactly-once. Every terminal step starts with `SELECT … FROM video_ops WHERE generation_id = $1 FOR UPDATE` and
 * proceeds only while `status = 'pending'`, inside the same transaction that writes the file / the FAILED row and the
 * refund. Two concurrent polls therefore serialise on that row lock and the second sees `succeeded` / `failed` and
 * does nothing: one op, at most one finalisation, at most one refund. State lives in the database only, so a restart
 * resumes: a poller that died mid-call just leaves `next_poll_at` in the past (its claim is a short lease).
 *
 * MEDIA CORE (docs/studio/P0-SPEC.md §6.4). With `media.core.video` ON at submit time, a NEW video is submitted through
 * the core router (`submitWithRoutes`, breaker health, the `video.clip` purpose's catalog route) and tracked in a
 * `media_jobs` row (idempotency key `<generationId>:video:0`) instead of `video_ops`. Everything after the submit is
 * the same code for both tables: the same claim lease, backoff, deadline, transient-error limit, the same
 * `finalizeVideo` / `failVideo` (they lock whichever row the generation has) and the same Uzbek messages. A job keeps
 * the table it started in: a row found in either table on a re-claim decides the path whatever the switch says now,
 * so `video_ops` rows drain on the old path and flipping the switch never resubmits a paid operation. Capacity
 * (`video.max_concurrent`, `videoInFlight`) counts waiting GENERATIONS, so it covers both tables by construction.
 *
 * STUDIO «Video» tab (docs/studio/P3-SPEC.md, tool `studio-video`). ALWAYS on the core, whatever `media.core.video`
 * says (a core-native caller, like the Studio's pictures): `submitStudioVideoJob` writes the `media_jobs` row (purpose
 * `studio.video`, the chosen catalog model, the same `<generationId>:video:0` key) under the same per-generation lock,
 * submits through that model's catalog routes and parks. From there it is THIS file's one poll loop, claim lease,
 * backoff, deadline and terminal steps — no second loop: `claimDueOps` claims both purposes, `pollerFor` picks the
 * Studio adapter of the row's model, `finalizeVideo` / `failVideo` lock the same row and refund the same way.
 */

export type VideoOpsDeps = {
  adapters?: Readonly<Record<VideoProviderId, VideoAdapter>>;
  fetchImpl?: typeof fetch;
  /** Test seam: the `media.core.video` switch for this submit (default: the setting, read at the moment of the submit). */
  core?: boolean;
  /** Test seam: runs inside the submit guard, after the row checks and before the row is written. */
  afterGuard?: () => Promise<void>;
  /** Test seam: the Studio adapters by adapter id (default `studioVideoAdapters()`). */
  studioAdapters?: Readonly<Record<string, MediaAdapter>>;
};

const adaptersOf = (d: VideoOpsDeps): Readonly<Record<VideoProviderId, VideoAdapter>> => d.adapters ?? VIDEO_ADAPTERS;
const studioAdaptersOf = (d: VideoOpsDeps): Readonly<Record<string, MediaAdapter>> => d.studioAdapters ?? studioVideoAdapters();

/** Seconds until the next poll after `attempts` polls: 10, 15, 20, 30, 45, 60 and then every 60. */
export function videoPollDelaySec(attempts: number): number {
  const ladder = [10, 15, 20, 30, 45, 60];
  return ladder[Math.min(Math.max(0, attempts), ladder.length - 1)]!;
}

/**
 * A poller's claim on an op: if it dies, the op is due again after this. MUST stay above the worst-case time of ONE op
 * (a 30 s poll + a 60 s download = 90 s), or a slow op would be picked up a second time while still being handled.
 */
export const CLAIM_LEASE_SEC = 180;
/** Ops claimed per `video-poll` run: small, so a run never hoards claims it cannot finish. */
export const VIDEO_POLL_BATCH = 3;
/** One `video-poll` run starts no new op after this long (worst case: 45 s + one 90 s op). */
export const VIDEO_POLL_BUDGET_MS = 45_000;
/** Transient errors (download not ready, 5xx), counted on their own, tolerated before the op is failed ahead of its deadline. */
export const MAX_TRANSIENT_ERRORS = 30;

export const VIDEO_DEADLINE_MESSAGE = "Video belgilangan vaqtda tayyor bo‘lmadi. Pul qaytarildi — qayta urinib ko‘ring.";
export const VIDEO_FAILED_MESSAGE = "Provayder videoni yaratmadi. Pul qaytarildi — qayta urinib ko‘ring.";
export const VIDEO_UNAVAILABLE_MESSAGE = "Video xizmati hozir mavjud emas. Pul qaytarildi — keyinroq qayta urinib ko‘ring.";
export const VIDEO_LOST_MESSAGE = "Video so‘rovi yo‘qoldi (server qayta ishga tushdi). Pul qaytarildi — qayta urinib ko‘ring.";
export const VIDEO_IMAGE_MISSING_MESSAGE = "Boshlang‘ich surat topilmadi. Pul qaytarildi — suratni qayta yuklab, urinib ko‘ring.";
/** P9 HeyGen: the own speech the avatar was to speak is gone (deleted / purged after the purchase). */
export const VIDEO_AUDIO_MISSING_MESSAGE = "Tanlangan ovoz topilmadi. Pul qaytarildi — ovozni qayta tanlab, urinib ko‘ring.";

/* ══════════════════════════ 1. submit ══════════════════════════ */

export type VideoJob = { id: string; userId: string; lease: string; values: FormValues };

/** The catalog purpose of a user's clip (`lib/media/catalog.ts` MEDIA_PURPOSES). */
export const VIDEO_PURPOSE = "video.clip";

/** The `media_jobs` purposes the video poll loop drives. */
export const VIDEO_POLL_PURPOSES: readonly string[] = [VIDEO_PURPOSE, STUDIO_VIDEO_PURPOSE];

/** The `media_jobs` idempotency key of a generation's one provider operation. */
export function videoMediaKey(generationId: string): string {
  return `${generationId}:video:0`;
}

/**
 * Namespace of the per-generation submit lock (`pg_advisory_xact_lock(ns, hashtext(id))`). The TWO-int form is its own
 * key space, so a hash can never collide with the single-key locks (`VIDEO_POLL_LOCK_ID`, `VIDEO_CLAIM_LOCK_ID`).
 */
export const VIDEO_SUBMIT_LOCK_NS = 727_000_006;

const coreDeps = (d: VideoOpsDeps): AdapterDeps => (d.fetchImpl ? { fetchImpl: d.fetchImpl } : {});

/** What the submit guard found or wrote, decided under the per-generation lock. */
type Guarded =
  | { found: "video_ops"; status: string }
  | { found: "media_jobs"; status: string; id: string }
  | { start: "old"; image: AdapterAsset | undefined }
  | { start: "core"; image: AdapterAsset | undefined; row: MediaJobRow; params: NormalizedParams; entry: CatalogEntry };

/**
 * The generation's `media_jobs` row inside the guard. With the switch OFF the old path must not depend on the core's
 * table: a failing read (table missing, broken) is logged and counts as «no row», behind a savepoint so the guard's
 * transaction survives it. With the switch ON the error fails the job.
 */
async function mediaRowInGuard(client: PoolClient, key: string, core: boolean): Promise<MediaJobRow | null> {
  if (core) return mediaJobByKeyTx(client, key);
  await client.query("SAVEPOINT video_media_row");
  try {
    const row = await mediaJobByKeyTx(client, key);
    await client.query("RELEASE SAVEPOINT video_media_row");
    return row;
  } catch (e) {
    await client.query("ROLLBACK TO SAVEPOINT video_media_row");
    log("warn", "[video] media_jobs could not be read -- the switch is off, the submit goes on without it", { key, err: e });
    return null;
  }
}

/**
 * Starts the provider operation of a claimed `video` job and parks the job as «waiting». Throws a `UserFacingError`
 * (or any error) when the job must fail: the worker then runs its normal fail + refund path while it still owns the lease.
 */
export async function submitVideoJob(job: VideoJob, deps: VideoOpsDeps = {}): Promise<"waiting"> {
  const input = videoInputFromValues(job.values);
  const spec = videoProviderById(input.provider);
  const adapter = adaptersOf(deps)[input.provider];
  // Read at the moment of the submit: the video branch of the worker runs outside the build's media context.
  const core = deps.core ?? (await mediaCoreSwitches()).video;
  const key = videoMediaKey(job.id);

  /*
   * The guard and the row it writes run in ONE transaction under a per-generation advisory lock: two submits of the
   * same generation (a lost lease re-claimed elsewhere, possibly with the switch in the other state) are serialised,
   * so the second always sees the first one's row and the two tables can never both get a row for one generation.
   * The row is committed BEFORE the provider call (see the file header).
   *
   * A re-claimed job must NOT start a second, paid operation. What the stored row (either table, whatever the switch
   * says now) says:
   *   'pending'    the previous run stored the op id: adopt it (just release the lease);
   *   'submitting' the previous run died between the provider call and the update -- the op id is unknown: fail + refund;
   *   'succeeded' / 'failed' the operation already ended: the job cannot be waiting for it -- fail (the refund is idempotent).
   */
  const g = await transaction(async (client): Promise<Guarded> => {
    await client.query("SELECT pg_advisory_xact_lock($1::int, hashtext($2))", [VIDEO_SUBMIT_LOCK_NS, job.id]);
    const existing = (await client.query<{ status: string }>("SELECT status FROM video_ops WHERE generation_id = $1", [job.id])).rows[0];
    if (existing) return { found: "video_ops", status: existing.status };
    const parked = await mediaRowInGuard(client, key, core);
    if (parked) return { found: "media_jobs", status: parked.status, id: parked.id };
    await deps.afterGuard?.();

    if (!isProviderEnabled(spec.registryId) || !adapter.configured()) throw new UserFacingError(VIDEO_UNAVAILABLE_MESSAGE);
    let image: AdapterAsset | undefined;
    if (input.imageAssetId) {
      // SQL ownership: another user's upload cannot be read.
      const photo = await getPhoto(job.userId, input.imageAssetId);
      if (!photo) throw new UserFacingError(VIDEO_IMAGE_MISSING_MESSAGE);
      image = { mime: photo.mime, base64: photo.bytes.toString("base64") };
    }

    if (core) {
      const { entry } = videoRoute(input.provider);
      const params = normalize(entry.params, encodeVideoValues(input));
      const primary = entry.routes[0]!;
      const row = await insertMediaJobTx(client, {
        generationId: job.id,
        purpose: VIDEO_PURPOSE,
        modelId: entry.id,
        provider: primary.provider,
        upstreamModel: primary.upstreamModel,
        idempotencyKey: key,
        params: { ...params },
        costUsd: costUsd(entry.cost, params),
        deadlineAt: new Date(Date.now() + VIDEO_OP_DEADLINE_MS),
      });
      if (!row) throw new UserFacingError(VIDEO_LOST_MESSAGE);
      return { start: "core", image, row, params, entry };
    }
    const inserted = await client.query(
      `INSERT INTO video_ops (generation_id, provider, deadline_at, seconds)
       VALUES ($1, $2, now() + $3::int * interval '1 millisecond', $4)
       ON CONFLICT (generation_id) DO NOTHING
       RETURNING generation_id`,
      [job.id, input.provider, VIDEO_OP_DEADLINE_MS, input.seconds],
    );
    if (!inserted.rows.length) throw new UserFacingError(VIDEO_LOST_MESSAGE);
    return { start: "old", image };
  });

  if ("found" in g) {
    if (g.status === "pending") {
      await releaseLease(job);
      return "waiting";
    }
    if (g.status === "submitting") {
      // Only a row that is STILL 'submitting' is failed: one parked meanwhile keeps its op id.
      if (g.found === "video_ops") await query("UPDATE video_ops SET status = 'failed', finished_at = now(), last_error = 'lost between the provider call and the update' WHERE generation_id = $1 AND status = 'submitting'", [job.id]);
      else await failSubmittingMediaJob(g.id, "lost between the provider call and the update");
      log("error", "[video] a previous submit died before storing the operation id -- failing and refunding instead of paying twice", { jobId: job.id, table: g.found });
      throw new UserFacingError(VIDEO_LOST_MESSAGE);
    }
    throw new UserFacingError(VIDEO_FAILED_MESSAGE);
  }
  if (g.start === "core") return submitThroughCore(job, input, g, deps);

  const image = g.image;
  let opId: string;
  try {
    ({ opId } = await adapter.submit({ prompt: input.prompt, seconds: input.seconds, aspect: input.aspect, ...(image ? { image } : {}) }, { fetchImpl: deps.fetchImpl }));
  } catch (e) {
    const err = e instanceof VideoProviderError ? e : null;
    log("error", "[video] submit failed", { jobId: job.id, provider: input.provider, status: err?.status, safety: err?.safety, err });
    await query("UPDATE video_ops SET status = 'failed', finished_at = now(), last_error = $2 WHERE generation_id = $1 AND status = 'submitting'", [job.id, (err?.message ?? "submit failed").slice(0, 300)]).catch(() => undefined);
    throw new UserFacingError(err?.safety ? VIDEO_SAFETY_MESSAGE : VIDEO_FAILED_MESSAGE, { cause: e });
  }

  /*
   * The op id is stored FIRST, on its own and whatever happens to the lease: a SIGTERM (`releaseJobs`) or a reclaim
   * during the provider call must not lose the id of an operation that is being paid for -- the next claim adopts it.
   */
  await query(
    `UPDATE video_ops SET op_id = $2, status = 'pending', next_poll_at = now() + interval '10 seconds'
      WHERE generation_id = $1 AND status = 'submitting'`,
    [job.id, opId],
  );
  await releaseLease(job);
  log("info", "[video] operation started", { jobId: job.id, provider: input.provider, seconds: input.seconds });
  return "waiting";
}

/**
 * The provider half of `submitVideoJob` through the media core, on the 'submitting' `media_jobs` row the guard wrote:
 * the same provider → 'pending' order and the same failure messages as the `video_ops` path.
 */
async function submitThroughCore(job: VideoJob, input: VideoInput, g: Extract<Guarded, { start: "core" }>, deps: VideoOpsDeps): Promise<"waiting"> {
  const { row, params, entry, image } = g;
  const primary = entry.routes[0]!;
  let opId: string;
  try {
    const { route, result } = await submitWithRoutes(
      entry.routes,
      videoMediaAdapters(adaptersOf(deps)),
      breakerHealth,
      // The provider request is built from today's normalizer (`videoInputFromValues`), so it is byte-identical to the old path.
      { params: { ...params, prompt: input.prompt, seconds: input.seconds, aspect: input.aspect }, ...(image ? { assets: { imageAssetId: [image] } } : {}), idempotencyKey: row.idempotency_key },
      coreDeps(deps),
    );
    if (!("opId" in result)) throw new MediaError(route.provider, "a video route answered synchronously");
    if (route !== primary) await query("UPDATE media_jobs SET provider = $2, upstream_model = $3 WHERE id = $1", [row.id, route.provider, route.upstreamModel]);
    opId = result.opId;
  } catch (e) {
    const err = e instanceof MediaError ? e : null;
    log("error", "[video] submit failed", { jobId: job.id, provider: input.provider, status: err?.status, safety: err?.safety, err });
    await failSubmittingMediaJob(row.id, (err?.message ?? "submit failed").slice(0, 300)).catch(() => undefined);
    throw new UserFacingError(err?.safety ? VIDEO_SAFETY_MESSAGE : VIDEO_FAILED_MESSAGE, { cause: e });
  }

  // The op id first, whatever happens to the lease (see `submitVideoJob`).
  await parkMediaJob(row.id, opId, new Date(Date.now() + 10_000));
  await releaseLease(job);
  log("info", "[video] operation started", { jobId: job.id, provider: input.provider, seconds: input.seconds, mediaJobId: row.id });
  return "waiting";
}

/**
 * Releases the lease (the job becomes «waiting»). When the lease is no longer ours (SIGTERM requeued the job, or the
 * stale-lease reclaim did) nothing is lost: the op id is already stored, the job is QUEUED again and its next claim
 * adopts the operation.
 */
async function releaseLease(job: VideoJob): Promise<void> {
  const res = await query<{ id: string }>(
    `UPDATE generations
        SET locked_by = NULL, locked_at = NULL, progress = GREATEST(progress, 10), step = 'Video tayyorlanmoqda'
      WHERE id = $1 AND locked_by = $2 AND status = 'IN_PROGRESS'
      RETURNING id`,
    [job.id, job.lease],
  );
  if (!res.length) log("warn", "[video] the lease was lost during the submit -- the stored operation is adopted by the next claim", { jobId: job.id });
}

/* ══════════════════════════ 1b. submit (Studio) ══════════════════════════ */

/** What the Studio submit guard found or wrote, decided under the per-generation lock. */
type StudioGuarded = { found: string; id: string } | { row: MediaJobRow; assets: Record<string, AdapterAsset[]> };

/**
 * The SUBMIT half of a Studio clip (`studio-video`): the chosen catalog model (Gemini Omni, Kling 3.0, a Kling effect)
 * through the media core, parked in `media_jobs`. Same contract as `submitVideoJob`: the row is committed BEFORE the
 * provider call under the per-generation lock, a re-claimed job adopts a pending row and never submits twice, and any
 * throw is a normal fail + full refund by the worker while it owns the lease.
 */
export async function submitStudioVideoJob(job: VideoJob, deps: VideoOpsDeps = {}): Promise<"waiting"> {
  const entry = studioVideoEntry(job.values);
  // The route refused unknown models before charging; a stored row with one is failed and refunded.
  if (!entry) throw new UserFacingError(VIDEO_UNAVAILABLE_MESSAGE);
  const params = normalize(entry.params, job.values);
  const key = videoMediaKey(job.id);
  const adapters = studioAdaptersOf(deps);

  const g = await transaction(async (client): Promise<StudioGuarded> => {
    await client.query("SELECT pg_advisory_xact_lock($1::int, hashtext($2))", [VIDEO_SUBMIT_LOCK_NS, job.id]);
    const parked = await mediaJobByKeyTx(client, key);
    if (parked) return { found: parked.status, id: parked.id };
    await deps.afterGuard?.();

    // Provider on + keyed + not switched off in «Media modellari» RIGHT NOW (the route checked it at purchase).
    const primary = entry.routes[0]!;
    if (!modelAvailable(entry.id, await mediaOverrides()) || !adapters[primary.adapter]?.configured()) throw new UserFacingError(VIDEO_UNAVAILABLE_MESSAGE);
    // Every photo the job sends (the start image; P4: the end frame, the second photo of a two-photo effect).
    const assets: Record<string, AdapterAsset[]> = {};
    for (const name of studioVideoImageParams(entry, params)) {
      const ids = params[name];
      const assetId = Array.isArray(ids) ? ids[0] : undefined;
      if (!assetId) continue;
      // SQL ownership: another user's upload cannot be read.
      const photo = await getPhoto(job.userId, assetId);
      if (!photo) throw new UserFacingError(VIDEO_IMAGE_MISSING_MESSAGE);
      assets[name] = [{ mime: photo.mime, base64: photo.bytes.toString("base64") }];
    }
    // P9 HeyGen: the own speech the avatar lip-syncs to (SQL ownership again, with the job owner's id).
    if (isAvatarModel(entry.id)) {
      const audio = await avatarAudioAsset(job.userId, params);
      if (audio === undefined) throw new UserFacingError(VIDEO_AUDIO_MISSING_MESSAGE);
      if (audio) assets[OWN_AUDIO_PARAM] = [audio];
    }
    // An effect without the photo(s) its scene needs: the route refused it before charging; a stored one is refunded.
    if (isEffectEntry(entry) && (!assets.imageAssetId || (effectPhotos(params.effect, entry.id) === 2 && !assets[SECOND_IMAGE_PARAM]))) {
      throw new UserFacingError(VIDEO_IMAGE_MISSING_MESSAGE);
    }
    const row = await insertMediaJobTx(client, {
      generationId: job.id,
      purpose: STUDIO_VIDEO_PURPOSE,
      modelId: entry.id,
      provider: primary.provider,
      upstreamModel: primary.upstreamModel,
      idempotencyKey: key,
      params: { ...params },
      costUsd: costUsd(entry.cost, params),
      deadlineAt: new Date(Date.now() + VIDEO_OP_DEADLINE_MS),
    });
    if (!row) throw new UserFacingError(VIDEO_LOST_MESSAGE);
    return { row, assets };
  });

  if ("found" in g) {
    if (g.found === "pending") {
      await releaseLease(job);
      return "waiting";
    }
    if (g.found === "submitting") {
      await failSubmittingMediaJob(g.id, "lost between the provider call and the update");
      log("error", "[video] a previous Studio submit died before storing the operation id -- failing and refunding instead of paying twice", { jobId: job.id });
      throw new UserFacingError(VIDEO_LOST_MESSAGE);
    }
    throw new UserFacingError(VIDEO_FAILED_MESSAGE);
  }

  const { row, assets } = g;
  let opId: string;
  try {
    const { route, result } = await submitWithRoutes(
      entry.routes,
      adapters,
      breakerHealth,
      { params: { ...params }, ...(Object.keys(assets).length ? { assets } : {}), idempotencyKey: row.idempotency_key },
      coreDeps(deps),
    );
    if (!("opId" in result)) throw new MediaError(route.provider, "a video route answered synchronously");
    if (route !== entry.routes[0]) await query("UPDATE media_jobs SET provider = $2, upstream_model = $3 WHERE id = $1", [row.id, route.provider, route.upstreamModel]);
    opId = result.opId;
  } catch (e) {
    const err = e instanceof MediaError ? e : null;
    log("error", "[video] Studio submit failed", { jobId: job.id, modelId: entry.id, status: err?.status, safety: err?.safety, err });
    await failSubmittingMediaJob(row.id, (err?.message ?? "submit failed").slice(0, 300)).catch(() => undefined);
    throw new UserFacingError(err?.safety ? VIDEO_SAFETY_MESSAGE : VIDEO_FAILED_MESSAGE, { cause: e });
  }

  // The op id first, whatever happens to the lease (see `submitVideoJob`).
  await parkMediaJob(row.id, opId, new Date(Date.now() + 10_000));
  await releaseLease(job);
  log("info", "[video] Studio operation started", { jobId: job.id, modelId: entry.id, mediaJobId: row.id });
  return "waiting";
}

/** Seconds a Studio row paid for: its `seconds` param; an effect is priced per clip, so it claims no seconds (no short-clip refund). */
function studioRowSeconds(r: MediaJobRow): number {
  return Number(r.params.seconds) || 0;
}

/** A Studio row's stored params (JSON) read back through its model's schema; unknown model = the raw values, unvalidated. */
function rowParams(r: MediaJobRow): NormalizedParams {
  const entry = MEDIA_CATALOG.byId(r.model_id);
  return entry ? normalize(entry.params, r.params) : (r.params as NormalizedParams);
}

/* ══════════════════════════ 2. poll ══════════════════════════ */

/** A claimed op; `mediaJobId` is set when it lives in `media_jobs` (core path), absent for a `video_ops` row. */
type DueOp = {
  generation_id: string;
  provider: VideoProviderId;
  op_id: string;
  attempts: number;
  errors: number;
  seconds: number;
  mediaJobId?: string;
  /** `media_jobs` rows: the purpose and the catalog model (a Studio row is polled by its model's adapter). */
  purpose?: string;
  modelId?: string;
};

/**
 * `media_jobs.attempts` counts the submit too (`beginMediaJob` writes 1), `video_ops.attempts` only the polls: the poll
 * count that drives the backoff is therefore `attempts - 1`, so both tables back off on the same ladder.
 */
function dueFromMediaJob(r: MediaJobRow): DueOp | null {
  if (!r.generation_id || !r.op_id) return null;
  return {
    generation_id: r.generation_id,
    provider: r.provider as VideoProviderId,
    op_id: r.op_id,
    attempts: Math.max(0, r.attempts - 1),
    errors: r.errors,
    seconds: r.purpose === STUDIO_VIDEO_PURPOSE ? studioRowSeconds(r) : Number(r.params.seconds) || 0,
    mediaJobId: r.id,
    purpose: r.purpose,
    modelId: r.model_id,
  };
}

/**
 * Claims up to `limit` due ops by pushing their `next_poll_at` forward (a lease): another process / tick will not take
 * the same op while this one polls it, and a crashed poller's claim expires by itself. Both tables share the batch:
 * `video_ops` first (it only drains), then `media_jobs` with what is left.
 */
export async function claimDueOps(limit: number = VIDEO_POLL_BATCH): Promise<DueOp[]> {
  const old = await claimDueVideoOps(limit);
  if (old.length >= limit) return old;
  let parked: MediaJobRow[];
  try {
    // «Video» and Studio clips (P3) in ONE claim, oldest-due first whatever the purpose (neither starves the other).
    parked = await claimDueMediaJobs(VIDEO_POLL_PURPOSES, limit - old.length, CLAIM_LEASE_SEC);
  } catch (e) {
    // The old path must not depend on the core's table: `video_ops` keeps draining while media_jobs is broken.
    log("error", "[video] media_jobs could not be claimed -- polling video_ops only this run", { err: e });
    return old;
  }
  return [...old, ...parked.map(dueFromMediaJob).filter((o): o is DueOp => o !== null)];
}

async function claimDueVideoOps(limit: number): Promise<DueOp[]> {
  return query<DueOp>(
    `UPDATE video_ops
        SET next_poll_at = now() + $2::int * interval '1 second'
      WHERE generation_id IN (
              SELECT generation_id FROM video_ops
               WHERE status = 'pending' AND next_poll_at <= now()
               ORDER BY next_poll_at
               LIMIT $1
               FOR UPDATE SKIP LOCKED)
      RETURNING generation_id, provider, op_id, attempts, errors, seconds`,
    [limit, CLAIM_LEASE_SEC],
  );
}

export type PollOutcome = "pending" | "succeeded" | "failed" | "skipped";

async function pastDeadline(op: DueOp): Promise<boolean> {
  if (op.mediaJobId) return mediaJobPastDeadline(op.mediaJobId);
  const row = await queryOne<{ late: boolean }>("SELECT deadline_at <= now() AS late FROM video_ops WHERE generation_id = $1 AND status = 'pending'", [op.generation_id]);
  return row?.late === true;
}

/** A typical clip takes about this long; the bar creeps from 10 to 90 over it (and never past 90 while waiting). */
const EXPECTED_WAIT_SEC = 300;

async function reschedule(op: DueOp, error: string | null): Promise<void> {
  const creep = "LEAST(90, GREATEST(g.progress, 10 + (80 * LEAST(1, EXTRACT(EPOCH FROM now() - v.created_at) / $2::float))::int))";
  if (op.mediaJobId) {
    await query(
      `UPDATE generations g SET progress = ${creep}
         FROM media_jobs v
        WHERE v.id = $1 AND g.id = v.generation_id AND g.status = 'IN_PROGRESS' AND g.locked_by IS NULL`,
      [op.mediaJobId, EXPECTED_WAIT_SEC],
    );
    await rescheduleMediaJob(op.mediaJobId, videoPollDelaySec(op.attempts + 1), error);
    return;
  }
  await query(
    `UPDATE generations g
        SET progress = ${creep}
       FROM video_ops v
      WHERE v.generation_id = $1 AND g.id = v.generation_id AND g.status = 'IN_PROGRESS' AND g.locked_by IS NULL`,
    [op.generation_id, EXPECTED_WAIT_SEC],
  );
  await query(
    `UPDATE video_ops
        SET attempts = attempts + 1,
            errors = errors + CASE WHEN $3::text IS NULL THEN 0 ELSE 1 END,
            next_poll_at = now() + $2::int * interval '1 second',
            last_error = COALESCE($3, last_error)
      WHERE generation_id = $1 AND status = 'pending'`,
    [op.generation_id, videoPollDelaySec(op.attempts + 1), error],
  );
}

/** One poll of one claimed op. Never throws for a provider problem: it reschedules or fails the op. */
/** A provider error that no retry can fix (both adapter shapes: `VideoProviderError` on the old path, `MediaError` on the core). */
const fatalError = (e: unknown): e is VideoProviderError | MediaError => (e instanceof VideoProviderError || e instanceof MediaError) && !e.retryable;

type Polled = Exclude<VideoPollResult, { state: "done" }> | { state: "done"; download(): Promise<Uint8Array> };

/** How one op is polled: the `VideoAdapter` for a `video_ops` row, the core's `MediaAdapter` for a `media_jobs` row. */
/** The Studio adapter of a `studio.video` row: its own model and provider name it (the route that took the submit). */
function studioAdapterOf(op: DueOp, deps: VideoOpsDeps): MediaAdapter | undefined {
  if (!op.mediaJobId || op.purpose !== STUDIO_VIDEO_PURPOSE) return undefined;
  const route = (op.modelId ? MEDIA_CATALOG.byId(op.modelId) : null)?.routes.find((r) => r.provider === op.provider);
  return route ? studioAdaptersOf(deps)[route.adapter] : undefined;
}

/**
 * Gives an op up (deadline / too many transient errors): fail + refund it ONCE (`failVideo`). P4 review M1: a Studio
 * adapter that can cancel (fal) is first asked to drop the op, best effort — a failing cancel never blocks the refund —
 * and the op id + the cancel answer go into `last_error`, so a late provider success can be reconciled against the
 * provider's bill (the row keeps its `op_id` too). Ops without a cancel (Kling, Omni, «Video») fail exactly as before.
 */
async function giveUp(op: DueOp, deps: VideoOpsDeps, message: string, detail: string): Promise<PollOutcome> {
  const adapter = studioAdapterOf(op, deps);
  let note = "";
  if (adapter?.cancel) {
    try {
      note = ` · provider cancel: ${await adapter.cancel(op.op_id, coreDeps(deps))} (op ${op.op_id})`;
    } catch (e) {
      note = ` · provider cancel failed (op ${op.op_id})`;
      log("warn", "[video] provider cancel failed, refunding anyway", { jobId: op.generation_id, provider: op.provider, err: e });
    }
  }
  // A deadline is not a provider error: only the real failure counts towards the owner alert.
  return (await failVideo(op.generation_id, message, `${detail}${note}`, message === VIDEO_FAILED_MESSAGE ? op.provider : undefined)) ? "failed" : "skipped";
}

function pollerFor(op: DueOp, deps: VideoOpsDeps): (() => Promise<Polled>) | null {
  const t = { fetchImpl: deps.fetchImpl };
  if (op.mediaJobId && op.purpose === STUDIO_VIDEO_PURPOSE) {
    const adapter = studioAdapterOf(op, deps);
    if (!adapter?.poll) return null;
    const poll = adapter.poll.bind(adapter);
    return async () => {
      const r = await poll(op.op_id, coreDeps(deps));
      if (r.state !== "done") return r;
      const out = r.outputs[0];
      if (!out) return { state: "failed", message: "the provider finished without an output", safety: false };
      return { state: "done", download: () => adapter.fetchOutput(out, coreDeps(deps)) };
    };
  }
  if (op.mediaJobId) {
    let adapterId: string;
    try {
      adapterId = videoRoute(op.provider).route.adapter;
    } catch {
      return null;
    }
    const adapter = videoMediaAdapters(adaptersOf(deps))[adapterId];
    if (!adapter?.poll) return null;
    const poll = adapter.poll.bind(adapter);
    return async () => {
      const r = await poll(op.op_id, coreDeps(deps));
      if (r.state !== "done") return r;
      const out = r.outputs[0];
      if (!out) return { state: "failed", message: "the provider finished without an output", safety: false };
      return { state: "done", download: () => adapter.fetchOutput(out, coreDeps(deps)) };
    };
  }
  const adapter = adaptersOf(deps)[op.provider];
  if (!adapter) return null;
  return async () => {
    const r = await adapter.poll(op.op_id, t);
    return r.state === "done" ? { state: "done", download: () => adapter.download(r.media, t) } : r;
  };
}

export async function pollOp(op: DueOp, deps: VideoOpsDeps = {}): Promise<PollOutcome> {
  const poller = pollerFor(op, deps);
  if (!poller) {
    // No way to ask the provider (unknown route / adapter): the op must still end at its deadline, refunded -- never
    // stay «skipped» forever. Before the deadline its claim lease simply expires and it is tried again.
    if (await pastDeadline(op)) return (await failVideo(op.generation_id, VIDEO_DEADLINE_MESSAGE, "no poller for this operation")) ? "failed" : "skipped";
    log("warn", "[video] no poller for an operation, it waits for its deadline", { jobId: op.generation_id, provider: op.provider, mediaJobId: op.mediaJobId });
    return "skipped";
  }

  const transient = async (e: unknown): Promise<PollOutcome> => {
    const msg = e instanceof Error ? e.message.slice(0, 300) : "xato";
    if (await pastDeadline(op)) return giveUp(op, deps, VIDEO_DEADLINE_MESSAGE, msg);
    if (op.errors + 1 >= MAX_TRANSIENT_ERRORS) return giveUp(op, deps, VIDEO_FAILED_MESSAGE, msg);
    log("warn", "[video] poll error, will retry", { jobId: op.generation_id, provider: op.provider, attempt: op.attempts + 1, err: e });
    await reschedule(op, msg);
    return "pending";
  };

  let result;
  try {
    result = await poller();
  } catch (e) {
    if (fatalError(e)) {
      log("error", "[video] poll refused", { jobId: op.generation_id, provider: op.provider, status: e.status, err: e });
      return (await failVideo(op.generation_id, e.safety ? VIDEO_SAFETY_MESSAGE : VIDEO_FAILED_MESSAGE, e.message, e.safety ? undefined : op.provider)) ? "failed" : "skipped";
    }
    return transient(e);
  }

  if (result.state === "running") {
    if (await pastDeadline(op)) return giveUp(op, deps, VIDEO_DEADLINE_MESSAGE, "deadline");
    await reschedule(op, null);
    return "pending";
  }
  if (result.state === "failed") {
    log("warn", "[video] provider failed the operation", { jobId: op.generation_id, provider: op.provider, safety: result.safety, detail: result.message.slice(0, 200) });
    return (await failVideo(op.generation_id, result.safety ? VIDEO_SAFETY_MESSAGE : userMessage(result.message, VIDEO_FAILED_MESSAGE), result.message, result.safety ? undefined : op.provider)) ? "failed" : "skipped";
  }

  let bytes: Uint8Array;
  try {
    bytes = await result.download();
  } catch (e) {
    if (fatalError(e)) {
      return (await failVideo(op.generation_id, VIDEO_FAILED_MESSAGE, e.message, op.provider)) ? "failed" : "skipped";
    }
    return transient(e);
  }
  if (!bytes.byteLength || bytes.byteLength > VIDEO_MAX_BYTES || !isMp4(bytes)) {
    return (await failVideo(op.generation_id, VIDEO_FAILED_MESSAGE, "result is not a usable MP4")) ? "failed" : "skipped";
  }
  return (await finalizeVideo(op.generation_id, bytes)) ? "succeeded" : "skipped";
}

export type PollRunOpts = { limit?: number; budgetMs?: number };

/**
 * One `video-poll` run: polls the due ops (at most `limit`, no new op after `budgetMs`). Returns how many ops reached a
 * terminal state. Called by the poll loop (`video-poll-loop.ts`) -- never from the job tick or housekeeping.
 */
export async function pollDueVideoOps(deps: VideoOpsDeps = {}, run: PollRunOpts = {}): Promise<number> {
  const started = Date.now();
  const budgetMs = run.budgetMs ?? VIDEO_POLL_BUDGET_MS;
  const due = await claimDueOps(run.limit ?? VIDEO_POLL_BATCH);
  let done = 0;
  for (const op of due) {
    // Out of time: the claim lease of the rest simply expires (180 s) and the next run takes them.
    if (Date.now() - started >= budgetMs) break;
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

/** The locked pending op of a generation; `mediaJobId` set when it is a `media_jobs` row. */
type LockedOp = { provider: VideoProviderId; seconds: number; mediaJobId: string | null; studio?: { modelId: string; params: NormalizedParams } };

/**
 * Locks the generation's op row (`video_ops`, else its `media_jobs` row) and returns it while it is 'pending'. A job
 * has a row in at most one of the tables (`submitVideoJob` checks both before writing either).
 */
async function lockPendingOp(client: PoolClient, generationId: string): Promise<LockedOp | null> {
  const res = await client.query<{ provider: VideoProviderId; seconds: number; status: string }>(
    "SELECT provider, seconds, status FROM video_ops WHERE generation_id = $1 FOR UPDATE",
    [generationId],
  );
  const row = res.rows[0];
  if (row) return row.status === "pending" ? { provider: row.provider, seconds: Number(row.seconds), mediaJobId: null } : null;
  const m = await lockMediaJobByKey(client, videoMediaKey(generationId));
  if (!m || m.status !== "pending") return null;
  if (m.purpose === STUDIO_VIDEO_PURPOSE) return { provider: m.provider as VideoProviderId, seconds: studioRowSeconds(m), mediaJobId: m.id, studio: { modelId: m.model_id, params: rowParams(m) } };
  return { provider: m.provider as VideoProviderId, seconds: Number(m.params.seconds) || 0, mediaJobId: m.id };
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
      if (op.mediaJobId) await failMediaJobTx(client, op.mediaJobId, "generation is no longer waiting");
      else await client.query("UPDATE video_ops SET status = 'failed', finished_at = now(), last_error = 'generation is no longer waiting' WHERE generation_id = $1", [generationId]);
      return null;
    }
    const delivered = deliveredSeconds(mp4Seconds(bytes), op.seconds);
    const studio = op.studio ? studioResult(row.values_json, op.studio, op.provider, op.seconds, mp4Seconds(bytes)) : null;
    const input = videoInputFromValues(row.values_json);
    const tool = studio ? TOOL_BY_ID["studio-video"] : TOOL_BY_ID.video;
    const actual = studio ? studio.video.seconds : mp4Seconds(bytes) || op.seconds;
    const { usd, priced } = studio ? { usd: studio.usd, priced: true } : videoCost(op.provider, actual);
    const model = studio ? studio.model : videoProviderById(op.provider).short;
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
      sections: [{ id: "options", title: "Sozlamalar", blocks: [{ kind: "p", text: studio ? studio.summary : `${videoProviderById(op.provider).short} · ${input.seconds} soniya · ${input.aspect}` }] }],
      video: studio ? studio.video : { provider: op.provider, prompt: input.prompt, aspect: input.aspect, requestedSeconds: op.seconds, seconds: actual, fromImage: Boolean(input.imageAssetId) },
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
    if (op.mediaJobId) await finishMediaJobTx(client, op.mediaJobId, [{ mime: "video/mp4", size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") }]);
    else await client.query("UPDATE video_ops SET status = 'succeeded', finished_at = now() WHERE generation_id = $1", [generationId]);
    /*
     * A clip shorter than the seconds paid for: the difference is refunded in THIS transaction (the `delivered`
     * mechanism of every tool, but atomic): a crash after the commit can never leave a COMPLETED short clip without its
     * refund, and a failing refund rolls the whole finalisation back (the op stays pending and is retried).
     */
    const ratio = refundRatio(delivered);
    let refunded = false;
    if (delivered && ratio !== null) {
      refunded = await refundInTx(client, String(row.user_id), generationId, `${delivered.want} soniyadan ${delivered.got} soniya yaratildi — farq qaytarildi`, ratio);
    }
    return { delivered, ratio, refunded };
  });
  if (!out) return false;

  log("info", "[video] finished", { jobId: generationId, bytes: bytes.byteLength });
  if (out.delivered) log("warn", "[video] short clip refunded", { jobId: generationId, ratio: out.ratio, refunded: out.refunded });
  return true;
}

/**
 * The result facts of a Studio clip, from the row the submit wrote (catalog model + normalized params): the viewer's
 * `video` block (with the catalog `model` and the `effect` id), the summary line, and the provider cost of what came
 * back (the catalog cost rule at the actual length; an effect is one clip whatever its length).
 */
function studioResult(values: FormValues, s: { modelId: string; params: NormalizedParams }, provider: string, paidSeconds: number, mp4Sec: number) {
  const entry = MEDIA_CATALOG.byId(s.modelId);
  const effect = typeof s.params.effect === "string" ? s.params.effect : "";
  const isEffect = entry ? isEffectEntry(entry) : Boolean(effect);
  const requested = paidSeconds || (isEffect ? STUDIO_EFFECT_SECONDS : 0);
  const seconds = mp4Sec || requested;
  const aspect = typeof s.params.aspect === "string" ? s.params.aspect : "";
  const ids = s.params.imageAssetId;
  const fromImage = Array.isArray(ids) && ids.length > 0;
  const label = entry?.label ?? s.modelId;
  const effectParam = entry?.params.find((p) => p.name === "effect");
  const effectName = effectParam?.type === "enum" ? (effectParam.options.find((o) => o.value === effect)?.label ?? effect) : effect;
  const usd = entry ? Number(costUsd(entry.cost, isEffect ? s.params : { ...s.params, seconds }).toFixed(4)) : 0;
  return {
    model: label,
    usd,
    summary: isEffect
      ? `${label} · ${effectName} · ${seconds} soniya`
      : // P4: a fal model's resolution tier (it sets the price) is part of what was bought.
        `${label} · ${requested} soniya${typeof s.params.resolution === "string" ? ` · ${s.params.resolution}` : ""}${aspect && !fromImage ? ` · ${aspect}` : ""}${s.params.sound === true ? " · ovozli" : ""}`,
    video: {
      provider,
      prompt: isEffect ? "" : String(s.params.prompt ?? values.prompt ?? ""),
      aspect: fromImage ? "" : aspect,
      requestedSeconds: requested,
      seconds,
      fromImage,
      model: s.modelId,
      ...(isEffect ? { effect } : {}),
      ...(typeof s.params.sound === "boolean" ? { sound: s.params.sound } : {}),
    },
  };
}

/** `want` seconds were paid for; a clip more than a second shorter is a shortfall (a longer one is never charged extra). */
export function deliveredSeconds(actual: number, want: number): Delivered | undefined {
  if (!(actual > 0) || !(want > 0) || actual + 1 >= want) return undefined;
  return { got: Math.floor(actual), want, unit: "soniya" };
}

/**
 * Fails a waiting video and refunds it, in ONE transaction guarded by the op row lock (so a deadline firing together
 * with a late success is decided by whoever locks the row first). `message` is what the user sees (Uzbek, safe);
 * `detail` is the raw reason, kept in `video_ops.last_error` / `media_jobs.last_error` for the operator only.
 */
export async function failVideo(generationId: string, message: string, detail: string, provider?: string): Promise<boolean> {
  const safe = userMessage(message, VIDEO_FAILED_MESSAGE);
  const failed = await transaction(async (client) => {
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
    if (op.mediaJobId) await failMediaJobTx(client, op.mediaJobId, detail);
    else await client.query("UPDATE video_ops SET status = 'failed', finished_at = now(), last_error = $2 WHERE generation_id = $1", [generationId, detail.slice(0, 500)]);
    const row = g.rows[0];
    if (row) await refundInTx(client, String(row.user_id), generationId, `Xatolik: ${safe}`.slice(0, 200));
    return true;
  });
  // `provider` = a provider's own failure (the owner alert counts these); after the commit, so it can never undo the refund.
  if (failed && provider) await recordProviderFailure(generationId, { provider, message: detail });
  return failed;
}

/**
 * Waiting videos and how many are in flight (for the admin / health views and tests). Counted on `generations`, so a
 * video waiting in `video_ops` and one waiting in `media_jobs` count alike.
 */
export async function videoInFlight(): Promise<number> {
  const row = await queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM generations WHERE tool_id IN (${VIDEO_TOOLS_SQL}) AND status = 'IN_PROGRESS'`);
  return Number(row?.n ?? 0);
}
