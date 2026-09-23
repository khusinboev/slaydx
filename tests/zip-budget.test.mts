import test from "node:test";
import assert from "node:assert/strict";
import { extractFromBuffer, MAX_UNZIPPED_BYTES } from "../lib/extract-text.ts";
import { extractSegments } from "../lib/generation/translate/index.ts";
import { parsePptxTemplate, TemplateError } from "../lib/generation/pptx-template.ts";
import * as xmlScan from "../lib/generation/translate/xml-scan.ts";
import { makeZip, peakGrowth, templateEntries } from "./helpers/parse-fixtures.ts";

/**
 * SECB-02 / FILE-02 / TEST-11 (C06): ZIP «bomba» byudjeti HAQIQIY ochilgan
 * hajmni sanashi kerak, arxiv metadatasini emas.
 *
 * Fikstura: `word/document.xml` (va namunada master) ~160 MB bo'shliqqa
 * ochiladi, lekin markaziy katalogda 1 000 bayt deb yozilgan. Ilgari
 * o'quvchi metadataga ishonib hammasini xotiraga ochar, keyingina JSZip
 * «size mismatch» bilan yiqilardi (namuna tahlilida esa byudjet umuman
 * yo'q edi). Endi oqim byudjetdan oshgan zahoti to'xtaydi: xotira o'sishi
 * byudjet + kichik zaxiradan oshmaydi va xabar «juda katta».
 */

const BOMB = 160 * 1024 * 1024;
const MARGIN = 48 * 1024 * 1024;

function ab(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

let docxBomb: Uint8Array | null = null;
async function bombDocx(): Promise<Uint8Array> {
  docxBomb ??= await makeZip([
    { name: "[Content_Types].xml", data: "<Types/>" },
    { name: "word/document.xml", repeat: { fill: " ", bytes: BOMB }, declaredSize: 1000 },
  ]);
  return docxBomb;
}

test("fikstura: bomba kichik (siqilgan) va metadata yolg'on", async () => {
  const bytes = await bombDocx();
  assert.ok(bytes.length < 1024 * 1024, `zip ${bytes.length} bayt`);
});

test("extractFromBuffer(docx): yolg'on hajmli bomba — «juda katta», xotira byudjet ichida", async () => {
  const bytes = await bombDocx();
  const { result, error, peak } = await peakGrowth(() => extractFromBuffer("x.docx", ab(bytes)));
  assert.equal(error, undefined);
  assert.match(result!.error ?? "", /juda katta/);
  assert.ok(peak < MAX_UNZIPPED_BYTES + MARGIN, `xotira o'sishi ${(peak / 1e6).toFixed(0)} MB`);
});

test("extractSegments(docx) / openOoxml: yolg'on hajmli bomba — «juda katta», xotira byudjet ichida", async () => {
  const bytes = await bombDocx();
  const { error, peak } = await peakGrowth(() => extractSegments("docx", bytes));
  assert.match(String((error as Error)?.message), /juda katta/);
  assert.ok(peak < MAX_UNZIPPED_BYTES + MARGIN, `xotira o'sishi ${(peak / 1e6).toFixed(0)} MB`);
});

test("parsePptxTemplate: masterdagi bomba — TemplateError «too-big», xotira namuna byudjeti ichida", async () => {
  const bytes = await makeZip(
    templateEntries({
      "ppt/slideMasters/slideMaster1.xml": {
        name: "ppt/slideMasters/slideMaster1.xml",
        repeat: { fill: " ", bytes: BOMB },
        declaredSize: 1000,
      },
    }),
  );
  const { error, peak } = await peakGrowth(() => parsePptxTemplate(bytes));
  assert.ok(error instanceof TemplateError, `xato turi: ${String(error)}`);
  assert.equal((error as TemplateError).code, "too-big");
  assert.ok(peak < MAX_UNZIPPED_BYTES + MARGIN, `xotira o'sishi ${(peak / 1e6).toFixed(0)} MB`);
});

test("parsePptxTemplate: metadata ROST bo'lsa ham katta XML byudjetdan oshsa rad etiladi", async () => {
  const bytes = await makeZip(
    templateEntries({
      "ppt/theme/theme1.xml": { name: "ppt/theme/theme1.xml", repeat: { fill: " ", bytes: 64 * 1024 * 1024 } },
    }),
  );
  await assert.rejects(parsePptxTemplate(bytes), (e: unknown) => e instanceof TemplateError && e.code === "too-big");
});

test("parsePptxTemplate: juda ko'p layout — cheklov bilan rad etiladi", async () => {
  const layouts = Array.from({ length: 500 }, (_, i) => `<Relationship Id="rL${i}" Type="x/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`).join("");
  const bytes = await makeZip(
    templateEntries({
      "ppt/slideMasters/_rels/slideMaster1.xml.rels": {
        name: "ppt/slideMasters/_rels/slideMaster1.xml.rels",
        data: `<Relationships>${layouts}<Relationship Id="rT" Type="x/theme" Target="../theme/theme1.xml"/></Relationships>`,
      },
    }),
  );
  await assert.rejects(parsePptxTemplate(bytes), (e: unknown) => e instanceof TemplateError && e.code === "too-big");
});

test("yozuvlar soni: 10 001 yozuvli arxiv ochishdan OLDIN rad etiladi (EOCD soniga ishonilmaydi)", async () => {
  const max = (xmlScan as { MAX_ZIP_ENTRIES?: number }).MAX_ZIP_ENTRIES ?? 10_000;
  const entries = Array.from({ length: max + 1 }, (_, i) => ({ name: `word/media/f${i}.xml`, data: "x", stored: true }));
  entries.push({ name: "word/document.xml", data: "<w:document/>", stored: true });
  // EOCD dagi son ataylab 2 deb yozilgan — JSZip baribir hammasini o'qiydi.
  const bytes = await makeZip(entries, { eocdCount: 2 });
  await assert.rejects(extractSegments("docx", bytes), /juda ko'p/);
  const out = await extractFromBuffer("x.docx", ab(bytes));
  assert.match(out.error ?? "", /juda ko'p/);
  await assert.rejects(parsePptxTemplate(bytes), (e: unknown) => e instanceof TemplateError && e.code === "too-big");
});

test("oddiy DOCX/namuna byudjet ostida avvalgidek o'qiladi", async () => {
  const bytes = await makeZip([
    { name: "[Content_Types].xml", data: "<Types/>" },
    { name: "word/document.xml", data: "<w:document><w:body><w:p><w:r><w:t>Salom dunyo</w:t></w:r></w:p></w:body></w:document>" },
  ]);
  assert.equal((await extractFromBuffer("x.docx", ab(bytes))).text, "Salom dunyo");
  const ex = await extractSegments("docx", bytes);
  assert.deepEqual(ex.segments.map((s) => s.text), ["Salom dunyo"]);
  const profile = await parsePptxTemplate(await makeZip(templateEntries()));
  assert.equal(profile.layouts.length, 1);
});
