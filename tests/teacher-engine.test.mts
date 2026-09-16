import test from "node:test";
import assert from "node:assert/strict";
import { buildTeacherDoc } from "../lib/generation/teacher/engine.ts";
import { TEACHER_LIMITS } from "../lib/generation/teacher/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { writeWithLlm } from "../lib/generation/write-llm.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { FormValues, ToolId } from "../lib/types.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";

/**
 * O'QITUVCHI DVIGATELI (AUDIT-20 WP-A) — `complete` STUB bilan (tarmoq
 * yo'q), `tests/work-engine.test.mts` naqshi.
 *
 * Model javoblari ATAYLAB «ifloslangan»: daqiqalar yig'indisi noto'g'ri,
 * mavzu o'rniga «1-mavzu», tavtologik ta'rif, rubrika bali 13 — dvigatel
 * ularni qanday tuzatishini yoki rad etishini tekshiradi.
 */

type Call = { role: LlmRole; system: string; user: string };

const USAGE = { provider: "stub", model: "stub-1", inputTokens: 100, outputTokens: 50 };

const STAGE = (i: number, minutes: number) => ({
  title: `Fotosintez bosqichi ${i}`,
  minutes,
  teacher: `O'qituvchi fotosintez jarayonini xloroplast sxemasi bilan tushuntiradi va ${i}-misolni doskada yechadi.`,
  student: "O'quvchilar juft bo'lib sxemani to'ldiradi va natijani doskada tekshiradi.",
  method: ["Aqliy hujum", "Juftlikda ishlash", "Venn diagrammasi", "T-jadval", "Klaster", "Mustaqil mashq", "Bahs", "Sinkveyn"][i % 8],
  result: `Fotosintez bosqichi ${i} bo'yicha tushuntira oladi`,
});

const TERM = (i: number) => ({
  term: `Atama${String.fromCharCode(90 - (i % 26))}${i}`,
  def: `Bu tushuncha o'simlik hujayrasidagi jarayonni bildiradi va ${i}-darajadagi organoidlar ishtirokida kechadigan energiya almashinuvini izohlaydi.`,
  example: `Darsda ${i}-tajriba natijasi shu tushuncha bilan izohlanadi.`,
  ru: `Термин${i}`,
  en: `Term${i}`,
});

const WEEK = (n: number) => ({
  n,
  topic: `Hujayra tuzilishi ${n}`,
  method: n % 3 === 0 ? "Laboratoriya" : "Ma'ruza",
  resources: "Darslik bo'limi, mikroskop",
  result: `Hujayra tuzilishi ${n} ni tushuntira oladi`,
  control: n % 3 === 0 ? "Amaliy ish" : n % 2 === 0 ? "Yozma topshiriq" : "Og'zaki so'rov",
});

const CASE = (i: number) => ({
  title: `Nilufar opaning ${i}-sinfdagi holati`,
  situation:
    `5-sinf o'qituvchisi Nilufar opa yangi mavzuni tushuntirgach, sinfning yarmi topshiriqni bajara olmadi. ` +
    `Sinf jurnalida bu mavzu bo'yicha oldingi ikki darsda ham past ball qayd etilgan (${i}-guruh, 24 nafar o'quvchi). ` +
    `Nilufar opa darsni qanday qayta rejalashtirishi kerak?`,
  questions: ["Muammoning asosiy sababi nima?", "Qanday yechim taklif qilasiz?", "Natijani qanday o'lchaysiz?"],
  solution: "Avval diagnostik topshiriq bilan aniq bo'shliq aniqlanadi, so'ng mavzu kichik bo'laklarga bo'linib qayta tushuntiriladi va juftlikda mashq beriladi.",
  rubric: [
    { criterion: "Sababni jurnal ma'lumoti bilan asoslash", points: 4 },
    { criterion: "Yechimning bajariladigan qadamlari", points: 5 },
    { criterion: "Natijani o'lchash usuli", points: 4 },
  ],
});

type Opts = {
  /** Shu kalitli so'rovga BIRINCHI `n` javob bo'sh (tarmoq uzilishi taqlidi). */
  emptyFirst?: { match: string; n: number };
  judge?: (n: number) => string;
  /** Daqiqalar yig'indisi ataylab noto'g'ri. */
  badMinutes?: boolean;
  /** Mavzular o'rin egallovchi («1-mavzu»). */
  placeholderTopics?: boolean;
  /** Tavtologik ta'rif (`noStubDefinition`). */
  stubDefs?: boolean;
  /** Rubrika bali 13 (10 emas). */
  badRubric?: boolean;
  /** Qayta yozish javobi (sayqal). */
  rewrite?: string;
  stageCount?: number;
  termCount?: number;
  weekCount?: number;
  caseCount?: number;
};

