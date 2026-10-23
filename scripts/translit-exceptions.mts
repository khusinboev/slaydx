/**
 * Regenerates `lib/translit/exceptions.ts` from the exception TSV.
 *
 *   npm run translit:exceptions                 # regenerate from docs/program-17/alphabet-exceptions-v1.tsv
 *   npm run translit:exceptions -- list.tsv     # use another TSV (the owner's corrected list)
 *   npm run translit:exceptions -- --check      # exit 1 when the module is out of sync (CI/pre-commit)
 *
 * Updating the list is ONE command: replace the TSV (or pass the new file) and run it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EXCEPTIONS_TS_PATH, EXCEPTIONS_TSV_PATH, parseExceptionsTsv, renderExceptions } from "../lib/translit/exceptions-tsv.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const tsvArg = args.find((a) => !a.startsWith("--"));
const tsvPath = tsvArg ? resolve(process.cwd(), tsvArg) : resolve(root, EXCEPTIONS_TSV_PATH);
const outPath = resolve(root, EXCEPTIONS_TS_PATH);

const rows = parseExceptionsTsv(readFileSync(tsvPath, "utf8"));
const next = renderExceptions(rows);

if (check) {
  const current = (() => {
    try {
      return readFileSync(outPath, "utf8");
    } catch {
      return "";
    }
  })();
  if (current !== next) {
    console.error(`${EXCEPTIONS_TS_PATH} is out of sync with ${tsvPath}. Run: npm run translit:exceptions`);
    process.exit(1);
  }
  console.log(`${EXCEPTIONS_TS_PATH} is in sync (${rows.length} entries).`);
} else {
  writeFileSync(outPath, next);
  console.log(`${EXCEPTIONS_TS_PATH}: ${rows.length} entries written from ${tsvPath}.`);
}
