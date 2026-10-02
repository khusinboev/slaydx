import "server-only";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { isStale } from "./admin-heartbeat";
import { query, transaction } from "./db";
import { assertRuntimeConfig, runtimeWarnings } from "./env";

/**
 * System health for the admin panel (docs/admin/02-plan.md §6.11, §7.1 S15,
 * §10 T12).
 *
 * One read-only snapshot: DB reachability + latency, migrations, the job
 * queue, process heartbeats (staleness by the same rule as the AI screen,
 * `admin-heartbeat.ts`), housekeeping step status and configuration
 * problems/warnings. Config is reported as message text only: no env value,
 * key or secret ever leaves this module (T12).
 */

export type SystemProcess = {
  process: string;
  role: "web" | "worker";
  hostname: string;
  startedAt: string;
  lastSeenAt: string;
  running: number;
  concurrency: number;
  stale: boolean;
};

export type SystemStep = {
  step: string;
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  lastRows: number | null;
  runs: number;
  failures: number;
  lastProcess: string | null;
};

export type SystemStatus = {
  db: {
    ok: boolean;
    latencyMs: number | null;
    migrations: {
      /** Rows in `schema_migrations`. */
      applied: number;
      /** Migration files shipped with this build; `null` when the folder cannot be read. */
      latest: number | null;
      /** Name of the newest applied migration. */
      lastApplied: string | null;
    };
  };
  queue: { queued: number; running: number; oldestQueuedSec: number | null };
  processes: SystemProcess[];
  housekeeping: SystemStep[];
  config: { problems: string[]; warnings: string[] };
  version: string;
  nodeEnv: "production" | "development" | "test" | "unknown";
};

const STATEMENT_TIMEOUT_SEC = 5;
const MAX_PROCESSES = 100;
const MAX_STEPS = 100;
const MAX_CONFIG_MESSAGES = 50;
const MAX_CONFIG_CHARS = 400;

/** pg's `statement_timeout` cancel (57014) becomes a clear 503 instead of a 500. */
export function mapTimeout(e: unknown): never {
  if ((e as { code?: string } | null)?.code === "57014") {
    throw new ApiError("So'rov juda uzoq davom etdi. Birozdan keyin qayta urinib ko'ring.", 503, { code: "timeout" });
  }
  throw e;
}

/** Read-only transaction with a statement timeout: admin reads never hold the pool for long (plan §9). */
export async function readOnlyTx<T>(fn: (client: PoolClient) => Promise<T>, timeoutSec: 5 | 10 = STATEMENT_TIMEOUT_SEC): Promise<T> {
  try {
    return await transaction(async (client) => {
      await client.query("SET TRANSACTION READ ONLY");
      // The literal is one of two constants (type-checked), never user input.
      await client.query(`SET LOCAL statement_timeout = '${timeoutSec}s'`);
      return fn(client);
    });
  } catch (e) {
    return mapTimeout(e);
  }
}

// package.json and the migrations folder do not change while the process runs.
let versionCache: string | null = null;
let migrationFilesCache: number | null | undefined;

export function appVersion(): string {
  if (versionCache !== null) return versionCache;
  try {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version?: unknown };
    versionCache = typeof pkg.version === "string" && pkg.version.length <= 64 ? pkg.version : "noma'lum";
  } catch {
    versionCache = "noma'lum";
  }
  return versionCache;
}

/** Number of `*.sql` files next to the app (`migrate()` reads the same folder). */
export function migrationFileCount(): number | null {
  if (migrationFilesCache !== undefined) return migrationFilesCache;
  try {
    migrationFilesCache = readdirSync(path.join(process.cwd(), "lib", "server", "migrations")).filter((f) => f.endsWith(".sql")).length;
  } catch {
    migrationFilesCache = null;
  }
  return migrationFilesCache;
}

/**
 * Config messages are written for operators and name env variables, which is
 * fine. One warning (`FREE_LLM_DISABLED="..."`) echoes the raw value, so any
 * quoted value after `=` is blanked: the contract is "message text only,
 * never env values".
 */
export function safeConfigMessage(message: string): string {
  return message.replace(/(=\s*)"[^"]*"/g, '$1"…"').replace(/(=\s*)'[^']*'/g, "$1'…'").slice(0, MAX_CONFIG_CHARS);
}

