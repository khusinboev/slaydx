import test from "node:test";
import assert from "node:assert/strict";
import { deliveredCount, refundRatio } from "../lib/generation/delivered.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { teacherExtraLabels } from "../lib/generation/i18n.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { AcademicDoc, DocMeta } from "../lib/generation/types.ts";
import type { FormValues } from "../lib/types.ts";

/**
 * YETKAZILGAN MIQDOR — o'qituvchi vositalari (AUDIT-20 WP-F).
 *
 * Eski hisob (`h3` sarlavhalar + birinchi jadval qatorlari) `document.test.mts`
 * da qulflangan va u YERDA qoladi: eski `doc_json` lar bazada turibdi.
 * Bu fayl YANGI yo'lni — `doc.teacher` modelidan sanashni — sinaydi.
 */

const metaOf = (toolId: keyof typeof TOOL_BY_ID, values: FormValues = {}): DocMeta => extractMeta(TOOL_BY_ID[toolId], values);

function docOf(meta: DocMeta, teacher: unknown, sections: AcademicDoc["sections"] = []): AcademicDoc {
  return { meta, titlePage: true, toc: false, sections, teacher } as unknown as AcademicDoc;
}

const school = { institution: "15-maktab", author: "A", subject: "Biologiya", grade: 8, language: "uz" };

/** `uch-tilli` glossariy: atamalar MATNDA ham, JADVALDA ham turadi. */
function glossaryDoc(meta: DocMeta, n: number, lang = "uz"): AcademicDoc {
  const terms = Array.from({ length: n }, (_, i) => ({ term: `Atama ${i}`, def: "ta'rif", ru: "термин", en: "term" }));
  const doc = docOf(
    { ...meta, language: lang },
    { v: 1, kind: "glossary", type: "uch-tilli", school: { ...school, language: lang }, glossary: { type: "uch-tilli", order: "alpha", terms } },
    [
      { id: "intro", title: "Kirish", blocks: [{ kind: "p", text: "matn" }] },
      { id: "terms", title: "Atamalar", blocks: terms.flatMap((t) => [{ kind: "h3", text: t.term }, { kind: "p", text: t.def }]) },
    ] as AcademicDoc["sections"],
  );
  doc.tables = [{ id: "terms", caption: "Atamalar", anchor: "terms", headers: ["Atama", "Ruscha", "Inglizcha"], rows: terms.map((t) => [t.term, t.ru, t.en]) }] as AcademicDoc["tables"];
  return doc;
}

function mapDoc(meta: DocMeta, weeks: number, type: "yillik" | "choraklik" = "yillik"): AcademicDoc {
  const qCount = type === "choraklik" ? 4 : 1;
  const per = Math.floor(weeks / qCount);
  const quarters = Array.from({ length: qCount }, (_, qi) => ({
    n: type === "choraklik" ? qi + 1 : 0,
    weeks: Array.from({ length: qi === qCount - 1 ? weeks - per * (qCount - 1) : per }, (_, i) => ({ n: i + 1, topic: `M${qi}${i}`, hours: 4, method: "m", resources: "r", result: "n", control: "k" })),
  }));
  const doc = docOf(meta, { v: 1, kind: "map", type, school, map: { type, weeklyHours: 4, totalHours: 136, quarters } });
  // Choraklik xaritada TO'RTTA jadval bor — birinchisi yilning choragi.
  doc.tables = quarters.map((q) => ({ id: `q${q.n}`, caption: "x", anchor: `q${q.n}`, headers: ["Hafta"], rows: q.weeks.map((w) => [String(w.n)]) })) as AcademicDoc["tables"];
  return doc;
}

const keysDoc = (meta: DocMeta, n: number) =>
  docOf(meta, {
    v: 1,
    kind: "keys",
    type: "muammoli",
    school: { ...school, subject: "Pedagogika", grade: 0 },
    keys: { type: "muammoli", audience: "otm", cases: Array.from({ length: n }, (_, i) => ({ title: `K${i}`, situation: "s", questions: ["q"], solution: "k", rubric: [] })) },
  });

