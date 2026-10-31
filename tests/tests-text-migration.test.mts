process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Migration 064 (the TEXT of the 390 «Test ishlash» questions) and its generator `scripts/gen-tests-text-migration.mts`.
 *
 * Without a database: the committed SQL is byte-for-byte what the generator makes from `data/tests/bmb-texts.json`
 * (so a hand edit or a changed JSON is caught), exactly 390 guarded UPDATEs, every id once, the deploy guard accepts it,
 * the generator refuses text that could break the SQL.
 * On a throwaway Postgres: the real file applied to 390 image-only rows stores every text / option / has_figure exactly;
 * a second run changes nothing; an existing text is never overwritten; a database without the ids is harmless; tricky strings
 * (apostrophes, `$$`, `$t$`, a trailing `$`, backslashes, newlines, the closing-tag lookalikes) round-trip unchanged.
 *
 * Mutation checks (each broken on purpose, the named test failed, then restored):
 *   1. the `AND question_text IS NULL` guard dropped from the generator         -> «never overwrites an existing text».
 *   2. the options built as `jsonb_build_array(...)` of 3 items / wrong order   -> «the real file stores every text, option and has_figure».
 *   3. a quote-doubling escape swapped in for the dollar tag but not applied    -> «tricky strings round-trip».
 *   4. one id emitted twice (sorted list duplicated)                            -> «390 UPDATEs, every id once».
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("txtmig") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "alohida Postgres baza yo'q";

const gen = await import("../scripts/gen-tests-text-migration.mts");
const FILE = new URL(`../lib/server/migrations/${gen.MIGRATION_FILE}`, import.meta.url);
const items = JSON.parse(readFileSync(new URL("../data/tests/bmb-texts.json", import.meta.url), "utf8")) as import("../scripts/gen-tests-text-migration.mts").TextItem[];
const sql = readFileSync(FILE, "utf8");

const script = readFileSync(new URL("../deploy/deploy-pull.sh", import.meta.url), "utf8");
const DESTRUCTIVE = new RegExp(/^DESTRUCTIVE_RE='(.*)'$/m.exec(script)![1]!);

test("the committed 064 is exactly what the generator makes from the JSON", () => {
  assert.equal(sql, gen.buildMigration(items), "run: npx tsx scripts/gen-tests-text-migration.mts");
});

test("390 UPDATEs, every id once, each guarded by question_text IS NULL", () => {
  const updates = [...sql.matchAll(/^UPDATE test_questions SET question_text = /gm)];
  assert.equal(updates.length, 390);
  assert.equal(items.length, 390);
  const ids = [...sql.matchAll(/^ WHERE id = (\d+) AND question_text IS NULL;$/gm)].map((m) => Number(m[1]));
  assert.equal(ids.length, 390, "every UPDATE carries the guard");
  assert.equal(new Set(ids).size, 390, "no id twice");
  assert.deepEqual([...ids].sort((a, b) => a - b), items.map((i) => i.question_id).sort((a, b) => a - b), "exactly the ids of the JSON");
  assert.equal([...sql.matchAll(/has_figure = TRUE,/g)].length, items.filter((i) => i.has_figure).length);
  assert.equal(items.filter((i) => i.has_figure).length, 20);
  // The only DDL is the additive column; nothing deletes data.
  const code = sql.replace(/^--.*$/gm, "");
  assert.deepEqual([...code.matchAll(/^(ALTER TABLE .*|DELETE .*|DROP .*|TRUNCATE .*|INSERT .*)$/gim)].map((m) => m[1]), ["ALTER TABLE test_questions ADD COLUMN IF NOT EXISTS has_figure BOOLEAN NOT NULL DEFAULT FALSE;"]);
});

test("the deploy guard accepts it (no DROP / RENAME / TRUNCATE / SET NOT NULL / ALTER COLUMN TYPE on any added line)", () => {
  const hits = sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, "").toUpperCase())
    .filter((l) => DESTRUCTIVE.test(l));
  assert.deepEqual(hits, []);
  assert.match(sql, /^-- ROLLBACK:/m);
});

