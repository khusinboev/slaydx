import test from "node:test";
import assert from "node:assert/strict";
import {
  ARTICLE_EDIT_LIMITS,
  ARTICLE_PATH_RE,
  applyArticleOps,
  inverseArticleOps,
  parseArticleOps,
  recomputeCited,
  stripCitation,
  type ArticleOp,
} from "../lib/generation/article/edit.ts";
import { planArticle } from "../lib/generation/article/layout.ts";
import { sampleArticleDoc } from "../lib/generation/article/samples.ts";
import type { AcademicDoc, DocMeta } from "../lib/generation/types.ts";

/**
 * Maqola tahrir oplari (Maqola 2, AUDIT-17 WP7).
 *
 * Markazdagi kafolat — AYLANMA (`resume-edit` bilan bir xil): `apply(ops)`
 * dan keyin `apply(inverse(ops))` hujjatni AYNAN eski holatiga qaytaradi.
 * Ctrl+Z shu ikkisining ustida turadi. Qolgani: sinxron nusxalar (rasm/
 * jadval sarlavhasi, kalit so'zlar, `cited`, eski `references`),
 * `refRemove` iqtiboslarni tozalashi, parse chegaralari, eski maqola
 * cheklovi, `review` opining klientdan o'tmasligi.
 */

const GEN = "11111111-2222-3333-4444-555555555555";
const META = { topic: "Sun’iy intellektning oliy ta’limdagi o‘rni", author: "K", workLabel: "Maqola", language: "uz", toolId: "article" } as unknown as DocMeta;

/** Chuqur nusxa: `sampleArticleDoc` modeli (`keywords`, `figures`) namunaviy obyekt bilan ULASHILGAN — testlar bir-birini buzmasin. */
function base(): AcademicDoc {
  return JSON.parse(JSON.stringify(sampleArticleDoc(META))) as AcademicDoc;
}

/** Eski `doc.references` satrlari bilan (dvigatel yozadigan shakl). */
function withLegacyRefs(): AcademicDoc {
  const d = base();
  d.references = ["Lin C. et al. (2023). …", "Ahmad S. et al. (2023). …", "Karimov A. (2022). …"];
  return d;
}

/** Eski maqola — `doc.article` yo'q. */
function legacyDoc(): AcademicDoc {
  const d = base();
  delete d.article;
  delete d.abstracts;
  d.references = ["Manba 1", "Manba 2"];
  return d;
}

function apply(doc: AcademicDoc, ops: ArticleOp[]) {
  const r = applyArticleOps(doc, ops, { genId: GEN });
  assert.ok(r.ok, r.ok ? "" : `kutilmagan xato: ${r.error} (at ${r.at})`);
  return r.doc;
}

function fails(doc: AcademicDoc, ops: ArticleOp[], re?: RegExp) {
  const r = applyArticleOps(doc, ops, { genId: GEN });
  assert.equal(r.ok, false, "xato kutilgan edi");
  if (!r.ok && re) assert.match(r.error, re);
  return r;
}

/** `apply → inverse → apply` aylanmasi hujjatni AYNAN qaytaradimi. */
function roundTrip(name: string, ops: ArticleOp[], doc = base()) {
  const snapshot = JSON.stringify(doc);
  const inv = inverseArticleOps(doc, ops, { genId: GEN });
  assert.ok(inv.length, `${name}: teskari ro'yxat bo'sh`);
  const forward = apply(doc, ops);
  assert.notDeepEqual(forward, doc, `${name}: op hujjatni o'zgartirmadi`);
  const back = apply(forward, inv);
  assert.deepEqual(back, doc, `${name}: aylanma asl holatga qaytmadi`);
  assert.equal(JSON.stringify(doc), snapshot, `${name}: kirish hujjati o'zgartirildi (sof emas)`);
  return { forward, inv };
}

const P0 = "sections.0.blocks.0";

/* ══════════════════════════════ aylanma ══════════════════════════════ */

