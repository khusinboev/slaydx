import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Migrations 073 + 074 («Ishlar bozori», docs/market/PLAN.md §8): additive under the deploy guard's own regex, every
 * statement documented in the ROLLBACK block, and the schema really carries what the money and privacy rules lean on.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. a `DROP INDEX x;` statement added to 073                         -> «additive»;
 *   2. `DELETE FROM schema_migrations` line removed from the 074 header -> «ROLLBACK block»;
 *   3. `UNIQUE (item_id, buyer_user_id)` removed                        -> «one purchase per buyer»;
 *   4. `ON DELETE RESTRICT` on market_purchases.item_id → CASCADE       -> «an item with buyers cannot be deleted»;
 *   5. `ON DELETE SET NULL` on source_generation_id → CASCADE           -> «a listing survives its source»;
 *   6. search_tsv index removed from 074                                -> «generated search column».
 *   review fix: `market_purchases_generation_idx` removed from 073 -> the search migration test;
 */

const script = readFileSync(new URL("../deploy/deploy-pull.sh", import.meta.url), "utf8");
const DESTRUCTIVE = new RegExp(/^DESTRUCTIVE_RE='(.*)'$/m.exec(script)![1]!);
const file = (n: string) => readFileSync(new URL(`../lib/server/migrations/${n}`, import.meta.url), "utf8");
const FILES = ["073_market_core.sql", "074_market_search.sql"];

test("additive: the deploy guard's regex finds nothing outside comments", () => {
  for (const f of FILES) {
    const hits = file(f)
      .split("\n")
      .map((l) => l.replace(/--.*$/, "").toUpperCase())
      .filter((l) => DESTRUCTIVE.test(l));
    assert.deepEqual(hits, [], f);
  }
});

test("ROLLBACK block: every created object is undone, in the header, and the file sets lock_timeout", () => {
  for (const f of FILES) {
    const sql = file(f);
    assert.match(sql, /^-- ROLLBACK:/m, f);
    assert.match(sql, new RegExp(`^--   DELETE FROM schema_migrations WHERE name = '${f}';`, "m"), f);
    assert.match(sql, /^SET LOCAL lock_timeout = '5s';/m, f);
  }
  const core = file(FILES[0]!);
  for (const m of core.matchAll(/^CREATE TABLE IF NOT EXISTS (\w+)/gm)) {
    assert.match(core, new RegExp(`^--   DROP TABLE IF EXISTS ${m[1]};`, "m"), `rollback drops ${m[1]}`);
  }
  assert.match(core, /^--   ALTER TABLE users DROP COLUMN IF EXISTS market_opt_out;/m);
  assert.match(core, /^--   ALTER TABLE generations DROP COLUMN IF EXISTS market_item_id;/m);
});

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("marketmig") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";

let ready: Promise<void> | null = null;
async function db() {
  const mod = await import("../lib/server/db.ts");
  ready ??= mod.migrate();
  await ready;
  return mod;
}
after(async () => {
  if (!ready) return;
  const { pool } = await import("../lib/server/db.ts");
  await pool().end();
  await iso.drop();
});

let seq = 0;
async function user(): Promise<string> {
  const { query } = await db();
  return String((await query<{ id: string }>("INSERT INTO users (username, name) VALUES ($1, 'M') RETURNING id", [`mig-${process.pid}-${seq++}`]))[0]!.id);
}
async function item(extra: { sourceGen?: string; sourceUser?: string } = {}): Promise<string> {
  const { query } = await db();
  return (
    await query<{ id: string }>(
      `INSERT INTO market_items (tool_id, title, doc_json, topic_norm, source_generation_id, source_user_id)
       VALUES ('referat', 'Mavzu', '{}'::jsonb, $1, $2, $3) RETURNING id`,
      [`mavzu ${seq++}`, extra.sourceGen ?? null, extra.sourceUser ?? null],
    )
  )[0]!.id;
}

test("defaults: a new user is not opted out, a new item is a candidate at version 1", { skip }, async () => {
  const { query } = await db();
  const u = await user();
  assert.equal((await query<{ market_opt_out: boolean }>("SELECT market_opt_out FROM users WHERE id=$1", [u]))[0]!.market_opt_out, false);
  const id = await item();
  const [row] = await query<{ status: string; price_version: number; subject: string; level: string }>(
    "SELECT status, price_version, subject, level FROM market_items WHERE id=$1",
    [id],
  );
  assert.deepEqual(row, { status: "candidate", price_version: 1, subject: "boshqa", level: "otm" });
});

