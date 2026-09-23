/**
 * O'QITUVCHI VOSITALARI KIRISHI (AUDIT-20 WP-A) — formadan dvigatelgacha.
 *
 * `work/input.ts` naqshi: `FormValues` bilan `TeacherInput` orasidagi
 * YAGONA ko'prik, ikki tomonga ishlaydi —
 *   • `teacherInputFromValues(meta, values)` — server (dvigatel, zond);
 *   • `encodeTeacherValues(input)`           — klient (qoralama, forma).
 * Ikkalasi bitta faylda, chunki JSON maydonlar shakli
 * (`TEACHER_JSON_FIELDS`) AYNAN mos bo'lishi kerak.
 *
 * Nega `DocMeta` YETARLI EMAS: `extractMeta` umumiy va u `lessonType`,
 * `stageCount`, `competencies`, `mapType`, `controlLink`, `glossaryType`,
 * `includeExample`, `translationLangs`, `keysType`, `caseCount`,
 * `audience`, `gradeLetter`, `date` maydonlarini BILMAYDI. Shu bilan
 * birga `meta` dan voz kechib ham bo'lmaydi: shapka maydonlari
 * (`university`, `author`, `subject`, `language`) va fayl rejimidagi
 * `sourceText` o'sha yerdan keladi. Shuning uchun imzo IKKALASINI ham
 * oladi va normalizatsiya BITTA joyda turadi.
 *
 * DIAPAZON QAYTA TEKSHIRILADI (R0 ochiq band 3): forma nima yuborishidan
 * qat'i nazar `duration`, `grade`, `weeklyHours`, `totalHours`,
 * `termCount`, `caseCount`, `stageCount` shu yerda reyestr va
 * `TEACHER_LIMITS` chegaralariga siqiladi — mijoz tomonida
 * tekshirilgan qiymat server uchun DALIL emas.
 *
 * SON maydonlari `meta` DAN O'QILMAYDI, faqat `values` dan: `extractMeta`
 * ularga O'Z standartini qo'yadi (`duration: 45`, `grade: 8`,
 * `termCount: 10`, `weeklyHours: 4`) va u hech qachon `undefined`
 * bo'lmaydi — natijada REYESTR standarti («amaliy dars 90 daqiqa»,
 * «imtihon atamalari 20 ta») hech qachon ishlamasdi va tur tanlash
 * qisman bezakka aylanardi.
 *
 * Server importi YO'Q (izomorf: formadan ham chaqiriladi).
 */
import type { FormValues } from "../../types";
import type { DocMeta } from "../types";
import { TEACHER_LIMITS, type KeysAudience, type TeacherKind } from "./types";
import { teacherTypeOf, type GlossaryTypeSpec, type KeysTypeSpec, type LessonTypeSpec, type MapTypeSpec } from "./registry";

/* ────────────────────────── tiplar ────────────────────────── */

export type TeacherLang = "uz" | "ru" | "en";

/** Baholash uslubi — an'anaviy baho yoki BSB-mos mezonli (R1 §3). */
export type AssessmentStyle = "an'anaviy" | "bsb";

/** Nazorat ustuni erkinmi yoki BSB/ChSB ga bog'lanadimi (R1 xarita §3). */
export type ControlLink = "erkin" | "bsb-chsb";

export type TeacherInput = {
  kind: TeacherKind;
  /** Reyestr tur id (`teacherTypeOf`) — kind modelidagi `type` bilan AYNI. */
  type: string;
  topic: string;
  /** Fan nomi. Xaritada `topic` ning O'ZI fan bo'lishi mumkin (forma bitta maydon so'raydi). */
  subject: string;
  language: TeacherLang;
  /* ── shapka ── */
  institution: string;
  author: string;
  approver: string;
  /** 1–11; 0 — sinf ko'rsatilmagan (OTM auditoriyasi). */
  grade: number;
  gradeLetter: string;
  /** ISO `YYYY-MM-DD` yoki bo'sh. */
  date: string;
  extra: string;
  /** Fayl rejimi matni (`meta.sourceText` yoki `values.sourceText`). */
  sourceText: string;
  /* ── dars rejasi ── */
  duration: number;
  stageCount: number;
  competencies: string[];
  assessmentStyle: AssessmentStyle;
  /* ── texnologik xarita ── */
  mapType: "yillik" | "choraklik";
  weeklyHours: number;
  totalHours: number;
  controlLink: ControlLink;
  /* ── glossariy ── */
  termCount: number;
  includeExample: boolean;
  translationLangs: string[];
  /* ── keys ── */
  caseCount: number;
  audience: KeysAudience;
  /* ── o'quv dasturi (ixtiyoriy, dars rejasi va xarita uchun) ── */
  /** `lib/curriculum.ts` fan id si; bo'sh — darslik rejimi ishlatilmaydi. */
  curriculumSubject: string;
  topicIds: string[];
};

