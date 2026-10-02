import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Migration 034 (docs/SUBS-REMOVAL.md §4): Pro quota → balance, on a real
 * Postgres in a separate throwaway database.
 *
 *  1. 001–033 apply; users are seeded with ledger-consistent history (quota
 *     from `admin_credit` and from a historical `subscription`, charges and
 *     refunds that touched quota, topups, points, a fully spent subscription,
 *     a user without quota).
 *  2. 034 applies: every wallet column equals the sum of its ledger column,
 *     points + quota + balance is unchanged per user, quota is 0 everywhere,
 *     exactly one `quota_merge` row and one audit row per affected user and
 *     none for the others.
 *  3. Re-running the SQL is a no-op (also when quota reappears for a merged
 *     user: it is left for the sweep, never merged twice or failing).
 *  4. The kind CHECK holds every earlier kind plus `quota_merge`, is
 *     validated, and still rejects unknown kinds.
 *  5. The commented ROLLBACK block runs: wallets return to their exact
 *     pre-merge values, sums still match, audit rows stay and a compensating
 *     revert row is written; re-applying merges again.
 *
 * Mutations that turn this red (checked by hand): the merge without its
 * ledger row (invariant), a reference without the user id (the migration
 * hits UNIQUE(kind, reference) with two holders; distinct-reference check),
 * `quota = 0` dropped from the UPDATE, the NOT EXISTS re-run guard dropped
 * (re-run after quota reappears fails on the unique index).
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";

const iso = hasDb ? await createIsolatedDb("qmerge") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

const DIR = path.resolve(new URL("../lib/server/migrations", import.meta.url).pathname);
const FILE = "034_quota_merge.sql";
const ALL = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = (f: string) => readFileSync(path.join(DIR, f), "utf8");

/** Same convention as tests/admin-migrations.test.mts: indented comment lines after `-- ROLLBACK`. */
function rollbackSql(file: string): string {
  const lines = sqlOf(file).split("\n");
  const start = lines.findIndex((l) => /^-- ROLLBACK\b/.test(l));
  assert.ok(start >= 0, `${file}: -- ROLLBACK bloki yo'q`);
  const out: string[] = [];
  for (let i = start + 1; i < lines.length && lines[i].startsWith("--"); i++) {
    if (lines[i].startsWith("--   ")) out.push(lines[i].slice(5));
  }
  assert.ok(out.length > 0, `${file}: rollback bloki bo'sh`);
  return out.join("\n");
}

/** Kinds listed in the `kind IN (...)` of a SQL fragment. */
const kindsIn = (sql: string) => [...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

test("034: fayl shakli — lock_timeout, rollback bloki, to'liq kind ro'yxati", () => {
  assert.ok(ALL.includes(FILE), `${FILE} yo'q`);
  const sql = sqlOf(FILE);
  assert.match(sql, /^SET LOCAL lock_timeout = '5s';/m);
  assert.match(rollbackSql(FILE), /DELETE FROM schema_migrations WHERE name = '034_quota_merge\.sql';\s*$/);

  // The widened list = every kind an earlier migration allowed on transactions
  // (001's inline CHECK and every later transactions_kind_check) + quota_merge.
  const earlier = new Set<string>();
  const init = sqlOf("001_init.sql").match(/CREATE TABLE IF NOT EXISTS transactions \(([\s\S]*?)\n\);/);
  assert.ok(init, "001: transactions jadvali topilmadi");
  for (const m of init[1].matchAll(/CHECK \(kind IN \(([^)]*)\)\)/g)) for (const k of kindsIn(m[1])) earlier.add(k);
  let redefinitions = 0;
  for (const f of ALL.filter((f) => f > "001_" && f < FILE)) {
    const code = sqlOf(f).replace(/^\s*--.*$/gm, "");
    for (const m of code.matchAll(/ADD CONSTRAINT transactions_kind_check\s+CHECK \(kind IN \(([^)]*)\)\)/g)) {
      redefinitions++;
      for (const k of kindsIn(m[1])) earlier.add(k);
    }
  }
  assert.equal(redefinitions, 1, "008 dan boshqa kind o'zgarishi bor — ro'yxatni qayta tekshiring");
  const code = sql.replace(/^\s*--.*$/gm, "");
  const add = code.match(/ADD CONSTRAINT transactions_kind_check\s+CHECK \(kind IN \(([^)]*)\)\)\s+NOT VALID;/);
  assert.ok(add, "CHECK NOT VALID bilan qo'shilmagan");
  const widened = kindsIn(add[1]);
  assert.deepEqual(widened, ["charge", "refund", "topup", "bonus", "subscription", "admin_credit", "admin_debit", "quota_merge"]);
  assert.deepEqual([...widened].sort(), [...earlier, "quota_merge"].sort(), "oldingi kind tushib qoldi yoki ortiqcha");
  assert.match(code, /ALTER TABLE transactions VALIDATE CONSTRAINT transactions_kind_check;/);
  // The rollback restores exactly the pre-034 list.
  const back = rollbackSql(FILE).match(/ADD CONSTRAINT transactions_kind_check\s+CHECK \(kind IN \(([^)]*)\)\)/);
  assert.ok(back);
  assert.deepEqual(kindsIn(back[1]), widened.filter((k) => k !== "quota_merge"));
});

