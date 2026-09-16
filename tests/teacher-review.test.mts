import test from "node:test";
import assert from "node:assert/strict";
import { reviewTeacher, teacherJudgeUserPrompt, teacherRuleChecks, teacherTargets, parseTableTarget, tableTarget } from "../lib/generation/teacher/review.ts";
import { TEACHER_RULE_IDS } from "../lib/generation/teacher/registry.ts";
import { TEACHER_LIMITS, type GlossaryTerm, type KeysCase, type LessonStage, type MapWeek, type TeacherModel } from "../lib/generation/teacher/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { AcademicDoc, DocSection, DocTable } from "../lib/generation/types.ts";
import type { ReviewCheck, ReviewLevel } from "../lib/generation/report/types.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";

/**
 * TAYYORLIK HISOBOTI (AUDIT-20 WP-A).
 *
 * Har band uchun IKKI holat: qoida bajarilgan (yashil) va ATAYLAB
 * buzilgan (sariq/qizil). Faqat yashil holatni tekshirish testni
 * «hech narsani sinamaydigan» qilib qo'yardi — `noStubDefinition`
 * qoidasi aynan shu sababli hisobotlarda tavsiya sifatida qolib
 * ketgan edi (R2 §4).
 */

const SCHOOL = { institution: "15-son maktab", author: "Karimova D.", subject: "Biologiya", grade: 7, language: "uz" };

const levelOf = (checks: ReviewCheck[], id: string): ReviewLevel | undefined => checks.find((c) => c.id === id)?.level;

function docOf(toolId: "lesson-plan" | "texnologik-xarita" | "glossary" | "keys", model: TeacherModel, sections: DocSection[], tables: DocTable[] = [], topic = "Fotosintez jarayoni"): AcademicDoc {
  const meta = extractMeta(TOOL_BY_ID[toolId], { topic, subject: "Biologiya", grade: 7, termCount: model.glossary?.terms.length ?? 10 });
  return { meta: { ...meta, topic }, titlePage: true, toc: false, sections, ...(tables.length ? { tables } : {}), teacher: model };
}

/* ────────────────────────── dars rejasi ────────────────────────── */

const stage = (i: number, minutes: number, over: Partial<LessonStage> = {}): LessonStage => ({
  title: `Fotosintez bosqichi ${i}`,
  minutes,
  teacher: `O'qituvchi fotosintez jarayonini xloroplast sxemasi bilan tushuntiradi va ${i}-misolni doskada yechadi.`,
  student: "O'quvchilar juft bo'lib sxemani to'ldiradi.",
  method: "Juftlikda ishlash",
  result: "Fotosintez bosqichini tushuntira oladi",
  ...over,
});

function lessonDoc(over: { stages?: LessonStage[]; homework?: string; competencies?: string[]; duration?: number; type?: string } = {}) {
  const stages = over.stages ?? [stage(1, 10), stage(2, 15), stage(3, 10), stage(4, 5), stage(5, 5)];
  const model: TeacherModel = {
    v: 1,
    kind: "lesson",
    type: over.type ?? "yangi-mavzu",
    school: SCHOOL,
    lesson: {
      type: over.type ?? "yangi-mavzu",
      goal: { talim: "Fotosintez bosqichlarini nomlay oladi.", tarbiya: "Tabiatga ehtiyotkorlik.", rivoj: "Sxema tahlili." },
      competencies: over.competencies ?? [],
      equipment: ["Darslik", "Mikroskop"],
      stages,
      homework: over.homework ?? "Fotosintez bosqichlari bo'yicha sxema chizing va 5 ta savolga javob yozing.",
      assessment: "",
      durationMin: over.duration ?? 45,
    },
  };
  const sections: DocSection[] = [
    { id: "passport", title: "Dars pasporti", blocks: [{ kind: "p", text: "Fan: Biologiya. Mavzu: Fotosintez jarayoni." }] },
    { id: "goal", title: "Dars maqsadi", blocks: [{ kind: "p", text: "Ta'limiy: fotosintez bosqichlari." }] },
    { id: "stages", title: "Dars bosqichlari", blocks: stages.flatMap((s) => [{ kind: "h3" as const, text: s.title }, { kind: "p" as const, text: s.teacher }, { kind: "p" as const, text: s.student }]) },
    { id: "homework", title: "Uyga vazifa", blocks: [{ kind: "p", text: model.lesson!.homework }] },
  ];
  const table: DocTable = { caption: "Vaqt taqsimoti", anchor: "stages", headers: ["Bosqich", "Daqiqa", "Kutilgan natija"], rows: stages.map((s) => [s.title, String(s.minutes), s.result]) };
  return docOf("lesson-plan", model, sections, [table]);
}

