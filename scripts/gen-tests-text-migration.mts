/**
 * Generates migration 064 («Test ishlash» question TEXT) from `data/tests/bmb-texts.json`.
 *
 * The owner had every image of the BMB bank transcribed to Uzbek text (390 questions). The text must reach production
 * WITHOUT a manual database write, so it travels as an additive DATA migration. The migration is generated, never
 * hand-edited: edit the JSON (or this script), re-run, commit both.
 *
 *   npx tsx scripts/gen-tests-text-migration.mts            # writes lib/server/migrations/064_test_questions_text.sql
 *   npx tsx scripts/gen-tests-text-migration.mts --check    # exit 1 when the committed file differs from the JSON
 *
 * What the migration does (see the header it writes):
 *   - adds `test_questions.has_figure` (a drawing / table the text cannot replace: the viewer keeps the image for these);
 *   - for every id: UPDATE ... SET question_text, options, has_figure WHERE id = <id> AND question_text IS NULL.
 *     Idempotent, never overwrites text that is already there (an admin's later correction wins), harmless on a
 *     database that does not hold these ids (0 rows).
 *
 * SQL safety: every string is DOLLAR-QUOTED with the tag `$tq$` (no quote doubling, no backslash rules: LaTeX
 * `\frac` and newlines are stored verbatim). A text that could end the quote early (it contains `$tq`, which at its end would form `$tq$tq$`) or break the
 * migration (NUL / control characters other than a newline) makes the generator FAIL instead of writing a bad file.
 * `options` is `to_jsonb(ARRAY[A, B, C, D]::text[])` -- the exact shape the code reads (a JSON array of four strings).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MIGRATION_FILE = "064_test_questions_text.sql";
export const TAG = "$tq$";
const LETTERS = ["A", "B", "C", "D"] as const;

export type TextItem = {
  question_id: number;
  file?: string;
  subject?: string;
  question: string;
  options: Record<(typeof LETTERS)[number], string>;
  has_figure: boolean;
  generated?: boolean;
};

/** Checks the data and returns it sorted by id; throws with every problem listed. */
export function validate(items: unknown): TextItem[] {
  if (!Array.isArray(items) || !items.length) throw new Error("the JSON must be a non-empty array");
  const errors: string[] = [];
  const seen = new Set<number>();
  const safe = (where: string, s: unknown): void => {
    if (typeof s !== "string" || !s.trim()) return void errors.push(`${where}: empty text`);
    if (s !== s.trim()) errors.push(`${where}: leading/trailing whitespace`);
    // `$tq` anywhere is refused, not only the whole tag: a text ENDING in `$tq` plus the closing `$tq$` would read `$tq$tq$`,
    // which Postgres closes after the first `$tq$` (the SQL then breaks or, worse, silently truncates the text).
    if (s.includes(TAG.slice(0, -1))) errors.push(`${where}: contains ${TAG.slice(0, -1)}`);
    if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(s)) errors.push(`${where}: control character`);
    if (/[\ud800-\udfff]/.test(s.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ""))) errors.push(`${where}: unpaired surrogate`);
  };
  for (const raw of items as TextItem[]) {
    const id = raw?.question_id;
    const where = `question ${String(id)}`;
    if (!Number.isSafeInteger(id) || id < 1) {
      errors.push(`${where}: question_id must be a positive integer`);
      continue;
    }
    if (seen.has(id)) errors.push(`${where}: duplicate id`);
    seen.add(id);
    safe(`${where} question`, raw.question);
    for (const L of LETTERS) safe(`${where} option ${L}`, raw.options?.[L]);
    if (typeof raw.has_figure !== "boolean") errors.push(`${where}: has_figure must be a boolean`);
  }
  if (errors.length) throw new Error(`bad data:\n  ${errors.join("\n  ")}`);
  return [...(items as TextItem[])].sort((a, b) => a.question_id - b.question_id);
}

const q = (s: string): string => `${TAG}${s}${TAG}`;

