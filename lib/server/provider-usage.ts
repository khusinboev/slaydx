import "server-only";
import { registerProviderCallSink } from "../generation/provider-calls";
import { query } from "./db";
import { log } from "./log";
import { isProviderId } from "./providers/registry";

/**
 * Write side of the free-provider call counters (`provider_calls`, migration 062).
 *
 * The generation layer reports each real request through `recordProviderCall`; this module batches the counts in
 * memory and upserts them every `FLUSH_MS`, so a 20-photo slide deck costs one small write, not 20. Telemetry only:
 * a failing write is retried with the next batch (bounded) and never reaches a job; counts still in memory when the
 * process dies are lost, which is acceptable for a usage gauge.
 *
 * Only registry ids are counted (a typo or a removed provider cannot create unbounded keys). The day is the
 * Tashkent day, the same one every admin page uses.
 */

const FLUSH_MS = 15_000;
/** A sick database must not grow the buffer without bound. */
const MAX_BUFFERED_KEYS = 64;

type Bucket = { calls: number; errors: number };
type Holder = typeof globalThis & { __slaydxProviderCalls?: Map<string, Bucket>; __slaydxProviderCallsTimer?: ReturnType<typeof setInterval> };
const g = globalThis as Holder;

const buffer = (): Map<string, Bucket> => (g.__slaydxProviderCalls ??= new Map());

/** The sink the generation layer calls: synchronous, in-memory, never throws. */
export function bufferProviderCall(provider: string, ok: boolean): void {
  if (!isProviderId(provider)) return;
  const buf = buffer();
  const cur = buf.get(provider) ?? (buf.size < MAX_BUFFERED_KEYS ? { calls: 0, errors: 0 } : null);
  if (!cur) return;
  cur.calls += 1;
  if (!ok) cur.errors += 1;
  buf.set(provider, cur);
}

let lastWarnAt = 0;

/** Writes the buffered counts now. Resolves when done; a failure puts the counts back and logs at most once a minute. */
export async function flushProviderCalls(): Promise<void> {
  const buf = buffer();
  if (buf.size === 0) return;
  const batch = [...buf];
  buf.clear();
  try {
    await query(
      `INSERT INTO provider_calls (day, provider, calls, errors)
       SELECT (now() AT TIME ZONE 'Asia/Tashkent')::date, t.p, t.c, t.e
         FROM unnest($1::text[], $2::bigint[], $3::bigint[]) AS t(p, c, e)
       ON CONFLICT (day, provider) DO UPDATE
         SET calls = provider_calls.calls + EXCLUDED.calls, errors = provider_calls.errors + EXCLUDED.errors`,
      [batch.map(([p]) => p), batch.map(([, b]) => b.calls), batch.map(([, b]) => b.errors)],
    );
  } catch (e) {
    for (const [p, b] of batch) {
      const cur = buf.get(p) ?? { calls: 0, errors: 0 };
      cur.calls += b.calls;
      cur.errors += b.errors;
      buf.set(p, cur);
    }
    const now = Date.now();
    if (now - lastWarnAt > 60_000) {
      lastWarnAt = now;
      log("warn", "[provider-usage] hisoblagichni yozib bo'lmadi, keyingi urinishda qayta yoziladi", { err: e });
    }
  }
}

/** Registers the sink and starts the unref'd flush timer (a second call is a no-op). Web and worker both call it at boot. */
export function startProviderUsageFlush(intervalMs: number = FLUSH_MS): void {
  registerProviderCallSink(bufferProviderCall);
  if (g.__slaydxProviderCallsTimer) return;
  const timer = setInterval(() => {
    void flushProviderCalls();
  }, intervalMs);
  timer.unref();
  g.__slaydxProviderCallsTimer = timer;
}

/** Stops the timer and unregisters the sink (tests). */
export function stopProviderUsageFlush(): void {
  if (g.__slaydxProviderCallsTimer) clearInterval(g.__slaydxProviderCallsTimer);
  g.__slaydxProviderCallsTimer = undefined;
  registerProviderCallSink(null);
}