/* ────────────────────────── xarita ────────────────────────── */

const week = (n: number, over: Partial<MapWeek> = {}): MapWeek => ({
  n,
  topic: `Hujayra tuzilishi ${n}`,
  hours: 2,
  method: n % 3 === 0 ? "Laboratoriya" : "Ma'ruza",
  resources: "Darslik bo'limi",
  result: `Hujayra tuzilishi ${n} ni tushuntira oladi`,
  control: n % 3 === 0 ? "Amaliy ish" : "Yozma topshiriq",
  ...over,
});

function mapDoc(over: { weeks?: MapWeek[]; totalHours?: number; weeklyHours?: number } = {}) {
  const weeks = over.weeks ?? Array.from({ length: 34 }, (_, i) => week(i + 1));
  const weeklyHours = over.weeklyHours ?? 2;
  const totalHours = over.totalHours ?? weeks.reduce((a, w) => a + w.hours, 0);
  const model: TeacherModel = {
    v: 1,
    kind: "map",
    type: "yillik",
    school: SCHOOL,
    map: { type: "yillik", weeklyHours, totalHours, quarters: [{ n: 0, weeks }] },
  };
  const sections: DocSection[] = [
    { id: "passport", title: "Fan pasporti", blocks: [{ kind: "p", text: `Fan: Biologiya. Haftalik soat: ${weeklyHours}.` }] },
    { id: "year", title: "O'quv yili bo'yicha taqsimot", blocks: [{ kind: "p", text: `${weeks.length} hafta.` }] },
  ];
  const table: DocTable = {
    caption: "O'quv yili bo'yicha taqsimot",
    anchor: "year",
    headers: ["Hafta", "Soat", "Mavzu", "Metod", "Kutilgan natija", "Nazorat"],
    rows: weeks.map((w) => [String(w.n), String(w.hours), w.topic, w.method, w.result, w.control]),
  };
  return docOf("texnologik-xarita", model, sections, [table], "Biologiya");
}

/* ────────────────────────── glossariy ────────────────────────── */

const term = (i: number, over: Partial<GlossaryTerm> = {}): GlossaryTerm => ({
  term: `Atama${String(i).padStart(2, "0")}`,
  def: `Bu tushuncha o'simlik hujayrasidagi organoid ishtirokida kechadigan ${i}-darajali energiya almashinuvini bildiradi.`,
  example: `Darsda ${i}-tajriba shu tushuncha bilan izohlanadi.`,
  ...over,
});

function glossaryDoc(over: { terms?: GlossaryTerm[]; includeExample?: boolean } = {}) {
  const terms = over.terms ?? Array.from({ length: 10 }, (_, i) => term(i + 1));
  const model: TeacherModel = {
    v: 1,
    kind: "glossary",
    type: "fan-lugati",
    school: SCHOOL,
    glossary: { type: "fan-lugati", terms, order: "alpha", includeExample: over.includeExample ?? true },
  };
  const sections: DocSection[] = [
    { id: "intro", title: "Kirish", blocks: [{ kind: "p", text: "Lug'at fan atamalarini qamrab oladi." }] },
    { id: "terms", title: "Atamalar ro'yxati", blocks: terms.flatMap((t) => [{ kind: "h3" as const, text: t.term }, { kind: "p" as const, text: t.def }]) },
  ];
  return docOf("glossary", model, sections);
}

/* ────────────────────────── keys ────────────────────────── */