function makeComplete(calls: Call[], o: Opts = {}) {
  let judgeCalls = 0;
  let empties = 0;
  return async (role: LlmRole, system: string, user: string) => {
    calls.push({ role, system, user });
    const reply = (text: string) => ({ text, usage: { ...USAGE } });
    if (o.emptyFirst && user.includes(o.emptyFirst.match) && empties++ < o.emptyFirst.n) return reply("");
    if (role === "judge") return reply(o.judge ? o.judge(++judgeCalls) : "{}");

    if (user.startsWith("Rewrite the section")) return reply(o.rewrite ?? JSON.stringify({ blocks: [{ kind: "p", text: "Qayta yozilgan aniq matn: o'quvchilar fotosintez sxemasini to'ldiradi va natijani izohlaydi." }] }));
    if (user.startsWith("Rewrite the table")) {
      const rows = Number(/EXACTLY (\d+) rows/.exec(user)?.[1] ?? 0);
      const cols = Number(/EXACTLY (\d+) cells/.exec(user)?.[1] ?? 6);
      return reply(JSON.stringify({ rows: Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, c) => (c === 0 ? String(i + 1) : `x${i}-${c}`))) }));
    }

    if (user.startsWith("Write the lesson outline")) {
      const n = o.stageCount ?? Number(/Exactly (\d+) stages/.exec(user)?.[1] ?? 6);
      const minutes = o.badMinutes ? 13 : Math.floor(45 / n);
      return reply(
        JSON.stringify({
          goal: { talim: "O'quvchi fotosintez bosqichlarini nomlay oladi.", tarbiya: "Tabiatga ehtiyotkor munosabat shakllanadi.", rivoj: "Sxema asosida tahlil qilish ko'nikmasi rivojlanadi." },
          competencies: ["Axborot bilan ishlash", "Tabiiy-ilmiy savodxonlik"],
          equipment: ["Darslik", "Mikroskop", "Tarqatma sxema"],
          stages: Array.from({ length: n }, (_, i) => STAGE(i + 1, minutes)),
          homework: "Fotosintez bosqichlari bo'yicha sxema chizib, 5 ta savolga yozma javob tayyorlang.",
          assessment: "Mezon 1 — sxemaning to'liqligi (3 ball); Mezon 2 — izohning aniqligi (2 ball). Jami 5 ball.",
        }),
      );
    }

    if (user.startsWith("Fill in the calendar-thematic plan")) {
      const from = Number(/for weeks (\d+)/.exec(user)?.[1] ?? 1);
      const count = o.weekCount ?? Number(/Exactly (\d+) rows/.exec(user)?.[1] ?? 8);
      const weeks = Array.from({ length: count }, (_, i) => (o.placeholderTopics ? { ...WEEK(from + i), topic: `${from + i}-mavzu` } : WEEK(from + i)));
      return reply(JSON.stringify({ intro: "Xarita fan dasturiga muvofiq tuzilgan.", weeks }));
    }

    if (user.startsWith("Write the glossary entries")) {
      const count = o.termCount ?? Number(/^(\d+) terms/m.exec(user)?.[1] ?? 10);
      const base = calls.filter((c) => c.user.startsWith("Write the glossary entries")).length - 1;
      const terms = Array.from({ length: count }, (_, i) => {
        const t = TERM(base * 20 + i);
        return o.stubDefs ? { ...t, def: `${t.term} — bu ${t.term} tushunchasi hisoblanadi va shuning uchun kerak.` } : t;
      });
      return reply(JSON.stringify({ intro: "Lug'at fan atamalarini qamrab oladi.", terms }));
    }

    if (user.startsWith("Write the case-study tasks")) {
      const count = o.caseCount ?? Number(/^(\d+) different cases/m.exec(user)?.[1] ?? 5);
      const base = calls.filter((c) => c.user.startsWith("Write the case-study tasks")).length - 1;
      const cases = Array.from({ length: count }, (_, i) => {
        const c = CASE(base * 10 + i + 1);
        return o.badRubric ? { ...c, rubric: [{ criterion: "Sabab", points: 5 }, { criterion: "Yechim", points: 5 }, { criterion: "O'lchov", points: 3 }] } : c;
      });
      return reply(JSON.stringify({ intro: "Keyslar guruh ishida ishlatiladi.", cases }));
    }
    return reply("{}");
  };
}