test("one purchase per buyer: the UNIQUE index is the real guard against a double purchase", { skip }, async () => {
  const { query } = await db();
  const [u, id] = [await user(), await item()];
  const ins = () =>
    query("INSERT INTO market_purchases (item_id, buyer_user_id, price, original_price, fingerprint) VALUES ($1,$2,1500,3000,'SLX-X')", [id, u]);
  await ins();
  await assert.rejects(ins, (e: { code?: string }) => e.code === "23505");
});

test("an item with buyers cannot be deleted; a buyer's deletion takes his purchase with him", { skip }, async () => {
  const { query } = await db();
  const [u, id] = [await user(), await item()];
  await query("INSERT INTO market_purchases (item_id, buyer_user_id, price, original_price, fingerprint) VALUES ($1,$2,1500,3000,'SLX-Y')", [id, u]);
  await assert.rejects(query("DELETE FROM market_items WHERE id=$1", [id]), (e: { code?: string }) => e.code === "23503");
  await query("DELETE FROM users WHERE id=$1", [u]);
  assert.equal((await query("SELECT 1 FROM market_purchases WHERE item_id=$1", [id])).length, 0);
});

test("a listing survives its source: deleting the generation or the author only clears the source columns", { skip }, async () => {
  const { query } = await db();
  const u = await user();
  const [g] = await query<{ id: string }>(
    "INSERT INTO generations (id, user_id, tool_id, topic, status, price, format) VALUES (gen_random_uuid(),$1,'referat','T','COMPLETED',0,'docx') RETURNING id",
    [u],
  );
  const id = await item({ sourceGen: g!.id, sourceUser: u });
  await query("DELETE FROM generations WHERE id=$1", [g!.id]);
  await query("DELETE FROM users WHERE id=$1", [u]);
  const [row] = await query<{ source_generation_id: string | null; source_user_id: string | null }>(
    "SELECT source_generation_id, source_user_id FROM market_items WHERE id=$1",
    [id],
  );
  assert.deepEqual(row, { source_generation_id: null, source_user_id: null });
});

test("the source generation is unique: one source yields at most one listing", { skip }, async () => {
  const { query } = await db();
  const u = await user();
  const [g] = await query<{ id: string }>(
    "INSERT INTO generations (id, user_id, tool_id, topic, status, price, format) VALUES (gen_random_uuid(),$1,'referat','T','COMPLETED',0,'docx') RETURNING id",
    [u],
  );
  await item({ sourceGen: g!.id });
  await assert.rejects(item({ sourceGen: g!.id }), (e: { code?: string }) => e.code === "23505");
});

test("checks: a bad status / level / stars / percent / max_copies is refused by the database", { skip }, async () => {
  const { query } = await db();
  const id = await item();
  const bad = (sql: string, args: unknown[] = []) => assert.rejects(query(sql, args), (e: { code?: string }) => e.code === "23514");
  await bad("UPDATE market_items SET status='sold' WHERE id=$1", [id]);
  await bad("UPDATE market_items SET level='phd' WHERE id=$1", [id]);
  await bad("UPDATE market_items SET max_copies=0 WHERE id=$1", [id]);
  await bad("UPDATE market_items SET price_override=-1 WHERE id=$1", [id]);
  await bad("INSERT INTO market_tool_pricing (tool_id, percent) VALUES ('slide', 5)");
});

test("generated search column: the tsvector follows search_text and its GIN index exists", { skip }, async () => {
  const { query } = await db();
  const id = await item();
  await query("UPDATE market_items SET search_text='ozbekiston tarixi' WHERE id=$1", [id]);
  const [hit] = await query<{ ok: boolean }>("SELECT search_tsv @@ plainto_tsquery('simple','tarixi') AS ok FROM market_items WHERE id=$1", [id]);
  assert.equal(hit!.ok, true);
  const idx = await query("SELECT 1 FROM pg_indexes WHERE tablename='market_items' AND indexname='market_items_search_idx'");
  const byGen = await query<{ indexdef: string }>("SELECT indexdef FROM pg_indexes WHERE tablename='market_purchases' AND indexname='market_purchases_generation_idx'");
  assert.match(byGen[0]?.indexdef ?? "", /\(generation_id\) WHERE \(generation_id IS NOT NULL\)/);
  assert.equal(idx.length, 1);
});

test("the migrations are idempotent files: re-running both changes nothing", { skip }, async () => {
  const { pool } = await db();
  for (const f of FILES) {
    const client = await pool().connect();
    try {
      await client.query("BEGIN");
      await client.query(file(f));
      await client.query("COMMIT");
    } finally {
      client.release();
    }
  }
});
