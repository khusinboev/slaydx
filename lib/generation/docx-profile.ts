import { PUBLICATION_PROFILES } from "./article/profiles";
import type { PublicationProfileId } from "./article/types";
import { RESUME_TEMPLATES, type ResumeTemplateId } from "./resume/templates";
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

export type DocProfileId =
  | "gost"
  | "article"
  | "essay"
  | "resume"
  | "landscape"
  | "lesson"
  | "reference"
  | "translation";

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

/**
 * Akademik sarlavha — MARKAZDA, BOSH HARF, QORA.
 *
 * Rang ilgari berilmasdi va Word ning «Heading 1» uslubi qolardi. Word
 * uni ko'k, LibreOffice esa ko'k/to'q sariq chizadi — ya'ni PDF ga
 * o'girilgan yoki LibreOffice da ochilgan har bir topshiriladigan ish
 * RANGLI sarlavhalar bilan chiqardi. OTME va GOST 7.32 talablarida ilmiy
 * ishda rangli sarlavha havaskorlik belgisi.
 *
 * Nuqson AUDIT-3 §17.4 da «alohida ko'rib chiqilsin» deb qoldirilgan,
 * AUDIT-4 §7 da qayd etilgan, AUDIT-5 §5 da takrorlangan edi. Sprint 15
 * dagi jonli tekshiruvda renderlangan PDF ko'z bilan ko'rilgach
 * tuzatildi: `#000000` maketni umuman o'zgartirmaydi, faqat rangni
 * qat'iylashtiradi.
 */
const GOST_HEADING: DocProfile["heading"] = {
  align: "center",
  upper: true,
  rule: false,
  color: "000000",
};

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
  /**
   * Tarjima — NEYTRAL hujjat, akademik qolip EMAS.
   *
   * PDF dan tiklangan (yoki matn rejimidagi) tarjima uchun. Bu yerda
   * biz hujjatning JANRINI bilmaymiz: manba shartnoma ham, ilmiy maqola
   * ham, yo'riqnoma ham bo'lishi mumkin. Shuning uchun har qanday
   * «bezak» — markazlashtirilgan BOSH HARFLI sarlavha, 1.25 sm abzats
   * chekinishi, justify, titul sahifa — ATAYIN yo'q: ular manbada
   * bo'lmagan tuzilmani QO'SHIB yuborardi va foydalanuvchi «men bunday
   * hujjat bermagan edim» degan natijani olardi.
   *
   * Times New Roman 12 pt / 1.15 interval — rasmiy tarjima uchun eng
   * keng tarqalgan neytral qolip; titul yo'q (`"none"`), jadval o'z
   * joyida (`anchored`), chunki PDF da jadval matn OQIMI ichida turadi.
   */
  translation: {
    id: "translation",
    page: GOST_PAGE,
    type: { font: "Times New Roman", size: 24, line: 276, justify: false, firstLine: 0, after: 120 },
    heading: { align: "left", upper: false, rule: false, color: "000000" },
    titlePage: "none",
    tablePlacement: "anchored",
    tableSize: 20,
  },
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
 * Rezyume profili — SHABLONGA bog'langan (Rezyume 2, AUDIT-15).
 *
 * Ilgari `PROFILES.resume` bitta qat'iy qolip edi: Calibri 10.5 pt va
 * har tomondan 1.4–1.5 sm chegara. Olti shablonning har biri esa o'z
 * tipografiyasi va chegarasi bilan e'lon qilingan (`RESUME_TEMPLATES`)
 * — panelli maketda chegara UMUMAN bo'lmasligi kerak (panel varaq
 * chetiga tegib turadi), bannerli maketda esa faqat pastda. Profil shu
 * ma'lumotdan quriladi, ya'ni yangi shablon qo'shish rendererga
 * tegmaydi.
 *
 * `id` «resume» bo'lib QOLADI — `renderDocx` dagi tarmoq va eski
 * hujjatlar shu identifikatorga tayanadi.
 */
