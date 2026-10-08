import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Admin panel migrations 028–033 (docs/admin/02-plan.md §5.1–§5.4, §17.7) on
 * a real Postgres, in a separate throwaway database.
 *
 *  1. 001–030 apply on a fresh DB; legacy admin ledger rows are seeded in the
 *     pre-031 shape (`admin:<phone>` / `admin:<userId>` [+ ": text"]), then
 *     the full set applies (031–033).
 *  2. 031 copies each legacy row into the audit log and scrubs the note; a
 *     re-run neither duplicates audit rows nor rewrites notes again.
 *  3. admin_audit_log rejects UPDATE, DELETE and TRUNCATE.
 *  4. Every new file is safe to re-run (IF NOT EXISTS / OR REPLACE).
 *  5. The commented ROLLBACK block of each new file actually runs: 031 alone
 *     restores the notes (and re-applying reuses the audit rows), then
 *     033→028 drop everything cleanly and the full set re-applies.
 *
 * Mutations that turn this red: removing the TRUNCATE trigger; dropping the
 * NOT EXISTS guard in 031 (duplicate audit rows); scrubbing without the
 * free-text part; a rollback block that leaves a table/row behind.
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";

const iso = hasDb ? await createIsolatedDb("admmig") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

const DIR = path.resolve(new URL("../lib/server/migrations", import.meta.url).pathname);
const ALL = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const NEW = [
  "028_admin_core.sql",
  "029_admin_ops.sql",
  "030_admin_indexes.sql",
  "031_admin_legacy_notes.sql",
  "032_pricing.sql",
  "033_ai_usage.sql",
];
const sqlOf = (f: string) => readFileSync(path.join(DIR, f), "utf8");

/**
 * The commented `-- ROLLBACK` block: the comment lines right after the header
 * whose text is indented by at least three spaces are the SQL (continuation
 * lines keep their extra indentation). The block ends at the first non-comment
 * line (`SET LOCAL lock_timeout` follows it in every file).
 */
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

const NEW_TABLES = [
  "admin_accounts",
  "admin_enrollments",
  "admin_recovery_codes",
  "admin_sessions",
  "admin_audit_log",
  "app_settings",
  "error_log",
  "process_heartbeats",
  "housekeeping_status",
  "broadcasts",
  "broadcast_recipients",
  "payment_refunds",
  "tool_pricing",
  "tool_price_history",
  "ai_usage",
];
const NEW_INDEXES = [
  "users_created_idx",
  "users_username_lower_idx",
  "users_name_lower_idx",
  "users_blocked_idx",
  "generations_created_idx",
  "generations_status_created_idx",
  "generations_tool_created_idx",
  "transactions_created_idx",
  "transactions_kind_created_idx",
  "payment_orders_created_idx",
  "payment_orders_state_created_idx",
  "payment_orders_paid_perform_idx",
  "game_sessions_created_idx",
];

test("ROLLBACK bloklari: har yangi faylda bor va schema_migrations qatorini o'chiradi", () => {
  for (const f of NEW) {
    assert.ok(ALL.includes(f), `${f} yo'q`);
    const sql = rollbackSql(f);
    assert.match(sql, new RegExp(`DELETE FROM schema_migrations WHERE name = '${f.replace(".", "\\.")}';\\s*$`), f);
    assert.match(sqlOf(f), /^SET LOCAL lock_timeout = '5s';/m, `${f}: lock_timeout yo'q`);
  }
  // 030 — faqat indekslar; har indeksning rollback qatori bor.
  const idx = sqlOf("030_admin_indexes.sql").replace(/^\s*--.*$/gm, "");
  assert.ok(!/\b(ALTER|DROP|UPDATE|DELETE|INSERT|TABLE)\b/i.test(idx), "030 indeksdan boshqa narsani o'zgartiradi");
  const names = [...idx.matchAll(/CREATE INDEX IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...names].sort(), [...NEW_INDEXES].sort());
  for (const n of names) assert.match(rollbackSql("030_admin_indexes.sql"), new RegExp(`DROP INDEX IF EXISTS ${n};`));
});

