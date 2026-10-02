import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Admin job actions through the REAL routes (docs/admin/02-plan.md §6.5, §10
 * T14) on a throwaway Postgres: cancel (QUEUED → REVOKED + refund), force-fail
 * (IN_PROGRESS → FAILED, lease cleared + refund) with the late worker fenced
 * out and its own refund staying idempotent, manual refund (FAILED + charged +
 * unrefunded) with Idempotency-Key replay / conflict, the state machine 409s,
 * one audit row per action, and the guard.
 *
 * Mutation checks (each made the named assertion fail, then restored):
 *   - fail route without `locked_by = NULL` → the late `commitJobResult` wins;
 *   - cancel without `refundInTx` → balance stays debited;
 *   - refund without the "already refunded" check → still 409 thanks to
 *     `refundInTx` returning false, but the message changes (asserted);
 *   - refund without the FAILED check → a COMPLETED job is refunded;
 *   - dropping `FOR UPDATE` → the parallel refund test produces 2 × 200.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.ADMIN_TOTP_KEY = randomBytes(32).toString("base64");
// 2FA-mode suite: the strengthened flow (TOTP, step-up) is what these tests pin (docs/admin/HANDOFF.md "Admin 2FA switch").
process.env.ADMIN_2FA_REQUIRED = "true";
process.env.TELEGRAM_BOT_TOKEN = "123456:admin-jobs-test-token-never-called";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "DATABASE_URL yo'q";

const iso = hasDb ? await createIsolatedDb("adminjobs") : { isolated: false, drop: async () => {} };

const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { createAdminSession, adminCookieName } = await import("../lib/server/admin-session.ts");
const jobs = await import("../lib/server/jobs.ts");
const { refund } = await import("../lib/server/credits.ts");
const { refundInTx } = await import("../lib/server/refund-tx.ts");
const { ADMIN_CANCEL_NOTE, ADMIN_FAIL_ERROR, ADMIN_REFUND_NOTE, purgeFailedLeftovers } = await import("../lib/server/admin-job-actions.ts");
const { putAssetBytes } = await import("../lib/server/assets.ts");
const routes = {
  cancel: await import("../app/api/admin/generations/[id]/cancel/route.ts"),
  fail: await import("../app/api/admin/generations/[id]/fail/route.ts"),
  refund: await import("../app/api/admin/generations/[id]/refund/route.ts"),
};

after(async () => {
  if (!hasDb) return;
  await pool().end();
  await iso.drop();
});

if (hasDb) await ensureMigrated();

// ───────────────────────────── fixtures

type Role = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
type TestUser = { id: string; userToken: string };
type TestAdmin = TestUser & { adminId: string };
type Session = { cookie: string; admin: TestAdmin };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function mkUser(balance = 0, points = 0): Promise<TestUser> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, points, quota, balance) VALUES ($1, $2, 'Jobs Test', $3, 0, $4) RETURNING id::text AS id`,
    [String(randomInt(5_000_000_000, 9_000_000_000)), `j_${randomBytes(5).toString("hex")}`, points, balance],
  );
  const { token } = await createSession(row!.id);
  return { id: row!.id, userToken: token };
}

async function session(role: Role, reauth = true): Promise<Session> {
  const u = await mkUser();
  const acc = await queryOne<{ id: string }>(
    `INSERT INTO admin_accounts (user_id, role, status, totp_enabled_at, totp_secret_enc)
     VALUES ($1, $2, 'active', now(), 'v1.fixture-never-opened') RETURNING id::text AS id`,
    [u.id, role],
  );
  const admin: TestAdmin = { ...u, adminId: acc!.id };
  const us = await queryOne<{ id: string }>(`SELECT id::text AS id FROM sessions WHERE token_hash = $1`, [sha256(u.userToken)]);
  const s = await transaction((client) =>
    createAdminSession(client, { adminId: admin.adminId, userSessionId: us!.id, ip: "10.0.0.1", userAgent: "jobs-test", reauth }),
  );
  return { cookie: `${SESSION_COOKIE}=${u.userToken}; ${adminCookieName()}=${s.token}`, admin };
}

type Result = { status: number; body: Record<string, unknown>; replayed: string | null };

async function call(
  which: keyof typeof routes,
  cookie: string | null,
  id: string,
  body: unknown,
  opts: { key?: string | null; origin?: boolean } = {},
): Promise<Result> {
  const headers: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": "10.1.2.4", "user-agent": "jobs-test", "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  if (opts.origin !== false) headers.origin = "http://localhost:3000";
  if (opts.key !== null) headers["Idempotency-Key"] = opts.key ?? randomUUID();
  const req = new Request(`http://localhost:3000/api/admin/generations/${encodeURIComponent(id)}/${which}`, { method: "POST", headers, body: JSON.stringify(body) });
  const res = await inRequest(req, () => routes[which].POST(req, { params: Promise.resolve({ id }) }));
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  return { status: res.status, body: parsed, replayed: res.headers.get("Idempotent-Replayed") };
}

