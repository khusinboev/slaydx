import test from "node:test";
import assert from "node:assert/strict";
import {
  RewriteError,
  TEACHER_ACCEPT_DELTA,
  applyTeacherPolishOps,
  applyTeacherSectionOps,
  planTeacherPolish,
  rewriteTeacherFix,
  runTeacherPolish,
  teacherContextOf,
  teacherJudgeFromReview,
  teacherUserNeeds,
  type TeacherSectionOp,
} from "../lib/generation/teacher/polish.ts";
import { reviewTeacher } from "../lib/generation/teacher/review.ts";
import { sampleTeacherDoc } from "../lib/generation/teacher/samples.ts";
import { POLISH_MAX_FIXES } from "../lib/generation/report/polish-core.ts";
import type { LessonStage, MapWeek, TeacherModel } from "../lib/generation/teacher/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { AcademicDoc, DocSection, DocTable } from "../lib/generation/types.ts";
import type { DocReview } from "../lib/generation/report/types.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";

/**
 * AVTO-SAYQAL (AUDIT-20 WP-A).
 *
 * Tekshiriladigan qaror: `acceptDelta` (+1). Sayqal natijani FAQAT ball
 * chegaradan ko'p oshganda qabul qiladi — aks holda «yaxshilandi»
 * degan xulosa baholovchi shovqinidan tug'ilardi (AUDIT-18 X-5).
 */

const COMPETENCY = "Tadbirkorlik savodxonligi";
const SCHOOL = { institution: "15-son maktab", author: "Karimova D.", subject: "Biologiya", grade: 7, language: "uz" };

const stage = (i: number, minutes: number): LessonStage => ({
  title: `Fotosintez bosqichi ${i}`,
  minutes,
  teacher: `O'qituvchi fotosintez jarayonini xloroplast sxemasi bilan tushuntiradi va ${i}-misolni doskada yechadi.`,
  student: "O'quvchilar juft bo'lib sxemani to'ldiradi.",
  method: "Juftlikda ishlash",
  result: "Fotosintez bosqichini tushuntira oladi",
});

/**
 * `competencyTagged` bandi MATNGA qaraydi: tanlangan kompetensiya
 * bosqichlar matnida yo'q — sariq. Sayqal shu bo'limni qayta yozadi.
 */
function lessonDoc(opts: { competencies?: string[] } = {}): AcademicDoc {
  const stages = [stage(1, 10), stage(2, 15), stage(3, 10), stage(4, 5), stage(5, 5)];
  const model: TeacherModel = {
    v: 1,
    kind: "lesson",
    type: "yangi-mavzu",
    school: SCHOOL,
    lesson: {
      type: "yangi-mavzu",
      goal: { talim: "Fotosintez bosqichlarini nomlay oladi.", tarbiya: "Tabiatga ehtiyotkorlik.", rivoj: "Sxema tahlili." },
      competencies: opts.competencies ?? [COMPETENCY],
      equipment: ["Darslik"],
      stages,
      homework: "Fotosintez bosqichlari bo'yicha sxema chizing va 5 ta savolga javob yozing.",
      assessment: "",
      durationMin: 45,
    },
  };
  const sections: DocSection[] = [
    { id: "passport", title: "Dars pasporti", blocks: [{ kind: "p", text: "Fan: Biologiya. Mavzu: Fotosintez jarayoni." }] },
    { id: "goal", title: "Dars maqsadi", blocks: [{ kind: "p", text: "Ta'limiy: fotosintez bosqichlari." }] },
    { id: "stages", title: "Dars bosqichlari", blocks: stages.flatMap((s) => [{ kind: "h3" as const, text: s.title }, { kind: "p" as const, text: s.teacher }]) },
    { id: "homework", title: "Uyga vazifa", blocks: [{ kind: "p", text: model.lesson!.homework }] },
  ];
  const table: DocTable = { caption: "Vaqt taqsimoti", anchor: "stages", headers: ["Bosqich", "Daqiqa", "Kutilgan natija"], rows: stages.map((s) => [s.title, String(s.minutes), s.result]) };
  const meta = extractMeta(TOOL_BY_ID["lesson-plan"], { topic: "Fotosintez jarayoni", subject: "Biologiya", grade: 7 });
  return { meta: { ...meta, topic: "Fotosintez jarayoni" }, titlePage: true, toc: false, sections, tables: [table], teacher: model };
}