/* ────────────────────────── yordamchilar ────────────────────────── */

const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : typeof v === "number" ? String(v) : "";

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

const bool = (v: unknown, fallback: boolean): boolean =>
  v === undefined || v === null || v === "" ? fallback : v !== false && v !== "no" && v !== "false" && v !== 0 && v !== "0";

const num = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = Number(v);
  return Math.max(min, Math.min(max, Number.isFinite(n) && n !== 0 ? Math.round(n) : fallback));
};

const isLang = (v: string): v is TeacherLang => v === "uz" || v === "ru" || v === "en";

/**
 * JSON maydon (`TEACHER_JSON_FIELDS`) -> satrlar ro'yxati.
 *
 * Forma JSON yuboradi (`'["A","B"]'`), qoralama esa massiv saqlashi
 * mumkin, eski chaqiruvchi vergulli satr yuborishi mumkin — uchalasi
 * ham qabul qilinadi. Buzuq JSON JIMGINA bo'sh ro'yxatga tushadi:
 * generatsiyani 400 bilan to'xtatish foydalanuvchiga hech narsa
 * bermaydi, maydon esa ixtiyoriy.
 */
export function parseTeacherList(raw: unknown, max: number, itemChars = 120): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    const s = str(v, itemChars);
    if (s && !out.includes(s)) out.push(s);
  };
  if (Array.isArray(raw)) raw.forEach(push);
  else if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return [];
    if (t.startsWith("[")) {
      try {
        const j: unknown = JSON.parse(t);
        if (Array.isArray(j)) j.forEach(push);
      } catch {
        /* buzuq JSON — maydon ixtiyoriy, bo'sh ro'yxat */
      }
    } else t.split(/[;,\n]/).forEach(push);
  }
  return out.slice(0, max);
}