async function enqueue(uid: string, price = 1_000): Promise<string> {
  const res = await jobs.enqueueGeneration({
    userId: uid,
    toolId: "referat",
    topic: "Admin sinovi",
    price,
    format: "docx",
    values: { topic: "Admin sinovi" } as never,
    budgetMs: 60_000,
  });
  assert.ok(res.ok, `enqueue: ${JSON.stringify(res)}`);
  return res.id;
}

const balance = async (uid: string) => Number((await queryOne<{ balance: string }>(`SELECT balance FROM users WHERE id = $1`, [uid]))!.balance);
const gen = (id: string) =>
  queryOne<{ status: string; locked_by: string | null; error: string | null; finished_at: Date | null }>(
    `SELECT status, locked_by, error, finished_at FROM generations WHERE id = $1`,
    [id],
  );
const refunds = (id: string) =>
  query<{ note: string | null; balance_delta: string; points_delta: string }>(
    `SELECT note, balance_delta, points_delta FROM transactions WHERE kind = 'refund' AND reference = $1`,
    [id],
  );
const audits = (adminId: string, action: string) =>
  query<{ outcome: string; target_id: string | null; reason: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; meta: Record<string, unknown> | null }>(
    `SELECT outcome, target_id, reason, before, after, meta FROM admin_audit_log WHERE admin_id = $1 AND action = $2 ORDER BY id`,
    [adminId, action],
  );

const REASON = { reason: "Foydalanuvchi so'rovi bo'yicha" };

// ───────────────────────────── cancel

test("cancel: QUEUED → REVOKED with the refund in one transaction; 409 state afterwards and for IN_PROGRESS", { skip }, async () => {
  const s = await session("support");
  const u = await mkUser(5_000, 200);
  const id = await enqueue(u.id, 1_000); // 200 points + 800 balance
  assert.equal(await balance(u.id), 4_200);

  const r = await call("cancel", s.cookie, id, REASON);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const g = r.body.generation as Record<string, unknown>;
  assert.equal(g.id, id);
  assert.equal(g.status, "REVOKED");
  assert.equal(g.userId, u.id);
  assert.ok(!("values" in g) && !("html" in g), "no wide columns");
  assert.deepEqual(r.body.refunded, { points: 200, quota: 0, balance: 800 });
  assert.equal(await balance(u.id), 5_000);
  const rf = await refunds(id);
  assert.equal(rf.length, 1);
  assert.equal(rf[0].note, ADMIN_CANCEL_NOTE);
  assert.equal((await gen(id))!.status, "REVOKED");

  const a = await audits(s.admin.adminId, "jobs.cancel");
  assert.equal(a.length, 1);
  assert.equal(a[0].target_id, id);
  assert.equal(a[0].reason, REASON.reason);
  assert.deepEqual(a[0].before, { status: "QUEUED" });
  assert.equal((a[0].after as { status: string }).status, "REVOKED");

  const again = await call("cancel", s.cookie, id, REASON);
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "state");
  assert.equal(again.body.status, "REVOKED");
  assert.equal((await refunds(id)).length, 1);
  assert.equal((await audits(s.admin.adminId, "jobs.cancel")).length, 1, "a refusal is not audited");

  const running = await enqueue(u.id, 500);
  assert.ok(await jobs.claimJob(jobs.newLease("w-cancel")));
  const busy = await call("cancel", s.cookie, running, REASON);
  assert.equal(busy.status, 409);
  assert.equal(busy.body.code, "state");
  assert.equal(busy.body.status, "IN_PROGRESS");
});

