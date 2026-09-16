/**
 * O'QITUVCHI HUJJATI MAKETI — YAGONA MANBA (AUDIT-20 WP-C).
 *
 * `planTeacher(doc)` beshala vositani (dars ishlanmasi, texnologik
 * xarita, glossariy, keys, test) BITTA rasmiy shaklga yoyadi:
 *
 *   shapka («Tasdiqlayman» o'ng yuqorida, muassasa, hujjat nomi, fan,
 *   sinf, mavzu, tuzuvchi, sana) → bo'limlar → jadvallar → (test:
 *   variant betlari, kalit YANGI BETDAN, javob varag'i)
 *
 * DOCX (`render-docx.ts drawTeacher`) ham, ko'ruvchi (`lib/viewers/
 * flow.ts teacherFlow` → `WordViewer`) ham FAQAT shu natijani chizadi —
 * ikkalasida ham «qaysi band qayerda» degan mantiq YO'Q (`planWork` /
 * `planArticle` naqshi; izomorf — DOM ham, `docx` ham import qilinmaydi).
 *
 * ── Nega titul beti va brend-muqova YO'Q (egasi qarori 12, AUDIT-20 §1)
 *
 * Ilgari bu oilada UCH xil birinchi sahifa bor edi: DOCX GOST titul
 * betini chizardi, `LessonViewer`/`TableViewer`/`GlossaryViewer`/
 * `KeysViewer` esa o'z BREND-MUQOVASINI (rangli lenta + meta-kartochka),
 * ya'ni foydalanuvchi saytda ko'rgan hujjatning birinchi beti yuklab
 * olinganidan boshqa edi (AUDIT-5 P1-5, AUDIT-6 A1 — uch auditda ochiq
 * qolgan band). Amaldagi dars ishlanmasi/xarita/keys esa umuman titul
 * beti bilan kelmaydi: rasmiy shakl — birinchi betning O'ZIDAGI shapka
 * («Tasdiqlayman» o'ng yuqorida, muassasa, fan, sinf, tuzuvchi, sana;
 * `docs/research/lesson-plan.md` §1, `test.md` §3.7). Shuning uchun
 * `teacherProfile(kind).titlePage === "none"` va bu yerda `head` bor.
 *
 * ── Matn qayerdan keladi (WP-A dvigateli bilan shartnoma)
 *
 * NASR va JADVAL — `doc.sections` / `doc.tables` da (boshqa oilalardagidek:
 * `paginate.ts`, `guardSection`, hisobot nishonlari `sections.<id>` va
 * `table:<n>` o'zgarmaydi), METAMA'LUMOT — `doc.teacher` modelida.
 * `planTeacher` har bo'lim uchun ketma-ket chizadi:
 *
 *   1. sarlavha (`section.title`, bo'sh bo'lsa yorliqlar jadvalidan),
 *   2. bo'limning O'Z bloklari,
 *   3. shu bo'limga LANGARLANGAN jadvallar (`DocTable.anchor`),
 *   4. faqat 2–3 BO'SH bo'lsa — modeldan qurilgan zaxira (vaqt jadvali,
 *      chorak jadvali, atamalar, rubrika, test savollari).
 *
 * 4-qadam ATAYIN oxirgi: dvigatel (`teacher/lesson.ts` va h.k.) matnni
 * allaqachon yozadi, uni modeldan QAYTA qurish hujjatni ikki marta
 * chizardi. Zaxira esa qo'lda yig'ilgan hujjat (namuna, test — WP-B
 * gacha) va kelajakdagi kind lar uchun kerak.
 *
 * ── Eski hujjatlar
 *
 * `doc.teacher` yo'q hujjat (bazadagi minglab dars rejasi/xarita/
 * glossariy/keys) `legacy.ts legacyTeacherModel(doc)` bilan SHU YERGA
 * keladi: model bo'sh tuzilma bilan quriladi, ya'ni 4-qadam hech narsa
 * qo'shmaydi va hujjat avvalgidek «sarlavha + bloklar + langarlangan
 * jadval» bo'lib chiqadi — faqat titul beti o'rniga rasmiy shapka bilan.
 * 4 eski ko'ruvchi o'chirilgani uchun boshqa yo'l yo'q: eski hujjat ham
 * YANGI ko'ruvchida ochilishi kerak.
 */
import { docLabels, type DocLabels } from "../i18n";
import type { AcademicDoc, Block, DocSection, DocTable, Figure } from "../types";
import { legacyTeacherModel } from "./legacy";
import { teacherLabels as teacherTextLabels, type TeacherLabels } from "./prompts";
import { teacherKindOf, teacherTypeOf } from "./registry";
import {
  isOmrQuestionKind,
  type GlossaryTerm,
  type KeysCase,
  type LessonStage,
  type MapWeek,
  type TeacherKind,
  type TeacherModel,
  type TeacherSchool,
  type TestModel,
  type TestVariant,
} from "./types";

/* ══════════════════════════ varaq ══════════════════════════ */

/**
 * Chegaralar (sm) — kind bo'yicha. `docx-profile.ts teacherProfile` ham,
 * ko'ruvchi varag'i (`WordViewer teacherSheet`) ham SHU YERDAN o'qiydi:
 * ikkita nusxa bo'lsa ekran bilan fayl ajralib ketardi.
 *
 * Xarita qiymatlari ATAYIN `PROFILES.landscape` dagiday qoldirilgan
 * (1,5/1,5/2/1,5): 6 ustunli jadvalga joy kerak va bu qiymatlar
 * `tests/document.test.mts` da allaqachon qulflangan.
 */
export const TEACHER_MARGINS_CM: Record<TeacherKind, { top: number; right: number; bottom: number; left: number }> = {
  lesson: { top: 2, right: 1.5, bottom: 2, left: 2 },
  map: { top: 1.5, right: 1.5, bottom: 1.5, left: 2 },
  glossary: { top: 2, right: 1.5, bottom: 2, left: 2.5 },
  keys: { top: 2, right: 1.5, bottom: 2, left: 2.5 },
  test: { top: 2, right: 1.5, bottom: 2, left: 2 },
};

