/**
 * O'QITUVCHI VOSITALARI 2 (AUDIT-20 R0) — 5 vositaning YAGONA modeli.
 * Izomorf: server/DOM/sharp importi YO'Q (`work/types.ts` naqshi).
 *
 * Bitta dvigatel (`teacher/engine.ts`, WP-A/WP-B), bitta qobiq
 * (hisobot/sayqal/tahrir/maket) — lekin har vosita O'Z modeli bilan:
 * dars rejasining bosqichlari bilan testning savollari orasida umumiy
 * shakl yo'q, ularni bitta «universal» tuzilmaga tiqish maketni ham,
 * hisobot qoidalarini ham noaniq qilardi.
 *
 * MATN bu yerda YO'Q: hujjat matni odatdagidek `AcademicDoc.sections`
 * da qoladi (`paginate.ts`, `guardSection`, tahrir oplari o'zgarmaydi),
 * `TeacherModel` esa METAMA'LUMOT — maktab shapkasi, tur, bosqich/hafta/
 * atama/keys/savol tuzilmasi, hisobot. Tartib va raqamlash ham bu yerda
 * emas: uni `teacher/layout.ts planTeacher` (WP-C) beradi — DOCX ham,
 * ko'ruvchi ham undan o'qiydi.
 *
 * Reyestr (tur → skelet/chegara/guidance/JudgeSpec) — `registry.ts`.
 */
import type { DocReview, PolishLog, UserNeed } from "../report/types";
import type { Figure, FigureSpec } from "../types";

/* ────────────────────────── kind va vosita ────────────────────────── */

export const TEACHER_KINDS = ["lesson", "map", "glossary", "keys", "test"] as const;
export type TeacherKind = (typeof TEACHER_KINDS)[number];

export const isTeacherKind = (v: unknown): v is TeacherKind => (TEACHER_KINDS as readonly string[]).includes(String(v));

/**
 * Vosita id ↔ kind xaritasi — YAGONA manba.
 *
 * `write-llm.ts` dispatchi, `viewerKind`, `budgetFor` va forma shu
 * jadvaldan o'qiydi; ilgari har biri o'z `if` zanjirini yozardi va
 * yangi vosita (`test`) qo'shilganda ular ajralib ketishi mumkin edi.
 */
export const TEACHER_TOOL_IDS = {
  "lesson-plan": "lesson",
  "texnologik-xarita": "map",
  glossary: "glossary",
  keys: "keys",
  test: "test",
} as const satisfies Record<string, TeacherKind>;

export type TeacherToolId = keyof typeof TEACHER_TOOL_IDS;

/** Vosita id lari — kind tartibida (lesson → map → glossary → keys → test). */
export const TEACHER_TOOL_LIST = Object.keys(TEACHER_TOOL_IDS) as TeacherToolId[];

/** Teskari yo'nalish: kind → vosita id (havola, `hrefBase`, jonli sinov). */
export const TEACHER_TOOL_BY_KIND = Object.fromEntries(
  (Object.entries(TEACHER_TOOL_IDS) as [TeacherToolId, TeacherKind][]).map(([tool, kind]) => [kind, tool]),
) as Record<TeacherKind, TeacherToolId>;

export const isTeacherToolId = (v: unknown): v is TeacherToolId => Object.prototype.hasOwnProperty.call(TEACHER_TOOL_IDS, String(v));

/* ────────────────────────── maktab shapkasi ────────────────────────── */

/**
 * Rasmiy hujjat SHAPKASI — beshala vosita uchun bir xil (R1: rasmiy
 * yagona blank yo'q, amaldagi konvensiya reyestrga olindi).
 *
 * `approver` — «Tasdiqlayman» qatoridagi LAVOZIM (direktor o'rinbosari,
 * metodik kengash raisi); bo'sh bo'lsa qator chizilmaydi. Test
 * vositasida u faqat `bsb`/`chsb` turlarida chiziladi (R3 §3.7).
 */
export type TeacherSchool = {
  institution: string;
  author: string;
  subject: string;
  /** 1–11; 0 — sinf ko'rsatilmagan (OTM auditoriyasi — `KeysModel.audience`). */
  grade: number;
  /** «5-A» dagi «A» (R1 qarori: `lesson-plan` ga qo'shildi). */
  gradeLetter?: string;
  /** ISO `YYYY-MM-DD` — shapkadagi sana. */
  date?: string;
  language: string;
  approver?: string;
};

