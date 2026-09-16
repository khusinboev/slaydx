import { mapWeeks } from "./write-specials";
import { teacherExtraLabels } from "./i18n";
import { teacherInputFromValues } from "./teacher/input";
import { weeksFor } from "./teacher/guard";
import { testInputFromValues } from "./teacher/test/input";
import type { FormValues } from "../types";
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
 * Standart/uzun paketda QISMAN kamomad uchun ulush NOL.
 *
 * Yorliqda («Standart · 10 slayd · 3 000») rasm haqida so'z yo'q va
 * narxda unga ustama ham yo'q — 4 tadan 3 tasi chiqqani pul qaytarishga
 * asos bo'lmaydi. Kamomad baribir QAYD ETILADI: natija sahifasi rasm
 * kam chiqqanini aytadi va sabab bazada qoladi.
 *
 * Bu ulush RASM UMUMAN chiqmagan holatga TEGISHLI EMAS — u holat
 * `refundRatio` da paketdan qat'i nazar to'liq qaytarish bilan
 * yopiladi.
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

/**
 * Kamomad narxning qancha ULUSHINI qaytarishga sabab bo'ladi — YAGONA
 * manba. Worker (`shortfallRatio`) ham, ikkita kamomaddan og'irrog'ini
 * tanlash ham shu funksiyadan o'qiydi.
 *
 * Ilgari formula IKKI joyda alohida yozilgan edi (`weight` va
 * `shortfallRatio`) va izohda «bir xil formula» deb va'da qilinardi —
 * bu loyihada bir necha marta «ekranda bitta xil, faylda boshqa xil»
 * nuqsoniga olib kelgan naqsh.
 *
 * **HECH NARSA yetkazilmagan bo'lsa — TO'LIQ qaytariladi**, ulushdan
 * qat'i nazar. Ulush («rasm narxning chorak qismi») QISMAN kamomadni
 * o'lchash uchun: matn va maket yetkazilgan, faqat rasm kam chiqqan.
 * Rasm UMUMAN bo'lmasa, foydalanuvchi va'da qilingan mahsulotning bir
 * qismini emas, butun bir turini olmaydi — bunda ulush bilan
 * o'lchashning ma'nosi yo'q.
 */
export function refundRatio(d: Delivered | undefined): number | null {
  if (!d) return null;
  const { got, want } = d;
  if (!(want > 0) || got >= want) return null;
  if (got <= 0) return 1;
  const share = d.refundShare ?? 1;
  if (!(share > 0)) return null;
  return Math.min(1, (1 - got / want) * share);
}

/** Kamomadning PUL og'irligi — qaytariladigan ulush. */
function weight(d: Delivered): number {
  return refundRatio(d) ?? 0;
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

/**
 * O'qituvchi vositalari (AUDIT-20 WP-F) — miqdor MODELDAN, matndan emas.
 *
 * Eski yo'l `h3` sarlavhalarni sanardi va xaritada birinchi jadvalning
 * qatorlarini olardi. Yangi dvigatelda ikkalasi ham NOTO'G'RI javob
 * beradi:
 *   • `uch-tilli` glossariyda atamalar QO'SHIMCHA jadvalda ham turadi;
 *   • `choraklik` xaritada TO'RTTA jadval bor va birinchisi yilning
 *     atigi choragi — 34 haftalik xarita «9 hafta» bo'lib ko'rinardi va
 *     to'liq bajarilgan ish uchun pulning uchdan ikkisi qaytarilardi;
 *   • keysda va testda esa matnda sanaladigan ishonchli belgi umuman
 *     yo'q edi (`h3` — «Topshiriqlar» va «Namunaviy kalit» sarlavhalari).
 *
 * VA'DA (`want`) esa `values` dan, `teacher/input.ts` orqali: reyestr
 * chegaralari (tur bo'yicha atama/keys/savol soni) dvigatel bilan AYNI
 * funksiyada hisoblanadi, ya'ni darvoza va narx bir xil sonni ko'radi.
 *
 * Dars rejasida MIQDOR VA'DASI YO'Q (narx bosqich soniga bog'lanmagan) —
 * u yerda bosqich soni `index.ts` ning tuzilma darvozasida tekshiriladi.
 */
function teacherDelivered(meta: DocMeta, doc: AcademicDoc, values: FormValues): Delivered | undefined {
  const t = doc.teacher;
  if (!t) return undefined;
  const L = teacherExtraLabels(doc.meta?.language || meta.language);

  if (t.kind === "test") {
    const model = t.test;
    if (!model) return undefined;
    return { got: model.questions.length, want: testInputFromValues(meta, values).count, unit: L.unitQuestion };
  }

  const input = teacherInputFromValues(meta, values, t.kind);
  switch (t.kind) {
    case "map": {
      const m = t.map;
      if (!m) return undefined;
      // Hafta soni — BARCHA choraklar bo'ylab (choraklik xaritada 4 jadval).
      const got = m.quarters.reduce((n, q) => n + q.weeks.length, 0);
      return { got, want: weeksFor(m.weeklyHours || input.weeklyHours, m.totalHours || input.totalHours), unit: L.unitWeek };
    }
    case "glossary":
      return t.glossary ? { got: t.glossary.terms.length, want: input.termCount, unit: L.unitTerm } : undefined;
    case "keys":
      return t.keys ? { got: t.keys.cases.length, want: input.caseCount, unit: L.unitCase } : undefined;
    default:
      // `lesson` — miqdor va'da qilinmaydi.
      return undefined;
  }
}

/**
 * `values` — o'qituvchi vositalarining VA'DASI shundan o'qiladi
 * (`teacher/input.ts`). Qolgan vositalarda `meta` yetarli, shuning uchun
 * parametr ixtiyoriy va eski chaqiruvchilar o'zgarmaydi.
 */
export function deliveredCount(meta: DocMeta, doc: AcademicDoc, values: FormValues = {}): Delivered | undefined {
  /*
   * O'qituvchi dvigateli ishlagan bo'lsa (`doc.teacher`) — YANGI yo'l.
   * Eski hujjatlarda (`TEACHER_ENGINE=0`, `write-specials.ts` va bazadagi
   * eski `doc_json`) model yo'q va pastdagi `h3`/`mapWeeks` hisobi
   * o'zgarishsiz ishlaydi.
   */
  if (doc.teacher) {
    const byModel = teacherDelivered(meta, doc, values);
    return !byModel || !(byModel.want > 0) || byModel.got >= byModel.want ? undefined : byModel;
  }

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