const testDocOf = (meta: DocMeta, n: number) =>
  docOf(meta, {
    v: 1,
    kind: "test",
    type: "nazorat",
    school: { ...school, subject: "Matematika", grade: 10 },
    test: {
      mode: "topic",
      type: "nazorat",
      questions: Array.from({ length: n }, (_, i) => ({ id: `q${i}`, kind: "single", stem: "?", options: ["a", "b", "c", "d"], answer: 0, points: 1, bloom: "remember", difficulty: "oson", explanation: "e" })),
      variants: [{ id: "A", order: [], optionOrder: [] }],
      key: { A: [] },
      scoring: { perQuestion: 1, total: n, gradeScale: [] },
      instructions: [],
      timeMin: 45,
      topicIds: [],
    },
  });

/* ───────────────────────── teacher yo'li ───────────────────────── */

test("glossariy: atamalar MODELDAN sanaladi — uch tilli jadval ikki marta sanalmaydi", () => {
  const meta = metaOf("glossary", { topic: "Fotosintez", termCount: "20", glossaryType: "uch-tilli" });
  const values: FormValues = { termCount: "20", glossaryType: "uch-tilli" };
  assert.equal(deliveredCount(meta, glossaryDoc(meta, 20), values), undefined, "to'liq — qaytarish yo'q");
  assert.deepEqual(deliveredCount(meta, glossaryDoc(meta, 14), values), { got: 14, want: 20, unit: "atama" });
  // Ortiq yetkazish qaytarish sababi emas.
  assert.equal(deliveredCount(meta, glossaryDoc(meta, 22), values), undefined);
});

test("xarita: hafta soni BARCHA choraklardan — choraklik xarita to'liq bo'lsa qaytarish yo'q", () => {
  const meta = metaOf("texnologik-xarita", { subject: "Biologiya", weeklyHours: 4, totalHours: 136 });
  const values: FormValues = { weeklyHours: 4, totalHours: 136, mapType: "choraklik" };
  const full = mapDoc(meta, 34, "choraklik");
  assert.equal(full.tables?.[0]?.rows.length, 8, "birinchi jadval — atigi bitta chorak");
  assert.equal(
    deliveredCount(meta, full, values),
    undefined,
    "MUTATSIYA: birinchi jadval sanalsa to'liq xarita uchun pulning 3/4 qismi qaytarilardi",
  );
  assert.deepEqual(deliveredCount(meta, mapDoc(meta, 28, "choraklik"), values), { got: 28, want: 34, unit: "hafta" });
});

test("keys va test: model soni bilan; dars rejasida miqdor va'dasi YO'Q", () => {
  const kMeta = metaOf("keys", { topic: "Pedagogika", caseCount: 6 });
  assert.deepEqual(deliveredCount(kMeta, keysDoc(kMeta, 4), { caseCount: 6 }), { got: 4, want: 6, unit: "keys" });
  assert.equal(deliveredCount(kMeta, keysDoc(kMeta, 6), { caseCount: 6 }), undefined);

  const tMeta = metaOf("test", { topic: "Hosila", count: 20 });
  assert.deepEqual(deliveredCount(tMeta, testDocOf(tMeta, 17), { count: 20 }), { got: 17, want: 20, unit: "savol" });
  assert.equal(deliveredCount(tMeta, testDocOf(tMeta, 20), { count: 20 }), undefined);

  const lMeta = metaOf("lesson-plan", { topic: "Kasrlar", duration: 45 });
  const lesson = docOf(lMeta, { v: 1, kind: "lesson", type: "yangi-mavzu", school, lesson: { type: "yangi-mavzu", goal: { talim: "a", tarbiya: "b", rivoj: "c" }, competencies: [], equipment: [], stages: [], homework: "h", assessment: "a", durationMin: 45 } });
  assert.equal(deliveredCount(lMeta, lesson, { duration: 45 }), undefined, "dars rejasi narxi bosqich soniga bog'lanmagan");
});

