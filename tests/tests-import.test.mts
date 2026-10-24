/**
 * Importer of the paid-tests question bank (owner request 7, migration 060): `lib/server/tests-import.ts` and the CLI
 * `scripts/import-bmb-tests.mts`. Validation is pure; the import runs on real Postgres (own throwaway database).
 *
 * Mutation checks (each broken on purpose, the named test failed, then restored):
 *   1. the answer letter is not lower-cased (`parseAnswerLetter` without toLowerCase) -> «fixture: letters in any case»;
 *   2. the upsert always UPDATEs / INSERTs (`unchanged` branch removed)                -> «import is idempotent»;
 *   3. dry run commits (the `DryRunRollback` throw removed)                            -> «dry run writes nothing».
 */
process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("testsimport") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "Postgres kerak (DATABASE_URL)" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";
if (!hasDb) process.env.DATABASE_URL = "postgres://unused/unused";

const imp = await import("../lib/server/tests-import.ts");
const { query, pool, ensureMigrated } = await import("../lib/server/db.ts");
if (!skip) await ensureMigrated();
after(async () => {
  if (skip) return;
  await pool().end();
  await iso.drop();
});

const FIX = fileURLToPath(new URL("./fixtures/bmb-export/", import.meta.url));
const PNG_A = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f00050001ff89993d1d0000000049454e44ae426082", "hex");
const PNG_B = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c636060f8ff1f00030201ffe6770bae0000000049454e44ae426082", "hex");

const counts = async () => {
  const r = await query<{ t: string; n: string }>(
    `SELECT 'banks' t, count(*) n FROM test_banks UNION ALL SELECT 'subjects', count(*) FROM test_subjects UNION ALL SELECT 'questions', count(*) FROM test_questions UNION ALL SELECT 'assets', count(*) FROM test_assets`,
  );
  return Object.fromEntries(r.map((x) => [x.t, Number(x.n)]));
};

const question = (extra: Record<string, unknown>) => ({ legacy_ref: "bmb:math:1", answer_letter: "a", text: "2 + 2?", options: ["1", "2", "3", "4"], ...extra });
const exportOf = (qs: unknown[], extra: Record<string, unknown> = {}) => ({
  bank: { slug: "t", title: "T" },
  subjects: [{ code: "math", name: "Matematika", variants: [{ variant: 1, questions: qs }] }],
  ...extra,
});
const mem = (files: Record<string, Buffer> = {}) => imp.memoryImages(files);

test("fixture: 6 questions, 2 images, letters in any case", () => {
  const built = imp.loadExportFile(`${FIX}export.json`, `${FIX}images`);
  assert.deepEqual(built.errors, []);
  const plan = built.plan!;
  assert.equal(plan.questions.length, 6);
  assert.equal(plan.questions.filter((q) => q.image).length, 2);
  assert.deepEqual(plan.subjects.map((s) => s.code), ["math", "ona_tili", "tarix"]);
  const letters = Object.fromEntries(plan.questions.map((q) => [q.legacyRef, q.answer]));
  // "B" -> 1, "b" -> 1, "c" -> 2, "D" -> 3, "a" -> 0, "A" -> 0
  assert.deepEqual(letters, { "bmb:math:11": 1, "bmb:math:12": 1, "bmb:literature:21": 2, "bmb:literature:22": 3, "bmb:history:31": 0, "bmb:history:32": 0 });
  const byRef = Object.fromEntries(plan.questions.map((q) => [q.legacyRef, q]));
  assert.equal(byRef["bmb:math:11"]!.options, null, "image-only: no options");
  assert.equal(byRef["bmb:math:11"]!.image!.mime, "image/png");
  assert.ok(byRef["bmb:literature:21"]!.image, "found through its file_id");
  assert.equal(byRef["bmb:math:12"]!.explanation, "Ikkita ikkini qo'shsak to'rt chiqadi.");
});

