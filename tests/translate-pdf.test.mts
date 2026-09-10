import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { extractSegments, pdfBlocksToDoc, pdfBlocksToSegments, pdfToBlocks, type PdfBlock } from "../lib/generation/translate/index.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { renderDocx } from "../lib/generation/render-docx.ts";
import { profileById } from "../lib/generation/docx-profile.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import { makeBlankPdf, makeLongDocx } from "./helpers/office-fixtures.ts";

/**
 * PDF — yagona format, u QAYTA YOZILMAYDI: tuzilma koordinatalardan
 * tiklanadi va neytral DOCX bo'lib chiqadi.
 *
 * Fikstura ataylab HAQIQIY PDF: `docx` bilan yozilgan uch sahifali
 * hujjat LibreOffice orqali PDF ga o'giriladi. Qo'lda yozilgan «soxta»
 * matn parchalari bilan bu qism umuman sinalmagan bo'lardi — sahifa
 * koordinatalari, defis bilan bo'lingan so'zlar va takroriy kolontitul
 * faqat haqiqiy render natijasida paydo bo'ladi.
 */
const run = promisify(execFile);
const SOFFICE = "/usr/bin/soffice";
const canRender = existsSync(SOFFICE);

let cachedPdf: Uint8Array | null = null;
async function samplePdf(): Promise<Uint8Array> {
  if (cachedPdf) return cachedPdf;
  const dir = await mkdtemp(join(tmpdir(), "slaydx-tr-pdf-"));
  const src = join(dir, "manba.docx");
  await writeFile(src, await makeLongDocx());
  await run(
    SOFFICE,
    ["--headless", "--norestore", `-env:UserInstallation=file://${join(dir, "profile")}`, "--convert-to", "pdf", "--outdir", dir, src],
    { timeout: 180_000 },
  );
  cachedPdf = new Uint8Array(await readFile(join(dir, "manba.pdf")));
  return cachedPdf;
}