type Wallet = { points: number; quota: number; balance: number };

test("034: kvota → balans (haqiqiy Postgres)", { skip }, async (t) => {
  const { migrate, pool, query, queryOne, transaction } = await import("../lib/server/db.ts");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "slaydx-qmerge-"));
  t.after(async () => {
    rmSync(tmp, { recursive: true, force: true });
    await pool().end().catch(() => {});
    await iso.drop();
  });
  const quiet = { lockRetryDelayMs: 50 };
  const runSql = (sql: string) => transaction(async (c) => void (await c.query(sql)));
  const applied = async () =>
    (await query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name")).map((r) => r.name);

  // --- 1. Pre-034 state ------------------------------------------------------
  for (const f of ALL.filter((f) => f < FILE)) copyFileSync(path.join(DIR, f), path.join(tmp, f));
  await migrate({ dir: tmp, ...quiet });
  assert.equal((await applied()).at(-1), "033_ai_usage.sql");

  type Move = { kind: string; points?: number; quota?: number; balance?: number };
  /** Inserts the ledger rows and sets the wallet to their sums (as the app does). */
  const seedUser = async (name: string, moves: Move[]) => {
    const id = (await queryOne<{ id: string }>(
      "INSERT INTO users (username, name) VALUES ($1, $2) RETURNING id::text AS id",
      [`qm_${name}`, name],
    ))!.id;
    for (const m of moves) {
      await query(
        `INSERT INTO transactions (user_id, kind, points_delta, quota_delta, balance_delta, reference, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, m.kind, m.points ?? 0, m.quota ?? 0, m.balance ?? 0, `${m.kind}:${randomUUID()}`, `seed ${name}`],
      );
    }
    await query(
      `UPDATE users u SET points = l.p, quota = l.q, balance = l.b
         FROM (SELECT COALESCE(sum(points_delta), 0) AS p, COALESCE(sum(quota_delta), 0) AS q,
                      COALESCE(sum(balance_delta), 0) AS b
                 FROM transactions WHERE user_id = $1) l
        WHERE u.id = $1`,
      [id],
    );
    return id;
  };

  const users = {
    // Quota granted by an admin, then charges split across quota and balance, and a refund.
    credit: await seedUser("credit", [
      { kind: "bonus", points: 50 },
      { kind: "topup", balance: 20_000 },
      { kind: "admin_credit", quota: 500_000 },
      { kind: "charge", points: -50, quota: -3_000 },
      { kind: "charge", quota: -2_000, balance: -1_000 },
      { kind: "refund", quota: 2_000, balance: 1_000 },
    ]),
    // Historical Pro subscription, partly spent, partial refund into quota.
    sub: await seedUser("sub", [
      { kind: "subscription", quota: 300_000 },
      { kind: "charge", quota: -12_000 },
      { kind: "refund", quota: 4_000 },
      { kind: "admin_debit", quota: -1_000 },
    ]),
    // Subscription fully spent: quota 0 → not touched.
    spent: await seedUser("spent", [
      { kind: "subscription", quota: 15_000 },
      { kind: "charge", quota: -15_000 },
      { kind: "topup", balance: 5_000 },
    ]),
    // Never had quota.
    plain: await seedUser("plain", [{ kind: "bonus", points: 100 }, { kind: "topup", balance: 7_000 }]),
    empty: await seedUser("empty", []),
  };
  const affected = [users.credit, users.sub];
  const unaffected = [users.spent, users.plain, users.empty];

  const wallets = async () =>
    new Map(
      (await query<{ id: string; points: string; quota: string; balance: string }>(
        "SELECT id::text AS id, points, quota, balance FROM users ORDER BY id",
      )).map((r) => [r.id, { points: Number(r.points), quota: Number(r.quota), balance: Number(r.balance) } satisfies Wallet]),
    );
  /** Users whose wallet differs from the ledger sums (admin-finance walletLedgerMismatch). */
  const mismatches = () =>
    query<{ id: string }>(
      `SELECT u.id::text AS id FROM users u
         LEFT JOIN (SELECT user_id, sum(points_delta) AS p, sum(quota_delta) AS q, sum(balance_delta) AS b
                      FROM transactions GROUP BY user_id) l ON l.user_id = u.id
        WHERE (u.points, u.quota, u.balance) IS DISTINCT FROM (COALESCE(l.p, 0), COALESCE(l.q, 0), COALESCE(l.b, 0))`,
    );
  const mergeRows = () =>
    query<{ id: string; user_id: string; points_delta: string; quota_delta: string; balance_delta: string; reference: string; note: string }>(
      `SELECT id::text AS id, user_id::text AS user_id, points_delta, quota_delta, balance_delta, reference, note
         FROM transactions WHERE kind = 'quota_merge' ORDER BY id`,
    );
  type Audit = {
    id: string;
    admin_id: string | null;
    action: string;
    target_type: string;
    target_id: string;
    outcome: string;
    reason: string | null;
    before: Record<string, number>;
    after: Record<string, number>;
    meta: Record<string, unknown>;
  };
  const audits = (action: string) =>
    query<Audit>(
      `SELECT id::text AS id, admin_id, action, target_type, target_id, outcome, reason, before, after, meta
         FROM admin_audit_log WHERE action = $1 ORDER BY id`,
      [action],
    );

  assert.deepEqual(await mismatches(), [], "urug' jurnal bilan mos emas");
  const before = await wallets();
  assert.equal(before.get(users.credit)!.quota, 497_000);
  assert.equal(before.get(users.sub)!.quota, 291_000);
  assert.equal(before.get(users.spent)!.quota, 0);

  const assertMerged = async (label: string) => {
    const now = await wallets();
    assert.deepEqual(await mismatches(), [], `${label}: hamyon ≠ jurnal yig'indisi`);
    for (const [id, w] of before) {
      const a = now.get(id)!;
      assert.equal(a.quota, 0, `${label}: ${id} kvota 0 emas`);
      assert.equal(a.points, w.points, `${label}: ${id} ball o'zgardi`);
      assert.equal(a.balance, w.balance + w.quota, `${label}: ${id} balans`);
      assert.equal(a.points + a.quota + a.balance, w.points + w.quota + w.balance, `${label}: ${id} jami qiymat`);
    }
    const n = await queryOne<{ n: string }>("SELECT count(*) AS n FROM users WHERE quota > 0");
    assert.equal(n!.n, "0");
  };

  // --- 2. Apply 034 ------------------------------------------------------------
  await t.test("034 qo'llanadi: invariant, jami qiymat, kvota 0", async () => {
    await migrate(quiet);
    assert.deepEqual(await applied(), ALL);
    await assertMerged("034");
  });

  let mergeIds = new Map<string, string>();
  await t.test("har ta'sirlangan foydalanuvchiga aynan bitta ledger va bitta audit qatori", async () => {
    const rows = await mergeRows();
    assert.deepEqual(rows.map((r) => r.user_id).sort(), [...affected].sort(), "faqat kvotasi borlar");
    assert.equal(new Set(rows.map((r) => r.reference)).size, rows.length, "reference takrorlandi");
    for (const r of rows) {
      const q = before.get(r.user_id)!.quota;
      assert.equal(Number(r.quota_delta), -q);
      assert.equal(Number(r.balance_delta), q);
      assert.equal(Number(r.points_delta), 0);
      assert.equal(r.reference, `quota-merge:${r.user_id}`);
      assert.equal(r.note, `Kvota balansga o'tkazildi: ${q} tanga`);
    }
    mergeIds = new Map(rows.map((r) => [r.user_id, r.id]));

    const log = await audits("users.wallet.quota_merge");
    assert.deepEqual(log.map((a) => a.target_id).sort(), [...affected].sort());
    for (const a of log) {
      const w = before.get(a.target_id)!;
      assert.equal(a.admin_id, null);
      assert.equal(a.target_type, "user");
      assert.equal(a.outcome, "ok");
      assert.equal(a.reason, "Obuna olib tashlandi");
      assert.deepEqual(a.before, { quota: w.quota, balance: w.balance });
      assert.deepEqual(a.after, { quota: 0, balance: w.balance + w.quota });
      assert.deepEqual(a.meta, { via: "migration 034", transactionId: mergeIds.get(a.target_id) });
    }
    for (const id of unaffected) {
      assert.ok(!rows.some((r) => r.user_id === id), `${id}: ortiqcha ledger qatori`);
      assert.ok(!log.some((a) => a.target_id === id), `${id}: ortiqcha audit qatori`);
    }
  });

  await t.test("UNIQUE(kind, reference): bir foydalanuvchiga ikkinchi merge qatori yozilmaydi", async () => {
    await assert.rejects(
      query(
        `INSERT INTO transactions (user_id, kind, quota_delta, balance_delta, reference)
         VALUES ($1, 'quota_merge', 0, 0, $2)`,
        [users.credit, `quota-merge:${users.credit}`],
      ),
      (e: Error & { code?: string }) => e.code === "23505",
    );
  });

  await t.test("qayta ishga tushirish no-op (kvota egasi qolmagan baza)", async () => {
    const w = await wallets();
    const auditN = (await audits("users.wallet.quota_merge")).length;
    await runSql(sqlOf(FILE));
    await runSql(sqlOf(FILE));
    assert.deepEqual(await wallets(), w);
    assert.deepEqual((await mergeRows()).map((r) => r.id), [...mergeIds.values()].sort((a, b) => Number(a) - Number(b)));
    assert.equal((await audits("users.wallet.quota_merge")).length, auditN);
    await assertMerged("re-run");
  });

  await t.test("kind CHECK: quota_merge qabul, noma'lum kind rad, constraint tasdiqlangan", async () => {
    const def = await queryOne<{ def: string; valid: boolean }>(
      `SELECT pg_get_constraintdef(oid) AS def, convalidated AS valid FROM pg_constraint
        WHERE conrelid = 'transactions'::regclass AND conname = 'transactions_kind_check'`,
    );
    assert.ok(def);
    assert.equal(def.valid, true, "VALIDATE bajarilmagan");
    for (const k of ["charge", "refund", "topup", "bonus", "subscription", "admin_credit", "admin_debit", "quota_merge"]) {
      assert.match(def.def, new RegExp(`'${k}'`), `${k} yo'q`);
    }
    const n = await queryOne<{ n: string }>(
      "SELECT count(*) AS n FROM pg_constraint WHERE conrelid = 'transactions'::regclass AND contype = 'c'",
    );
    assert.equal(n!.n, "1", "eski kind CHECK qolib ketdi");
    // Accepted: the insert succeeds, the sentinel rolls it back.
    await assert.rejects(
      transaction(async (c) => {
        await c.query(
          `INSERT INTO transactions (user_id, kind, reference) VALUES ($1, 'quota_merge', $2)`,
          [users.empty, `probe:${randomUUID()}`],
        );
        throw new Error("probe-rollback");
      }),
      /probe-rollback/,
    );
    await assert.rejects(
      query(`INSERT INTO transactions (user_id, kind) VALUES ($1, 'quota_bogus')`, [users.empty]),
      /transactions_kind_check/,
    );
  });

  // --- 3. Rollback --------------------------------------------------------------
  await t.test("ROLLBACK bloki: hamyonlar va yig'indilar avvalgidek, audit qoladi + revert qatori", async () => {
    const mergeAudit = (await audits("users.wallet.quota_merge")).map((a) => a.id);
    await runSql(rollbackSql(FILE));
    assert.deepEqual(await wallets(), before, "hamyonlar tiklanmadi");
    assert.deepEqual(await mismatches(), [], "rollbackdan keyin hamyon ≠ jurnal");
    assert.deepEqual(await mergeRows(), []);
    assert.ok(!(await applied()).includes(FILE), "schema_migrations qatori qoldi");
    assert.deepEqual((await audits("users.wallet.quota_merge")).map((a) => a.id), mergeAudit, "audit append-only");
    const revert = await audits("users.wallet.quota_merge_revert");
    assert.deepEqual(revert.map((a) => a.target_id).sort(), [...affected].sort());
    for (const a of revert) {
      const w = before.get(a.target_id)!;
      assert.equal(a.admin_id, null);
      assert.deepEqual(a.before, { quota: 0, balance: w.balance + w.quota });
      assert.deepEqual(a.after, { quota: w.quota, balance: w.balance });
      assert.deepEqual(a.meta, { via: "migration 034 rollback", transactionIds: [mergeIds.get(a.target_id)] });
    }
    await assert.rejects(
      query(`INSERT INTO transactions (user_id, kind, reference) VALUES ($1, 'quota_merge', 'x')`, [users.empty]),
      /transactions_kind_check/,
    );

    await migrate(quiet);
    assert.deepEqual(await applied(), ALL);
    await assertMerged("re-apply");
    assert.equal((await mergeRows()).length, affected.length);
    assert.equal((await audits("users.wallet.quota_merge")).length, 2 * affected.length);
  });

  // --- 4. Quota that reappears after the merge ------------------------------------
  await t.test("merge'dan keyin kvota qaytsa: qayta ishga tushirish yiqilmaydi, ikkinchi marta qo'shmaydi", async () => {
    // An old container refunds a pre-merge charge into quota during the deploy swap.
    await query(
      `INSERT INTO transactions (user_id, kind, quota_delta, reference) VALUES ($1, 'refund', 1500, $2)`,
      [users.sub, `refund:${randomUUID()}`],
    );
    await query("UPDATE users SET quota = quota + 1500 WHERE id = $1", [users.sub]);
    const w = await wallets();
    const rows = (await mergeRows()).map((r) => r.id);
    await runSql(sqlOf(FILE));
    assert.deepEqual(await wallets(), w, "qayta ishga tushirish hamyonni o'zgartirdi");
    assert.deepEqual((await mergeRows()).map((r) => r.id), rows);
    assert.deepEqual(await mismatches(), []);
    assert.equal(w.get(users.sub)!.quota, 1500, "sweep uchun qoldi");
  });
});