test("har bir op turi uchun apply → inverse aylanmasi asl hujjatni qaytaradi", () => {
  roundTrip("text/p", [{ op: "text", path: P0, value: "Yangi paragraf matni [W4385]." }]);
  roundTrip("text/figure-caption", [{ op: "text", path: "sections.1.blocks.1", value: "Boshqa sarlavha" }]);
  roundTrip("text/tableRef-caption", [{ op: "text", path: "sections.2.blocks.1", value: "Jadval sarlavhasi 2" }]);
  roundTrip("text/formula", [{ op: "text", path: "sections.2.blocks.2", value: "E = mc^2" }]);
  roundTrip("heading", [{ op: "heading", sectionId: "intro", title: "KIRISH QISMI" }]);
  roundTrip("cell/body", [{ op: "cell", tableId: "t1", r: 0, c: 1, value: "4,0" }]);
  roundTrip("cell/header", [{ op: "cell", tableId: "t1", r: -1, c: 0, value: "Guruhlar" }]);
  roundTrip("caption/figure", [{ op: "caption", target: "figure", id: "f1", value: "Tizim tuzilmasi" }]);
  roundTrip("caption/table", [{ op: "caption", target: "table", id: "t1", value: "Ko‘rsatkichlar" }]);
  roundTrip("abstract", [{ op: "abstract", lang: "ru", text: "Новый текст аннотации для проверки обратимости операции." }]);
  roundTrip("keywords", [{ op: "keywords", lang: "en", items: ["ai", "learning", "assessment", "university", "students"] }]);
  roundTrip("refRemove", [{ op: "refRemove", refId: "W4385" }]);
  roundTrip("blockRemove/p", [{ op: "blockRemove", path: "sections.0.blocks.1" }]);
  roundTrip("blockRemove/tableRef", [{ op: "blockRemove", path: "sections.2.blocks.1" }]);
  roundTrip("blockInsert", [{ op: "blockInsert", path: "sections.0.blocks.2", block: { kind: "p", text: "Qo‘shilgan paragraf." } }]);
  roundTrip("setSection", [{ op: "setSection", sectionId: "conclusion", blocks: [{ kind: "p", text: "Yangi xulosa." }, { kind: "li", text: "Band." }] }]);
  roundTrip("set", [{ op: "set", doc: { ...base(), sections: [{ id: "intro", title: "X", blocks: [{ kind: "p", text: "Faqat bitta." }] }] } }]);
  roundTrip("review", [{ op: "review", review: { score: 77, checks: [], judgeNotes: [], verifiedShare: 1, recentShare: 1, builtAt: "2026-09-12T00:00:00.000Z" } }]);
});

test("highlights aylanmasi (Elsevier turi)", () => {
  const doc = JSON.parse(JSON.stringify(sampleArticleDoc({ ...META, language: "en" }, { type: "elsevier_ieee_style" }))) as AcademicDoc;
  doc.article!.highlights = ["First result", "Second result", "Third result"];
  roundTrip("highlights", [{ op: "highlights", items: ["A", "B", "C", "D"] }], doc);
});

test("bir necha op ketma-ketligining teskarisi ham aylanadi", () => {
  roundTrip("zanjir", [
    { op: "text", path: P0, value: "Birinchi." },
    { op: "heading", sectionId: "results", title: "Natijalar va tahlil" },
    { op: "blockRemove", path: "sections.3.blocks.0" },
    { op: "refRemove", refId: "u1" },
    { op: "cell", tableId: "t1", r: 1, c: 2, value: "4,3" },
  ]);
});

/* ══════════════════════════════ sinxron nusxalar ══════════════════════════════ */

