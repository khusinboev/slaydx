/**
 * PDF adapteri — koordinatalardan TUZILMANI tiklaydi.
 *
 * PDF da paragraf, sarlavha, ro'yxat va jadval degan tushuncha YO'Q:
 * faylda faqat «shu matn parchasini shu nuqtaga, shu shrift bilan chiz»
 * buyruqlari bor. Shuning uchun boshqa formatlardan farqli o'laroq PDF
 * O'ZI QAYTA YOZILMAYDI — undan tuzilma tiklanadi, tarjima qilinadi va
 * NEYTRAL DOCX (`translation` profili) chizib beriladi.
 *
 * Tiklash bosqichlari:
 *   1. parchalar → QATORLAR (bir xil baseline, ±2 pt);
 *   2. har sahifada takrorlanadigan yuqori/quyi kolontitullarni olib
 *      tashlash (aks holda hujjatda 30 marta «Yillik hisobot 2025»
 *      paragrafi paydo bo'lardi va ularning har biri PUL turardi);
 *   3. qatorlar → bloklar: sarlavha, ro'yxat bandi, jadval, paragraf;
 *   4. paragraf ichidagi qatorlarni birlashtirish (defis bo'yicha
 *      bo'lingan so'zlarni qayta yopishtirish bilan).
 *
 * `unpdf` ATAYIN funksiya ichida, kech (lazy) import qilinadi —
 * `lib/extract-text.ts` `extractPdfBuffer` dagi naqsh. Modul izomorf
 * bo'lib qoladi va PDF bo'lmagan yo'llar og'ir kutubxonani yuklamaydi.
 */

import type { AcademicDoc, Block, DocMeta, DocSection, DocTable } from "../types";
import { isTranslatable, type Extracted, type PdfBlock, type Segment, type SegmentMap } from "./segments";

export type { PdfBlock };

type Line = {
  text: string;
  /** Bo'laklarning chap chetlari — jadval ustunlarini topish uchun. */
  xs: number[];
  /**
   * Bo'laklarning O'ZI (x + matn).
   *
   * Jadval katagi AYNAN shu ro'yxatdan yig'iladi: birlashtirilgan qator
   * matnini keyin bo'shliq bo'yicha bo'lish ishonchsiz (LibreOffice
   * ustunlar orasiga bitta probel qo'yadi), koordinata esa aniq.
   */
  parts: Array<{ x: number; str: string }>;
  x: number;
  right: number;
  y: number;
  size: number;
  bold: boolean;
  page: number;
};

type RawItem = { str: string; transform: number[]; width: number; fontName?: string };

/** Bir qatorga tegishli deb hisoblanadigan baseline farqi (punkt). */
const LINE_TOL = 2;
/** Kolontitul zonasi — sahifa balandligining yuqori/quyi 8%. */
const EDGE = 0.08;
/** Necha foiz sahifada takrorlansa kolontitul deb hisoblanadi. */
const REPEAT = 0.6;

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Parchalarni baseline bo'yicha qatorlarga yig'adi. */
function toLines(items: RawItem[], page: number, bolds: Set<string>): Line[] {
  const out: Line[] = [];
  for (const it of items) {
    if (!it.str) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const size = Math.abs(it.transform[3]) || Math.hypot(it.transform[2], it.transform[3]) || 10;
    const bold = it.fontName ? bolds.has(it.fontName) : false;
    const line = out.find((l) => Math.abs(l.y - y) <= LINE_TOL);
    if (!line) {
      out.push({ text: it.str, xs: [x], parts: [{ x, str: it.str }], x, right: x + it.width, y, size, bold, page });
      continue;
    }
    // Bo'shliq PDF da ko'pincha alohida parcha emas — masofadan tiklanadi.
    const gap = x - line.right;
    line.text += (gap > size * 0.2 && !/\s$/.test(line.text) && !/^\s/.test(it.str) ? " " : "") + it.str;
    line.xs.push(x);
    line.parts.push({ x, str: it.str });
    line.right = Math.max(line.right, x + it.width);
    line.x = Math.min(line.x, x);
    line.size = Math.max(line.size, size);
    line.bold = line.bold || bold;
  }
  return out
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() }))
    .filter((l) => l.text.length)
    .sort((a, b) => b.y - a.y);
}

