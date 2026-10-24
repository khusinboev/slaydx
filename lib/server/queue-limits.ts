import "server-only";
import type { AdmissionLimits } from "./admission";
import { query } from "./db";
import { env } from "./env";
import { getSetting } from "./settings";

/**
 * Effective admission limits = the admin's settings (`queue.*`, env as the default) + the measured mean job
 * duration. `admissionDecision` / `queueEtaSec` stay pure; this module only feeds them.
 *
 * Mean duration: when `queue.mean_service_sec` is 0 (auto) it is the mean of the last `SAMPLE` finished jobs (7 days, videos excluded),
 * each clipped at `CAP_SEC` so one runaway job does not skew the wait estimate. It is NOT clipped at a percentile: the slow tail
 * holds most of the slot-seconds, and a p95 clip would hide exactly that load from admission. Too few samples → 200 s.
 * Cached 60 s per process, one query at a time (single-flight). Known limit: a MEAN assumes the queued tool mix equals the
 * recently finished mix; per-tool means weighted by the queued rows would be sharper (follow-up).
 */
const SAMPLE = 200;
const MIN_SAMPLES = 20;
const FALLBACK_SEC = 200;
const FLOOR_SEC = 15;
const CAP_SEC = 600;
const TTL_MS = 60_000;

// `globalThis` like `settings.ts`: Next dev can load a second module instance.
type Holder = { cache: { at: number; sec: number } | null; inflight: Promise<number> | null };
const g = globalThis as typeof globalThis & { __slaydxQueueLimits?: Holder };
const holder: Holder = (g.__slaydxQueueLimits ??= { cache: null, inflight: null });

type Row = { mean_sec: string | number | null; n: string | number };

async function measuredMeanSec(): Promise<number> {
  const rows = await query<Row>(
    // `created_at` bound keeps `generations_status_created_idx` usable (created_at <= finished_at) as history grows.
    `WITH recent AS (
       SELECT extract(epoch FROM finished_at - started_at) AS d
         FROM generations
        WHERE status = 'COMPLETED' AND started_at IS NOT NULL AND finished_at IS NOT NULL
          -- A video spends minutes WAITING for its provider without holding a worker slot (video-ops.ts): its wall time
          -- says nothing about the load of the slots and would inflate every other tool's queue estimate.
          AND tool_id <> 'video'
          AND created_at > now() - interval '8 days' AND finished_at > now() - interval '7 days'
        ORDER BY finished_at DESC LIMIT $1
     )
     SELECT avg(LEAST(d, $2::float)) AS mean_sec, count(*) AS n FROM recent`,
    [SAMPLE, CAP_SEC],
  );
  const n = Number(rows[0]?.n ?? 0);
  const mean = Number(rows[0]?.mean_sec);
  if (n < MIN_SAMPLES || !Number.isFinite(mean) || mean <= 0) return FALLBACK_SEC;
  return Math.min(CAP_SEC, Math.max(FLOOR_SEC, Math.round(mean)));
}

/** Measured mean job duration (s); never throws (a failing lookup keeps the previous value or the 200 s fallback). */
export async function autoMeanServiceSec(now: number = Date.now()): Promise<number> {
  const c = holder.cache;
  if (c && now - c.at < TTL_MS) return c.sec;
  holder.inflight ??= measuredMeanSec()
    .catch(() => holder.cache?.sec ?? FALLBACK_SEC)
    .then((sec) => {
      holder.cache = { at: now, sec };
      return sec;
    })
    .finally(() => {
      holder.inflight = null;
    });
  return holder.inflight;
}

/** Test seam. */
export function resetQueueLimitsCache(): void {
  holder.cache = null;
  holder.inflight = null;
}

export type EffectiveQueueLimits = AdmissionLimits & { ttlSec: number };

export async function queueLimits(): Promise<EffectiveQueueLimits> {
  const [maxWaitSec, userMaxInflight, totalSlots, meanSetting] = await Promise.all([
    getSetting("queue.max_wait_sec"),
    getSetting("queue.user_max_inflight"),
    getSetting("queue.total_slots"),
    getSetting("queue.mean_service_sec"),
  ]);
  return {
    maxWaitSec,
    userMaxInflight,
    totalSlots,
    meanServiceSec: meanSetting > 0 ? meanSetting : await autoMeanServiceSec(),
    ttlSec: env.queue.ttlSec,
  };
}
