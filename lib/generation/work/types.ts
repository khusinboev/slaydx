/**
 * TALABA ISHLARI 2 (AUDIT-19, WP-A) — kurs ishi / referat / mustaqil ish
 * TIPLARI. Izomorf: server/DOM/sharp importi YO'Q.
 *
 * Yagona manba qarori (maqola naqshi, `article/types.ts`): MATN
 * `AcademicDoc.sections` da TEKIS qoladi — bob `h1` bo'lim (`id: "ch1"`),
 * har paragraf ALOHIDA `DocSection` (`id: "ch1.1"`), kirish `intro`,
 * xulosa `conclusion`, ilova `appendix-1…`. Shu tanlov tufayli
 * `paginate.ts`, `guardSection`, `verifyCitations`, `report/*` va tahrir
 * oplari o'zgarishsiz ishlaydi. Bu yerdagi `WorkModel` esa
 * METAMA'LUMOT: janr/tur/fan profili, titul maydonlari, bob→paragraf
 * daraxti, kirish elementlari, TEKSHIRILGAN manbalar, sxemalar, hisobot.
 *
 * Tartib va RAQAMLASH (`1-BOB.`, `1.1.`, `1.1-jadval`, `1.1-rasm`,
 * `(1.1)`, `1-ILOVA`) bu yerda YO'Q — uni `work/layout.ts planWork`
 * (WP-C) beradi: DOCX va ko'ruvchi ikkalasi undan o'qiydi.
 */
import type { DocReview } from "../report/types";
import type { Figure, Reference } from "../article/types";

/* ────────────────────────── janr va tur ────────────────────────── */

export const WORK_GENRE_IDS = ["coursework", "referat", "independent"] as const;
export type WorkGenreId = (typeof WORK_GENRE_IDS)[number];

/**
 * Tur (janr ichida):
 *   coursework  — `theory` (nazariy), `applied` (amaliy-hisob, tajriba
 *                 qismi bilan), `project` (kurs loyihasi: chizma, hisob);
 *   referat     — `informative` (manba mazmunining qisqa bayoni),
 *                 `analytic` (tahliliy-taqqoslovchi), `evaluative`
 *                 (baholovchi), `report` (DOKLAD — 3 qism, sxema/jadval);
 *   independent — `written` (yozma; taqdimot/buklet/test — keyingi sprint).
 */
export const WORK_KIND_IDS = ["theory", "applied", "project", "informative", "analytic", "evaluative", "report", "written"] as const;
export type WorkKindId = (typeof WORK_KIND_IDS)[number];

/** Fan profili — hajm/tuzilma emas, YOZISH va MANBA qoidalarini o'zgartiradi. */
export const SUBJECT_PROFILE_IDS = ["technical", "natural", "economic", "humanities", "legal"] as const;
export type SubjectProfileId = (typeof SUBJECT_PROFILE_IDS)[number];

/** Manba turi — `research` kvotasi va O'zbekiston ro'yxat tartibi uchun. */
export type WorkRefKind = "article" | "book" | "law" | "web" | "user";
export const WORK_REF_KINDS: readonly WorkRefKind[] = ["law", "book", "article", "web", "user"];

/* ────────────────────────── kirish elementlari ────────────────────────── */

/**
 * Kirishning MAJBURIY elementlari (BuxDU/TATU/TDIU uslubiy ko'rsatmalari):
 * kurs ishida 7 ta (`relevance`…`structure`), referatda 3 ta, mustaqil
 * ishda 4 ta; `novelty`/`significance` — gumanitar profilning kengaytirilgan
 * kirishi. Ro'yxat REYESTRDA (`registry.ts introParts`), bu yerda faqat
 * mumkin bo'lgan qiymatlar to'plami.
 */
export const WORK_INTRO_PART_IDS = ["relevance", "aim", "tasks", "object", "subject", "methods", "structure", "novelty", "significance"] as const;
export type WorkIntroPartId = (typeof WORK_INTRO_PART_IDS)[number];

export const isWorkIntroPartId = (v: unknown): v is WorkIntroPartId => (WORK_INTRO_PART_IDS as readonly string[]).includes(String(v));

/* ────────────────────────── bob → paragraf ────────────────────────── */

export type WorkParagraph = {
  /** `ch1.1` — `DocSection.id` bilan AYNI (tahrir yo'llari, darvozalar). */
  id: string;
  title: string;
  /**
   * Matn qaysi `DocSection` da — hozircha doim `id` ning o'zi. Alohida
   * maydon: WP-C maketi paragrafni boshqa bo'limga ko'chirishi mumkin
   * (masalan bitta paragrafli bob), model esa bunda buzilmasin.
   */
  sectionId: string;
};

export type WorkChapter = {
  /** `ch1` — sarlavha bo'limining `DocSection.id` si. */
  id: string;
  title: string;
  paragraphs: WorkParagraph[];
};

/* ────────────────────────── titul ────────────────────────── */