const kase = (i: number, over: Partial<KeysCase> = {}): KeysCase => ({
  title: `Nilufar opaning ${i}-holati`,
  situation:
    `5-sinf o'qituvchisi Nilufar opa yangi mavzuni tushuntirgach, sinfning yarmi topshiriqni bajara olmadi. ` +
    `Jurnalda oldingi ikki darsda ham past ball qayd etilgan (${i}-guruh, 24 nafar o'quvchi).`,
  questions: ["Muammo sababi nima?", "Qanday yechim taklif qilasiz?"],
  solution: "Diagnostik topshiriq bilan bo'shliq aniqlanadi, mavzu qayta bo'laklanadi va juftlikda mashq beriladi.",
  rubric: [
    { criterion: "Sababni jurnal bilan asoslash", points: 3 },
    { criterion: "Yechim qadamlari", points: 4 },
    { criterion: "O'lchov usuli", points: 3 },
  ],
  ...over,
});

function keysDoc(over: { cases?: KeysCase[] } = {}) {
  const cases = over.cases ?? [kase(1), kase(2), kase(3)];
  const model: TeacherModel = { v: 1, kind: "keys", type: "muammoli", school: SCHOOL, keys: { type: "muammoli", audience: "otm", cases } };
  const sections: DocSection[] = [
    { id: "intro", title: "Kirish", blocks: [{ kind: "p", text: "Keyslar guruh ishida ishlatiladi." }] },
    ...cases.map((c, i) => ({
      id: `case${i + 1}`,
      title: `Keys ${i + 1}. ${c.title}`,
      blocks: [{ kind: "p" as const, text: c.situation }, { kind: "p" as const, text: c.solution }],
    })),
    { id: "rubric", title: "Baholash mezonlari", blocks: cases.flatMap((c, i) => [{ kind: "h3" as const, text: `Keys ${i + 1}` }, ...c.rubric.map((r) => ({ kind: "li" as const, text: `${r.criterion} — ${r.points} ball` }))]) },
  ];
  return docOf("keys", model, sections);
}

/* ══════════════════════════ testlar ══════════════════════════ */

test("qoida id lari reyestr bilan MOS (TEACHER_RULE_IDS)", () => {
  const got = {
    lesson: teacherRuleChecks(lessonDoc()).map((c) => c.id),
    map: teacherRuleChecks(mapDoc()).map((c) => c.id),
    glossary: teacherRuleChecks(glossaryDoc()).map((c) => c.id),
    keys: teacherRuleChecks(keysDoc()).map((c) => c.id),
  };
  for (const kind of ["lesson", "map", "glossary", "keys"] as const) {
    assert.deepEqual([...got[kind]].sort(), [...TEACHER_RULE_IDS[kind]].sort(), `${kind}: ${got[kind].join(",")}`);
  }
});

test("lesson minutesSum — teng bo'lsa yashil, mos kelmasa qizil + fix", () => {
  assert.equal(levelOf(teacherRuleChecks(lessonDoc()), "minutesSum"), "green");
  const bad = teacherRuleChecks(lessonDoc({ stages: [stage(1, 10), stage(2, 10), stage(3, 10)] }));
  assert.equal(levelOf(bad, "minutesSum"), "red");
  assert.equal(bad.find((c) => c.id === "minutesSum")?.fix?.target, "stages");
});

test("lesson topicGrounded — mavzudan uzoq bosqichlar qizil", () => {
  assert.equal(levelOf(teacherRuleChecks(lessonDoc()), "topicGrounded"), "green");
  const off = Array.from({ length: 5 }, (_, i) => stage(i + 1, 9, { title: `Bosqich ${i + 1}`, teacher: "O'qituvchi darsni odatdagidek olib boradi va o'quvchilar bilan suhbatlashadi.", result: "Natija" }));
  assert.equal(levelOf(teacherRuleChecks(lessonDoc({ stages: off })), "topicGrounded"), "red");
});

