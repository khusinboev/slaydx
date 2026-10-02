import "server-only";
import { HEARTBEAT_INTERVAL_MS } from "./heartbeat";

/**
 * The one staleness rule for `process_heartbeats` rows, shared by the AI
 * provider screen and the system page (docs/admin/02-plan.md §6.11, S11, S15).
 *
 * Every web and worker process writes a row every `HEARTBEAT_INTERVAL_MS`
 * (30 s, `heartbeat.ts`). A row is stale after three missed beats (90 s): one
 * late beat (a slow DB write is skipped, not queued) must not flag a healthy
 * process, while a dead one shows within two minutes.
 */
export const HEARTBEAT_STALE_SEC = (HEARTBEAT_INTERVAL_MS * 3) / 1000;

/** True when `lastSeenAt` is older than `HEARTBEAT_STALE_SEC` at `now` (an unparsable date counts as stale). */
export function isStale(lastSeenAt: Date | string | number, now: number = Date.now()): boolean {
  const t = lastSeenAt instanceof Date ? lastSeenAt.getTime() : new Date(lastSeenAt).getTime();
  return !Number.isFinite(t) || now - t > HEARTBEAT_STALE_SEC * 1000;
}