/**
 * Tipografiya — kind bo'yicha (`sizePt` tana matni, `line` interval).
 *
 * Dars ishlanmasi TNR 12 / 1,15: rasmiy shaklda u bir-ikki betga
 * sig'ishi kerak, 14/1,5 esa uni to'rt betga cho'zardi. Glossariy va
 * keys — `reference` profilining 13 pt / 1,25 i (ular KETMA-KET
 * o'qilmaydi, izlanadi). Xarita — albom, 12 pt / 1,15.
 */
export const TEACHER_TYPE: Record<TeacherKind, { sizePt: number; line: number; tableSizePt: number; smallPt: number }> = {
  lesson: { sizePt: 12, line: 1.15, tableSizePt: 10, smallPt: 9 },
  map: { sizePt: 12, line: 1.15, tableSizePt: 10, smallPt: 9 },
  glossary: { sizePt: 13, line: 1.25, tableSizePt: 11, smallPt: 10 },
  keys: { sizePt: 13, line: 1.25, tableSizePt: 11, smallPt: 10 },
  test: { sizePt: 12, line: 1.15, tableSizePt: 10, smallPt: 9 },
};

/**
 * Albom FAQAT texnologik xaritada.
 *
 * Xarita 6 ustunli va «Mavzu» ustuniga 80 belgi sig'ishi kerak (portret
 * A4 da ustunga ~2,7 sm qolardi). Dars ishlanmasida esa jadval 3 ustunli
 * va hujjatning KICHIK qismi — asosiysi bosqichlar nasri; albomda u
 * ~26 sm satrda chiqib, o'qish uchun yaroqsiz uzunlik berardi
 * (`docx-profile.ts PROFILES.lesson` dagi AUDIT-5 P0-3 asoslanishi).
 */
export const TEACHER_LANDSCAPE: Record<TeacherKind, boolean> = {
  lesson: false,
  map: true,
  glossary: false,
  keys: false,
  test: false,
};

/* ══════════════════════════ yorliqlar ══════════════════════════ */

/**
 * FAQAT MAKETGA tegishli so'zlar.
 *
 * Hujjat matnining yorliqlari (maqsad uchligi, kompetensiyalar, chorak
 * sarlavhasi, tarjima ustunlari, `sectionLabels`) `teacher/prompts.ts
 * teacherLabels` da — dvigatel ham, maket ham SHU BIRINCHI manbadan
 * o'qiydi. Bu yerda faqat dvigatel bilmaydigan, chizuvchiga xos
 * qatorlar: shapka, test varag'i maketi, jadval/rasm raqami.
 */
type TeacherLayoutWords = {
  approve: string;
  date: string;
  variant: string;
  docTitle: Record<TeacherKind, string>;
  teacherActs: string;
  studentActs: string;
  instructions: string;
  answersKey: string;
  criteria: string;
  omrSheet: string;
  teacherOnly: string;
  gradeScale: string;
  totalLabel: string;
  keyCols: { n: string; points: string; bloom: string; difficulty: string };
  gradeCols: [string, string];
  criteriaCols: [string, string, string, string];
  matchCols: [string, string];
  /**
   * O'quvchi maydoni — YORLIQ va BO'SH CHIZIQ juftlari (test varag'i
   * shapkasi). Bitta satr sifatida saqlab bo'lmaydi: `cleanText` bitta
   * matndagi IKKI chiziqni markdown `__qalin__` deb o'qib, har biridan
   * ikkitadan tagchiziqni yeb qo'yardi — bosma varaqda chiziqlar
   * asta-sekin qisqarardi. Har bo'lak alohida run/span bo'lganda bu
   * mumkin emas (`drawWork spanRuns` bilan bir xil sabab).
   */
  studentFields: string[];
  totalPointsLine: (n: number) => string;
  timeLimit: (n: number) => string;
  tableRef: (n: string) => string;
  figureRef: (n: string) => string;
  omrCaption: (n: number) => string;
};

const WORDS: Record<"uz" | "ru" | "en", TeacherLayoutWords> = {
  uz: {
    approve: "Tasdiqlayman",
    date: "Sana",
    variant: "Variant",
    docTitle: {
      lesson: "DARS ISHLANMASI",
      map: "TEXNOLOGIK XARITA",
      glossary: "GLOSSARIY",
      keys: "KEYS TOPSHIRIQLARI",
      test: "TEST TOPSHIRIG‘I",
    },
    teacherActs: "O‘qituvchi:",
    studentActs: "O‘quvchi:",
    instructions: "Ko‘rsatma",
    answersKey: "Javoblar kaliti",
    criteria: "Baholash mezonlari",
    omrSheet: "Javoblar varag‘i",
    teacherOnly: "O‘QITUVCHI UCHUN — o‘quvchiga tarqatilmaydi",
    gradeScale: "Ball va baho",
    totalLabel: "Jami ball:",
    keyCols: { n: "№", points: "Ball", bloom: "Bloom", difficulty: "Qiyinlik" },
    gradeCols: ["Ball (%)", "Baho"],
    criteriaCols: ["Mezon", "Ko‘nikma", "Topshiriq", "Ball"],
    matchCols: ["Chap ustun", "O‘ng ustun"],
    studentFields: ["F.I.Sh.", "______________________", "Sinf", "________", "Sana", "__________", "Ball", "______", "Baho", "______"],
    totalPointsLine: (n) => `Jami ball: ${n}`,
    timeLimit: (n) => `Ajratilgan vaqt: ${n} daqiqa`,
    tableRef: (n) => `${n}-jadval`,
    figureRef: (n) => `${n}-rasm`,
    omrCaption: (n) => `Javoblar varag‘i (${n} ta savol)`,
  },
  ru: {
    approve: "Утверждаю",
    date: "Дата",
    variant: "Вариант",
    docTitle: {
      lesson: "ПЛАН-КОНСПЕКТ УРОКА",
      map: "ТЕХНОЛОГИЧЕСКАЯ КАРТА",
      glossary: "ГЛОССАРИЙ",
      keys: "КЕЙС-ЗАДАНИЯ",
      test: "ТЕСТОВОЕ ЗАДАНИЕ",
    },
    teacherActs: "Учитель:",
    studentActs: "Ученик:",
    instructions: "Инструкция",
    answersKey: "Ключи ответов",
    criteria: "Критерии оценивания",
    omrSheet: "Лист ответов",
    teacherOnly: "ДЛЯ УЧИТЕЛЯ — не раздавать ученикам",
    gradeScale: "Баллы и оценка",
    totalLabel: "Всего баллов:",
    keyCols: { n: "№", points: "Балл", bloom: "Блум", difficulty: "Сложность" },
    gradeCols: ["Балл (%)", "Оценка"],
    criteriaCols: ["Критерий", "Навык", "Задание", "Балл"],
    matchCols: ["Левый столбец", "Правый столбец"],
    studentFields: ["Ф.И.О.", "______________________", "Класс", "________", "Дата", "__________", "Балл", "______", "Оценка", "______"],
    totalPointsLine: (n) => `Всего баллов: ${n}`,
    timeLimit: (n) => `Отведённое время: ${n} минут`,
    tableRef: (n) => `Таблица ${n}`,
    figureRef: (n) => `Рисунок ${n}`,
    omrCaption: (n) => `Лист ответов (${n} вопросов)`,
  },
  en: {
    approve: "Approved",
    date: "Date",
    variant: "Variant",
    docTitle: {
      lesson: "LESSON PLAN",
      map: "CALENDAR-THEMATIC PLAN",
      glossary: "GLOSSARY",
      keys: "CASE-STUDY TASKS",
      test: "TEST PAPER",
    },
    teacherActs: "Teacher:",
    studentActs: "Pupil:",
    instructions: "Instructions",
    answersKey: "Answer key",
    criteria: "Assessment criteria",
    omrSheet: "Answer sheet",
    teacherOnly: "FOR THE TEACHER — do not hand out to pupils",
    gradeScale: "Score and grade",
    totalLabel: "Total points:",
    keyCols: { n: "No.", points: "Points", bloom: "Bloom", difficulty: "Difficulty" },
    gradeCols: ["Score (%)", "Grade"],
    criteriaCols: ["Criterion", "Skill", "Task", "Points"],
    matchCols: ["Left column", "Right column"],
    studentFields: ["Name", "______________________", "Class", "________", "Date", "__________", "Score", "______", "Grade", "______"],
    totalPointsLine: (n) => `Total points: ${n}`,
    timeLimit: (n) => `Time allowed: ${n} minutes`,
    tableRef: (n) => `Table ${n}`,
    figureRef: (n) => `Figure ${n}`,
    omrCaption: (n) => `Answer sheet (${n} questions)`,
  },
};