test("admin migratsiyalari 028–033 (haqiqiy Postgres)", { skip }, async (t) => {
  const { migrate, pool, query, queryOne, transaction } = await import("../lib/server/db.ts");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "slaydx-mig-"));
  t.after(async () => {
    rmSync(tmp, { recursive: true, force: true });
    await pool().end().catch(() => {});
    await iso.drop();
  });
  const quiet = { lockRetryDelayMs: 50 };
  const runSql = (sql: string) => transaction(async (c) => void (await c.query(sql)));
  const exists = async (rel: string) =>
    (await queryOne<{ r: string | null }>("SELECT to_regclass($1)::text AS r", [rel]))!.r !== null;
  const applied = async () =>
    (await query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name")).map((r) => r.name);

  // --- 1. Pre-031 state: 001–030 only -------------------------------------
  for (const f of ALL.filter((f) => f < "031_")) copyFileSync(path.join(DIR, f), path.join(tmp, f));
  await migrate({ dir: tmp, ...quiet });
  assert.equal((await applied()).at(-1), "030_admin_indexes.sql");

  const phone = "+998901112233";
  const adminUser = (await queryOne<{ id: string }>(
    "INSERT INTO users (username, name, phone) VALUES ('legacy_admin', 'Admin', $1) RETURNING id",
    [phone],
  ))!.id;
  const victim = (await queryOne<{ id: string }>(
    "INSERT INTO users (username, name) VALUES ('legacy_user', 'Foydalanuvchi') RETURNING id",
  ))!.id;

  type Seed = { name: string; kind: string; note: string | null; expected: string | null; legacy: boolean };
  const seeds: Seed[] = [
    { name: "phone+text", kind: "admin_credit", note: `admin:${phone}: Bonus uchun`, expected: "Ma'muriy tuzatish: Bonus uchun", legacy: true },
    { name: "phone", kind: "admin_debit", note: `admin:${phone}`, expected: "Ma'muriy tuzatish", legacy: true },
    { name: "id+multiline", kind: "admin_credit", note: `admin:${adminUser}: birinchi qator\nikkinchi: qator`, expected: "Ma'muriy tuzatish: birinchi qator\nikkinchi: qator", legacy: true },
    { name: "id", kind: "admin_debit", note: `admin:${adminUser}`, expected: "Ma'muriy tuzatish", legacy: true },
    { name: "id+blank", kind: "admin_credit", note: `admin:${adminUser}:   `, expected: "Ma'muriy tuzatish", legacy: true },
    // Not legacy admin notes — must stay byte-for-byte.
    { name: "topup", kind: "topup", note: `admin:${phone}: tegilmaydi`, expected: `admin:${phone}: tegilmaydi`, legacy: false },
    { name: "plain", kind: "admin_credit", note: "Qo'lda tuzatish", expected: "Qo'lda tuzatish", legacy: false },
    { name: "null", kind: "admin_credit", note: null, expected: null, legacy: false },
    { name: "not-digits", kind: "admin_credit", note: "admin:cli", expected: "admin:cli", legacy: false },
  ];
  const ids = new Map<string, string>();
  const createdAt = new Map<string, string>();
  for (const [i, s] of seeds.entries()) {
    const at = new Date(Date.UTC(2026, 0, 1 + i, 9, 30)).toISOString();
    const row = (await queryOne<{ id: string }>(
      `INSERT INTO transactions (user_id, kind, balance_delta, reference, note, created_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [victim, s.kind, s.kind === "admin_debit" ? -100 : 100, randomUUID(), s.note, at],
    ))!;
    ids.set(s.name, row.id);
    createdAt.set(s.name, at);
  }
  const legacy = seeds.filter((s) => s.legacy);

  const notes = async () =>
    new Map(
      (await query<{ id: string; note: string | null }>("SELECT id, note FROM transactions WHERE user_id = $1", [victim])).map(
        (r) => [r.id, r.note],
      ),
    );
  type AuditRow = {
    id: string;
    at: Date;
    admin_id: string | null;
    action: string;
    target_type: string;
    target_id: string;
    outcome: string;
    meta: { transaction_id: string; original_note: string };
  };
  const legacyAudit = () =>
    query<AuditRow>(
      `SELECT id, at, admin_id, action, target_type, target_id, outcome, meta
         FROM admin_audit_log WHERE action = 'legacy.wallet_adjust' ORDER BY id`,
    );
  const assertScrubbed = async (label: string) => {
    const n = await notes();
    for (const s of seeds) assert.equal(n.get(ids.get(s.name)!), s.expected, `${label}: ${s.name}`);
  };
  const assertOriginal = async (label: string) => {
    const n = await notes();
    for (const s of seeds) assert.equal(n.get(ids.get(s.name)!), s.note, `${label}: ${s.name}`);
  };
  const assertAudit = async (label: string) => {
    const rows = await legacyAudit();
    assert.equal(rows.length, legacy.length, `${label}: audit qatorlari soni`);
    for (const s of legacy) {
      const r = rows.find((x) => x.meta.transaction_id === ids.get(s.name));
      assert.ok(r, `${label}: ${s.name} audit qatori yo'q`);
      assert.equal(r.admin_id, null);
      assert.equal(r.outcome, "ok");
      assert.equal(r.target_type, "user");
      assert.equal(r.target_id, victim);
      assert.equal(r.meta.original_note, s.note);
      assert.equal(r.at.toISOString(), createdAt.get(s.name), `${label}: at = created_at`);
    }
  };

  // --- 2. Full set: 031 scrubs, 032/033 apply ------------------------------
  await t.test("hamma migratsiya bo'sh bazada qo'llanadi; jadvallar, indekslar, triggerlar bor", async () => {
    await migrate(quiet);
    assert.deepEqual(await applied(), ALL);
    for (const tb of NEW_TABLES) assert.ok(await exists(tb), `${tb} yo'q`);
    for (const ix of NEW_INDEXES) assert.ok(await exists(ix), `${ix} yo'q`);
    const triggers = (
      await query<{ tgname: string }>(
        "SELECT tgname FROM pg_trigger WHERE tgrelid = 'admin_audit_log'::regclass AND NOT tgisinternal ORDER BY tgname",
      )
    ).map((r) => r.tgname);
    assert.deepEqual(triggers, ["admin_audit_log_no_truncate", "admin_audit_log_no_update"]);
  });

  await t.test("031: telefon/ID izohdan olinadi, asl izoh audit jurnalida", async () => {
    await assertScrubbed("031");
    await assertAudit("031");
    const leaked = await query("SELECT id FROM transactions WHERE note LIKE $1", [`%${phone}%`]);
    assert.equal(leaked.length, 1, "telefon faqat admin bo'lmagan (topup) qatorda qolishi kerak");
  });

  await t.test("031 qayta ishga tushirilsa: audit takrorlanmaydi, izoh qayta yozilmaydi", async () => {
    const before = (await legacyAudit()).map((r) => r.id);
    await runSql(sqlOf("031_admin_legacy_notes.sql"));
    await runSql(sqlOf("031_admin_legacy_notes.sql"));
    assert.deepEqual((await legacyAudit()).map((r) => r.id), before);
    await assertScrubbed("031 x3");
  });

  await t.test("yangi fayllar qayta qo'llash xavfsiz (IF NOT EXISTS / OR REPLACE)", async () => {
    for (const f of NEW) await runSql(sqlOf(f));
    await assertScrubbed("re-run");
    await assertAudit("re-run");
  });

  // --- 3. Append-only -------------------------------------------------------
  await t.test("admin_audit_log: UPDATE, DELETE va TRUNCATE rad etiladi", async () => {
    const n = (await legacyAudit()).length;
    await assert.rejects(query("UPDATE admin_audit_log SET reason = 'x'"), /append-only/);
    await assert.rejects(query("DELETE FROM admin_audit_log"), /append-only/);
    await assert.rejects(query("TRUNCATE admin_audit_log"), /append-only/);
    // INSERT ishlaydi (jurnal yoziladi), lekin yozilgan qator o'zgarmaydi.
    const row = (await queryOne<{ id: string }>(
      "INSERT INTO admin_audit_log (action, outcome) VALUES ('test.append', 'ok') RETURNING id",
    ))!;
    await assert.rejects(query("UPDATE admin_audit_log SET outcome = 'failed' WHERE id = $1", [row.id]), /append-only/);
    await assert.rejects(query("DELETE FROM admin_audit_log WHERE id = $1", [row.id]), /append-only/);
    assert.equal((await legacyAudit()).length, n);
  });

  // --- 4. Rollback blocks ---------------------------------------------------
  await t.test("031 rollback izohlarni tiklaydi; qayta qo'llash audit qatorlarini qayta ishlatadi", async () => {
    const auditIds = (await legacyAudit()).map((r) => r.id);
    await runSql(rollbackSql("031_admin_legacy_notes.sql"));
    await assertOriginal("031 rollback");
    assert.ok(!(await applied()).includes("031_admin_legacy_notes.sql"));
    await migrate(quiet);
    assert.deepEqual(await applied(), ALL);
    await assertScrubbed("031 re-apply");
    assert.deepEqual((await legacyAudit()).map((r) => r.id), auditIds, "audit takrorlandi");
  });

  await t.test("rollback 039→028 toza o'chiradi, keyin hammasi qayta qo'llanadi", async () => {
    // 039 (bot keyboard link revocation, docs/bot/PLAN.md Q1), 037 (referrals, docs/todo-2026-10-07/PLAN.md T3), 036 (pg_stat_statements,
    // docs/ops/O3-robustness-ops.md §4), 035 (telegram file cache, docs/mobile/PLAN.md §4.4)
    // and 034 (quota merge, docs/SUBS-REMOVAL.md) sit on top of the admin migrations and are
    // rolled back first, newest first.
    for (const f of [
      "039_bot_links_before.sql",
      "037_referrals.sql",
      "036_pg_stat_statements.sql",
      "035_telegram_files.sql",
      "034_quota_merge.sql",
      ...[...NEW].reverse(),
    ]) {
      await runSql(rollbackSql(f));
      assert.ok(!(await applied()).includes(f), `${f}: schema_migrations qatori qoldi`);
    }
    await assertOriginal("full rollback");
    for (const tb of NEW_TABLES) assert.ok(!(await exists(tb)), `${tb} qoldi`);
    for (const ix of NEW_INDEXES) assert.ok(!(await exists(ix)), `${ix} qoldi`);
    const fn = await queryOne("SELECT 1 FROM pg_proc WHERE proname = 'admin_audit_log_immutable'");
    assert.equal(fn, null, "admin_audit_log_immutable() qoldi");
    assert.equal((await applied()).at(-1), "027_queue_indexes.sql");

    await migrate(quiet);
    assert.deepEqual(await applied(), ALL);
    for (const tb of NEW_TABLES) assert.ok(await exists(tb), `${tb} qayta yaratilmadi`);
    await assertScrubbed("full re-apply");
    await assertAudit("full re-apply");
  });
});
