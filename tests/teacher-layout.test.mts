import test from "node:test";
import assert from "node:assert/strict";
import { planTeacher, teacherDateText, type TeacherBodyItem, type TeacherPlan } from "../lib/generation/teacher/layout.ts";
import { legacyTeacherModel } from "../lib/generation/teacher/legacy.ts";
import { sampleTeacherDoc } from "../lib/generation/teacher/samples.ts";
import type { AcademicDoc, DocMeta } from "../lib/generation/types.ts";

/**
 * O'QITUVCHI HUJJATI MAKETI (AUDIT-20 WP-C) — `planTeacher` YAGONA
 * manba bo'lgani uchun bu yerda tartib, rasmiy shapka, albom, sahifa
 * uzilishi va eski hujjat xatti-harakati qulflanadi. DOCX va ko'ruvchi
 * testlari (`teacher-docx`, `viewer/teacher-parity`) shu rejani CHIZISHNI
 * tekshiradi — qaror esa shu fayldagi tekshiruvlar bilan himoyalangan.
 */

const heads = (plan: TeacherPlan) => plan.head;
const fields = (plan: TeacherPlan) => Object.fromEntries(plan.head.filter((h) => h.k === "field").map((h) => [h.label, h.k === "field" ? h.text : ""]));
const texts = (items: TeacherBodyItem[], k: TeacherBodyItem["k"]) =>
  items.filter((b) => b.k === k).map((b) => ("text" in b ? b.text : ""));
const tablesOf = (plan: TeacherPlan) => plan.body.filter((b): b is Extract<TeacherBodyItem, { k: "table" }> => b.k === "table");

/* ══════════════════════════ shapka ══════════════════════════ */

test("shapka: «Tasdiqlayman» O'NG YUQORIDA, birinchi band — titul beti YO'Q", () => {
  const plan = planTeacher(sampleTeacherDoc("lesson"));
  const first = heads(plan)[0];
  assert.equal(first.k, "approve", `birinchi shapka bandi «Tasdiqlayman» bloki bo'lishi kerak: ${first.k}`);
  assert.ok(first.k === "approve" && first.lines[0] === "Tasdiqlayman", "yorliq «Tasdiqlayman» bo'lishi kerak");
  assert.ok(first.k === "approve" && /o‘rinbosari/.test(first.lines[1]), "lavozim qatori bo'lishi kerak");
  // Titul beti umuman yo'q: reja «title» BETI emas, shapka QATORINI beradi.
  assert.ok(!plan.body.some((b) => b.k === "h1" && b.text === "MUNDARIJA"), "mundarija ham, titul beti ham bo'lmasligi kerak");
  const kinds = heads(plan).map((h) => h.k);
  assert.deepEqual(kinds.slice(0, 4), ["approve", "org", "title", "subtitle"]);
});

test("shapka maydonlari: muassasa, fan, sinf+harf, mavzu, tuzuvchi, sana", () => {
  const plan = planTeacher(sampleTeacherDoc("lesson"));
  const org = heads(plan).find((h) => h.k === "org");
  assert.ok(org?.k === "org" && /15-son umumiy o‘rta ta’lim maktabi/.test(org.text), "muassasa nomi shapkada");
  const f = fields(plan);
  assert.equal(f["Fan"], "Biologiya");
  assert.equal(f["Sinf"], "7-A", "sinf harfi bilan «7-A» bo'lishi kerak");
  assert.equal(f["Mavzu"], "Fotosintez va uning bosqichlari");
  assert.equal(f["Tuzuvchi"], "Karimova Dilnoza Baxtiyorovna", "o'qituvchi hujjatida «Tuzuvchi» (Bajardi emas)");
  assert.equal(f["Sana"], "16.09.2026", "ISO sana DD.MM.YYYY ga o'giriladi");
});

test("shapka: sinf harfi bo'lmasa faqat raqam, «Tasdiqlayman» bo'sh bo'lsa qator umuman chizilmaydi", () => {
  const doc = sampleTeacherDoc("lesson", undefined, { approver: "" });
  doc.teacher!.school.gradeLetter = "";
  const plan = planTeacher(doc);
  assert.equal(fields(plan)["Sinf"], "7", "harfsiz sinf «7» bo'lishi kerak");
  assert.ok(!plan.head.some((h) => h.k === "approve"), "«Tasdiqlayman» lavozimi yo'q bo'lsa blok chizilmaydi");
  assert.equal(plan.head[0].k, "org", "shapka muassasadan boshlanadi");
});

