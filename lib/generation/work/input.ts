/**
 * TALABA ISHI KIRISHI (AUDIT-19 WP-A) — formadan dvigatelgacha.
 *
 * `article/input.ts` naqshi: `FormValues` bilan `WorkInput` orasidagi
 * YAGONA ko'prik, ikki tomonga ishlaydi —
 *   • `workInputFromValues(values, genre)` — server (dvigatel, zond);
 *   • `encodeWorkValues(input)`           — klient (qoralama, forma).
 * Ikkalasi bitta faylda: JSON maydonlar shakli AYNAN mos bo'lishi kerak.
 *
 * Nega `DocMeta` dan o'qilmaydi: `extractMeta` (umumiy) `workKind`,
 * `subjectProfile`, `tableCount`, `refsMin`, `ministryCustom`,
 * `userRefs` ni bilmaydi va `ministry` uni ikki qiymatga siqadi —
 * normalizatsiya BITTA joyda tursin (maqolada ham shunday).
 *
 * Server importi YO'Q (izomorf).
 */
import type { FormValues } from "../../types";
import { splitCsv } from "../slide-params";
import { parseAuthorLine } from "../meta";
import { isSelectableFigureKind, type SelectableFigureKind } from "../types";
import { type ArticleUserRef } from "../article/input";
import { WORK_LIMITS, isWorkMinistryId, type SubjectProfileId, type WorkGenreId, type WorkKindId, type WorkMinistryId } from "./types";
import { normalizeWorkKind, normalizeWorkPages, pagesMid, workKindOf, type WorkKind } from "./registry";
import { SUBJECT_PROFILES, normalizeSubjectProfile } from "./subjects";

/* ────────────────────────── tiplar ────────────────────────── */

/** Qo'lda yozilgan reja: bob → paragraflar. */
export type WorkOutlineItem = { title: string; paragraphs: string[] };

export type WorkInput = {
  topic: string;
  genre: WorkGenreId;
  kind: WorkKindId;
  subject: SubjectProfileId;
  language: "uz" | "ru" | "en";
  /** Hajm paketi — `lib/tools.ts` chipi («25-30»). */
  pages: string;
  /* ── titul ── */
  university: string;
  faculty: string;
  department: string;
  /** Fan NOMI («Pedagogika») — «… fanidan KURS ISHI». */
  subjectName: string;
  group: string;
  course: string;
  author: string;
  teacher: string;
  teacherDegree: string;
  city: string;
  ministry: WorkMinistryId;
  ministryCustom: string;
  /* ── reja ── */
  tocMethod: "ai" | "manual";
  tocText: string;
  /** `tocText` dan o'qilgan reja; bo'sh bo'lsa dvigatel LLM bilan tuzadi. */
  outline: WorkOutlineItem[];
  /* ── vizuallar ── */
  includeVisuals: boolean;
  figureCount: number;
  figureKinds: SelectableFigureKind[];
  tableCount: number;
  /* ── materiallar ── */
  userFacts: string;
  sourceText: string;
  userRefs: ArticleUserRef[];
  refsMin: number;
  extra: string;
};

export const WORK_INPUT_LIMITS = {
  outlineChapters: WORK_LIMITS.chapters,
  outlineParagraphs: WORK_LIMITS.paragraphs,
  outlineTitleChars: 200,
  refsMinMax: 40,
} as const;

/* ────────────────────────── yordamchilar ────────────────────────── */

const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : typeof v === "number" ? String(v) : "";
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const bool = (v: unknown, fallback: boolean): boolean => (v === undefined || v === null || v === "" ? fallback : v !== false && v !== "no" && v !== "false" && v !== 0 && v !== "0");
const num = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = Number(v);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? Math.round(n) : fallback));
};

function isLang(v: string): v is "uz" | "ru" | "en" {
  return v === "uz" || v === "ru" || v === "en";
}

/* ────────────────────────── qo'lda yozilgan reja ────────────────────────── */

/*
 * Nega `quality.ts parseManualOutline` EMAS: u «1-BOB. Nazariy asoslar»
 * qatorining sarlavhasidan «1» ni olib tashlab «-BOB. …» qoldiradi
 * (`^\d+(\.\d+)*[.)]?` qolipi «-» ni kutmaydi) va «1.1.» ni faqat
 * INDENT bilan birga paragraf deb tanidi. Talaba ishida esa mundarija
 * aynan shu ikki shaklda yoziladi — shuning uchun o'z parseri.
 */