/** Maket yorliqlari = dvigatel yorliqlari + chizuvchiga xos qatorlar. */
export type TeacherDocLabels = TeacherLabels & TeacherLayoutWords & { doc: DocLabels };

export function teacherLayoutLabels(language: string): TeacherDocLabels {
  const base = teacherTextLabels(language);
  return { ...base, ...WORDS[base.lang], doc: docLabels(language) };
}

/* ══════════════════════════ bo'lim id lari ══════════════════════════ */

/**
 * Dvigatel yozadigan TEKIS bo'lim id lari (WP-A/WP-B shartnomasi;
 * `teacher/engine.ts` bosh izohida ham qulflangan). `caseN` va
 * `variantA` — dinamik, quyidagi `parse*` lar bilan.
 */
export const TEACHER_SECTION_IDS: Record<TeacherKind, readonly string[]> = {
  lesson: ["passport", "goal", "stages", "homework", "assessment"],
  map: ["passport", "year", "q1", "q2", "q3", "q4"],
  glossary: ["intro", "terms"],
  keys: ["intro", "rubric"],
  /*
   * Test: O'QUVCHI qismi birga turadi — ko'rsatma, variantlar, javob
   * varag'i; FAQAT SHUNDAN KEYIN o'qituvchi qismi (kalit, mezon).
   * `variantA`… dinamik va `instructions` bilan `omr` orasida keladi.
   * `test/engine.ts testSections` AYNAN shu tartibda yozadi — ilgari
   * bu ro'yxat `omr` ni oxirida ko'rsatib, shartnomani yolg'on
   * e'lon qilardi (WP-C ochiq bandi).
   */
  test: ["instructions", "omr", "key", "criteria", "honesty"],
};

/** `case1` → 1; boshqa id da `null`. */
export function caseIndexOf(id: string): number | null {
  const m = /^case[-_]?(\d{1,2})$/i.exec(id);
  return m ? Number(m[1]) : null;
}

/** `variantA` → «A»; boshqa id da `null`. */
export function variantIdOf(id: string): string | null {
  const m = /^variant[-_]?([A-Da-d])$/.exec(id);
  return m ? m[1].toUpperCase() : null;
}

/** `q1` → 1; boshqa id da `null`. */
export function quarterIndexOf(id: string): number | null {
  const m = /^q([1-4])$/i.exec(id);
  return m ? Number(m[1]) : null;
}

/* ══════════════════════════ reja tiplari ══════════════════════════ */

/**
 * Rasmiy SHAPKA bandi. Titul beti emas — birinchi betning o'zida,
 * matndan oldin (`docs/research/lesson-plan.md` §1).
 *
 *   `approve`  — «Tasdiqlayman» bloki O'NG YUQORIDA (lavozim + imzo
 *                chizig'i); `school.approver` bo'sh bo'lsa umuman yo'q.
 *   `org`      — muassasa nomi, markazda.
 *   `title`    — hujjat nomi («DARS ISHLANMASI»), markazda qalin.
 *   `subtitle` — tur nomi («Yangi mavzu darsi»), markazda kursiv.
 *   `field`    — «Fan: Biologiya» kabi chap qator.
 *   `line`     — yorliq/chiziq bo'laklari (test: o'quvchi maydoni).
 */
export type TeacherHeadItem =
  | { k: "approve"; lines: string[]; path: string }
  | { k: "org"; text: string; path: string }
  | { k: "title"; text: string; path: string }
  | { k: "subtitle"; text: string; path: string }
  | { k: "field"; label: string; text: string; path: string }
  | { k: "line"; parts: string[]; path: string };

/**
 * Tana bandi. `path` — TAHRIR yo'li (WP-D `teacher/edit.ts`):
 * nasr uchun `sections.<i>.blocks.<j>`, hujjat jadvali uchun hisobot
 * bilan bir xil `table:<n>` nishoni, modeldan qurilgan band uchun
 * `teacher.<kind>.<...>` (masalan `teacher.lesson.stages.2.teacher`).
 */
