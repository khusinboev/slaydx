import "server-only";
import { hostname } from "node:os";
import { snapshotBreakers } from "../generation/llm/breaker";
import { snapshotLimiters } from "../generation/llm/limiter";
import { query } from "./db";
import { toJsonb } from "./jsonb";
import { log } from "./log";

/**
 * Process heartbeats for the admin system page (docs/admin/02-plan.md §5.2,
 * §6.11; 01-analysis §4.7/§4.8 R5).
 *
 * Every web and worker process upserts one `process_heartbeats` row every
 * 30 s: running jobs, concurrency and a read-only snapshot of its in-memory
 * provider breakers and limiters. Liveness used to be a file inside each
 * worker container and breaker state was visible only in that process's logs.
 *
 * Fire-and-forget: the timer is unref'd (it never keeps a process alive), a
 * beat never throws, and a failing write logs at most one warning per minute.
 * Rows older than a day are removed by the worker step `purgeHeartbeats`.
 */

export type ProcessRole = "web" | "worker";

export type HeartbeatOptions = {
  role: ProcessRole;
  /** Job slots of this process (0 for a web process without an inline worker). */
  concurrency: number;
  /** Jobs running right now. */
  getRunning: () => number;
  /** Test seam: beat interval (default 30 s). */
  intervalMs?: number;
};

export const HEARTBEAT_INTERVAL_MS = 30_000;
const WARN_EVERY_MS = 60_000;

/** Host name as stored (Docker: the container id); bounded and printable. */
export function heartbeatHostname(): string {
  return (hostname() || "unknown").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64) || "unknown";
}

/** `<role>@<hostname>:<pid>` — the id used by heartbeats, the error log and housekeeping status. */
export function processIdFor(role: ProcessRole): string {
  return `${role}@${heartbeatHostname()}:${process.pid}`;
}

type Beat = {
  timer: ReturnType<typeof setInterval>;
  opts: HeartbeatOptions;
  startedAt: Date;
  inflight: Promise<void> | null;
  lastWarnAt: number;
};

// On globalThis: a second copy of this module (Next bundles instrumentation
// separately, dev reloads) must not start a second timer for the same role.
const host = globalThis as typeof globalThis & { __slaydxHeartbeats?: Map<ProcessRole, Beat> };

function beats(): Map<ProcessRole, Beat> {
  return (host.__slaydxHeartbeats ??= new Map());
}

function safeInt(fn: () => number): number {
  try {
    const n = Math.round(Number(fn()));
    return Number.isFinite(n) ? Math.max(0, Math.min(n, 1_000_000)) : 0;
  } catch {
    return 0;
  }
}

function safeSnapshot<T>(fn: () => T[]): T[] {
  try {
    return fn();
  } catch {
    return [];
  }
}

/** Writes one heartbeat row. Never throws; resolves when the write settled. */
export async function writeHeartbeat(opts: HeartbeatOptions, startedAt: Date): Promise<void> {
  const processId = processIdFor(opts.role);
  await query(
    `INSERT INTO process_heartbeats (process_id, role, hostname, started_at, last_seen_at, running, concurrency, breakers, limiters)
     VALUES ($1, $2, $3, $4, now(), $5, $6, $7::jsonb, $8::jsonb)
     ON CONFLICT (process_id) DO UPDATE SET
       role = EXCLUDED.role,
       hostname = EXCLUDED.hostname,
       started_at = EXCLUDED.started_at,
       last_seen_at = now(),
       running = EXCLUDED.running,
       concurrency = EXCLUDED.concurrency,
       breakers = EXCLUDED.breakers,
       limiters = EXCLUDED.limiters`,
    [
      processId,
      opts.role,
      heartbeatHostname(),
      startedAt,
      safeInt(opts.getRunning),
      safeInt(() => opts.concurrency),
      toJsonb(safeSnapshot(snapshotBreakers)),
      toJsonb(safeSnapshot(snapshotLimiters)),
    ],
  );
}

function beat(b: Beat): Promise<void> {
  // A slow DB must not pile up writes: skip while the previous one is pending.
  if (b.inflight) return b.inflight;
  const p = writeHeartbeat(b.opts, b.startedAt).catch((err: unknown) => {
    const now = Date.now();
    if (now - b.lastWarnAt >= WARN_EVERY_MS) {
      b.lastWarnAt = now;
      log("warn", "[heartbeat] yozilmadi", { role: b.opts.role, err });
    }
  });
  b.inflight = p;
  void p.finally(() => {
    if (b.inflight === p) b.inflight = null;
  });
  return p;
}

/**
 * Starts the heartbeat of `role` in this process (first beat right away). A
 * second call for a running role only refreshes its options. Never throws.
 */
export function startHeartbeat(opts: HeartbeatOptions): void {
  try {
    const existing = beats().get(opts.role);
    if (existing) {
      existing.opts = opts;
      return;
    }
    const interval = Math.max(10, opts.intervalMs ?? HEARTBEAT_INTERVAL_MS);
    const b: Beat = {
      opts,
      startedAt: new Date(),
      inflight: null,
      lastWarnAt: -Infinity,
      timer: setInterval(() => void beat(b), interval),
    };
    b.timer.unref?.();
    beats().set(opts.role, b);
    void beat(b);
  } catch (err) {
    log("warn", "[heartbeat] ishga tushmadi", { role: opts.role, err });
  }
}

/** Stops one role's heartbeat, or every heartbeat of this process. The row stays (it goes stale). */
export function stopHeartbeat(role?: ProcessRole): void {
  for (const [r, b] of beats()) {
    if (role && r !== role) continue;
    clearInterval(b.timer);
    beats().delete(r);
  }
}

/** Test seam: beats `role` now and resolves when the write settled (no-op when not started). */
export async function beatNow(role: ProcessRole): Promise<void> {
  const b = beats().get(role);
  if (b) await beat(b);
}