/* ────────────────────────── dars rejasi ────────────────────────── */

/**
 * Dars bosqichi. `teacher`/`student` — kim nima qiladi (rasmiy
 * ishlanmada ikki ustun), `method` — interaktiv usul, `result` —
 * kutilgan natija (`timeCols` uchinchi ustuni).
 */
export type LessonStage = {
  title: string;
  minutes: number;
  teacher: string;
  student: string;
  method: string;
  result: string;
};

export type LessonModel = {
  /** Reyestr tur id (`yangi-mavzu`…) — `TeacherModel.type` bilan AYNI. */
  type: string;
  /** Uch maqsad: ta'limiy, tarbiyaviy, rivojlantiruvchi (DTS konvensiyasi). */
  goal: { talim: string; tarbiya: string; rivoj: string };
  competencies: string[];
  equipment: string[];
  stages: LessonStage[];
  homework: string;
  /** Baholash usuli/mezoni (an'anaviy yoki BSB-mos — `assessmentStyle`). */
  assessment: string;
  /** Dars davomiyligi; bosqich daqiqalari yig'indisi SHUNGA teng (`minutesSum`). */
  durationMin: number;
};

/* ────────────────────────── texnologik xarita ────────────────────────── */

export type MapWeek = {
  n: number;
  topic: string;
  hours: number;
  method: string;
  resources: string;
  control: string;
};

/** `n` — chorak raqami (1–4). `yillik` turda bitta blok (`n = 0`) bo'ladi. */
export type MapQuarter = { n: number; weeks: MapWeek[] };

export type MapModel = {
  /** `yillik` — bitta jadval; `choraklik` — 4 jadval (R1 qarori). */
  type: "yillik" | "choraklik";
  weeklyHours: number;
  totalHours: number;
  quarters: MapQuarter[];
};

/* ────────────────────────── glossariy ────────────────────────── */

export type GlossaryTerm = {
  term: string;
  def: string;
  example?: string;
  /** Faqat `uch-tilli` turda (R2): tarjima ustunlari. */
  ru?: string;
  en?: string;
};

/** Alifbo tartibi (`Intl.Collator`, mavjud qoida) yoki manba tartibi. */
export type GlossaryOrder = "alpha" | "source";

export type GlossaryModel = {
  type: string;
  terms: GlossaryTerm[];
  order: GlossaryOrder;
};

/* ────────────────────────── keys ────────────────────────── */

export type KeysRubricRow = { criterion: string; points: number };

export type KeysCase = {
  title: string;
  situation: string;
  questions: string[];
  /** Namunaviy kalit (`hasSolution` qoidasi bo'sh emasligini tekshiradi). */
  solution: string;
  rubric: KeysRubricRow[];
};

/** Auditoriya rubrika shkalasi va til murakkabligini o'zgartiradi (R2). */
export type KeysAudience = "maktab" | "otm";

export type KeysModel = {
  type: string;
  audience: KeysAudience;
  cases: KeysCase[];
};

/* ────────────────────────── test ────────────────────────── */

export const TEST_MODES = ["topic", "file", "curriculum"] as const;
export type TestMode = (typeof TEST_MODES)[number];
export const isTestMode = (v: unknown): v is TestMode => (TEST_MODES as readonly string[]).includes(String(v));

export const TEST_QUESTION_KINDS = ["single", "multi", "truefalse", "open", "match"] as const;
export type TestQuestionKind = (typeof TEST_QUESTION_KINDS)[number];

/** Bloom (Anderson 2001) — `evaluate`/`create` FAQAT `open` savolda (R3 §3.5). */
export const BLOOM_LEVELS = ["remember", "understand", "apply", "analyze", "evaluate", "create"] as const;
export type BloomLevel = (typeof BLOOM_LEVELS)[number];
/** MCQ bilan ishonchli o'lchanmaydigan darajalar. */
export const BLOOM_OPEN_ONLY: readonly BloomLevel[] = ["evaluate", "create"];

export const TEST_DIFFICULTIES = ["oson", "orta", "qiyin"] as const;
export type TestDifficulty = (typeof TEST_DIFFICULTIES)[number];

/** `match` javobi: chap indeks → o'ng indeks. */
export type TestMatchPair = { left: number; right: number };

