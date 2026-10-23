/**
 * Pure helpers for the exception list: parse the owner's TSV and render
 * `lib/translit/exceptions.ts`. The CLI is `scripts/translit-exceptions.mts`
 * (`npm run translit:exceptions`); the sync test uses the same functions.
 *
 * TSV: a header row, then `kirill <TAB> lotin [<TAB> turkum [<TAB> izoh]]`.
 * `lotin` is the CURRENT Latin spelling (oʻ gʻ with U+02BB, tutuq U+02BC); the
 * NEW Latin form is derived by the converter itself.
 */

export type ExceptionRow = { cyr: string; lat: string; category: string; note: string };

export const EXCEPTIONS_TSV_PATH = "docs/program-17/alphabet-exceptions-v1.tsv";
export const EXCEPTIONS_TS_PATH = "lib/translit/exceptions.ts";

const CYR_WORD = /^[Ѐ-ӿ]+(?:-[Ѐ-ӿ]+)*$/u;
const LAT_WORD = /^[A-Za-zʻʼ]+(?:-[A-Za-zʻʼ]+)*$/;

/** Strict parse: any malformed or duplicate row is an error with its line number. */
export function parseExceptionsTsv(tsv: string): ExceptionRow[] {
  const lines = tsv.replace(/^﻿/, "").split(/\r?\n/);
  const rows: ExceptionRow[] = [];
  const seenCyr = new Set<string>();
  const seenLat = new Set<string>();
  const problems: string[] = [];
  lines.forEach((line, idx) => {
    if (idx === 0 || !line.trim()) return;
    const [cyr = "", lat = "", category = "", note = ""] = line.split("\t").map((c) => c.trim());
    const at = `line ${idx + 1}`;
    if (!CYR_WORD.test(cyr)) return void problems.push(`${at}: «${cyr}» is not a Cyrillic word`);
    if (!LAT_WORD.test(lat)) return void problems.push(`${at}: «${lat}» is not a Latin word (use ʻ U+02BB and ʼ U+02BC)`);
    const kc = cyr.toLowerCase();
    const kl = lat.toLowerCase();
    if (seenCyr.has(kc)) return void problems.push(`${at}: duplicate Cyrillic «${cyr}»`);
    if (seenLat.has(kl)) return void problems.push(`${at}: duplicate Latin «${lat}»`);
    seenCyr.add(kc);
    seenLat.add(kl);
    rows.push({ cyr, lat, category, note });
  });
  if (problems.length) throw new Error(`Exception list is invalid:\n${problems.join("\n")}`);
  return rows;
}

/** Exact text of the generated module. */
export function renderExceptions(rows: readonly ExceptionRow[]): string {
  const body = rows.map((r) => `  [${JSON.stringify(r.cyr)}, ${JSON.stringify(r.lat)}],`).join("\n");
  return `/**
 * GENERATED — do not edit by hand.
 * Source: ${EXCEPTIONS_TSV_PATH}
 * Regenerate with \`npm run translit:exceptions\` (see scripts/translit-exceptions.mts).
 *
 * [Cyrillic, current Latin] pairs; the new Latin form is derived by the converter.
 */
export const EXCEPTIONS: readonly (readonly [string, string])[] = [
${body}
];
`;
}
