import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAP_WEEK_RATIO,
  TEACHER_COUNT_RATIO,
  TEACHER_MINUTES_TOLERANCE,
  TEST_COUNT_RATIO,
  fileSuffix,
  pageGateApplies,
  teacherGateFail,
} from "../lib/generation/index.ts";
import { hardMissing, missingStructure, needLabel, structureNeeds } from "../lib/generation/structure.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import { TEACHER_TOOL_LIST } from "../lib/generation/teacher/types.ts";
import type { AcademicDoc, DocMeta } from "../lib/generation/types.ts";
import type { FormValues } from "../lib/types.ts";

/**
 * O'QITUVCHI VOSITALARINI ULASH (AUDIT-20 WP-F).
 *
 * Bu fayl `buildArtifact` ning darvozalarini va `structure.ts` dagi
 * bo'lim shartnomasini qulflaydi. Dvigatelning O'ZI (`teacher/**`)
 * `teacher-engine`/`teacher-test-engine` da sinaladi — bu yerda
 * ULANISH: darvoza to'g'ri sonni ko'radimi, eski yo'l tirik qoldimi,
 * fayl nomi vositani ayta oladimi.
 */

const metaOf = (toolId: keyof typeof TOOL_BY_ID, values: FormValues = {}): DocMeta =>
  extractMeta(TOOL_BY_ID[toolId], values);

/** Bo'limlari bo'sh bo'lmagan eng kichik hujjat (darvoza faqat MODELNI o'lchaydi). */
function docOf(meta: DocMeta, teacher: unknown, ids: string[] = []): AcademicDoc {
  return {
    meta,
    titlePage: true,
    toc: false,
    sections: ids.map((id) => ({ id, title: id, blocks: [{ kind: "p", text: "matn" }] })),
    teacher,
  } as unknown as AcademicDoc;
}

const stages = (n: number, total: number) =>
  Array.from({ length: n }, (_, i) => ({
    title: `Bosqich ${i + 1}`,
    minutes: i === n - 1 ? total - Math.floor(total / n) * (n - 1) : Math.floor(total / n),
    teacher: "tushuntiradi",
    student: "bajaradi",
    method: "suhbat",
    result: "natija",
  }));

const lessonDoc = (o: { stages: number; minutes: number; duration?: number; type?: string }) => {
  const meta = metaOf("lesson-plan", { topic: "Kasrlar", subject: "Matematika", grade: 5, duration: 45 });
  return docOf(
    meta,
    {
      v: 1,
      kind: "lesson",
      type: o.type ?? "yangi-mavzu",
      school: { institution: "15-maktab", author: "A", subject: "Matematika", grade: 5, language: "uz" },
      lesson: {
        type: o.type ?? "yangi-mavzu",
        goal: { talim: "a", tarbiya: "b", rivoj: "c" },
        competencies: [],
        equipment: [],
        stages: stages(o.stages, o.minutes),
        homework: "5 ta misol",
        assessment: "og'zaki",
        durationMin: o.duration ?? 45,
      },
    },
    ["passport", "goal", "stages", "homework"],
  );
};

const mapDoc = (o: { weeks: number; type?: "yillik" | "choraklik"; quarters?: number }) => {
  const meta = metaOf("texnologik-xarita", { subject: "Biologiya", weeklyHours: 4, totalHours: 136 });
  const type = o.type ?? "yillik";
  const qCount = o.quarters ?? (type === "choraklik" ? 4 : 1);
  const per = Math.floor(o.weeks / qCount);
  const quarters = Array.from({ length: qCount }, (_, qi) => ({
    n: type === "choraklik" ? qi + 1 : 0,
    weeks: Array.from({ length: qi === qCount - 1 ? o.weeks - per * (qCount - 1) : per }, (_, i) => ({
      n: i + 1,
      topic: `Mavzu ${qi}-${i}`,
      hours: 4,
      method: "m",
      resources: "r",
      result: "n",
      control: "k",
    })),
  }));
  return docOf(
    meta,
    {
      v: 1,
      kind: "map",
      type,
      school: { institution: "15-maktab", author: "A", subject: "Biologiya", grade: 8, language: "uz" },
      map: { type, weeklyHours: 4, totalHours: 136, quarters },
    },
    type === "choraklik" ? ["passport", "q1", "q2", "q3", "q4"] : ["passport", "year"],
  );
};