test("birlik yorliqlari hujjat tiliga ergashadi (uz/ru/en)", () => {
  const meta = metaOf("glossary", { topic: "Fotosintez", termCount: "20" });
  const values: FormValues = { termCount: "20", glossaryType: "uch-tilli" };
  assert.equal(deliveredCount(meta, glossaryDoc(meta, 10, "uz"), values)?.unit, "atama");
  assert.equal(deliveredCount(meta, glossaryDoc(meta, 10, "ru"), values)?.unit, "термин");
  assert.equal(deliveredCount(meta, glossaryDoc(meta, 10, "en"), values)?.unit, "term");
  // Noma'lum til — o'zbekchaga tushadi (`teacherExtraLabels` qoidasi).
  assert.equal(teacherExtraLabels("tg").unitTerm, "atama");
  assert.equal(teacherExtraLabels("ru").unitQuestion, "вопрос");
  assert.equal(teacherExtraLabels("en").unitCase, "case");
});

test("`refundRatio` bilan mos: kamomad ulushi teacher yo'lida ham to'liq", () => {
  const meta = metaOf("keys", { topic: "Pedagogika", caseCount: 5 });
  const d = deliveredCount(meta, keysDoc(meta, 4), { caseCount: 5 });
  assert.ok(d && Math.abs(refundRatio(d)! - 0.2) < 1e-9, `5 dan 4: 20% qaytadi — ${refundRatio(d!)}`);
  // Hech narsa yetkazilmasa — TO'LIQ qaytariladi (ulushdan qat'i nazar).
  const zero = deliveredCount(meta, keysDoc(meta, 0), { caseCount: 5 });
  assert.equal(refundRatio(zero), 1);
});

test("eski hujjat (`doc.teacher` yo'q) ESKI hisobda qoladi", () => {
  const meta = metaOf("glossary", { topic: "Fotosintez", termCount: "40" });
  const legacy = {
    meta,
    titlePage: true,
    toc: false,
    sections: [{ id: "atamalar", title: "Atamalar", blocks: Array.from({ length: 28 }, (_, i) => ({ kind: "h3", text: `A${i}` })) }],
  } as unknown as AcademicDoc;
  assert.deepEqual(deliveredCount(meta, legacy), { got: 28, want: 40, unit: "atama" }, "eski `h3` hisobi o'zgarmaydi");

  const mapMeta = metaOf("texnologik-xarita", { subject: "Biologiya", weeklyHours: 4, totalHours: 136 });
  const legacyMap = { meta: mapMeta, titlePage: true, toc: false, sections: [], tables: [{ headers: ["A"], rows: Array.from({ length: 24 }, () => ["x"]) }] } as unknown as AcademicDoc;
  assert.deepEqual(deliveredCount(mapMeta, legacyMap), { got: 24, want: 34, unit: "hafta" });
});

/* ───────────────────────── pro-slide (A3-03) ───────────────────────── */

/**
 * A3-03 (auditor, `docs/audit-25/A3-structure.md`): `deliveredCount` `meta.toolId`
 * bo'yicha tarmoqlanadi va `case "pro-slide":` yo'q edi — `default:` ga tushib
 * `undefined` qaytarardi. `index.ts` esa ikkala vositani ham BIR dvigateldan
 * chaqiradi («pro-slide ham shu dvigatel»), shuning uchun pro-slide dekasi
 * (2 000 tanga/slayd, 30 tagacha, AI rasm) va'da qilingandan kam slayd yoki
 * kam AI rasm bilan yetkazilsa ham HECH QACHON qisman pul qaytmasdi — oddiy
 * slayd esa aynan shu holatda qaytaradi. Tuzatish: pro-slide `slide` bilan
 * BIR tarmoqni ishlatadi (slayd soni HAM, rasm HAM) — alohida hisob emas.
 */