/** `YYYY-MM-DD` bo'lsa o'zi, aks holda bo'sh (shapkada qator chizilmaydi). */
function isoDate(v: unknown): string {
  const s = str(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

/** «5-A» dagi «A» — bitta harf (lotin yoki kirill), aks holda bo'sh. */
function gradeLetterOf(v: unknown): string {
  const s = str(v, 2).toUpperCase();
  return /^[A-ZА-Я]$/u.test(s) ? s : "";
}

/**
 * Formadagi tur maydoni kind bo'yicha boshqacha nomlanadi
 * (`lessonType`, `mapType`, `glossaryType`, `keysType`, `testType` —
 * `teacher-params.ts`). Bitta `type` maydoni bo'lmaganining sababi:
 * bitta formada bir nechta vosita qoralamasi saqlanishi mumkin va
 * ular bir-birining turini bosib ketmasligi kerak.
 */
const TYPE_FIELD: Record<TeacherKind, string> = {
  lesson: "lessonType",
  map: "mapType",
  glossary: "glossaryType",
  keys: "keysType",
  test: "testType",
};

/** Kindning tur maydonidan reyestr tur id si (noma'lum -> standart). */
export function teacherTypeIdOf(kind: TeacherKind, values: FormValues): string {
  const raw = values[TYPE_FIELD[kind]] ?? values.type ?? values.kind;
  return teacherTypeOf(kind, raw).id;
}

/**
 * Glossariy atama soni — dvigatel bilan BIR XIL klamp (C12, W3-J).
 *
 * `teacherInputFromValues`dagi `termCount` hisobi shu yerga chiqarildi:
 * `lib/tools.ts priceFor` ilgari `termCount`ni xom holda 3 ta tarifdan
 * (10/20/40) qidirar, dvigatel esa `glossarySpec.limits.termsMin`..40
 * oralig'ida ISTALGAN sonni qabul qilardi — «39» kabi yaqin qiymat eng
 * arzon tarifda hisoblanib, dvigatel esa 39 atamalik (40 talik tarif)
 * hujjat yozardi. Narx endi AYNAN shu funksiyadan o'qiydi.
 */
export function glossaryTermCount(values: FormValues): number {
  const spec = teacherTypeOf("glossary", teacherTypeIdOf("glossary", values)) as GlossaryTypeSpec;
  return num(values.termCount, spec.limits.termsDefault, spec.limits.termsMin, TEACHER_LIMITS.termsMax);
}

/** Ruxsat etilgan qiymatlar ro'yxatidan eng yaqini (chiplar: 30/45/90). */
function nearest(allowed: readonly number[], v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  if (allowed.includes(n)) return n;
  return allowed.reduce((best, x) => (Math.abs(x - n) < Math.abs(best - n) ? x : best), allowed[0] ?? fallback);
}

/* ────────────────────────── kirish ────────────────────────── */

export function teacherInputFromValues(meta: DocMeta, values: FormValues, kind: TeacherKind): TeacherInput {
  const type = teacherTypeIdOf(kind, values);
  const langRaw = str(values.language ?? meta.language, 8).toLowerCase();
  const language: TeacherLang = isLang(langRaw) ? langRaw : "uz";

  /*
   * `topic` va `subject` — xaritada bir xil bo'lishi MUMKIN: forma
   * «Qaysi fan bo'yicha xarita kerak?» deb bitta maydon so'raydi
   * (`tools.ts topicLegend`). Shuning uchun bo'sh qolganini ikkinchisi
   * to'ldiradi, aks holda prompt «Fan: —» bilan chiqardi.
   */
  const topic = str(values.topic ?? meta.topic, TEACHER_LIMITS.topicChars);
  const subject = str(values.subject ?? meta.subject, 120) || topic;

  /* ── dars rejasi: tur chegaralari reyestrdan ── */
  const lessonSpec = kind === "lesson" ? (teacherTypeOf("lesson", type) as LessonTypeSpec) : null;
  const duration = lessonSpec
    ? Math.max(TEACHER_LIMITS.durationMin, Math.min(TEACHER_LIMITS.durationMax, nearest(lessonSpec.limits.durations, values.duration, lessonSpec.limits.durationDefault)))
    : num(values.duration, 45, TEACHER_LIMITS.durationMin, TEACHER_LIMITS.durationMax);
  const stageCount = lessonSpec
    ? num(values.stageCount, lessonSpec.limits.stagesDefault, lessonSpec.limits.stages[0], lessonSpec.limits.stages[1])
    : num(values.stageCount, 6, TEACHER_LIMITS.stagesMin, TEACHER_LIMITS.stagesMax);

  /* ── xarita: soatlar. `totalHours` haftalikdan kam bo'lolmaydi ── */
  const weeklyHours = num(values.weeklyHours, 4, 1, TEACHER_LIMITS.weeklyHoursMax);
  const totalHours = num(values.totalHours, 136, weeklyHours, TEACHER_LIMITS.totalHoursMax);

  /* ── glossariy: atama soni va tarjima ustunlari turdan ── */
  const glossarySpec = kind === "glossary" ? (teacherTypeOf("glossary", type) as GlossaryTypeSpec) : null;
  // Hisob `glossaryTermCount` bilan BIR XIL manbadan (C12) — narx ham shu funksiyani chaqiradi.
  const termCount = glossarySpec ? glossaryTermCount(values) : num(values.termCount, 10, TEACHER_LIMITS.termsMin, TEACHER_LIMITS.termsMax);
  /*
   * Tarjima ustunlari FAQAT turning ruxsat etganlari: `fan-lugati` da
   * `translationLangs: ["ru","en"]` yuborilsa ham jadval kengaymaydi —
   * aks holda forma turni almashtirgach eski qiymat «osilib» qolardi.
   */
  const allowedLangs = glossarySpec?.limits.translationLangs ?? [];
  const wantLangs = parseTeacherList(values.translationLangs, 2, 4).map((s) => s.toLowerCase());
  const translationLangs = allowedLangs.filter((l) => (wantLangs.length ? wantLangs.includes(l) : true));

  /* ── keys ── */
  const keysSpec = kind === "keys" ? (teacherTypeOf("keys", type) as KeysTypeSpec) : null;
  const caseCount = num(values.caseCount, keysSpec?.limits.casesDefault ?? 5, TEACHER_LIMITS.casesMin, TEACHER_LIMITS.casesMax);
  const audienceRaw = str(values.audience, 10).toLowerCase();
  const audience: KeysAudience = audienceRaw === "otm" ? "otm" : audienceRaw === "maktab" ? "maktab" : "otm";

  const mapSpec = kind === "map" ? (teacherTypeOf("map", type) as MapTypeSpec) : null;

  return {
    kind,
    type,
    topic,
    subject,
    language,
    institution: str(values.university ?? meta.university, 200),
    author: str(values.author ?? meta.author, 160),
    approver: str(values.approver, 160),
    grade: num(values.grade, 0, 0, 11),
    gradeLetter: gradeLetterOf(values.gradeLetter),
    date: isoDate(values.date),
    extra: text(values.extra ?? meta.extra, TEACHER_LIMITS.extraChars),
    sourceText: text(values.sourceText || meta.sourceText, TEACHER_LIMITS.sourceTextChars),

    duration,
    stageCount,
    competencies: parseTeacherList(values.competencies, TEACHER_LIMITS.competenciesMax, 120),
    assessmentStyle: str(values.assessmentStyle, 12).toLowerCase() === "bsb" ? "bsb" : "an'anaviy",

    mapType: mapSpec ? (mapSpec.id === "choraklik" ? "choraklik" : "yillik") : "yillik",
    weeklyHours,
    totalHours,
    controlLink: str(values.controlLink, 12).toLowerCase() === "bsb-chsb" ? "bsb-chsb" : "erkin",

    termCount,
    includeExample: bool(values.includeExample, glossarySpec?.limits.includeExampleDefault ?? true),
    translationLangs: [...translationLangs],

    caseCount,
    audience,

    curriculumSubject: str(values.subjectId, 60),
    topicIds: parseTeacherList(values.topicIds, TEACHER_LIMITS.curriculumTopicsMax, 120),
  };
}

/* ────────────────────────── teskari yo'l ────────────────────────── */

/**
 * `TeacherInput` -> `FormValues` (qoralama, zond, jonli sinov).
 *
 * Faqat SHU kind ga tegishli maydonlar yoziladi: xarita qoralamasida
 * `termCount` turishi forma uchun shovqin, `teacher-params.ts`
 * differensial zondi uchun esa yolg'on signal bo'lardi.
 */
export function encodeTeacherValues(input: TeacherInput): FormValues {
  const out: FormValues = {
    topic: input.topic,
    subject: input.subject,
    language: input.language,
    university: input.institution,
    author: input.author,
    grade: input.grade,
    [TYPE_FIELD[input.kind]]: input.type,
  };
  if (input.approver) out.approver = input.approver;
  if (input.gradeLetter) out.gradeLetter = input.gradeLetter;
  if (input.date) out.date = input.date;
  if (input.extra) out.extra = input.extra;
  if (input.sourceText) out.sourceText = input.sourceText;
  if (input.curriculumSubject) out.subjectId = input.curriculumSubject;
  if (input.topicIds.length) out.topicIds = JSON.stringify(input.topicIds);

  if (input.kind === "lesson") {
    out.duration = input.duration;
    out.stageCount = input.stageCount;
    out.competencies = JSON.stringify(input.competencies);
    out.assessmentStyle = input.assessmentStyle;
  }
  if (input.kind === "map") {
    out.weeklyHours = input.weeklyHours;
    out.totalHours = input.totalHours;
    out.controlLink = input.controlLink;
  }
  if (input.kind === "glossary") {
    out.termCount = input.termCount;
    out.includeExample = input.includeExample;
    out.translationLangs = input.translationLangs.join(",");
  }
  if (input.kind === "keys") {
    out.caseCount = input.caseCount;
    out.audience = input.audience;
  }
  return out;
}
