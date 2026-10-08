import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";

/**
 * `lib/server/profile.ts updateProfile` — the one writer of a user's own
 * profile, called by `PATCH /api/users/me` and by the bot (docs/bot/PLAN.md, B2).
 * Real Postgres (test DB only).
 *
 * Mutations (each turned a test red, then restored):
 *   1. `EDITABLE_FIELDS` gets `balance` → «allowlist»;
 *   2. NUL strip removed → «cleaning»;
 *   3. `.slice(0, FIELD_MAX)` removed → «cleaning»;
 *   4. language constraint removed → «language»;
 *   5. audit insert moved after the transaction (own `query`) → «audit row rolls back with the UPDATE»;
 *   6. no-change short-circuit removed → «unchanged value».
 */

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const { query, queryOne, pool, ensureMigrated } = await import("../lib/server/db.ts");
const { updateProfile, profilePatchFromBody } = await import("../lib/server/profile.ts");
const { upsertTelegramUser } = await import("../lib/server/auth.ts");
if (hasDb) await ensureMigrated();

const tgIds: string[] = [];
after(async () => {
  if (!hasDb) return;
  await query("DELETE FROM users WHERE telegram_id::text = ANY($1)", [tgIds]);
  await pool().end();
});

async function newUser(): Promise<string> {
  const id = String(7_400_000_000 + randomInt(0, 99_999_999));
  tgIds.push(id);
  const u = await upsertTelegramUser({ telegramId: id, username: null, name: "Profil", photoUrl: null });
  return u.id;
}

const row = (id: string) =>
  queryOne<Record<string, string>>(`SELECT name, department, "group", language, balance::text AS balance, points::text AS points FROM users WHERE id = $1`, [id]);
const audits = (id: string) =>
  query<{ action: string; actor_user_id: string; actor_role: string; admin_id: string | null; before: unknown; after: unknown; meta: { via: string }; ip: string | null }>(
    "SELECT action, actor_user_id::text AS actor_user_id, actor_role, admin_id, before, after, meta, ip FROM admin_audit_log WHERE target_type = 'user' AND target_id = $1 AND action = 'profile.update' ORDER BY id",
    [id],
  );

test("profilePatchFromBody: allowlist only, strings only", () => {
  assert.deepEqual(profilePatchFromBody({ balance: "999999", points: "1", plan: "pro", phone: "+998901234567", isAdmin: "1", name: 5, group: "301" }), { group: "301" }, "MUTATSIYA 1");
  assert.deepEqual(profilePatchFromBody({ department: "  a\0b  " }), { department: "ab" }, "MUTATSIYA 2");
  assert.equal(profilePatchFromBody({ teacher: "x".repeat(250) }).teacher!.length, 200, "MUTATSIYA 3");
  assert.deepEqual(profilePatchFromBody({ language: "ru" }), { language: "ru" });
  assert.deepEqual(profilePatchFromBody({ language: "de" }), {}, "MUTATSIYA 4");
  assert.deepEqual(profilePatchFromBody({ language: " en " }), { language: "en" });
});

test("updateProfile: writes the changed fields + ONE audit row (actor = the user, via, before/after)", { skip }, async () => {
  const id = await newUser();
  const before = (await row(id))!;
  const r = await updateProfile(id, { department: " Jahon tarixi kafedrasi ", group: "301", balance: "999999" }, "bot");
  assert.deepEqual(r.changed.sort(), ["department", "group"]);
  const now = (await row(id))!;
  assert.equal(now.department, "Jahon tarixi kafedrasi");
  assert.equal(now.group, "301");
  assert.equal(now.balance, before.balance, "money never moves");
  const a = await audits(id);
  assert.equal(a.length, 1);
  assert.equal(a[0]!.actor_user_id, id);
  assert.equal(a[0]!.actor_role, "user");
  assert.equal(a[0]!.admin_id, null);
  assert.deepEqual(a[0]!.meta, { via: "bot" });
  assert.deepEqual(a[0]!.before, { department: "", group: "" });
  assert.deepEqual(a[0]!.after, { department: "Jahon tarixi kafedrasi", group: "301" });

  // Web: ip recorded; only the changed field in before/after.
  await updateProfile(id, { department: "Jahon tarixi kafedrasi", name: "Dilnoza" }, "web", { ip: "203.0.113.5", userAgent: "test" });
  const b = await audits(id);
  assert.equal(b.length, 2);
  assert.deepEqual(b[1]!.after, { name: "Dilnoza" });
  assert.deepEqual(b[1]!.meta, { via: "web" });
  assert.equal(b[1]!.ip, "203.0.113.5");
});

test("unchanged value: no UPDATE, no audit row (a replayed bot answer, the slide form autosave)", { skip }, async () => {
  const id = await newUser();
  await updateProfile(id, { city: "Samarqand" }, "bot");
  const r = await updateProfile(id, { city: " Samarqand " }, "bot");
  assert.deepEqual(r.changed, [], "MUTATSIYA 6");
  assert.equal((await audits(id)).length, 1);
});

test("language: uz|ru|en only", { skip }, async () => {
  const id = await newUser();
  await updateProfile(id, { language: "de" }, "web");
  assert.equal((await row(id))!.language, "uz");
  await updateProfile(id, { language: "ru" }, "bot");
  assert.equal((await row(id))!.language, "ru");
});

test("audit row rolls back with the UPDATE (same transaction)", { skip }, async () => {
  const id = await newUser();
  const faculty = async () => (await queryOne<{ faculty: string }>("SELECT faculty FROM users WHERE id = $1", [id]))!.faculty;

  // (a) The audit insert fails → the UPDATE before it rolls back: a temporary CHECK on the
  //     audit table that rejects this user's row.
  await query(`ALTER TABLE admin_audit_log ADD CONSTRAINT b2_test_block CHECK (target_id IS DISTINCT FROM '${Number(id)}') NOT VALID`);
  try {
    await assert.rejects(updateProfile(id, { faculty: "Tarix" }, "bot"), /b2_test_block/);
  } finally {
    await query("ALTER TABLE admin_audit_log DROP CONSTRAINT b2_test_block");
  }
  assert.equal(await faculty(), "", "no audit → no change");

  // (b) The transaction fails at COMMIT, after the audit insert (a deferred constraint
  //     trigger on users) → the audit row must be gone too. An audit written outside the
  //     transaction (own connection, autocommit) would survive here.
  await query(`CREATE OR REPLACE FUNCTION b2_test_boom() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'b2_test_boom'; END $$`);
  await query(`CREATE CONSTRAINT TRIGGER b2_test_boom AFTER UPDATE ON users DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW WHEN (NEW.faculty = 'BOOM') EXECUTE FUNCTION b2_test_boom()`);
  try {
    await assert.rejects(updateProfile(id, { faculty: "BOOM" }, "bot"), /b2_test_boom/);
  } finally {
    await query("DROP TRIGGER IF EXISTS b2_test_boom ON users");
    await query("DROP FUNCTION IF EXISTS b2_test_boom()");
  }
  assert.equal(await faculty(), "");
  assert.equal((await audits(id)).length, 0, "MUTATSIYA 5: the audit row rolled back with the change");
});