/**
 * Har sahifada takrorlanadigan kolontitullarni olib tashlaydi.
 *
 * Sahifa raqami har safar boshqa bo'lgani uchun raqamlar kalitdan
 * chiqariladi — aks holda «12», «13», «14» hech qachon «takror» bo'lib
 * ko'rinmasdi va har biri alohida paragraf bo'lib hujjatga tushardi.
 */
function dropRunningHeads(lines: Line[], heights: number[], pages: number): Line[] {
  if (pages < 3) return lines;
  const key = (l: Line) => l.text.replace(/\d+/g, "#").trim().toLowerCase();
  const seen = new Map<string, Set<number>>();
  for (const l of lines) {
    const h = heights[l.page - 1] || 792;
    if (l.y > h * (1 - EDGE) || l.y < h * EDGE) {
      const k = key(l);
      if (!seen.has(k)) seen.set(k, new Set());
      seen.get(k)!.add(l.page);
    }
  }
  const drop = new Set([...seen.entries()].filter(([, p]) => p.size >= pages * REPEAT).map(([k]) => k));
  if (!drop.size) return lines;
  return lines.filter((l) => {
    const h = heights[l.page - 1] || 792;
    const edge = l.y > h * (1 - EDGE) || l.y < h * EDGE;
    return !(edge && drop.has(key(l)));
  });
}

const LIST_RE = /^([-•‣▪◦*·—–]|\d{1,3}[.)]|[a-zA-Z][.)])\s+/;

/** Qatorlarni ustun klasterlariga soladi — jadval aniqlash uchun. */
function xClusters(lines: Line[]): number[] {
  const all = lines.flatMap((l) => l.xs).sort((a, b) => a - b);
  const out: number[] = [];
  for (const x of all) {
    if (!out.length || x - out[out.length - 1] > 6) out.push(x);
  }
  return out;
}

function sharedColumns(lines: Line[]): number[] {
  const cols = xClusters(lines);
  return cols.filter((c) => lines.filter((l) => l.xs.some((x) => Math.abs(x - c) <= 6)).length >= lines.length * 0.8);
}

/** Har parcha o'zining x koordinatasi bo'yicha eng yaqin CHAP ustunga tushadi. */
function rowOf(line: Line, cols: number[]): string[] {
  const cells: string[] = cols.map(() => "");
  for (const part of line.parts) {
    if (!part.str.trim()) continue;
    let col = 0;
    cols.forEach((c, ci) => {
      if (part.x >= c - 6) col = ci;
    });
    cells[col] += (cells[col] && !/\s$/.test(cells[col]) ? " " : "") + part.str;
  }
  return cells.map((c) => c.replace(/\s+/g, " ").trim());
}

/**
 * Qatorlarni bloklarga aylantiradi.
 *
 * Yangi paragraf boshlanadi, agar: (a) vertikal bo'shliq qator
 * balandligining 1.5 barobaridan katta; (b) qator ichkariga surilgan
 * (xat boshi); (c) oldingi qator jumla bilan TUGAGAN VA satr o'ng
 * chetigacha yetmagan (ya'ni ataylab tugatilgan) va yangisi bosh harf
 * bilan boshlangan. (c) da «o'ng chetgacha yetmagan» sharti ATAYIN
 * qo'shildi: usiz tekislangan matnda har JUMLA alohida paragraf bo'lib
 * ketardi.
 */