function mapDoc(): AcademicDoc {
  const weeks: MapWeek[] = Array.from({ length: 34 }, (_, i) => ({
    n: i + 1,
    topic: `Hujayra tuzilishi ${i + 1}`,
    hours: 2,
    method: "Ma'ruza",
    resources: "Darslik",
    result: `Hujayra tuzilishi ${i + 1} ni tushuntira oladi`,
    control: "Yozma topshiriq",
  }));
  const model: TeacherModel = { v: 1, kind: "map", type: "yillik", school: SCHOOL, map: { type: "yillik", weeklyHours: 2, totalHours: 68, quarters: [{ n: 0, weeks }] } };
  const meta = extractMeta(TOOL_BY_ID["texnologik-xarita"], { topic: "Biologiya", weeklyHours: 2, totalHours: 68 });
  return {
    meta: { ...meta, topic: "Biologiya" },
    titlePage: true,
    toc: false,
    sections: [
      { id: "passport", title: "Fan pasporti", blocks: [{ kind: "p", text: "Fan: Biologiya." }] },
      { id: "year", title: "Taqsimot", blocks: [{ kind: "p", text: "34 hafta." }] },
    ],
    tables: [{ caption: "Taqsimot", anchor: "year", headers: ["Hafta", "Soat", "Mavzu", "Metod", "Kutilgan natija", "Nazorat"], rows: weeks.map((w) => [String(w.n), String(w.hours), w.topic, w.method, w.result, w.control]) }],
    teacher: model,
  };
}

/** Glossariy hujjati — namunadan (dvigatel yozgan nasr + model). */
function glossaryDoc(): AcademicDoc {
  return JSON.parse(JSON.stringify(sampleTeacherDoc("glossary"))) as AcademicDoc;
}

/** Qayta yozish stubi — bo'lim matniga kompetensiyani qo'shadi. */
function makeComplete(calls: { role: LlmRole; user: string }[], o: { rewriteText?: string; badRows?: boolean } = {}) {
  return async (role: LlmRole, _system: string, user: string) => {
    calls.push({ role, user });
    const usage = { provider: "stub", model: "s", inputTokens: 10, outputTokens: 5 };
    if (user.startsWith("Rewrite the table")) {
      const rows = Number(/EXACTLY (\d+) rows/.exec(user)?.[1] ?? 0);
      const cols = Number(/EXACTLY (\d+) cells/.exec(user)?.[1] ?? 6);
      const n = o.badRows ? rows - 1 : rows;
      return { text: JSON.stringify({ rows: Array.from({ length: n }, (_, i) => Array.from({ length: cols }, (_, c) => (c === 0 ? String(i + 1) : `x${i}-${c}`))) }), usage };
    }
    if (user.startsWith("Rewrite the section")) {
      const text = o.rewriteText ?? `O'quvchilar fotosintez sxemasini to'ldiradi va ${COMPETENCY} ko'nikmasini mashq qiladi.`;
      return { text: JSON.stringify({ blocks: [{ kind: "p", text }] }), usage };
    }
    return { text: "{}", usage };
  };
}

const deps = (calls: { role: LlmRole; user: string }[], o: Parameters<typeof makeComplete>[1] = {}) => ({
  complete: makeComplete(calls, o) as never,
  deadline: Date.now() + 120_000,
  judge: false as const,
  now: new Date("2026-09-16T10:00:00Z"),
});

/* ══════════════════════════ reja ══════════════════════════ */

test("reja: tuzatib bo'lmaydigan bandlar o'tkazib yuboriladi", async () => {
  const doc = lessonDoc();
  const review = await reviewTeacher(doc, { judge: false });
  const plan = planTeacherPolish(review, doc);
  // `minutesSum`/`stageCount` — arifmetika va miqdor bandlari, ular
  // «tuzatilmaydi»; `competencyTagged` esa matn bandi — tuzatiladi.
  assert.ok(plan.fixes.some((f) => f.target === "stages"), JSON.stringify(plan.fixes));
  assert.ok(plan.fixes.length <= POLISH_MAX_FIXES);

  const broken: DocReview = {
    ...review,
    checks: [...review.checks, { id: "termCount", level: "red", label: "Atamalar soni" }, { id: "hoursSum", level: "red", label: "Soat yig'indisi" }],
  };
  const plan2 = planTeacherPolish(broken, doc);
  assert.ok(plan2.skipped.some((s) => s.id === "termCount" && s.reason === "user"));
  assert.ok(plan2.skipped.some((s) => s.id === "hoursSum" && s.reason === "manual"));
});