/**
 * Vazirlik: `oliy` — «Oliy ta'lim, fan va innovatsiyalar vazirligi»,
 * `maktab` — «Maktabgacha va maktab ta'limi vazirligi», `custom` —
 * foydalanuvchi o'z matnini yozadi (TATU'da ikkinchi vazirlik qatori ham
 * bo'ladi). Eski `DocMeta.ministry` faqat ikki qiymatli — shuning uchun
 * uchinchisi MODELDA saqlanadi (`WorkModel.ministry`).
 */
export const WORK_MINISTRY_IDS = ["oliy", "maktab", "custom"] as const;
export type WorkMinistryId = (typeof WORK_MINISTRY_IDS)[number];

export const isWorkMinistryId = (v: unknown): v is WorkMinistryId => (WORK_MINISTRY_IDS as readonly string[]).includes(String(v));

/** Titul sahifasining 9 maydoni (+ ixtiyoriylar) — `title-model.ts` (WP-C) o'qiydi. */
export type WorkTitleFields = {
  university: string;
  faculty: string;
  department: string;
  /** «FAN» fanidan KURS ISHI — fan NOMI (`DocMeta.subject`). */
  subjectName: string;
  group: string;
  course: string;
  author: string;
  teacher: string;
  teacherDegree?: string;
  city: string;
  ministry: WorkMinistryId;
  /** `ministry === "custom"` bo'lganda — foydalanuvchi matni (1–2 qator). */
  ministryCustom?: string;
};

/* ────────────────────────── model ────────────────────────── */

export type WorkModel = WorkTitleFields & {
  v: 1;
  genre: WorkGenreId;
  kind: WorkKindId;
  subject: SubjectProfileId;
  /** Hujjat tili (uz/ru/en) — yorliqlar shunga ergashadi. */
  language: string;
  /** Mavzu (titul sarlavhasi); berilmasa `doc.meta.topic`. */
  title?: string;
  chapters: WorkChapter[];
  /**
   * Kirish elementlari: qaysi majburiy element MATNDA topildi
   * (`guard.ts intakeCheck`). Hisobot `introParts` bandi shu yerdan
   * o'qiydi — tahrirdan keyin ham qayta hisoblanadi.
   */
  intro: { parts: Record<WorkIntroPartId, boolean> };
  references: Reference[];
  figures: Figure[];
  review?: DocReview;
  /** «Materiallarim» — foydalanuvchi faktlari (qo'riqchi VERBATIM tekshiradi). */
  userFacts?: string;
  /** Janr minimumi (kurs 15 / referat 5 / mustaqil 8) — hisobot shundan o'lchaydi. */
  refsMin: number;
  /** Q-3 qabul chegarasi (X-5: baholovchi shovqini uchun kurs ishida +2). */
  polishAccept?: number;
};

export const WORK_LIMITS = {
  chapters: 6,
  chaptersMin: 2,
  paragraphs: 6,
  paragraphsMin: 2,
  /** Butun ishdagi paragraflar soni (chaqiruv byudjeti). */
  sections: 24,
  figures: 6,
  tables: 6,
  refs: 60,
  userRefs: 40,
  userFactsChars: 12_000,
  topicChars: 300,
  titleFieldChars: 160,
  ministryChars: 240,
  extraChars: 1500,
  sourceTextChars: 24_000,
  tocChars: 4000,
} as const;

/* ────────────────────────── yordamchilar ────────────────────────── */

export const isWorkGenreId = (v: unknown): v is WorkGenreId => (WORK_GENRE_IDS as readonly string[]).includes(String(v));
export const isWorkKindId = (v: unknown): v is WorkKindId => (WORK_KIND_IDS as readonly string[]).includes(String(v));
export const isSubjectProfileId = (v: unknown): v is SubjectProfileId => (SUBJECT_PROFILE_IDS as readonly string[]).includes(String(v));

/** `ch1.2` → `{chapter: 1, paragraph: 2}`; `ch3` → `{chapter: 3}`; aks holda `null`. */
export function parseWorkSectionId(id: string): { chapter: number; paragraph?: number } | null {
  const m = /^ch(\d{1,2})(?:\.(\d{1,2}))?$/.exec(id);
  if (!m) return null;
  return m[2] ? { chapter: Number(m[1]), paragraph: Number(m[2]) } : { chapter: Number(m[1]) };
}

/** Bob sarlavhasi bo'limimi (`ch1`) — matn YOZILMAYDI, faqat sarlavha. */
export const isChapterHeadId = (id: string): boolean => /^ch\d{1,2}$/.test(id);

/** Vosita id → janr (`meta.toolId`); noma'lum → `null`. */
export function workGenreOfTool(toolId: string): WorkGenreId | null {
  if (toolId === "coursework") return "coursework";
  if (toolId === "referat") return "referat";
  if (toolId === "mustaqil-ish") return "independent";
  return null;
}
