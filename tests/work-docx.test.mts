import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { CM, profileFor, workProfile } from "../lib/generation/docx-profile.ts";
import { renderDocx } from "../lib/generation/render-docx.ts";
import { sampleWorkDoc } from "../lib/generation/work/samples.ts";
import type { AcademicDoc, DocMeta } from "../lib/generation/types.ts";

/**
 * TALABA ISHI DOCX (AUDIT-19 WP-C).
 *
 * XML NING O'ZI o'qiladi (`word/document.xml`) — foydalanuvchi aynan
 * shuni oladi. Joylashuv qoidalari (uslubiy ko'rsatmalar): jadval raqami
 * TEPA O'NGDA va nomi uning OSTIDA, «Manba:» jadvaldan keyin 10 pt
 * kursiv, rasm sarlavhasi PASTDA, bob YANGI VARAQDAN, titulda sahifa
 * raqami YO'Q, chegara fan profilidan, `lineRule="auto"` hamma joyda.
 */

const META: DocMeta = {
  topic: "Oliy ta’limda adaptiv o‘qitish tizimlarini joriy etish",
  workLabel: "Kurs ishi",
  language: "uz",
  toolId: "coursework",
} as unknown as DocMeta;

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_URL = `data:image/png;base64,${PNG_1X1}`;

async function xmlOf(doc: AcademicDoc) {
  const bytes = await renderDocx(doc);
  const zip = await JSZip.loadAsync(Buffer.from(bytes));
  const xml = await zip.file("word/document.xml")!.async("string");
  return { xml, bytes };
}