test("lesson stageCount — tur oralig'idan tashqarida", () => {
  assert.equal(levelOf(teacherRuleChecks(lessonDoc()), "stageCount"), "green");
  // `yangi-mavzu`: 5–8. Uch bosqich — qizil.
  const few = lessonDoc({ stages: [stage(1, 15), stage(2, 15), stage(3, 15)] });
  assert.equal(levelOf(teacherRuleChecks(few), "stageCount"), "red");
});

test("lesson noGenericActivity — umumiy shablon va bo'sh o'quvchi ustuni", () => {
  assert.equal(levelOf(teacherRuleChecks(lessonDoc()), "noGenericActivity"), "green");
  const generic = Array.from({ length: 5 }, (_, i) => stage(i + 1, 9, { teacher: "O'quvchilar bilim va ko'nikmalarini mustahkamlaydi." }));
  assert.equal(levelOf(teacherRuleChecks(lessonDoc({ stages: generic })), "noGenericActivity"), "red");
  // O'quvchi ustuni bo'sh bo'lsa ham band ochiladi.
  const noStudent = [stage(1, 10), stage(2, 15, { student: "" }), stage(3, 10), stage(4, 5), stage(5, 5)];
  assert.equal(levelOf(teacherRuleChecks(lessonDoc({ stages: noStudent })), "noGenericActivity"), "yellow");
});

test("lesson homeworkPresent va competencyTagged", () => {
  assert.equal(levelOf(teacherRuleChecks(lessonDoc()), "homeworkPresent"), "green");
  assert.equal(levelOf(teacherRuleChecks(lessonDoc({ homework: "Yo'q" })), "homeworkPresent"), "red");
  // Kompetensiya tanlanmagan — band yashil («tanlanmagan»).
  assert.equal(levelOf(teacherRuleChecks(lessonDoc()), "competencyTagged"), "green");
  // Tanlangan, lekin matnda yo'q — sariq.
  assert.equal(levelOf(teacherRuleChecks(lessonDoc({ competencies: ["Tadbirkorlik savodxonligi"] })), "competencyTagged"), "yellow");
});

test("map weekCount va hoursSum", () => {
  const ok = mapDoc();
  assert.equal(levelOf(teacherRuleChecks(ok), "weekCount"), "green");
  assert.equal(levelOf(teacherRuleChecks(ok), "hoursSum"), "green");
  // E'lon qilingan jami soat jadval yig'indisidan farq qiladi.
  const bad = mapDoc({ totalHours: 100 });
  assert.equal(levelOf(teacherRuleChecks(bad), "hoursSum"), "red");
});

test("map uniqueTopics — takror mavzular", () => {
  assert.equal(levelOf(teacherRuleChecks(mapDoc()), "uniqueTopics"), "green");
  const dup = Array.from({ length: 34 }, (_, i) => week(i + 1, { topic: "Hujayra tuzilishi" }));
  const c = teacherRuleChecks(mapDoc({ weeks: dup }));
  assert.equal(levelOf(c, "uniqueTopics"), "red");
  assert.equal(c.find((x) => x.id === "uniqueTopics")?.fix?.target, tableTarget(0));
});

test("map noPlaceholderTopic va resultVariety", () => {
  const ok = teacherRuleChecks(mapDoc());
  assert.equal(levelOf(ok, "noPlaceholderTopic"), "green");
  assert.equal(levelOf(ok, "resultVariety"), "green");
  const ph = Array.from({ length: 34 }, (_, i) => week(i + 1, { topic: `${i + 1}-mavzu` }));
  assert.equal(levelOf(teacherRuleChecks(mapDoc({ weeks: ph })), "noPlaceholderTopic"), "red");
  const generic = Array.from({ length: 34 }, (_, i) => week(i + 1, { result: "Tushuncha shakllanadi" }));
  assert.equal(levelOf(teacherRuleChecks(mapDoc({ weeks: generic })), "resultVariety"), "red");
});