const BASE: FormValues = {
  topic: "Fotosintez jarayoni",
  subject: "Biologiya",
  grade: 7,
  language: "uz",
  university: "15-son umumiy o'rta ta'lim maktabi",
  author: "Karimova Dilnoza",
};

async function build(toolId: ToolId, values: FormValues, o: Opts = {}, extra: { judge?: boolean; polish?: boolean } = {}) {
  const calls: Call[] = [];
  const v = { ...BASE, ...values };
  const meta = extractMeta(TOOL_BY_ID[toolId], v);
  const built = await buildTeacherDoc(meta, v, {
    deadline: Date.now() + 300_000,
    complete: makeComplete(calls, o),
    judge: extra.judge ?? false,
    polish: extra.polish ?? false,
    now: new Date("2026-09-16T10:00:00Z"),
  });
  return { built, calls };
}

const ids = (doc: AcademicDoc) => doc.sections.map((s) => s.id);

/* ══════════════════════════ to'rt kind qurilishi ══════════════════════════ */

test("dars rejasi quriladi — bo'lim id lari shartnomaga mos", async () => {
  const { built } = await build("lesson-plan", { lessonType: "yangi-mavzu", duration: 45, stageCount: 6 });
  assert.ok(built, "hujjat qurilmadi");
  assert.deepEqual(ids(built.doc), ["passport", "goal", "stages", "homework"]);
  assert.equal(built.doc.teacher?.kind, "lesson");
  assert.equal(built.doc.teacher?.type, "yangi-mavzu");
  assert.equal(built.doc.teacher?.lesson?.stages.length, 6);
  // Vaqt jadvali bosqichlardan KEYIN.
  assert.equal(built.doc.tables?.[0]?.anchor, "stages");
  assert.equal(built.doc.tables?.[0]?.rows.length, 6);
});

test("texnologik xarita (yillik) quriladi — bitta jadval, `year` bo'limi", async () => {
  const { built } = await build("texnologik-xarita", { mapType: "yillik", weeklyHours: 2, totalHours: 68, topic: "Biologiya" });
  assert.ok(built);
  assert.deepEqual(ids(built.doc), ["passport", "year"]);
  assert.equal(built.doc.tables?.length, 1);
  assert.equal(built.doc.tables?.[0]?.anchor, "year");
  assert.equal(built.doc.teacher?.map?.quarters.length, 1);
});

test("glossariy quriladi — `intro`/`terms`, atamalar alifbo tartibida", async () => {
  const { built } = await build("glossary", { glossaryType: "fan-lugati", termCount: 10 });
  assert.ok(built);
  assert.deepEqual(ids(built.doc), ["intro", "terms"]);
  const terms = built.doc.teacher?.glossary?.terms ?? [];
  assert.equal(terms.length, 10);
  const sorted = [...terms].map((t) => t.term).sort(new Intl.Collator("uz", { sensitivity: "base", numeric: true }).compare);
  assert.deepEqual(terms.map((t) => t.term), sorted, "alifbo tartibi buzilgan");
});

test("keys quriladi — `intro`/`case1..N`/`rubric`", async () => {
  const { built } = await build("keys", { keysType: "muammoli", caseCount: 3 });
  assert.ok(built);
  assert.deepEqual(ids(built.doc), ["intro", "case1", "case2", "case3", "rubric"]);
  assert.equal(built.doc.teacher?.keys?.cases.length, 3);
  assert.equal(built.doc.teacher?.keys?.audience, "otm");
});

/* ══════════════════════════ qo'riqchi invariantlari ══════════════════════════ */

test("daqiqa yig'indisi davomiylikka QAT'IY tenglashtiriladi", async () => {
  // Model har bosqichga 13 daqiqa beradi: 6 × 13 = 78, dars esa 45.
  const { built } = await build("lesson-plan", { duration: 45, stageCount: 6 }, { badMinutes: true });
  assert.ok(built);
  const stages = built.doc.teacher!.lesson!.stages;
  assert.equal(stages.reduce((a, s) => a + s.minutes, 0), 45);
  // Jadvaldagi daqiqalar ham AYNI ro'yxatdan.
  assert.equal(built.doc.tables![0].rows.reduce((a, r) => a + Number(r[1]), 0), 45);
});