/**
 * Javob SHAKLI savol turiga bog'liq:
 *   single     → `number`            (to'g'ri variant indeksi)
 *   multi      → `number[]`          (2–3 indeks)
 *   truefalse  → `boolean`
 *   open       → `string`            (namunaviy javob)
 *   match      → `TestMatchPair[]`
 */
export type TestAnswer = number | number[] | boolean | string | TestMatchPair[];

export type TestQuestion = {
  id: string;
  kind: TestQuestionKind;
  stem: string;
  /** `open` da bo'sh; `match` da chap+o'ng ro'yxat maketda ajratiladi. */
  options: string[];
  answer: TestAnswer;
  points: number;
  bloom: BloomLevel;
  difficulty: TestDifficulty;
  explanation: string;
  /** `mode:"curriculum"` — qaysi mavzudan (`curriculumCoverage` qoidasi). */
  topicId?: string;
  /**
   * `mode:"file"` — manbadagi IQTIBOS (10–25 so'z). `normalizeQuote` dan
   * keyin manba matnida topilmasa savol O'CHIRILADI (R3 §3.8) — «AI
   * o'ylab topmaydi» va'dasi shu maydon bilan tekshiriladigan bo'ladi.
   */
  source?: { quote: string; section?: string };
};

/**
 * Variant — YANGI savol emas, faqat TARTIB (R3 §3.4): bitta savol
 * bazasi, seeded Fisher–Yates. Shuning uchun qiyinlik pariteti
 * kafolatlanadi va `variantParity` qoidasi buni tekshira oladi.
 *
 *   `order[i]`        — i-o'rinda turadigan savolning `questions` indeksi;
 *   `optionOrder[i]`  — shu savol variantlarining yangi tartibi.
 */
export type TestVariant = { id: string; order: number[]; optionOrder: number[][] };

/** BSB/ChSB mezon+ball jadvali (R3 §3.7, N-1 ustunlari). */
export type TestCriterion = {
  criterion: string;
  points: number;
  /** Baholanadigan ko'nikma. */
  skill?: string;
  /** Qaysi topshiriq (`TestQuestion.id`). */
  taskRef?: string;
};

/** Ball → baho jadvali (R3: 86–100→5, 66–85→4, 30–65→3, 0–29→2). */
export type GradeBand = { minPercent: number; maxPercent: number; grade: number };

export type TestScoring = {
  /** Standart savol bahosi; `open` savol o'z `points` i bilan yuqoriroq. */
  perQuestion: number;
  total: number;
  gradeScale: GradeBand[];
};

/**
 * OMR blokining STRUKTURAVIY tavsifi — `FigureSpec kind:"omr"` bilan
 * AYNI (chizuvchi WP-B da). Ikki joyda qo'lda yozilsa ajralib ketardi,
 * shuning uchun bu yerda `FigureSpec` dan olinadi.
 */
export type TestOmr = Omit<Extract<FigureSpec, { kind: "omr" }>, "kind">;

export type TestModel = {
  mode: TestMode;
  type: string;
  questions: TestQuestion[];
  variants: TestVariant[];
  /** Variant id → javob harflari (`["B","D",…]`); uzunligi = savol soni. */
  key: Record<string, string[]>;
  scoring: TestScoring;
  /** Ko'rsatma qatorlari (3–5) — savol soni, vaqt, ball taqsimoti. */
  instructions: string[];
  timeMin: number;
  /** `mode:"curriculum"` — tanlangan mavzular (`lib/curriculum.ts` id lari). */
  topicIds: string[];
  criteria?: TestCriterion[];
  omr?: TestOmr;
};

/* ────────────────────────── model ────────────────────────── */

export type TeacherModel = {
  v: 1;
  kind: TeacherKind;
  /**
   * Reyestr TUR id (`registry.ts teacherTypeOf`) — masalan `yangi-mavzu`,
   * `choraklik`, `uch-tilli`, `muammoli`, `bsb`. Kind modelidagi `type`
   * bilan bir xil qiymat; bu yerda — chunki hisobot, prompt va maket
   * turni kind modelini ochmasdan bilishi kerak.
   */
  type: string;
  school: TeacherSchool;
  lesson?: LessonModel;
  map?: MapModel;
  glossary?: GlossaryModel;
  keys?: KeysModel;
  test?: TestModel;
  /**
   * Chizilgan rasmlar reyestri (hozircha faqat OMR javoblar varag'i).
   *
   * `Block kind:"figure"` `figureId` orqali SHU ro'yxatga ishora qiladi —
   * `article`/`work` bilan bir xil naqsh. Nega modelda, blok ichida
   * emas: PNG `data:` URL i kilobaytlar bilan o'lchanadi va uni matn
   * bloki ichida saqlash `sections` ni ham tahrirda, ham qidiruvda
   * og'irlashtirardi; `assets.ts` (WP-D) esa aynan shu ro'yxatdan
   * baytni aktivga chiqaradi.
   */
  figures?: Figure[];
  review?: DocReview;
  polish?: PolishLog;
  /** «Sizdan kutiladi» — AI o'ylab topmaydigan ma'lumot (hisobot paneli). */
  userNeeds?: UserNeed[];
};

