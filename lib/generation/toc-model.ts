import { docLabels } from "./i18n";
import { planWork } from "./work/layout";
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
  /*
   * Talaba ishlari 2 (AUDIT-19): mundarija qatorlari `planWork` dan —
   * bob/paragraf raqamlari («1-BOB. …», «1.1. …»), ilova va adabiyotlar
   * u yerda hisoblanadi. Bu yerda ularni QAYTA yig'ish ikkita nusxa
   * bo'lardi: mundarija hujjat tanasidagi sarlavhadan bir harf bilan
   * farq qilsa ham «ko'rdim = oldim» buziladi.
   */
  if (doc.work) return planWork(doc).toc;

  const rows: TocRow[] = [];
  for (const s of doc.sections) {
    // Matnsiz bo'lim hujjat tanasida chizilmaydi (`render-docx`), demak
    // mundarijada ham turmasligi kerak — aks holda mundarija mavjud
    // bo'lmagan bo'limga ishora qilardi.
    if (!s.blocks.length) continue;
    rows.push({ text: s.title, level: 1 });
    for (const b of s.blocks) if (b.kind === "h2") rows.push({ text: b.text, level: 2 });
  }
  if (doc.references?.length) rows.push({ text: docLabels(doc.meta.language).references, level: 1 });
  return rows;
}