test("PDF: koordinatalardan tuzilma tiklanadi", { skip: !canRender }, async () => {
  const { blocks, pages } = await pdfToBlocks(await samplePdf());
  assert.equal(pages, 3);

  const kinds = blocks.map((b) => b.kind);
  assert.equal(kinds.filter((k) => k === "h").length, 1, `sarlavhalar: ${kinds}`);
  assert.ok(kinds.filter((k) => k === "p").length >= 2, `paragraflar: ${kinds}`);
  assert.equal(kinds.filter((k) => k === "li").length, 3, `ro'yxat bandlari: ${kinds}`);

  assert.equal(blocks[0].kind, "h");
  assert.match(blocks[0].text!, /Yagona bo'lim sarlavhasi/);

  const table = blocks.find((b) => b.kind === "table")!;
  assert.ok(table, "jadval topilishi kerak");
  assert.equal(table.rows!.length, 3, "uch qator");
  assert.deepEqual(table.rows![0], ["Ustun bir", "Ustun ikki", "Ustun uch"]);
  assert.deepEqual(table.rows![2], ["Qator B bir", "Qator B ikki", "Qator B uch"]);

  // Har sahifada takrorlanadigan kolontitul TASHLANADI.
  assert.ok(!blocks.some((b) => (b.text ?? "").includes("Yillik hisobot")), "takroriy kolontitul olib tashlanadi");

  // Ko'p qatorli paragraf BITTA blokka birlashadi (qatorlarga bo'linmaydi).
  const para = blocks.find((b) => b.kind === "p" && b.text!.startsWith("Bu 1-paragraf"))!;
  assert.ok(para.text!.length > 200, `paragraf birlashmadi: ${para.text}`);
  assert.ok(para.text!.endsWith("kerak."), "paragraf oxirigacha yig'ilgan");

  // Sahifa raqami har blokda bor.
  assert.ok(blocks.every((b) => b.page >= 1 && b.page <= 3));
});

test("PDF: segmentlar va id lar", { skip: !canRender }, async () => {
  const ex = await extractSegments("pdf", await samplePdf());
  assert.equal(ex.pdf?.pages, 3);
  assert.ok(ex.pdf!.blocks.length > 5);
  assert.ok(ex.chars > 500, `chars: ${ex.chars}`);

  const cell = ex.segments.find((s) => s.text === "Ustun ikki")!;
  assert.match(cell.id, /^f:\d+:0:1$/, `jadval katagi id: ${cell.id}`);
  assert.equal(cell.kind, "cell");
  assert.equal(cell.ctx, "page 1");

  const head = ex.segments.find((s) => s.kind === "h")!;
  assert.match(head.id, /^f:\d+$/);
  assert.equal(head.part, "pdf");
});

test("PDF: matnsiz (skanlangan) PDF — chars 0", async () => {
  const ex = await extractSegments("pdf", makeBlankPdf());
  assert.equal(ex.chars, 0);
  assert.equal(ex.segments.length, 0);
  assert.equal(ex.pdf?.pages, 1);
});

test("PDF: bloklardan segment va tarjima qilingan AcademicDoc", async () => {
  const blocks: PdfBlock[] = [
    { kind: "h", text: "Kirish qismi", page: 1 },
    { kind: "p", text: "Birinchi paragraf matni.", page: 1 },
    { kind: "table", rows: [["Ustun", "Qiymat"], ["Bir", "12"]], page: 1 },
    { kind: "li", text: "Ro'yxat bandi", page: 2 },
    { kind: "p", text: "12 345", page: 2 },
  ];

  const segs = pdfBlocksToSegments(blocks);
  assert.deepEqual(
    segs.map((s) => [s.id, s.kind, s.ctx]),
    [
      ["f:0", "h", "page 1"],
      ["f:1", "p", "page 1"],
      ["f:2:0:0", "cell", "page 1"],
      ["f:2:0:1", "cell", "page 1"],
      ["f:2:1:0", "cell", "page 1"],
      ["f:3", "li", "page 2"],
    ],
  );
  assert.ok(!segs.some((s) => s.text === "12"), "raqamli katak segment emas");
  assert.ok(!segs.some((s) => s.text === "12 345"), "raqamli paragraf segment emas");

  const map = new Map(segs.map((s) => [s.id, `[T]${s.text}`]));
  const meta = { ...extractMeta(TOOL_BY_ID.essay, { topic: "Tarjima" } as never), toolId: "translation" as const };
  const doc = pdfBlocksToDoc(blocks, map, meta);

  assert.equal(doc.titlePage, false);
  assert.equal(doc.toc, false);
  assert.equal(doc.sections[0].id, "body");
  assert.equal(doc.sections[0].title, "", "bo'lim sarlavhasi yo'q — manbada u yo'q edi");
  assert.deepEqual(doc.sections[0].blocks, [
    { kind: "h1", text: "[T]Kirish qismi" },
    { kind: "p", text: "[T]Birinchi paragraf matni." },
  ]);
  // Jadval o'z JOYIDA qoladi: undan keyingi matn yangi bo'limga tushadi.
  assert.equal(doc.tables![0].anchor, "body");
  assert.deepEqual(doc.tables![0].headers, ["[T]Ustun", "[T]Qiymat"]);
  assert.deepEqual(doc.tables![0].rows, [["[T]Bir", "12"]]);
  assert.deepEqual(doc.sections[1].blocks, [
    { kind: "li", text: "[T]Ro'yxat bandi" },
    { kind: "p", text: "12 345" },
  ]);
});

test("translation profili: neytral, titulsiz, langarlangan jadval", async () => {
  const p = profileById("translation");
  assert.equal(p.titlePage, "none");
  assert.equal(p.tablePlacement, "anchored");
  assert.equal(p.type.font, "Times New Roman");
  assert.equal(p.type.size, 24, "12 pt");
  assert.equal(p.type.justify, false);
  assert.equal(p.type.firstLine, 0);
  assert.equal(p.heading.align, "left");
  assert.equal(p.heading.upper, false);

  // `renderDocx` sarlavhasiz bo'limni BO'SH sarlavha paragrafisiz chizadi.
  const meta = { ...extractMeta(TOOL_BY_ID.essay, { topic: "Tarjima" } as never), toolId: "translation" as const };
  const doc = pdfBlocksToDoc(
    [
      { kind: "h", text: "Sarlavha", page: 1 },
      { kind: "p", text: "Matn.", page: 1 },
    ],
    new Map(),
    meta,
  );
  const bytes = await renderDocx(doc);
  assert.ok(bytes.byteLength > 3000, `DOCX bayti: ${bytes.byteLength}`);
});