test("rasm sarlavhasi: blok ⇄ `figures[].caption` sinxron (ikkala yo'nalishda)", () => {
  const a = apply(base(), [{ op: "text", path: "sections.1.blocks.1", value: "Blokdan yozildi" }]);
  assert.equal(a.article!.figures[0].caption, "Blokdan yozildi");
  const b = apply(base(), [{ op: "caption", target: "figure", id: "f1", value: "Modeldan yozildi" }]);
  const fig = b.sections[1].blocks[1];
  assert.equal(fig.kind === "figure" ? fig.text : "", "Modeldan yozildi");
  assert.equal(planArticle(b).body.find((x) => x.k === "figure")?.caption, "1-rasm. Modeldan yozildi");
});

test("jadval sarlavhasi: blok ⇄ `tables[].caption` sinxron", () => {
  const a = apply(base(), [{ op: "caption", target: "table", id: "t1", value: "Yangi jadval" }]);
  const ref = a.sections[2].blocks[1];
  assert.equal(ref.kind === "tableRef" ? ref.text : "", "Yangi jadval");
  assert.equal(a.tables![0].caption, "Yangi jadval");
  const b = apply(base(), [{ op: "text", path: "sections.2.blocks.1", value: "Blokdan" }]);
  assert.equal(b.tables![0].caption, "Blokdan");
});

test("kalit so'zlar: model ⇄ annotatsiya satri sinxron, takror va chegara kesiladi", () => {
  const items = ["AI", "ai", " o‘qitish ", "", ...Array.from({ length: 20 }, (_, i) => `k${i}`)];
  const a = apply(base(), [{ op: "keywords", lang: "uz", items }]);
  const kw = a.article!.keywords.uz!;
  assert.equal(kw.length, 12, "chegara 12");
  assert.equal(kw[0], "AI");
  assert.equal(kw[1], "o‘qitish", "takror «ai» tushishi, bo'sh joy kesilishi kerak");
  assert.equal(a.abstracts!.find((x) => x.lang === "uz")!.keywords, kw.join(", "));
  // `planArticle` annotatsiya satrini o'qiydi — ekran/DOCX yangi so'zlarni ko'rsatadi.
  const head = planArticle(a).head.find((h) => h.k === "abstract" && h.lang === "uz");
  assert.equal(head && head.k === "abstract" ? head.keywords : "", kw.join(", "));
});

test("annotatsiya yo'q tilda `abstract` opi uni YARATADI (abstract:xx tuzatishi)", () => {
  const doc = base();
  doc.abstracts = doc.abstracts!.filter((a) => a.lang !== "ru");
  const a = apply(doc, [{ op: "abstract", lang: "ru", text: "Аннотация появилась." }]);
  const ru = a.abstracts!.find((x) => x.lang === "ru");
  assert.ok(ru, "annotatsiya yaratilmadi");
  assert.equal(ru!.label, "Аннотация");
  assert.equal(ru!.keywords, doc.article!.keywords.ru!.join(", "), "kalit so'zlar modeldan olinadi");
  // Teskarisi — butun hujjat (`set`), chunki «yo'q» holatni maydon opi bilan qaytarib bo'lmaydi.
  const inv = inverseArticleOps(doc, [{ op: "abstract", lang: "ru", text: "x" }], { genId: GEN });
  assert.equal(inv[0].op, "set");
  assert.deepEqual(apply(a, inv), doc);
});

/* ══════════════════════════════ refRemove ══════════════════════════════ */

test("`refRemove` manbani reyestrdan va MATNDAGI iqtiboslardan olib tashlaydi", () => {
  const a = apply(withLegacyRefs(), [{ op: "refRemove", refId: "W4385" }]);
  assert.ok(!a.article!.references.some((r) => r.id === "W4385"), "manba reyestrda qoldi");
  const all = a.sections.flatMap((s) => s.blocks.map((b) => b.text)).join("\n");
  assert.ok(!all.includes("W4385"), `matnda iqtibos qoldi: ${all}`);
  // Guruhdagi boshqa manba saqlanadi: «[W2741809807; W4385]» → «[W2741809807]».
  assert.match(a.sections[3].blocks[0].text, /\[W2741809807\];/);
  // Yolg'iz iqtibos qavsi bilan, oldingi bo'shlig'i bilan ketadi: «… moslashadi [W4385].» → «… moslashadi.»
  assert.match(a.sections[0].blocks[0].text, /moslashadi\.$/);
  // Eski satrlar ro'yxati ham qisqaradi.
  assert.equal(a.references!.length, 2);
  assert.ok(!a.references!.some((s) => /Ahmad/.test(s)));
  // Ro'yxatda (planArticle) ham yo'q.
  assert.ok(!planArticle(a).refs.some((r) => r.ref.id === "W4385"));
});