/** «1-BOB.», «I BOB», «ГЛАВА 2», «CHAPTER 3», «2-bob» — bob sarlavhasi. */
const CHAPTER_RE = /^(?:(\d{1,2})\s*[-–—]?\s*(?:bob|bo['`‘’]lim)|(?:глава|chapter)\s*(\d{1,2})|([IVXLC]{1,5})\s*[-–—]?\s*(?:bob|глава|chapter))\b\s*[.):]?\s*/i;
/** «1.1.», «2.3 » — paragraf. */
const PARAGRAPH_RE = /^(\d{1,2})\.(\d{1,2})\.?\s*/;
/** Oddiy raqamlangan bob: «1. Nom», «2) Nom». */
const PLAIN_CHAPTER_RE = /^(\d{1,2})\s*[.)]\s+/;

/** Reja matnida bob/paragraf HISOBLANMAYDIGAN qatorlar. */
const TOC_SKIP_RE =
  /^(kirish|xulosa|mundarija|reja|adabiyotlar|foydalanilgan\s+adabiyotlar|ilova|ilovalar|введение|заключение|содержание|оглавление|план|список\s+литературы|литература|приложени|intro(duction)?|conclusion|contents?|table\s+of\s+contents|references|bibliography|appendix)\b/i;

/**
 * Reja matni → bob/paragraf daraxti. Qoidalar:
 *   • «1.1.» bilan boshlangan qator — oxirgi bobning paragrafi;
 *   • «1-BOB.» / «I BOB» / «ГЛАВА 1» / «1. Nom» — yangi bob;
 *   • ikki probel (yoki tab) chekinish — paragraf;
 *   • «Kirish/Xulosa/Adabiyotlar/Ilova» — o'tkazib yuboriladi (ular
 *     skeletda bor, bob emas).
 */
export function parseWorkOutline(raw: unknown): WorkOutlineItem[] {
  const src = text(raw, WORK_LIMITS.tocChars);
  if (!src) return [];
  const out: WorkOutlineItem[] = [];
  for (const line of src.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const indent = (line.match(/^[ \t]*/)?.[0] ?? "").replace(/\t/g, "  ").length;
    const body = line.trim().replace(/^[-*•]\s*/, "").trim();
    if (!body || body.length > WORK_INPUT_LIMITS.outlineTitleChars) continue;
    if (TOC_SKIP_RE.test(body)) continue;

    const para = PARAGRAPH_RE.exec(body);
    if (para) {
      const title = cleanOutlineTitle(body.slice(para[0].length));
      if (!title) continue;
      const chapter = out[out.length - 1] ?? pushChapter(out, `${para[1]}-bob`);
      if (chapter.paragraphs.length < WORK_INPUT_LIMITS.outlineParagraphs) chapter.paragraphs.push(title);
      continue;
    }
    const chap = CHAPTER_RE.exec(body) ?? PLAIN_CHAPTER_RE.exec(body);
    if (chap) {
      const title = cleanOutlineTitle(body.slice(chap[0].length));
      if (title) pushChapter(out, title);
      continue;
    }
    // Raqamsiz qator: chekinish bo'lsa paragraf, aks holda bob.
    const title = cleanOutlineTitle(body);
    if (!title) continue;
    if (indent >= 2 && out.length) {
      const chapter = out[out.length - 1];
      if (chapter.paragraphs.length < WORK_INPUT_LIMITS.outlineParagraphs) chapter.paragraphs.push(title);
    } else pushChapter(out, title);
  }
  return out.filter((c) => c.title.length >= 3).slice(0, WORK_INPUT_LIMITS.outlineChapters);
}

function pushChapter(out: WorkOutlineItem[], title: string): WorkOutlineItem {
  const item: WorkOutlineItem = { title, paragraphs: [] };
  if (out.length < WORK_INPUT_LIMITS.outlineChapters) out.push(item);
  return out[out.length - 1] ?? item;
}

/** Sarlavhadagi ortiqcha nuqta/tire/sahifa raqamini olib tashlaydi («… 12» → «…»). */
function cleanOutlineTitle(raw: string): string {
  return raw
    .replace(/\.{2,}\s*\d{0,4}\s*$/, "")
    .replace(/\s+\d{1,4}\s*$/, "")
    .replace(/^[.):\-–—\s]+/, "")
    .replace(/[\s.;,–—-]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, WORK_INPUT_LIMITS.outlineTitleChars);
}

/* ────────────────────────── JSON maydonlar ────────────────────────── */

/**
 * Kesilgan/buzuq JSON ga chidamlilik — `parseArticleJson` bilan bir
 * qaror (`sanitizeValues` maydonni 24 000 belgiga kesadi).
 */
export function parseWorkJson(raw: unknown, field: string): unknown {
  if (raw && typeof raw === "object") return raw;
  const t = String(raw ?? "").trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    /* pastda tiklanadi */
  }
  const cut = t.lastIndexOf("}");
  if (cut > 0) {
    const head = t.slice(0, cut + 1);
    const candidates = t.startsWith("[") ? [`${head}]`, head] : t.startsWith("{") ? [`${head}}`, head] : [head];
    for (const candidate of candidates) {
      try {
        const v = JSON.parse(candidate);
        console.warn(`[work] «${field}» JSON kesilgan (${t.length} belgi) — ${candidate.length} belgigacha tiklandi`);
        return v;
      } catch {
        /* keyingi nomzod */
      }
    }
  }
  console.warn(`[work] «${field}» JSON o'qib bo'lmadi (${t.length} belgi) — bo'sh qoldirildi`);
  return null;
}

