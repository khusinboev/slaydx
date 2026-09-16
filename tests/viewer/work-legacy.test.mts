import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import JSZip from "jszip";
import { WordViewer } from "../../components/viewers/WordViewer.tsx";
import { renderDocx } from "../../lib/generation/render-docx.ts";
import { docToFlow } from "../../lib/viewers/flow.ts";
import { tocRows } from "../../lib/generation/toc-model.ts";
import { sampleWorkDoc } from "../../lib/generation/work/samples.ts";
import { applyWorkOps } from "../../lib/generation/work/edit.ts";
import type { AcademicDoc, DocMeta } from "../../lib/generation/types.ts";

/*
 * `lib/server/**` bu yerga IMPORT QILINMAYDI: u `server-only` ni tortadi
 * va ko'ruvchi testi klient moduli sifatida yuklanadi («This module
 * cannot be imported from a Client Component module»). Adapter tanlovi
 * `tests/work-commit.test.mts` da sinaladi.
 */

/**
 * ESKI TALABA ISHI (`doc.work` yo'q) — AVVALGIDEK (AUDIT-19 WP-C, X-6).
 *
 * Bazadagi minglab kurs ishi/referat `doc_json` ida model yo'q. Ular
 * uchun HECH NARSA o'zgarmasligi kerak: umumiy yo'l (`docToFlow`,
 * `renderDocx` ning `else` shoxi, `tocRows` bo'limlar bo'yicha), bob
 * raqami QO'SHILMAYDI, jadval hujjat oxirida, tahrir esa YOQILMAYDI —
 * chunki op yo'llari (`sections.3.blocks.1`) uchun bob/paragraf
 * kafolati yo'q.
 */

const META: DocMeta = {
  topic: "Oliy ta’limda adaptiv o‘qitish tizimlarini joriy etish",
  workLabel: "Kurs ishi",
  language: "uz",
  toolId: "coursework",
} as unknown as DocMeta;

/**
 * Namunadan MODELNI olib tashlaydi — bazadagi eski hujjat shakli:
 * `doc.work` yo'q, adabiyotlar esa oddiy SATRLAR ro'yxati (`references`),
 * reyestr emas.
 */
function legacyDoc(): AcademicDoc {
  const doc = sampleWorkDoc(META);
  delete doc.work;
  // Eski yo'lda matnsiz bo'lim (bob sarlavhasi) umuman chizilmaydi.
  doc.sections = doc.sections.filter((s) => s.blocks.length);
  doc.references = [
    "Karimov A.N. Ta’limda raqamli texnologiyalar. – Toshkent: Fan, 2022. – 240 b.",
    "Aliyev B.T. Pedagogik tadqiqot metodologiyasi. – Toshkent: O‘qituvchi, 2021. – 180 b.",
  ];
  return doc;
}

function docxTexts(xml: string): string[] {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1].trim()).filter(Boolean);
}

test("oqim UMUMIY yo'ldan: bob raqami, `1.1-jadval` va «Manba:» bandlari QO'SHILMAYDI", () => {
  const items = docToFlow(legacyDoc());
  const types = new Set(items.map((i) => i.type));
  assert.ok(!types.has("table-number"), "eski hujjatga jadval raqami bandi qo'shildi");
  assert.ok(!types.has("table-source"), "eski hujjatga «Manba:» bandi qo'shildi");
  const heads = items.filter((i) => i.type === "h1").map((i) => (i.type === "h1" ? i.text : ""));
  assert.ok(!heads.some((t) => t.startsWith("1-BOB.")), `bob raqami qo'shildi: ${heads.join(" | ")}`);
  // Sarlavha modeldagi shaklida qoladi (BOSH HARFNI ekranda CSS beradi).
  assert.ok(heads.includes("Kirish"), `«Kirish» yo'qoldi: ${heads.join(" | ")}`);
  // Iqtiboslar XOM qoladi — eski hujjatda reyestr yo'q, raqam berib bo'lmaydi.
  const all = items.flatMap((i) => ("text" in i ? [i.text] : [])).join("\n");
  assert.ok(all.includes("[lex:2]"), "eski hujjatning xom iqtibosi o'zgartirildi");
});

test("mundarija eski qoida bo'yicha — bo'limlar + «FOYDALANILGAN ADABIYOTLAR»", () => {
  const doc = legacyDoc();
  const rows = tocRows(doc);
  assert.deepEqual(
    rows.map((r) => r.text),
    [...doc.sections.map((s) => s.title), "FOYDALANILGAN ADABIYOTLAR"],
  );
  assert.ok(rows.every((r) => r.level === 1), "eski mundarijada 2-daraja paydo bo'ldi");
});

test("DOCX umumiy yo'ldan: `gost` profili, jadval OXIRIDA, bob raqamsiz", async () => {
  const doc = legacyDoc();
  const zip = await JSZip.loadAsync(Buffer.from(await renderDocx(doc)));
  const xml = await zip.file("word/document.xml")!.async("string");
  const t = docxTexts(xml);
  assert.ok(!t.some((x) => x.startsWith("1-BOB.")), "bob raqami qo'shildi");
  assert.ok(!t.includes("1.1-jadval"), "jadval raqami qo'shildi");
  assert.ok(t.includes("KIRISH"), "kirish sarlavhasi yo'qoldi");
  // Jadval — hujjat OXIRIDA (eski `tablePlacement: "end"`), adabiyotlardan oldin.
  const table = xml.indexOf("Moslashuv turi");
  // `lastIndexOf` — sarlavha MUNDARIJADA ham uchraydi, bizga TANADAGISI kerak.
  const refs = xml.lastIndexOf("FOYDALANILGAN ADABIYOTLAR");
  const lastText = xml.indexOf("Ilovada tajriba");
  assert.ok(table > lastText, "jadval matn ichida chizildi — eski hujjatda u oxirda turardi");
  assert.ok(table < refs, "jadval adabiyotlardan keyin tushib qoldi");
  // Chegara — umumiy GOST (o'ng 1,5 sm), fan profili EMAS.
  assert.ok(/<w:pgMar[^/]*w:right="851"/.test(xml), "eski hujjatga fan profilining chegarasi qo'llandi");
});

test("tahrir RAD etiladi: modelsiz hujjatda op yo'llari kafolatlanmaydi", () => {
  const r = applyWorkOps(legacyDoc(), [{ op: "heading", sectionId: "intro", title: "Kirish qismi" }], { genId: "g1" });
  assert.ok(!r.ok, "eski hujjat tahrirlandi");
  assert.ok(r.ok || r.error.includes("eski formatda"));
  // Modelli hujjatda AYNI op o'tadi — farq faqat `doc.work` da.
  const okRes = applyWorkOps(sampleWorkDoc(META), [{ op: "heading", sectionId: "intro", title: "Kirish qismi" }], { genId: "g1" });
  assert.ok(okRes.ok, okRes.ok ? "" : okRes.error);
});

test("ko'ruvchi eski hujjatni yiqilmasdan chizadi va `word-article` varag'ini QO'YMAYDI", () => {
  const html = renderToStaticMarkup(h(WordViewer, { doc: legacyDoc() }));
  assert.ok(html.includes("Mavzuning dolzarbligi"), "matn chizilmadi");
  assert.ok(!html.includes("--doc-table-size"), "eski hujjatga profil o'zgaruvchilari qo'llandi");
  assert.ok(!html.includes("word-inner word-article"), "eski hujjat profilli varaqqa tushdi");
});
