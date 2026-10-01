import "server-only";
import { query } from "./db";
import { log, redact } from "./log";

/**
 * Housekeeping step status for the admin system page (docs/admin/02-plan.md
 * §5.2, §6.11; 01-analysis §4.7: results used to be visible in logs only).
 *
 * `recordStep` runs a step exactly as before — same result, same exception,
 * same timing of the step itself — and afterwards upserts one
 * `housekeeping_status` row (runs, failures, last run/ok/error, rows affected,
 * which process ran it). The status write is fire-and-forget: it never delays
 * the step's caller, never throws, and a failing write logs at most one warning
 * per minute.
 */

export type StepOutcome = {
  ok: boolean;
  /** Rows the step reported (a number, or `{ rows }`), when it reported any. */
  rows: number | null;
  /** Short, already-redacted error text of a failed run. */
  error: string | null;
};

const MAX_ERROR = 1_000;
const MAX_STEP = 120;
const WARN_EVERY_MS = 60_000;
let lastWarnAt = -Infinity;

// On globalThis so a test (or a second bundle copy of this module) can flush every write.
const pending: Set<Promise<void>> = ((globalThis as typeof globalThis & { __slaydxStepStatusPending?: Set<Promise<void>> }).__slaydxStepStatusPending ??= new Set());

/**
 * Rows affected, when the step returned a number, an object with a numeric
 * `rows`, or an array of affected ids (e.g. `expireQueuedJobs`).
 */
export function rowsOf(result: unknown): number | null {
  const n =
    typeof result === "number"
      ? result
      : Array.isArray(result)
        ? result.length
        : result && typeof result === "object" && typeof (result as { rows?: unknown }).rows === "number"
          ? (result as { rows: number }).rows
          : null;
  if (n === null || !Number.isFinite(n)) return null;
  // INT column: clamp instead of failing the status write.
  return Math.max(-2_147_483_648, Math.min(2_147_483_647, Math.trunc(n)));
}

function errorText(e: unknown): string {
  let text: string;
  try {
    text = e instanceof Error ? `${e.name && e.name !== "Error" ? `${e.name}: ` : ""}${e.message}` : String(e);
  } catch {
    text = "[unprintable]";
  }
  return redact(text).slice(0, MAX_ERROR);
}

/** Upserts the status row of `step`. Throws on DB errors (callers swallow). */
export async function writeStepStatus(step: string, processId: string, outcome: StepOutcome): Promise<void> {
  await query(
    `INSERT INTO housekeeping_status AS h
       (step, last_run_at, last_ok_at, last_error_at, last_error, last_rows, runs, failures, last_process)
     VALUES ($1, now(), CASE WHEN $2::boolean THEN now() END, CASE WHEN $2 THEN NULL ELSE now() END,
             CASE WHEN $2 THEN NULL ELSE $3::text END, $4::int, 1, CASE WHEN $2 THEN 0 ELSE 1 END, $5)
     ON CONFLICT (step) DO UPDATE SET
       last_run_at   = now(),
       last_ok_at    = CASE WHEN $2 THEN now() ELSE h.last_ok_at END,
       last_error_at = CASE WHEN $2 THEN h.last_error_at ELSE now() END,
       last_error    = CASE WHEN $2 THEN h.last_error ELSE $3 END,
       last_rows     = CASE WHEN $2 THEN $4 ELSE h.last_rows END,
       runs          = h.runs + 1,
       failures      = h.failures + CASE WHEN $2 THEN 0 ELSE 1 END,
       last_process  = $5`,
    [step.slice(0, MAX_STEP), outcome.ok, outcome.error, outcome.rows, processId],
  );
}

function record(step: string, processId: string, outcome: StepOutcome): void {
  const p = writeStepStatus(step, processId, outcome).catch((err: unknown) => {
    const now = Date.now();
    if (now - lastWarnAt >= WARN_EVERY_MS) {
      lastWarnAt = now;
      log("warn", "[housekeeping] qadam holati yozilmadi", { step, err });
    }
  });
  pending.add(p);
  void p.finally(() => pending.delete(p));
}

/**
 * Runs `fn` and records its outcome under `step`. Returns what `fn` returns
 * and rethrows what it throws, unchanged.
 */
export async function recordStep<T>(step: string, processId: string, fn: () => Promise<T>): Promise<T> {
  let result: T;
  try {
    result = await fn();
  } catch (e) {
    try {
      record(step, processId, { ok: false, rows: null, error: errorText(e) });
    } catch {
      // Status bookkeeping must never replace the step's own error.
    }
    throw e;
  }
  try {
    record(step, processId, { ok: true, rows: rowsOf(result), error: null });
  } catch {
    // Never let bookkeeping affect a successful step.
  }
  return result;
}

/** Test seam: resolves when every status write started so far has settled. */
export async function flushStepStatus(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}
