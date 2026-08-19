import test from "node:test";
import assert from "node:assert/strict";
import { pdfAvailable, pdfBinary, pdfFileName, toPdf } from "../lib/server/pdf.ts";

/**
 * PDF o'girish.
 *
 * Bu yerda LibreOffice ning o'zi sinalmaydi — u har muhitda bo'lmasligi
 * mumkin. Sinaladigan narsa: aniqlash mantig'i to'g'ri ishlashi va
 * LibreOffice yo'q bo'lganda tizim jim yiqilmasdan `null` qaytarishi.
 */

test("fayl nomi pdf ga aylanadi", () => {
  assert.equal(pdfFileName("Referat.docx"), "Referat.pdf");
  assert.equal(pdfFileName("Taqdimot.pptx"), "Taqdimot.pdf");
  assert.equal(pdfFileName("Ichki yonuv dvigatellari.docx"), "Ichki yonuv dvigatellari.pdf");
  // Kengaytmasiz nom ham buzilmasin.
  assert.equal(pdfFileName("hujjat"), "hujjat.pdf");
});

test("SOFFICE_BIN noto'g'ri bo'lsa imkoniyat o'chadi", async (t) => {
  const prev = process.env.SOFFICE_BIN;
  t.after(() => {
    if (prev === undefined) delete process.env.SOFFICE_BIN;
    else process.env.SOFFICE_BIN = prev;
  });

  process.env.SOFFICE_BIN = "/mavjud/bo'lmagan/yo'l/soffice";
  assert.equal(pdfBinary(), null);
  assert.equal(pdfAvailable(), false);
  // O'girish jim yiqilmaydi — `null` qaytaradi, chaqiruvchi 503 beradi.
  assert.equal(await toPdf(new Uint8Array([1, 2, 3]), "a.docx"), null);
});

test("bo'sh va haddan katta kirish rad etiladi", async (t) => {
  const prev = process.env.SOFFICE_BIN;
  t.after(() => {
    if (prev === undefined) delete process.env.SOFFICE_BIN;
    else process.env.SOFFICE_BIN = prev;
  });
  // Aniqlash bosqichidan o'tmasligi uchun mavjud bo'lgan har qanday fayl.
  process.env.SOFFICE_BIN = "/bin/sh";

  assert.equal(await toPdf(new Uint8Array(0), "a.docx"), null);
  assert.equal(await toPdf(new Uint8Array(31 * 1024 * 1024), "a.docx"), null);
});