test("reja: foydalanuvchi ma'lumoti kerak bo'lgan baholovchi tavsiyasi bajarilmaydi", async () => {
  const doc = lessonDoc();
  const review = await reviewTeacher(doc, { judge: false });
  const withFix: DocReview = {
    ...review,
    checks: [
      ...review.checks,
      { id: "judge:fix:1", level: "yellow", label: "Baholovchi tavsiyasi", fix: { op: "rewrite", target: "stages", instruction: "Add the measured results of your classroom experiment with p-values." } },
    ],
  };
  const plan = planTeacherPolish(withFix, doc);
  assert.ok(plan.skipped.some((s) => s.id === "judge:fix:1" && s.reason === "user"), JSON.stringify(plan.skipped));
});

test("reja: bitta nishon = bitta fix (ko'rsatmalar birlashadi), mavjud bo'lmagan nishon tashlanadi", async () => {
  const doc = lessonDoc();
  const review = await reviewTeacher(doc, { judge: false });
  const many: DocReview = {
    ...review,
    checks: [
      ...review.checks,
      { id: "judge:fix:1", level: "yellow", label: "T1", fix: { op: "rewrite", target: "stages", instruction: "Birinchi ko'rsatma." } },
      { id: "judge:fix:2", level: "yellow", label: "T2", fix: { op: "rewrite", target: "stages", instruction: "Ikkinchi ko'rsatma." } },
      { id: "judge:fix:3", level: "yellow", label: "T3", fix: { op: "rewrite", target: "yoq-bunday-bolim", instruction: "Uchinchi." } },
    ],
  };
  const plan = planTeacherPolish(many, doc);
  const stages = plan.fixes.filter((f) => f.target === "stages");
  assert.equal(stages.length, 1, "bitta nishonga bitta fix");
  assert.match(stages[0].instruction, /Birinchi ko'rsatma/);
  assert.match(stages[0].instruction, /Ikkinchi ko'rsatma/);
  assert.ok(!plan.fixes.some((f) => f.target === "yoq-bunday-bolim"));
});

test("eski hujjat: reja bo'sh, qayta yozish 409", async () => {
  const legacy = { ...lessonDoc(), teacher: undefined } as AcademicDoc;
  const plan = planTeacherPolish({ score: 0, checks: [], judgeNotes: [], verifiedShare: 0, recentShare: 0, builtAt: "" }, legacy);
  assert.deepEqual(plan.fixes, []);
  assert.equal(plan.skipped[0].reason, "manual");
  await assert.rejects(
    () => rewriteTeacherFix(legacy, { op: "rewrite", target: "stages", instruction: "x" }, { complete: makeComplete([]) as never }),
    (e: unknown) => e instanceof RewriteError && e.status === 409,
  );
});

/* ══════════════════════════ glossariy: TUZILMALI qayta yozish ══════════════════════════ */

/**
 * JONLI NUQSON (AUDIT-20 WP-D): `terms` bo'limi umumiy nasr sifatida
 * qayta yozilganda `blocksFromLlm` qisqa qatorlarni tashlab, atama
 * sarlavhalarini (`h3`) paragrafga aylantirib yuborardi — 20 atamadan
 * 18 tasining NOMI yo'qolgan, model esa o'zgarmagani uchun hisobot
 * hamon 20 atamani ko'rsatib turardi.
 */
test("glossariy `terms`: MODEL shakli so'raladi, bloklarni dvigatel quruvchisi yig'adi", async () => {
  const doc = glossaryDoc();
  const n = doc.teacher!.glossary!.terms.length;
  const calls: { role: LlmRole; user: string }[] = [];
  const complete = (async (role: LlmRole, _s: string, user: string) => {
    calls.push({ role, user });
    const usage = { provider: "stub", model: "s", inputTokens: 10, outputTokens: 5 };
    if (user.startsWith("Rewrite the glossary entries")) {
      const terms = doc.teacher!.glossary!.terms.map((t, i) => ({
        term: t.term,
        def: `Qayta yozilgan ${i}-ta'rif: bu tushuncha o'simlik hujayrasidagi energiya almashinuvini izohlaydi va boshqa jarayonlardan farqlanadi.`,
        example: t.example ?? "Darsdagi tajriba shu bilan izohlanadi.",
      }));
      return { text: JSON.stringify({ terms }), usage };
    }
    return { text: "{}", usage };
  }) as never;

  const r = await rewriteTeacherFix(doc, { op: "rewrite", target: "terms", instruction: "Ta'riflarni aniqlashtiring." }, { complete, deadline: Date.now() + 60_000 });
  // Umumiy nasr prompti (`Rewrite the section`) UMUMAN chaqirilmaydi.
  assert.ok(!calls.some((c) => c.user.startsWith("Rewrite the section")), "MUTATSIYA: glossariy nasr yo'liga tushdi");
  assert.ok(calls.some((c) => c.user.startsWith("Rewrite the glossary entries")), "tuzilmali prompt chaqirilmadi");

  const op = r.ops[0];
  assert.equal(op.op, "setSection");
  assert.ok(op.op === "setSection" && op.sectionId === "terms");
  const h3 = op.op === "setSection" ? op.blocks.filter((b) => b.kind === "h3") : [];
  assert.equal(h3.length, n, "MUTATSIYA: atama sarlavhalari yo'qoldi (jonli nuqson)");

  // Qo'llangach model ham, sections ham izchil.
  const applied = applyTeacherPolishOps(doc, r.ops);
  assert.ok(applied.ok, applied.ok ? "" : applied.error);
  const after = applied.doc;
  assert.equal(after.teacher!.glossary!.terms.length, n);
  assert.deepEqual(
    after.sections.find((s) => s.id === "terms")!.blocks.filter((b) => b.kind === "h3").map((b) => b.text),
    after.teacher!.glossary!.terms.map((t) => t.term),
    "model tartibi sections tartibidan farq qiladi",
  );
  assert.match(after.teacher!.glossary!.terms[0].def, /Qayta yozilgan/, "model eski ta'rifda qoldi");
});

test("glossariy: atama soni o'zgarib ketgan javob RAD etiladi (422)", async () => {
  const doc = glossaryDoc();
  const complete = (async (_r: LlmRole, _s: string, user: string) => {
    const usage = { provider: "stub", model: "s", inputTokens: 10, outputTokens: 5 };
    if (user.startsWith("Rewrite the glossary entries")) {
      // Model ro'yxatni qisqartirib yubordi — atamalar jimgina yo'qolardi.
      return { text: JSON.stringify({ terms: [{ term: "Yolg'iz", def: "Bitta atama qoldi va bu ro'yxatni buzadi, chunki qolganlari yo'qoladi." }] }), usage };
    }
    return { text: "{}", usage };
  }) as never;
  await assert.rejects(
    () => rewriteTeacherFix(doc, { op: "rewrite", target: "terms", instruction: "x" }, { complete, deadline: Date.now() + 60_000 }),
    (e: unknown) => e instanceof RewriteError && e.status === 422,
  );
});

/* ══════════════════════════ «Sizdan kutiladi» ══════════════════════════ */

test("«Sizdan kutiladi»: bo'sh shapka va darslik sahifasi so'rovi", async () => {
  const doc = lessonDoc();
  const review = await reviewTeacher(doc, { judge: false });
  assert.deepEqual(teacherUserNeeds(review, doc), []);

  const noHeader: AcademicDoc = { ...doc, teacher: { ...doc.teacher!, school: { ...SCHOOL, institution: "", author: "" } } };
  const needs = teacherUserNeeds(review, noHeader);
  assert.equal(needs[0].id, "header");
  assert.match(needs[0].hint, /muassasa nomi/);
  assert.match(needs[0].hint, /tuzuvchi/);

  // Darslik sahifasi — AI bilmaydigan ma'lumot, uydirma yozilmaydi.
  const asksPage: AcademicDoc = { ...doc, meta: { ...doc.meta, extra: "Darslik sahifasi raqamlarini ham yozing." } };
  assert.ok(teacherUserNeeds(review, asksPage).some((n) => n.id === "textbook"));
});

/* ══════════════════════════ qayta yozish ══════════════════════════ */

test("bo'lim qayta yoziladi — `setSection` opi", async () => {
  const calls: { role: LlmRole; user: string }[] = [];
  const doc = lessonDoc();
  const out = await rewriteTeacherFix(doc, { op: "rewrite", target: "stages", instruction: "Kompetensiyani ko'rsating." }, { complete: makeComplete(calls) as never, deadline: Date.now() + 60_000 });
  assert.equal(out.ops.length, 1);
  const op = out.ops[0] as Extract<TeacherSectionOp, { op: "setSection" }>;
  assert.equal(op.op, "setSection");
  assert.equal(op.sectionId, "stages");
  assert.match(op.blocks[0].text, new RegExp(COMPETENCY));
  assert.equal(calls[0].role, "writer");
  assert.match(calls[0].user, /Rewrite the section/);
});

test("jadval qayta yoziladi — qator soni O'ZGARMAYDI", async () => {
  const doc = mapDoc();
  const ok = await rewriteTeacherFix(doc, { op: "rewrite", target: "table:0", instruction: "Natijalarni aniqlashtiring." }, { complete: makeComplete([]) as never, deadline: Date.now() + 60_000 });
  const op = ok.ops[0] as Extract<TeacherSectionOp, { op: "setTable" }>;
  assert.equal(op.op, "setTable");
  assert.equal(op.index, 0);
  assert.equal(op.rows.length, doc.tables![0].rows.length);
  assert.equal(op.rows[0].length, doc.tables![0].headers.length);

  // Model kam qator qaytarsa — QABUL QILINMAYDI (pasport qatori bilan
  // jadval ajralib ketardi).
  await assert.rejects(
    () => rewriteTeacherFix(doc, { op: "rewrite", target: "table:0", instruction: "x" }, { complete: makeComplete([], { badRows: true }) as never, deadline: Date.now() + 60_000 }),
    (e: unknown) => e instanceof RewriteError,
  );

  // Yo'q jadval — 422.
  await assert.rejects(
    () => rewriteTeacherFix(doc, { op: "rewrite", target: "table:9", instruction: "x" }, { complete: makeComplete([]) as never, deadline: Date.now() + 60_000 }),
    (e: unknown) => e instanceof RewriteError && e.status === 422,
  );
});

test("`apply` bo'lim va jadvalni almashtiradi, xato holatda `ok:false`", () => {
  const doc = lessonDoc();
  const ok = applyTeacherSectionOps(doc, [{ op: "setSection", sectionId: "homework", blocks: [{ kind: "p", text: "Yangi vazifa matni." }] }]);
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.doc.sections.find((s) => s.id === "homework")?.blocks[0].text, "Yangi vazifa matni.");
  // Asl hujjat O'ZGARMAYDI (chuqur nusxa).
  assert.notEqual(doc.sections.find((s) => s.id === "homework")?.blocks[0].text, "Yangi vazifa matni.");

  assert.equal(applyTeacherSectionOps(doc, [{ op: "setSection", sectionId: "yoq", blocks: [{ kind: "p", text: "x" }] }]).ok, false);
  assert.equal(applyTeacherSectionOps(doc, [{ op: "setSection", sectionId: "homework", blocks: [] }]).ok, false);

  const map = mapDoc();
  const rows = map.tables![0].rows.map((r) => [...r]);
  rows[0][2] = "Yangi mavzu nomi";
  const t = applyTeacherSectionOps(map, [{ op: "setTable", index: 0, rows }]);
  assert.equal(t.ok, true);
  assert.equal(t.ok && t.doc.tables![0].rows[0][2], "Yangi mavzu nomi");
  assert.equal(applyTeacherSectionOps(map, [{ op: "setTable", index: 0, rows: rows.slice(1) }]).ok, false, "qator soni mos kelmasa rad etilsin");
  assert.equal(applyTeacherSectionOps(map, [{ op: "setTable", index: 5, rows }]).ok, false);
});

/* ══════════════════════════ qabul chegarasi ══════════════════════════ */

test("sayqal: ball oshsa qabul qilinadi", async () => {
  const doc = lessonDoc();
  const review = await reviewTeacher(doc, { judge: false });
  const calls: { role: LlmRole; user: string }[] = [];
  const res = await runTeacherPolish(doc, review, deps(calls));
  assert.equal(res.accepted, true, `${res.log.before} → ${res.log.after}`);
  assert.ok(res.log.after > res.log.before + TEACHER_ACCEPT_DELTA);
  // Qayta yozilgan matn hujjatga tushdi.
  assert.match(res.doc.sections.find((s) => s.id === "stages")!.blocks[0].text, new RegExp(COMPETENCY));
  assert.ok(res.applied.length > 0);
});

test("sayqal: `acceptDelta` chegarasidan oshmasa RAD etiladi va eski hujjat qoladi", async () => {
  const doc = lessonDoc();
  const review = await reviewTeacher(doc, { judge: false });
  const before = doc.sections.find((s) => s.id === "stages")!.blocks[0].text;
  const res = await runTeacherPolish(doc, review, { ...deps([]), acceptDelta: 50 });
  assert.equal(res.accepted, false);
  assert.equal(res.doc.sections.find((s) => s.id === "stages")!.blocks[0].text, before, "rad etilganda matn o'zgarmasin");
  assert.deepEqual(res.ops, []);
  assert.equal(res.review.polish?.accepted, false);
  // Standart chegara +1 (reja qarori).
  assert.equal(TEACHER_ACCEPT_DELTA, 1);
});

test("sayqal: qayta yozish yiqilsa hujjat o'zgarmaydi", async () => {
  const doc = lessonDoc();
  const review = await reviewTeacher(doc, { judge: false });
  const dead = async () => null;
  const res = await runTeacherPolish(doc, review, { ...deps([]), complete: dead as never });
  assert.equal(res.accepted, false);
  assert.equal(res.doc, doc);
  assert.ok(res.log.skipped.some((s) => s.reason === "error"), JSON.stringify(res.log.skipped));
});

/* ══════════════════════════ kontekst va ball ko'chirish ══════════════════════════ */

test("kontekst hujjatdan tiklanadi, manba matni ATAYLAB bo'sh", () => {
  const doc = lessonDoc();
  const ctx = teacherContextOf({ ...doc, meta: { ...doc.meta, sourceText: "Qandaydir manba matni" } });
  assert.equal(ctx.kind, "lesson");
  assert.equal(ctx.spec.id, "yangi-mavzu");
  assert.equal(ctx.input.duration, 45);
  assert.deepEqual(ctx.input.competencies, [COMPETENCY]);
  assert.equal(ctx.input.sourceText, "");
  assert.equal(ctx.meta.sourceText, "");
  assert.equal(ctx.labels.lang, "uz");
});

test("baholovchi ballari eski hisobotdan ko'chiriladi", async () => {
  const doc = lessonDoc();
  const prev: DocReview = {
    score: 70,
    checks: [
      { id: "judge:topicAlignment", level: "red", label: "x", detail: "1/3" },
      { id: "judge:timeRealism", level: "green", label: "x", detail: "3/3" },
      { id: "judge:fix:1", level: "yellow", label: "T", fix: { op: "rewrite", target: "stages", instruction: "Aniqlashtiring." } },
    ],
    judgeNotes: ["Izoh"],
    verifiedShare: 0,
    recentShare: 0,
    builtAt: "",
  };
  const j = teacherJudgeFromReview(prev, doc.teacher!);
  assert.ok(j);
  assert.equal((j as Record<string, number>).topicAlignment, 1);
  assert.equal((j as Record<string, number>).timeRealism, 3);
  // Ko'rsatilmagan mezon neytral (2) bo'lib qoladi.
  assert.equal((j as Record<string, number>).ageFit, 2);
  assert.deepEqual(j.notes, ["Izoh"]);
  assert.equal(j.fixes[0].target, "stages");
  // Umuman judge bandi yo'q hisobotdan hech narsa ko'chirilmaydi.
  assert.equal(teacherJudgeFromReview({ ...prev, checks: [] }, doc.teacher!), null);
  assert.equal(teacherJudgeFromReview(undefined, doc.teacher!), null);
});
