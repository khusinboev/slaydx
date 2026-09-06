import { mapWeeks } from "./write-specials";
import type { AcademicDoc, DocMeta } from "./types";

/**
 * Va'da qilingan MIQDORNING qanchasi yetkazildi.
 *
 * Ba'zi vositalarda narx bevosita SONGA bog'langan va o'sha son
 * foydalanuvchiga ochiq ko'rsatiladi:
 *
 *   slayd     — «Premium uzun · 16 slayd · 8 000» (paket yorlig'i);
 *   glossariy — «40 ta atama» tanlovi, narx 6 000 / 9 000 / 15 000;
 *   xarita    — haftalar soni foydalanuvchi kiritgan soatlardan chiqadi.
 *
 * Ularning har birida sifat darvozasi bor, lekin u FLOOR: slaydda 0.85,
 * glossariy va xaritada 0.70. Floor «umuman yaroqlimi» degan savolga
 * javob beradi — «va'da bajarildimi» degan savolga emas. Natijada
 * 16 slayd o'rniga 14, 40 atama o'rniga 28 chiqsa ish `COMPLETED`
 * bo'lar va TO'LIQ pul olinardi (AUDIT-5 P1-1, P1-2).
 *
 * Ikkalasi ham kerak va ular BOSHQA ishni qiladi:
 *   • floordan past  → xato + to'liq qaytarish (mahsulot yaroqsiz);
 *   • floor va va'da orasida → yetkaziladi + FARQ qaytariladi.
 *
 * Rasm vositasi bu naqshni allaqachon ishlatadi (`packImages`); bu modul
 * uni qolgan uchtasiga yoyadi. `BuiltFile.delivered` ga tushadi, undan
 * keyingisini worker hal qiladi (`shortfallRatio` → `refundPartial`).
 *
 * Nega slaydning RASM soni bu yerda YO'Q: u yorliqda va'da qilinmagan
 * («sifatliroq rasm», «10 ta rasm» emas), ya'ni unga nisbat bo'yicha pul
 * qaytarish o'lchanmagan narsaga narx qo'yish bo'lardi.
 */
export type Delivered = { got: number; want: number };

/** Glossariyda atama — `h3` sarlavha; ta'rif undan keyingi paragraf. */
function countTerms(doc: AcademicDoc): number {
  let n = 0;
  for (const s of doc.sections) for (const b of s.blocks) if (b.kind === "h3") n += 1;
  return n;
}

export function deliveredCount(meta: DocMeta, doc: AcademicDoc): Delivered | undefined {
  let got: number;
  let want: number;

  switch (meta.toolId) {
    case "slide":
      // `targetPages` slaydda — SLAYDLAR soni (`extractMeta`).
      want = meta.targetPages;
      got = doc.slides?.length ?? 0;
      break;
    case "glossary":
      want = meta.termCount;
      got = countTerms(doc);
      break;
    case "texnologik-xarita":
      want = mapWeeks(meta);
      got = doc.tables?.[0]?.rows.length ?? 0;
      break;
    default:
      return undefined;
  }

  // Ortiq yetkazish qaytarish sababi emas.
  if (!(want > 0) || got >= want) return undefined;
  return { got, want };
}
