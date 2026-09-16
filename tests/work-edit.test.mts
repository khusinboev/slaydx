import test from "node:test";
import assert from "node:assert/strict";
import { applyWorkOps, inverseWorkOps, parseWorkOps, stripWorkCitation, WORK_EDIT_LIMITS, type WorkOp } from "../lib/generation/work/edit.ts";
import { planWork } from "../lib/generation/work/layout.ts";
import { sampleWorkDoc } from "../lib/generation/work/samples.ts";
import type { AcademicDoc, DocMeta } from "../lib/generation/types.ts";

/**
 * TALABA ISHI TAHRIRI (AUDIT-19 WP-C).
 *
 * `applyWorkOps` — sof: kirish hujjati O'ZGARMAYDI, natija YANGI.
 * Sinxron nusxalar (`cited`, bob daraxti, rasm/jadval sarlavhasi) har
 * matn opidan keyin tenglashadi.
 */

const META: DocMeta = {
  topic: "Oliy ta’limda adaptiv o‘qitish tizimlarini joriy etish",
  workLabel: "Kurs ishi",
  language: "uz",
  toolId: "coursework",
} as unknown as DocMeta;

const CTX = { genId: "g1" };
const doc0 = () => sampleWorkDoc(META);

function ok(doc: AcademicDoc, ops: WorkOp[]): AcademicDoc {
  const r = applyWorkOps(doc, ops, CTX);
  assert.ok(r.ok, r.ok ? "" : `${r.error} (at ${r.at})`);
  return r.doc;
}

/** `ch1.1` bo'limining birinchi bloki yo'li. */
function pathOf(doc: AcademicDoc, sectionId: string, bi = 0): string {
  const si = doc.sections.findIndex((s) => s.id === sectionId);
  assert.ok(si >= 0, `bo'lim topilmadi: ${sectionId}`);
  return `sections.${si}.blocks.${bi}`;
}

/* ══════════════════════════════ matn ══════════════════════════════ */

test("`text` — blok matni; kirish hujjati O'ZGARMAYDI (sof funksiya)", () => {
  const doc = doc0();
  const path = pathOf(doc, "ch1.1");
  const before = doc.sections.find((s) => s.id === "ch1.1")!.blocks[0].text;
  const next = ok(doc, [{ op: "text", path, value: "Yangi matn [u1]." }]);
  assert.equal(next.sections.find((s) => s.id === "ch1.1")!.blocks[0].text, "Yangi matn [u1].");
  assert.equal(doc.sections.find((s) => s.id === "ch1.1")!.blocks[0].text, before, "kirish hujjati o'zgardi");
});

test("bo'sh matn — blok O'CHADI emas, xato («blockRemove» bilan)", () => {
  const doc = doc0();
  const r = applyWorkOps(doc, [{ op: "text", path: pathOf(doc, "ch1.1"), value: "   " }], CTX);
  assert.ok(!r.ok);
  assert.ok(r.ok || r.error.includes("blockRemove"));
});

test("`heading` — bo'lim sarlavhasi va BOB DARAXTI birga o'zgaradi", () => {
  const doc = doc0();
  const next = ok(doc, [
    { op: "heading", sectionId: "ch1", title: "Nazariy asoslar va tushunchalar" },
    { op: "heading", sectionId: "ch1.2", title: "Xorijiy tajriba" },
  ]);
  assert.equal(next.sections.find((s) => s.id === "ch1")!.title, "Nazariy asoslar va tushunchalar");
  const ch1 = next.work!.chapters.find((c) => c.id === "ch1")!;
  assert.equal(ch1.title, "Nazariy asoslar va tushunchalar", "model bob nomi eskirib qoldi");
  assert.equal(ch1.paragraphs.find((p) => p.id === "ch1.2")!.title, "Xorijiy tajriba", "model paragraf nomi eskirib qoldi");
  // Maket ham, mundarija ham DARHOL yangi nomni ko'radi.
  const plan = planWork(next);
  assert.ok(plan.toc.some((r) => r.text === "1-BOB. NAZARIY ASOSLAR VA TUSHUNCHALAR"));
  assert.ok(plan.toc.some((r) => r.text === "1.2. Xorijiy tajriba"));
});

/* ══════════════════════════════ manbalar ══════════════════════════════ */