const glossaryDoc = (n: number, values: FormValues = { topic: "Fotosintez", termCount: "20" }) => {
  const meta = metaOf("glossary", values);
  return docOf(
    meta,
    {
      v: 1,
      kind: "glossary",
      type: "fan-lugati",
      school: { institution: "15-maktab", author: "A", subject: "Biologiya", grade: 8, language: "uz" },
      glossary: { type: "fan-lugati", order: "alpha", terms: Array.from({ length: n }, (_, i) => ({ term: `A${i}`, def: "ta'rif" })) },
    },
    ["intro", "terms"],
  );
};

const keysDoc = (n: number, values: FormValues = { topic: "Pedagogika", caseCount: 5 }) => {
  const meta = metaOf("keys", values);
  return docOf(
    meta,
    {
      v: 1,
      kind: "keys",
      type: "muammoli",
      school: { institution: "TDPU", author: "A", subject: "Pedagogika", grade: 0, language: "uz" },
      keys: {
        type: "muammoli",
        audience: "otm",
        cases: Array.from({ length: n }, (_, i) => ({ title: `Keys ${i}`, situation: "s", questions: ["q"], solution: "k", rubric: [{ criterion: "c", points: 10 }] })),
      },
    },
    ["intro", "case1", "rubric"],
  );
};

const testDoc = (o: { questions: number; count?: number; variants?: string[]; keyLen?: number }) => {
  const values: FormValues = { topic: "Hosila", subject: "Matematika", grade: 10, count: o.count ?? 20, variants: (o.variants ?? ["A", "B"]).length };
  const meta = metaOf("test", values);
  const variants = (o.variants ?? ["A", "B"]).map((id) => ({ id, order: Array.from({ length: o.questions }, (_, i) => i), optionOrder: [] }));
  const keyLen = o.keyLen ?? o.questions;
  const doc = docOf(
    meta,
    {
      v: 1,
      kind: "test",
      type: "nazorat",
      school: { institution: "15-maktab", author: "A", subject: "Matematika", grade: 10, language: "uz" },
      test: {
        mode: "topic",
        type: "nazorat",
        questions: Array.from({ length: o.questions }, (_, i) => ({ id: `q${i}`, kind: "single", stem: "?", options: ["a", "b", "c", "d"], answer: 0, points: 1, bloom: "remember", difficulty: "oson", explanation: "e" })),
        variants,
        key: Object.fromEntries(variants.map((v) => [v.id, Array.from({ length: keyLen }, () => "A")])),
        scoring: { perQuestion: 1, total: o.questions, gradeScale: [] },
        instructions: ["1"],
        timeMin: 45,
        topicIds: [],
      },
    },
    ["instructions", ...variants.map((v) => `variant-${v.id}`)],
  );
  return { doc, values, meta };
};

/* ───────────────────────── darvozalar ───────────────────────── */

test("darvoza — dars rejasi: bosqich soni tur minimumidan kam bo'lsa yiqiladi", () => {
  const meta = metaOf("lesson-plan", { topic: "Kasrlar", duration: 45 });
  // `yangi-mavzu` turida minimum 5 bosqich (reyestr).
  assert.equal(teacherGateFail(meta, { duration: 45 }, lessonDoc({ stages: 6, minutes: 45 })), null);
  const fail = teacherGateFail(meta, { duration: 45 }, lessonDoc({ stages: 3, minutes: 45 }));
  assert.equal(fail?.rule, "lesson.stages");
  assert.match(fail!.message, /Kredit qaytariladi/);
});