test("validation: every problem is reported and nothing is planned", () => {
  const bad = (qs: unknown[], files: Record<string, Buffer> = {}) => imp.buildPlan(exportOf(qs), mem(files));
  const msg = (qs: unknown[], files?: Record<string, Buffer>) => bad(qs, files).errors.join("\n");

  assert.match(msg([question({ answer_letter: "e" })]), /answer_letter must be one of a, b, c, d/);
  assert.match(msg([question({ answer_letter: "ab" })]), /answer_letter/);
  assert.match(msg([question({ answer_letter: undefined })]), /answer_letter/);
  assert.match(msg([question({ options: ["1", "2", "3"] })]), /exactly 4/);
  assert.match(msg([question({ options: ["1", "2", "3", ""] })]), /exactly 4/);
  assert.match(msg([question({ options: undefined })]), /needs 4 options/);
  assert.match(msg([{ legacy_ref: "bmb:math:2", answer_letter: "a" }]), /needs an image/);
  assert.match(msg([{ legacy_ref: "bmb:math:2", answer_letter: "a", image_path: "nope.png" }]), /image file not found/);
  assert.match(msg([{ legacy_ref: "bmb:math:2", answer_letter: "a", image_path: "x.png" }], { "x.png": Buffer.from("not an image") }), /not a PNG/);
  assert.match(msg([question({}), question({})]), /duplicate legacy_ref/);
  assert.match(msg([question({ legacy_ref: "" })]), /legacy_ref is required/);
  assert.equal(bad([question({ answer_letter: "e" })]).plan, null);

  assert.match(imp.buildPlan({ subjects: [] }, mem()).errors.join("\n"), /bank\.slug/);
  assert.match(imp.buildPlan(null, mem()).errors.join("\n"), /JSON object/);
  assert.match(imp.buildPlan({ bank: { slug: "t", title: "T" }, subjects: [{ code: "Bad Code", name: "x", variants: [] }] }, mem()).errors.join("\n"), /code is required/);
  assert.match(imp.buildPlan({ bank: { slug: "t", title: "T" }, subjects: [{ code: "m", name: "M", variants: [{ variant: 0, questions: [] }] }] }, mem()).errors.join("\n"), /variant must be an integer/);

  // Valid minimal cases: image-only with a letter, and a text question with 4 options.
  const ok = imp.buildPlan(exportOf([{ legacy_ref: "r1", answer_letter: "D", image_path: "a.png" }, question({ legacy_ref: "r2" })]), mem({ "a.png": PNG_A }));
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.plan!.questions[0]!.answer, 3);
});

test("a disk image source never leaves its folder", () => {
  const src = imp.dirImages(`${FIX}images`);
  assert.ok(src.read("math/img.png"));
  assert.equal(src.read("../export.json"), null);
  assert.equal(src.read("/etc/passwd"), null);
  assert.equal(src.read("math"), null, "a directory is not a file");
});

test("the same image under two questions of one subject: the second is skipped and reported", () => {
  const built = imp.buildPlan(
    exportOf([
      { legacy_ref: "r1", answer_letter: "a", image_path: "a.png" },
      { legacy_ref: "r2", answer_letter: "b", image_path: "copy.png" },
      { legacy_ref: "r3", answer_letter: "c", image_path: "b.png" },
    ]),
    mem({ "a.png": PNG_A, "copy.png": PNG_A, "b.png": PNG_B }),
  );
  assert.deepEqual(built.errors, []);
  assert.deepEqual(built.plan!.questions.map((q) => q.legacyRef), ["r1", "r3"]);
  assert.deepEqual(built.plan!.duplicates, [{ legacyRef: "r2", sameAs: "r1" }]);
  assert.ok(built.warnings.some((w) => /duplicate of r1/.test(w)));
});

