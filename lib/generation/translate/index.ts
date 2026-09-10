/**
 * Tarjima adapterlarining OMMAVIY yuzasi.
 *
 * Dvigatel (WP3) faqat shu fayl bilan gaplashadi va formatlar haqida
 * hech narsa bilmaydi: u `extractSegments` dan segment oladi, tarjima
 * qiladi va `applySegments` ga xarita beradi. Yangi format qo'shish =
 * yangi adapter + shu yerdagi ikki tarmoq; dvigatel tegilmaydi.
 *
 * Butun modul IZOMORF (`server-only` yo'q): forma ham, worker ham bir
 * xil kodni yuklaydi. Yagona istisno — `pdf.ts` ichidagi `unpdf` kech
 * importi.
 */

import { applyDocx, extractDocx } from "./docx";
import { applyPptx, extractPptx } from "./pptx";
import { applyXlsx, extractXlsx } from "./xlsx";
import { applyCsv, applyMd, applyText, csvToSegments, mdToSegments, textToSegments as txtSegments } from "./plain";
import { extractPdf, pdfBlocksToDoc, pdfBlocksToSegments, pdfToBlocks } from "./pdf";
import { isTranslatable, markDuplicates, type Extracted, type SegmentMap } from "./segments";
import type { SourceKind } from "../source-types";

export {
  isTranslatable,
  joinSubsegments,
  markDuplicates,
  normKey,
  splitOversize,
  stripTokens,
  tokenMultiset,
  tokensBalanced,
  MAX_RUN_MARKERS,
  MAX_SEGMENT_CHARS,
} from "./segments";
export type { Extracted, PdfBlock, Segment, SegmentKind, SegmentMap } from "./segments";
/** Manba formatlari — WP1 shartnomasi (`source-types.ts`) bilan bitta ro'yxat. */
export type { SourceKind } from "../source-types";
export { pdfBlocksToDoc, pdfBlocksToSegments, pdfToBlocks };

/**
 * `ignoreBOM: true` — BOM MATNDA qoladi.
 *
 * Standart dekoder BOM ni jimgina yeb qo'yadi. Excel Windows da CSV ni
 * BOM bilan yozadi va usiz o'sha faylni kirill/o'zbek harflarini
 * buzib ochadi — ya'ni BOM ni yo'qotish tarjima qilingan CSV ni
 * foydalanuvchi uchun o'qib bo'lmaydigan qiladi. `plain.ts` uni
 * ajratib oladi va chiqishda joyiga qaytaradi.
 */
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
const encoder = new TextEncoder();

/** Matnli formatlar — baytlar UTF-8 satr sifatida o'qiladi. */
const TEXT_KINDS = new Set<SourceKind>(["txt", "md", "csv"]);

/**
 * Manbadan segmentlar.
 *
 * `chars` — TARJIMA QILINADIGAN matn hajmi: narx (`lib/tools.ts`) va
 * byudjet (`budget.ts`) aynan shundan hisoblanadi. Tokenlar ham
 * sanaladi, lekin ular matnning arzimas ulushi.
 */
export async function extractSegments(kind: SourceKind, bytes: Uint8Array): Promise<Extracted> {
  const raw = await extractRaw(kind, bytes);
  // Tarjima qilinmaydigan segment (raqam, URL, kod) MODELGA umuman
  // yuborilmaydi va faylda tegilmagan holida qoladi.
  const segments = raw.segments.filter((s) => isTranslatable(s.text));
  markDuplicates(segments);
  const chars = segments.reduce((sum, s) => sum + s.text.length, 0);
  return { ...raw, segments, chars };
}

async function extractRaw(kind: SourceKind, bytes: Uint8Array): Promise<Extracted> {
  switch (kind) {
    case "docx":
      return extractDocx(bytes);
    case "pptx":
      return extractPptx(bytes);
    case "xlsx":
      return extractXlsx(bytes);
    case "pdf":
      return extractPdf(bytes);
    case "md":
      return mdToSegments(decoder.decode(bytes));
    case "csv":
      return csvToSegments(decoder.decode(bytes));
    default:
      return txtSegments(decoder.decode(bytes));
  }
}

/**
 * Tarjimani manba faylga qaytaradi — chiqish formati kirish bilan bir xil.
 *
 * PDF bu yerda YO'Q: uni qayta yozib bo'lmaydi, u `pdfBlocksToDoc` +
 * `renderDocx` orqali DOCX bo'lib chiqadi.
 */
export async function applySegments(
  kind: Exclude<SourceKind, "pdf">,
  bytes: Uint8Array,
  map: SegmentMap,
): Promise<Uint8Array> {
  if (TEXT_KINDS.has(kind)) {
    const text = decoder.decode(bytes);
    const out = kind === "md" ? applyMd(text, map) : kind === "csv" ? applyCsv(text, map) : applyText(text, map);
    return encoder.encode(out);
  }
  if (kind === "docx") return applyDocx(bytes, map);
  if (kind === "pptx") return applyPptx(bytes, map);
  return applyXlsx(bytes, map);
}

/** Matn rejimi — fayl yo'q, foydalanuvchi matni. TXT yo'li bilan bir xil. */
export function textToSegments(text: string): Extracted {
  const raw = txtSegments(text);
  const segments = raw.segments.filter((s) => isTranslatable(s.text));
  markDuplicates(segments);
  return { ...raw, segments, chars: segments.reduce((sum, s) => sum + s.text.length, 0) };
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Chiqish MIME turi. PDF DOCX bo'lib chiqadi — shuning uchun DOCX mime. */
export const OUTPUT_MIME: Record<SourceKind, string> = {
  docx: DOCX_MIME,
  pdf: DOCX_MIME,
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
};

const OUTPUT_EXT: Record<SourceKind, string> = {
  docx: "docx",
  pdf: "docx",
  pptx: "pptx",
  xlsx: "xlsx",
  txt: "txt",
  md: "md",
  csv: "csv",
};

/**
 * `hisobot.docx` + `uz` → `hisobot-uz.docx`.
 *
 * Til qo'shimchasi SHART: foydalanuvchi asl faylni ham, tarjimasini ham
 * bitta papkaga yuklab oladi va bir xil nom asl faylni ustidan yozib
 * yuborardi.
 */
export function outputFileName(name: string, kind: SourceKind, target: string): string {
  const base = (name || "hujjat").replace(/\.[A-Za-z0-9]{1,5}$/, "").trim() || "hujjat";
  const lang = (target || "").toLowerCase().replace(/[^a-z-]/g, "") || "tarjima";
  return `${base}-${lang}.${OUTPUT_EXT[kind]}`;
}
