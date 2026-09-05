import type { DocMeta } from "./types";

/**
 * DOCX hujjat profili — janr uchun tipografiya va sahifa qoidalari.
 *
 * Nega kerak: `render-docx.ts` 11 xizmatga BITTA qolip berardi va
 * turga bog'liq butun mantiq ikkita `if (meta.toolId === ...)` shartidan
 * iborat edi. Natijada rezyume ham, glossariy ham, dars rejasi ham
 * kurs ishi ko'rinishida — markazlashtirilgan BOSH HARFLI sarlavha,
 * justified matn, 1.25 sm chekinish — chiqardi. Rezyumeda bu ayniqsa
 * og'ir edi: sayt ikki ustunli zamonaviy CV ko'rsatar, yuklab olingan
 * fayl esa referat bo'lardi.
 *
 * Yechim `slide-themes.ts` / `slide-templates.ts` naqshidan olingan va
 * loyihada allaqachon ishlaydi: farqni SHART bilan emas, MA'LUMOT bilan
 * ifodalash. Yangi janr qo'shish = yangi profil yozish, rendererga
 * tegmasdan.
 */

/** 1 sm = 567 twip (DXA). */
export const CM = 567;

const A4_W = 11906;
const A4_H = 16838;

export type DocProfileId = "gost" | "article" | "essay" | "resume" | "landscape" | "lesson" | "reference";

export type DocProfile = {
  id: DocProfileId;
  page: {
    /** Portret o'lchamlari. Albom uchun `docx` ularni o'zi almashtiradi. */
    width: number;
    height: number;
    landscape: boolean;
    margin: { top: number; bottom: number; left: number; right: number };
    /** Rangli sahifa ramkasi (`meta.design` dan) — faqat insho. */
    border: boolean;
  };
  type: {
    font: string;
    /** Yarim-punkt: 28 = 14pt. */
    size: number;
    /** 240 = bir interval, 360 = 1.5. */
    line: number;
    justify: boolean;
    /** Birinchi qator chekinishi (DXA). */
    firstLine: number;
    /** Paragrafdan keyingi bo'shliq. */
    after: number;
  };
  heading: {
    align: "center" | "left";
    upper: boolean;
    /** Sarlavha ostidagi chiziq — rezyume/glossariy uchun. */
    rule: boolean;
    /**
     * Aniq rang (HEX, `#` siz). Berilmasa Word ning «Heading 1» uslubi
     * qoladi — u LibreOffice da to'q sariqqa yaqin chiqadi va ilmiy
     * ishda ataylab shunday. Rezyumeda esa sarlavha qora bo'lib,
     * ajratuvchi chiziq rangli bo'ladi (ko'ruvchidagi kabi).
     */
    color?: string;
  };
  titlePage: "gost" | "article" | "none";
  /**
   * `anchored` — jadval o'z bo'limidan keyin chiziladi (`DocTable.anchor`).
   * `end` — barcha jadvallar hujjat oxirida (eski xatti-harakat).
   */
  tablePlacement: "anchored" | "end";
  /** Jadval katagidagi shrift o'lchami (yarim-punkt). */
  tableSize: number;
};

const GOST_TYPE: DocProfile["type"] = {
  font: "Times New Roman",
  size: 28,
  line: 360,
  justify: true,
  firstLine: Math.round(1.25 * CM),
  after: 200,
};

const GOST_PAGE: DocProfile["page"] = {
  width: A4_W,
  height: A4_H,
  landscape: false,
  margin: { top: 2 * CM, bottom: 2 * CM, left: 3 * CM, right: Math.round(1.5 * CM) },
  border: false,
};

const GOST_HEADING: DocProfile["heading"] = { align: "center", upper: true, rule: false };