/* ────────────────────────── chegaralar ────────────────────────── */

/**
 * Butun oila uchun QATTIQ chegaralar (kirish kesish, byudjet, DOCX).
 * Tur bo'yicha nozik chegaralar (nechta bosqich, nechta savol, qaysi
 * savol turlari) — REYESTRDA: ular turga qarab o'zgaradi.
 */
export const TEACHER_LIMITS = {
  /* dars rejasi */
  stagesMin: 4,
  stagesMax: 8,
  durationMin: 30,
  durationMax: 90,
  competenciesMax: 6,
  equipmentMax: 10,

  /* texnologik xarita */
  weeksMin: 8,
  weeksMax: 36,
  quarters: 4,
  weeklyHoursMax: 20,
  totalHoursMax: 400,

  /* glossariy */
  termsMin: 6,
  termsMax: 40,
  defCharsMin: 40,
  defCharsMax: 420,

  /* keys */
  casesMin: 3,
  casesMax: 8,
  caseQuestionsMin: 2,
  caseQuestionsMax: 4,
  rubricMin: 3,
  rubricMax: 5,
  /** Rubrika ball yig'indisi (R2: qat'iy 10). */
  rubricTotal: 10,
  situationCharsMin: 120,
  situationCharsMax: 420,

  /* test */
  questionsMin: 5,
  questionsMax: 40,
  optionsMin: 3,
  optionsMax: 4,
  stemCharsMin: 15,
  stemCharsMax: 200,
  optionChars: 60,
  matchPairsMin: 4,
  matchPairsMax: 6,
  multiAnswersMin: 2,
  multiAnswersMax: 3,
  instructionsMax: 5,
  quoteWordsMin: 10,
  quoteWordsMax: 25,
  /** OMR: ustunda 10 savol, ≤4 ustun ⇒ ≤40 savol sig'adi (`omrFits`). */
  omrPerColumn: 10,
  omrColumnsMax: 4,
  /** Test kodi kataklari (kelajakdagi skanerlash uchun). */
  omrIdBoxes: 6,

  /* umumiy kirish */
  topicChars: 300,
  extraChars: 1500,
  sourceTextChars: 24_000,
  curriculumTopicsMax: 5,
} as const;

/** Variant soni tanlovi (R3 §3.4 + egasi qarori): 1 / 2 / 4, standart 2 (A/B). */
export const TEST_VARIANT_CHOICES = [1, 2, 4] as const;
export const TEST_VARIANT_DEFAULT = 2;
/** Variant yorliqlari — `A`, `B`, `C`, `D`. */
export const TEST_VARIANT_IDS = ["A", "B", "C", "D"] as const;

/**
 * 1–4-sinfda javob varianti 3 ta, 5–11-sinfda 4 ta (R3 §3.3, S-19/S-10).
 * Sinf berilmasa (0 yoki OTM) — 4.
 */
export function optionCountForGrade(grade: number): number {
  const g = Number(grade);
  return Number.isFinite(g) && g >= 1 && g <= 4 ? TEACHER_LIMITS.optionsMin : TEACHER_LIMITS.optionsMax;
}

/** Ruxsat etilgan variant soni; noma'lum qiymat → standart 2. */
export function normalizeVariantCount(v: unknown): number {
  const n = Number(v);
  return (TEST_VARIANT_CHOICES as readonly number[]).includes(n) ? n : TEST_VARIANT_DEFAULT;
}

/** Savol turi javob varaqasiga (OMR) tushadimi — `open`/`match` tushmaydi. */
export const isOmrQuestionKind = (k: TestQuestionKind): boolean => k === "single" || k === "multi" || k === "truefalse";