function textNodes(xml: string): string[] {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((m) =>
      m[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .trim(),
    )
    .filter(Boolean);
}

/**
 * TANA — mundarija MAYDONIDAN keyingi qism.
 *
 * Bu SHART: mundarija tarkibi maydon ichiga tayyor paragraflar bilan
 * yoziladi, ya'ni «1-BOB. …» matni XML da IKKI marta uchraydi. Joylashuv
 * tekshiruvlari TANADAGI sarlavhaga tegishli, mundarija qatoriga emas.
 */
function bodyOf(xml: string): string {
  const i = xml.indexOf("</w:sdtContent>");
  return i >= 0 ? xml.slice(i) : xml;
}

/** `needle` matnli `<w:t>` ning XML dagi o'rni. */
function posOf(xml: string, needle: string): number {
  const i = xml.indexOf(`>${needle}<`);
  assert.ok(i >= 0, `«${needle}» topilmadi`);
  return i;
}

/** `needle` matnini o'z ichiga olgan `<w:p>` paragrafi. */
function paraOf(xml: string, needle: string): string {
  const at = posOf(xml, needle);
  const from = Math.max(xml.lastIndexOf("<w:p>", at), xml.lastIndexOf("<w:p ", at));
  const to = xml.indexOf("</w:p>", at);
  assert.ok(from >= 0 && to > from, `«${needle}» paragrafi topilmadi`);
  return xml.slice(from, to);
}

/* ══════════════════════════════ sarlavhalar ══════════════════════════════ */

test("bo'lim sarlavhasi BOSH HARF, MARKAZDA, qalin; paragraf CHAPDA", async () => {
  const { xml } = await xmlOf(sampleWorkDoc(META));
  const t = textNodes(xml);
  assert.ok(t.includes("KIRISH"));
  assert.ok(t.includes("1-BOB. ADAPTIV O‘QITISH TIZIMLARINING NAZARIY ASOSLARI"));
  assert.ok(t.includes("1.1. Adaptiv o‘qitish tushunchasi va tasnifi"));
  assert.ok(t.includes("XULOSA"));
  assert.ok(t.includes("FOYDALANILGAN ADABIYOTLAR"));
  assert.ok(t.includes("1-ILOVA"));

  const body = bodyOf(xml);
  const chapter = paraOf(body, "1-BOB. ADAPTIV O‘QITISH TIZIMLARINING NAZARIY ASOSLARI");
  assert.ok(chapter.includes('<w:jc w:val="center"/>'), "bob sarlavhasi markazda emas");
  assert.ok(chapter.includes("<w:b/>"), "bob sarlavhasi qalin emas");
  assert.ok(chapter.includes('w:val="Heading1"'), "bob «Heading 1» uslubida emas (Word mundarijasi uni ko'rmaydi)");

  const para = paraOf(body, "1.1. Adaptiv o‘qitish tushunchasi va tasnifi");
  assert.ok(para.includes('<w:jc w:val="left"/>'), "paragraf sarlavhasi chapda emas");
  assert.ok(para.includes('w:val="Heading2"'), "paragraf «Heading 2» uslubida emas");
});

test("kirish, boblar, xulosa, adabiyotlar va ilova YANGI VARAQDAN; paragraf davomida", async () => {
  const body = bodyOf((await xmlOf(sampleWorkDoc(META))).xml);
  for (const head of ["KIRISH", "1-BOB. ADAPTIV O‘QITISH TIZIMLARINING NAZARIY ASOSLARI", "2-BOB. TIZIMNI JORIY ETISH VA SAMARADORLIKNI BAHOLASH", "XULOSA", "FOYDALANILGAN ADABIYOTLAR", "1-ILOVA"]) {
    assert.ok(paraOf(body, head).includes("<w:pageBreakBefore/>"), `«${head}» yangi varaqdan boshlanmadi`);
  }
  assert.ok(!paraOf(body, "1.2. Xorijiy va mahalliy tajriba tahlili").includes("<w:pageBreakBefore/>"), "paragraf sababsiz yangi varaqqa ko'chdi");
});

test("mundarija YO'Q bo'lsa birinchi sarlavha uzilish OLMAYDI (titul ortida bo'sh varaq qolmasin)", async () => {
  const doc = sampleWorkDoc(META);
  doc.toc = false;
  const { xml } = await xmlOf(doc);
  assert.ok(!paraOf(xml, "KIRISH").includes("<w:pageBreakBefore/>"), "birinchi band ortiqcha uzilish oldi");
  // Keyingilari baribir yangi varaqdan.
  assert.ok(paraOf(xml, "XULOSA").includes("<w:pageBreakBefore/>"));
});

/* ══════════════════════════════ jadval ══════════════════════════════ */

test("jadval: raqam TEPA O'NGDA, nomi USTIDA markazda, «Manba:» OSTIDA 10 pt kursiv", async () => {
  const xml = bodyOf((await xmlOf(sampleWorkDoc(META))).xml);
  const number = posOf(xml, "1.1-jadval");
  const caption = posOf(xml, "Adaptiv o‘qitish tizimlarining qiyosiy tavsifi");
  const header = posOf(xml, "Moslashuv turi");
  const source = posOf(xml, "Manba: muallif tomonidan tuzilgan");
  assert.ok(number < caption, "raqam nomdan keyin chizilgan");
  assert.ok(caption < header, "nom jadvalning ICHIDA — u TEPADA bo'lishi kerak");
  assert.ok(header < source, "«Manba:» jadvaldan oldin chizilgan");

  const numberP = paraOf(xml, "1.1-jadval");
  assert.ok(numberP.includes('<w:jc w:val="right"/>'), "jadval raqami o'ngda emas");
  assert.ok(numberP.includes("<w:keepNext/>"), "jadval raqami jadvaldan ajralib qolishi mumkin");

  const captionP = paraOf(xml, "Adaptiv o‘qitish tizimlarining qiyosiy tavsifi");
  assert.ok(captionP.includes('<w:jc w:val="center"/>'), "jadval nomi markazda emas");

  const sourceP = paraOf(xml, "Manba: muallif tomonidan tuzilgan");
  assert.ok(sourceP.includes("<w:i/>"), "«Manba:» kursiv emas");
  assert.ok(sourceP.includes('<w:sz w:val="20"/>'), "«Manba:» 10 pt emas");
});

test("jadval kataklari 12 pt (`workProfile.tableSize`), `tblGrid` bor", async () => {
  const xml = bodyOf((await xmlOf(sampleWorkDoc(META))).xml);
  assert.equal(workProfile("technical").tableSize, 24);
  assert.ok(xml.includes("<w:tblGrid>"), "`tblGrid` yo'q — LibreOffice ustunlarni teng chizadi");
  const cell = xml.slice(posOf(xml, "Moslashuv turi") - 400, posOf(xml, "Moslashuv turi"));
  assert.ok(cell.includes('<w:sz w:val="24"/>'), "jadval katagi 12 pt emas");
});

/* ══════════════════════════════ rasm ══════════════════════════════ */

test("rasm sarlavhasi rasmdan KEYIN, markazda; PNG bo'lsa `<w:drawing>`, bo'lmasa o'rinbosar ramka", async () => {
  const withPng = bodyOf((await xmlOf(sampleWorkDoc(META, { png: PNG_URL }))).xml);
  assert.ok(withPng.includes("<w:drawing>"), "PNG berilgan, lekin `<w:drawing>` yo'q");
  const img = withPng.indexOf("<w:drawing>");
  const cap = posOf(withPng, "2.1-rasm. Adaptiv o‘qitish tizimining umumiy tuzilmasi");
  assert.ok(img < cap, "rasm sarlavhasi rasmdan OLDIN chizilgan");
  assert.ok(paraOf(withPng, "2.1-rasm. Adaptiv o‘qitish tizimining umumiy tuzilmasi").includes('<w:jc w:val="center"/>'));

  const noPng = await xmlOf(sampleWorkDoc(META));
  assert.ok(!noPng.xml.includes("<w:drawing>"), "PNG yo'q, lekin `<w:drawing>` chiqdi");
  assert.ok(textNodes(noPng.xml).includes("[2.1-rasm]"), "o'rinbosar ramka matni yo'q");
});

test("formula OMML va raqami «(2.1)» o'ng tab to'xtashida", async () => {
  const xml = bodyOf((await xmlOf(sampleWorkDoc(META))).xml);
  assert.ok(xml.includes("<m:oMath>"), "formula OMML emas");
  const p = paraOf(xml, "(2.1)");
  assert.ok(p.includes('w:val="right"'), "formula raqami o'ng tab to'xtashisiz");
});

/* ══════════════════════════════ sahifa va tipografiya ══════════════════════════════ */

test("chegara fan profilidan: texnik o'ng 1,5 sm, gumanitar 1,0 sm; chap 3, yuqori/past 2", async () => {
  const tech = await xmlOf(sampleWorkDoc(META, { subject: "technical" }));
  const hum = await xmlOf(sampleWorkDoc(META, { subject: "humanities" }));
  const margin = (xml: string) => /<w:pgMar([^/]*)\/>/.exec(xml)?.[1] ?? "";
  assert.ok(margin(tech.xml).includes(`w:right="${Math.round(1.5 * CM)}"`), `texnik o'ng chegara: ${margin(tech.xml)}`);
  assert.ok(margin(hum.xml).includes(`w:right="${Math.round(1.0 * CM)}"`), `gumanitar o'ng chegara: ${margin(hum.xml)}`);
  for (const m of [margin(tech.xml), margin(hum.xml)]) {
    assert.ok(m.includes(`w:left="${3 * CM}"`), `chap chegara 3 sm emas: ${m}`);
    assert.ok(m.includes(`w:top="${2 * CM}"`), `yuqori chegara 2 sm emas: ${m}`);
    assert.ok(m.includes(`w:bottom="${2 * CM}"`), `past chegara 2 sm emas: ${m}`);
  }
});

test("`lineRule=\"auto\"` HAR BIR `w:line` bilan birga (LibreOffice 1,5 intervalni qat'iy balandlik deb o'qimasin)", async () => {
  const { xml } = await xmlOf(sampleWorkDoc(META, { png: PNG_URL }));
  const spacings = [...xml.matchAll(/<w:spacing[^>]*\/>/g)].map((m) => m[0]).filter((s) => s.includes("w:line="));
  assert.ok(spacings.length > 20, `sinov ma'noli bo'lishi uchun ko'p paragraf kerak (${spacings.length})`);
  const bad = spacings.filter((s) => !s.includes('w:lineRule="auto"'));
  assert.deepEqual(bad, [], "`lineRule=\"auto\"` siz `w:line` topildi");
  // Tana matni 1,5 interval (360) va TNR 14 (28 yarim-punkt).
  assert.ok(xml.includes('w:line="360"'), "1,5 interval yo'q");
  assert.ok(xml.includes('<w:sz w:val="28"/>'), "14 pt yo'q");
  assert.ok(xml.includes('w:ascii="Times New Roman"'), "Times New Roman yo'q");
});

test("titulda sahifa raqami YO'Q, qolgan varaqlarda pastda markazda", async () => {
  const bytes = await renderDocx(sampleWorkDoc(META));
  const zip = await JSZip.loadAsync(Buffer.from(bytes));
  const doc = await zip.file("word/document.xml")!.async("string");
  assert.ok(/<w:titlePg\s*\/>/.test(doc), "`titlePg` yo'q — titul birinchi kolontitulni olmaydi");
  const footers = Object.keys(zip.files).filter((n) => /^word\/footer\d+\.xml$/.test(n));
  assert.ok(footers.length >= 2, `ikkita kolontitul kutilgan (birinchi bo'sh + raqamli), topildi ${footers.length}`);
  const bodies = await Promise.all(footers.map((f) => zip.file(f)!.async("string")));
  const numbered = bodies.filter((b) => b.includes("PAGE"));
  assert.equal(numbered.length, 1, "faqat BITTA kolontitulda sahifa raqami bo'lishi kerak");
  assert.ok(numbered[0].includes('<w:jc w:val="center"/>'), "sahifa raqami markazda emas");
});

test("mundarija Word MAYDONI ichida va tarkibi bilan (LibreOffice maydonni to'ldirmaydi)", async () => {
  const { xml } = await xmlOf(sampleWorkDoc(META));
  assert.ok(/<w:instrText[^>]*>TOC /.test(xml), "`TableOfContents` maydoni yo'q");
  const t = textNodes(xml);
  assert.ok(t.includes("MUNDARIJA"), "mundarija sarlavhasi yo'q");
  // Maydon ICHIDA tayyor qatorlar bo'lishi shart.
  const tocAt = posOf(xml, "MUNDARIJA");
  const introAt = posOf(xml, "KIRISH");
  assert.ok(tocAt < introAt, "mundarija kirishdan keyin chizilgan");
  assert.ok(t.filter((x) => x === "1.1. Adaptiv o‘qitish tushunchasi va tasnifi").length >= 2, "mundarija qatori maydon ichida yozilmagan");
});

test("adabiyotlar GOST shaklida, raqamlangan; xom manba id lari matnda YO'Q", async () => {
  const { xml } = await xmlOf(sampleWorkDoc(META));
  const t = textNodes(xml);
  assert.ok(t.some((x) => /^\d+\. Karimov A\.N\. Ta’limda raqamli texnologiyalar\. – Toshkent: Fan, 2022\. – 240 b\.$/.test(x)), `GOST kitob satri topilmadi:\n${t.filter((x) => x.includes("Karimov")).join("\n")}`);
  assert.ok(t.some((x) => x.includes("O‘RQ-637")), "qonun manbasi yo'q");
  const all = t.join("\n");
  assert.ok(!/\[(?:W\d+|u\d|lex:)/.test(all), "xom manba id si DOCX matnida qoldi");
  assert.ok(/\[\d+, 45-b\.\]/.test(all), "lokatorli iqtibos raqamga o'girilmadi");
});

test("eski talaba ishi (`doc.work` yo'q) — UMUMIY yo'l, jadval sarlavhasi markazda kursiv", async () => {
  const doc = sampleWorkDoc(META);
  delete doc.work;
  doc.sections = doc.sections.filter((s) => s.blocks.length);
  const { xml } = await xmlOf(doc);
  assert.equal(profileFor(META).id, "gost");
  const t = textNodes(xml);
  // Bob raqami QO'YILMAYDI — eski hujjat qanday saqlangan bo'lsa shunday.
  assert.ok(!t.some((x) => x.startsWith("1-BOB.")), "eski hujjatga bob raqami qo'shildi");
  assert.ok(!t.includes("1.1-jadval"), "eski hujjatga jadval raqami qo'shildi");
  assert.ok(t.includes("KIRISH"), "eski hujjatda kirish sarlavhasi yo'qoldi");
});

/* ══════════════════════════════ LibreOffice (ixtiyoriy) ══════════════════════════════ */

function sofficeReady(): boolean {
  try {
    execFileSync("soffice", ["--version"], { stdio: "ignore", timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

test("LibreOffice: namunaviy kurs ishi 7–13 varaq va hech narsa yiqilmaydi", { skip: sofficeReady() ? false : "LibreOffice yo'q" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "work-docx-"));
  const src = join(dir, "work.docx");
  writeFileSync(src, Buffer.from(await renderDocx(sampleWorkDoc(META, { png: PNG_URL }))));
  execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", dir, src], { stdio: "ignore", timeout: 180_000 });
  const pdf = readdirSync(dir).find((f) => f.endsWith(".pdf"));
  assert.ok(pdf, "PDF yaratilmadi");
  const info = execFileSync("pdfinfo", [join(dir, pdf!)], { encoding: "utf8", timeout: 30_000 });
  const pages = Number(/Pages:\s*(\d+)/.exec(info)?.[1] ?? 0);
  /*
   * Namuna: titul + mundarija + kirish + 2 bob + xulosa + adabiyotlar
   * (2 varaq) + ilova ≈ 10 varaq. Chegara KENG — bu sinov maketning
   * YIQILGANINI ushlaydi (`lineRule` yo'qolsa hammasi 6 varaqqa siqiladi;
   * har banddan keyin uzilish qo'yilsa 20 varaqqa chiqadi), aniq raqamni
   * emas.
   */
  assert.ok(pages >= 7 && pages <= 13, `namuna 7–13 varaq bo'lishi kerak, chiqdi: ${pages}`);
});
