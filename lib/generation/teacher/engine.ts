/**
 * O'QITUVCHI DVIGATELI (AUDIT-20 WP-A) — `buildTeacherDoc`.
 *
 * Beshala vosita BITTA qobiqdan o'tadi, lekin har biri O'Z yozuvchisi
 * bilan (`lesson.ts` / `map.ts` / `glossary.ts` / `keys.ts`, test —
 * `test/engine.ts`, WP-B): dars bosqichlari bilan glossariy atamalari
 * orasida umumiy shakl yo'q, ularni bitta «universal» yozuvchiga tiqish
 * promptni ham, qo'riqchini ham noaniq qilardi.
 *
 * Bosqichlar (`onStage` foizlari):
 *   1 kirish       0→10   forma → `TeacherInput`, fayl/dastur manbasi
 *   2 yozish      10→65   kind yozuvchisi (xarita — `mapPool(2)`)
 *   3 yig'ish     65→75   `AcademicDoc` (sections + tables TEKIS)
 *   4 hisobot     75→88   `review.ts` (qoidalar + baholovchi)
 *   5 sayqal      88→96   `polish.ts` (`acceptDelta` +1)
 *
 * Yagona manba qarori `work/` dagi bilan bir xil: MATN `doc.sections`
 * da tekis turadi, METAMA'LUMOT `doc.teacher` da. Bu fayl RAQAM VA
 * TARTIB QO'YMAYDI («1-bosqich», «I chorak» sarlavhasi jadval ustida) —
 * uni `teacher/layout.ts planTeacher` (WP-C) beradi. Bo'lim id lari
 * SHARTNOMA (WP-C shu id larga tayanadi):
 *
 *   lesson    passport · goal · stages · homework · assessment?
 *   map       passport · year   (yillik)   |  passport · q1..q4 (choraklik)
 *   glossary  intro · terms
 *   keys      intro · case1..caseN · rubric
 *
 * `null` — dvigatel ishlamadi (LLM kalitsiz muhit, model javob bermadi,
 * sifat darvozasidan o'tmadi): chaqiruvchi (`write-llm.ts`) ESKI
 * `write-specials.ts` yo'liga tushadi. Bu xulq R0 da qulflangan va
 * `TEACHER_ENGINE=0` bilan majburan yoqiladi (X-6).
 */
import type { FormValues } from "../../types";
import type { AcademicDoc, Delivered, DocMeta, DocSection, DocTable } from "../types";
import type { TranslationSource } from "../source-types";
import type { CompleteFn } from "../research/pipeline";
import { llmEnabled } from "../llm";
import { CostMeter, type LlmUsage, complete as completeRole } from "../llm-roles";
import { parseLlmObject } from "../json";
import { remainingMs } from "../quality";
import { TEACHER_LIMITS, type TeacherKind, type TeacherModel, type TeacherSchool } from "./types";
import { teacherKindOf, teacherTypeOf } from "./registry";
import { teacherInputFromValues, type TeacherInput } from "./input";
import { teacherLabels, teacherSystemPrompt, type TeacherContext } from "./prompts";
import { writeLesson } from "./lesson";
import { writeMap } from "./map";
import { writeGlossary } from "./glossary";
import { writeKeys } from "./keys";
import { reviewTeacher } from "./review";
import { runTeacherPolish } from "./polish";

/* ────────────────────────── shartnoma ────────────────────────── */

/** `WorkStage`/`ArticleStage` bilan AYNI shakl — `write-llm.ts` bittasini uzatadi. */
export type TeacherStage = { progress: number; step: string };