test("darvoza — dars rejasi: daqiqa yig'indisi ± 5 dan chiqsa yiqiladi (tolerans mutatsiyasi)", () => {
  const meta = metaOf("lesson-plan", { topic: "Kasrlar", duration: 45 });
  const v: FormValues = { duration: 45 };
  // Chegarada (aynan ±5) — O'TADI.
  assert.equal(teacherGateFail(meta, v, lessonDoc({ stages: 6, minutes: 50 })), null, "45 + 5 tolerans ichida");
  assert.equal(teacherGateFail(meta, v, lessonDoc({ stages: 6, minutes: 40 })), null, "45 − 5 tolerans ichida");
  // Bir daqiqa nariroq — YIQILADI. MUTATSIYA: tolerans 10 ga oshirilsa shu qator yashil qolardi.
  assert.equal(teacherGateFail(meta, v, lessonDoc({ stages: 6, minutes: 51 }))?.rule, "lesson.minutes");
  assert.equal(teacherGateFail(meta, v, lessonDoc({ stages: 6, minutes: 39 }))?.rule, "lesson.minutes");
  assert.equal(TEACHER_MINUTES_TOLERANCE, 5);
});

test("darvoza — xarita: haftalar 0.9 dan kam bo'lsa yiqiladi, choraklik 4 chorak talab qiladi", () => {
  const meta = metaOf("texnologik-xarita", { subject: "Biologiya", weeklyHours: 4, totalHours: 136 });
  const v: FormValues = { weeklyHours: 4, totalHours: 136 };
  // 136 / 4 = 34 hafta → kerak ceil(34 × 0.9) = 31.
  assert.equal(MAP_WEEK_RATIO, 0.9);
  assert.equal(teacherGateFail(meta, v, mapDoc({ weeks: 34 })), null);
  assert.equal(teacherGateFail(meta, v, mapDoc({ weeks: 31 })), null, "aynan chegara o'tadi");
  assert.equal(teacherGateFail(meta, v, mapDoc({ weeks: 30 }))?.rule, "map.weeks");
  // Choraklik: hafta soni yetsa ham, uchta chorak «yil rejasi» emas.
  assert.equal(teacherGateFail(meta, v, mapDoc({ weeks: 34, type: "choraklik" })), null);
  assert.equal(teacherGateFail(meta, v, mapDoc({ weeks: 34, type: "choraklik", quarters: 3 }))?.rule, "map.quarters");
});

test("darvoza — xarita: hafta soni BARCHA choraklardan sanaladi (birinchi jadval emas)", () => {
  const meta = metaOf("texnologik-xarita", { subject: "Biologiya", weeklyHours: 4, totalHours: 136 });
  const doc = mapDoc({ weeks: 34, type: "choraklik" });
  const first = doc.teacher!.map!.quarters[0].weeks.length;
  assert.ok(first < 31, `bitta chorak ${first} hafta — 0.9 darvozasidan o'tmaydi`);
  assert.equal(teacherGateFail(meta, { weeklyHours: 4, totalHours: 136 }, doc), null, "MUTATSIYA: faqat 1-chorak sanalsa yiqilardi");
});

test("darvoza — glossariy va keys: 0.7 ulushi", () => {
  assert.equal(TEACHER_COUNT_RATIO, 0.7);
  const gMeta = metaOf("glossary", { topic: "Fotosintez", termCount: "20" });
  const gv: FormValues = { termCount: "20" };
  assert.equal(teacherGateFail(gMeta, gv, glossaryDoc(14)), null, "ceil(20 × 0.7) = 14");
  assert.equal(teacherGateFail(gMeta, gv, glossaryDoc(13))?.rule, "glossary.terms");

  const kMeta = metaOf("keys", { topic: "Pedagogika", caseCount: 5 });
  const kv: FormValues = { caseCount: 5 };
  assert.equal(teacherGateFail(kMeta, kv, keysDoc(4)), null, "ceil(5 × 0.7) = 4");
  assert.equal(teacherGateFail(kMeta, kv, keysDoc(3))?.rule, "keys.cases");
});

