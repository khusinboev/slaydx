import test from "node:test";
import assert from "node:assert/strict";
import { sampleTeacherDoc } from "../lib/generation/teacher/samples.ts";
import { planTeacher } from "../lib/generation/teacher/layout.ts";
import { testSections } from "../lib/generation/teacher/test/engine.ts";
import {
  TEACHER_EDIT_LIMITS,
  applyTeacherOps,
  inverseTeacherOps,
  isTeacherOp,
  parseTeacherOps,
  readTeacherPath,
  teacherMirrors,
  teacherOpsFromPolish,
  type TeacherOp,
} from "../lib/generation/teacher/edit.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";
import type { TestInput } from "../lib/generation/teacher/test/input.ts";

/**
 * O'QITUVCHI HUJJATI TAHRIR OPLARI (AUDIT-20 WP-D).
 *
 * Bu yerda qulflanadigan QAROR: o'qituvchi hujjatida tahrir IKKI
 * manbaga tegadi — nasr bloklari va `TeacherModel`. Hisobot, prompt
 * va «Tuzatish» MODELDAN o'qiydi, ekran esa `planTeacher` dan; ular
 * ajralib ketsa foydalanuvchi tuzatgan matn hisobotda baholanmasdan
 * qolardi. Shuning uchun testlarning yarmi aynan IZCHILLIK haqida.
 */

const CTX = { genId: "g-20" };

const clone = (d: AcademicDoc): AcademicDoc => JSON.parse(JSON.stringify(d)) as AcademicDoc;

/** Rejadagi bandning yo'lini turi/matni bo'yicha topadi. */
function pathOf(doc: AcademicDoc, pred: (b: ReturnType<typeof planTeacher>["body"][number]) => boolean): string {
  const b = planTeacher(doc).body.find(pred);
  assert.ok(b, "band topilmadi");
  return b.path;
}

function ok(r: ReturnType<typeof applyTeacherOps>): AcademicDoc {
  assert.ok(r.ok, r.ok ? "" : `op yiqildi: ${r.error}`);
  return r.doc;
}

/**
 * DVIGATEL yozgan test hujjati — namunada bo'limlar BO'SH (maket ularni
 * modeldan quradi), nasr ⇄ model xaritasi esa aynan NASR bo'lgan
 * hujjatda ishlaydi. `testSections` — dvigatelning o'z funksiyasi,
 * ya'ni bu yerda haqiqiy tartib sinaladi, qayta yozilgani emas.
 */
function testDocWithProse(): AcademicDoc {
  const doc = sampleTeacherDoc("test");
  const model = doc.teacher!.test!;
  const input = { language: "uz", answerKey: "bor", criteriaTable: false } as unknown as TestInput;
  const { sections, tables } = testSections(model, input, null);
  return { ...doc, sections, tables };
}

/* ══════════════════════════ op turlari ══════════════════════════ */

test("text: nasr bloki o'zgaradi va bir qatorga keltiriladi", () => {
  const doc = sampleTeacherDoc("lesson");
  const path = "sections.3.blocks.0"; // homework
  const d = ok(applyTeacherOps(doc, [{ op: "text", path, value: "  Yangi\n  uy vazifasi  " }], CTX));
  assert.equal(readTeacherPath(d, path), "Yangi uy vazifasi");
  assert.notEqual(readTeacherPath(doc, path), "Yangi uy vazifasi", "kirish hujjati o'zgardi (sof funksiya emas)");
});

test("heading: bo'lim sarlavhasi; bo'sh sarlavha RAD etiladi", () => {
  const doc = sampleTeacherDoc("lesson");
  const d = ok(applyTeacherOps(doc, [{ op: "heading", sectionId: "goal", title: "Dars maqsadlari" }], CTX));
  assert.equal(d.sections.find((s) => s.id === "goal")?.title, "Dars maqsadlari");
  const bad = applyTeacherOps(doc, [{ op: "heading", sectionId: "goal", title: "   " }], CTX);
  assert.equal(bad.ok, false);
  const missing = applyTeacherOps(doc, [{ op: "heading", sectionId: "yo-q", title: "x" }], CTX);
  assert.equal(missing.ok, false, "mavjud bo'lmagan bo'lim qabul qilindi");
});

