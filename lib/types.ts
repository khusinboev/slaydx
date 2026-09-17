import type { AcademicDoc, Delivered } from "./generation/types";

export type ToolId =
  | "slide"
  | "pro-slide"
  | "coursework"
  | "referat"
  | "essay"
  | "article"
  | "resume"
  | "thesis"
  | "translation"
  | "image"
  | "texnologik-xarita"
  | "glossary"
  | "keys"
  | "mustaqil-ish"
  | "lesson-plan"
  /** Test yaratuvchi (AUDIT-20) — `teacher/` dvigateli, `custom: "teacher"`. */
  | "test"
  /*
   * 2-dastur (AUDIT-21): bosma o'yinlar va infografika.
   *
   * `crossword`/`flashcards` — `games/` dvigateli, `ToolGroup "oyinlar"`,
   * chiqish DOCX; `infographic` — `infographic/` dvigateli, o'qituvchi
   * bo'limida, chiqish PNG (plakat). Uchalasi ham STANDART formada
   * (`custom` yo'q) — maydonlar orasida bog'liqlik yo'q, `StandardForm`
   * yetarli (AUDIT-20 §3 rejasi).
   */
  | "crossword"
  | "flashcards"
  | "infographic"
  /*
   * 3-dastur (AUDIT-22): interaktiv o'yinlar va audio.
   *
   * `sorting`/`listening` — `games/` dvigateli (bosma DOCX + ochiq
   * havolali o'yinchi tomoni, `app/o/[token]`); `podcast`/`greeting` —
   * `audio/` dvigateli, chiqish MP3 (`ToolGroup "media"`). To'rtalasi
   * ham STANDART formada (`custom` yo'q).
   */
  | "sorting"
  | "listening"
  | "podcast"
  | "greeting";

/**
 * Bo'lim (landing, nav, `CreateGrid`).
 *
 * `oyinlar` — AUDIT-21/22 bo'limi: krossvord, flesh kartalar, saralash,
 * tinglash. `media` — AUDIT-22: podkast va tabriknoma (chiqish MP3);
 * ilgari u e'lon qilingan-u bo'sh edi va `visibleToolGroups` uni
 * chizmasdi, endi ikkita vositasi bor.
 */
export type ToolGroup = "umumiy" | "talaba" | "oqituvchi" | "oyinlar" | "media";

export type JobStatus = "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "REVOKED";

export type FieldKind =
  | "text"
  | "textarea"
  | "email"
  | "number"
  | "chips"
  | "language"
  | "range"
  | "design"
  | "toggle"
  | "file";

export type FieldOption = {
  value: string;
  label: string;
  hint?: string;
};

export type ToolField = {
  kind: FieldKind;
  name: string;
  legend: string;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  options?: FieldOption[];
  min?: number;
  max?: number;
  suffix?: string;
  accept?: string;
  extra?: boolean;
  /**
   * Shartli yashirish (deklarativ — `ToolConfig` server↔klient chegarasidan
   * o'tadi, funksiya bo'lmaydi): `field` ning qiymati `values` ichida bo'lsa
   * maydon CHIZILMAYDI. «Bezak maydon yo'q» qoidasi: parametr biror turda
   * natijaga ta'sir qilmasa (masalan saralashda «qarama-qarshi juftlik»
   * toifa sonini 2 ga qulflaydi), u shu turda ko'rinmasligi kerak.
   */
  hideWhen?: { field: string; values: readonly string[] };
};

export type ToolMode = {
  /*
   * `text` — AUDIT-22 (podkast): foydalanuvchi TAYYOR matn (maqola,
   * xabar, o'z yozgani) beradi va ssenariy shundan tuziladi
   * (`podcast.md` §3 `mode` qatori). Fayl rejimidan farqi — ekstraksiya
   * yo'q, matn to'g'ridan-to'g'ri formadan keladi (`sourceText`).
   */
  id: "topic" | "file" | "text";
  title: string;
  hint: string;
};

export type ToolConfig = {
  id: ToolId;
  slug: string;
  title: string;
  pageTitle: string;
  group: ToolGroup;
  icon: string;
  tc: string;
  description: string;
  submitLabel: string;
  creatingLabel: string;
  createdLabel: string;
  topicLegend?: string;
  topicPlaceholder?: string;
  topicExamples?: string[];
  modes?: ToolMode[];
  fields: ToolField[];
  extraOptional?: boolean;
  /**
   * Chiqish FORMATI.
   *
   * `mp3` — AUDIT-22 (podkast, tabriknoma): hujjat emas, AUDIO. Shu
   * qiymat `Generation.format` ga ko'chadi (`/api/generations`), ya'ni
   * ko'ruvchi (`AudioViewer`) va yuklash tugmasi to'g'ri kengaytmani
   * ko'radi.
   */
  output: "docx" | "pptx" | "png" | "mp3";
  custom?: "slide" | "pro-slide" | "resume" | "translation" | "image" | "article" | "essay" | "work" | "teacher";
  basePrice: number;
};

export type FormValues = Record<string, string | number | boolean | null>;

export type Generation = {
  id: string;
  type: ToolId;
  topic: string;
  status: JobStatus;
  createdAt: string;
  finishedAt?: string;
  price: number;
  values: FormValues;
  html: string;
  fileName: string;
  /**
   * Yuklab olinadigan faylning haqiqiy formati.
   *
   * Navbatga qo'yishda `tool.output` dan olinadi, yakunlashda esa
   * haqiqiy fayl nomiga moslanadi (bir nechta rasm — `zip`).
   * `pdf` — talab bo'yicha o'girish natijasi, saqlanadigan format emas.
   *
   * `xlsx | txt | md | csv` — Tarjimon 2: tarjimaning chiqish formati
   * KIRISH formatiga teng, ya'ni XLSX yuklagan foydalanuvchi XLSX oladi.
   * Ilgari ro'yxatda faqat `docx|pptx` bor edi va `formatOf` qaytargan
   * haqiqiy kengaytma tipga sig'masdi.
   */
  format: "docx" | "pptx" | "png" | "jpg" | "zip" | "xlsx" | "txt" | "md" | "csv" | "mp3";
  progress: number;
  step: string;
  doc?: AcademicDoc;
  /**
   * Va'da qilinganidan kam yetkazilgan bo'lsa (AUDIT-6 C7).
   *
   * Ilgari bu faqat qisman qaytarish tranzaksiyasining IZOHIDA
   * qolardi — natija sahifasi "Tayyor" deb ko'rsatar, foydalanuvchi
   * nega kam rasm/qator kelganini bilmasdi.
   */
  delivered?: Delivered;
};

export type UserProfile = {
  name: string;
  language: string;
  points: number;
  quota: number;
  balance: number;
  premium: boolean;
  plan: "free" | "pro";
  university: string;
  faculty: string;
  department: string;
  group: string;
  course: string;
  author: string;
  subject: string;
  teacher: string;
  city: string;
  /** Slayd formasi: lavozim va tashkilot — profilda saqlanadi (Formalar 2). */
  position: string;
  organization: string;
};
