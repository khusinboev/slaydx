import { mapWeeks } from "./write-specials";
import type { AcademicDoc, Delivered, DocMeta } from "./types";

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
 * Slaydning RASM soni ham SHU YERDA (AUDIT-7 O-1). Ilgari u ataylab
 * tashlab qo'yilgan edi: «rasm soni yorliqda va'da qilinmagan, unga
 * nisbat bo'yicha pul qaytarish o'lchanmagan narsaga narx qo'yish
 * bo'lardi». Jonli sinov shu mulohazaning ikkinchi yarmi yo'qligini
 * ko'rsatdi: fal.ai 19 ta so'rovning 19 tasini rad etganda
 * («403 User is locked») deka rasmsiz `COMPLETED` bo'lar, premium
 * paketning butun narxi olinar va foydalanuvchi buni HECH QAYERDAN
 * bilmasdi — yagona signal server jurnalidagi `console.warn` edi.
 * Yechim — nisbatni RASMNING narxdagi ulushiga ko'paytirish
 * (`IMAGE_PRICE_SHARE`), ya'ni o'lchanmagan narsaga emas, o'lchangan
 * ustamaga narx qo'yish.
 */
export type { Delivered } from "./types";

/**
 * Rasmning slayd narxidagi ulushi — paket narxlaridan CHIQARILADI
 * (`priceFor`, `lib/tools.ts`), taxmin qilinmaydi:
 *
 *   standart 10 slayd 3 000, uzun 14 slayd 5 000
 *      → slayd bahosi (5 000 − 3 000) / (14 − 10) = 500 tanga;
 *   premium      12 slayd 6 000 = 3 000 + 2×500 + 2 000;
 *   premium uzun 16 slayd 8 000 = 5 000 + 2×500 + 2 000.
 *
 * Ya'ni «sifatliroq rasm» ustamasi ikkala premium paketda ham AYNAN
 * 2 000 tanga: 2 000/6 000 = 1/3 va 2 000/8 000 = 1/4. Ulush eng
 * KICHIGI bo'yicha olinadi — qaytarish hech qachon haqiqiy ustamadan
 * oshmasin.
 */
const IMAGE_PRICE_SHARE = 0.25;

/**
 * Standart/uzun paketda ulush NOL.
 *
 * Yorliqda («Standart · 10 slayd · 3 000») rasm haqida so'z yo'q va
 * narxda unga ustama ham yo'q — pul qaytarish uchun asos bo'lmaydi.
 * Lekin kamomad baribir QAYD ETILADI (`refundShare: 0`): natija
 * sahifasi rasm chiqmaganini aytadi va sabab bazada qoladi.
 */
const IMAGE_PRICE_SHARE_STANDARD = 0;

/**
 * Slayd dekasidagi RASM va'dasi.
 *
 * Va'da soni `doc.slideImages.want` dan olinadi — uni rasm bosqichining
 * o'zi (`plannedImageSlots`) yozadi. Bu yerda qayta hisoblanmaydi:
 * ikkinchi nusxa `photoSlot`/`imageBudget` o'zgarganda jimgina
 * ajralib ketardi. Hisobot yo'q bo'lsa (eski `doc_json`, rasm bosqichi
 * umuman ishlamagan muhit) — va'da ham yo'q.
 */
function imagesDelivered(meta: DocMeta, doc: AcademicDoc): Delivered | undefined {
  const rep = doc.slideImages;
  if (!rep || !(rep.want > 0) || rep.got >= rep.want) return undefined;
  return {
    got: Math.max(0, rep.got),
    want: rep.want,
    unit: "rasm",
    refundShare: meta.premiumVisuals ? IMAGE_PRICE_SHARE : IMAGE_PRICE_SHARE_STANDARD,
  };
}

/** Kamomadning PUL og'irligi — `shortfallRatio` bilan bir xil formula. */
function weight(d: Delivered): number {
  return (1 - Math.max(0, d.got) / d.want) * (d.refundShare ?? 1);
}

/**
 * Ikkita kamomaddan qaysinisi yoziladi.
 *
 * `delivered` maydoni bitta — bazada ham, natija sahifasida ham. Slayd
 * dekasida esa ikkita va'da bor (slayd soni va rasm soni) va ikkalasi
 * birdan buzilishi mumkin. Pul jihatdan OG'IRROG'I olinadi, teng bo'lsa
 * xom nisbati kattarog'i: foydalanuvchi kamida eng katta kamomadni
 * ko'radi va uning puli qaytadi.
 */
function worse(a?: Delivered, b?: Delivered): Delivered | undefined {
  if (!a) return b;
  if (!b) return a;
  const wa = weight(a);
  const wb = weight(b);
  if (wb > wa) return b;
  if (wb < wa) return a;
  return 1 - b.got / b.want > 1 - a.got / a.want ? b : a;
}

/** Glossariyda atama — `h3` sarlavha; ta'rif undan keyingi paragraf. */
function countTerms(doc: AcademicDoc): number {
  let n = 0;
  for (const s of doc.sections) for (const b of s.blocks) if (b.kind === "h3") n += 1;
  return n;
}

export function deliveredCount(meta: DocMeta, doc: AcademicDoc): Delivered | undefined {
  let got: number;
  let want: number;
  let unit: string;

  switch (meta.toolId) {
    case "slide":
      // `targetPages` slaydda — SLAYDLAR soni (`extractMeta`).
      want = meta.targetPages;
      got = doc.slides?.length ?? 0;
      unit = "slayd";
      break;
    case "glossary":
      want = meta.termCount;
      got = countTerms(doc);
      unit = "atama";
      break;
    case "texnologik-xarita":
      want = mapWeeks(meta);
      got = doc.tables?.[0]?.rows.length ?? 0;
      unit = "hafta";
      break;
    default:
      return undefined;
  }

  // Ortiq yetkazish qaytarish sababi emas.
  const byCount = !(want > 0) || got >= want ? undefined : { got, want, unit };
  if (meta.toolId !== "slide") return byCount;
  return worse(byCount, imagesDelivered(meta, doc));
}
