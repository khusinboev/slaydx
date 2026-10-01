import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { query } from "./db";
import { processIdFor, type ProcessRole } from "./heartbeat";
import { getErrorSink, log, setErrorSink, type ErrorSink, type LogRecord } from "./log";

/**
 * Persisted error log for the admin panel (docs/admin/02-plan.md §5.2, §6.11).
 *
 * `log()` hands every "error" record (and "warn" when enabled) to this sink.
 * The record is already redacted by `log.ts`; the sink groups repeats by a
 * fingerprint and upserts `error_log` (open row per fingerprint: count + 1,
 * last_seen_at, latest request/path/user/job). Errors used to exist only in
 * per-container stdout.
 *
 * Safety (this runs on every error path of a live product):
 *   • never throws and never rejects — `log.ts` also swallows, twice;
 *   • at most `maxPerMinute` (60) writes per minute per process; the rest are
 *     counted as dropped and summarised in one warning when the window turns;
 *   • after a failed write (DB down) it pauses for 30 s instead of hammering a
 *     sick pool, counting the skipped records as dropped;
 *   • re-entrancy guard: anything logged while the sink itself works (for
 *     example a pool error raised by its own query) is ignored, so a DB failure
 *     can never feed itself;
 *   • a cap on concurrent writes, so a slow DB cannot pile up promises.
 */

export type ErrorLogRow = {
  fingerprint: string;
  level: "error" | "warn";
  scope: string;
  message: string;
  stack: string | null;
  requestId: string | null;
  userId: string | null;
  jobId: string | null;
  path: string | null;
  process: string;
};

export type ErrorSinkStats = { written: number; dropped: number; failed: number; ignored: number };

export type ErrorSinkOptions = {
  processId: string;
  /** Writes per rolling minute window (default 60). */
  maxPerMinute?: number;
  /** Pause after a failed write (default 30 s). */
  failurePauseMs?: number;
  /** Test seam: the DB write (default: upsert into `error_log`). */
  write?: (row: ErrorLogRow) => Promise<void>;
  /** Test seam: clock. */
  now?: () => number;
};

export const MAX_MESSAGE = 2_048;
export const MAX_STACK = 8_192;
const MAX_INFLIGHT = 8;
const WINDOW_MS = 60_000;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const HEX_PREFIXED_RE = /\b0x[0-9a-f]+\b/gi;
/** Hex runs of 8+ that contain a digit (ids, hashes) — plain words stay. */
const HEX_RUN_RE = /\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi;
const NUMBER_RE = /\d+/g;

/** Message with volatile parts (uuids, hex ids, numbers) replaced, for grouping. */
export function normalizeMessage(message: string): string {
  return message
    .replace(UUID_RE, "<uuid>")
    .replace(HEX_PREFIXED_RE, "<hex>")
    .replace(HEX_RUN_RE, "<hex>")
    .replace(NUMBER_RE, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

/** sha1(scope + normalised message + error name). */
export function errorFingerprint(scope: string, message: string, errName: string): string {
  return createHash("sha1").update(`${scope}\n${normalizeMessage(message)}\n${errName}`).digest("hex");
}

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v !== "" ? v.slice(0, max) : null;
}

/** Builds the `error_log` row of one log record (pure; exported for tests). */
export function rowFromRecord(record: LogRecord, processId: string): ErrorLogRow {
  const level = record.level === "warn" ? "warn" : "error";
  const msg = typeof record.msg === "string" ? record.msg : "";
  const err = record.err && typeof record.err === "object" ? (record.err as Record<string, unknown>) : null;
  const errMessage = str(err?.message, MAX_MESSAGE) ?? "";
  const errName = str(err?.name, 100) ?? "";
  const scope =
    str(record.scope, 64) ??
    // House style: "[area] message" — the bracket is the scope.
    (/^\[([^\]\n]{1,64})\]/.exec(msg)?.[1] ?? "");
  const message = (errMessage ? `${msg}: ${errMessage}` : msg).slice(0, MAX_MESSAGE) || "(bo'sh)";
  const userId = typeof record.userId === "string" && /^\d{1,18}$/.test(record.userId) ? record.userId : null;
  return {
    fingerprint: errorFingerprint(scope, errMessage ? `${msg}: ${errMessage}` : msg, errName),
    level,
    scope,
    message,
    stack: str(err?.stack, MAX_STACK),
    requestId: str(record.reqId, 128),
    userId,
    jobId: str(record.jobId, 128),
    path: str(record.path, 1_024),
    process: processId,
  };
}

