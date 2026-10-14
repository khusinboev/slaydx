import "server-only";
import type { AdmissionLimits } from "./admission";
import { query } from "./db";
import { env } from "./env";
import { getSetting } from "./settings";

/**
 * Effective admission limits = the admin's settings (`queue.*`, env as the default) + the measured mean job
 * duration. `admissionDecision` / `queueEtaSec` stay pure; this module only feeds them.
 *
 * Mean duration: when `queue.mean_service_sec` is 0 (auto) it is the mean of the last `SAMPLE` finished jobs (7 days),
 * each clipped at the p95 so one 10-minute outlier does not double the wait estimate. Too few samples → the old 200 s.
 * Cached 60 s per process (one small query).
 */
const SAMPLE = 200;
const MIN_SAMPLES = 20;
const FALLBACK_SEC = 200;
const FLOOR_SEC = 15;
const CAP_SEC = 600;
const TTL_MS = 60_000;

let cache: { at: number; sec: number } | null = null;

type Row = { mean_sec: string | number | null; n: string | number };

async function measuredMeanSec(): Promise<number> {
  const rows = await query<Row>(
    `WITH recent AS (
       SELECT extract(epoch FROM finished_at - started_at) AS d
         FROM generations
        WHERE status = 'COMPLETED' AND started_at IS NOT NULL AND finished_at IS NOT NULL
          AND finished_at > now() - interval '7 days'
        ORDER BY finished_at DESC LIMIT $1
     ), cut AS (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY d) AS p95 FROM recent)
     SELECT avg(LEAST(d, cut.p95)) AS mean_sec, count(*) AS n FROM recent, cut`,
    [SAMPLE],
  );
  const n = Number(rows[0]?.n ?? 0);
  const mean = Number(rows[0]?.mean_sec);
  if (n < MIN_SAMPLES || !Number.isFinite(mean) || mean <= 0) return FALLBACK_SEC;
  return Math.min(CAP_SEC, Math.max(FLOOR_SEC, Math.round(mean)));
}

/** Measured mean job duration (s); never throws (a failing lookup keeps the previous value or the 200 s fallback). */
export async function autoMeanServiceSec(now: number = Date.now()): Promise<number> {
  if (cache && now - cache.at < TTL_MS) return cache.sec;
  try {
    cache = { at: now, sec: await measuredMeanSec() };
  } catch {
    cache = { at: now, sec: cache?.sec ?? FALLBACK_SEC };
  }
  return cache.sec;
}

/** Test seam. */
export function resetQueueLimitsCache(): void {
  cache = null;
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