test("`refRemove`: lokatorli guruh yolg'iz qolsa butunlay tushadi; noma'lum manba — xato", () => {
  assert.equal(stripCitation("Gap [W1; 25-b.].", "W1"), "Gap.");
  assert.equal(stripCitation("Gap [W1; W2; 25-b.].", "W1"), "Gap [W2; 25-b.].");
  assert.equal(stripCitation("Gap [w1] va [qarang].", "W1"), "Gap va [qarang].");
  assert.equal(stripCitation("Gap [W9].", "W1"), "Gap [W9].", "boshqa id ga tegilmaydi");
  fails(base(), [{ op: "refRemove", refId: "W999" }], /topilmadi/);
});

test("matn tahriri iqtibosni olib tashlasa `cited` bayrog'i tushadi (OAK: ro'yxatda faqat iqtibos qilingan manba)", () => {
  // u1 faqat bitta blokda iqtibos qilingan.
  const a = apply(base(), [{ op: "text", path: "sections.1.blocks.0", value: "Adabiyotlar tahlili boshqa manbasiz yozildi." }]);
  const u1 = a.article!.references.find((r) => r.id === "u1")!;
  assert.equal(u1.cited, false);
  assert.ok(!planArticle(a).refs.some((r) => r.ref.id === "u1"), "ro'yxatda qoldi");
  // Qaytarilsa — yana ro'yxatda.
  const inv = inverseArticleOps(base(), [{ op: "text", path: "sections.1.blocks.0", value: "x" }], { genId: GEN });
  const back = apply(a, inv);
  assert.equal(back.article!.references.find((r) => r.id === "u1")!.cited, true);
  assert.deepEqual(recomputeCited(base()), base().article!.references, "namunada bayroqlar matn bilan mos");
});

/* ══════════════════════════════ bloklar ══════════════════════════════ */

test("`blockRemove` jadval blokini o'chirsa jadvalning o'zi ham ketadi (bo'lim oxirida qayta chizilmasin)", () => {
  const a = apply(base(), [{ op: "blockRemove", path: "sections.2.blocks.1" }]);
  assert.equal(a.tables?.length ?? 0, 0);
  assert.ok(!planArticle(a).body.some((b) => b.k === "table"), "jadval baribir chizildi");
});

test("bo'sh matn rad etiladi (o'chirish — `blockRemove`); sarlavha bo'sh bo'lmaydi", () => {
  fails(base(), [{ op: "text", path: P0, value: "   " }], /blockRemove/);
  fails(base(), [{ op: "heading", sectionId: "intro", title: "" }], /bo'sh/);
  fails(base(), [{ op: "text", path: "sections.9.blocks.0", value: "x" }], /topilmadi/);
  fails(base(), [{ op: "blockInsert", path: "sections.0.blocks.9", block: { kind: "p", text: "x" } }], /topilmadi/);
  fails(base(), [{ op: "cell", tableId: "t1", r: 5, c: 0, value: "x" }], /chegaradan/);
});

test("yiqilgan op HECH NARSANI qo'llamaydi (atomarlik) va kirish o'zgarmaydi", () => {
  const doc = base();
  const before = JSON.stringify(doc);
  const r = applyArticleOps(doc, [{ op: "text", path: P0, value: "Yangi" }, { op: "heading", sectionId: "yo'q", title: "x" }], { genId: GEN });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.at, 1);
  assert.equal(JSON.stringify(doc), before);
});

