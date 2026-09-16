/**
 * TEST KIRISHI (AUDIT-20 WP-B) — formadan dvigatelgacha.
 *
 * `work/input.ts` naqshi: `FormValues` bilan `TestInput` orasidagi
 * YAGONA ko'prik. Nega `DocMeta` yetmaydi: `extractMeta` umumiy va
 * `mode`/`testType`/`variants`/`topicIds` kabi maydonlarni bilmaydi,
 * `grade`/`subject` esa undan keladi — ikkala manba shu yerda
 * BIRLASHTIRILADI, boshqa hech joyda parse qilinmaydi.
 *
 * Har qiymat REYESTRDAN chegaralanadi (`teacher/registry.ts`): forma
 * yuborgan «40 savol» diagnostika turida yo'q bo'lsa, turning eng yaqin
 * ruxsat etilgan chipiga tushadi — dvigatel hech qachon reyestrdan
 * tashqari son bilan ishlamaydi.
 *
 * Server importi YO'Q (izomorf).
 */
import type { FormValues } from "../../../types";
import type { DocMeta } from "../../types";
import {
  TEACHER_LIMITS,
  TEST_MODES,
  TEST_QUESTION_KINDS,
  isTestMode,
  normalizeVariantCount,
  optionCountForGrade,
  type TestMode,
  type TestQuestionKind,
} from "../types";
import { DIFFICULTY_MIX, teacherTypeOf, type DifficultyProfileId, type TestTypeSpec } from "../registry";

export type AnswerKeyPlace = "alohida-bet" | "oxirgi-bet" | "yoq";

export type TestInput = {
  mode: TestMode;
  /** Reyestr tur id (`nazorat`, `bsb`, `chsb`, `dtm`, `olimpiada`, `diagnostika`). */
  type: string;
  topic: string;
  subject: string;
  grade: number;
  language: string;
  count: number;
  /** Ochiq topshiriqlar soni — tur `openShare` idan yoki formadan. */
  openCount: number;
  kinds: TestQuestionKind[];
  difficulty: DifficultyProfileId;
  variants: number;
  omr: boolean;
  answerKey: AnswerKeyPlace;
  criteriaTable: boolean;
  timeMin: number;
  topicIds: string[];
  /** Har savolning variantlar soni (3 yoki 4). */
  optionCount: number;
  /** E'lon qilingan jami ball (`null` — 1 ball/savol). */
  totalPoints: number | null;
  extra: string;
  /** Shapka. */
  institution: string;
  author: string;
  gradeLetter: string;
  date: string;
  approver: string;
};

const s = (v: unknown, max = 300): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Ro'yxatdagi eng yaqin ruxsat etilgan qiymat (chip). */
export function nearestChoice(want: number | null, choices: readonly number[], fallback: number): number {
  if (want === null || !choices.length) return fallback;
  return choices.reduce((best, c) => (Math.abs(c - want) < Math.abs(best - want) ? c : best), choices[0]);
}

function parseList(v: unknown): string[] {
  const raw = v ?? "";
  if (Array.isArray(raw)) return raw.map((x) => s(x, 120)).filter(Boolean);
  const text = String(raw).trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.map((x) => s(x, 120)).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return text.split(",").map((x) => s(x, 120)).filter(Boolean);
}

const isProfile = (v: unknown): v is DifficultyProfileId => Object.prototype.hasOwnProperty.call(DIFFICULTY_MIX, String(v));

/**
 * Ochiq topshiriqlar soni: forma bermasa turning `openShare` idan.
 * Chegara — savollarning yarmi (R3 §3.3), chunki ochiq topshiriq
 * javob varag'iga tushmaydi va tekshirish vaqtini keskin oshiradi.
 */
export function openCountOf(values: FormValues, spec: TestTypeSpec, count: number, kinds: readonly TestQuestionKind[]): number {
  if (!kinds.includes("open")) return 0;
  const want = num(values.openCount);
  const base = want === null ? Math.round(count * spec.limits.openShare) : Math.round(want);
  return Math.max(0, Math.min(Math.floor(count / 2) || (count >= 1 ? 1 : 0), base));
}

export function testInputFromValues(meta: DocMeta, values: FormValues): TestInput {
  const spec = teacherTypeOf("test", values.testType ?? values.type);
  const L = spec.limits;

  const modeRaw = s(values.mode, 20) || TEST_MODES[0];
  const mode: TestMode = isTestMode(modeRaw) ? modeRaw : "topic";
  const grade = Math.max(0, Math.min(11, Math.round(num(values.grade) ?? num(meta.grade) ?? 0)));
  const count = nearestChoice(num(values.count), L.count, L.countDefault);

  // Savol turlari: forma tanlovi ∩ turning ruxsati (bo'sh bo'lsa — tur).
  const wanted = parseList(values.questionKinds).filter((k): k is TestQuestionKind => (TEST_QUESTION_KINDS as readonly string[]).includes(k));
  const kinds = (wanted.length ? wanted.filter((k) => L.kinds.includes(k)) : [...L.kinds]) as TestQuestionKind[];
  if (!kinds.length) kinds.push(L.kinds[0] ?? "single");

  const difficulty: DifficultyProfileId = isProfile(values.difficulty) ? values.difficulty : spec.id === "dtm" ? "dtm" : "aralash";
  const topicIds = mode === "curriculum" ? parseList(values.topicIds).slice(0, TEACHER_LIMITS.curriculumTopicsMax) : [];
  const answerKeyRaw = s(values.answerKey, 20);
  const answerKey: AnswerKeyPlace = answerKeyRaw === "oxirgi-bet" || answerKeyRaw === "yoq" ? answerKeyRaw : "alohida-bet";

  return {
    mode,
    type: spec.id,
    topic: s(values.topic ?? meta.topic, TEACHER_LIMITS.topicChars),
    subject: s(values.subject ?? meta.subject, 120),
    grade,
    language: s(values.language ?? meta.language, 12) || "uz",
    count,
    openCount: openCountOf(values, spec, count, kinds),
    kinds,
    difficulty,
    variants: normalizeVariantCount(values.variants),
    // OMR: forma aniq «yo'q» demasa — yoqiq (R3 §3.2 standarti).
    omr: values.omr === undefined || values.omr === null || values.omr === "" ? true : values.omr !== false && values.omr !== "false" && values.omr !== 0,
    answerKey,
    criteriaTable: values.criteriaTable === undefined || values.criteriaTable === null || values.criteriaTable === ""
      ? L.criteriaTable
      : values.criteriaTable !== false && values.criteriaTable !== "false" && values.criteriaTable !== 0,
    timeMin: nearestChoice(num(values.timeMin), L.timeMin, L.timeMinDefault),
    topicIds,
    optionCount: L.optionCountFixed ?? optionCountForGrade(grade),
    totalPoints: L.totalPoints,
    extra: s(values.extra ?? meta.extra, TEACHER_LIMITS.extraChars),
    institution: s(values.university ?? meta.university, 200),
    author: s(values.author ?? meta.author, 120),
    gradeLetter: s(values.gradeLetter, 4),
    date: s(values.date, 20),
    // «Tasdiqlayman» qatori faqat bsb/chsb da (R3 §3.7).
    approver: L.approver ? s(values.approver, 160) : "",
  };
}