export type TeacherBodyItem =
  | { k: "h1"; text: string; sectionId: string; path: string; pageBreak: boolean }
  | { k: "h2"; text: string; path: string }
  | { k: "h3"; text: string; path: string }
  | { k: "p"; text: string; path: string }
  | { k: "li"; text: string; path: string }
  | { k: "quote"; text: string; path: string }
  | { k: "code"; text: string; caption?: string; path: string }
  /** «Ta’limiy maqsad: …» — yorliq QALIN, matn oddiy, bitta paragrafda. */
  | { k: "kv"; label: string; text: string; path: string }
  /** Test savolining javob varianti: «A) …» (ro'yxat belgisi YO'Q). */
  | { k: "opt"; letter: string; text: string; path: string }
  /** Ogohlantirish qatori («O‘QITUVCHI UCHUN …») — qalin. */
  | { k: "note"; text: string; path: string }
  /** Ochiq savol javobi uchun bo'sh chiziqlar. */
  | { k: "lines"; count: number; path: string }
  /** Jadval: raqami («1-jadval») tepa o'ngda, nomi ostida markazda. */
  | { k: "table"; tableId: string; table: DocTable; number: string; numberLine: string; caption: string; path: string }
  /** Sxema/OMR: sarlavha PASTDA markazda. */
  | { k: "figure"; figureId: string; figure?: Figure; number: string; caption: string; placeholder: string; path: string };

export type TeacherPlan = {
  model: TeacherModel;
  kind: TeacherKind;
  /** Reyestr tur id (`yangi-mavzu`, `choraklik`, `bsb`…). */
  type: string;
  language: string;
  labels: TeacherDocLabels;
  /** Rasmiy shapka — titul beti YO'Q (qaror 12). */
  head: TeacherHeadItem[];
  body: TeacherBodyItem[];
  /** Hujjatdagi BARCHA jadvallar chizilish tartibida (hisobot/tahrir uchun). */
  tables: DocTable[];
  /** Yangi betdan boshlanadigan bo'lim id lari (test: variantlar, kalit, OMR). */
  pageBreaks: string[];
  landscape: boolean;
  numbers: { tables: Record<string, string>; figures: Record<string, string> };
  /**
   * Jadval id → TAHRIR yo'li. Hujjat jadvali uchun `table:<n>` — hisobot
   * (`review.ts tableTarget`) va sayqal (`polish.ts`) aynan shu nishondan
   * foydalanadi, ya'ni WP-D tahriri uchinchi sintaksis o'ylab topmaydi.
   */
  tablePaths: Record<string, string>;
  page: { marginsCm: { top: number; right: number; bottom: number; left: number }; sizePt: number; line: number; tableSizePt: number; smallPt: number };
  /** Sarlavha tekislanishi — o'qituvchi hujjatida DOIM chapda. */
  headingAlign: "left";
  /** `doc.teacher` bo'lmagan eski hujjatmi (tahrir YOQILMAYDI — WP-D 409). */
  legacy: boolean;
};

/* ══════════════════════════ yordamchilar ══════════════════════════ */

/** Hujjat o'qituvchi oilasiga tegishlimi — `renderDocx`/`docToFlow` shoxi. */
export function isTeacherDoc(doc: AcademicDoc): boolean {
  return Boolean(doc.teacher) || Boolean(teacherKindOf(doc.meta.toolId));
}

const clean = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ").trim();

/** «5-A» / «5» / «» (sinf ko'rsatilmagan — OTM auditoriyasi). */
function gradeText(school: TeacherSchool): string {
  const g = Number(school.grade) || 0;
  if (!g) return "";
  const letter = clean(school.gradeLetter).toUpperCase().slice(0, 1);
  return letter ? `${g}-${letter}` : String(g);
}

/** ISO `YYYY-MM-DD` → `DD.MM.YYYY`; boshqa shakl o'zgarishsiz qaytadi. */
export function teacherDateText(iso: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(iso));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : clean(iso);
}

/* ══════════════════════════ reja ══════════════════════════ */