test("`set` faqat matn qismlarini oladi: meta, rasm aktivi, hisobot JORIY hujjatdan qoladi", () => {
  const doc = base();
  doc.article!.figures[0].url = `/api/generations/${GEN}/assets/abc`;
  doc.article!.review = { score: 91, checks: [], judgeNotes: [], verifiedShare: 1, recentShare: 1, builtAt: "2026-09-12T00:00:00.000Z" };
  const foreign = base();
  foreign.meta = { ...foreign.meta, topic: "BEGONA" };
  foreign.article!.figures[0].url = "https://evil.example/x.png";
  foreign.article!.review = { score: 100, checks: [], judgeNotes: [], verifiedShare: 1, recentShare: 1, builtAt: "x" };
  foreign.sections[0].blocks[0] = { kind: "p", text: "Almashgan matn." };
  const a = apply(doc, [{ op: "set", doc: foreign }]);
  assert.equal(a.sections[0].blocks[0].text, "Almashgan matn.");
  assert.equal(a.meta.topic, doc.meta.topic, "meta almashdi");
  assert.equal(a.article!.figures[0].url, doc.article!.figures[0].url, "begona rasm URL i kirdi");
  assert.equal(a.article!.review!.score, 91, "klient ballni o'zi yozdi");
});

/* ══════════════════════════════ eski maqola ══════════════════════════════ */

test("eski maqola (`doc.article` yo'q): matn/sarlavha/katak/blok ruxsat, model oplari — xato", () => {
  const doc = legacyDoc();
  const a = apply(doc, [
    { op: "text", path: P0, value: "Eski maqola matni." },
    { op: "heading", sectionId: "intro", title: "Kirish" },
    { op: "cell", tableId: "t1", r: 0, c: 0, value: "X" },
    { op: "blockRemove", path: "sections.4.blocks.0" },
  ]);
  assert.equal(a.sections[0].blocks[0].text, "Eski maqola matni.");
  assert.deepEqual(a.references, ["Manba 1", "Manba 2"], "eski ro'yxatga tegilmasligi kerak");
  for (const op of [
    { op: "abstract", lang: "uz", text: "x" },
    { op: "keywords", lang: "uz", items: ["a"] },
    { op: "highlights", items: ["a"] },
    { op: "refRemove", refId: "legacy1" },
    { op: "caption", target: "figure", id: "f1", value: "x" },
    { op: "setSection", sectionId: "intro", blocks: [] },
  ] as ArticleOp[]) {
    fails(doc, [op], /Eski maqola/);
  }
  roundTrip("legacy/text", [{ op: "text", path: P0, value: "Boshqa." }], doc);
});

/* ══════════════════════════════ parse ══════════════════════════════ */

test("parseArticleOps yaroqli tanani qabul qiladi", () => {
  const r = parseArticleOps([
    { op: "text", path: P0, value: "x" },
    { op: "heading", sectionId: "intro", title: "T" },
    { op: "cell", tableId: "t1", r: -1, c: 0, value: "H" },
    { op: "caption", target: "figure", id: "f1", value: "C" },
    { op: "abstract", lang: "en", text: "A" },
    { op: "keywords", lang: "uz", items: ["a", " b "] },
    { op: "highlights", items: ["h"] },
    { op: "refRemove", refId: "W4385" },
    { op: "blockRemove", path: "sections.1.blocks.0" },
    { op: "blockInsert", path: "sections.1.blocks.0", block: { kind: "figure", text: "c", figureId: "f1", junk: 1 } },
    { op: "setSection", sectionId: "intro", blocks: [{ kind: "p", text: "p" }, { kind: "formula", text: "x", display: 1 }] },
    { op: "set", doc: { sections: [{ id: "a", title: "b", blocks: [{ kind: "p", text: "c" }] }], article: { keywords: { uz: ["k"] }, references: [] } } },
  ]);
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.equal(r.ops.length, 12);
  assert.deepEqual(r.ops[5], { op: "keywords", lang: "uz", items: ["a", "b"] });
  const ins = r.ops[9];
  assert.deepEqual(ins.op === "blockInsert" ? ins.block : null, { kind: "figure", text: "c", figureId: "f1" }, "begona maydon o'tdi");
  const ss = r.ops[10];
  assert.deepEqual(ss.op === "setSection" ? ss.blocks[1] : null, { kind: "formula", text: "x", display: true });
});

