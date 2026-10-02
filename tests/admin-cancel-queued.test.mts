import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import type { AdminActor } from "../lib/server/admin-handler.ts";

/**
 * `cancelQueuedInTx` (lib/server/admin-job-actions.ts): the one transaction-
 * scoped "cancel a queued job" step shared by the admin cancel route (F6) and
 * blocking a user with "cancel queued jobs" (WP2). The route-level behavior is
 * covered by tests/admin-job-actions.test.mts and tests/admin-users.test.mts;
 * this file pins the primitive itself.
 *
 * Mutation checks (each made the named assertion fail, then restored):
 *   - dropping `AND status = 'QUEUED'` from the UPDATE → the second call reports
 *     `cancelled: true` and the claimed IN_PROGRESS job is revoked;
 *   - skipping `refundInTx` → `refunded` is null and the balance stays debited
 *     (the F6 cancel and the WP2 block tests fail too).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "DATABASE_URL yo'q";

// Own database: `claimJob` takes the oldest QUEUED job globally.
const iso = hasDb ? await createIsolatedDb("cancelq") : { isolated: false, drop: async () => {} };

const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const jobs = await import("../lib/server/jobs.ts");
const { ADMIN_CANCEL_NOTE, cancelQueuedInTx } = await import("../lib/server/admin-job-actions.ts");
const { setUserBlocked } = await import("../lib/server/admin-users.ts");

after(async () => {
  if (!hasDb) return;
  await pool().end();
  await iso.drop();
});

if (hasDb) await ensureMigrated();

async function mkUser(balance: number, points = 0): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, points, quota, balance) VALUES ($1, $2, 'Cancel Test', $3, 0, $4) RETURNING id::text AS id`,
    [String(randomInt(5_000_000_000, 9_000_000_000)), `cq_${randomBytes(5).toString("hex")}`, points, balance],
  );
  return row!.id;
}

async function enqueue(userId: string, price: number): Promise<string> {
  const res = await jobs.enqueueGeneration({
    userId,
    toolId: "referat",
    topic: "Bekor qilish sinovi",
    price,
    format: "docx",
    values: { topic: "Bekor qilish sinovi" } as never,
    budgetMs: 60_000,
  });
  assert.ok(res.ok, `enqueue: ${JSON.stringify(res)}`);
  return res.id;
}

const balance = async (uid: string) => Number((await queryOne<{ balance: string }>(`SELECT balance FROM users WHERE id = $1`, [uid]))!.balance);
const status = async (id: string) => (await queryOne<{ status: string }>(`SELECT status FROM generations WHERE id = $1`, [id]))!.status;
const refundRows = (id: string) => query<{ note: string | null }>(`SELECT note FROM transactions WHERE kind = 'refund' AND reference = $1`, [id]);

test("cancelQueuedInTx: QUEUED → REVOKED with the refund split; a second call is a no-op", { skip }, async () => {
  const uid = await mkUser(5_000, 300);
  const id = await enqueue(uid, 1_000); // 300 points + 700 balance
  assert.equal(await balance(uid), 4_300);

  const first = await transaction((c) => cancelQueuedInTx(c, { id, userId: uid }));
  assert.deepEqual(first, { cancelled: true, refunded: { points: 300, quota: 0, balance: 700 } });
  assert.equal(await status(id), "REVOKED");
  assert.equal(await balance(uid), 5_000);
  const rows = await refundRows(id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.note, ADMIN_CANCEL_NOTE);

  const again = await transaction((c) => cancelQueuedInTx(c, { id, userId: uid }));
  assert.deepEqual(again, { cancelled: false, refunded: null });
  assert.equal((await refundRows(id)).length, 1, "never refunded twice");
  assert.equal(await balance(uid), 5_000);
});

test("cancelQueuedInTx: a job the worker already claimed is left alone and not refunded", { skip }, async () => {
  const uid = await mkUser(2_000);
  const id = await enqueue(uid, 500);
  const claimed = await jobs.claimJob(jobs.newLease("w-cancelq"));
  assert.equal(claimed?.id, id);

  const r = await transaction((c) => cancelQueuedInTx(c, { id, userId: uid }));
  assert.deepEqual(r, { cancelled: false, refunded: null });
  assert.equal(await status(id), "IN_PROGRESS");
  assert.equal((await refundRows(id)).length, 0);
  assert.equal(await balance(uid), 1_500);
});

test("cancelQueuedInTx: a free job is cancelled with nothing to refund; a rollback undoes everything", { skip }, async () => {
  const uid = await mkUser(1_000);
  const free = await enqueue(uid, 0);
  assert.deepEqual(await transaction((c) => cancelQueuedInTx(c, { id: free, userId: uid })), { cancelled: true, refunded: null });
  assert.equal(await status(free), "REVOKED");

  const paid = await enqueue(uid, 400);
  await assert.rejects(
    transaction(async (c) => {
      await cancelQueuedInTx(c, { id: paid, userId: uid });
      throw new Error("rollback");
    }),
    /rollback/,
  );
  assert.equal(await status(paid), "QUEUED", "runs inside the caller's transaction");
  assert.equal((await refundRows(paid)).length, 0);
  assert.equal(await balance(uid), 600);
});

// ───────────────────────────── lock order (P4 money review, finding 1)

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

async function mkActor(): Promise<AdminActor> {
  const userId = await mkUser(0);
  const acc = await queryOne<{ id: string }>(
    `INSERT INTO admin_accounts (user_id, role, status, totp_enabled_at, totp_secret_enc)
     VALUES ($1, 'owner', 'active', now(), 'v1.fixture-never-opened') RETURNING id::text AS id`,
    [userId],
  );
  return { id: acc!.id, userId, role: "owner", permissions: [], sessionId: "0", ip: "10.0.0.1", userAgent: null, requestId: null, user: {} as never, session: {} as never };
}

/**
 * Deterministic version of the race the review reproduced: block(cancelQueued)
 * against the user's own DELETE of a queued job. Every other money path locks
 * generations → users (`cancelGeneration`, queue-ttl, reconcile, admin
 * cancel/fail, `commitJobResult`); the block must do the same, otherwise the
 * two wait on each other and one dies with 40P01 (a 500, nothing cancelled).
 *
 * Interleaving, forced with a row-lock barrier on the LOWER-id job (the block
 * locks `ORDER BY id`, so it stops there before reaching the higher one):
 *   1. the barrier holds job `lo`;
 *   2. the block starts and waits on `lo`;
 *   3. the user cancels `hi`: it locks `hi`, then needs the users row —
 *      with the old order the block already holds it (deadlock once the
 *      barrier lifts); with the fixed order the cancel just completes;
 *   4. the barrier lifts.
 * Mutation check: locking the users row before the jobs again → one side is
 * rejected with 40P01.
 */
