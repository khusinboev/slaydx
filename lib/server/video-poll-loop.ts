import "server-only";
import { Client } from "pg";
import { poolConfig } from "./db";
import { log } from "./log";
import { processIdFor } from "./heartbeat";
import { recordStep } from "./housekeeping-status";
import { VIDEO_POLL_BATCH, VIDEO_POLL_BUDGET_MS, pollDueVideoOps } from "./video-ops";

/**
 * THE `video-poll` LOOP (program-17 item 5): polls the videos that wait for their provider, in its OWN loop under its
 * OWN advisory lock -- the `startBroadcastLoop` pattern.
 *
 * Why not a housekeeping step: housekeeping is awaited inside the worker loop, so a slow provider (a 30 s poll and a 60 s
 * download per op) would hold up job claiming for EVERY tool and stale the alive-file health check. Here a slow
 * provider only delays this loop.
 *
 * One process per cluster polls (the lock); a lost lock is re-acquired by any process. A run claims at most
 * `VIDEO_POLL_BATCH` ops and starts no new op after `VIDEO_POLL_BUDGET_MS`. Safety does not depend on the lock: every
 * op is claimed with a lease on `next_poll_at` and every terminal step is guarded by the op row lock, so a second
 * poller (a lost-lock overlap, a test) can only duplicate a provider GET, never a finalisation or a refund.
 */
export const VIDEO_POLL_LOCK_ID = 727_000_004;

const IDLE_MS = 10_000;
const BUSY_MS = 2_000;
const LOCK_RETRY_MS = 30_000;
const ERROR_RETRY_MS = 15_000;
const STATUS_EVERY_MS = 5 * 60_000;
const LEADER_CHECK_MS = 30_000;

export type VideoPollLoopOptions = {
  /** Test seam: replaces `pollDueVideoOps` (returns the number of ops that reached a terminal state). */
  pass?: () => Promise<number>;
  /** Test seam: no advisory lock. */
  noLock?: boolean;
  idleMs?: number;
  /** Test seam: called after every run. */
  onRun?: (finished: number) => void;
};

export type VideoPollLoop = { stop(): Promise<void> };

export function startVideoPollLoop(opts: VideoPollLoopOptions = {}): VideoPollLoop {
  let stopped = false;
  let wake: (() => void) | null = null;
  let leader: Client | null = null;
  let leaderCheckedAt = 0;
  let handled = 0;
  let statusAt = Date.now();
  const processId = processIdFor("worker");
  const pass = opts.pass ?? (() => pollDueVideoOps({}, { limit: VIDEO_POLL_BATCH, budgetMs: VIDEO_POLL_BUDGET_MS }));

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(done, ms);
      t.unref?.();
      function done() {
        clearTimeout(t);
        wake = null;
        resolve();
      }
      wake = done;
    });

  async function dropLeader(): Promise<void> {
    const c = leader;
    leader = null;
    await c?.end().catch(() => undefined);
  }

  async function ensureLeader(): Promise<boolean> {
    if (opts.noLock) return true;
    if (leader && Date.now() - leaderCheckedAt >= LEADER_CHECK_MS) {
      leaderCheckedAt = Date.now();
      try {
        const r = await leader.query("SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND classid = 0 AND objid = $1 AND granted", [VIDEO_POLL_LOCK_ID]);
        if (r.rows.length === 0) await dropLeader();
      } catch {
        await dropLeader();
      }
    }
    if (leader) return true;
    const c = new Client(poolConfig());
    c.on("error", (err) => log("warn", "[video-poll] qulf ulanishi uzildi", { err }));
    await c.connect();
    let got = false;
    try {
      const r = await c.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [VIDEO_POLL_LOCK_ID]);
      got = r.rows[0]?.ok === true;
    } finally {
      if (!got) await c.end().catch(() => undefined);
    }
    if (!got) return false;
    leader = c;
    leaderCheckedAt = Date.now();
    log("info", "[video-poll] so‘rov yetakchisi — shu process");
    return true;
  }

  const running = (async () => {
    while (!stopped) {
      try {
        if (!(await ensureLeader())) {
          await wait(LOCK_RETRY_MS);
          continue;
        }
        const finished = await pass();
        handled += finished;
        opts.onRun?.(finished);
        if (Date.now() - statusAt >= STATUS_EVERY_MS) {
          statusAt = Date.now();
          const n = handled;
          handled = 0;
          await recordStep("video-poll", processId, async () => n).catch(() => undefined);
        }
        await wait(finished > 0 ? BUSY_MS : (opts.idleMs ?? IDLE_MS));
      } catch (e) {
        log("error", "[video-poll] sikl xatosi", { err: e });
        await dropLeader();
        await wait(ERROR_RETRY_MS);
      }
    }
    await dropLeader();
  })();

  return {
    async stop() {
      stopped = true;
      wake?.();
      await running;
    },
  };
}