test("blockRemove / blockInsert: blok o'chadi va qaytadi", () => {
  const doc = sampleTeacherDoc("glossary");
  const before = doc.sections[1].blocks.length;
  const d = ok(applyTeacherOps(doc, [{ op: "blockRemove", path: "sections.1.blocks.0" }], CTX));
  assert.equal(d.sections[1].blocks.length, before - 1);
  const back = ok(applyTeacherOps(d, [{ op: "blockInsert", path: "sections.1.blocks.0", block: { kind: "h3", text: "Atama" } }], CTX));
  assert.equal(back.sections[1].blocks.length, before);
  assert.equal(back.sections[1].blocks[0].text, "Atama");
});

test("setSection: butun bo'lim bloklari almashadi", () => {
  const doc = sampleTeacherDoc("keys");
  const d = ok(applyTeacherOps(doc, [{ op: "setSection", sectionId: "intro", blocks: [{ kind: "p", text: "Yangi kirish." }] }], CTX));
  assert.deepEqual(
    d.sections.find((s) => s.id === "intro")?.blocks.map((b) => b.text),
    ["Yangi kirish."],
  );
});

test("caption: OMR rasm sarlavhasi modelda ham, blokda ham yangilanadi", () => {
  const doc = testDocWithProse();
  doc.teacher!.figures = [{ id: "omr", kind: "scheme", caption: "Javoblar varag‘i", spec: { kind: "omr", ...doc.teacher!.test!.omr! }, w: 0, h: 0 }];
  doc.sections.push({ id: "omr", title: "Javoblar varag‘i", blocks: [{ kind: "figure", text: "Javoblar varag‘i", figureId: "omr" }] });
  const d = ok(applyTeacherOps(doc, [{ op: "caption", target: "figure", id: "omr", value: "Blanka" }], CTX));
  assert.equal(d.teacher!.figures![0].caption, "Blanka");
  const fig = d.sections.at(-1)!.blocks[0];
  assert.equal(fig.text, "Blanka", "blok sarlavhasi model bilan ajralib qoldi");
});

test("review: FAQAT server yozadi — `applyTeacherOps` qabul qiladi, `parseTeacherOps` rad etadi", () => {
  const doc = sampleTeacherDoc("lesson");
  const review = { score: 88, checks: [], judgeNotes: [], userNeeds: [] } as never;
  const d = ok(applyTeacherOps(doc, [{ op: "review", review }], CTX));
  assert.equal(d.teacher!.review!.score, 88);
  assert.equal(parseTeacherOps([{ op: "review", review }]).ok, false, "klient ballni o'zi yozib yubordi");
});

/* ══════════════════════════ model ⇄ sections izchilligi ══════════════════════════ */

test("NASR → MODEL: bosqich metodi tahrirlansa `lesson.stages[].method` ham yangilanadi", () => {
  const doc = sampleTeacherDoc("lesson");
  const mirrors = teacherMirrors(doc);
  const entry = [...mirrors].find(([, m]) => /stages\.\d+\.method$/.test(m.path));
  assert.ok(entry, "metod bloki xaritada yo'q");
  const [path, mirror] = entry;
  const k = Number(/stages\.(\d+)\./.exec(mirror.path)![1]);
  const d = ok(applyTeacherOps(doc, [{ op: "text", path, value: "Metod: Aqliy hujum" }], CTX));
  assert.equal(d.teacher!.lesson!.stages[k].method, "Aqliy hujum", "YORLIQ modelga tushib ketdi yoki sinxron ishlamadi");
  assert.equal(d.sections[2].blocks[Number(path.split(".")[3])].text, "Metod: Aqliy hujum", "nasr matni o'zgarmadi");
});

test("NASR → MODEL: glossariy atamasi va ta'rifi modelga tushadi", () => {
  const doc = sampleTeacherDoc("glossary");
  const d = ok(
    applyTeacherOps(
      doc,
      [
        { op: "text", path: "sections.1.blocks.0", value: "Xlorofill" },
        { op: "text", path: "sections.1.blocks.1", value: "Yangi ta’rif matni." },
      ],
      CTX,
    ),
  );
  assert.equal(d.teacher!.glossary!.terms[0].term, "Xlorofill");
  assert.equal(d.teacher!.glossary!.terms[0].def, "Yangi ta’rif matni.");
});