test("setUserBlocked(cancelQueued) vs the user's own cancel: no deadlock, exactly one refund per job", { skip }, async () => {
  const actor = await mkActor();
  const uid = await mkUser(10_000);
  const [lo, hi] = [await enqueue(uid, 1_000), await enqueue(uid, 1_000)].sort();
  assert.equal(await balance(uid), 8_000);

  const barrier = await pool().connect();
  let block: Promise<unknown> | undefined;
  let cancel: Promise<boolean> | undefined;
  try {
    await barrier.query("BEGIN");
    await barrier.query(`SELECT 1 FROM generations WHERE id = $1 FOR UPDATE`, [lo]);
    block = setUserBlocked(actor, uid, { blocked: true, reason: "Poyga sinovi", revokeSessions: false, cancelQueued: true, revokeLinks: false });
    await waitForLockWaiters(1);
    cancel = jobs.cancelGeneration(hi, uid);
    // Old order: the cancel holds `hi` and waits on the users row (2 waiters). Fixed order: it finishes.
    await Promise.race([waitForLockWaiters(2), cancel]);
  } finally {
    await barrier.query("ROLLBACK").catch(() => {});
    barrier.release();
  }
  const [b, c] = await Promise.allSettled([block!, cancel!]);
  assert.equal(b.status, "fulfilled", `block: ${b.status === "rejected" ? String((b.reason as Error).message) : ""}`);
  assert.equal(c.status, "fulfilled", `cancel: ${c.status === "rejected" ? String((c.reason as Error).message) : ""}`);
  assert.equal(c.status === "fulfilled" && c.value, true, "the user's cancel of `hi` wins");
  const effects = (b as PromiseFulfilledResult<{ sideEffects: { jobsCancelled: number; refunds: number } }>).value.sideEffects;
  assert.deepEqual({ jobsCancelled: effects.jobsCancelled, refunds: effects.refunds }, { jobsCancelled: 1, refunds: 1 }, "the block cancels only `lo`");

  assert.equal(await status(lo), "REVOKED");
  assert.equal(await status(hi), "REVOKED");
  assert.equal((await refundRows(lo)).length, 1);
  assert.equal((await refundRows(hi)).length, 1);
  assert.equal(await balance(uid), 10_000, "each job refunded exactly once");
  assert.equal((await queryOne<{ is_blocked: boolean }>(`SELECT is_blocked FROM users WHERE id = $1`, [uid]))!.is_blocked, true);
});