// ───────────────────────────── fail + lease fence

test("fail: IN_PROGRESS → FAILED, lease cleared, refund; the late worker is fenced out and cannot refund twice", { skip }, async () => {
  const s = await session("admin");
  const u = await mkUser(3_000);
  const id = await enqueue(u.id, 1_000);
  const lease = jobs.newLease("w-late");
  const claimed = await jobs.claimJob(lease);
  assert.equal(claimed?.id, id);
  assert.equal(claimed?.lease, lease);
  assert.equal((await gen(id))!.locked_by, lease);
  await query(
    `INSERT INTO generation_files (generation_id, file_name, mime, size_bytes, bytes, expires_at) VALUES ($1, 'half.docx', 'application/octet-stream', 1, '\\x01', NULL)`,
    [id],
  );

  const r = await call("fail", s.cookie, id, { reason: "Osilib qolgan ish" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const g = r.body.generation as Record<string, unknown>;
  assert.equal(g.status, "FAILED");
  assert.equal(g.lockedBy, null);
  assert.equal(g.error, ADMIN_FAIL_ERROR);
  assert.equal(ADMIN_FAIL_ERROR, "Administrator tomonidan to'xtatildi");
  assert.deepEqual(r.body.refunded, { points: 0, quota: 0, balance: 1_000 });
  assert.equal(await balance(u.id), 3_000);
  const row = await gen(id);
  assert.equal(row!.status, "FAILED");
  assert.equal(row!.locked_by, null);
  assert.equal(row!.error, ADMIN_FAIL_ERROR);
  assert.ok(row!.finished_at);
  assert.equal((await query(`SELECT 1 FROM generation_files WHERE generation_id = $1`, [id])).length, 0, "dead attempt's file removed");

  const a = await audits(s.admin.adminId, "jobs.fail");
  assert.equal(a.length, 1);
  assert.deepEqual(a[0].before, { status: "IN_PROGRESS", lockedBy: lease });
  assert.equal((a[0].after as { status: string }).status, "FAILED");

  // The worker comes back with the OLD lease: every fenced write is rejected…
  await jobs.setProgress(id, lease, 90, "Deyarli tayyor"); // fenced UPDATE: no row matches
  assert.equal((await queryOne<{ progress: number; step: string }>(`SELECT progress, step FROM generations WHERE id = $1`, [id]))!.step, "Xatolik");
  assert.equal(await jobs.failJob(id, lease, "Provayder xatosi"), false, "worker failJob loses the fence");
  const won = await jobs.commitJobResult(
    id,
    lease,
    { bytes: new Uint8Array([1, 2, 3]), mime: "application/octet-stream", fileName: "late.docx" },
    [],
    { html: "<p>kech</p>", doc: null, fileName: "late.docx", preview: null },
  );
  assert.equal(won, false, "MUTATSIYA: the late commit must lose");
  const after = await gen(id);
  assert.equal(after!.status, "FAILED");
  assert.equal(after!.error, ADMIN_FAIL_ERROR);
  assert.equal((await query(`SELECT 1 FROM generation_files WHERE generation_id = $1`, [id])).length, 0, "no late file");
  // …and even the worker's own refund attempt is a no-op (idempotent on the reference).
  assert.equal(await refund(u.id, id, "Xatolik: Provayder xatosi"), false);
  assert.equal(await balance(u.id), 3_000, "no double refund");
  assert.equal((await refunds(id)).length, 1);

  const queued = await enqueue(u.id, 100);
  const notRunning = await call("fail", s.cookie, queued, REASON);
  assert.equal(notRunning.status, 409);
  assert.equal(notRunning.body.code, "state");
});

// ───────────────────────────── refund

test("refund: FAILED + charged + unrefunded → refund; replay / conflict; 409 not_refundable for refunded, COMPLETED and uncharged", { skip }, async () => {
  const s = await session("finance");
  const u = await mkUser(2_000);
  const id = await enqueue(u.id, 1_000);
  // A crash after `failJob` and before the worker's refund: FAILED, charged, unrefunded.
  await query(`UPDATE generations SET status = 'FAILED', locked_by = NULL, error = 'Ish vaqti tugadi', finished_at = now() WHERE id = $1`, [id]);
  assert.equal(await balance(u.id), 1_000);

  const missingKey = await call("refund", s.cookie, id, REASON, { key: null });
  assert.equal(missingKey.status, 400);

  const key = randomUUID();
  const r = await call("refund", s.cookie, id, REASON, { key });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.replayed, null);
  assert.deepEqual(r.body, { refunded: { points: 0, quota: 0, balance: 1_000 } });
  assert.equal(await balance(u.id), 2_000);
  const rf = await refunds(id);
  assert.equal(rf.length, 1);
  assert.equal(rf[0].note, ADMIN_REFUND_NOTE);
  const a = await audits(s.admin.adminId, "jobs.refund");
  assert.equal(a.length, 1);
  assert.equal(a[0].meta?.idempotencyKey, key);
  assert.deepEqual(a[0].before, { refunded: false });
  assert.deepEqual(a[0].after, { refunded: true, points: 0, quota: 0, balance: 1_000 });

  const replay = await call("refund", s.cookie, id, REASON, { key });
  assert.equal(replay.status, 200);
  assert.equal(replay.replayed, "true");
  assert.deepEqual(replay.body, r.body);
  assert.equal(await balance(u.id), 2_000);
  assert.equal((await refunds(id)).length, 1);
  assert.equal((await audits(s.admin.adminId, "jobs.refund")).length, 1);

  const conflict = await call("refund", s.cookie, id, { reason: "Boshqa sabab matni" }, { key });
  assert.equal(conflict.status, 422);
  assert.equal(conflict.body.code, "idempotency_conflict");

  const twice = await call("refund", s.cookie, id, REASON);
  assert.equal(twice.status, 409);
  assert.equal(twice.body.code, "not_refundable");
  assert.match(String(twice.body.error), /allaqachon/);
  assert.equal(await balance(u.id), 2_000);

  const done = await enqueue(u.id, 500);
  await query(`UPDATE generations SET status = 'COMPLETED', finished_at = now() WHERE id = $1`, [done]);
  const completed = await call("refund", s.cookie, done, REASON);
  assert.equal(completed.status, 409);
  assert.equal(completed.body.code, "not_refundable");
  assert.equal(completed.body.status, "COMPLETED");
  assert.equal(await balance(u.id), 1_500, "a COMPLETED job keeps its charge");

  const free = await enqueue(u.id, 0);
  await query(`UPDATE generations SET status = 'FAILED', finished_at = now() WHERE id = $1`, [free]);
  const uncharged = await call("refund", s.cookie, free, REASON);
  assert.equal(uncharged.status, 409);
  assert.equal(uncharged.body.code, "not_refundable");
  assert.match(String(uncharged.body.error), /yechilmagan/);
  assert.equal((await audits(s.admin.adminId, "jobs.refund")).length, 1, "refusals are not audited");
});

test("refund: two parallel refunds with different keys → exactly one refund row", { skip }, async () => {
  const s = await session("owner");
  const u = await mkUser(1_000);
  const id = await enqueue(u.id, 1_000);
  await query(`UPDATE generations SET status = 'FAILED', locked_by = NULL, finished_at = now() WHERE id = $1`, [id]);
  // Barrier: hold the generation row so both requests are in flight; `FOR UPDATE`
  // in the action then serialises them (MUTATSIYA: without it both refund → 500).
  const gate = await pool().connect();
  await gate.query("BEGIN");
  await gate.query(`SELECT 1 FROM generations WHERE id = $1 FOR UPDATE`, [id]);
  const pending = Promise.all([call("refund", s.cookie, id, REASON), call("refund", s.cookie, id, REASON)]);
  await new Promise((r) => setTimeout(r, 400));
  await gate.query("COMMIT");
  gate.release();
  const results = await pending;
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 409], JSON.stringify(results.map((r) => r.body)));
  assert.equal(await balance(u.id), 1_000);
  assert.equal((await refunds(id)).length, 1);
  assert.equal((await audits(s.admin.adminId, "jobs.refund")).length, 1);
});