test("90 daqiqalik darsda ham yig'indi mos keladi (parametr ta'siri)", async () => {
  const { built } = await build("lesson-plan", { lessonType: "amaliy", duration: 90, stageCount: 6 }, { badMinutes: true });
  assert.ok(built);
  assert.equal(built.doc.teacher!.lesson!.stages.reduce((a, s) => a + s.minutes, 0), 90);
  assert.equal(built.doc.teacher!.lesson!.durationMin, 90);
});

test("soat ustuni yig'indisi `totalHours` ga teng, hafta soni soatlardan", async () => {
  const { built } = await build("texnologik-xarita", { mapType: "yillik", weeklyHours: 3, totalHours: 102, topic: "Fizika" });
  assert.ok(built);
  const weeks = built.doc.teacher!.map!.quarters.flatMap((q) => q.weeks);
  // 102 / 3 = 34 — QO'LDA yozilgan: `weeksFor` ning o'zi bilan
  // solishtirish testni tavtologiyaga aylantirardi (mutatsiya M2).
  assert.equal(weeks.length, 34);
  assert.equal(weeks.reduce((a, w) => a + w.hours, 0), 102);
  assert.equal(built.doc.tables![0].rows.reduce((a, r) => a + Number(r[1]), 0), 102);
});

test("rubrika ballari 10 ga tenglashtiriladi", async () => {
  // Model 5+5+3 = 13 beradi.
  const { built } = await build("keys", { caseCount: 3 }, { badRubric: true });
  assert.ok(built);
  for (const c of built.doc.teacher!.keys!.cases) {
    assert.equal(c.rubric.reduce((a, r) => a + r.points, 0), TEACHER_LIMITS.rubricTotal, `rubrika: ${JSON.stringify(c.rubric)}`);
  }
});

test("tavtologik ta'rif QABUL QILINMAYDI — hujjat chiqmaydi", async () => {
  const { built } = await build("glossary", { termCount: 10 }, { stubDefs: true });
  assert.equal(built, null, "stub ta'riflar bilan hujjat chiqmasligi kerak");
});

test("«1-mavzu» kabi o'rin egallovchilar rad etiladi — xarita qurilmaydi", async () => {
  const { built } = await build("texnologik-xarita", { weeklyHours: 2, totalHours: 68, topic: "Kimyo" }, { placeholderTopics: true });
  assert.equal(built, null);
});

/* ══════════════════════════ tur va parametr ta'siri ══════════════════════════ */

test("choraklik xarita — 4 chorak, 4 jadval, q1..q4 bo'limlari", async () => {
  const { built } = await build("texnologik-xarita", { mapType: "choraklik", weeklyHours: 2, totalHours: 68, topic: "Biologiya" });
  assert.ok(built);
  assert.deepEqual(ids(built.doc), ["passport", "q1", "q2", "q3", "q4"]);
  assert.equal(built.doc.tables?.length, TEACHER_LIMITS.quarters);
  assert.deepEqual(built.doc.tables?.map((t) => t.anchor), ["q1", "q2", "q3", "q4"]);
  assert.equal(built.doc.teacher?.map?.type, "choraklik");
  assert.equal(built.doc.teacher?.map?.quarters.length, 4);
  // Choraklarning haftalari yig'indisi umumiy hafta soniga teng.
  const weeks = built.doc.teacher!.map!.quarters.flatMap((q) => q.weeks);
  assert.equal(weeks.length, 34, "68 / 2 = 34 hafta");
  assert.equal(weeks.reduce((a, w) => a + w.hours, 0), 68);
});

test("uch tilli glossariy — ru/en ustunli jadval qo'shiladi", async () => {
  const { built } = await build("glossary", { glossaryType: "uch-tilli", termCount: 10, translationLangs: "ru,en" });
  assert.ok(built);
  assert.equal(built.doc.tables?.length, 1);
  assert.equal(built.doc.tables?.[0]?.headers.length, 3);
  assert.equal(built.doc.tables?.[0]?.rows.length, 10);
  assert.ok(built.doc.tables?.[0]?.rows.every((r) => r[1] && r[2]), "ru/en kataklari bo'sh");
  // Oddiy turda jadval YO'Q (parametrning strukturaviy ta'siri).
  const plain = await build("glossary", { glossaryType: "fan-lugati", termCount: 10 });
  assert.equal(plain.built?.doc.tables, undefined);
});

