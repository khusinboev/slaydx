/**
 * O'QUV DASTURI BAZASI (AUDIT-20 R0) — fan × sinf × mavzu.
 *
 * Ma'lumot `data/curriculum/` da (manba, litsenziya va yig'ish tartibi —
 * `data/CURRICULUM-SOURCES.md`). Migratsiya YO'Q: baza faqat o'qiladi,
 * gitda ko'rib chiqiladi va deploy = kod (`lib/professions.ts` naqshi).
 *
 * IKKI QATLAM — bu faylning butun mohiyati:
 *
 *   `index.json` (~5 KB, fan × sinf)   → statik import, KLIENTGA ham
 *     ketadi: forma «qaysi fanda darslik rejimi bor» degan savolga
 *     tarmoqsiz javob berishi kerak (`hasCurriculum`).
 *
 *   `<fan>.json` (mavzular, to'liq bazada ≈1–1,5 MB) → LAZY `import()`,
 *     ya'ni alohida bo'lak: 70 ta fan faylini klient bandliga qo'shish
 *     bosh sahifani sekinlashtirardi va hech kimga kerak emas. Mavzular
 *     odatda `GET /api/curriculum?subject=&grade=` orqali olinadi.
 *
 * `node:fs` ATAYLAB ishlatilmaydi: shu modulni forma komponenti ham
 * import qiladi (WP-E `CurriculumPicker`), server moduliga zanjir esa
 * sahifani SSR da 500 qilardi (`tests/client-boundary.test.mts`).
 */
import indexRaw from "../data/curriculum/index.json";

export type CurriculumSource = { title: string; url: string; year?: number; publisher?: string };

export type CurriculumTopic = {
  /** `slug(bob) + tartib` — fan+sinf ICHIDA unikal (global emas). */
  id: string;
  title: string;
  /** Hozir doim bo'sh: dastur soatni faqat BOB darajasida beradi (R4 §3). */
  hours?: number;
  quarter?: number;
  /** Darslik sahifasi — hozir doim bo'sh (alohida ish). */
  page?: number;
};

export type CurriculumUnit = {
  /** BOB sarlavhasi («I BOB.» prefiksisiz). */
  title: string;
  hours?: number;
  quarter?: number;
  topics: CurriculumTopic[];
};

/** Bitta fan × sinf — rasmiy hujjat bilan birga. */
export type CurriculumEntry = {
  grade: number;
  source: CurriculumSource;
  units: CurriculumUnit[];
};

export type CurriculumSubject = { id: string; uz: string; ru: string; en: string };

export type CurriculumFile = {
  version: string;
  subject: CurriculumSubject;
  entries: CurriculumEntry[];
};

export type CurriculumIndexSubject = CurriculumSubject & { grades: number[] };

export type CurriculumIndex = {
  version: string;
  sources: CurriculumSource[];
  subjects: CurriculumIndexSubject[];
};

const INDEX = indexRaw as CurriculumIndex;

/**
 * Fan fayllarining LAZY yuklagichlari.
 *
 * Qo'lda yoziladi (bundler statik `import()` chaqiruvini ko'ra olishi
 * uchun — o'zgaruvchidan yasalgan yo'l bilan ishlamaydi). WP-B yangi
 * fan qo'shganda shu jadval ham to'ldiriladi; indeksda bor, jadvalda
 * yo'q fan `tests/curriculum.test.mts` da qizil chiqadi.
 */
const FILES: Record<string, () => Promise<{ default: unknown }>> = {
  matematika: () => import("../data/curriculum/matematika.json"),
};

/** Yuklangan fayllar keshi — bir marta o'qiladi (`import()` ning o'zi ham keshlaydi). */
const CACHE = new Map<string, CurriculumFile>();

const BY_ID = new Map(INDEX.subjects.map((s) => [s.id, s]));

/** Fan × sinf ro'yxati — yengil, klientga ham beriladi. */
export function curriculumIndex(): CurriculumIndex {
  return INDEX;
}

/** Indeksdagi fan tavsifi (uch tilli nom + mavjud sinflar). */
export function curriculumSubject(subjectId: string): CurriculumIndexSubject | null {
  return BY_ID.get(String(subjectId ?? "").trim()) ?? null;
}

/**
 * Shu fan × sinf bazada BORMI — forma darslik rejimini shu savolga
 * qarab ko'rsatadi (X-2: baza to'liq emas, yo'q fanda rejim yashiriladi).
 * Faylga qaramaydi: indeks yagona manba.
 */
export function hasCurriculum(subjectId: string, grade: number): boolean {
  const s = curriculumSubject(subjectId);
  const g = Number(grade);
  return Boolean(s && Number.isFinite(g) && s.grades.includes(g));
}

/**
 * Bitta fan × sinfning MAVZULARI (boblar bilan). Baza yoki fayl
 * topilmasa `null` — chaqiruvchi 404 beradi, bo'sh ro'yxat emas
 * («mavzu yo'q» bilan «bu fan bazada yo'q» bir xil ko'rinmasin).
 */
export async function curriculumTopics(subjectId: string, grade: number): Promise<CurriculumEntry | null> {
  const id = String(subjectId ?? "").trim();
  const g = Number(grade);
  if (!hasCurriculum(id, g)) return null;
  const file = await curriculumFile(id);
  return file?.entries.find((e) => Number(e.grade) === g) ?? null;
}

/** Fanning butun fayli (barcha sinflar) — testlar va yig'ish skriptlari uchun. */
export async function curriculumFile(subjectId: string): Promise<CurriculumFile | null> {
  const id = String(subjectId ?? "").trim();
  const cached = CACHE.get(id);
  if (cached) return cached;
  const load = FILES[id];
  if (!load) return null;
  const mod = await load();
  const file = mod.default as CurriculumFile;
  CACHE.set(id, file);
  return file;
}

/** Bobdan qat'i nazar, tekis mavzular ro'yxati (prompt va `topicIds` tekshiruvi uchun). */
export function flatTopics(entry: CurriculumEntry): CurriculumTopic[] {
  return entry.units.flatMap((u) => u.topics);
}

/** Tanlangan id lar shu yozuvda BORMI — noma'lum id jimgina tashlanadi. */
export function pickTopics(entry: CurriculumEntry, ids: readonly string[]): CurriculumTopic[] {
  const want = new Set(ids.map((s) => String(s ?? "").trim()).filter(Boolean));
  return flatTopics(entry).filter((t) => want.has(t.id));
}
