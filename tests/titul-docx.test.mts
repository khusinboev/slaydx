import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import JSZip from "jszip";
import { titulInputFromValues } from "../lib/generation/title-page/input.ts";
import { planTitlePage, titulRuns } from "../lib/generation/title-page/layout.ts";
import { renderTitulDocx } from "../lib/generation/title-page/render-docx.ts";
import { renderDocx } from "../lib/generation/render-docx.ts";
import { TITUL_LAYOUTS_OF, TITUL_LIMITS, TITUL_WORK_TYPES, type TitulModel } from "../lib/generation/title-page/types.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";
import type { FormValues } from "../lib/types.ts";

/**
 * «Titul» DOCX (`title-page/render-docx.ts`): a real double page border, explicit `lineRule="auto"`, Times New
 * Roman, the plan's text in the plan's order, and ONE page at maximal field lengths (LibreOffice, skipped where it
 * is not installed — CI).
 *
 * Mutations (each turned a test red, then restored):
 *   M1. `lineRule: LineRuleType.AUTO` dropped from `paragraph()` -> «lineRule auto on every spacing»;
 *   M2. border style `DOUBLE` -> `SINGLE` -> «double page border»;
 *   M3. the zone rows' `HeightRule.ATLEAST` height doubled -> «one page at maximal lengths» (LibreOffice: 2 pages);
 *   M4. `renderDocx` without the `doc.titul` branch -> «renderDocx draws the titul plan».
 */

const run = promisify(execFile);

const SAMPLE: FormValues = {
  faculty: "Kompyuter injiniringi",
  department: "Axborot xavfsizligi",
  subject: "Dasturlash asoslari",
  topic: "Sun'iy intellekt",
  author: "Aliyev V.",
  group: "912-21",
  supervisor: "Karimov B.",
  supervisorRole: "katta o'qituvchi",
  year: 2026,
};

const fill = (n: number, word: string) => Array.from({ length: Math.ceil(n / (word.length + 1)) }, () => word).join(" ").slice(0, n);
const MAX: FormValues = {
  ...SAMPLE,
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
  directionCode: "60610100",
  speciality: fill(TITUL_LIMITS.speciality, "Xavfsizligining"),
  specialityCode: "70610101",
  udk: "004.8",
  group: "912-21-ABCDEFGHIJKLM",
  course: "4",
  labNumber: "12",
  city: fill(TITUL_LIMITS.city, "Toshkentning"),
  ministry: "custom",
  ministryCustom: `${fill(TITUL_LIMITS.ministryCustom, "VAZIRLIGINING")}\n${fill(TITUL_LIMITS.ministryCustom, "AGENTLIGINING")}`,
};

const model = (v: FormValues): TitulModel => ({ input: titulInputFromValues(v), overrides: {} });

async function documentXml(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  return zip.file("word/document.xml")!.async("string");
}

const textOf = (xml: string) => [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]!).join("");
const unescape = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

test("double page border measured from the page edge; none when switched off", async () => {
  const on = await documentXml(await renderTitulDocx(model({ ...SAMPLE, layout: "classic" })));
  assert.match(on, /<w:pgBorders[^>]*w:offsetFrom="page"/);
  for (const side of ["top", "left", "bottom", "right"]) assert.match(on, new RegExp(`<w:${side} w:val="double"`), side);
  const off = await documentXml(await renderTitulDocx(model({ ...SAMPLE, layout: "classic", border: false })));
  assert.ok(!off.includes("<w:pgBorders"));
  const otm = await documentXml(await renderTitulDocx(model({ ...SAMPLE, layout: "mavzusida" })));
  assert.ok(!otm.includes("<w:pgBorders"), "border default is classic only");
});

test("every w:spacing with w:line writes lineRule auto; fonts are Times New Roman", async () => {
  for (const layout of ["classic", "mavzusida", "right-block"]) {
    const xml = await documentXml(await renderTitulDocx(model({ ...SAMPLE, layout })));
    const spacings = [...xml.matchAll(/<w:spacing [^>]*>/g)].map((m) => m[0]);
    assert.ok(spacings.length > 10, layout);
    for (const s of spacings.filter((x) => x.includes("w:line="))) assert.match(s, /w:lineRule="auto"/, `${layout}: ${s}`);
    const fonts = new Set([...xml.matchAll(/w:ascii="([^"]+)"/g)].map((m) => m[1]));
    assert.deepEqual([...fonts], ["Times New Roman"], layout);
  }
});

test("the DOCX text is the plan's runs in the plan's order (classic sample)", async () => {
  const m = model({ ...SAMPLE, layout: "classic" });
  const xml = await documentXml(await renderTitulDocx(m));
  const docx = unescape(textOf(xml)).replace(/\s+/g, "");
  const runs = titulRuns(planTitlePage(m))
    .map((r) => r.text)
    .join("")
    .replace(/\s+/g, "");
  assert.equal(docx, runs);
});

test("renderDocx draws the titul plan (rebuild after an edit uses the same renderer)", async () => {
  const m: TitulModel = { ...model(SAMPLE), overrides: { heading: "KURS LOYIHASI" } };
  const doc = { meta: { language: "uz" }, titlePage: false, toc: false, sections: [], titul: m } as unknown as AcademicDoc;
  const xml = await documentXml(await renderDocx(doc));
  assert.ok(textOf(xml).includes("KURS LOYIHASI"));
  assert.ok(xml.includes("<w:pgBorders"));
});

const hasLo = existsSync("/usr/bin/soffice") && existsSync("/usr/bin/pdfinfo");

test("ONE page in LibreOffice for every type × layout at maximal field lengths", { skip: hasLo ? false : "LibreOffice yo'q" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "slaydx-titul-"));
  const files: string[] = [];
  for (const t of TITUL_WORK_TYPES) {
    for (const layout of TITUL_LAYOUTS_OF[t]) {
      for (const lang of ["uz", "ru"]) {
        const f = join(dir, `${t}-${layout}-${lang}.docx`);
        await writeFile(f, await renderTitulDocx(model({ ...MAX, workType: t, layout, lang })));
        files.push(f);
      }
    }
  }
  await run("soffice", ["--headless", "--norestore", `-env:UserInstallation=file://${join(dir, "profile")}`, "--convert-to", "pdf", "--outdir", dir, ...files], { timeout: 600_000 });
  for (const f of files) {
    const { stdout } = await run("pdfinfo", [f.replace(/\.docx$/, ".pdf")]);
    assert.equal(Number(stdout.match(/Pages:\s+(\d+)/)?.[1]), 1, f);
  }
});