export type TeacherBuildOpts = {
  deadline: number;
  /** Fayl rejimi: yuklangan manba (`worker.ts sourceForJob`). */
  source?: TranslationSource;
  onStage?: (ev: TeacherStage) => void;
  /** LLM sarfi — `write-llm.ts` uni `BuiltFile.cost` ga yozadi. */
  onCost?: (cost: TeacherCost) => void;
  onUsage?: (u: LlmUsage) => void;
  /** Testlar modelni shu orqali almashtiradi (`work/engine.ts` naqshi). */
  complete?: CompleteFn;
  /** `false` — baholovchi chaqirilmaydi (testlar, tez rejim). */
  judge?: boolean;
  /** `false` — avto-sayqal o'tkazib yuboriladi. */
  polish?: boolean;
  now?: Date;
};

export type TeacherCost = ReturnType<CostMeter["toJson"]>;

export type TeacherBuilt = {
  doc: AcademicDoc;
  cost: TeacherCost;
  /**
   * Va'da qilingan MIQDORNING qanchasi yetkazildi (hafta / atama / keys).
   * `lib/generation/delivered.ts` ni WP-F ulaydi — dvigatel faqat
   * O'ZI bilgan sonni qaytaradi, ikkinchi marta hisoblamaydi.
   */
  delivered?: Delivered;
};

/**
 * Dvigatelning SHARTNOMASI — R0 da qulflangan imzo (boshqa WP lar shunga
 * tayanadi); WP-A da faqat TANASI to'ldi.
 */
export type TeacherBuilder = (meta: DocMeta, values: FormValues, opts: TeacherBuildOpts) => Promise<TeacherBuilt | null>;

/* ────────────────────────── yozuvchi shartnomasi ────────────────────────── */

/**
 * Bitta LLM chaqiruvi. `null` — javob yo'q (timeout/xato/bo'sh), qayta
 * urinish qaroriini YOZUVCHI qabul qiladi: xaritada bo'lakni qayta
 * so'rash, glossariyda keyingi bo'lakka o'tish, dars rejasida esa
 * butun so'rovni takrorlash kerak.
 */
export type TeacherAsk = (
  role: Parameters<CompleteFn>[0],
  user: string,
  o: { maxTokens: number; timeoutMs: number },
) => Promise<string | null>;

/** Kind yozuvchisining natijasi — hujjat qismlari + to'liq model bo'lagi. */
export type TeacherWritten = {
  sections: DocSection[];
  tables: DocTable[];
  /** `TeacherModel` ning kind qismi (`lesson`/`map`/`glossary`/`keys`). */
  model: Pick<TeacherModel, "lesson" | "map" | "glossary" | "keys">;
  delivered?: Delivered;
};

export type TeacherWriter = (
  ctx: TeacherContext,
  ask: TeacherAsk,
  o: { deadline: number; stage: (p: number, step: string) => void },
) => Promise<TeacherWritten | null>;

/* ────────────────────────── vaqt chegaralari ────────────────────────── */

const MIN_CALL_MS = 8_000;
export const TEACHER_REVIEW_RESERVE_MS = 45_000;
export const TEACHER_POLISH_RESERVE_MS = 60_000;
/** Q-3 qabul chegarasi — reja bo'yicha +1 (hujjatlar qisqa, shovqin kamroq). */
export const TEACHER_ACCEPT_DELTA = 1;

const WRITERS: Record<Exclude<TeacherKind, "test">, TeacherWriter> = {
  lesson: writeLesson,
  map: writeMap,
  glossary: writeGlossary,
  keys: writeKeys,
};

/* ────────────────────────── yordamchilar ────────────────────────── */

/** Yuklangan fayldan matn — tarjima ekstraktori orqali (bo'sh bo'lsa ""). */
async function sourceTextOf(source: TranslationSource): Promise<string> {
  try {
    const { extractSegments } = await import("../translate/index");
    const ex = await extractSegments(source.kind, source.bytes);
    return ex.segments.map((s) => s.text).join("\n\n").slice(0, TEACHER_LIMITS.sourceTextChars);
  } catch (e) {
    console.warn("[teacher] manba fayl o'qilmadi:", e instanceof Error ? e.message : e);
    return "";
  }
}