test("assessmentStyle=bsb alohida `assessment` bo'limini qo'shadi", async () => {
  const plain = await build("lesson-plan", { lessonType: "yangi-mavzu", assessmentStyle: "an'anaviy" });
  assert.ok(!ids(plain.built!.doc).includes("assessment"));
  const bsb = await build("lesson-plan", { lessonType: "yangi-mavzu", assessmentStyle: "bsb" });
  assert.ok(ids(bsb.built!.doc).includes("assessment"), "bsb uslubida baholash bo'limi bo'lishi kerak");
  // Turning O'ZI ham talab qilishi mumkin (`nazorat` skeletida bor).
  const nazorat = await build("lesson-plan", { lessonType: "nazorat", duration: 45 });
  assert.ok(ids(nazorat.built!.doc).includes("assessment"));
});

test("tur promptga TYPE RULES bo'lib tushadi", async () => {
  const { calls } = await build("lesson-plan", { lessonType: "nazorat", duration: 45 });
  const system = calls[0].system;
  assert.match(system, /TYPE RULES \(Assessment lesson\)/);
  assert.match(system, /there is NO «explain the new topic» stage/);
  // Halollik chegarasi beshala vositada.
  assert.match(system, /never invent a textbook page or chapter number/);
});

/* ══════════════════════════ sarf va qayta urinish ══════════════════════════ */

test("cost.calls model chaqiruvlarini sanaydi", async () => {
  const { built, calls } = await build("keys", { caseCount: 3 });
  assert.ok(built);
  assert.ok(built.cost.calls > 0, "sarf hisoblagichi bo'sh");
  assert.equal(built.cost.calls, calls.length);
  assert.ok(built.cost.outputTokens > 0);
});

test("bo'sh javobdan keyin QAYTA urinadi (dars rejasi)", async () => {
  const { built, calls } = await build("lesson-plan", { duration: 45, stageCount: 6 }, { emptyFirst: { match: "Write the lesson outline", n: 1 } });
  assert.ok(built, "qayta urinishdan keyin hujjat chiqishi kerak");
  assert.equal(calls.filter((c) => c.user.startsWith("Write the lesson outline")).length, 2);
  assert.equal(built.doc.teacher!.lesson!.stages.length, 6);
});

test("xarita bo'laklari mapPool bilan so'raladi, bo'sh bo'lak qayta so'raladi", async () => {
  const { built, calls } = await build("texnologik-xarita", { mapType: "choraklik", weeklyHours: 2, totalHours: 68, topic: "Biologiya" }, { emptyFirst: { match: "quarter 1 of 4", n: 1 } });
  assert.ok(built);
  const mapCalls = calls.filter((c) => c.user.startsWith("Fill in the calendar-thematic plan"));
  // 4 chorak + 1 qayta so'rov.
  assert.equal(mapCalls.length, TEACHER_LIMITS.quarters + 1);
});

test("glossariy 20 talik bo'laklarga bo'linadi", async () => {
  const { built, calls } = await build("glossary", { termCount: 40 });
  assert.ok(built);
  const asks = calls.filter((c) => c.user.startsWith("Write the glossary entries"));
  assert.equal(asks.length, 2, `bo'laklar: ${asks.length}`);
  assert.equal(built.doc.teacher!.glossary!.terms.length, 40);
});

/* ══════════════════════════ delivered ══════════════════════════ */

test("delivered: hafta / atama / keys soni", async () => {
  const map = await build("texnologik-xarita", { weeklyHours: 2, totalHours: 68, topic: "Biologiya" });
  assert.equal(map.built?.delivered?.unit, "hafta");
  assert.equal(map.built?.delivered?.want, 34);
  assert.equal(map.built?.delivered?.got, 34);

  const glossary = await build("glossary", { termCount: 20 });
  assert.deepEqual(glossary.built?.delivered, { got: 20, want: 20, unit: "atama" });

  const keys = await build("keys", { caseCount: 5 });
  assert.deepEqual(keys.built?.delivered, { got: 5, want: 5, unit: "keys" });

  // Dars rejasida `delivered` YO'Q — bosqich soni hisobotda ko'rsatiladi.
  const lesson = await build("lesson-plan", {});
  assert.equal(lesson.built?.delivered, undefined);
});

/* ══════════════════════════ hisobot va sayqal ══════════════════════════ */

test("hisobot hujjatga ulanadi (`doc.teacher.review`)", async () => {
  const { built } = await build("lesson-plan", { duration: 45, stageCount: 6 }, { judge: () => JSON.stringify({ topicAlignment: 3, timeRealism: 3, pedagogicalVariety: 3, ageFit: 3, homeworkRelevance: 3, notes: ["Yaxshi"], fixes: [] }) }, { judge: true });
  assert.ok(built);
  const review = built.doc.teacher?.review;
  assert.ok(review, "hisobot yo'q");
  assert.ok(review.score > 0, `ball: ${review?.score}`);
  assert.ok(review.checks.some((c) => c.id === "minutesSum"));
  assert.ok(review.checks.some((c) => c.id === "judge:topicAlignment"));
});