/** The text of the whole migration for `items` (pure; the test compares it with the committed file). */
export function buildMigration(items: TextItem[]): string {
  const sorted = validate(items);
  const ids = sorted.map((i) => i.question_id);
  const figures = sorted.filter((i) => i.has_figure).length;
  const rollbackIds: string[] = [];
  for (let i = 0; i < ids.length; i += 12) rollbackIds.push(ids.slice(i, i + 12).join(", "));

  const header = `-- «Test ishlash»: the question TEXT of the bank (owner 2026-10-31), a generated DATA migration.
--
-- Every one of the ${sorted.length} questions was stored only as an image (test_questions.image_asset_id; question_text and options were NULL).
-- The owner had each image transcribed to Uzbek text: simple math is Unicode (m³, ×), complex formulas are LaTeX in $…$ (the page renders
-- them with the KaTeX the article viewer already uses). This file carries that text to production without a manual database write.
--
--   test_questions.has_figure  NEW. TRUE when the image holds a drawing or a table the text cannot replace (${figures} questions): the page then
--                              shows the image NEXT TO the text. FALSE for a text-only question (the page offers «Asl rasm» on demand) and for
--                              every image-only question (no text -> the image is the question anyway).
--   question_text, options     the stem and a JSON array of the four options (A..D), exactly the shape lib/server/paid-tests.ts reads.
--
-- Idempotent and never destructive: each UPDATE is guarded by "question_text IS NULL", so a re-run changes nothing, a text an admin
-- corrected later is never overwritten, and a database without these ids (a fresh dev / test one) updates 0 rows.
-- The image stays (image_asset_id untouched), so the AI analysis cache (test_analyses, keyed by the stem hash) is not invalidated by this file.
-- Question 478's image had no question text at all; its text was rewritten to match the stored answer (see data/tests/bmb-texts.json "generated").
--
-- GENERATED by scripts/gen-tests-text-migration.mts from data/tests/bmb-texts.json -- never edit by hand; edit the JSON and re-run
-- (tests/tests-text-migration.test.mts fails when this file and the JSON drift apart).
--
-- Additive only: one new nullable-safe column (NOT NULL DEFAULT FALSE is a metadata-only change) and guarded data UPDATEs.
--
-- ROLLBACK:
--   UPDATE test_questions SET question_text = NULL, options = NULL, updated_at = now()
--    WHERE image_asset_id IS NOT NULL AND id IN (
${rollbackIds.map((r, i) => `--     ${r}${i < rollbackIds.length - 1 ? "," : ""}`).join("\n")}
--   );
--   ALTER TABLE test_questions DROP COLUMN IF EXISTS has_figure;
--   DELETE FROM schema_migrations WHERE name = '${MIGRATION_FILE}';
SET LOCAL lock_timeout = '5s';

ALTER TABLE test_questions ADD COLUMN IF NOT EXISTS has_figure BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN test_questions.has_figure IS 'The image holds a drawing or table the question_text cannot replace: the page shows it next to the text.';
`;

  const body = sorted
    .map((it) => {
      const label = [it.subject, it.file].filter(Boolean).join(" ");
      return `
-- ${it.question_id}${label ? ` ${label.replace(/[\r\n]/g, " ")}` : ""}${it.generated ? " (text rewritten to match the stored answer)" : ""}
UPDATE test_questions SET question_text = ${q(it.question)},
  options = to_jsonb(ARRAY[${LETTERS.map((L) => q(it.options[L])).join(", ")}]::text[]),
  has_figure = ${it.has_figure ? "TRUE" : "FALSE"}, updated_at = now()
 WHERE id = ${it.question_id} AND question_text IS NULL;
`;
    })
    .join("");
  return header + body;
}

const root = fileURLToPath(new URL("..", import.meta.url));
const jsonPath = `${root}data/tests/bmb-texts.json`;
const outPath = `${root}lib/server/migrations/${MIGRATION_FILE}`;

function main(): void {
  const text = buildMigration(JSON.parse(readFileSync(jsonPath, "utf8")) as TextItem[]);
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(outPath, "utf8");
    } catch {
      // missing file = differs
    }
    if (current !== text) {
      console.error(`${MIGRATION_FILE} is out of date: run  npx tsx scripts/gen-tests-text-migration.mts`);
      process.exit(1);
    }
    console.log(`${MIGRATION_FILE} is up to date`);
    return;
  }
  writeFileSync(outPath, text);
  console.log(`wrote ${outPath} (${text.length} bytes)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