test("darvoza — test: savol 0.8 va kalit uzunligi (0.8 mutatsiyasi)", () => {
  assert.equal(TEST_COUNT_RATIO, 0.8);
  const ok16 = testDoc({ questions: 16, count: 20 });
  assert.equal(teacherGateFail(ok16.meta, ok16.values, ok16.doc), null, "ceil(20 × 0.8) = 16");
  const bad = testDoc({ questions: 15, count: 20 });
  assert.equal(teacherGateFail(bad.meta, bad.values, bad.doc)?.rule, "test.count", "MUTATSIYA: 0.7 bo'lsa 15 ham o'tardi");

  // Kalit savol sonidan qisqa — sayqal/tahrirdan keyin ESKI ro'yxat qolgan.
  const stale = testDoc({ questions: 20, count: 20, keyLen: 18 });
  const fail = teacherGateFail(stale.meta, stale.values, stale.doc);
  assert.equal(fail?.rule, "test.key");
  assert.match(fail!.message, /A, B/);
});

test("darvoza — `doc.teacher` yo'q bo'lsa (eski yo'l) `null`: 4 xizmat o'chib qolmaydi", () => {
  for (const id of ["lesson-plan", "texnologik-xarita", "glossary", "keys"] as const) {
    const meta = metaOf(id, { topic: "X" });
    const doc = { meta, titlePage: true, toc: false, sections: [{ id: "kirish", title: "Kirish", blocks: [{ kind: "p", text: "matn" }] }] } as unknown as AcademicDoc;
    assert.equal(teacherGateFail(meta, { topic: "X" }, doc), null, `${id}: TEACHER_ENGINE=0 yo'li yiqilmasligi kerak`);
    assert.deepEqual(hardMissing(meta, doc), [], `${id}: eski hujjatda bo'lim shartnomasi qo'llanmaydi`);
  }
});

/* ───────────────────────── hajm/bet darvozalari ───────────────────────── */

test("hajm darvozasi o'qituvchi vositalarini SO'Z bilan o'lchamaydi", () => {
  const src = readFileSync(new URL("../lib/generation/index.ts", import.meta.url), "utf8");
  const gated = /const LENGTH_GATED = new Set\(\[([^\]]*)\]\)/.exec(src)?.[1] ?? "";
  for (const id of TEACHER_TOOL_LIST) {
    assert.ok(!gated.includes(`"${id}"`), `MUTATSIYA: ${id} LENGTH_GATED ga qo'shilgan — hajm so'z bilan o'lchanardi`);
    assert.equal(pageGateApplies(id, { meta: {}, sections: [] } as unknown as AcademicDoc), false, `${id}: bet darvozasi bo'lmasligi kerak`);
  }
  // Talaba ishi va maqola darvoza OSTIDA qoladi (darvoza umuman o'chib qolmasin).
  assert.equal(pageGateApplies("referat", { meta: {}, sections: [] } as unknown as AcademicDoc), true);
});

/* ───────────────────────── bo'lim shartnomasi ───────────────────────── */

test("structureNeeds — kind bo'yicha bo'lim id shartnomasi", () => {
  const lesson = lessonDoc({ stages: 6, minutes: 45 });
  assert.deepEqual(structureNeeds(lesson.meta, lesson), ["teacher:passport", "teacher:goal", "teacher:stages", "teacher:homework"]);
  // `assessment` ATAYIN yo'q: u tur/uslub tanloviga bog'liq.
  assert.ok(!structureNeeds(lesson.meta, lesson).includes("teacher:assessment"));

  const yillik = mapDoc({ weeks: 34 });
  assert.deepEqual(structureNeeds(yillik.meta, yillik), ["teacher:passport", "teacher:year"]);
  const chorak = mapDoc({ weeks: 34, type: "choraklik" });
  assert.deepEqual(structureNeeds(chorak.meta, chorak), ["teacher:passport", "teacher:q1", "teacher:q2", "teacher:q3", "teacher:q4"]);

  const glo = glossaryDoc(20);
  assert.deepEqual(structureNeeds(glo.meta, glo), ["teacher:terms"]);
  const keys = keysDoc(5);
  assert.deepEqual(structureNeeds(keys.meta, keys), ["teacher:intro", "teacher:case1", "teacher:rubric"]);
  const t = testDoc({ questions: 20 });
  assert.deepEqual(structureNeeds(t.meta, t.doc), ["teacher:instructions", "teacher:variant-A", "teacher:variant-B"]);

  // Model yo'q (eski hujjat) — talab ham yo'q.
  assert.deepEqual(structureNeeds(lesson.meta), []);
});