test("map controlRelevance — metod bilan nazorat mos kelmasa", () => {
  assert.equal(levelOf(teacherRuleChecks(mapDoc()), "controlRelevance"), "green");
  // Laboratoriya darsiga og'zaki so'rov — `controlFit` rad etadigan holat.
  const mismatch = Array.from({ length: 34 }, (_, i) => week(i + 1, { method: "Laboratoriya", control: i % 2 ? "Og'zaki so'rov" : "Amaliy ish" }));
  assert.equal(levelOf(teacherRuleChecks(mapDoc({ weeks: mismatch })), "controlRelevance"), "yellow");
  // Ustun umuman bo'sh — qizil.
  const empty = Array.from({ length: 34 }, (_, i) => week(i + 1, { control: "" }));
  assert.equal(levelOf(teacherRuleChecks(mapDoc({ weeks: empty })), "controlRelevance"), "red");
});

test("glossary termCount, alphaOrder, defLength", () => {
  const ok = teacherRuleChecks(glossaryDoc());
  assert.equal(levelOf(ok, "termCount"), "green");
  assert.equal(levelOf(ok, "alphaOrder"), "green");
  assert.equal(levelOf(ok, "defLength"), "green");
  // Tartib buzilgan.
  const shuffled = [term(5), term(1), term(9)];
  assert.equal(levelOf(teacherRuleChecks(glossaryDoc({ terms: shuffled })), "alphaOrder"), "yellow");
  // Ta'rif juda qisqa.
  const short = Array.from({ length: 10 }, (_, i) => term(i + 1, { def: "Qisqa." }));
  assert.equal(levelOf(teacherRuleChecks(glossaryDoc({ terms: short })), "defLength"), "red");
});

test("glossary exampleCoverage — so'ralganda va so'ralmaganda", () => {
  const noExample = Array.from({ length: 10 }, (_, i) => term(i + 1, { example: "" }));
  // Misol SO'RALMAGAN — band yashil.
  assert.equal(levelOf(teacherRuleChecks(glossaryDoc({ terms: noExample, includeExample: false })), "exampleCoverage"), "green");
  // Misol SO'RALGAN, lekin yo'q — qizil. Aynan shu farq uchun
  // `GlossaryModel.includeExample` maydoni qo'shilgan.
  assert.equal(levelOf(teacherRuleChecks(glossaryDoc({ terms: noExample, includeExample: true })), "exampleCoverage"), "red");
  assert.equal(levelOf(teacherRuleChecks(glossaryDoc({ includeExample: true })), "exampleCoverage"), "green");
});

test("glossary noGenericTerm, duplicateTerm, noStubDefinition", () => {
  const ok = teacherRuleChecks(glossaryDoc());
  assert.equal(levelOf(ok, "noGenericTerm"), "green");
  assert.equal(levelOf(ok, "duplicateTerm"), "green");
  assert.equal(levelOf(ok, "noStubDefinition"), "green");

  const generic = [...Array.from({ length: 9 }, (_, i) => term(i + 1)), term(10, { term: "Kompetensiya" })];
  assert.equal(levelOf(teacherRuleChecks(glossaryDoc({ terms: generic })), "noGenericTerm"), "red");

  const dup = [...Array.from({ length: 9 }, (_, i) => term(i + 1)), term(1)];
  assert.equal(levelOf(teacherRuleChecks(glossaryDoc({ terms: dup })), "duplicateTerm"), "red");

  /*
   * Ta'rif ATAYLAB uzun va «mazmunli» so'zlarga boy — shunda faqat
   * BITTA belgi ishlaydi: atama o'z ta'rifida ikki marta uchraydi.
   * Qisqa stub ikkinchi belgi (ma'noli so'z qolmadi) bilan ham
   * ushlanardi va qoidaning bu shoxi sinovsiz qolardi (mutatsiya M3).
   */
  const stub = Array.from({ length: 10 }, (_, i) => {
    const name = `Atama${String(i + 1).padStart(2, "0")}`;
    return term(i + 1, { def: `${name} — bu ${name} tushunchasi bo'lib, u o'quv jarayonida keng qo'llaniladigan muhim va zarur element hisoblanadi.` });
  });
  assert.equal(levelOf(teacherRuleChecks(glossaryDoc({ terms: stub })), "noStubDefinition"), "red");
});

