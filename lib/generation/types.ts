import type { FormValues, ToolConfig, ToolId } from "../types";
import type { SlideAudience, SlideTemplateId } from "./slide-templates";
import type { SlideModel, SlideThemeId } from "./slide-types";

export type GenImage = {
  id: string;
  url: string;
  alt?: string;
  w: number;
  h: number;
  /**
   * Haqiqiy MIME (`image/png` yoki `image/jpeg`).
   *
   * `url` aktivga chiqarilgandan keyin `/api/.../assets/<id>` ko'rinishiga
   * o'tadi va kengaytma yo'qoladi — ko'ruvchi yuklash nomini shundan
   * oladi, aks holda PNG ham `.jpg` nomi bilan tushardi.
   */
  mime?: string;
};

export type Block =
  | { kind: "p"; text: string }
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "li"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string; caption?: string; lang?: string };

export type DocSection = {
  id: string;
  title: string;
  blocks: Block[];
};

export type DocTable = {
  caption?: string;
  headers: string[];
  rows: string[][];
  /**
   * Shu `DocSection.id` dan KEYIN chizilsin.
   *
   * Ilgari barcha jadvallar hujjat oxirida, adabiyotlardan oldin
   * turardi. Dars rejasi va texnologik xaritada jadval — hujjatning
   * mazmuni, ilova emas: o'qituvchi darsni jadval bilan olib boradi.
   * Langar berilmasa eski xatti-harakat saqlanadi.
   */
  anchor?: string;
};

export type DocMeta = {
  toolId: ToolId;
  workLabel: string;
  topic: string;
  language: string;
  extra: string;
  /** «Fayl asosida» rejimida yuklangan hujjatdan olingan matn. */
  sourceText: string;
  author: string;
  university: string;
  faculty: string;
  department: string;
  subject: string;
  teacher: string;
  city: string;
  group: string;
  course: string;
  ministry: "oliy" | "maktab";
  kind: string;
  pagesLabel: string;
  targetPages: number;
  annotationLangs: "same" | "all";
  email: string;
  organization: string;
  degree: string;
  weeklyHours: number;
  totalHours: number;
  /** Glossariy: nechta atama so'ralsin (10/20/40). */
  termCount: number;
  grade: number;
  duration: number;
  fileNameHint: string;
  tocMethod: "ai" | "manual";
  tocText: string;
  includeVisuals: boolean;
  /** Slaydda titul slaydi bo'lsinmi. Formadagi belgi shu yerga tushadi. */
  titleSlide: boolean;
  /**
   * «Premium» paketlar tanlanganmi.
   *
   * Paketlar ikki o'lchovda farqlanadi: HAJM (`targetPages` — slaydlar soni)
   * va VIZUAL SIFAT (shu bayroq). Ilgari premium hech nimani o'zgartirmasdi.
   */
  premiumVisuals: boolean;
  /** Taqdimot kim uchun: himoya, ma'ruza, maktab darsi yoki pitch. */
  slideAudience?: SlideAudience;
  design: string;
  slideTheme?: SlideThemeId;
  slideTemplate?: SlideTemplateId;
  /**
   * Hujjat YARATILGAN yil — titul va «N–N+1 o'quv yili» shu yerdan.
   *
   * Ilgari `title-model.ts` uni `new Date()` dan olardi: DOCX baytlari
   * yaratilganda muzlar, sayt ko'ruvchisi esa har ochilganda qayta
   * hisoblardi. Yil chegarasida (dekabrda yaratilib, yanvarda ochilsa)
   * ekrandagi titul «2026», yuklab olingan fayl «2025» bo'lib ajralardi.
   * Endi yil `extractMeta` da bir marta muzlaydi.
   */
  year?: number;
};

export type AcademicDoc = {
  meta: DocMeta;
  titlePage: boolean;
  toc: boolean;
  sections: DocSection[];
  tables?: DocTable[];
  references?: string[];
  /**
   * Adabiyotlar ro'yxati tasdiqlanmagan bo'lsa ko'rsatiladigan izoh.
   * Uydirma muallif/DOI yozish o'rniga foydalanuvchi ogohlantiriladi.
   */
  referencesNote?: string;
  abstracts?: { lang: string; label: string; text: string; keywords: string }[];
  slideTheme?: SlideThemeId;
  slideTemplate?: SlideTemplateId;
  slides?: SlideModel[];
  images?: GenImage[];
  imagePrompt?: string;
  imageScene?: string;
  imageStyle?: string;
  imageRatio?: string;
};

export type BuiltFile = {
  html: string;
  bytes: Uint8Array;
  fileName: string;
  mime: string;
  doc: AcademicDoc;
  /**
   * Va'da qilinganning qanchasi yetkazildi.
   *
   * Berilgan va `got < want` bo'lsa worker farqni qaytaradi. Rasm
   * vositasi uchun kiritilgan: narx faqat SONGA bog'langan (4 ta = 6 000
   * tanga), yetkazish esa tekshirilmasdi — 4 tadan 1 tasi kelsa ham ish
   * `COMPLETED` bo'lib, pul to'liq yechilgan holida qolardi.
   *
   * Maydon ataylab universal: kelajakda slaydda «15 ta so'raldi, 12 tasi
   * chiqdi» holatiga ham shu mexanizm qo'llanadi.
   */
  delivered?: { got: number; want: number };
};

export type BuildCtx = {
  tool: ToolConfig;
  values: FormValues;
};