function jsonRows(values: FormValues, field: string): Record<string, unknown>[] {
  const v = parseWorkJson(values[field], field);
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object" && !Array.isArray(x));
}

/**
 * Foydalanuvchi manbalari — MAQOLA bilan bir xil SHAKLDA
 * (`ArticleUserRef`: `u1`, `u2` … id, DOI/ISBN/erkin matn), chunki
 * `research/pipeline.ts` va `cite/*` aynan shu tipni kutadi.
 * `article/input.ts` dagi qator parseri eksport qilinmagan — shakl bir
 * xil, ISBN qo'shilgan (darslik/monografiya, WP-B `googlebooks.ts`).
 */
export function parseWorkUserRefs(values: FormValues): ArticleUserRef[] {
  const rows = jsonRows(values, "userRefs");
  if (!rows.length) return [];
  const out: ArticleUserRef[] = [];
  for (const row of rows) {
    if (out.length >= WORK_LIMITS.userRefs) break;
    const doi = normalizeDoiLike(row.doi ?? row.DOI);
    const rawText = text(row.raw ?? row.text, 400).replace(/\s+/g, " ");
    const title = str(row.title, 300);
    const doiInRaw = !doi && rawText ? normalizeDoiLike(rawText.match(/10\.\d{4,9}\/\S+/)?.[0]) : "";
    const isbn = String(row.isbn ?? "").replace(/[^0-9Xx]/g, "");
    const finalDoi = doi || doiInRaw;
    if (!finalDoi && !rawText && !title && !isbn) continue;
    const r: ArticleUserRef = { id: `u${out.length + 1}` };
    if (finalDoi) r.doi = finalDoi;
    if (rawText) r.raw = rawText;
    if (title) r.title = title;
    const authors = Array.isArray(row.authors)
      ? row.authors.map((a) => str(a, 120)).filter(Boolean).slice(0, 10)
      : typeof row.authors === "string"
        ? splitCsv(row.authors, 10, 120)
        : [];
    if (authors.length) r.authors = authors;
    const year = Number(row.year);
    if (Number.isInteger(year) && year >= 1800 && year <= 2100) r.year = year;
    const venue = str(row.venue ?? row.journal, 300);
    if (venue) r.venue = venue;
    const url = str(row.url, 300);
    if (/^https?:\/\//i.test(url)) r.url = url;
    out.push(r);
  }
  return out;
}

function normalizeDoiLike(raw: unknown): string {
  const t = String(raw ?? "")
    .trim()
    .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi\s*:?\s*/i, "")
    .trim();
  return /^10\.\d{4,9}\/\S+$/i.test(t) ? t.replace(/[.,;)\]]+$/, "") : "";
}

/** «Sxema turlari» — JSON massiv yoki CSV; faqat tanlanadigan turlar. */
export function parseWorkFigureKinds(raw: unknown): SelectableFigureKind[] {
  let list: string[] = [];
  if (Array.isArray(raw)) list = raw.map((x) => str(x, 20));
  else if (typeof raw === "string" && raw.trim()) {
    const t = raw.trim();
    if (t.startsWith("[")) {
      const v = parseWorkJson(t, "figureKinds");
      list = Array.isArray(v) ? v.map((x) => str(x, 20)) : [];
    } else list = splitCsv(t, 9, 20);
  }
  const out: SelectableFigureKind[] = [];
  for (const k of list) if (isSelectableFigureKind(k) && !out.includes(k)) out.push(k);
  return out.slice(0, 9);
}

/* ────────────────────────── forma → kirish ────────────────────────── */

/**
 * Paketga sig'adigan vizual soni: 10 betli ishga 6 sxema sig'maydi
 * (har biri ≈0,45 bet). Chegara — har 10 betga 2 vizual, `WORK_LIMITS`
 * gacha.
 */
export function maxVisualsFor(pages: string): number {
  return Math.max(1, Math.min(WORK_LIMITS.figures, Math.round(pagesMid(pages) / 5)));
}

