import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

/**
 * Fayl kartasi eskizi (AUDIT-14): DOCX → LibreOffice PDF → 1-sahifa JPEG,
 * kichik (karta uchun yetarli, sahifa uchun yengil). `pdftoppm` yo'q → null.
 */
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { buildThumb, pdfFirstPageJpeg, THUMB_ASSET_ID } = await import("../lib/server/thumb.ts");
const { makeDocx } = await import("./helpers/office-fixtures.ts");

test("THUMB_ASSET_ID aktiv marshruti regexiga mos (hex, 24)", () => {
  assert.match(THUMB_ASSET_ID, /^[0-9a-f]{8,64}$/);
});

test("pdftoppm yo'q → null (yuklanish yiqilmaydi)", async () => {
  assert.equal(await pdfFirstPageJpeg(Buffer.from("%PDF-1.4"), { pdftoppm: null }), null);
});

test("DOCX → 1-sahifa JPEG: hajm 40 KB dan kichik, JPEG imzosi, faqat bitta sahifa", { skip: !existsSync("/usr/bin/soffice") || !existsSync("/usr/bin/pdftoppm") }, async () => {
  const docx = await makeDocx();
  const jpeg = await buildThumb(docx, "sinov.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.ok(jpeg, "eskiz yasalishi kerak");
  assert.ok(jpeg!.byteLength > 1000 && jpeg!.byteLength < 40_000, `hajm: ${jpeg!.byteLength}`);
  assert.ok(jpeg![0] === 0xff && jpeg![1] === 0xd8, "JPEG");
  assert.equal(await buildThumb(docx, "x.zip", "application/zip"), null, "faqat DOCX/PPTX");
});