test("the generator refuses text that could break the SQL", () => {
  const base = { question_id: 1, question: "Savol", options: { A: "1", B: "2", C: "3", D: "4" }, has_figure: false };
  assert.doesNotThrow(() => gen.validate([base]));
  const bad = (patch: object) => assert.throws(() => gen.validate([{ ...base, ...patch }]), /bad data/);
  bad({ question: `x ${gen.TAG} y` });
  bad({ question: "oxiri $tq" }); // + the closing tag would read $tq$tq$
  bad({ question: "o'rtada $tq bor" });
  bad({ question: "NUL \u0000 bayt" });
  bad({ question: "tab\tichida" });
  bad({ question: " bosh bo'shliq" });
  bad({ question: "" });
  bad({ options: { A: "1", B: "2", C: "3" } });
  bad({ options: { A: "1", B: "2", C: "3", D: `${gen.TAG}` } });
  bad({ has_figure: "yes" });
  bad({ question_id: 0 });
  assert.throws(() => gen.validate([base, base]), /duplicate id/);
  assert.throws(() => gen.validate([]), /non-empty/);
});

/* ───────────────────────── real Postgres ───────────────────────── */

test("064 on a real database", { skip }, async (t) => {
  const { migrate, pool, query, queryOne } = await import("../lib/server/db.ts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });
  const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f00050001ff89993d1d0000000049454e44ae426082", "hex");
  const bank = (await queryOne<{ id: string }>("INSERT INTO test_banks (slug, title) VALUES ('bmb', 'Tayyor testlar') RETURNING id::text AS id"))!.id;
  const subject = (await queryOne<{ id: string }>("INSERT INTO test_subjects (bank_id, code, name, sort) VALUES ($1, 'math', 'Matematika', 0) RETURNING id::text AS id", [bank]))!.id;
  const asset = (await queryOne<{ id: string }>("INSERT INTO test_assets (sha256, mime, size_bytes, bytes) VALUES ($1, 'image/png', $2, $3) RETURNING id::text AS id", ["cd".repeat(32), PNG.length, PNG]))!.id;
  const seedImageOnly = async (ids: number[]) => {
    for (const id of ids) {
      await query("INSERT INTO test_questions (id, subject_id, variant, image_asset_id, answer, legacy_ref) VALUES ($1, $2, 1, $3, 0, $4)", [id, subject, asset, `seed:${id}`]);
    }
  };
  /** Runs a migration text as the runner does (one multi-statement query) and returns the rows the UPDATEs touched. */
  const apply = async (text: string): Promise<number> => {
    const client = await pool().connect();
    try {
      await client.query("BEGIN");
      const r = (await client.query(text)) as unknown as { command: string; rowCount: number | null }[];
      await client.query("COMMIT");
      return (Array.isArray(r) ? r : [r]).filter((x) => x.command === "UPDATE").reduce((n, x) => n + (x.rowCount ?? 0), 0);
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  };
  type Row = { id: number; question_text: string | null; options: string[] | null; has_figure: boolean; image_asset_id: string | null };
  const rows = (ids: number[]) =>
    query<Row>("SELECT id::int AS id, question_text, options, has_figure, image_asset_id::text AS image_asset_id FROM test_questions WHERE id = ANY($1::bigint[]) ORDER BY id", [ids]);

  await t.test("a database without these ids: the file is harmless (0 rows)", async () => {
    assert.equal(await apply(sql), 0);
    assert.equal((await queryOne<{ n: number }>("SELECT count(*)::int AS n FROM test_questions"))!.n, 0);
  });

  await t.test("the real file stores every text, option and has_figure exactly; the images stay", async () => {
    const ids = items.map((i) => i.question_id);
    await seedImageOnly(ids);
    assert.equal(await apply(sql), 390);
    const got = await rows(ids);
    assert.equal(got.length, 390);
    for (const it of items) {
      const r = got.find((g) => g.id === it.question_id)!;
      assert.equal(r.question_text, it.question, `text of ${it.question_id}`);
      assert.deepEqual(r.options, [it.options.A, it.options.B, it.options.C, it.options.D], `options of ${it.question_id}`);
      assert.equal(r.has_figure, it.has_figure, `has_figure of ${it.question_id}`);
      assert.equal(r.image_asset_id, asset, `image of ${it.question_id} untouched`);
    }
    assert.equal(got.filter((g) => g.has_figure).length, 20);
    // The shape the table's CHECK and the code expect: exactly four strings.
    assert.equal((await queryOne<{ n: number }>("SELECT count(*)::int AS n FROM test_questions WHERE jsonb_typeof(options) = 'array' AND jsonb_array_length(options) = 4"))!.n, 390);
    // A LaTeX question and the multi-line one survive verbatim.
    assert.equal(got.find((g) => g.id === 399)!.question_text, "Hisoblang: $\\frac{1}{4}-\\frac{1}{5}+\\frac{1}{6}-\\frac{2}{8}+\\frac{2}{10}-\\frac{2}{12}$");
    assert.ok(got.some((g) => g.question_text?.includes("\n")));
  });

  await t.test("idempotent: a second run touches nothing", async () => {
    assert.equal(await apply(sql), 0);
  });

  await t.test("never overwrites an existing text (an admin's later correction wins)", async () => {
    await query("UPDATE test_questions SET question_text = 'TUZATILGAN', options = '[\"1\",\"2\",\"3\",\"4\"]'::jsonb, has_figure = TRUE WHERE id = 399");
    assert.equal(await apply(sql), 0);
    const [r] = await rows([399]);
    assert.equal(r!.question_text, "TUZATILGAN");
    assert.equal(r!.has_figure, true);
    assert.deepEqual(r!.options, ["1", "2", "3", "4"]);
  });

  await t.test("a question that already has text gets nothing even when others in the file are applied", async () => {
    await query("UPDATE test_questions SET question_text = NULL, options = NULL, has_figure = FALSE WHERE id IN (400, 401)");
    await query("UPDATE test_questions SET question_text = 'qoladi' WHERE id = 400");
    assert.equal(await apply(sql), 1, "only 401 was empty");
    const got = await rows([400, 401]);
    assert.equal(got[0]!.question_text, "qoladi");
    assert.equal(got[1]!.question_text, items.find((i) => i.question_id === 401)!.question);
  });

  await t.test("tricky strings round-trip unchanged", async () => {
    const tricky = [
      "O‘zbekiston ‘Mustaqillik’ kuni; it's \"quoted\" and 'single'",
      "Tenglama: $x^2+\\sqrt{3}=\\frac{1}{2}$",
      "Narx $5 va $$ oxirida $",
      "Oxiri dollar: $\\frac{1}{5}$",
      "Hozir $t$ va tq$ va $t va $ tq va $tx$ oxiri $t",
      "Backslash \\ ichida \\' va \\n harflari, 100% va %s va :param va $1 $2",
      "Ikki qator\nikkinchi qator\n\nuchinchi",
      "-- izoh emas; /* ham emas */ ; DROP",
      "Unicode m³ × ≤ · − — … ’ ‘",
      "''doubled'' quotes",
    ];
    const ids = tricky.map((_, i) => 9001 + i);
    await seedImageOnly(ids);
    const data = tricky.map((text, i) => ({
      question_id: ids[i]!,
      question: text,
      options: { A: tricky[(i + 1) % tricky.length]!, B: "$a$", C: `x${text.slice(0, 5).trim()}`, D: "plain" },
      has_figure: i % 2 === 0,
    }));
    // The same text in an option and the stem; options may be any of the tricky strings too.
    assert.equal(await apply(gen.buildMigration(data)), tricky.length);
    const got = await rows(ids);
    for (const [i, d] of data.entries()) {
      assert.equal(got[i]!.question_text, d.question, `stem ${i}`);
      assert.deepEqual(got[i]!.options, [d.options.A, d.options.B, d.options.C, d.options.D], `options ${i}`);
      assert.equal(got[i]!.has_figure, d.has_figure);
    }
  });
});