test("refund: another admin reusing the key → 422 (key-only scope); the original admin still replays", { skip }, async () => {
  const a = await session("finance");
  const b = await session("support");
  const u = await mkUser(1_000);
  const id = await enqueue(u.id, 1_000);
  await query(`UPDATE generations SET status = 'FAILED', locked_by = NULL, finished_at = now() WHERE id = $1`, [id]);
  const key = randomUUID();
  const first = await call("refund", a.cookie, id, REASON, { key });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const stolen = await call("refund", b.cookie, id, REASON, { key });
  assert.equal(stolen.status, 422, JSON.stringify(stolen.body));
  assert.equal(stolen.body.code, "idempotency_conflict");
  assert.equal((await audits(b.admin.adminId, "jobs.refund")).length, 0);
  assert.equal((await refunds(id)).length, 1);
  assert.equal((await call("refund", a.cookie, id, REASON, { key })).replayed, "true");
});

test("refund racing the worker's refund: the unique ledger reference becomes 409 not_refundable (allaqachon), never 500", { skip }, async () => {
  const s = await session("owner");
  const u = await mkUser(1_000);
  const id = await enqueue(u.id, 1_000);
  await query(`UPDATE generations SET status = 'FAILED', locked_by = NULL, finished_at = now() WHERE id = $1`, [id]);
  // The worker (`credits.refund`) locks only the USER row. Hold it: the admin
  // request passes its "already refunded" checks and blocks inside refundInTx;
  // the worker then refunds and commits first.
  const worker = await pool().connect();
  await worker.query("BEGIN");
  await worker.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [u.id]);
  const pending = call("refund", s.cookie, id, REASON);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(await refundInTx(worker, u.id, id, "Xatolik: worker"), true);
  await worker.query("COMMIT");
  worker.release();
  const r = await pending;
  assert.equal(r.status, 409, `MUTATSIYA: ${JSON.stringify(r.body)}`);
  assert.equal(r.body.code, "not_refundable");
  assert.match(String(r.body.error), /allaqachon qaytarilgan/);
  assert.equal(await balance(u.id), 1_000, "refunded exactly once");
  const rf = await refunds(id);
  assert.equal(rf.length, 1);
  assert.equal(rf[0].note, "Xatolik: worker");
  assert.equal((await audits(s.admin.adminId, "jobs.refund")).length, 0);
});

