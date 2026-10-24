import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

/**
 * Migrations 058 (AI chat) and 060 (video_ops) must stay strictly ADDITIVE: the server's deploy guard (`deploy/deploy-pull.sh DESTRUCTIVE_RE`)
 * refuses an added migration line with DROP / RENAME / TRUNCATE / SET NOT NULL / ALTER COLUMN .. TYPE unless a human passes
 * `--allow-destructive`, and auto-deploy would stall. The regex is read from the script itself (one source of truth) and applied
 * the way the script does: only the non-comment SQL, upper-cased.
 *
 * Mutation (restored): a `DROP CONSTRAINT` statement put back into 058 -> «058 is additive».
 */

const script = readFileSync(new URL("../deploy/deploy-pull.sh", import.meta.url), "utf8");
const re = /^DESTRUCTIVE_RE='(.*)'$/m.exec(script);
assert.ok(re, "DESTRUCTIVE_RE not found in deploy-pull.sh");
const DESTRUCTIVE = new RegExp(re[1]!);

function guardHits(sql: string): string[] {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, "").toUpperCase())
    .filter((l) => DESTRUCTIVE.test(l));
}

test("the guard's regex flags what it should (sanity)", () => {
  assert.equal(guardHits("ALTER TABLE t DROP CONSTRAINT c;").length, 1);
  assert.equal(guardHits("ALTER TABLE t DROP COLUMN c;").length, 1);
  assert.equal(guardHits("ALTER TABLE t ALTER COLUMN c TYPE int;").length, 1);
  assert.equal(guardHits("-- ROLLBACK: DROP TABLE t;").length, 0, "comments are stripped");
  assert.equal(guardHits("ALTER TABLE t ADD COLUMN IF NOT EXISTS c TEXT;").length, 0);
});

test("059 (paid tests) is additive: only new tables and indexes, rollback documented", () => {
  const sql = readFileSync(new URL("../lib/server/migrations/059_paid_tests.sql", import.meta.url), "utf8");
  assert.deepEqual(guardHits(sql), []);
  assert.match(sql, /^-- ROLLBACK:/m);
  for (const t of ["test_attempt_answers", "test_attempts", "test_questions", "test_assets", "test_subjects", "test_banks"]) {
    assert.match(sql, new RegExp(`^--   DROP TABLE IF EXISTS ${t};`, "m"), `rollback drops ${t}`);
    assert.match(sql, new RegExp(`^CREATE TABLE IF NOT EXISTS ${t} \\(`, "m"), `creates ${t}`);
  }
  // Nothing outside the comments touches an existing table.
  const code = sql.replace(/--.*$/gm, "");
  assert.ok(!/ALTER TABLE/i.test(code), "no ALTER TABLE at all");
});

test("058 is additive: no DROP / RENAME / TRUNCATE / SET NOT NULL / ALTER COLUMN TYPE outside comments", () => {
  const sql = readFileSync(new URL("../lib/server/migrations/058_ai_chat.sql", import.meta.url), "utf8");
  assert.deepEqual(guardHits(sql), []);
  // It still documents how to roll back (in comments), including the new column.
  assert.match(sql, /^-- ROLLBACK:/m);
  assert.match(sql, /^--   ALTER TABLE ai_usage DROP COLUMN IF EXISTS paid_ref;/m);
  // The existing CHECK constraints are not touched.
  assert.ok(!/ai_usage_(source|outcome)_check/.test(sql.replace(/--.*$/gm, "")));
});

test("060 is additive: video_ops is a new table with a new index; no DROP / RENAME / TRUNCATE / SET NOT NULL / ALTER COLUMN TYPE outside comments", () => {
  const sql = readFileSync(new URL("../lib/server/migrations/060_video_ops.sql", import.meta.url), "utf8");
  assert.deepEqual(guardHits(sql), [], "MUTATSIYA: 060 ga DROP/ALTER ... TYPE qo'shilsa qizaradi");
  // The rollback is documented (in comments) and the migration only creates things.
  assert.match(sql, /^-- ROLLBACK:/m);
  assert.match(sql, /^--   DROP TABLE IF EXISTS video_ops;/m);
  const code = sql.replace(/--.*$/gm, "");
  assert.ok(/CREATE TABLE IF NOT EXISTS video_ops/.test(code));
  assert.ok(/CREATE INDEX IF NOT EXISTS video_ops_due_idx/.test(code));
  // No statement touches an existing table other than the foreign key it references.
  assert.ok(!/ALTER\s+TABLE/i.test(code), "060 must not alter any existing table");
  assert.ok(!/generations_status_check|CHECK \(status IN \('QUEUED'/.test(code), "the generations status CHECK is untouched (a waiting video is IN_PROGRESS without a lease)");
});

test("every migration from 060 on is additive (the deploy guard's rule, applied to all new files)", () => {
  const dir = new URL("../lib/server/migrations/", import.meta.url);
  const files = readdirSync(dir).filter((f) => /^(0(6\d|[7-9]\d)|[1-9]\d\d)_.*\.sql$/.test(f));
  assert.ok(files.includes("060_video_ops.sql"));
  for (const f of files) assert.deepEqual(guardHits(readFileSync(new URL(f, dir), "utf8")), [], f);
});
