import { docLabels } from "./i18n";
import type { AcademicDoc } from "./types";

export type TocRow = { text: string; level: 1 | 2 };

/**
 * Mundarija qatorlari — DOCX va veb ko'rinish uchun YAGONA manba.
 *
 * Ilgari ikki tomon mundarijani mustaqil qurardi: fayl bo'lim va
 * ostmavzularni chiqarardi, viewer esa faqat bo'limlarni va ustiga o'zi
 * «1.», «2.» raqamini qo'shardi. Natijada ko'rinish fayl bilan mos
 * kelmasdi — foydalanuvchi ko'rgan narsa yuklab olgan narsadan boshqa
 * edi. Slaydlardagi `planSlide` bilan bir xil yondashuv: koordinatani
 * bitta funksiya beradi, ikkala renderer uni faqat chizadi.
 *
 * Raqam bu yerda QO'SHILMAYDI — u sarlavhaning o'zida bor
 * («I BOB. …», «1.1. …») va hujjat tanasida ham aynan shunday ko'rinadi.
 */
export function tocRows(doc: AcademicDoc): TocRow[] {
  const rows: TocRow[] = [];
  for (const s of doc.sections) {
    rows.push({ text: s.title, level: 1 });
    for (const b of s.blocks) if (b.kind === "h2") rows.push({ text: b.text, level: 2 });
  }
  if (doc.references?.length) rows.push({ text: docLabels(doc.meta.language).references, level: 1 });
  return rows;
}
