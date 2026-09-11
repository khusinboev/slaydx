/**
 * Maqola bo'lim yorliqlari — uz/ru/en (Maqola 2). Kod yozadi, model emas:
 * skelet sarlavhalari hujjat tiliga ergashadi. `three_part_uz`/sharhdagi
 * erkin bo'limlar nomini model beradi (`body` — o'rinbosar).
 */
import type { SectionKey } from "./types";

type L = Record<SectionKey, string>;

const UZ: L = {
  intro: "Kirish",
  litreview: "Adabiyotlar tahlili",
  litreview_methods: "Adabiyotlar tahlili va metodlar",
  methods: "Tadqiqot metodologiyasi",
  results: "Natijalar",
  results_methods: "Metodlar va natijalar",
  discussion: "Muhokama",
  conclusion: "Xulosa",
  main: "Asosiy qism",
  synthesis: "Sintez va tadqiqot bo‘shliqlari",
  future: "Kelajak yo‘nalishlari",
  protocol: "Protokol va ro‘yxatga olish",
  eligibility: "Tanlash mezonlari",
  sources: "Axborot manbalari",
  search: "Qidiruv strategiyasi",
  selection: "Tanlash jarayoni",
  bias: "Tarafkashlik xavfi",
  patient: "Bemor / obyekt ma’lumoti",
  findings: "Kuzatuvlar",
  timeline: "Vaqt jadvali (Timeline)",
  diagnostic: "Diagnostik baholash",
  intervention: "Aralashuv",
  outcome: "Natija va kuzatuv",
  perspective: "Ishtirokchi nuqtai nazari",
  consent: "Xabardor rozilik",
  theory: "Nazariy asos",
  procedure: "Metodika bayoni",
  example: "Qo‘llash namunasi",
  evaluation: "Samaradorlikni baholash",
  recommendations: "Tavsiyalar",
  object: "Tahlil obyekti va axborot bazasi",
  analysis: "Tahlil",
  problems: "Aniqlangan muammolar",
  solutions: "Yechim va tavsiyalar",
  body: "Asosiy qism",
};

const RU: L = {
  intro: "Введение",
  litreview: "Обзор литературы",
  litreview_methods: "Обзор литературы и методы",
  methods: "Методология исследования",
  results: "Результаты",
  results_methods: "Методы и результаты",
  discussion: "Обсуждение",
  conclusion: "Заключение",
  main: "Основная часть",
  synthesis: "Синтез и пробелы исследований",
  future: "Направления будущих исследований",
  protocol: "Протокол и регистрация",
  eligibility: "Критерии отбора",
  sources: "Источники информации",
  search: "Стратегия поиска",
  selection: "Процесс отбора",
  bias: "Риск систематической ошибки",
  patient: "Информация о пациенте / объекте",
  findings: "Клинические находки",
  timeline: "Хронология (Timeline)",
  diagnostic: "Диагностическая оценка",
  intervention: "Вмешательство",
  outcome: "Исход и наблюдение",
  perspective: "Точка зрения участника",
  consent: "Информированное согласие",
  theory: "Теоретическая основа",
  procedure: "Описание методики",
  example: "Пример применения",
  evaluation: "Оценка эффективности",
  recommendations: "Рекомендации",
  object: "Объект анализа и информационная база",
  analysis: "Анализ",
  problems: "Выявленные проблемы",
  solutions: "Решения и рекомендации",
  body: "Основная часть",
};

const EN: L = {
  intro: "Introduction",
  litreview: "Literature review",
  litreview_methods: "Literature review and methods",
  methods: "Methods",
  results: "Results",
  results_methods: "Methods and results",
  discussion: "Discussion",
  conclusion: "Conclusion",
  main: "Main body",
  synthesis: "Synthesis and research gaps",
  future: "Future directions",
  protocol: "Protocol and registration",
  eligibility: "Eligibility criteria",
  sources: "Information sources",
  search: "Search strategy",
  selection: "Selection process",
  bias: "Risk of bias",
  patient: "Patient / case information",
  findings: "Clinical findings",
  timeline: "Timeline",
  diagnostic: "Diagnostic assessment",
  intervention: "Therapeutic intervention",
  outcome: "Follow-up and outcomes",
  perspective: "Patient perspective",
  consent: "Informed consent",
  theory: "Theoretical background",
  procedure: "Method description",
  example: "Worked example",
  evaluation: "Effectiveness evaluation",
  recommendations: "Recommendations",
  object: "Object of analysis and data",
  analysis: "Analysis",
  problems: "Identified problems",
  solutions: "Solutions and recommendations",
  body: "Main body",
};

export type ArticleDocLabels = {
  section: L;
  abstract: string;
  keywords: string;
  references: string;
  referencesEnglish: string;
  highlights: string;
  figure: (n: string) => string;
  table: (n: string) => string;
  /** «(1-rasm)» / «(Figure 1)» — matndagi havola. */
  figureRef: (n: string) => string;
  tableRef: (n: string) => string;
  udk: string;
  /** Structured abstract sarlavhalari. */
  structured: { background: string; methods: string; results: string; conclusions: string };
};

const DOC: Record<"uz" | "ru" | "en", ArticleDocLabels> = {
  uz: {
    section: UZ,
    abstract: "Annotatsiya",
    keywords: "Kalit so‘zlar",
    references: "Foydalanilgan adabiyotlar",
    referencesEnglish: "REFERENCES",
    highlights: "Asosiy natijalar",
    figure: (n) => `${n}-rasm.`,
    table: (n) => `${n}-jadval.`,
    figureRef: (n) => `${n}-rasm`,
    tableRef: (n) => `${n}-jadval`,
    udk: "UDK",
    structured: { background: "Maqsad", methods: "Metodlar", results: "Natijalar", conclusions: "Xulosa" },
  },
  ru: {
    section: RU,
    abstract: "Аннотация",
    keywords: "Ключевые слова",
    references: "Список использованной литературы",
    referencesEnglish: "REFERENCES",
    highlights: "Основные результаты",
    figure: (n) => `Рис. ${n}.`,
    table: (n) => `Таблица ${n}.`,
    figureRef: (n) => `рис. ${n}`,
    tableRef: (n) => `табл. ${n}`,
    udk: "УДК",
    structured: { background: "Цель", methods: "Методы", results: "Результаты", conclusions: "Выводы" },
  },
  en: {
    section: EN,
    abstract: "Abstract",
    keywords: "Keywords",
    references: "References",
    referencesEnglish: "REFERENCES",
    highlights: "Highlights",
    figure: (n) => `Figure ${n}.`,
    table: (n) => `Table ${n}.`,
    figureRef: (n) => `Figure ${n}`,
    tableRef: (n) => `Table ${n}`,
    udk: "UDC",
    structured: { background: "Background", methods: "Methods", results: "Results", conclusions: "Conclusions" },
  },
};

export function articleLabels(language: string): ArticleDocLabels {
  const c = (language || "uz").toLowerCase();
  return c === "ru" ? DOC.ru : c === "en" ? DOC.en : DOC.uz;
}

/** Annotatsiya blokining o'z tilidagi yorlig'i («Annotatsiya» / «Аннотация» / «Abstract»). */
export function abstractLabel(lang: string): string {
  return articleLabels(lang).abstract;
}