const PROFILES: Record<DocProfileId, DocProfile> = {
  /** OTME/GOST talab qiladigan standart ilmiy ish ko'rinishi. */
  gost: {
    id: "gost",
    page: GOST_PAGE,
    type: GOST_TYPE,
    heading: GOST_HEADING,
    titlePage: "gost",
    tablePlacement: "end",
    tableSize: 22,
  },
  /** Jurnal maqolasi: vazirlik sarlavhasi emas, muallif bloki. */
  article: {
    id: "article",
    page: GOST_PAGE,
    type: GOST_TYPE,
    heading: GOST_HEADING,
    titlePage: "article",
    tablePlacement: "end",
    tableSize: 22,
  },
  /** Insho: GOST + `design` rangidagi sahifa ramkasi. */
  essay: {
    id: "essay",
    page: { ...GOST_PAGE, border: true },
    type: GOST_TYPE,
    heading: GOST_HEADING,
    titlePage: "gost",
    tablePlacement: "end",
    tableSize: 22,
  },
  /**
   * Rezyume — hujjat emas, DA'VO.
   *
   * Sans shrift (ATS tizimlari Times New Roman ni ham o'qiydi, lekin
   * odam o'qiydigan CV da u eskirgan ko'rinadi), tor chekinish, chapga
   * tekislangan matn, chekinishsiz paragraf. Markazlashtirilgan BOSH
   * HARFLI «QISQACHA» — akademik qolipning eng ko'zga tashlanadigan
   * qismi — bu yerda umuman yo'q.
   */
  resume: {
    id: "resume",
    page: {
      ...GOST_PAGE,
      margin: { top: Math.round(1.4 * CM), bottom: Math.round(1.4 * CM), left: Math.round(1.5 * CM), right: Math.round(1.5 * CM) },
    },
    type: { font: "Calibri", size: 21, line: 276, justify: false, firstLine: 0, after: 100 },
    heading: { align: "left", upper: true, rule: true, color: "1C1917" },
    titlePage: "none",
    tablePlacement: "end",
    tableSize: 20,
  },
  /**
   * Albom — asosiy mazmuni JADVAL bo'lgan hujjatlar uchun.
   *
   * Texnologik xarita 6 ustunli (№/soat/mavzu/metod/natija/nazorat).
   * Portret A4 da 3 sm chap chekinish bilan foydali kenglik 9354 twip,
   * ya'ni ustunga ~1560 twip (2.75 sm) — «Mavzu» ustuniga 80 belgi
   * sig'maydi. Albomda va tor chekinish bilan 14 400 twip chiqadi (+54%).
   */
  landscape: {
    id: "landscape",
    page: {
      ...GOST_PAGE,
      landscape: true,
      margin: { top: Math.round(1.5 * CM), bottom: Math.round(1.5 * CM), left: Math.round(2 * CM), right: Math.round(1.5 * CM) },
    },
    type: { ...GOST_TYPE, size: 24, line: 276 },
    heading: GOST_HEADING,
    titlePage: "gost",
    tablePlacement: "anchored",
    tableSize: 20,
  },
  /**
   * Dars ishlanmasi — PORTRET, jadval langarlangan.
   *
   * Ilgari u texnologik xarita bilan bitta `landscape` profilda edi,
   * lekin albomning o'z asoslanishi (yuqorida) FAQAT xartaga tegishli:
   * u 6 ustunli va «Mavzu» ustuniga 80 belgi sig'ishi kerak. Dars
   * rejasida esa jadval 4 ustunli va u hujjatning KICHIK qismi —
   * asosiysi bosqichlar nasri (6 bosqich × 700 belgigacha).
   *
   * Albomda o'sha nasr ~26 sm satrda chiqardi: bir qatorga 120+ belgi,
   * ya'ni o'qish uchun yaroqsiz uzunlik. Bundan tashqari sayt ko'ruvchisi
   * (`LessonViewer`) portret A4 chizardi — foydalanuvchi ko'rgan hujjat
   * yuklab olganidan boshqa yo'nalishda edi (AUDIT-5 P0-3).
   *
   * Jadval langari `landscape` dan meros: vaqt jadvali dars xaritasidan
   * KEYIN turishi kerak, hujjat oxirida emas.
   */
  lesson: {
    id: "lesson",
    page: GOST_PAGE,
    type: { ...GOST_TYPE, size: 26, line: 312 },
    heading: GOST_HEADING,
    titlePage: "gost",
    tablePlacement: "anchored",
    tableSize: 20,
  },
  /**
   * Ma'lumotnoma (glossariy) — ketma-ket o'qilmaydi, IZLANADI.
   *
   * Atama sarlavhalari chapda turadi (markazda emas), ta'rif chekinishsiz
   * boshlanadi — ko'z atamadan atamaga sakraydi. Justify o'chirilgan:
   * qisqa ta'riflarda u so'zlar orasida katta bo'shliq qoldiradi.
   */
  reference: {
    id: "reference",
    page: {
      ...GOST_PAGE,
      margin: { top: 2 * CM, bottom: 2 * CM, left: Math.round(2.5 * CM), right: Math.round(1.5 * CM) },
    },
    type: { ...GOST_TYPE, size: 26, line: 300, justify: false, firstLine: 0, after: 140 },
    heading: { align: "left", upper: true, rule: true, color: "1C1917" },
    titlePage: "gost",
    tablePlacement: "end",
    tableSize: 22,
  },
};

/**
 * Janr uchun profil. Yagona joy — renderer boshqa hech qayerda
 * `toolId` ni so'ramaydi.
 */
export function profileFor(meta: DocMeta): DocProfile {
  switch (meta.toolId) {
    case "resume":
      return PROFILES.resume;
    case "essay":
      return PROFILES.essay;
    case "article":
      return PROFILES.article;
    case "texnologik-xarita":
      return PROFILES.landscape;
    case "lesson-plan":
      return PROFILES.lesson;
    case "glossary":
      return PROFILES.reference;
    default:
      return PROFILES.gost;
  }
}

/** Chekinishlardan keyin qoladigan foydali kenglik (DXA). */
export function contentWidth(p: DocProfile): number {
  const w = p.page.landscape ? p.page.height : p.page.width;
  return w - p.page.margin.left - p.page.margin.right;
}

/** Chekinishlardan keyin qoladigan foydali balandlik (DXA). */
export function contentHeight(p: DocProfile): number {
  const h = p.page.landscape ? p.page.width : p.page.height;
  return h - p.page.margin.top - p.page.margin.bottom;
}

export function profileById(id: DocProfileId): DocProfile {
  return PROFILES[id];
}