export function planTeacher(doc: AcademicDoc): TeacherPlan {
  const legacy = !doc.teacher;
  const model = doc.teacher ?? legacyTeacherModel(doc);
  if (!model) throw new Error("planTeacher: hujjat o'qituvchi oilasiga tegishli emas (`doc.teacher` ham, o'qituvchi `toolId` ham yo'q)");
  const kind = model.kind;
  const language = model.school.language || doc.meta.language || "uz";
  const L = teacherLayoutLabels(language);
  const spec = teacherTypeOf(kind, model.type);
  const docTables = doc.tables ?? [];

  const head: TeacherHeadItem[] = [];
  const body: TeacherBodyItem[] = [];
  const tables: DocTable[] = [];
  const pageBreaks: string[] = [];
  const numbers: { tables: Record<string, string>; figures: Record<string, string> } = { tables: {}, figures: {} };
  const tablePaths: Record<string, string> = {};
  let tableN = 0;
  let figureN = 0;

  /* ────────────── shapka ────────────── */

  const S = model.school;
  /*
   * «Tasdiqlayman» — metodik kengash/direktor o'rinbosari qatori.
   * `approver` bo'sh bo'lsa qator UMUMAN chizilmaydi: bo'sh imzo joyi
   * hujjatni «tugallanmagan» ko'rsatardi. Test vositasida dvigatel uni
   * faqat `bsb`/`chsb` turlarida to'ldiradi (R3 §3.7).
   */
  const approver = clean(S.approver);
  if (approver) head.push({ k: "approve", lines: [L.approve, approver, "______________"], path: "teacher.school.approver" });
  if (clean(S.institution)) head.push({ k: "org", text: clean(S.institution), path: "teacher.school.institution" });
  head.push({ k: "title", text: L.docTitle[kind], path: "teacher.kind" });
  if (spec?.label?.[L.lang]) head.push({ k: "subtitle", text: spec.label[L.lang], path: "teacher.type" });

  const field = (label: string, text: string, path: string) => {
    if (clean(text)) head.push({ k: "field", label, text: clean(text), path });
  };
  field(L.fieldSubject, S.subject, "teacher.school.subject");
  field(L.fieldGrade, gradeText(S), "teacher.school.grade");
  if (kind === "lesson" && model.lesson) {
    field(L.fieldDuration, `${model.lesson.durationMin} ${L.minutesShort}`, "teacher.lesson.durationMin");
  }
  if (kind === "map" && model.map) {
    field(L.fieldWeeklyHours, String(model.map.weeklyHours), "teacher.map.weeklyHours");
    field(L.fieldTotalHours, String(model.map.totalHours), "teacher.map.totalHours");
  }
  /*
   * «Mavzu» qatori FANNING TAKRORI bo'lsa chizilmaydi.
   *
   * Texnologik xaritada mavzu maydoni odatda fan nomining o'zi bo'ladi
   * («Fan: Biologiya» + «Mavzu: Biologiya») — LibreOffice ko'z
   * tekshiruvida shapkada ikki bir xil qator turgan edi. Dars
   * ishlanmasida mavzu fandan farq qiladi, ya'ni u yerda qator
   * avvalgidek qoladi.
   */
  if (clean(doc.meta.topic).toLowerCase() !== clean(S.subject).toLowerCase()) {
    field(L.fieldTopic, doc.meta.topic, "meta.topic");
  }
  field(L.doc.compiledBy, S.author, "teacher.school.author");
  field(L.date, teacherDateText(S.date), "teacher.school.date");
  if (kind === "test") head.push({ k: "line", parts: L.studentFields, path: "teacher.test" });

  /* ────────────── tana ────────────── */

  /**
   * `t` — HUJJAT jadvali bo'lsa `path` `table:<n>` bo'ladi (hisobot va
   * sayqal nishoni bilan AYNI), modeldan qurilgan zaxira jadval esa o'z
   * model yo'lini oladi.
   */
  const pushTable = (t: DocTable, path: string, caption?: string) => {
    tableN++;
    const id = t.id ?? `t${tableN}`;
    const n = String(tableN);
    numbers.tables[id] = n;
    tablePaths[id] = path;
    tables.push(t);
    body.push({
      k: "table",
      tableId: id,
      table: t,
      number: n,
      numberLine: L.tableRef(n),
      caption: clean(caption ?? t.caption ?? ""),
      path,
    });
  };

  /** Hujjat jadvali — nishoni `table:<n>` (`review.ts tableTarget`). */
  const pushDocTable = (t: DocTable) => pushTable(t, `table:${docTables.indexOf(t)}`);

  const pushFigure = (figureId: string, caption: string, path: string, figure?: Figure) => {
    figureN++;
    const n = String(figureN);
    numbers.figures[figureId] = n;
    body.push({
      k: "figure",
      figureId,
      ...(figure ? { figure } : {}),
      number: n,
      caption: `${L.figureRef(n)}. ${clean(caption)}`.trim(),
      placeholder: `[${L.figureRef(n)}]`,
      path,
    });
  };

  /**
   * SHAPKADA allaqachon turgan «Fan: … Sinf: … Davomiyligi: …» takrori.
   *
   * Dvigatel (`teacher/lesson.ts`, `teacher/map.ts`) pasport bo'limining
   * birinchi paragrafiga shu maydonlarni QAYTA yozadi — eski shaklda
   * shapka yo'q edi va u yagona joy edi. Yangi maketda ular birinchi
   * betning shapkasida turadi, ya'ni pasportdagi qatori aynan takror.
   * Ko'z tekshiruvida bu darhol ko'rindi.
   *
   * Tekshiruv QAT'IY: paragraf FAQAT shapkada bor «Yorliq: qiymat»
   * juftlaridan iborat bo'lsagina TASHLANADI. Bitta qo'shimcha fakt
   * bo'lsa («Haftalar: 12» — shapkada yo'q) paragraf butunligicha
   * qoladi: matn hech qachon QAYTA YOZILMAYDI, chunki tahrir yo'li
   * (`sections.<i>.blocks.<j>`) saqlangan matnga tayanadi.
   */
  const headPairs = new Set(head.filter((h) => h.k === "field").map((h) => (h.k === "field" ? `${h.label}: ${h.text}` : "")));
  const isHeadRecap = (text: string): boolean => {
    const parts = clean(text).replace(/\.$/, "").split(/\.\s+/).filter(Boolean);
    return parts.length > 0 && parts.every((x) => headPairs.has(x));
  };

  /**
   * O'QUVCHI MAYDONI qatori («F.I.Sh. ______ Sinf ____ …»).
   *
   * Uni shapka chizadi; dvigatel esa ESKI hujjatlarda uni ko'rsatma
   * bo'limining birinchi paragrafi sifatida ham yozgan (WP-D da
   * `test/engine.ts` dan olib tashlandi) — o'sha hujjatlarda qator
   * ikki marta chiqmasligi uchun shu yerda ham tashlanadi.
   *
   * Tanish ALOMAT bo'yicha: tagchiziq guruhlari olib tashlangach
   * matnda shapkadagi yorliqlarning kamida uchtasi qolsa. Aynan
   * satr solishtirish yaramaydi — dvigatelning qatori (`test/labels.ts`)
   * va shapkaniki (`studentFields`) boshqa ro'yxatdan quriladi.
   */
  const studentLabels = L.studentFields.filter((x) => !/^_+$/.test(x)).map((x) => x.toLowerCase());
  const isStudentFieldLine = (text: string): boolean => {
    const bare = clean(text).replace(/_+/g, " ");
    if (!/_/.test(text)) return false;
    return studentLabels.filter((lab) => bare.toLowerCase().includes(lab)).length >= 3;
  };

  const pushBlocks = (blocks: Block[], path: string, opts: { dropHeadRecap?: boolean; dropStudentLine?: boolean } = {}) => {
    blocks.forEach((b, i) => {
      const p = `${path}.blocks.${i}`;
      if (opts.dropHeadRecap && b.kind === "p" && isHeadRecap(b.text)) return;
      if (opts.dropStudentLine && b.kind === "p" && isStudentFieldLine(b.text)) return;
      switch (b.kind) {
        case "h1":
        case "h2":
          body.push({ k: "h2", text: b.text, path: p });
          break;
        case "h3":
          body.push({ k: "h3", text: b.text, path: p });
          break;
        case "li":
          body.push({ k: "li", text: b.text, path: p });
          break;
        case "quote":
          body.push({ k: "quote", text: b.text, path: p });
          break;
        case "code":
          body.push({ k: "code", text: b.text, ...(b.caption ? { caption: b.caption } : {}), path: p });
          break;
        case "figure":
          /*
           * O'qituvchi modelida sxema OMBORI yo'q (`TeacherModel` da
           * `figures` maydoni yo'q — R0 qarori), shuning uchun bu yerda
           * FAQAT o'rinbosar ramka chiziladi. OMR PNG i WP-B/WP-D da
           * aktiv sifatida keladi — o'shanda `figure` payload'i shu
           * bandga qo'shiladi va ikkala chizuvchi ham darhol rasm
           * chizadi (shartnoma o'zgarmaydi).
           */
          pushFigure(b.figureId, b.text || "", p, (model.figures ?? []).find((f) => f.id === b.figureId));
          break;
        case "tableRef": {
          const t = docTables.find((x) => x.id === b.tableId);
          if (t) pushDocTable(t);
          break;
        }
        default:
          body.push({ k: "p", text: b.text, path: p });
      }
    });
  };

  /* ── ZAXIRA: modeldan qurilgan bo'lak (bo'lim bo'sh bo'lsa) ── */

  const stageTable = (stages: LessonStage[]): DocTable => ({
    id: "stages",
    caption: L.timeTable,
    headers: [...L.timeCols],
    widths: [42, 13, 45],
    rows: stages.map((st) => [clean(st.title), String(st.minutes ?? ""), clean(st.result)]),
  });

  /** Ustunlar `yearCols` bo'yicha — `teacher/map.ts rowOf` bilan AYNI. */
  const weekTable = (weeks: MapWeek[], id: string): DocTable => ({
    id,
    headers: [...L.yearCols],
    widths: [8, 8, 34, 16, 20, 14],
    rows: weeks.map((w) => [String(w.n), String(w.hours ?? ""), clean(w.topic), clean(w.method), clean(w.result), clean(w.control)]),
  });

  const pushTerms = (terms: GlossaryTerm[], withExample: boolean) => {
    terms.forEach((t, i) => {
      const p = `teacher.glossary.terms.${i}`;
      body.push({ k: "h3", text: clean(t.term), path: `${p}.term` });
      body.push({ k: "p", text: clean(t.def), path: `${p}.def` });
      if (withExample && clean(t.example)) body.push({ k: "kv", label: `${L.example}:`, text: clean(t.example), path: `${p}.example` });
    });
  };

  const pushCase = (c: KeysCase, i: number) => {
    const p = `teacher.keys.cases.${i}`;
    if (clean(c.situation)) body.push({ k: "p", text: clean(c.situation), path: `${p}.situation` });
    if (c.questions?.length) {
      body.push({ k: "h3", text: L.tasks, path: `${p}.questions` });
      c.questions.forEach((q, j) => body.push({ k: "li", text: clean(q), path: `${p}.questions.${j}` }));
    }
    if (clean(c.solution)) {
      body.push({ k: "h3", text: L.answerKey, path: `${p}.solution` });
      body.push({ k: "p", text: clean(c.solution), path: `${p}.solution` });
    }
  };

  /** Rubrika ALOHIDA bo'lim (WP-A shartnomasi) — keyslardan keyin. */
  const pushRubric = (cases: KeysCase[]) => {
    cases.forEach((c, i) => {
      if (!c.rubric?.length) return;
      const p = `teacher.keys.cases.${i}.rubric`;
      body.push({ k: "h3", text: `${L.caseWord} ${i + 1}`, path: p });
      c.rubric.forEach((r, j) => body.push({ k: "li", text: `${clean(r.criterion)} — ${r.points} ${L.points}`, path: `${p}.${j}` }));
      const total = c.rubric.reduce((a, r) => a + (Number(r.points) || 0), 0);
      body.push({ k: "kv", label: `${L.totalPoints}:`, text: `${total} ${L.points}`, path: p });
    });
  };

  /* ── test (WP-B gacha butunlay modeldan) ── */

  const pushQuestion = (t: TestModel, qi: number, optionOrder: number[], n: number, vId: string) => {
    const q = t.questions[qi];
    if (!q) return;
    const p = `teacher.test.questions.${qi}`;
    body.push({ k: "p", text: `${n}. ${clean(q.stem)}`, path: `${p}.stem` });
    if (q.kind === "open") {
      body.push({ k: "lines", count: 4, path: `${p}.answer` });
      return;
    }
    if (q.kind === "match") {
      /*
       * `match` savolida `options` IKKI ro'yxatni ketma-ket saqlaydi
       * (chap yarmi — bandlar, o'ng yarmi — moslar); maketda ular ikki
       * ustunli jadvalga ajratiladi (R0 `TestQuestion` izohi).
       */
      const half = Math.ceil(q.options.length / 2);
      const left = q.options.slice(0, half);
      const right = q.options.slice(half);
      pushTable(
        {
          id: `match-${vId}-${qi}`,
          headers: [...L.matchCols],
          widths: [50, 50],
          rows: left.map((x, i) => [`${i + 1}. ${clean(x)}`, `${String.fromCharCode(65 + i)}) ${clean(right[i] ?? "")}`]),
        },
        `${p}.options`,
      );
      return;
    }
    optionOrder.forEach((oi, k) => {
      const text = q.options[oi];
      if (text === undefined) return;
      body.push({ k: "opt", letter: String.fromCharCode(65 + k), text: clean(text), path: `${p}.options.${oi}` });
    });
  };

  const pushVariant = (t: TestModel, v: TestVariant) => {
    v.order.forEach((qi, i) => pushQuestion(t, qi, v.optionOrder?.[i] ?? (t.questions[qi]?.options ?? []).map((_, k) => k), i + 1, v.id));
  };

  const pushKeyTables = (t: TestModel) => {
    body.push({ k: "note", text: L.teacherOnly, path: "teacher.test.key" });
    const ids = t.variants.map((v) => v.id);
    /*
     * Ustun kengliklari ANIQ beriladi: `columnPercents` 6 ustunli bu
     * jadvalni tanimaydi va teng taqsimlab qo'yardi — ko'z tekshiruvida
     * «Variant A» sarlavhasi ikki qatorga sinib («Varia / nt A»),
     * «Bloom» ustuni esa yarim bo'sh turardi.
     */
    const perVariant = Math.floor(34 / Math.max(1, ids.length));
    pushTable(
      {
        id: "key",
        headers: [L.keyCols.n, ...ids.map((id) => `${L.variant} ${id}`), L.keyCols.points, L.keyCols.bloom, L.keyCols.difficulty],
        widths: [7, ...ids.map(() => perVariant), 10, 26, 23 + (34 - perVariant * ids.length)],
        rows: t.questions.map((q, i) => [String(i + 1), ...ids.map((id) => t.key[id]?.[i] ?? "—"), String(q.points ?? 1), q.bloom, q.difficulty]),
      },
      "teacher.test.key",
    );
    if (t.scoring?.total) body.push({ k: "kv", label: L.totalLabel, text: String(t.scoring.total), path: "teacher.test.scoring.total" });
    if (t.scoring?.gradeScale?.length) {
      pushTable(
        {
          id: "grades",
          caption: L.gradeScale,
          headers: [...L.gradeCols],
          widths: [50, 50],
          rows: t.scoring.gradeScale.map((g) => [`${g.minPercent}–${g.maxPercent}`, String(g.grade)]),
        },
        "teacher.test.scoring.gradeScale",
      );
    }
  };

  /**
   * Bo'limning MODELDAN qurilgan zaxirasi.
   *
   * `hasBlocks`/`hasTable` — dvigatel shu bo'limni allaqachon yozganmi.
   * Yozgan bo'lsa zaxira UMUMAN ishlamaydi: aks holda dars bosqichlari
   * ham nasrda, ham modeldan chiqib, hujjat ikki marta chizilardi.
   */
  const attach = (id: string, hasBlocks: boolean, hasTable: boolean) => {
    if (kind === "lesson" && model.lesson) {
      const l = model.lesson;
      if (id === "goal" && !hasBlocks) {
        body.push({ k: "kv", label: `${L.goalTalim}:`, text: clean(l.goal?.talim), path: "teacher.lesson.goal.talim" });
        body.push({ k: "kv", label: `${L.goalTarbiya}:`, text: clean(l.goal?.tarbiya), path: "teacher.lesson.goal.tarbiya" });
        body.push({ k: "kv", label: `${L.goalRivoj}:`, text: clean(l.goal?.rivoj), path: "teacher.lesson.goal.rivoj" });
        if (l.competencies?.length) {
          body.push({ k: "h3", text: L.competencies, path: "teacher.lesson.competencies" });
          l.competencies.forEach((c, i) => body.push({ k: "li", text: clean(c), path: `teacher.lesson.competencies.${i}` }));
        }
        if (l.equipment?.length) {
          body.push({ k: "h3", text: L.equipment, path: "teacher.lesson.equipment" });
          l.equipment.forEach((c, i) => body.push({ k: "li", text: clean(c), path: `teacher.lesson.equipment.${i}` }));
        }
        return;
      }
      if (id === "stages") {
        if (!hasBlocks) {
          l.stages?.forEach((st, i) => {
            const p = `teacher.lesson.stages.${i}`;
            body.push({ k: "h3", text: `${i + 1}. ${clean(st.title)} (${st.minutes} ${L.minutesShort})`, path: `${p}.title` });
            if (clean(st.method)) body.push({ k: "kv", label: `${L.method}:`, text: clean(st.method), path: `${p}.method` });
            if (clean(st.teacher)) body.push({ k: "kv", label: L.teacherActs, text: clean(st.teacher), path: `${p}.teacher` });
            if (clean(st.student)) body.push({ k: "kv", label: L.studentActs, text: clean(st.student), path: `${p}.student` });
            if (clean(st.result)) body.push({ k: "kv", label: `${L.timeCols[2]}:`, text: clean(st.result), path: `${p}.result` });
          });
        }
        if (!hasTable && l.stages?.length) pushTable(stageTable(l.stages), "teacher.lesson.stages");
        return;
      }
      if (id === "homework" && !hasBlocks && clean(l.homework)) body.push({ k: "p", text: clean(l.homework), path: "teacher.lesson.homework" });
      if (id === "assessment" && !hasBlocks && clean(l.assessment)) body.push({ k: "p", text: clean(l.assessment), path: "teacher.lesson.assessment" });
      return;
    }
    if (kind === "map" && model.map) {
      if (hasTable) return;
      const m = model.map;
      const q = quarterIndexOf(id);
      if (q !== null) {
        const quarter = m.quarters.find((x) => x.n === q);
        if (quarter?.weeks.length) pushTable(weekTable(quarter.weeks, `q${q}`), `teacher.map.quarters.${m.quarters.indexOf(quarter)}`);
        return;
      }
      if (id === "year") {
        const weeks = m.quarters.flatMap((x) => x.weeks);
        if (weeks.length) pushTable(weekTable(weeks, "year"), "teacher.map.quarters");
      }
      return;
    }
    if (kind === "glossary" && model.glossary) {
      if (id !== "terms") return;
      const g = model.glossary;
      if (!hasBlocks) pushTerms(g.terms ?? [], g.includeExample !== false);
      if (!hasTable && g.type === "uch-tilli" && g.terms?.length) {
        // Ustunlar «Atama | Ruscha | Inglizcha» — ta'rif YUQORIDAGI ro'yxatda,
        // jadvalda takrorlanmaydi (AUDIT-6 B5 qarori, WP-A bilan bir xil).
        pushTable(
          {
            id: "terms",
            headers: [...L.triCols],
            widths: [40, 30, 30],
            rows: g.terms.map((t) => [clean(t.term), clean(t.ru), clean(t.en)]),
          },
          "teacher.glossary.terms",
        );
      }
      return;
    }
    if (kind === "keys" && model.keys) {
      if (hasBlocks) return;
      const n = caseIndexOf(id);
      if (n !== null && model.keys.cases[n - 1]) {
        pushCase(model.keys.cases[n - 1], n - 1);
        return;
      }
      if (id === "rubric") pushRubric(model.keys.cases ?? []);
      return;
    }
    if (kind === "test" && model.test) {
      if (hasBlocks && id !== "omr") return;
      const t = model.test;
      if (id === "instructions") {
        t.instructions?.forEach((line, i) => body.push({ k: "li", text: clean(line), path: `teacher.test.instructions.${i}` }));
        if (t.timeMin) body.push({ k: "p", text: L.timeLimit(t.timeMin), path: "teacher.test.timeMin" });
        if (t.scoring?.total) body.push({ k: "p", text: L.totalPointsLine(t.scoring.total), path: "teacher.test.scoring.total" });
        return;
      }
      const v = variantIdOf(id);
      if (v) {
        const variant = t.variants.find((x) => x.id === v);
        if (variant) pushVariant(t, variant);
        return;
      }
      if (id === "key") {
        pushKeyTables(t);
        return;
      }
      if (id === "criteria" && t.criteria?.length && !hasTable) {
        pushTable(
          {
            id: "criteria",
            headers: [...L.criteriaCols],
            widths: [40, 25, 15, 20],
            rows: t.criteria.map((c) => [clean(c.criterion), clean(c.skill), clean(c.taskRef), String(c.points)]),
          },
          "teacher.test.criteria",
        );
        return;
      }
      if (id === "omr" && t.omr && !numbers.figures.omr) {
        /*
         * Bo'lim bloklarida `figure` bloki bo'lsa (dvigatel OMR PNG ini
         * shunday joylashtiradi) u ALLAQACHON chizilgan — takroriy
         * o'rinbosar ramka qo'shilmaydi.
         */
        const count = t.questions.filter((q) => isOmrQuestionKind(q.kind)).length || t.omr.count;
        pushFigure("omr", L.omrCaption(count), "teacher.test.omr", (model.figures ?? []).find((f) => f.id === "omr"));
      }
    }
  };

  /* ── bo'limlar (hujjat tartibida) ── */

  /**
   * Bo'lim sarlavhasi: dvigatel yozgani ustun, bo'sh bo'lsa yorliqdan.
   *
   * Old RAQAM olib tashlanadi. `i18n.ts` dagi `subjectPassport`
   * «1. Fan pasporti» — raqam eski (bo'limlari qo'lda raqamlangan)
   * xarita shaklidan qolgan va dvigatel uni sarlavha sifatida yozadi.
   * Yangi maketda bo'limlar raqamlanmaydi: ko'z tekshiruvida birinchi
   * sarlavha «1.» bilan, qolganlari raqamsiz chiqqan edi.
   */
  const headingOf = (s: DocSection): string => {
    const own = clean(s.title).replace(/^\d+\.\s+/, "");
    if (own) return own;
    const q = quarterIndexOf(s.id);
    if (kind === "map" && q !== null) return L.quarter(q);
    const c = caseIndexOf(s.id);
    if (kind === "keys" && c !== null) return `${L.caseWord} ${c}`;
    const v = variantIdOf(s.id);
    if (kind === "test" && v) return `${L.variant} ${v}`;
    const byId: Record<string, string> = {
      passport: kind === "map" ? L.subjectPassport : L.lessonPassport,
      goal: L.goal,
      stages: L.stages,
      homework: L.homework,
      assessment: L.assessment,
      intro: L.intro,
      terms: L.terms,
      rubric: L.rubric,
      year: L.yearPlan,
      instructions: L.instructions,
      key: L.answersKey,
      criteria: L.criteria,
      omr: L.omrSheet,
    };
    /*
     * `i18n.ts` dagi `subjectPassport` «1. Fan pasporti» — raqam eski
     * (bo'limlari qo'lda raqamlangan) xarita shaklidan qolgan. Yangi
     * maketda bo'limlar raqamlanmaydi, shuning uchun old raqam olib
     * tashlanadi: aks holda birinchi sarlavha «1.» bilan, qolganlari
     * raqamsiz chiqardi.
     */
    return (byId[s.id] ?? "").replace(/^\d+\.\s*/, "");
  };

  /**
   * YANGI BETDAN: test variantlari, javoblar kaliti va OMR varag'i.
   * Boshqa vositalarda majburiy uzilish YO'Q — dars ishlanmasi 1–2 bet,
   * har bo'limni betga chiqarish qog'ozni behuda sarflardi (keys
   * rubrikasi ham alohida bet TALAB QILMAYDI — WP-A shartnomasi).
   *
   * BIRINCHI variant — ISTISNO: u ko'rsatmadan keyin O'SHA betda
   * boshlanadi. Uzilish qo'yilganda 1-bet shapka + 4 qatorlik
   * ko'rsatma bilan deyarli bo'sh qolardi (LibreOffice ko'z
   * tekshiruvi), holbuki ko'rsatma aynan variant boshida o'qiladi.
   * Uzilish faqat variantlar ORASIDA kerak: har o'quvchi o'z
   * variantini alohida varaqda oladi.
   */
  const firstVariantId = doc.sections.find((s) => variantIdOf(s.id))?.id ?? "";
  const breaksAt = (id: string): boolean =>
    kind === "test" && ((Boolean(variantIdOf(id)) && id !== firstVariantId) || id === "key" || id === "omr");

  const drawn = new Set<DocTable>();
  const anchored = new Map<string, DocTable[]>();
  for (const t of docTables) {
    if (t.anchor) anchored.set(t.anchor, [...(anchored.get(t.anchor) ?? []), t]);
  }

  doc.sections.forEach((s, i) => {
    const path = `sections.${i}`;
    const heading = headingOf(s);
    if (heading) {
      if (breaksAt(s.id)) pageBreaks.push(s.id);
      body.push({ k: "h1", text: heading, sectionId: s.id, path: `${path}.title`, pageBreak: breaksAt(s.id) });
    }
    // Pasport bo'limi shapkani TAKRORLAMAYDI (yuqoridagi `isHeadRecap`).
    pushBlocks(s.blocks, path, { dropHeadRecap: s.id === "passport", dropStudentLine: kind === "test" && s.id === "instructions" });
    const own = anchored.get(s.id) ?? [];
    for (const t of own) {
      if (drawn.has(t)) continue;
      pushDocTable(t);
      drawn.add(t);
    }
    attach(s.id, s.blocks.length > 0, own.length > 0);
  });

  /*
   * Bo'limga bog'lanmagan (yoki mavjud bo'lmagan bo'limga langarlangan)
   * jadval YO'QOLMASIN — eski hujjatlardagi xatti-harakat.
   */
  for (const t of docTables) {
    if (drawn.has(t)) continue;
    if (t.anchor && doc.sections.some((s) => s.id === t.anchor)) continue;
    pushDocTable(t);
    drawn.add(t);
  }

  return {
    model,
    kind,
    type: model.type,
    language,
    labels: L,
    head,
    body,
    tables,
    pageBreaks,
    landscape: TEACHER_LANDSCAPE[kind],
    numbers,
    tablePaths,
    page: { marginsCm: TEACHER_MARGINS_CM[kind], ...TEACHER_TYPE[kind] },
    headingAlign: "left",
    legacy,
  };
}
