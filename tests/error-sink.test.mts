import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Persisted error log sink (`lib/server/error-sink.ts`, `log.ts` hook;
 * docs/admin/02-plan.md §5.2, §6.11, §13.4).
 *
 * Unit: fingerprints group repeats that differ only in ids/numbers; records are
 * truncated (message 2 KB, stack 8 KB); `log()` forwards only "error" (and
 * "warn" when asked), already redacted, asynchronously, and a throwing sink
 * never reaches the caller; the throttle caps writes per minute and counts
 * drops; anything logged while the sink works is ignored (no recursion); a
 * failing DB write never throws and pauses the sink.
 * DB (throwaway database): a repeat bumps the open row's count and keeps the
 * latest request/user/job; a resolved row is left alone and a new one opens.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("errsink") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

const sinkMod = await import("../lib/server/error-sink.ts");
const logMod = await import("../lib/server/log.ts");
const { createErrorSink, errorFingerprint, normalizeMessage, rowFromRecord, MAX_MESSAGE, MAX_STACK } = sinkMod;
const { log, setErrorSink, getErrorSink } = logMod;

const tick = () => new Promise((r) => setTimeout(r, 0));

function quiet(t: TestContext) {
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "log", () => {});
}

test("fingerprint: ids, hex and numbers do not split a group; scope and error name do", () => {
  const a = errorFingerprint("worker", "[worker] job 3f2a9c1e-1111-4222-8333-444455556666 failed after 1200 ms", "TypeError");
  const b = errorFingerprint("worker", "[worker] job 0b8e7d6c-aaaa-4bbb-8ccc-ddddeeeeffff failed after 87 ms", "TypeError");
  assert.equal(a, b);
  assert.notEqual(a, errorFingerprint("db", "[worker] job 3f2a9c1e-1111-4222-8333-444455556666 failed after 1200 ms", "TypeError"));
  assert.notEqual(a, errorFingerprint("worker", "[worker] job 3f2a9c1e-1111-4222-8333-444455556666 failed after 1200 ms", "RangeError"));
  assert.notEqual(a, errorFingerprint("worker", "[worker] job x crashed", "TypeError"));
  assert.match(a, /^[0-9a-f]{40}$/);
  assert.equal(normalizeMessage("hash deadbeef01 at 0x1f  and   word deadbeef"), "hash <hex> at <hex> and word deadbeef");
});

test("rowFromRecord: scope from [area], error text, truncation, safe ids", () => {
  const row = rowFromRecord(
    {
      ts: "2026-10-01T00:00:00.000Z",
      level: "error",
      msg: "[payme] webhook yiqildi",
      reqId: "req-12345678",
      userId: "42",
      jobId: "job-1",
      path: "/api/payme",
      err: { message: "x".repeat(5_000), stack: "s".repeat(20_000), name: "TypeError" },
    },
    "web@host:1",
  );
  assert.equal(row.scope, "payme");
  assert.equal(row.level, "error");
  assert.equal(row.message.length, MAX_MESSAGE);
  assert.ok(row.message.startsWith("[payme] webhook yiqildi: xxx"));
  assert.equal(row.stack?.length, MAX_STACK);
  assert.equal(row.requestId, "req-12345678");
  assert.equal(row.userId, "42");
  assert.equal(row.jobId, "job-1");
  assert.equal(row.path, "/api/payme");
  assert.equal(row.process, "web@host:1");
  // A non-numeric user id never reaches the BIGINT column; no err → no stack.
  const plain = rowFromRecord({ level: "warn", msg: "no scope here", userId: "abc" }, "p");
  assert.equal(plain.userId, null);
  assert.equal(plain.scope, "");
  assert.equal(plain.stack, null);
  assert.equal(plain.level, "warn");
});

test("log(): sink gets only error lines, redacted, after the caller; a throwing sink is invisible", async (t) => {
  quiet(t);
  const prev = getErrorSink();
  t.after(() => setErrorSink(prev));
  const seen: Array<Record<string, unknown>> = [];
  setErrorSink((r) => {
    seen.push({ ...r });
  });
  log("info", "[x] info line");
  log("warn", "[x] warn line");
  log("error", "[x] boom ?key=AIzaSyDUMMYDUMMYDUMMYDUMMYDUMMY12", { err: new Error("token=abc123secret") });
  assert.equal(seen.length, 0, "the sink runs after log() returns (microtask)");
  await tick();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].level, "error");
  assert.doesNotMatch(String(seen[0].msg), /AIza/);
  assert.doesNotMatch(JSON.stringify(seen[0].err), /abc123secret/);

  // warn only on request
  setErrorSink((r) => {
    seen.push({ ...r });
  }, { warn: true });
  log("warn", "[x] warn line 2");
  await tick();
  assert.equal(seen.at(-1)?.msg, "[x] warn line 2");

  // a sink that throws or rejects never affects log()
  setErrorSink(() => {
    throw new Error("sink exploded");
  });
  assert.doesNotThrow(() => log("error", "[x] still fine"));
  setErrorSink(async () => {
    throw new Error("sink rejected");
  });
  assert.doesNotThrow(() => log("error", "[x] still fine"));
  await tick();

  // removed sink → nothing
  const before = seen.length;
  setErrorSink(null);
  log("error", "[x] unseen");
  await tick();
  assert.equal(seen.length, before);
});