/**
 * Rasmiy dastur mavzulari (`lib/curriculum.ts`) — dars rejasi va xarita
 * uchun IXTIYORIY. Baza to'liq emas (X-2), shuning uchun yo'q fan/sinf
 * JIMGINA bo'sh ro'yxat beradi: darslik rejimi o'chib qoladi, xizmat
 * ishlayveradi.
 */
async function curriculumTopicsFor(input: TeacherInput): Promise<string[]> {
  if (!input.curriculumSubject || !input.topicIds.length) return [];
  try {
    const { curriculumTopics, pickTopics } = await import("../../curriculum");
    const entry = await curriculumTopics(input.curriculumSubject, input.grade);
    if (!entry) return [];
    return pickTopics(entry, input.topicIds).map((t) => t.title).slice(0, TEACHER_LIMITS.curriculumTopicsMax);
  } catch (e) {
    console.warn("[teacher] o'quv dasturi o'qilmadi:", e instanceof Error ? e.message : e);
    return [];
  }
}

/** Shapka modeli — beshala vositada bir xil (`TeacherSchool`). */
function schoolOf(input: TeacherInput): TeacherSchool {
  return {
    institution: input.institution,
    author: input.author,
    subject: input.subject,
    grade: input.grade,
    language: input.language,
    ...(input.gradeLetter ? { gradeLetter: input.gradeLetter } : {}),
    ...(input.date ? { date: input.date } : {}),
    ...(input.approver ? { approver: input.approver } : {}),
  };
}

/**
 * `test` vositasi — WP-B dvigateli. DINAMIK import: WP-A va WP-B
 * parallel yozilmoqda va bu fayl `teacher/test/engine.ts` hali yo'q
 * bo'lgan holatda ham KOMPILYATSIYA bo'lishi va ISHLASHI kerak
 * (statik import butun `write-llm.ts` zanjirini sindirardi).
 * Modul topilmasa `null` — test vositasida eski yo'l yo'q, ish
 * «hujjat yaratilmadi» bilan tugaydi.
 */
const TEST_ENGINE_MODULE = "./test/engine";

async function buildTestDoc(meta: DocMeta, values: FormValues, opts: TeacherBuildOpts): Promise<TeacherBuilt | null> {
  try {
    // Spetsifikator O'ZGARUVCHIDA: modul hali yo'q va statik import
    // butun `write-llm.ts` zanjirini kompilyatsiyada sindirardi.
    const mod = (await import(TEST_ENGINE_MODULE)) as { buildTestDoc?: TeacherBuilder };
    if (typeof mod.buildTestDoc !== "function") return null;
    return await mod.buildTestDoc(meta, values, opts);
  } catch {
    // WP-B hali ulanmagan — `test` vositasi hujjat yaratmaydi (AUDIT-20 §6).
    return null;
  }
}

/* ────────────────────────── asosiy ────────────────────────── */