test("shapka tili hujjat tiliga ergashadi (uz/ru/en)", () => {
  const ru = planTeacher(sampleTeacherDoc("lesson", { language: "ru" }));
  assert.equal(ru.head.find((h) => h.k === "title")?.k === "title" ? (ru.head.find((h) => h.k === "title") as { text: string }).text : "", "ПЛАН-КОНСПЕКТ УРОКА");
  assert.ok(ru.head.some((h) => h.k === "approve" && h.lines[0] === "Утверждаю"), "ruscha «Утверждаю»");
  assert.ok("Предмет" in fields(ru), `ruscha «Предмет» yorlig'i: ${Object.keys(fields(ru)).join(", ")}`);

  const en = planTeacher(sampleTeacherDoc("glossary", { language: "en" }));
  assert.equal((en.head.find((h) => h.k === "title") as { text: string }).text, "GLOSSARY");
  assert.equal(en.labels.lang, "en");
});

test("`teacherDateText` ISO sanani o'giradi, boshqa shaklni tegmaydi", () => {
  assert.equal(teacherDateText("2026-09-16"), "16.09.2026");
  assert.equal(teacherDateText("16 sentyabr"), "16 sentyabr");
  assert.equal(teacherDateText(undefined), "");
});

/* ══════════════════════════ dars ishlanmasi ══════════════════════════ */

test("dars ishlanmasi: maqsad uch qismli, bosqichlar nasri va VAQT JADVALI", () => {
  const doc = sampleTeacherDoc("lesson");
  const plan = planTeacher(doc);
  const kvLabels = plan.body.filter((b) => b.k === "kv").map((b) => (b.k === "kv" ? b.label : ""));
  for (const l of ["Ta’limiy maqsad:", "Tarbiyaviy maqsad:", "Rivojlantiruvchi maqsad:"]) {
    assert.ok(kvLabels.includes(l), `«${l}» bo'lishi kerak`);
  }
  const t = tablesOf(plan);
  assert.equal(t.length, 1, "dars ishlanmasida bitta jadval — vaqt taqsimoti");
  assert.deepEqual(t[0].table.headers, ["Bosqich", "Daqiqa", "Kutilgan natija"]);
  const sum = t[0].table.rows.reduce((a, r) => a + Number(r[1]), 0);
  assert.equal(sum, doc.teacher!.lesson!.durationMin, "daqiqalar yig'indisi dars davomiyligiga teng");
  // Har bosqich nasri: o'qituvchi va o'quvchi faoliyati alohida.
  assert.ok(kvLabels.includes("O‘qituvchi:") && kvLabels.includes("O‘quvchi:"), "bosqichda ikki ustunli faoliyat");
});

test("dars ishlanmasi PORTRET (albom faqat xaritada)", () => {
  assert.equal(planTeacher(sampleTeacherDoc("lesson")).landscape, false);
  assert.equal(planTeacher(sampleTeacherDoc("glossary")).landscape, false);
  assert.equal(planTeacher(sampleTeacherDoc("keys")).landscape, false);
  assert.equal(planTeacher(sampleTeacherDoc("test")).landscape, false);
});

/* ══════════════════════════ texnologik xarita ══════════════════════════ */

test("xarita: ALBOM, choraklik turda 4 jadval, 6 ustun", () => {
  const plan = planTeacher(sampleTeacherDoc("map"));
  assert.equal(plan.landscape, true, "xarita albom bo'lishi kerak");
  const t = tablesOf(plan);
  assert.equal(t.length, 4, "choraklik xaritada har chorak uchun bitta jadval");
  assert.equal(t[0].table.headers.length, 6);
  assert.deepEqual(t[0].table.headers.slice(0, 4), ["Hafta", "Soat", "Mavzu", "Metod"]);
  const heads1 = plan.body.filter((b) => b.k === "h1").map((b) => (b.k === "h1" ? b.text : ""));
  assert.ok(heads1.includes("I chorak") && heads1.includes("IV chorak"), `chorak sarlavhalari: ${heads1.join(" | ")}`);
});

test("xarita `yillik` turda bitta jadval va barcha haftalar", () => {
  const plan = planTeacher(sampleTeacherDoc("map", undefined, { type: "yillik" }));
  const t = tablesOf(plan);
  assert.equal(t.length, 1);
  assert.equal(t[0].table.rows.length, 12, "barcha haftalar bitta jadvalda");
  assert.equal(t[0].number, "1", "jadval raqami 1 dan boshlanadi");
});

/* ══════════════════════════ glossariy ══════════════════════════ */

test("glossariy: atamalar ALIFBO tartibida, har biri sarlavha + ta'rif", () => {
  const plan = planTeacher(sampleTeacherDoc("glossary"));
  const terms = texts(plan.body, "h3");
  assert.ok(terms.length >= 8, `atamalar ro'yxati bo'sh bo'lmasin: ${terms.length}`);
  const sorted = [...terms].sort(new Intl.Collator("uz", { sensitivity: "base", numeric: true }).compare);
  assert.deepEqual(terms, sorted, `alifbo tartibi buzilgan: ${terms.join(" | ")}`);
  assert.equal(tablesOf(plan).length, 0, "oddiy glossariyda jadval yo'q (takror nusxa bo'lardi)");
});

