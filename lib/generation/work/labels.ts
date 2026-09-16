/**
 * TALABA ISHI YORLIQLARI — uz/ru/en (AUDIT-19 WP-A).
 *
 * Bularni KOD yozadi, model emas: bob/paragraf sarlavhasi, «1.1-jadval»,
 * «1.1-rasm», «Manba:», ilova va kirish elementlarining nomlari hujjat
 * TILIGA ergashadi (interfeys tiliga emas — `i18n.ts` qoidasi).
 *
 * Nega alohida fayl: shu yorliqlarni UCH tomon o'qiydi — dvigatel
 * (`engine.ts` bo'lim sarlavhalari), hisobot (`review.ts` vizual havolasi)
 * va WP-C maketi (`work/layout.ts planWork`, `render-docx drawWork`).
 * Umumiy `i18n.ts sectionLabels` dagi «Kirish/Xulosa/Asosiy qism» shu
 * yerdan QAYTA ishlatiladi — takror yozilmaydi.
 */
import { docLabels, sectionLabels } from "../i18n";
import type { WorkIntroPartId } from "./types";

export type WorkLang = "uz" | "ru" | "en";

export function workLangKey(lang: string): WorkLang {
  const c = (lang || "uz").toLowerCase();
  return c === "ru" ? "ru" : c === "en" ? "en" : "uz";
}

export type WorkDocLabels = {
  lang: WorkLang;
  intro: string;
  conclusion: string;
  references: string;
  toc: string;
  /** «1-BOB.» / «ГЛАВА 1.» / «CHAPTER 1.» — bob sarlavhasi oldida. */
  chapterPrefix: (n: number) => string;
  /** «1.1.» — paragraf raqami. */
  paragraphPrefix: (chapter: number, paragraph: number) => string;
  /** «1-ILOVA» / «ПРИЛОЖЕНИЕ 1» / «APPENDIX 1». */
  appendix: (n: number) => string;
  /** «1.1-jadval» — jadval raqami (tepa o'ngda). */
  tableRef: (n: string) => string;
  /** «1.1-rasm» — rasm raqami (ostida, markazda). */
  figureRef: (n: string) => string;
  /** «Manba:» — jadval ostidagi va rasm ostidagi manba qatori. */
  source: string;
  /** «muallif tomonidan tuzilgan» — sxema/jadval manbasi. */
  byAuthor: string;
  /** Kirish elementlarining nomlari (hisobot bandi matni). */
  introPart: Record<WorkIntroPartId, string>;
};

const INTRO_PARTS: Record<WorkLang, Record<WorkIntroPartId, string>> = {
  uz: {
    relevance: "Mavzuning dolzarbligi",
    aim: "Ishning maqsadi",
    tasks: "Ish vazifalari",
    object: "Tadqiqot obyekti",
    subject: "Tadqiqot predmeti",
    methods: "Tadqiqot metodlari",
    structure: "Ish tuzilmasi",
    novelty: "Ilmiy yangilik",
    significance: "Amaliy ahamiyat",
  },
  ru: {
    relevance: "Актуальность темы",
    aim: "Цель работы",
    tasks: "Задачи работы",
    object: "Объект исследования",
    subject: "Предмет исследования",
    methods: "Методы исследования",
    structure: "Структура работы",
    novelty: "Научная новизна",
    significance: "Практическая значимость",
  },
  en: {
    relevance: "Relevance of the topic",
    aim: "Aim of the work",
    tasks: "Tasks of the work",
    object: "Object of the study",
    subject: "Subject of the study",
    methods: "Research methods",
    structure: "Structure of the work",
    novelty: "Scientific novelty",
    significance: "Practical significance",
  },
};

/*
 * Bob prefiksi ATAYLAB `i18n.ts sectionLabels().chapterPrefix` EMAS: u
 * rim raqamini beradi («I BOB.») — eski `write-llm` yo'lining shakli.
 * Talaba ishlari 2 standarti (BuxDU/TATU uslubiy ko'rsatmalari) ARAB
 * raqamini talab qiladi: «1-BOB. NOM», paragraf «1.1.».
 */
const CHAPTER: Record<WorkLang, (n: number) => string> = {
  uz: (n) => `${n}-BOB.`,
  ru: (n) => `ГЛАВА ${n}.`,
  en: (n) => `CHAPTER ${n}.`,
};

const APPENDIX: Record<WorkLang, (n: number) => string> = {
  uz: (n) => `${n}-ILOVA`,
  ru: (n) => `ПРИЛОЖЕНИЕ ${n}`,
  en: (n) => `APPENDIX ${n}`,
};

const TABLE_REF: Record<WorkLang, (n: string) => string> = {
  uz: (n) => `${n}-jadval`,
  ru: (n) => `Таблица ${n}`,
  en: (n) => `Table ${n}`,
};

const FIGURE_REF: Record<WorkLang, (n: string) => string> = {
  uz: (n) => `${n}-rasm`,
  ru: (n) => `Рис. ${n}`,
  en: (n) => `Fig. ${n}`,
};

const SOURCE: Record<WorkLang, string> = { uz: "Manba:", ru: "Источник:", en: "Source:" };
const BY_AUTHOR: Record<WorkLang, string> = { uz: "muallif tomonidan tuzilgan", ru: "составлено автором", en: "compiled by the author" };

export function workLabels(lang: string): WorkDocLabels {
  const k = workLangKey(lang);
  const S = sectionLabels(k);
  const D = docLabels(k);
  return {
    lang: k,
    intro: S.intro,
    conclusion: S.conclusion,
    references: D.references,
    toc: D.toc,
    chapterPrefix: CHAPTER[k],
    paragraphPrefix: (c, p) => `${c}.${p}.`,
    appendix: APPENDIX[k],
    tableRef: TABLE_REF[k],
    figureRef: FIGURE_REF[k],
    source: SOURCE[k],
    byAuthor: BY_AUTHOR[k],
    introPart: INTRO_PARTS[k],
  };
}