test("parseArticleOps yaroqsiz tanani rad etadi (≤50 op, matn ≤6000, yo'l regex, `review` server-only)", () => {
  const bad = (raw: unknown, re: RegExp) => {
    const r = parseArticleOps(raw);
    assert.equal(r.ok, false, `qabul qilindi: ${JSON.stringify(raw).slice(0, 80)}`);
    if (!r.ok) assert.match(r.error, re);
  };
  bad(null, /ro'yxati/);
  bad([], /yo'q/);
  bad(Array.from({ length: 51 }, () => ({ op: "text", path: P0, value: "x" })), /50/);
  bad([{ op: "text", path: P0, value: "x".repeat(ARTICLE_EDIT_LIMITS.text + 1) }], /uzun/);
  bad([{ op: "text", path: "sections.0.title", value: "x" }], /path/);
  bad([{ op: "text", path: "sections.100.blocks.0", value: "x" }], /path/);
  bad([{ op: "text", path: P0, value: 5 }], /value/);
  bad([{ op: "heading", sectionId: "a b", title: "x" }], /sectionId/);
  bad([{ op: "cell", tableId: "t1", r: -2, c: 0, value: "x" }], /indeks/);
  bad([{ op: "cell", tableId: "t1", r: 0, c: 25, value: "x" }], /indeks/);
  bad([{ op: "caption", target: "photo", id: "f1", value: "x" }], /target/);
  bad([{ op: "abstract", lang: "de", text: "x" }], /lang/);
  bad([{ op: "keywords", lang: "uz", items: Array.from({ length: 13 }, () => "k") }], /12/);
  bad([{ op: "keywords", lang: "uz", items: ["a", 1] }], /items/);
  bad([{ op: "highlights", items: Array.from({ length: 6 }, () => "h") }], /5/);
  bad([{ op: "blockInsert", path: P0, block: { kind: "video", text: "x" } }], /block/);
  bad([{ op: "blockInsert", path: P0, block: { kind: "figure", text: "x" } }], /block/);
  bad([{ op: "setSection", sectionId: "intro", blocks: [{ kind: "p" }] }], /blocks/);
  bad([{ op: "set", doc: { sections: [] } }], /doc/);
  bad([{ op: "set", doc: { sections: [{ id: "a", title: "b", blocks: [] }], article: { references: [{ id: "W1", title: "t", authors: [], verified: "magic" }] } } }], /doc/);
  bad([{ op: "review", review: { score: 100 } }], /Noma'lum/);
  bad([{ op: "text", path: P0, value: "x", __proto__: { a: 1 }, constructor: { x: 1 } }], /Taqiqlangan/);
  bad([{ op: "rowAdd", section: "experience" }], /Noma'lum/);
});

test("`ARTICLE_PATH_RE` faqat `sections.i.blocks.j` ni o'tkazadi", () => {
  for (const ok of ["sections.0.blocks.0", "sections.12.blocks.399"]) assert.ok(ARTICLE_PATH_RE.test(ok), ok);
  for (const no of ["sections.0.blocks", "sections.0.title", "sections.123.blocks.0", "sections.0.blocks.1000", "abstracts.0.text", " sections.0.blocks.0", "sections.0.blocks.0.text", "tables.0.caption"]) {
    assert.ok(!ARTICLE_PATH_RE.test(no), `o'tib ketdi: ${no}`);
  }
});
