/**
 * «Titul» eye check: renders DOCX title pages (every work type × every offered
 * layout, plus a maximal-length case) and writes them to an output folder.
 * Convert and look at them afterwards (LibreOffice + pdftoppm, through
 * `scripts/heavy.sh`):
 *
 *   scripts/heavy.sh npx tsx scripts/titul-shots.mts <out-dir> [--max]
 *   scripts/heavy.sh soffice --headless --convert-to pdf --outdir <out-dir> <out-dir>/*.docx
 *   scripts/heavy.sh sh -c 'for f in <out-dir>/*.pdf; do pdftoppm -r 60 -png "$f" "${f%.pdf}"; done'
 *
 * No network, no database: the renderer is a pure function of the form values.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { titulInputFromValues } from "../lib/generation/title-page/input";
import { renderTitulDocx } from "../lib/generation/title-page/render-docx";
import { TITUL_LAYOUTS_OF, TITUL_LIMITS, TITUL_WORK_TYPES } from "../lib/generation/title-page/types";
import type { FormValues } from "../lib/types";

const out = process.argv[2];
if (!out) {
  console.error("usage: titul-shots.mts <out-dir> [--max]");
  process.exit(2);
}
mkdirSync(out, { recursive: true });

/** The owner's sample values. */
const SAMPLE: FormValues = {
  ministry: "oliy",
  university: "",
  faculty: "Kompyuter injiniringi",
  department: "Axborot xavfsizligi",
  subject: "Dasturlash asoslari",
  topic: "Sun'iy intellekt",
  author: "Aliyev V.",
  group: "912-21",
  course: "",
  supervisor: "Karimov B.",
  supervisorRole: "katta o'qituvchi",
  city: "Toshkent",
  year: 2026,
};

const RICH: FormValues = {
  ...SAMPLE,
  university: "Muhammad al-Xorazmiy nomidagi Toshkent axborot texnologiyalari universiteti",
  course: "3",
  direction: "Kompyuter injiniringi",
  directionCode: "60610100",
  approver: "Rahimov S.",
  reviewer: "dotsent Yusupov A.",
  udk: "004.8",
  specialityCode: "70610101",
  speciality: "Axborot xavfsizligi",
  labNumber: "3",
};

const fill = (n: number, word: string) => Array.from({ length: Math.ceil(n / (word.length + 1)) }, () => word).join(" ").slice(0, n);

/** Every text at its form cap — the one-page proof. */
const MAX: FormValues = {
  ...RICH,
  university: fill(TITUL_LIMITS.university, "Universitetining"),
  faculty: fill(TITUL_LIMITS.faculty, "Injiniringining"),
  department: fill(TITUL_LIMITS.department, "Xavfsizligining"),
  subject: fill(TITUL_LIMITS.subject, "Dasturlashning"),
  topic: fill(TITUL_LIMITS.topic, "Intellektning"),
  author: fill(TITUL_LIMITS.name, "Aliyevaning"),
  supervisor: fill(TITUL_LIMITS.name, "Karimovning"),
  supervisorRole: fill(TITUL_LIMITS.role, "o'qituvchisining"),
  approver: fill(TITUL_LIMITS.name, "Rahimovning"),
  reviewer: fill(TITUL_LIMITS.name + TITUL_LIMITS.role, "Yusupovning"),
  direction: fill(TITUL_LIMITS.direction, "Injiniringining"),
  speciality: fill(TITUL_LIMITS.speciality, "Xavfsizligining"),
  group: "912-21-ABCDEFGHIJKLM",
  city: fill(TITUL_LIMITS.city, "Toshkentning"),
  ministry: "custom",
  ministryCustom: `${fill(TITUL_LIMITS.ministryCustom, "VAZIRLIGINING")}\n${fill(TITUL_LIMITS.ministryCustom, "AGENTLIGINING")}`,
};

const max = process.argv.includes("--max");
const jobs: Array<{ name: string; values: FormValues }> = [{ name: "sample-classic", values: { ...SAMPLE, workType: "coursework", layout: "classic" } }];
for (const t of TITUL_WORK_TYPES) {
  for (const layout of TITUL_LAYOUTS_OF[t]) jobs.push({ name: `${t}-${layout}`, values: { ...(max ? MAX : RICH), workType: t, layout } });
}
for (const lang of ["uz-cyrl", "ru"]) jobs.push({ name: `lang-${lang}`, values: { ...RICH, workType: "coursework", layout: "classic", lang } });

for (const j of jobs) {
  const input = titulInputFromValues(j.values);
  const bytes = await renderTitulDocx({ input, overrides: {} });
  writeFileSync(join(out, `${max ? "max-" : ""}${j.name}.docx`), bytes);
}
console.log(`${jobs.length} files -> ${out}`);
