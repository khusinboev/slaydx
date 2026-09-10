import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { applySegments, extractSegments } from "../lib/generation/translate/index.ts";
import { fakeTranslate, makeXlsx } from "./helpers/office-fixtures.ts";

/**
 * XLSX adapteri — matn kataklari tarjima qilinadi, hisob tegilmaydi.
 *
 * Eng katta xavf: `<si>` qo'shilishi yoki o'chirilishi. Kataklar umumiy
 * satrga INDEKS bilan ishora qiladi, ya'ni bitta qo'shimcha `<si>`
 * butun varaqni siljitib yuboradi. Shuning uchun test `<si>` sonini,
 * `count`/`uniqueCount` atributlarini va formulalarni alohida qulflaydi.
 */
const SHARED = "xl/sharedStrings.xml";
const SHEET1 = "xl/worksheets/sheet1.xml";
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

let cached: Uint8Array | null = null;
async function source(): Promise<Uint8Array> {
  if (!cached) cached = await makeXlsx();
  return cached;
}

async function partOf(bytes: Uint8Array, name: string): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  return zip.file(name)!.async("string");
}

async function translated(): Promise<Uint8Array> {
  const src = await source();
  const ex = await extractSegments("xlsx", src);
  return applySegments("xlsx", src, new Map(ex.segments.map((s) => [s.id, fakeTranslate(s.text)])));
}

test("XLSX: segmentlar, kontekst va o'tkazib yuboriladigan satrlar", async () => {
  const ex = await extractSegments("xlsx", await source());
  const ids = ex.segments.map((s) => s.id);

  assert.deepEqual(ids, ["x:s0", "x:s1", "x:s2", "x:i1:A4"]);
  const by = new Map(ex.segments.map((s) => [s.id, s]));

  // Boy satr — `<r>` runlari markerlarga aylanadi.
  assert.equal(by.get("x:s1")?.text, "⟦r1⟧Qalin sarlavha⟦/r1⟧⟦r2⟧ va oddiy qismi⟦/r2⟧");
  // `inlineStr` katak — o'z id si va varaq nomi.
  assert.equal(by.get("x:i1:A4")?.text, "Katak ichidagi matn");
  assert.equal(by.get("x:i1:A4")?.ctx, "Hisobot", "ctx = varaq nomi");
  assert.equal(by.get("x:s0")?.ctx, "Hisobot", "umumiy satr birinchi uchragan varaqdan ctx oladi");
  for (const s of ex.segments) assert.equal(s.kind, "cell");

  // «2024» — raqam, «=SUM(A1:A2)» — formula: ikkalasi ham segment emas.
  assert.ok(!ex.segments.some((s) => s.text.includes("2024")), "raqamli satr tarjima qilinmaydi");
  assert.ok(!ex.segments.some((s) => s.text.startsWith("=")), "formula satri tarjima qilinmaydi");

  assert.deepEqual(ex.warnings, ["Formulalar va raqamlar o'zgartirilmadi — ular hisob-kitobga bog'liq"]);
});

test("XLSX: aylanma — matn almashadi, hisob va indekslar joyida", async () => {
  const src = await source();
  const out = await translated();
  const before = await partOf(src, SHARED);
  const after = await partOf(out, SHARED);

  // `<si>` soni va `sst` atributlari o'zgarmaydi — indekslar siljimasin.
  assert.equal(count(after, /<si>/g), count(before, /<si>/g));
  assert.match(after, /<sst [^>]*count="6" uniqueCount="5"/);

  assert.match(after, /<si><t xml:space="preserve">\[T\]Mahsulot nomi<\/t><\/si>/);
  // Boy satrda `rPr` (qalin) saqlanadi va ikkala run ham qoladi.
  assert.match(after, /<si><r><rPr><b\/><\/rPr><t xml:space="preserve">\[T\]Qalin sarlavha<\/t><\/r><r><t xml:space="preserve">\[T\] va oddiy qismi<\/t><\/r><\/si>/);
  // Raqam va formula satrlari BAYT-BA-BAYT o'z holicha.
  assert.ok(after.includes("<si><t>2024</t></si>"), "raqamli satr tegilmagan");
  assert.ok(after.includes("<si><t>=SUM(A1:A2)</t></si>"), "formula satri tegilmagan");

  const sheet = await partOf(out, SHEET1);
  assert.match(sheet, /<c r="A4" t="inlineStr"><is><t xml:space="preserve">\[T\]Katak ichidagi matn<\/t><\/is><\/c>/);
  // Formula, hisoblangan qiymat va umumiy satr indekslari tegilmaydi.
  assert.ok(sheet.includes("<f>SUM(A1:A2)</f><v>360</v>"), "formula va qiymat");
  assert.ok(sheet.includes('<c r="A2"><v>120</v></c>'), "raqamli katak");
  assert.ok(sheet.includes('<c r="A1" t="s"><v>0</v></c>'), "umumiy satr indeksi");

  // Ikkinchi varaq va kitob tuzilmasi o'zgarmaydi.
  assert.equal(await partOf(out, "xl/worksheets/sheet2.xml"), await partOf(src, "xl/worksheets/sheet2.xml"));
  assert.equal(await partOf(out, "xl/workbook.xml"), await partOf(src, "xl/workbook.xml"));
});

test("XLSX: tarjimasiz xarita faylni o'zgartirmaydi", async () => {
  const src = await source();
  const out = await applySegments("xlsx", src, new Map());
  assert.equal(await partOf(out, SHARED), await partOf(src, SHARED));
  assert.equal(await partOf(out, SHEET1), await partOf(src, SHEET1));
});