test("import is idempotent (keyed by legacy_ref and image sha256)", { skip }, async () => {
  const plan = imp.loadExportFile(`${FIX}export.json`, `${FIX}images`).plan!;
  const first = await imp.importPlan(plan);
  assert.deepEqual(first.questions, { inserted: 6, updated: 0, unchanged: 0, skippedDuplicates: 0 });
  assert.deepEqual(first.assets, { inserted: 2, reused: 0, bytes: first.assets.bytes });
  assert.deepEqual(await counts(), { banks: 1, subjects: 3, questions: 6, assets: 2 });
  assert.deepEqual(first.perSubject, { math: { questions: 2, variants: 1 }, ona_tili: { questions: 2, variants: 2 }, tarix: { questions: 2, variants: 1 } });

  const again = await imp.importPlan(plan);
  assert.deepEqual(again.questions, { inserted: 0, updated: 0, unchanged: 6, skippedDuplicates: 0 });
  assert.equal(again.assets.inserted, 0);
  assert.equal(again.assets.reused, 2);
  assert.deepEqual(await counts(), { banks: 1, subjects: 3, questions: 6, assets: 2 });

  const row = await query<{ answer: number; options: string[] | null; image_asset_id: string | null }>("SELECT answer, options, image_asset_id FROM test_questions WHERE legacy_ref = 'bmb:math:11'");
  assert.equal(row[0]!.answer, 1);
  assert.equal(row[0]!.options, null);
  assert.ok(row[0]!.image_asset_id);
  const asset = await query<{ sha256: string; size_bytes: number; mime: string }>("SELECT sha256, size_bytes, mime FROM test_assets ORDER BY id");
  assert.ok(asset.every((a) => /^[0-9a-f]{64}$/.test(a.sha256) && a.size_bytes > 0 && a.mime === "image/png"));

  // A corrected key / text is an UPDATE of the same row; a question the admin switched off stays off.
  await query("UPDATE test_questions SET active = FALSE WHERE legacy_ref = 'bmb:math:12'");
  const edited = structuredClone(plan);
  edited.questions.find((q) => q.legacyRef === "bmb:math:12")!.answer = 2;
  edited.questions.find((q) => q.legacyRef === "bmb:history:31")!.explanation = "Izoh";
  const third = await imp.importPlan(edited);
  assert.deepEqual(third.questions, { inserted: 0, updated: 2, unchanged: 4, skippedDuplicates: 0 });
  const after2 = await query<{ answer: number; active: boolean }>("SELECT answer, active FROM test_questions WHERE legacy_ref = 'bmb:math:12'");
  assert.deepEqual(after2[0], { answer: 2, active: false });
  assert.deepEqual(await counts(), { banks: 1, subjects: 3, questions: 6, assets: 2 });
});

test("dry run writes nothing but counts exactly like the real run", { skip }, async () => {
  await query("DELETE FROM test_questions; DELETE FROM test_assets; DELETE FROM test_subjects; DELETE FROM test_banks");
  const plan = imp.loadExportFile(`${FIX}export.json`, `${FIX}images`).plan!;
  const dry = await imp.importPlan(plan, { dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.deepEqual(await counts(), { banks: 0, subjects: 0, questions: 0, assets: 0 }, "rolled back");
  const real = await imp.importPlan(plan);
  assert.equal(real.dryRun, false);
  assert.deepEqual({ ...dry, dryRun: false }, real);
  assert.deepEqual(await counts(), { banks: 1, subjects: 3, questions: 6, assets: 2 });
  assert.match(imp.formatSummary(dry), /DRY RUN \(nothing written\)/);
  assert.match(imp.formatSummary(real), /6 inserted/);
});

test("CLI: an invalid export exits 1 with the reasons; a valid dry run exits 0", { skip }, () => {
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ["--import", "tsx", "--conditions=react-server", fileURLToPath(new URL("../scripts/import-bmb-tests.mts", import.meta.url)), ...args], {
      encoding: "utf8",
      env: { ...process.env, SESSION_SECRET: "test-session-secret-at-least-32-characters-long" },
    });
  const noArgs = run();
  assert.equal(noArgs.status, 2);
  const missing = run(`${FIX}nope.json`, `${FIX}images`);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /cannot read/);
  const dry = run(`${FIX}export.json`, `${FIX}images`, "--dry-run");
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /DRY RUN/);
  assert.match(dry.stdout, /questions: 0 inserted, 0 updated, 6 unchanged/, "the previous test left the bank imported");
});