test("glossariy `uch-tilli` turda ro'yxat o'rniga 4 ustunli JADVAL", () => {
  const plan = planTeacher(sampleTeacherDoc("glossary", undefined, { type: "uch-tilli" }));
  const t = tablesOf(plan);
  assert.equal(t.length, 1);
  assert.deepEqual(t[0].table.headers, ["Atama", "Ta’rif", "Ruscha", "Inglizcha"]);
  assert.equal(texts(plan.body, "h3").length, 0, "jadval turida atama sarlavhalari takrorlanmaydi");
});

/* ══════════════════════════ keys ══════════════════════════ */

test("keys: har vaziyat — bayon, topshiriqlar, kalit, rubrika va JAMI ball", () => {
  const plan = planTeacher(sampleTeacherDoc("keys"));
  const h3 = texts(plan.body, "h3");
  assert.equal(h3.filter((t) => t === "Topshiriqlar").length, 3);
  assert.equal(h3.filter((t) => t === "Namunaviy kalit").length, 3);
  assert.equal(h3.filter((t) => t === "Baholash mezonlari").length, 3);
  const totals = plan.body.filter((b) => b.k === "kv" && b.label === "Jami");
  assert.equal(totals.length, 3, "har keys oxirida jami ball qatori");
  assert.ok(totals.every((b) => b.k === "kv" && b.text.startsWith("10")), "rubrika yig'indisi 10 ball");
});

/* ══════════════════════════ test ══════════════════════════ */

test("test: variant betlari, KALIT va OMR yangi betdan", () => {
  const plan = planTeacher(sampleTeacherDoc("test"));
  assert.deepEqual(plan.pageBreaks, ["variantA", "variantB", "key", "omr"]);
  const breaks = plan.body.filter((b) => b.k === "h1" && b.pageBreak).map((b) => (b.k === "h1" ? b.sectionId : ""));
  assert.deepEqual(breaks, ["variantA", "variantB", "key", "omr"], "sahifa uzilishi aynan shu bo'limlarda");
  const key = plan.body.find((b) => b.k === "h1" && b.sectionId === "key");
  assert.ok(key?.k === "h1" && key.pageBreak, "javoblar kaliti YANGI BETDAN boshlanishi kerak");
});

test("test: variant — yangi savol emas, TARTIB; kalit jadvalida har variant o'z ustuni", () => {
  const plan = planTeacher(sampleTeacherDoc("test"));
  const stems = plan.body.filter((b) => b.k === "p" && /^\d+\. /.test(b.text)).map((b) => (b.k === "p" ? b.text.replace(/^\d+\. /, "") : ""));
  const a = stems.slice(0, 5);
  const b = stems.slice(5, 10);
  assert.deepEqual([...a].sort(), [...b].sort(), "ikkala variantda AYNAN bir xil savollar");
  assert.notDeepEqual(a, b, "lekin tartibi boshqa");

  const key = tablesOf(plan).find((t) => t.tableId === "key");
  assert.ok(key, "javoblar kaliti jadvali bo'lishi kerak");
  assert.deepEqual(key!.table.headers, ["№", "Variant A", "Variant B", "Ball", "Bloom", "Qiyinlik"]);
  assert.equal(key!.table.rows.length, 5);
});

test("test: ochiq savolga javob chiziqlari, OMR varag'i raqamlangan rasm", () => {
  const plan = planTeacher(sampleTeacherDoc("test"));
  assert.ok(plan.body.some((b) => b.k === "lines" && b.count >= 3), "ochiq savol ostida javob chiziqlari");
  const fig = plan.body.filter((b) => b.k === "figure");
  assert.equal(fig.length, 1, "OMR varag'i bir marta chiziladi (blok + model takrorlanmaydi)");
  assert.equal(plan.numbers.figures.omr, "1");
  assert.ok(fig[0].k === "figure" && /1-rasm/.test(fig[0].caption), `rasm raqami sarlavhada: ${fig[0].k === "figure" ? fig[0].caption : ""}`);
});

test("test `bsb` turida «Tasdiqlayman» va MEZON jadvali qo'shiladi", () => {
  const plan = planTeacher(sampleTeacherDoc("test", undefined, { type: "bsb" }));
  assert.ok(plan.head.some((h) => h.k === "approve"), "BSB da metodik kengash tasdiqlaydi (R3 §3.7)");
  assert.ok(tablesOf(plan).some((t) => t.tableId === "criteria"), "mezon va ball jadvali");
  // Oddiy nazorat ishida esa tasdiq qatori YO'Q.
  assert.ok(!planTeacher(sampleTeacherDoc("test")).head.some((h) => h.k === "approve"));
});