test("throttle: at most N writes per minute, the rest counted as dropped", async () => {
  let clock = 1_000_000;
  const writes: string[] = [];
  const h = createErrorSink({
    processId: "worker@h:1",
    maxPerMinute: 3,
    now: () => clock,
    write: async (row) => {
      writes.push(row.message);
    },
  });
  for (let i = 0; i < 5; i++) h.sink({ level: "error", msg: `[t] e${i}` });
  await h.flush();
  assert.equal(writes.length, 3);
  assert.deepEqual(h.stats(), { written: 3, dropped: 2, failed: 0, ignored: 0 });
  clock += 60_001;
  h.sink({ level: "error", msg: "[t] next window" });
  await h.flush();
  assert.equal(writes.length, 4);
  assert.equal(h.stats().written, 4);
});

test("recursion guard: an error logged inside the sink's own write is ignored", async (t) => {
  quiet(t);
  const prev = getErrorSink();
  t.after(() => setErrorSink(prev));
  let writes = 0;
  const h = createErrorSink({
    processId: "web@h:1",
    write: async () => {
      writes++;
      // What db.ts would do on a pool error raised by this very write.
      log("error", "[db] idle client error", { err: new Error("connection lost") });
      throw new Error("db down");
    },
  });
  setErrorSink(h.sink, { warn: true });
  log("error", "[x] original");
  for (let i = 0; i < 5; i++) await tick();
  await h.flush();
  assert.equal(writes, 1, "the sink must not feed itself");
  assert.ok(h.stats().ignored >= 1);
  assert.equal(h.stats().failed, 1);
});

test("DB down: the sink never throws, pauses after a failure, then recovers", async (t) => {
  quiet(t);
  let clock = 5_000_000;
  let fail = true;
  let writes = 0;
  const h = createErrorSink({
    processId: "web@h:1",
    failurePauseMs: 30_000,
    now: () => clock,
    write: async () => {
      writes++;
      if (fail) throw new Error("ECONNREFUSED");
    },
  });
  assert.doesNotThrow(() => h.sink({ level: "error", msg: "[a] one" }));
  await h.flush();
  assert.equal(h.stats().failed, 1);
  h.sink({ level: "error", msg: "[a] two" });
  await h.flush();
  assert.equal(writes, 1, "paused: no second attempt against a sick DB");
  assert.equal(h.stats().dropped, 1);
  fail = false;
  clock += 30_001;
  h.sink({ level: "error", msg: "[a] three" });
  await h.flush();
  assert.equal(writes, 2);
  assert.equal(h.stats().written, 1);
  // A write that throws synchronously is contained too.
  const sync = createErrorSink({
    processId: "p",
    write: () => {
      throw new Error("sync throw");
    },
  });
  assert.doesNotThrow(() => sync.sink({ level: "error", msg: "x" }));
  await sync.flush();
  assert.equal(sync.stats().failed, 1);
  // Garbage records never throw.
  assert.doesNotThrow(() => sync.sink(null as never));
});

test("registerErrorSink: the first registration wins", (t) => {
  const prev = getErrorSink();
  t.after(() => setErrorSink(prev));
  setErrorSink(null);
  assert.equal(sinkMod.registerErrorSink("web"), true);
  const first = getErrorSink();
  assert.equal(sinkMod.registerErrorSink("worker"), false);
  assert.equal(getErrorSink(), first);
});

test("error_log upsert (Postgres)", { skip }, async (t) => {
  const { migrate, pool, query } = await import("../lib/server/db.ts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });
  const rec = (n: number, reqId: string) =>
    rowFromRecord(
      { level: "error", msg: `[worker] job ${n} failed`, reqId, userId: String(n), jobId: `j-${n}`, err: { message: "boom", name: "Error", stack: "at x" } },
      "worker@h:9",
    );
  await sinkMod.upsertErrorLog(rec(1, "req-aaaaaaaa"));
  await sinkMod.upsertErrorLog(rec(2, "req-bbbbbbbb"));
  await sinkMod.upsertErrorLog(rec(3, "req-cccccccc"));
  let rows = await query<{ id: string; count: number; request_id: string; user_id: string; job_id: string; resolved_at: Date | null }>(
    "SELECT id, count, request_id, user_id, job_id, resolved_at FROM error_log",
  );
  assert.equal(rows.length, 1, "one open row per fingerprint");
  assert.equal(rows[0].count, 3);
  assert.equal(rows[0].request_id, "req-cccccccc", "latest occurrence wins");
  assert.equal(String(rows[0].user_id), "3");
  assert.equal(rows[0].job_id, "j-3");

  await query("UPDATE error_log SET resolved_at = now()");
  await sinkMod.upsertErrorLog(rec(4, "req-dddddddd"));
  rows = await query("SELECT id, count, request_id, user_id, job_id, resolved_at FROM error_log ORDER BY id");
  assert.equal(rows.length, 2, "a resolved row is kept; the repeat opens a new one");
  assert.equal(rows[0].count, 3);
  assert.ok(rows[0].resolved_at);
  assert.equal(rows[1].count, 1);
  assert.equal(rows[1].resolved_at, null);

  // End to end through log() with the real writer.
  const prev = getErrorSink();
  t.after(() => setErrorSink(prev));
  const h = createErrorSink({ processId: "web@h:9" });
  setErrorSink(h.sink);
  t.mock.method(console, "error", () => {});
  log("error", "[e2e] something broke", { err: new Error("fail 77") });
  await tick();
  await h.flush();
  const e2e = await query<{ scope: string; message: string; process: string }>(
    "SELECT scope, message, process FROM error_log WHERE scope = 'e2e'",
  );
  assert.equal(e2e.length, 1);
  assert.equal(e2e[0].message, "[e2e] something broke: fail 77");
  assert.equal(e2e[0].process, "web@h:9");
});