test("keys caseCount, hasQuestions, hasSolution", () => {
  const ok = teacherRuleChecks(keysDoc());
  assert.equal(levelOf(ok, "caseCount"), "green");
  assert.equal(levelOf(ok, "hasQuestions"), "green");
  assert.equal(levelOf(ok, "hasSolution"), "green");
  assert.equal(levelOf(teacherRuleChecks(keysDoc({ cases: [kase(1), kase(2)] })), "caseCount"), "red");
  assert.equal(levelOf(teacherRuleChecks(keysDoc({ cases: [kase(1, { questions: ["Bitta?"] }), kase(2), kase(3)] })), "hasQuestions"), "red");
  assert.equal(levelOf(teacherRuleChecks(keysDoc({ cases: [kase(1, { solution: "" }), kase(2), kase(3)] })), "hasSolution"), "red");
});

test("keys rubricSum, situationLength, realism, noDuplicateCase", () => {
  const ok = teacherRuleChecks(keysDoc());
  for (const id of ["rubricSum", "situationLength", "realism", "noDuplicateCase"]) assert.equal(levelOf(ok, id), "green", id);

  const badRubric = keysDoc({ cases: [kase(1, { rubric: [{ criterion: "A", points: 5 }, { criterion: "B", points: 8 }] }), kase(2), kase(3)] });
  assert.equal(levelOf(teacherRuleChecks(badRubric), "rubricSum"), "red");
  assert.equal(teacherRuleChecks(badRubric).find((c) => c.id === "rubricSum")?.fix?.target, "rubric");

  const short = keysDoc({ cases: [kase(1, { situation: "Bir maktabda muammo yuzaga keldi." }), kase(2), kase(3)] });
  assert.equal(levelOf(teacherRuleChecks(short), "situationLength"), "yellow");
  assert.equal(levelOf(teacherRuleChecks(short), "realism"), "yellow");

  const dup = keysDoc({ cases: [kase(1), kase(1), kase(3)] });
  assert.equal(levelOf(teacherRuleChecks(dup), "noDuplicateCase"), "red");
});

test("har `fix` mavjud nishonga ishora qiladi (bo'lim yoki jadval)", () => {
  const docs = [
    lessonDoc({ stages: [stage(1, 10), stage(2, 10)], homework: "Yo'q" }),
    mapDoc({ totalHours: 100, weeks: Array.from({ length: 34 }, (_, i) => week(i + 1, { topic: `${i + 1}-mavzu`, control: "" })) }),
    glossaryDoc({ terms: Array.from({ length: 10 }, (_, i) => term(i + 1, { def: "Qisqa.", example: "" })) }),
    keysDoc({ cases: [kase(1, { situation: "Qisqa.", solution: "", questions: [] }), kase(2), kase(3)] }),
  ];
  for (const doc of docs) {
    const targets = new Set(teacherTargets(doc));
    for (const c of teacherRuleChecks(doc)) {
      if (!c.fix) continue;
      assert.ok(targets.has(c.fix.target), `${c.id} → ${c.fix.target} (mavjud: ${[...targets].join(", ")})`);
    }
  }
});

test("jadval nishoni sintaksisi ikki tomonga ishlaydi", () => {
  assert.equal(tableTarget(0), "table:0");
  assert.equal(parseTableTarget("table:3"), 3);
  assert.equal(parseTableTarget("stages"), null);
  assert.equal(parseTableTarget("table:x"), null);
});

