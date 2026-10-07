import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * `037_referrals.sql` (T3): additive, idempotent, rollback-able — on a
 * throwaway database of the same Postgres server.
 *
 * Mutations (each turned a test red, then restored):
 *   1. `referee_user_id` without UNIQUE → «UNIQUE on both referee keys»;
 *   2. `referee_telegram_id` without UNIQUE → same test;
 *   3. referee FK `ON DELETE CASCADE` → «the Telegram-id record outlives a deleted user row»;
 *   4. a backfill `UPDATE users SET ref_code = …` in the file → «additive only»;
 *   5. `IF NOT EXISTS` dropped from the table → «re-apply is a no-op».
 */

const DIR = path.resolve(new URL("../lib/server/migrations", import.meta.url).pathname);
const FILE = "037_referrals.sql";
const sql = readFileSync(path.join(DIR, FILE), "utf8");
const code = sql.replace(/^\s*--.*$/gm, "");

/** The commented `-- ROLLBACK` block (same reading as tests/admin-migrations.test.mts). */
function rollbackSql(): string {
  const lines = sql.split("\n");
  const start = lines.findIndex((l) => /^-- ROLLBACK\b/.test(l));
  assert.ok(start >= 0, "-- ROLLBACK bloki yo'q");
  const out: string[] = [];
  for (let i = start + 1; i < lines.length && lines[i]!.startsWith("--"); i++) {
    if (lines[i]!.startsWith("--   ")) out.push(lines[i]!.slice(5));
  }
  return out.join("\n");
}

test("037 is additive only: no UPDATE/DELETE/DROP/backfill, IF NOT EXISTS everywhere, lock_timeout, rollback lines", () => {
  const statements = code.split(";").map((s) => s.trim()).filter(Boolean);
  for (const s of statements) {
    assert.ok(!/^(UPDATE|DELETE|DROP|TRUNCATE|INSERT)\b/i.test(s), `MUTATSIYA 4: ${s.slice(0, 60)}`);
    assert.ok(!/^ALTER\b[\s\S]*\b(DROP|RENAME|TYPE)\b/i.test(s), `no destructive ALTER: ${s.slice(0, 60)}`);
  }
  for (const stmt of code.match(/\b(CREATE (UNIQUE )?(TABLE|INDEX)|ADD COLUMN)[^;]*/g) ?? []) {
    assert.match(stmt, /IF NOT EXISTS/, `MUTATSIYA 5: ${stmt.slice(0, 60)}`);
  }
  assert.match(sql, /^SET LOCAL lock_timeout = '5s';/m);
  for (const line of [
    "DROP TABLE IF EXISTS referrals;",
    "DROP INDEX IF EXISTS users_ref_code_idx;",
    "ALTER TABLE users DROP COLUMN IF EXISTS ref_code;",
    "ALTER TABLE login_tickets DROP COLUMN IF EXISTS ref_code;",
    `DELETE FROM schema_migrations WHERE name = '${FILE}';`,
  ]) {
    assert.ok(rollbackSql().split("\n").includes(line), `rollback line: ${line}`);
  }
});

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
const iso = hasDb ? await createIsolatedDb("refmig") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