function toBlocks(lines: Line[], bodySize: number): PdfBlock[] {
  const blocks: PdfBlock[] = [];
  const maxRight = Math.max(...lines.map((l) => l.right), 1);
  let i = 0;

  while (i < lines.length) {
    // Jadval: ketma-ket ≥3 qator, ≥3 umumiy ustun.
    let j = i;
    while (j < lines.length && lines[j].page === lines[i].page && lines[j].xs.length >= 3) j++;
    if (j - i >= 3) {
      const group = lines.slice(i, j);
      const cols = sharedColumns(group);
      if (cols.length >= 3) {
        blocks.push({ kind: "table", rows: group.map((l) => rowOf(l, cols)), page: lines[i].page });
        i = j;
        continue;
      }
    }

    const line = lines[i];
    const heading = (line.size >= bodySize * 1.15 || line.bold) && line.text.length < 90;
    if (heading) {
      blocks.push({ kind: "h", text: line.text, page: line.page });
      i++;
      continue;
    }
    if (LIST_RE.test(line.text)) {
      blocks.push({ kind: "li", text: line.text, page: line.page });
      i++;
      continue;
    }

    let text = line.text;
    let prev = line;
    i++;
    while (i < lines.length) {
      const next = lines[i];
      if (next.page !== prev.page && next.y > prev.y) {
        // Yangi sahifa — qator bo'shlig'i o'lchanmaydi, davomi deb qaraymiz.
      } else {
        const gap = prev.y - next.y;
        if (gap > prev.size * 1.5) break;
      }
      if (next.size >= bodySize * 1.15 || next.bold) break;
      if (LIST_RE.test(next.text)) break;
      if (next.x > prev.x + prev.size * 0.8) break;
      if (/[.!?…»"']$/.test(prev.text) && prev.right < maxRight * 0.9 && /^\p{Lu}/u.test(next.text)) break;
      // Defis bilan bo'lingan so'z qayta yopishtiriladi.
      if (/[-­]$/.test(text)) text = text.slice(0, -1) + next.text;
      else text += " " + next.text;
      prev = next;
      i++;
    }
    blocks.push({ kind: "p", text, page: line.page });
  }
  return blocks;
}

/** PDF baytlaridan tuzilma bloklari. */
export async function pdfToBlocks(bytes: Uint8Array): Promise<{ blocks: PdfBlock[]; pages: number }> {
  if (typeof window !== "undefined") throw new Error("PDF serverda o‘qiladi");
  const { getDocumentProxy } = await import("unpdf");
  /*
   * NUSXA beriladi, asl baytlar emas.
   *
   * pdf.js ArrayBuffer ni «worker» ga UZATADI (transfer) va chaqiruvchi
   * qo'lidagi bufer bo'shab qoladi. Shundan keyin o'sha baytlarni
   * ikkinchi marta o'qish `DataCloneError` beradi — worker esa aynan
   * shunday qiladi: avval `chars` uchun, keyin hujjatni qurish uchun.
   */
  const doc = await getDocumentProxy(bytes.slice());
  const pages = doc.numPages;

  const lines: Line[] = [];
  const heights: number[] = [];
  try {
  for (let n = 1; n <= pages; n++) {
    const page = await doc.getPage(n);
    const view = (page as unknown as { view: number[] }).view ?? [0, 0, 612, 792];
    heights.push(Math.abs(view[3] - view[1]));
    const content = await page.getTextContent();
    const items = (content.items as unknown as RawItem[]).filter((it) => typeof it.str === "string");
    // Qalin shrift nomi `commonObjs` da bo'lishi mumkin — bo'lmasa faqat
    // o'lcham bo'yicha sarlavha aniqlanadi.
    const bolds = new Set<string>();
    for (const it of items) {
      if (!it.fontName || bolds.has(it.fontName)) continue;
      try {
        const objs = (page as unknown as { commonObjs: { has(k: string): boolean; get(k: string): { name?: string } } }).commonObjs;
        if (objs?.has(it.fontName) && /bold|black|heavy|semib/i.test(objs.get(it.fontName)?.name ?? "")) {
          bolds.add(it.fontName);
        }
      } catch {
        // pdf.js shrift ob'ektini bermadi — muhim emas.
      }
    }
    lines.push(...toLines(items, n, bolds));
  }
  } finally {
    /*
     * Hujjat YOPILADI.
     *
     * pdf.js har hujjat uchun «loopback port» ochadi va uni yopmasak,
     * bitta jarayonda ketma-ket ikkinchi PDF o'qilganda portlar
     * chalkashib `DataCloneError` beradi (aynan shu xato ketma-ket ikki
     * PDF ni o'qiyotgan testda ushlandi).
     */
    const closable = doc as unknown as {
      loadingTask?: { destroy?: () => Promise<void> };
      cleanup?: () => Promise<void>;
    };
    await (closable.loadingTask?.destroy?.() ?? closable.cleanup?.() ?? Promise.resolve()).catch(() => {});
  }

  const kept = dropRunningHeads(lines, heights, pages);
  const bodySize = median(kept.map((l) => l.size));
  return { blocks: toBlocks(kept, bodySize || 10), pages };
}

/** Bloklardan segmentlar: `f:{n}` matn, `f:{n}:{r}:{c}` jadval katagi. */
export function pdfBlocksToSegments(blocks: PdfBlock[]): Segment[] {
  const out: Segment[] = [];
  blocks.forEach((b, n) => {
    const ctx = `page ${b.page}`;
    if (b.kind === "table") {
      (b.rows ?? []).forEach((row, r) => {
        row.forEach((cell, c) => {
          if (!isTranslatable(cell)) return;
          out.push({ id: `f:${n}:${r}:${c}`, text: cell, kind: "cell", ctx, part: "pdf" });
        });
      });
      return;
    }
    if (!b.text || !isTranslatable(b.text)) return;
    out.push({ id: `f:${n}`, text: b.text, kind: b.kind, ctx, part: "pdf" });
  });
  return out;
}

function translated(map: SegmentMap, id: string, fallback: string): string {
  const t = map.get(id);
  return t !== undefined && t.trim() ? t : fallback;
}

/**
 * Tarjima qilingan bloklardan `AcademicDoc` — `renderDocx` uchun.
 *
 * Jadvallar `doc.tables` da langar (`anchor`) bilan turadi, shuning uchun
 * matn oqimi bo'limlarga BO'LINADI: har jadvaldan oldin joriy bo'lim
 * yopiladi va jadval o'sha bo'limga langarlanadi. Rejadagi «bitta
 * `body` bo'limi» ko'rinishidan chetlanish ATAYIN: bitta bo'limda
 * `tablePlacement: "anchored"` barcha jadvalni matndan KEYIN chizardi,
 * ya'ni hujjat o'rtasidagi jadval oxiriga sakrab, PDF tuzilmasi
 * buzilardi. Jadvalsiz hujjatda esa natija rejadagidek: yagona `body`.
 */
export function pdfBlocksToDoc(blocks: PdfBlock[], map: SegmentMap, meta: DocMeta): AcademicDoc {
  const sections: DocSection[] = [{ id: "body", title: "", blocks: [] }];
  const tables: DocTable[] = [];
  const current = () => sections[sections.length - 1];

  blocks.forEach((b, n) => {
    if (b.kind === "table") {
      const rows = (b.rows ?? []).map((row, r) =>
        row.map((cell, c) => (isTranslatable(cell) ? translated(map, `f:${n}:${r}:${c}`, cell) : cell)),
      );
      if (!rows.length) return;
      const [head, ...rest] = rows;
      tables.push({ headers: head, rows: rest, anchor: current().id });
      sections.push({ id: `body${sections.length + 1}`, title: "", blocks: [] });
      return;
    }
    if (!b.text) return;
    const text = isTranslatable(b.text) ? translated(map, `f:${n}`, b.text) : b.text;
    const kind: Block["kind"] = b.kind === "h" ? "h1" : b.kind === "li" ? "li" : "p";
    current().blocks.push({ kind, text } as Block);
  });

  return {
    meta,
    titlePage: false,
    toc: false,
    sections: sections.filter((s, i) => s.blocks.length || i === 0),
    ...(tables.length ? { tables } : {}),
  };
}

export async function extractPdf(bytes: Uint8Array): Promise<Extracted> {
  const { blocks, pages } = await pdfToBlocks(bytes);
  return { segments: pdfBlocksToSegments(blocks), chars: 0, warnings: [], pdf: { blocks, pages } };
}