function configReport(): { problems: string[]; warnings: string[] } {
  const clean = (list: string[]) => list.slice(0, MAX_CONFIG_MESSAGES).map(safeConfigMessage);
  return { problems: clean(assertRuntimeConfig()), warnings: clean(runtimeWarnings()) };
}

function nodeEnv(): SystemStatus["nodeEnv"] {
  const v = process.env.NODE_ENV;
  return v === "production" || v === "development" || v === "test" ? v : "unknown";
}

const iso = (v: Date | string | null): string | null => (v === null ? null : new Date(v).toISOString());

type HeartbeatRow = {
  process_id: string;
  role: "web" | "worker";
  hostname: string;
  started_at: Date;
  last_seen_at: Date;
  running: number;
  concurrency: number;
};

type StepRow = {
  step: string;
  last_run_at: Date | null;
  last_ok_at: Date | null;
  last_error_at: Date | null;
  last_error: string | null;
  last_rows: number | null;
  runs: string;
  failures: string;
  last_process: string | null;
};

/** Everything S15 shows, in one response. `now` is a test seam for the staleness rule. */
export async function getSystemStatus(now: number = Date.now()): Promise<SystemStatus> {
  // Latency of the cheapest possible round trip (pool checkout included, as a real request pays it).
  let ok = true;
  let latencyMs: number | null = null;
  const t0 = performance.now();
  try {
    await query("SELECT 1");
    latencyMs = Math.max(0, Math.round(performance.now() - t0));
  } catch {
    ok = false;
  }

  const data = await readOnlyTx(async (client) => {
    const migrations = await client.query<{ applied: string; last_applied: string | null }>(
      `SELECT count(*)::text AS applied, max(name) AS last_applied FROM schema_migrations`,
    );
    // Each count matches one partial index (`generations_queued_created_idx`, `generations_running_user_idx`).
    const queue = await client.query<{ queued: string; running: string; oldest: string | null }>(
      `SELECT (SELECT count(*) FROM generations WHERE status = 'QUEUED')::text AS queued,
              (SELECT count(*) FROM generations WHERE status = 'IN_PROGRESS')::text AS running,
              (SELECT floor(extract(epoch FROM now() - min(created_at)))::text FROM generations WHERE status = 'QUEUED') AS oldest`,
    );
    const processes = await client.query<HeartbeatRow>(
      `SELECT process_id, role, hostname, started_at, last_seen_at, running, concurrency
         FROM process_heartbeats
        ORDER BY role DESC, last_seen_at DESC, process_id
        LIMIT ${MAX_PROCESSES}`,
    );
    const steps = await client.query<StepRow>(
      `SELECT step, last_run_at, last_ok_at, last_error_at, last_error, last_rows,
              runs::text AS runs, failures::text AS failures, last_process
         FROM housekeeping_status
        ORDER BY step
        LIMIT ${MAX_STEPS}`,
    );
    return { migrations: migrations.rows[0], queue: queue.rows[0], processes: processes.rows, steps: steps.rows };
  });

  const applied = Number(data.migrations?.applied ?? 0);
  return {
    db: {
      ok,
      latencyMs,
      migrations: { applied, latest: migrationFileCount(), lastApplied: data.migrations?.last_applied ?? null },
    },
    queue: {
      queued: Number(data.queue?.queued ?? 0),
      running: Number(data.queue?.running ?? 0),
      oldestQueuedSec: data.queue?.oldest == null ? null : Math.max(0, Number(data.queue.oldest)),
    },
    processes: data.processes.map((p) => ({
      process: p.process_id,
      role: p.role,
      hostname: p.hostname,
      startedAt: iso(p.started_at) as string,
      lastSeenAt: iso(p.last_seen_at) as string,
      running: p.running,
      concurrency: p.concurrency,
      stale: isStale(p.last_seen_at, now),
    })),
    housekeeping: data.steps.map((s) => ({
      step: s.step,
      lastRunAt: iso(s.last_run_at),
      lastOkAt: iso(s.last_ok_at),
      lastErrorAt: iso(s.last_error_at),
      lastError: s.last_error,
      lastRows: s.last_rows,
      runs: Number(s.runs),
      failures: Number(s.failures),
      lastProcess: s.last_process,
    })),
    config: configReport(),
    version: appVersion(),
    nodeEnv: nodeEnv(),
  };
}