test("NASR → MODEL: test savoli matni ASL indeksga yozadi (variant tartibi aralash)", () => {
  const doc = testDocWithProse();
  const v = doc.teacher!.test!.variants[1]; // B varianti — tartibi A dan farq qiladi
  const si = doc.sections.findIndex((s) => s.id === `variant-${v.id}`);
  assert.ok(si > 0, "variant bo'limi topilmadi");
  const mirrors = teacherMirrors(doc);
  const m = mirrors.get(`sections.${si}.blocks.0`);
  assert.ok(m, "variant bo'limi xaritaga tushmadi");
  const qi = Number(/questions\.(\d+)\.stem$/.exec(m.path)![1]);
  assert.equal(qi, v.order[0], "B variantidagi birinchi savol ASL indeksga bog'lanmadi");
  const d = ok(applyTeacherOps(doc, [{ op: "text", path: `sections.${si}.blocks.0`, value: "1. Qayta yozilgan savol (2 ball)" }], CTX));
  assert.equal(d.teacher!.test!.questions[qi].stem, "Qayta yozilgan savol", "raqam yoki ball modelga tushib ketdi");
});

test("MODEL BANDI: modeldan qurilgan band tahrirlansa model yangilanadi", () => {
  const doc = sampleTeacherDoc("test"); // bo'limlar bo'sh — maket modeldan quradi
  const path = pathOf(doc, (b) => /^teacher\.test\.instructions\.\d+$/.test(b.path));
  const d = ok(applyTeacherOps(doc, [{ op: "text", path, value: "Yangi ko‘rsatma." }], CTX));
  const k = Number(path.split(".").at(-1));
  assert.equal(d.teacher!.test!.instructions[k], "Yangi ko‘rsatma.");
  assert.equal(planTeacher(d).body.find((b) => b.path === path)?.text, "Yangi ko‘rsatma.", "ekranda eski matn qoldi");
});