export function resumeProfile(templateId: ResumeTemplateId): DocProfile {
  const t = RESUME_TEMPLATES[templateId] ?? RESUME_TEMPLATES.modern;
  const mm = (v: number) => Math.round(v * 56.7);
  const side = t.columns === "sidebar-left" || t.columns === "sidebar-right";
  // Panel/banner varaq chetiga tegishi kerak — chegara 0, chekinishni
  // katak (`margins`) yoki paragraf (`indent`) beradi.
  const margin = side
    ? { top: 0, bottom: 0, left: 0, right: 0 }
    : t.header === "banner"
      ? { top: 0, bottom: mm(t.marginsMm.bottom), left: 0, right: 0 }
      : { top: mm(t.marginsMm.top), bottom: mm(t.marginsMm.bottom), left: mm(t.marginsMm.left), right: mm(t.marginsMm.right) };
  return {
    ...PROFILES.resume,
    page: { ...PROFILES.resume.page, margin },
    type: {
      font: t.type.font,
      size: Math.round(t.type.body * 2),
      line: Math.round(240 * t.type.line),
      justify: false,
      firstLine: 0,
      after: 100,
    },
    heading: {
      align: "left",
      upper: t.heading !== "rule",
      rule: t.heading === "rule" || t.heading === "hairline",
    },
    tableSize: Math.round(t.type.small * 2),
  };
}

/**
 * Maqola profili — NASHR PROFILIGA bog'langan (Maqola 2, AUDIT-17).
 *
 * `PROFILES.article` eski maqola (titul sahifali, jadval oxirida) uchun
 * qoladi. Yangi maqolada shrift/o'lcham/interval/chegara/jadval shrifti
 * `PUBLICATION_PROFILES` dan keladi — OAK (TNR 14, 1.5, 2/2/3/1.5 sm) va
 * IEEE (TNR 12, yakka, 2.5/2 sm) bitta rendererdan chiqadi. Titul YO'Q
 * (jurnal maqolasida bo'lmaydi), jadval matn ichida (`anchored`),
 * sarlavha BOSH HARFSIZ. `headingAlign` — `planArticle` qarori (tur
 * raqamlangan bo'lsa chapda), profil o'zi bilmaydi.
 *
 * `id` «article» bo'lib QOLADI — ko'ruvchi va eski tekshiruvlar shu
 * identifikatorga tayanadi.
 */
export function articleProfile(id: PublicationProfileId, opts: { headingAlign?: "center" | "left" } = {}): DocProfile {
  const p = PUBLICATION_PROFILES[id] ?? PUBLICATION_PROFILES.oak;
  const cm = (v: number) => Math.round(v * CM);
  return {
    id: "article",
    page: {
      ...GOST_PAGE,
      margin: { top: cm(p.marginsCm.top), bottom: cm(p.marginsCm.bottom), left: cm(p.marginsCm.left), right: cm(p.marginsCm.right) },
    },
    type: {
      font: p.font,
      size: Math.round(p.sizePt * 2),
      line: Math.round(240 * p.line),
      justify: true,
      firstLine: Math.round(1.25 * CM),
      // Yakka intervalda paragraf oralig'i 6 pt, 1.5 da 10 pt (GOST odati).
      after: p.line >= 1.5 ? 200 : 120,
    },
    heading: {
      align: opts.headingAlign ?? (p.numberedSections ? "left" : "center"),
      upper: false,
      rule: false,
      color: "000000",
    },
    titlePage: "none",
    tablePlacement: "anchored",
    tableSize: Math.round(p.tableSizePt * 2),
  };
}

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
      /*
       * `pubProfile` faqat Maqola 2 dan keyin yaratilgan hujjatlarda bor;
       * eski `doc_json` (titul sahifali maqola) avvalgi profil bilan
       * ochilishda davom etadi. `renderDocx` `doc.article` bo'lsa
       * modeldagi profilni oladi — bu yer faqat meta bo'yicha qarorlar
       * (`titleModel`, sahifa darvozasi) uchun.
       */
      return meta.pubProfile ? articleProfile(meta.pubProfile) : PROFILES.article;
    case "texnologik-xarita":
      return PROFILES.landscape;
    case "lesson-plan":
      return PROFILES.lesson;
    case "glossary":
      return PROFILES.reference;
    case "translation":
      return PROFILES.translation;
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