test("matndan iqtibos chiqsa manba ro'yxatdan TUSHADI (`cited` qayta hisob)", () => {
  const doc = doc0();
  assert.equal(planWork(doc).refs.length, 15);
  // `u6` faqat `ch1.1` ning ikkinchi blokida iqtibos qilingan.
  const next = ok(doc, [{ op: "text", path: pathOf(doc, "ch1.1", 1), value: "Tasniflash mezoni sifatida moslashuv darajasi olinadi." }]);
  assert.equal(next.work!.references.find((r) => r.id === "u6")!.cited, false);
  assert.equal(planWork(next).refs.length, 14);
  assert.ok(!planWork(next).refs.some((r) => r.ref.id === "u6"));
});

test("`refRemove` — manba reyestrdan va BARCHA iqtiboslardan chiqadi", () => {
  const doc = doc0();
  const next = ok(doc, [{ op: "refRemove", refId: "u1" }]);
  assert.ok(!next.work!.references.some((r) => r.id === "u1"), "manba reyestrda qoldi");
  const all = next.sections.flatMap((s) => s.blocks.map((b) => b.text)).join("\n");
  assert.ok(!all.includes("[u1"), "matnda iqtibos qoldi");
  // Lokator («45-b.») yolg'iz qavsda QOLMAYDI.
  assert.ok(!/\[\s*45-b\.\s*\]/.test(all), "yolg'iz lokator qavsi qoldi");
  assert.equal(planWork(next).refs.length, 14);
});

test("`stripWorkCitation` — guruhdan bittasi chiqadi, qolgani saqlanadi", () => {
  assert.equal(stripWorkCitation("Matn [u1; u2].", "u1"), "Matn [u2].");
  assert.equal(stripWorkCitation("Matn [u1; 45-b.].", "u1"), "Matn.");
  assert.equal(stripWorkCitation("Matn [u2].", "u1"), "Matn [u2].");
});

/* ══════════════════════════════ jadval va rasm ══════════════════════════════ */

test("`cell` — katak va ustun sarlavhasi; chegaradan tashqarida xato", () => {
  const doc = doc0();
  const next = ok(doc, [
    { op: "cell", tableId: "t1", r: -1, c: 1, value: "Moslashuv" },
    { op: "cell", tableId: "t1", r: 0, c: 2, value: "Har haftalik test" },
  ]);
  const t = next.tables!.find((x) => x.id === "t1")!;
  assert.equal(t.headers[1], "Moslashuv");
  assert.equal(t.rows[0][2], "Har haftalik test");
  const bad = applyWorkOps(doc, [{ op: "cell", tableId: "t1", r: 99, c: 0, value: "x" }], CTX);
  assert.ok(!bad.ok);
});

test("`caption` — rasm sarlavhasi model va BLOK bilan sinxron", () => {
  const doc = doc0();
  const next = ok(doc, [{ op: "caption", target: "figure", id: "f1", value: "Tizimning blok-sxemasi" }]);
  assert.equal(next.work!.figures[0].caption, "Tizimning blok-sxemasi");
  const block = next.sections.flatMap((s) => s.blocks).find((b) => b.kind === "figure");
  assert.equal(block?.text, "Tizimning blok-sxemasi");
  const fig = planWork(next).body.find((b) => b.k === "figure");
  assert.ok(fig && fig.k === "figure" && fig.caption === "2.1-rasm. Tizimning blok-sxemasi", `«${fig && fig.k === "figure" ? fig.caption : ""}»`);
});

test("`blockRemove` jadval blokini o'chirsa JADVALNING O'ZI ham ketadi", () => {
  const doc = doc0();
  const si = doc.sections.findIndex((s) => s.id === "ch1.2");
  const bi = doc.sections[si].blocks.findIndex((b) => b.kind === "tableRef");
  const next = ok(doc, [{ op: "blockRemove", path: `sections.${si}.blocks.${bi}` }]);
  assert.ok(!(next.tables ?? []).some((t) => t.id === "t1"), "jadval hujjatda qoldi");
  assert.ok(!planWork(next).body.some((b) => b.k === "table"), "maket jadvalni baribir chizdi");
});

/* ══════════════════════════════ teskari (undo) ══════════════════════════════ */

test("`inverseWorkOps` — matn, sarlavha va katak op lari aynan qaytadi", () => {
  const doc = doc0();
  const path = pathOf(doc, "ch2.2");
  const ops: WorkOp[] = [
    { op: "text", path, value: "Boshqa matn." },
    { op: "heading", sectionId: "ch2", title: "Yangi bob" },
    { op: "cell", tableId: "t1", r: 1, c: 0, value: "ALEKS 2" },
  ];
  const after = ok(doc, ops);
  const back = ok(after, inverseWorkOps(doc, ops, CTX));
  assert.deepEqual(back.sections, doc.sections);
  assert.deepEqual(back.tables, doc.tables);
  assert.deepEqual(back.work!.chapters, doc.work!.chapters);
});