function proDeck(n: number, images?: { want: number; got: number }): AcademicDoc {
  const meta = metaOf("pro-slide", { topic: "X", slideCount: 10 });
  return {
    meta,
    titlePage: true,
    toc: false,
    sections: [],
    slides: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, layout: "bullets", title: `S${i}` })),
    ...(images ? { slideImages: { ...images, blocked: images.want - images.got, skipped: 0, failed: 0 } } : {}),
  } as unknown as AcademicDoc;
}

test("pro-slide: 10 va'da, 8 yetkazilsa farq qaytariladi (ilgari `default:` ga tushib undefined edi)", () => {
  const meta = metaOf("pro-slide", { topic: "X", slideCount: 10 });
  assert.equal(meta.targetPages, 10, "slayder 10 slayd va'da qiladi");

  assert.deepEqual(deliveredCount(meta, proDeck(8)), { got: 8, want: 10, unit: "slayd" });
  // To'liq yetkazilganda — `slide` bilan bir xil: qaytarish yo'q.
  assert.equal(deliveredCount(meta, proDeck(10)), undefined);
  // Ortiq yetkazish qaytarish sababi emas (`slide` bilan bir xil qoida).
  assert.equal(deliveredCount(meta, proDeck(12)), undefined);
});

test("pro-slide: AI rasm kamomadi ham `slide` bilan bir xil naqshda qaytadi", () => {
  const meta = metaOf("pro-slide", { topic: "X", slideCount: 10 });
  assert.equal(meta.premiumVisuals, false, "premium paket yo'q — rasm ustamasi 0 (`slide` bilan bir xil)");

  // 10/10 slayd to'liq, lekin AI rasm 8 tadan 0 tasi keldi — HECH NARSA
  // yetkazilmadi. Pro-slaydda egasi qarori (AUDIT-25, 2026-09-25): matn,
  // maket va PPTX yetkazilgani uchun 100 % emas, narxning YARMI qaytadi.
  const zero = deliveredCount(meta, proDeck(10, { want: 8, got: 0 }));
  assert.deepEqual(zero, { got: 0, want: 8, unit: "rasm", refundShare: 0, noneShare: 0.5 });
  assert.equal(refundRatio(zero), 0.5, "pro-slayd: AI rasm umuman chiqmasa narxning yarmi qaytadi");
  // Qisman kamomad (8 dan 5) — D1: qaytarish yo'q, faqat qayd.
  assert.equal(refundRatio(deliveredCount(meta, proDeck(10, { want: 8, got: 5 }))), null);

  // To'liq yetkazilganda (slayd va rasm ikkalasi ham) qaytarish yo'q.
  assert.equal(deliveredCount(meta, proDeck(10, { want: 8, got: 8 })), undefined);
});

test("regressiya: oddiy `slide` da rasm umuman chiqmasa hamon TO'LIQ qaytadi (noneShare yo'q)", () => {
  const meta = metaOf("slide", { topic: "X", slideCount: 10 });
  const zero = deliveredCount(meta, { ...proDeck(10, { want: 4, got: 0 }) });
  assert.equal(zero?.noneShare, undefined);
  assert.equal(refundRatio(zero), 1);
});

test("regressiya: xuddi shu kirishlarda oddiy `slide` xatti-harakati o'zgarmagan", () => {
  const meta = metaOf("slide", { topic: "X", slideCount: 10 });
  const deck = (n: number) =>
    ({
      meta,
      titlePage: true,
      toc: false,
      sections: [],
      slides: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, layout: "bullets", title: `S${i}` })),
    }) as unknown as AcademicDoc;

  assert.deepEqual(deliveredCount(meta, deck(8)), { got: 8, want: 10, unit: "slayd" });
  assert.equal(deliveredCount(meta, deck(10)), undefined);
});