/** Sessions of this database waiting on a row lock (`pg_stat_activity`). */
async function waitForLockWaiters(n: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const row = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if ((row?.n ?? 0) >= n) return;
    if (Date.now() > deadline) throw new Error(`lock waiters: kutilgan ${n}, bor ${row?.n ?? 0}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/**
 * The mirror race (P4 money review, finding 2): the worker's `credits.refund`
 * passes its "already refunded" check while an ADMIN refund is still
 * uncommitted, waits on the users row, then its insert hits
 * `transactions_ref_idx`. That must read as "already refunded" (`false`), not
 * a raw 23505: `refundThenCleanup` would log a false REFUND_FAILED alert.
 * The barrier is the admin's own uncommitted `refundInTx`.
 */
test("worker refund racing a committing admin refund: unique ledger reference → false (already refunded), never a raw 23505", { skip }, async () => {
  const u = await mkUser(3_000);
  const id = await enqueue(u.id, 1_000);
  await query(`UPDATE generations SET status = 'FAILED', locked_by = NULL, finished_at = now() WHERE id = $1`, [id]);
  const admin = await pool().connect();
  let worker: Promise<boolean> | undefined;
  try {
    await admin.query("BEGIN");
    assert.equal(await refundInTx(admin, u.id, id, ADMIN_REFUND_NOTE), true); // holds the users row, refund row uncommitted
    worker = refund(u.id, id, "Xatolik: kech");
    await waitForLockWaiters(1); // the worker sits on `SELECT … users FOR UPDATE`
    await admin.query("COMMIT");
  } finally {
    await admin.query("ROLLBACK").catch(() => {});
    admin.release();
  }
  assert.equal(await worker!, false, "MUTATSIYA: 23505 must become «already refunded»");
  const rf = await refunds(id);
  assert.equal(rf.length, 1);
  assert.equal(rf[0].note, ADMIN_REFUND_NOTE);
  assert.equal(await balance(u.id), 3_000, "refunded exactly once");
});

/**
 * P4 money review, finding 5: after an admin force-fail the fenced worker may
 * still finish an UNFENCED asset write (`LiveReporter` → `putAssets`, TTS →
 * `putAssetBytes`), leaving orphan rows on the FAILED job; no existing purge
 * covers them (retention: COMPLETED bonus-only; reconcile: unrefunded only).
 * `purgeFailedLeftovers` sweeps admin-failed jobs once their budget (plus the
 * worker's hard-stop/quiesce grace) has surely elapsed; it is idempotent and
 * touches nothing else. Mutation checks: dropping the grace → the early sweep
 * removes the row; dropping the ADMIN_FAIL_ERROR predicate → the worker-failed
 * job's asset is swept too.
 */
test("fail: a late asset write of the fenced worker is swept by purgeFailedLeftovers after the job's budget", { skip }, async () => {
  const s = await session("admin");
  const u = await mkUser(3_000);
  const id = await enqueue(u.id, 1_000); // budgetMs 60_000
  // Claimed state by SQL: `claimJob` takes the oldest QUEUED job globally, and earlier tests leave some.
  await query(`UPDATE generations SET status = 'IN_PROGRESS', locked_by = $2, locked_at = now() WHERE id = $1`, [id, jobs.newLease("w-late-asset")]);
  const r = await call("fail", s.cookie, id, { reason: "Osilib qolgan ish" });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  // The worker's in-flight write lands after the admin's DELETE.
  const assetId = await putAssetBytes(id, "audio/mpeg", Buffer.from([1, 2, 3]));
  const assets = () => query<{ asset_id: string }>(`SELECT asset_id FROM generation_assets WHERE generation_id = $1`, [id]);
  assert.deepEqual((await assets()).map((a) => a.asset_id), [assetId], "orphan asset on the FAILED job");

  // Control rows: a COMPLETED job and a job the WORKER failed keep their assets.
  const done = await enqueue(u.id, 100);
  await query(`UPDATE generations SET status = 'COMPLETED', finished_at = now() - interval '1 day' WHERE id = $1`, [done]);
  const doneAsset = await putAssetBytes(done, "image/png", Buffer.from([4, 5, 6]));
  const workerFailed = await enqueue(u.id, 100);
  await query(`UPDATE generations SET status = 'FAILED', error = 'Provayder xatosi', finished_at = now() - interval '1 day' WHERE id = $1`, [workerFailed]);
  const ownAsset = await putAssetBytes(workerFailed, "image/png", Buffer.from([7, 8, 9]));

  assert.equal(await purgeFailedLeftovers(), 0, "within budget + grace the worker may still be writing");
  assert.equal((await assets()).length, 1);
  await query(`UPDATE generations SET finished_at = now() - interval '3 minutes' WHERE id = $1`, [id]); // 60 s budget + 60 s grace
  assert.equal(await purgeFailedLeftovers(), 1);
  assert.equal((await assets()).length, 0, "MUTATSIYA: the orphan is gone");
  assert.equal(await purgeFailedLeftovers(), 0, "idempotent");
  const rest = await query<{ generation_id: string; asset_id: string }>(
    `SELECT generation_id::text AS generation_id, asset_id FROM generation_assets WHERE generation_id = ANY($1::uuid[]) ORDER BY generation_id`,
    [[done, workerFailed]],
  );
  assert.deepEqual(
    rest.sort((a, b) => a.generation_id.localeCompare(b.generation_id)),
    [{ generation_id: done, asset_id: doneAsset }, { generation_id: workerFailed, asset_id: ownAsset }].sort((a, b) => a.generation_id.localeCompare(b.generation_id)),
    "COMPLETED and worker-failed jobs untouched",
  );
});

// ───────────────────────────── ids and guard

test("ids: non-UUID or unknown → 404 not_found (never 500)", { skip }, async () => {
  const s = await session("owner");
  for (const id of ["abc", "1", "", "00000000-0000-0000-0000-00000000000g", "'; DROP TABLE generations; --"]) {
    for (const which of ["cancel", "fail", "refund"] as const) {
      const r = await call(which, s.cookie, id, REASON);
      assert.equal(r.status, 404, `MUTATSIYA: ${which} id=${JSON.stringify(id)} → ${r.status}`);
      assert.equal(r.body.code, "not_found");
    }
  }
  const unknown = randomUUID();
  for (const which of ["cancel", "fail", "refund"] as const) {
    const r = await call(which, s.cookie, unknown, REASON);
    assert.equal(r.status, 404);
    assert.equal(r.body.code, "not_found");
  }
  const u = await mkUser(1_000);
  const id = await enqueue(u.id, 100);
  for (const body of [{}, { reason: "kam" }, { reason: 5 }]) {
    assert.equal((await call("cancel", s.cookie, id, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await gen(id))!.status, "QUEUED");
});

test("guard: jobs.cancel (support yes; finance, moderator, viewer no), jobs.refund (moderator, viewer no), Origin, cloak", { skip }, async () => {
  const u = await mkUser(1_000);
  const id = await enqueue(u.id, 100);
  for (const role of ["finance", "moderator", "viewer"] as Role[]) {
    const s = await session(role);
    const r = await call("cancel", s.cookie, id, REASON);
    assert.equal(r.status, 403, `${role} cancel`);
    assert.equal(r.body.code, "forbidden");
    assert.equal((await call("fail", s.cookie, id, REASON)).status, 403, `${role} fail`);
    assert.equal((await audits(s.admin.adminId, "auth.denied")).length, 2);
  }
  for (const role of ["moderator", "viewer"] as Role[]) {
    const s = await session(role);
    assert.equal((await call("refund", s.cookie, id, REASON)).status, 403, `${role} refund`);
  }
  const support = await session("support");
  assert.equal((await call("refund", support.cookie, id, REASON)).status, 409, "support may refund (job is not FAILED → 409, not 403)");
  assert.equal((await call("cancel", support.cookie, id, REASON, { origin: false })).status, 403, "Origin is mandatory");
  const stale = await session("support", false);
  assert.equal((await call("cancel", stale.cookie, id, REASON)).status, 200, "jobs.cancel needs no step-up");
  const plain = await mkUser();
  const queued = await enqueue(u.id, 100);
  assert.equal((await call("cancel", `${SESSION_COOKIE}=${plain.userToken}`, queued, REASON)).status, 404, "non-admin → cloak");
  assert.equal((await call("cancel", null, queued, REASON)).status, 404, "anonymous → cloak");
  assert.equal((await gen(queued))!.status, "QUEUED");
});

/**
 * Phase 4 finding 3: the manual refund of the admin's OWN job is refused
 * (409 `self`, the wallet rule). Cancelling or failing one's own stuck job
 * stays allowed — that is ordinary operations, and its refund is the
 * worker's own path, not a discretionary money action. Mutation: drop the
 * self check in `refundJob` → 200.
 */
test("409 self: an admin cannot refund their own job; cancelling their own queued job is still allowed", { skip }, async () => {
  const s = await session("support");
  await query(`UPDATE users SET balance = 3_000 WHERE id = $1`, [s.admin.id]);
  const own = await enqueue(s.admin.id, 1_000);
  await query(`UPDATE generations SET status = 'FAILED', locked_by = NULL, error = 'Ish vaqti tugadi', finished_at = now() WHERE id = $1`, [own]);
  const r = await call("refund", s.cookie, own, REASON);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, "self");
  assert.equal((await refunds(own)).length, 0);
  assert.equal(await balance(s.admin.id), 2_000);
  assert.equal((await audits(s.admin.adminId, "jobs.refund")).length, 0);
  // Another admin with jobs.refund may refund it.
  const other = await session("finance");
  assert.equal((await call("refund", other.cookie, own, REASON)).status, 200);
  assert.equal(await balance(s.admin.id), 3_000);

  const queued = await enqueue(s.admin.id, 500);
  const c = await call("cancel", s.cookie, queued, REASON);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal((await gen(queued))!.status, "REVOKED");
});