/* ══════════════════════════ raqamlash ══════════════════════════ */

test("jadval raqamlari ketma-ket va `numbers` da qayd etiladi", () => {
  const plan = planTeacher(sampleTeacherDoc("map"));
  const t = tablesOf(plan);
  assert.deepEqual(t.map((x) => x.number), ["1", "2", "3", "4"]);
  assert.deepEqual(t.map((x) => x.numberLine), ["1-jadval", "2-jadval", "3-jadval", "4-jadval"]);
  assert.deepEqual(plan.numbers.tables, { q1: "1", q2: "2", q3: "3", q4: "4" });
});

/* ══════════════════════════ eski hujjatlar ══════════════════════════ */

/** Bazadagi eski dars rejasi: `doc.teacher` yo'q, jadval `anchor` bilan. */
function legacyLessonDoc(): AcademicDoc {
  const meta = {
    toolId: "lesson-plan",
    workLabel: "Dars rejasi",
    topic: "Kasrlar",
    language: "uz",
    subject: "Matematika",
    author: "A. Valiyev",
    university: "15-son maktab",
    grade: 5,
    duration: 45,
  } as unknown as DocMeta;
  return {
    meta,
    titlePage: true,
    toc: false,
    sections: [
      { id: "passport", title: "Dars pasporti", blocks: [{ kind: "p", text: "PASPORT-MATNI" }] },
      { id: "map", title: "Darsning texnologik xaritasi", blocks: [{ kind: "h3", text: "1. Tashkiliy qism" }, { kind: "p", text: "XARITA-MATNI" }] },
    ],
    tables: [{ caption: "Vaqt taqsimoti", anchor: "map", headers: ["Bosqich", "Daqiqa", "Natija"], rows: [["Tashkiliy", "5", "QATOR"]] }],
  };
}

test("eski hujjat: `legacyTeacherModel` shapkani `meta` dan tiklaydi, tuzilma BO'SH", () => {
  const model = legacyTeacherModel(legacyLessonDoc());
  assert.ok(model, "dars rejasi uchun model qurilishi kerak");
  assert.equal(model!.kind, "lesson");
  assert.equal(model!.school.institution, "15-son maktab");
  assert.equal(model!.school.author, "A. Valiyev");
  assert.equal(model!.school.grade, 5);
  assert.equal(model!.lesson, undefined, "bosqichlarni nasrdan tiklab bo'lmaydi — model bo'sh qoladi");
  assert.equal(model!.school.approver, undefined, "eski hujjatda tasdiq qatori bo'lmagan, o'ylab topilmaydi");
});

test("eski hujjat: reja BUZILMAYDI — sarlavha, bloklar va LANGARLANGAN jadval o'z joyida", () => {
  const plan = planTeacher(legacyLessonDoc());
  assert.equal(plan.legacy, true, "tahrir uchun `legacy` bayrog'i (WP-D 409)");
  const order = plan.body.map((b) => b.k);
  assert.deepEqual(order, ["h1", "p", "h1", "h3", "p", "table"], `tartib: ${order.join(" ")}`);
  const t = tablesOf(plan);
  assert.equal(t.length, 1, "jadval BIR marta chiziladi");
  assert.equal(t[0].table.rows[0][2], "QATOR");
  // Model yo'q — modeldan keladigan bandlar ham yo'q.
  assert.ok(!plan.body.some((b) => b.k === "kv" || b.k === "opt" || b.k === "note"));
  assert.ok(plan.head.some((h) => h.k === "org"), "shapka baribir chiziladi — titul beti o'rniga");
});

test("eski hujjat: langari topilmagan jadval YO'QOLMAYDI", () => {
  const doc = legacyLessonDoc();
  doc.tables![0].anchor = "yoq";
  const plan = planTeacher(doc);
  assert.equal(tablesOf(plan).length, 1, "mavjud bo'lmagan langar jadvalni yutib yubormasin");
  assert.equal(plan.body[plan.body.length - 1].k, "table", "u hujjat oxirida chiziladi");
});

test("o'qituvchi oilasiga tegishli bo'lmagan hujjat — aniq XATO", () => {
  const doc = legacyLessonDoc();
  doc.meta = { ...doc.meta, toolId: "coursework" } as DocMeta;
  assert.equal(legacyTeacherModel(doc), null);
  assert.throws(() => planTeacher(doc), /o'qituvchi oilasiga tegishli emas/);
});