test("037 on a fresh database: applies, re-applies, constraints hold, rollback block runs and the set re-applies", { skip }, async (t) => {
  const { migrate, pool, query, queryOne, transaction } = await import("../lib/server/db.ts");
  t.after(async () => {
    await pool().end().catch(() => {});
    await iso.drop();
  });
  const quiet = { lockRetryDelayMs: 50 };
  await migrate(quiet);
  const runSql = (s: string) => transaction(async (c) => void (await c.query(s)));
  const exists = async (rel: string) => (await queryOne<{ r: string | null }>("SELECT to_regclass($1)::text AS r", [rel]))!.r !== null;
  const column = async (table: string, col: string) =>
    Boolean(await queryOne("SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2", [table, col]));

  await t.test("schema: users.ref_code (unique), login_tickets.ref_code, referrals + index", async () => {
    assert.ok(await column("users", "ref_code"));
    assert.ok(await column("login_tickets", "ref_code"));
    assert.ok(await exists("referrals"));
    assert.ok(await exists("users_ref_code_idx"));
    assert.ok(await exists("referrals_referrer_created_idx"));
    // Existing users are untouched: the code is generated lazily.
    const filled = await queryOne<{ n: string }>("SELECT count(*)::text AS n FROM users WHERE ref_code IS NOT NULL");
    assert.equal(filled!.n, "0");
  });

  await t.test("re-apply is a no-op", async () => {
    await runSql(sql);
    await runSql(sql);
    assert.ok(await exists("referrals"));
  });

  const user = async (tg: number, name: string) =>
    (await queryOne<{ id: string }>("INSERT INTO users (telegram_id, name) VALUES ($1, $2) RETURNING id::text AS id", [tg, name]))!.id;

  await t.test("UNIQUE on both referee keys, no self row, source checked; users.ref_code unique", async () => {
    const a = await user(910_000_001, "A");
    const b = await user(910_000_002, "B");
    const c = await user(910_000_003, "C");
    await query("INSERT INTO referrals (referee_user_id, referee_telegram_id, referrer_user_id, source) VALUES ($1, 910000002, $2, 'bot')", [b, a]);
    await assert.rejects(
      query("INSERT INTO referrals (referee_user_id, referee_telegram_id, referrer_user_id, source) VALUES ($1, 910000099, $2, 'bot')", [b, c]),
      /referrals_referee_user_id_key/,
      "MUTATSIYA 1",
    );
    await assert.rejects(
      query("INSERT INTO referrals (referee_user_id, referee_telegram_id, referrer_user_id, source) VALUES ($1, 910000002, $2, 'bot')", [c, a]),
      /referrals_referee_telegram_id_key/,
      "MUTATSIYA 2",
    );
    await assert.rejects(
      query("INSERT INTO referrals (referee_user_id, referee_telegram_id, referrer_user_id, source) VALUES ($1, 910000003, $1, 'bot')", [c]),
      /referrals_not_self/,
    );
    await assert.rejects(
      query("INSERT INTO referrals (referee_user_id, referee_telegram_id, referrer_user_id, source) VALUES ($1, 910000003, $2, 'sms')", [c, a]),
      /referrals_source_check/,
    );
    await query("UPDATE users SET ref_code = 'abcdefgh' WHERE id = $1", [a]);
    await assert.rejects(query("UPDATE users SET ref_code = 'abcdefgh' WHERE id = $1", [b]), /users_ref_code_idx/);
  });

  await t.test("the Telegram-id record outlives a deleted user row (SET NULL), and still blocks a second row", async () => {
    const r = await queryOne<{ referee_user_id: string }>("SELECT referee_user_id::text AS referee_user_id FROM referrals WHERE referee_telegram_id = 910000002");
    await query("DELETE FROM users WHERE id = $1", [r!.referee_user_id]);
    const kept = await queryOne<{ referee_user_id: string | null }>("SELECT referee_user_id FROM referrals WHERE referee_telegram_id = 910000002");
    assert.ok(kept, "MUTATSIYA 3: the record survives");
    assert.equal(kept.referee_user_id, null);
    const again = await user(910_000_002, "B qaytdi");
    const a = (await queryOne<{ id: string }>("SELECT id::text AS id FROM users WHERE telegram_id = 910000001"))!.id;
    await assert.rejects(
      query("INSERT INTO referrals (referee_user_id, referee_telegram_id, referrer_user_id, source) VALUES ($1, 910000002, $2, 'bot')", [again, a]),
      /referrals_referee_telegram_id_key/,
    );
  });

  await t.test("rollback block removes everything 037 added; migrate re-applies it", async () => {
    await runSql(rollbackSql());
    assert.ok(!(await exists("referrals")));
    assert.ok(!(await exists("users_ref_code_idx")));
    assert.ok(!(await column("users", "ref_code")));
    assert.ok(!(await column("login_tickets", "ref_code")));
    assert.ok(!(await queryOne("SELECT 1 FROM schema_migrations WHERE name = $1", [FILE])));
    await migrate(quiet);
    assert.ok(await exists("referrals"));
    assert.ok(await column("users", "ref_code"));
  });
});