test("`refRemove` teskarisi — BUTUN hujjat (`set`), iqtiboslar tiklanadi", () => {
  const doc = doc0();
  const ops: WorkOp[] = [{ op: "refRemove", refId: "u1" }];
  const inv = inverseWorkOps(doc, ops, CTX);
  assert.equal(inv.length, 1);
  assert.equal(inv[0].op, "set");
  const back = ok(ok(doc, ops), inv);
  assert.equal(back.work!.references.length, 15);
  assert.deepEqual(back.sections, doc.sections);
});

/* ══════════════════════════════ parse (`unknown` dan) ══════════════════════════════ */

test("`parseWorkOps` — to'g'ri op lar o'tadi, yaroqsiz yo'l/id RAD etiladi", () => {
  const good = parseWorkOps([
    { op: "text", path: "sections.2.blocks.0", value: "x" },
    { op: "heading", sectionId: "ch1", title: "Bob" },
    { op: "caption", target: "table", id: "t1", value: "Nom" },
  ]);
  assert.ok(good.ok && good.ops.length === 3);
  for (const bad of [
    [{ op: "text", path: "sections.2.blocks", value: "x" }],
    [{ op: "text", path: "work.chapters.0.title", value: "x" }],
    [{ op: "heading", sectionId: "ch 1", title: "Bob" }],
    [{ op: "caption", target: "chart", id: "t1", value: "x" }],
    [{ op: "cell", tableId: "t1", r: -2, c: 0, value: "x" }],
  ]) {
    const r = parseWorkOps(bad);
    assert.ok(!r.ok, `yaroqsiz op o'tib ketdi: ${JSON.stringify(bad)}`);
  }
});

test("`review` opi KLIENTDAN o'tmaydi (ball serverda hisoblanadi)", () => {
  const r = parseWorkOps([{ op: "review", review: { score: 100, checks: [], judge: {}, at: "x" } }]);
  assert.ok(!r.ok, "klient hisobot ballini yozib yubordi");
  // Server esa uni QO'LLAY oladi.
  const doc = doc0();
  const next = ok(doc, [{ op: "review", review: null }]);
  assert.ok(!next.work!.review);
});

test("chegaralar: 50 dan ortiq op, uzun matn va `__proto__` kaliti RAD etiladi", () => {
  const many = Array.from({ length: WORK_EDIT_LIMITS.ops + 1 }, () => ({ op: "heading", sectionId: "ch1", title: "x" }));
  assert.ok(!parseWorkOps(many).ok, "op soni chegarasi ishlamadi");
  assert.ok(!parseWorkOps([{ op: "text", path: "sections.0.blocks.0", value: "x".repeat(WORK_EDIT_LIMITS.text + 1) }]).ok, "uzun matn o'tib ketdi");
  /*
   * `__proto__` — HTTP tanasi `JSON.parse` dan keladi, ya'ni u SHAXSIY
   * kalit bo'ladi (obyekt literalidagi `__proto__` esa prototipni
   * o'rnatadi va `Object.keys` da ko'rinmaydi — shuning uchun sinov
   * ataylab `JSON.parse` bilan yoziladi).
   */
  const body = JSON.parse('[{"op":"set","doc":{"sections":[{"id":"a","title":"b","blocks":[],"__proto__":{"x":1}}]}}]');
  assert.ok(!parseWorkOps(body).ok, "taqiqlangan kalit o'tib ketdi");
});

test("eski hujjat (`doc.work` yo'q) — tahrir RAD etiladi", () => {
  const doc = doc0();
  delete doc.work;
  const r = applyWorkOps(doc, [{ op: "heading", sectionId: "ch1", title: "x" }], CTX);
  assert.ok(!r.ok);
  assert.ok(r.ok || r.error.includes("eski formatda"));
});

test("op lar ATOMAR: ikkinchisi yiqilsa birinchisi ham qo'llanmaydi", () => {
  const doc = doc0();
  const r = applyWorkOps(
    doc,
    [
      { op: "heading", sectionId: "ch1", title: "Yangi bob" },
      { op: "heading", sectionId: "yo-q", title: "x" },
    ],
    CTX,
  );
  assert.ok(!r.ok);
  assert.equal(r.ok ? 0 : r.at, 1);
  assert.equal(doc.sections.find((s) => s.id === "ch1")!.title, "Adaptiv o‘qitish tizimlarining nazariy asoslari");
});