/** Upserts one row: a new open fingerprint inserts, a repeat bumps the open row. */
export async function upsertErrorLog(row: ErrorLogRow): Promise<void> {
  await query(
    `INSERT INTO error_log AS e
       (fingerprint, level, scope, message, stack, request_id, user_id, job_id, path, process)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (fingerprint) WHERE resolved_at IS NULL DO UPDATE SET
       count        = LEAST(e.count, 2147483646) + 1,
       last_seen_at = now(),
       level        = CASE WHEN e.level = 'error' OR EXCLUDED.level = 'error' THEN 'error' ELSE 'warn' END,
       message      = EXCLUDED.message,
       stack        = COALESCE(EXCLUDED.stack, e.stack),
       request_id   = EXCLUDED.request_id,
       user_id      = EXCLUDED.user_id,
       job_id       = EXCLUDED.job_id,
       path         = EXCLUDED.path,
       process      = EXCLUDED.process`,
    [row.fingerprint, row.level, row.scope, row.message, row.stack, row.requestId, row.userId, row.jobId, row.path, row.process],
  );
}

/** Set while the sink works; a record logged inside that async context is ignored. */
const busy = new AsyncLocalStorage<true>();

export type ErrorSinkHandle = {
  sink: ErrorSink;
  stats(): ErrorSinkStats;
  /** Resolves when every write started so far has settled. */
  flush(): Promise<void>;
};

/** Creates a sink (not installed). `registerErrorSink` installs one for the process. */
export function createErrorSink(opts: ErrorSinkOptions): ErrorSinkHandle {
  const max = Math.max(1, opts.maxPerMinute ?? 60);
  const pauseMs = Math.max(0, opts.failurePauseMs ?? 30_000);
  const write = opts.write ?? upsertErrorLog;
  const now = opts.now ?? Date.now;
  const stats: ErrorSinkStats = { written: 0, dropped: 0, failed: 0, ignored: 0 };
  const pending = new Set<Promise<void>>();
  let windowStart = -Infinity;
  let windowCount = 0;
  let windowDropped = 0;
  let pausedUntil = -Infinity;

  const drop = () => {
    stats.dropped++;
    windowDropped++;
  };

  const sink: ErrorSink = (record) => {
    try {
      if (busy.getStore()) {
        stats.ignored++;
        return;
      }
      const t = now();
      if (t - windowStart >= WINDOW_MS) {
        const lost = windowDropped;
        windowStart = t;
        windowCount = 0;
        windowDropped = 0;
        // Logged inside the guard: with "warn" enabled it must not loop back.
        if (lost > 0) busy.run(true, () => log("warn", "[error-sink] xato yozuvlari tashlandi (chegara yoki baza)", { dropped: lost }));
      }
      if (t < pausedUntil || windowCount >= max || pending.size >= MAX_INFLIGHT) {
        drop();
        return;
      }
      windowCount++;
      const p = busy.run(true, async () => {
        try {
          await write(rowFromRecord(record, opts.processId));
          stats.written++;
        } catch (err) {
          stats.failed++;
          pausedUntil = now() + pauseMs;
          // A warning (not an error), inside the guard: it can never re-enter.
          log("warn", "[error-sink] xato jurnalga yozilmadi — yozish vaqtincha to'xtatildi", { pauseMs, err });
        }
      });
      pending.add(p);
      void p.finally(() => pending.delete(p));
    } catch {
      // Never surface anything from the sink.
    }
  };

  return {
    sink,
    stats: () => ({ ...stats }),
    async flush() {
      while (pending.size) await Promise.all([...pending]);
    },
  };
}

/**
 * Installs the persisted error sink for this process (`instrumentation.ts`
 * for web, `runWorkerProcess` for a worker). The first registration wins: an
 * inline worker inside the web process keeps the web sink. Returns whether
 * this call installed it. Never throws.
 */
export function registerErrorSink(role: ProcessRole, opts: { warn?: boolean } = {}): boolean {
  try {
    if (getErrorSink()) return false;
    const handle = createErrorSink({ processId: processIdFor(role) });
    setErrorSink(handle.sink, { warn: opts.warn === true });
    return true;
  } catch {
    return false;
  }
}
