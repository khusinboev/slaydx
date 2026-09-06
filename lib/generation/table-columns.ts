/**
 * Jadval ustun kengliklari (foizda) — ustun soniga qarab.
 *
 * DOCX (`render-docx.ts`) va sayt ko'ruvchisi (`TableViewer`,
 * `LessonViewer`) SHU YAGONA manbadan foydalanadi. Ilgari faqat DOCX
 * `columnWidths` bilan og'irlikli chizardi (`<w:tblGrid>`), ko'ruvchi esa
 * `table-layout: auto` — "Mavzu" ustuni saytda "№" ustuni bilan bir xil
 * torayib, matn to'rt qatorga sinardi (AUDIT-6 A9).
 *
 * Faqat aniq tanish shakllar uchun; boshqasida teng taqsimot qoladi.
 */
export function columnPercents(headers: string[]): number[] | null {
  // № | Soat | Mavzu | Metod | Natija | Nazorat  (texnologik xarita)
  if (headers.length === 6) return [5, 8, 33, 15, 25, 14];
  // Dars rejasi jadvali endi `DocTable.widths` ni o'zi beradi (B5), shuning
  // uchun bu yerda faqat 6 ustunli xarita qoladi — 4 ustunli qolip boshqa
  // (model bergan) jadvalga xato qo'llanardi.
  return null;
}

/** Barcha ustunga teng foiz — `columnPercents` `null` qaytarganda. */
export function evenPercents(count: number): number[] {
  const n = Math.max(1, count);
  return new Array(n).fill(Math.round(100 / n));
}
