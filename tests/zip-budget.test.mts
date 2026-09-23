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

/**
 * W1-D review R2: EOCD dan keyin > 64 KB «to'ldirma» yoki ZIP64 belgisi bilan
 * oldingi sanagich 0 qaytarar va JSZip 60 000 yozuvni ochib bo'lgachgina
 * rad etilardi. Endi JSZip umuman chaqirilmasligi kerak.
 */
async function withLoadSpy<T>(fn: () => Promise<T>): Promise<{ calls: number; error: unknown }> {
  const JSZip = (await import("jszip")).default;
  const original = JSZip.loadAsync;
  let calls = 0;
  JSZip.loadAsync = ((...args: Parameters<typeof original>) => {
    calls++;
    return original.apply(JSZip, args);
  }) as typeof original;
  try {
    await fn();
    return { calls, error: undefined };
  } catch (error) {
    return { calls, error };
  } finally {
    JSZip.loadAsync = original;
  }
}

async function manyEntries(extra: number): Promise<Buffer> {
  const max = (xmlScan as { MAX_ZIP_ENTRIES?: number }).MAX_ZIP_ENTRIES ?? 10_000;
  const entries = Array.from({ length: max + extra }, (_, i) => ({ name: `word/media/f${i}.xml`, data: "", stored: true }));
  entries.push({ name: "word/document.xml", data: "<w:document/>", stored: true });
  return Buffer.from(await makeZip(entries));
}

test("yozuvlar soni: EOCD dan keyin 70 KB to'ldirma — JSZip chaqirilmasdan rad etiladi", async () => {
  const bytes = new Uint8Array(Buffer.concat([await manyEntries(1), Buffer.alloc(70 * 1024)]));
  const r = await withLoadSpy(() => extractSegments("docx", bytes));
  assert.match(String((r.error as Error)?.message), /juda ko'p/);
  assert.equal(r.calls, 0, "JSZip.loadAsync chaqirilmasligi kerak");
});

test("ZIP64 belgili EOCD — JSZip chaqirilmasdan rad etiladi", async () => {
  const zip = Buffer.from(await makeZip([{ name: "word/document.xml", data: "<w:document/>", stored: true }]));
  const eocd = zip.length - 22;
  zip.writeUInt32LE(0xffffffff, eocd + 16); // markaziy katalog offseti → ZIP64 da
  const r = await withLoadSpy(() => extractSegments("docx", new Uint8Array(zip)));
  assert.ok(r.error instanceof Error, "rad etilishi kerak");
  assert.match((r.error as Error).message, /ZIP64|juda ko'p/);
  assert.equal(r.calls, 0, "JSZip.loadAsync chaqirilmasligi kerak");
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
