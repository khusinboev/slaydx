import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

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