test("REJA DARVOZASI: ekranda ko'rinmagan model bandi tahrirlanmaydi", () => {
  const doc = sampleTeacherDoc("lesson"); // nasr bor ⇒ model bandlari chizilmaydi
  const r = applyTeacherOps(doc, [{ op: "text", path: "teacher.lesson.stages.0.method", value: "x" }], CTX);
  assert.equal(r.ok, false, "rejada yo'q band tahrirga ochildi");
  assert.match(r.ok ? "" : r.error, /ko‘rinmaydi|ko'rinmaydi/);
});

test("SON maydoni tahrirlanmaydi — hisobot arifmetikasi formaga tayanadi", () => {
  const doc = sampleTeacherDoc("test");
  for (const path of ["teacher.test.timeMin", "teacher.test.scoring.total", "teacher.school.grade"]) {
    const r = applyTeacherOps(doc, [{ op: "text", path, value: "90" }], CTX);
    assert.equal(r.ok, false, `«${path}» matn sifatida tahrirlandi`);
  }
  // Model o'zgarmagan: yiqilgan op HECH NARSA qoldirmaydi.
  assert.equal(doc.teacher!.test!.timeMin, 45);
});

test("SHAPKA → PASPORT TAKRORI: fan o'zgarsa takror qatori ham yangilanadi (dublikat chiqmaydi)", () => {
  const doc = sampleTeacherDoc("lesson");
  const before = planTeacher(doc).body.filter((b) => /Fan:/.test("text" in b ? b.text : "")).length;
  assert.equal(before, 0, "boshlanishida takror allaqachon chizilyapti");
  const d = ok(applyTeacherOps(doc, [{ op: "text", path: "teacher.school.subject", value: "Kimyo" }], CTX));
  assert.equal(d.teacher!.school.subject, "Kimyo");
  const dup = planTeacher(d).body.filter((b) => /Fan:\s*Kimyo/.test("text" in b ? b.text : "")).length;
  assert.equal(dup, 0, "MUTATSIYA: shapka o'zgargach pasport takrori DUBLIKAT bo'lib chiqdi");
  assert.match(d.sections[0].blocks[0].text, /Fan: Kimyo/, "takror qatori eski fan bilan qoldi");
});

/* ══════════════════════════ jadval katagi ══════════════════════════ */

test("cell: xarita jadvalining mavzusi `map.quarters[].weeks[]` ga tushadi", () => {
  const doc = sampleTeacherDoc("map");
  const plan = planTeacher(doc);
  const t = plan.body.find((b) => b.k === "table");
  assert.ok(t?.k === "table", "jadval topilmadi");
  assert.match(t.path, /^table:\d+$/, "hujjat jadvali `table:<n>` nishonini olmadi");
  const d = ok(applyTeacherOps(doc, [{ op: "cell", tableId: t.path, r: 0, c: 2, value: "Yangi mavzu" }], CTX));
  assert.equal(d.tables![0].rows[0][2], "Yangi mavzu");
  assert.equal(d.teacher!.map!.quarters[0].weeks[0].topic, "Yangi mavzu", "MUTATSIYA: jadval katagi modelga ko'chmadi");
});

test("cell: kalit jadvalidagi javob harfi `test.key` ga tushadi", () => {
  const doc = testDocWithProse();
  const ti = doc.tables!.findIndex((t) => t.id === "key");
  assert.ok(ti >= 0, "kalit jadvali yo'q");
  const d = ok(applyTeacherOps(doc, [{ op: "cell", tableId: `table:${ti}`, r: 0, c: 1, value: "C" }], CTX));
  assert.equal(d.teacher!.test!.key.A[0], "C", "kalit modelda eski harf bilan qoldi (OMR bilan ajralib ketardi)");
  assert.equal(d.tables![ti].rows[0][1], "C");
});

test("cell: chegaradan tashqaridagi indeks va raqam ustuni RAD etiladi", () => {
  const doc = sampleTeacherDoc("map");
  const path = pathOf(doc, (b) => b.k === "table");
  assert.equal(applyTeacherOps(doc, [{ op: "cell", tableId: path, r: 99, c: 0, value: "x" }], CTX).ok, false);
  assert.equal(applyTeacherOps(doc, [{ op: "cell", tableId: path, r: 0, c: 19, value: "x" }], CTX).ok, false);
  // Hafta raqami ustuni modelda YO'Q (`rowOf` uni `w.n` dan chizadi) —
  // jadvalda o'zgaradi, lekin modelga tegmaydi.
  const d = ok(applyTeacherOps(doc, [{ op: "cell", tableId: path, r: 0, c: 0, value: "9" }], CTX));
  assert.equal(d.teacher!.map!.quarters[0].weeks[0].n, 1, "raqam ustuni modelga yozib yuborildi");
});

/* ══════════════════════════ teskari ══════════════════════════ */

test("inverse: sarlavha va blok qo'shish/o'chirish teskarisi asl holatni qaytaradi", () => {
  const doc = sampleTeacherDoc("glossary");
  const ops: TeacherOp[] = [
    { op: "heading", sectionId: "terms", title: "Atamalar ro‘yxati" },
    { op: "blockRemove", path: "sections.1.blocks.0" },
  ];
  const inv = inverseTeacherOps(doc, ops, CTX);
  const d = ok(applyTeacherOps(doc, ops, CTX));
  const back = ok(applyTeacherOps(d, inv, CTX));
  assert.deepEqual(back.sections, doc.sections, "teskari op lar asl matnni qaytarmadi");
});

test("inverse: nasr tahriri BUTUN hujjatni qaytaradi (model tomoni ham tiklanadi)", () => {
  const doc = sampleTeacherDoc("lesson");
  const ops: TeacherOp[] = [{ op: "text", path: "sections.3.blocks.0", value: "Boshqa uy vazifasi" }];
  const inv = inverseTeacherOps(doc, ops, CTX);
  assert.equal(inv[0].op, "set", "nasr teskarisi maydon darajasida qoldi — model eskirib qolardi");
  const d = ok(applyTeacherOps(doc, ops, CTX));
  assert.notEqual(d.teacher!.lesson!.homework, doc.teacher!.lesson!.homework);
  const back = ok(applyTeacherOps(d, inv, CTX));
  assert.equal(back.sections[3].blocks[0].text, doc.sections[3].blocks[0].text);
});

test("inverse: yiqiladigan op teskari ro'yxatni to'xtatadi", () => {
  const doc = sampleTeacherDoc("lesson");
  const inv = inverseTeacherOps(doc, [{ op: "heading", sectionId: "yo-q", title: "x" }], CTX);
  assert.equal(inv.length, 0);
});

/* ══════════════════════════ parse ══════════════════════════ */

test("parse: yaroqli op lar o'tadi (nasr, model yo'li, katak)", () => {
  const r = parseTeacherOps([
    { op: "text", path: "sections.1.blocks.2", value: "a" },
    { op: "text", path: "teacher.lesson.homework", value: "b" },
    { op: "text", path: "meta.topic", value: "c" },
    { op: "cell", tableId: "table:0", r: 0, c: 1, value: "d" },
  ]);
  assert.equal(r.ok, true, r.ok ? "" : r.error);
  assert.equal(r.ok && r.ops.length, 4);
});

test("parse RAD ETADI: chegara, yaroqsiz yo'l, noma'lum op, taqiqlangan kalit", () => {
  assert.equal(parseTeacherOps([]).ok, false, "bo'sh ro'yxat");
  assert.equal(parseTeacherOps("x").ok, false, "massiv emas");
  const many = Array.from({ length: TEACHER_EDIT_LIMITS.ops + 1 }, () => ({ op: "text", path: "sections.0.blocks.0", value: "x" }));
  assert.equal(parseTeacherOps(many).ok, false, `${TEACHER_EDIT_LIMITS.ops} dan ortiq op o'tdi`);
  assert.equal(parseTeacherOps([{ op: "text", path: "sections.0.blocks.0", value: "x".repeat(TEACHER_EDIT_LIMITS.text + 1) }]).ok, false, "uzun matn");
  assert.equal(parseTeacherOps([{ op: "text", path: "resume.identity.fullName", value: "x" }]).ok, false, "begona yo'l");
  assert.equal(parseTeacherOps([{ op: "text", path: "teacher", value: "x" }]).ok, false, "ildiz yo'li");
  assert.equal(parseTeacherOps([{ op: "abstract", lang: "uz", text: "x" }]).ok, false, "maqola opi");
  assert.equal(parseTeacherOps([{ op: "text", path: "sections.0.blocks.0", value: 5 }]).ok, false, "matn emas");
  assert.equal(parseTeacherOps([{ op: "blockInsert", path: "sections.0.blocks.0", block: { kind: "zzz", text: "x" } }]).ok, false, "noma'lum blok turi");
  assert.equal(parseTeacherOps([{ op: "text", path: "sections.0.blocks.0", value: "x", __proto__: { a: 1 } }]).ok, true, "oddiy kalit");
  assert.equal(parseTeacherOps([{ op: "cell", tableId: "t", r: -2, c: 0, value: "x" }]).ok, false, "manfiy qator");
});

test("isTeacherOp: begona op tilini filtrlaydi", () => {
  assert.equal(isTeacherOp({ op: "text" }), true);
  assert.equal(isTeacherOp({ op: "abstract" }), false);
  assert.equal(isTeacherOp({ op: "highlights" }), false);
  assert.equal(isTeacherOp({ op: "refRemove" }), false, "talaba ishining manba opi o'tdi");
});

/* ══════════════════════════ eski hujjat ══════════════════════════ */

test("legacy: `doc.teacher` yo'q hujjat UMUMAN tahrirlanmaydi", () => {
  const doc = clone(sampleTeacherDoc("lesson"));
  delete doc.teacher;
  const r = applyTeacherOps(doc, [{ op: "text", path: "sections.3.blocks.0", value: "x" }], CTX);
  assert.equal(r.ok, false, "MUTATSIYA: eski hujjat tahrirga ochildi");
  assert.equal(r.ok ? 0 : r.at, 0);
  assert.match(r.ok ? "" : r.error, /eski formatda/);
});

/* ══════════════════════════ sayqal op lari ══════════════════════════ */

test("teacherOpsFromPolish: `setTable` katakma-katak `cell` ga, `setSection` o'zgarmaydi", () => {
  const ops = teacherOpsFromPolish([
    { op: "setSection", sectionId: "intro", blocks: [{ kind: "p", text: "x" }] },
    { op: "setTable", index: 2, rows: [["a", "b"], ["c", "d"]] },
  ]);
  assert.equal(ops[0].op, "setSection");
  const cells = ops.filter((o) => o.op === "cell");
  assert.equal(cells.length, 4, "har katak uchun op bo'lishi kerak (asl hujjat noma'lum)");
  assert.deepEqual(cells[0], { op: "cell", tableId: "table:2", r: 0, c: 0, value: "a" });
});

test("sayqal op lari qo'llanganda xarita jadvali MODEL bilan izchil qoladi", () => {
  const doc = sampleTeacherDoc("map");
  const rows = doc.tables![0].rows.map((r) => [...r]);
  rows[0][2] = "Sayqaldan keyingi mavzu";
  const ops = teacherOpsFromPolish([{ op: "setTable", index: 0, rows }]);
  const d = ok(applyTeacherOps(doc, ops, CTX));
  assert.equal(d.tables![0].rows[0][2], "Sayqaldan keyingi mavzu");
  assert.equal(
    d.teacher!.map!.quarters[0].weeks[0].topic,
    "Sayqaldan keyingi mavzu",
    "MUTATSIYA: sayqal jadvalni yangiladi, model eski mavzuda qoldi — hisobot ikki manbadan chiqardi",
  );
});