test("judge:false — baholovchi chaqirilmaydi, ball qoidalardan", async () => {
  const { built, calls } = await build("glossary", { termCount: 10 });
  assert.ok(built);
  assert.equal(calls.filter((c) => c.role === "judge").length, 0);
  assert.ok(built.doc.teacher?.review);
});

test("avto-sayqal: ball oshsa hujjat almashadi, oshmasa eski qoladi", async () => {
  /*
   * Birinchi baholash past (1/3), sayqaldan keyingi qayta baholash
   * yuqori (3/3) — ball `acceptDelta` (+1) dan ko'p oshadi, demak
   * qabul qilinadi va `polish.accepted` rost bo'ladi.
   */
  const scores = [1, 3];
  const judge = (n: number) => {
    const v = scores[Math.min(n - 1, scores.length - 1)];
    return JSON.stringify({ topicAlignment: v, timeRealism: v, pedagogicalVariety: v, ageFit: v, homeworkRelevance: v, notes: [], fixes: [] });
  };
  const { built } = await build("lesson-plan", { duration: 45, stageCount: 6 }, { judge }, { judge: true, polish: true });
  assert.ok(built);
  const log = built.doc.teacher?.polish;
  assert.ok(log, "sayqal jurnali yo'q");
  assert.ok(log.after > log.before, `${log.before} → ${log.after}`);
  assert.equal(log.accepted, true);
});

/* ══════════════════════════ dispatch ══════════════════════════ */

test("o'qituvchi vositasi bo'lmagan toolId — dvigatel `null`", async () => {
  const meta = extractMeta(TOOL_BY_ID.referat, { topic: "X" });
  const built = await buildTeacherDoc(meta, { topic: "X" }, { deadline: Date.now() + 60_000, complete: makeComplete([]) });
  assert.equal(built, null);
});

test("`test` vositasi — WP-B dvigateli ulanmaguncha `null` (eski yo'l yo'q)", async () => {
  const meta = extractMeta(TOOL_BY_ID.test, { topic: "Hosila" });
  const built = await buildTeacherDoc(meta, { topic: "Hosila" }, { deadline: Date.now() + 60_000, complete: makeComplete([]) });
  assert.equal(built, null);
});

test("TEACHER_ENGINE=0 — dvigatel chetlab o'tiladi (eski `write-specials` yo'li)", async () => {
  const prev = process.env.TEACHER_ENGINE;
  // `npm test` `.env.local` bilan yuradi — kalit bo'lsa eski yo'l HAQIQIY LLM ga
  // borib hujjat qaytaradi (va pul sarflaydi); kalitlarni vaqtincha olib qo'yamiz.
  const keys = ["GEMINI_API_KEY", "XAI_API_KEY", "OPENAI_API_KEY"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  process.env.TEACHER_ENGINE = "0";
  try {
    // LLM kaliti yo'q muhitda eski yo'l ham `null` qaytaradi — muhimi,
    // oqim dvigatelga KIRMAYDI va xato tashlanmaydi (R0 da qulflangan xulq).
    const meta = extractMeta(TOOL_BY_ID["lesson-plan"], BASE);
    const doc = await writeWithLlm(meta, BASE, Date.now() + 30_000);
    assert.equal(doc, null);
  } finally {
    if (prev === undefined) delete process.env.TEACHER_ENGINE;
    else process.env.TEACHER_ENGINE = prev;
    for (const k of keys) if (saved[k] !== undefined) process.env[k] = saved[k];
  }
});

test("LLM yo'q va `complete` berilmagan — dvigatel `null` (eski yo'lga qaytish)", async () => {
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevXai = process.env.XAI_API_KEY;
  const prevOpenai = process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.XAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const meta = extractMeta(TOOL_BY_ID.glossary, BASE);
    const built = await buildTeacherDoc(meta, BASE, { deadline: Date.now() + 30_000 });
    assert.equal(built, null);
  } finally {
    if (prevGemini !== undefined) process.env.GEMINI_API_KEY = prevGemini;
    if (prevXai !== undefined) process.env.XAI_API_KEY = prevXai;
    if (prevOpenai !== undefined) process.env.OPENAI_API_KEY = prevOpenai;
  }
});
