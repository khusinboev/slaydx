import type { FormValues, ToolConfig, ToolId } from "../types";
import type { SlideAudience, SlideTemplateId } from "./slide-templates";
import type { SlideModel, SlideThemeId } from "./slide-types";

export type GenImage = {
  id: string;
  url: string;
  alt?: string;
  w: number;
  h: number;
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
};

export type BuildCtx = {
  tool: ToolConfig;
  values: FormValues;
};