test("bo'lim darvozasi: bo'sh bo'lim «bor» hisoblanmaydi va xabar o'zbekcha", () => {
  const doc = lessonDoc({ stages: 6, minutes: 45 });
  doc.sections = doc.sections.map((s) => (s.id === "stages" ? { ...s, blocks: [] } : s));
  assert.deepEqual(missingStructure(doc.meta, doc), ["teacher:stages"]);
  assert.deepEqual(hardMissing(doc.meta, doc), ["teacher:stages"], "o'qituvchi bo'limlari QAT'IY");
  assert.equal(needLabel("teacher:stages"), "«Dars bosqichlari» bo'limi");
  assert.equal(needLabel("teacher:q3"), "«III chorak» bo'limi");
  assert.equal(needLabel("teacher:case2"), "«2-keys» bo'limi");
  assert.equal(needLabel("teacher:variant-B"), "«B-variant» bo'limi");
});

/* ───────────────────────── fayl nomi va sarf ───────────────────────── */

test("fayl nomi qo'shimchasi — beshala vosita bir-biridan ajraladi", () => {
  assert.deepEqual(
    TEACHER_TOOL_LIST.map(fileSuffix),
    ["-dars", "-xarita", "-glossariy", "-keys", "-test"],
  );
  assert.equal(new Set(TEACHER_TOOL_LIST.map(fileSuffix)).size, TEACHER_TOOL_LIST.length, "qo'shimchalar noyob");
  // Boshqa vositalar o'zgarmaydi.
  assert.equal(fileSuffix("referat"), "");
  assert.equal(fileSuffix("article"), "");
});

test("`onCost` teacher yo'lidan `BuiltFile.cost` ga yetib boradi", () => {
  const wl = readFileSync(new URL("../lib/generation/write-llm.ts", import.meta.url), "utf8");
  const branch = wl.slice(wl.indexOf("TEACHER_TOOLS.has(meta.toolId)"));
  const body = branch.slice(0, branch.indexOf("\n  if (WRITER.has"));
  assert.match(body, /onCost: extras\.onCost/, "MUTATSIYA: teacher shoxi onCost ni uzatmasa cost_json bo'sh qolardi");

  const engine = readFileSync(new URL("../lib/generation/teacher/engine.ts", import.meta.url), "utf8");
  assert.match(engine, /opts\.onCost\?\.\(cost\)/);
  const testEngine = readFileSync(new URL("../lib/generation/teacher/test/engine.ts", import.meta.url), "utf8");
  assert.match(testEngine, /opts\.onCost\?\.\(cost\)/);

  const idx = readFileSync(new URL("../lib/generation/index.ts", import.meta.url), "utf8");
  assert.match(idx, /onCost: \(c\) => \(cost = c\)/);
});

test("worker: `tool.modes` bo'lgan HAR vosita manba faylini oladi (test fayl rejimi)", () => {
  const src = readFileSync(new URL("../lib/server/worker.ts", import.meta.url), "utf8");
  assert.match(src, /const source = tool\.modes \? await sourceForJob\(/);
  assert.ok(!/tool\.id === "translation" \? await sourceForJob/.test(src), "MUTATSIYA: manba faqat tarjimonga uzatilsa test fayl rejimi jim o'lardi");
  // Reyestr: test vositasi fayl rejimini e'lon qiladi.
  assert.ok(TOOL_BY_ID.test.modes?.some((m) => m.id === "file"), "test vositasida «Fayl asosida» rejimi bo'lishi kerak");
  // `modes` yo'q vositalarda so'rov ham qilinmaydi.
  assert.equal(TOOL_BY_ID.glossary.modes, undefined);
});