test("baholovchi ballari umumiy ballga qo'shiladi", async () => {
  const calls: { role: LlmRole; user: string }[] = [];
  const complete = async (role: LlmRole, _system: string, user: string) => {
    calls.push({ role, user });
    return { text: JSON.stringify({ topicAlignment: 3, timeRealism: 3, pedagogicalVariety: 3, ageFit: 3, homeworkRelevance: 3, notes: ["Yaxshi"], fixes: [{ target: "stages", instruction: "Bosqichlarni aniqlashtiring." }] }), usage: { provider: "stub", model: "s", inputTokens: 10, outputTokens: 5 } };
  };
  const high = await reviewTeacher(lessonDoc(), { complete, deadline: Date.now() + 120_000 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].role, "judge");
  assert.ok(high.checks.some((c) => c.id === "judge:topicAlignment"));
  assert.ok(high.checks.some((c) => c.id === "judge:fix:1"));
  assert.ok(high.judgeNotes.includes("Yaxshi"));

  // Past ball bergan baholovchi — umumiy ball PASAYADI (40 % ulush).
  const lowComplete = async () => ({ text: JSON.stringify({ topicAlignment: 0, timeRealism: 0, pedagogicalVariety: 0, ageFit: 0, homeworkRelevance: 0, notes: [], fixes: [] }), usage: undefined });
  const low = await reviewTeacher(lessonDoc(), { complete: lowComplete as never, deadline: Date.now() + 120_000 });
  assert.ok(low.score < high.score, `${low.score} < ${high.score}`);
});

test("baholovchi javob bermasa — neytral ball va izoh", async () => {
  const complete = async () => null;
  const r = await reviewTeacher(lessonDoc(), { complete: complete as never, deadline: Date.now() + 120_000 });
  assert.ok(r.judgeNotes.some((n) => /javob bermadi/i.test(n)));
  assert.equal(r.checks.find((c) => c.id === "judge:timeRealism")?.detail, "2/3");
});

test("baholovchi promptiga jadval ham tushadi (xaritada mazmun jadvalda)", () => {
  const prompt = teacherJudgeUserPrompt(mapDoc());
  assert.match(prompt, /TOOL: map/);
  assert.match(prompt, /## table:0/);
  assert.match(prompt, /Hujayra tuzilishi 1/);
  const targets = teacherTargets(mapDoc());
  assert.ok(targets.includes("table:0"));
});

test("eski hujjat (modelsiz) — `structure` qizil, ball 0", async () => {
  const doc = lessonDoc();
  const legacy: AcademicDoc = { ...doc, teacher: undefined };
  const checks = teacherRuleChecks(legacy);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].id, "structure");
  assert.equal(checks[0].level, "red");
  const r = await reviewTeacher(legacy, { judge: false });
  assert.equal(r.score, 0);
});

test("to'liq to'g'ri hujjatning qoidalari HAMMASI yashil", async () => {
  for (const doc of [lessonDoc(), mapDoc(), glossaryDoc(), keysDoc()]) {
    const bad = teacherRuleChecks(doc).filter((c) => c.level !== "green");
    assert.equal(bad.length, 0, `${doc.teacher?.kind}: ${bad.map((c) => `${c.id}=${c.level} (${c.detail})`).join("; ")}`);
  }
  const r = await reviewTeacher(lessonDoc(), { judge: false });
  // Qoidalar 100 % + baholovchi neytral (2/3) → 60 + 40×2/3 ≈ 87.
  assert.ok(r.score >= 80, `ball: ${r.score}`);
  /*
   * `judge:false` da baholovchi CHAQIRILMAYDI, lekin bandlari NEYTRAL
   * (2/3) qiymat bilan qoladi — `work`/`article` bilan bir xil naqsh:
   * panel har doim bir xil bandlar ro'yxatini ko'rsatadi, aks holda
   * hisobot ikki xil shaklda chiqardi.
   */
  const judgeChecks = r.checks.filter((c) => c.id.startsWith("judge:"));
  assert.equal(judgeChecks.length, 5);
  assert.ok(judgeChecks.every((c) => c.detail === "2/3"), judgeChecks.map((c) => `${c.id}=${c.detail}`).join(", "));
  assert.equal(r.judgeNotes.length, 0, "chaqirilmagan baholovchi izoh qoldirmasin");
});

test("rubrika bali TEACHER_LIMITS.rubricTotal bilan bog'langan", () => {
  // `rubricSum` bandi qattiq yozilgan 10 ga emas, reyestr qiymatiga qaraydi.
  const exact = keysDoc({ cases: [kase(1), kase(2), kase(3)] });
  assert.equal(levelOf(teacherRuleChecks(exact), "rubricSum"), "green");
  assert.equal(TEACHER_LIMITS.rubricTotal, 10);
});