export function workInputFromValues(values: FormValues, genre: WorkGenreId): WorkInput {
  const kindId = normalizeWorkKind(genre, values.workKind ?? values.kind);
  const kind = workKindOf(genre, kindId);
  const subject = normalizeSubjectProfile(values.subjectProfile);
  const pages = normalizeWorkPages(kind, values.pages);
  const langRaw = str(values.language, 8).toLowerCase();
  const F = WORK_LIMITS.titleFieldChars;

  // Muallif satri: «Aliyev Ali — 3-kurs, 301-guruh» → ism + kurs + guruh.
  const authorLine = str(values.author, F);
  const parsed = parseAuthorLine(authorLine);
  const ministryRaw = str(values.ministry, 20);
  const ministry: WorkMinistryId = isWorkMinistryId(ministryRaw) ? ministryRaw : "oliy";
  const ministryCustom = text(values.ministryCustom, WORK_LIMITS.ministryChars);

  const tocMethod = str(values.tocMethod, 10) === "manual" ? "manual" : "ai";
  /*
   * Reja MATN hal qiladi, bayroq emas (`structure.ts manualOutlineOf`
   * saboqi): foydalanuvchi rejani yozib, chipsni almashtirmasa ham u
   * ishlatiladi. `manual` rejimida esa `extra` ga qaytiladi (eski xulq).
   */
  const tocText = text(values.tocText, WORK_LIMITS.tocChars) || (tocMethod === "manual" ? text(values.extra, WORK_LIMITS.tocChars) : "");
  const outline = parseWorkOutline(tocText);

  const includeVisuals = bool(values.includeVisuals ?? (values.images === undefined ? undefined : values.images !== "no"), true);
  const defaults = SUBJECT_PROFILES[subject].defaultVisuals;
  const cap = maxVisualsFor(pages);
  const figureCount = includeVisuals ? num(values.figureCount ?? defaults.figures, defaults.figures, 0, cap) : 0;
  const tableCount = includeVisuals ? num(values.tableCount ?? defaults.tables, defaults.tables, 0, Math.min(WORK_LIMITS.tables, cap)) : 0;

  return {
    topic: str(values.topic, WORK_LIMITS.topicChars),
    genre,
    kind: kindId,
    subject,
    language: isLang(langRaw) ? langRaw : "uz",
    pages,
    university: str(values.university, F),
    faculty: str(values.faculty, F),
    department: str(values.department, F),
    subjectName: str(values.subjectName ?? values.subject, F),
    group: str(values.group, 40) || parsed.group,
    course: str(values.course, 40) || parsed.course,
    author: parsed.name || authorLine,
    teacher: str(values.teacher, F),
    teacherDegree: str(values.teacherDegree, 80),
    city: str(values.city, 80),
    ministry,
    ministryCustom: ministry === "custom" ? ministryCustom : "",
    tocMethod,
    tocText,
    outline,
    includeVisuals,
    figureCount,
    figureKinds: parseWorkFigureKinds(values.figureKinds),
    tableCount,
    userFacts: text(values.userFacts, WORK_LIMITS.userFactsChars),
    sourceText: text(values.sourceText, WORK_LIMITS.sourceTextChars),
    userRefs: parseWorkUserRefs(values),
    refsMin: num(values.refsMin ?? kind.refsMin, kind.refsMin, 0, WORK_INPUT_LIMITS.refsMinMax),
    extra: text(values.extra, WORK_LIMITS.extraChars),
  };
}

/** Klient uchun teskari yo'l — forma holatidan `FormValues` (qoralama). */
export function encodeWorkValues(input: WorkInput): FormValues {
  const out: FormValues = {
    topic: input.topic,
    workKind: input.kind,
    subjectProfile: input.subject,
    language: input.language,
    pages: input.pages,
    university: input.university,
    faculty: input.faculty,
    department: input.department,
    subjectName: input.subjectName,
    group: input.group,
    course: input.course,
    author: input.author,
    teacher: input.teacher,
    teacherDegree: input.teacherDegree,
    city: input.city,
    ministry: input.ministry,
    tocMethod: input.tocMethod,
    tocText: input.tocText,
    includeVisuals: input.includeVisuals,
    figureCount: input.figureCount,
    figureKinds: JSON.stringify(input.figureKinds),
    tableCount: input.tableCount,
    userFacts: input.userFacts,
    userRefs: JSON.stringify(input.userRefs.map((r) => { const { id, ...rest } = r; void id; return rest; })),
    refsMin: input.refsMin,
    extra: input.extra,
  };
  if (input.ministryCustom) out.ministryCustom = input.ministryCustom;
  if (input.sourceText) out.sourceText = input.sourceText;
  return out;
}

/** Forma/zond uchun: janr × tur obyektini bitta joydan olish. */
export function workKindFromValues(values: FormValues, genre: WorkGenreId): WorkKind {
  return workKindOf(genre, values.workKind ?? values.kind);
}
