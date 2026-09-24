import test from "node:test";
import assert from "node:assert/strict";
import { extractFromBuffer } from "../lib/extract-text.ts";
import { extractSegments, pdfToBlocks } from "../lib/generation/translate/index.ts";
import * as pdfMod from "../lib/generation/translate/pdf.ts";
import { makeBlankPagesPdf, makePdf, makeTextbookPdf } from "./helpers/parse-fixtures.ts";

/**
 * CONC-09 / SECB-04 / FILE-04 (C06): PDF tahlili chegaralangan bo'lishi shart.
 *
 * AUDIT R2 probasi: 841 KB, 600 sahifali oddiy «darslik» PDF web jarayonini
 * 28,2 s muzlatdi — `toBlocks` o'sib borayotgan paragraf satrini har qatorda
 * `/[-­]$/` bilan qayta skanerlardi (O(belgi²)), sahifa soniga esa hech
 * qanday chek yo'q edi.
 */

const MAX_PAGES = (pdfMod as { MAX_PDF_PAGES?: number }).MAX_PDF_PAGES ?? 300;

function ab(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

async function timeBlocks(pages: number): Promise<number> {
  const bytes = makeTextbookPdf(pages);
  let best = Infinity;
  for (let i = 0; i < 2; i++) {
    const t = performance.now();
    const { blocks } = await pdfToBlocks(bytes);
    best = Math.min(best, performance.now() - t);
    assert.ok(blocks.length >= 1);
  }
  return best;
}

test("pdfToBlocks: tinish belgisiz uzun paragraf — vaqt sahifa soniga CHIZIQLI", async () => {
  await timeBlocks(10); // isitish (pdf.js yuklanishi)
  const t100 = await timeBlocks(100);
  const t200 = await timeBlocks(200);
  const ratio = t200 / t100;
  // Chiziqli ≈ 2; ilgari ≈ 3,5–4 (kvadratik).
  assert.ok(ratio < 2.8, `100 sahifa ${t100.toFixed(0)} ms, 200 sahifa ${t200.toFixed(0)} ms, nisbat ${ratio.toFixed(2)}`);
});

test("pdfToBlocks: paragraf birlashtirish va defis qoidasi avvalgidek", async () => {
  const bytes = makePdf([["Birinchi qator bo-", "lingan so'z va davomi", "oxirgi qator"], ["keyingi sahifa davomi"]]);
  const { blocks } = await pdfToBlocks(bytes);
  assert.deepEqual(
    blocks.map((b) => [b.kind, b.text]),
    [["p", "Birinchi qator bolingan so’z va davomi oxirgi qator keyingi sahifa davomi"]],
  );
});

test(`pdfToBlocks: ${MAX_PAGES} + 1 sahifa — sahifalar o'qilmasdan rad etiladi`, async () => {
  const bytes = makeBlankPagesPdf(MAX_PAGES + 1);
  await assert.rejects(pdfToBlocks(bytes), (e: unknown) => {
    assert.equal((e as Error).name, "PdfPageLimitError");
    assert.match((e as Error).message, new RegExp(`${MAX_PAGES + 1}`));
    return true;
  });
  await assert.rejects(extractSegments("pdf", bytes), { name: "PdfPageLimitError" });
});

test(`pdfToBlocks: aynan ${MAX_PAGES} sahifa — o'qiladi`, async () => {
  const { pages } = await pdfToBlocks(makeBlankPagesPdf(MAX_PAGES));
  assert.equal(pages, MAX_PAGES);
});

test(`extractFromBuffer(pdf): ${MAX_PAGES} dan ko'p sahifa — faqat birinchi ${MAX_PAGES} tasi o'qiladi, «truncated»`, async () => {
  const pages = Array.from({ length: MAX_PAGES + 2 }, (_, i) => [`Sahifa raqami ${i + 1} tugadi`]);
  const out = await extractFromBuffer("x.pdf", ab(makePdf(pages)));
  assert.equal(out.error, undefined);
  assert.match(out.text, new RegExp(`Sahifa raqami ${MAX_PAGES} tugadi`));
  assert.doesNotMatch(out.text, new RegExp(`Sahifa raqami ${MAX_PAGES + 1} tugadi`));
  assert.equal((out as { truncated?: boolean }).truncated, true);
});

test("extractFromBuffer(pdf): oddiy PDF matni avvalgidek (unpdf mergePages bilan bir xil)", async () => {
  const bytes = makePdf([["Birinchi   sahifa", "ikkinchi qator"], [], ["Uchinchi sahifa"]]);
  const out = await extractFromBuffer("x.pdf", ab(bytes));
  const { extractText } = await import("unpdf");
  const ref = await extractText(new Uint8Array(bytes), { mergePages: true });
  assert.equal(out.text, String(ref.text).trim().replace(/\n{3,}/g, "\n\n"));
  assert.equal((out as { truncated?: boolean }).truncated, undefined);
});