export const buildTeacherDoc: TeacherBuilder = async (meta, values, opts) => {
  const kind = teacherKindOf(meta.toolId);
  if (!kind) return null;
  if (kind === "test") return buildTestDoc(meta, values, opts);

  const complete = opts.complete ?? completeRole;
  if (!opts.complete && !llmEnabled()) return null;

  const { deadline } = opts;
  const now = opts.now ?? new Date();
  const meter = new CostMeter();
  const stage = (progress: number, step: string) => opts.onStage?.({ progress, step });

  stage(0, "Ma’lumotlar tayyorlanmoqda");
  const input = teacherInputFromValues(meta, values, kind);
  if (!input.sourceText && opts.source) input.sourceText = await sourceTextOf(opts.source);
  const curriculum = await curriculumTopicsFor(input);

  const docMeta: DocMeta = {
    ...meta,
    language: input.language,
    topic: input.topic || meta.topic,
    subject: input.subject,
    grade: input.grade,
    duration: input.duration,
    weeklyHours: input.weeklyHours,
    totalHours: input.totalHours,
    termCount: input.termCount,
    sourceText: input.sourceText,
  };

  const ctx: TeacherContext = {
    kind,
    spec: teacherTypeOf(kind, input.type),
    input,
    meta: docMeta,
    labels: teacherLabels(input.language),
    curriculum,
  };

  const system = teacherSystemPrompt(ctx);
  const ask: TeacherAsk = async (role, user, o) => {
    if (o.timeoutMs < MIN_CALL_MS) return null;
    const r = await complete(role, system, user, { json: true, ...o });
    if (r?.usage) {
      meter.add(r.usage);
      opts.onUsage?.(r.usage);
    }
    return r?.text ?? null;
  };

  stage(10, "Mazmun yozilmoqda");
  const writeDeadline = deadline - (opts.polish === false ? TEACHER_REVIEW_RESERVE_MS : TEACHER_REVIEW_RESERVE_MS + TEACHER_POLISH_RESERVE_MS);
  const built = await WRITERS[kind](ctx, ask, { deadline: Math.max(Date.now() + MIN_CALL_MS, writeDeadline), stage });
  if (!built) {
    console.warn(`[teacher] ${kind}: model yaroqli javob bermadi — eski yo'lga qaytiladi`);
    return null;
  }

  stage(65, "Hujjat yig‘ilmoqda");
  const model: TeacherModel = {
    v: 1,
    kind,
    type: input.type,
    school: schoolOf(input),
    ...built.model,
  };
  let doc: AcademicDoc = {
    meta: docMeta,
    titlePage: true,
    /*
     * Mundarija ATAYIN yo'q (AUDIT-6 A2 qarori saqlanadi): bu hujjatlar
     * 2–6 bo'limli va ular allaqachon raqamlangan — mundarija varag'i
     * DOCX da bo'lib, ko'ruvchida bo'lmasligi bet raqamlarini siljitardi.
     */
    toc: false,
    sections: built.sections,
    ...(built.tables.length ? { tables: built.tables } : {}),
    teacher: model,
  };

  /* ── hisobot ── */
  stage(75, "Tayyorlik hisoboti");
  const judge = opts.judge !== false;
  let review = await reviewTeacher(doc, { complete, deadline, judge, now, onUsage: opts.onUsage });
  model.review = review;

  /* ── avto-sayqal ── */
  if (opts.polish !== false && remainingMs(deadline) > TEACHER_POLISH_RESERVE_MS) {
    stage(88, "Avto-sayqal");
    const res = await runTeacherPolish(doc, review, {
      complete,
      deadline,
      judge,
      now,
      acceptDelta: TEACHER_ACCEPT_DELTA,
      onUsage: opts.onUsage,
    });
    doc = res.doc;
    review = res.review;
    // Sayqal hujjatni ALMASHTIRGAN bo'lishi mumkin — model o'sha nusxada.
    const target = doc.teacher ?? model;
    target.review = review;
    target.polish = res.log;
    if (review.userNeeds?.length) target.userNeeds = review.userNeeds;
    doc = { ...doc, teacher: target };
  } else {
    model.userNeeds = review.userNeeds ?? [];
  }

  stage(96, "Tayyor");
  const cost = meter.toJson();
  opts.onCost?.(cost);
  return { doc, cost, ...(built.delivered ? { delivered: built.delivered } : {}) };
};

/* ────────────────────────── umumiy parser ────────────────────────── */

/**
 * Model javobi → obyekt. Yozuvchilar shu yordamchini ishlatadi, chunki
 * to'rtalasi ham bir xil holatni ko'radi: kesilgan JSON, markdown
 * o'rami, `{"data": {...}}` o'rami.
 */
export function teacherJson<T extends object>(raw: string | null | undefined): T | null {
  const j = parseLlmObject<Record<string, unknown>>(raw);
  if (!j) return null;
  const inner = j.data ?? j.result;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) return inner as T;
  return j as T;
}

export type { TeacherContext } from "./prompts";
export type { TeacherInput } from "./input";
