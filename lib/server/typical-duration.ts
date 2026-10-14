import "server-only";
import { query } from "./db";

/**
 * Median wall time (seconds) a finished job of each tool took, for the running panel's
 * "taxminan N daqiqa qoldi". One grouped query per `TTL_MS`, shared by every poll, so the
 * 1.2 s result-page polling adds no DB load. Tools with fewer than `MIN_SAMPLES` finished jobs
 * in the window are absent — the UI then shows no estimate rather than a made-up one.
 */
const TTL_MS = 10 * 60_000;
const WINDOW_DAYS = 30;
export const MIN_SAMPLES = 5;

type Row = { tool_id: string; median_sec: string | number | null };

let cache: { at: number; byTool: Map<string, number> } | null = null;
let inflight: Promise<void> | null = null;

async function load(): Promise<Map<string, number>> {
  const rows = await query<Row>(
    `SELECT tool_id,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM finished_at - started_at)) AS median_sec
       FROM generations
      WHERE status = 'COMPLETED' AND started_at IS NOT NULL AND finished_at IS NOT NULL
        AND finished_at > now() - make_interval(days => $1)
      GROUP BY tool_id
     HAVING count(*) >= $2`,
    [WINDOW_DAYS, MIN_SAMPLES],
  );
  const byTool = new Map<string, number>();
  for (const r of rows) {
    const sec = Number(r.median_sec);
    if (Number.isFinite(sec) && sec > 0) byTool.set(r.tool_id, Math.round(sec));
  }
  return byTool;
}

/** A failed refresh is retried after this, not on every poll. */
const RETRY_MS = 60_000;

function refresh(now: number): Promise<void> {
  inflight ??= load()
    .then((byTool) => {
      cache = { at: now, byTool };
    })
    .catch(() => {
      // Keep serving the previous medians (or none) and back off — a slow/failing DB must not turn the 1.2 s poll into a query storm.
      cache = { at: now - TTL_MS + RETRY_MS, byTool: cache?.byTool ?? new Map() };
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Median seconds for `toolId`, or `null` (too few samples / lookup failed — never throws).
 * Stale-while-revalidate: after the first load an expired cache is served immediately and refreshed in the background,
 * so no poll waits for the grouped query.
 */
export async function typicalDurationSec(toolId: string, now: number = Date.now()): Promise<number | null> {
  try {
    if (!cache) await refresh(now);
    else if (now - cache.at > TTL_MS) void refresh(now);
    return cache?.byTool.get(toolId) ?? null;
  } catch {
    return null;
  }
}

/** Test seam. */
export function resetTypicalDurationCache(): void {
  cache = null;
  inflight = null;
}
