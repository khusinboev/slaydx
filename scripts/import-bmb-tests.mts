/**
 * Imports a test bank export (the @BMB_testbot export, see scripts/export-bmb-tests.md) into SlaydX.
 *
 *   npm run import:tests -- <export.json> <images-dir> [--dry-run]
 *   scripts/heavy.sh npx tsx --conditions=react-server scripts/import-bmb-tests.mts export.json ./images --dry-run
 *
 * Idempotent: questions are keyed by `legacy_ref`, images by SHA-256, so a second run changes nothing. All or
 * nothing: any validation error aborts before the database is touched. `--dry-run` runs the whole import in a
 * transaction and rolls it back (needs DATABASE_URL, writes nothing). Exit code 1 on any error.
 * It reads ONLY the JSON export and the image folder -- never the bmbtestbot database or its bot token.
 */
import { pool } from "../lib/server/db.ts";
import { formatSummary, importPlan, loadExportFile } from "../lib/server/tests-import.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const [jsonPath, imagesDir] = args.filter((a) => !a.startsWith("--"));

async function main(): Promise<number> {
  if (!jsonPath || !imagesDir) {
    console.error("usage: import-bmb-tests.mts <export.json> <images-dir> [--dry-run]");
    return 2;
  }
  const built = loadExportFile(jsonPath, imagesDir);
  if (!built.plan) {
    console.error(`INVALID export (${built.errors.length} error(s)) -- nothing imported:`);
    for (const e of built.errors.slice(0, 50)) console.error(`  - ${e}`);
    if (built.errors.length > 50) console.error(`  ... and ${built.errors.length - 50} more`);
    return 1;
  }
  const summary = await importPlan(built.plan, { dryRun });
  console.log(formatSummary(summary, built.warnings));
  return 0;
}

main()
  .then(async (code) => {
    await pool().end().catch(() => {});
    process.exit(code);
  })
  .catch(async (e) => {
    console.error("import failed:", e instanceof Error ? e.message : e);
    await pool().end().catch(() => {});
    process.exit(1);
  });
