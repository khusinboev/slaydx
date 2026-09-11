import test from "node:test";
import assert from "node:assert/strict";
import {
  formatReferenceLine,
  legacyArticleModel,
  orderReferences,
  planArticle,
  renderCitations,
  surnameOf,
  type BodyItem,
} from "../lib/generation/article/layout.ts";
import { PUBLICATION_PROFILES } from "../lib/generation/article/profiles.ts";
import { sampleArticleDoc } from "../lib/generation/article/samples.ts";
import type { Reference } from "../lib/generation/article/types.ts";
import type { AcademicDoc, DocMeta } from "../lib/generation/types.ts";

/**
 * `planArticle` — YAGONA MANBA (Maqola 2, AUDIT-17 WP2).
 *
 * Bu yerda TARTIB va RAQAMLASH qulflanadi: DOCX ham, ko'ruvchi ham shu
 * rejadan chizadi, ya'ni reja noto'g'ri bo'lsa ikkalasi ham bir xil
 * noto'g'ri bo'ladi (paritet testi buni ushlamaydi — shuning uchun reja
 * o'zi alohida sinaladi).
 */

const META: DocMeta = {
  topic: "Sun’iy intellektning oliy ta’limdagi o‘rni",
  author: "Karimova Dilnoza",
  workLabel: "Maqola",
  language: "uz",
  toolId: "article",
} as unknown as DocMeta;

const REFS: Reference[] = [
  { id: "W1", title: "Zeta paper", authors: ["Zorin Z.", "Ahmad B."], year: 2021, venue: "J. A", verified: "openalex", cited: true },
  { id: "W2", title: "Alpha paper", authors: ["Aliyev A."], year: 2023, venue: "J. B", verified: "crossref", cited: true },
  { id: "u1", title: "Mahalliy kitob", authors: ["Karimov A.", "Salimov B.", "Tosh T."], year: 2020, publisher: "Fan", place: "Toshkent", verified: "user", cited: true },
  { id: "W9", title: "Uncited", authors: ["Nobody N."], year: 2019, verified: "openalex", cited: false },
  { id: "W7", title: "Unverified", authors: ["Ghost G."], year: 2018, verified: "unverified", cited: true },
];

const kinds = (body: BodyItem[]) => body.map((b) => b.k);

/* ══════════════════════════════ tartib ══════════════════════════════ */

test("tartib: UDK → sarlavha → mualliflar → annotatsiya ×3 → bo'limlar → adabiyotlar → REFERENCES (oak)", () => {
  const plan = planArticle(sampleArticleDoc(META, { type: "imrad_oak", profile: "oak" }));
  assert.deepEqual(
    plan.head.map((h) => h.k),
    ["udk", "title", "authors", "abstract", "abstract", "abstract"],
  );
  const abs = plan.head.filter((h) => h.k === "abstract");
  assert.deepEqual(
    abs.map((a) => (a.k === "abstract" ? [a.lang, a.label, a.keywordsLabel] : null)),
    [
      ["uz", "Annotatsiya", "Kalit so‘zlar"],
      ["ru", "Аннотация", "Ключевые слова"],
      ["en", "Abstract", "Keywords"],
    ],
  );
  assert.equal(plan.head[0].k === "udk" ? plan.head[0].text : "", "UDK 004.8:37.02");
  assert.equal(plan.body[0].k, "h1");
  assert.equal(plan.refsLabel, "Foydalanilgan adabiyotlar");
  assert.equal(plan.refs2Label, "REFERENCES", "OAK ikkinchi ro'yxati bo'lishi kerak");
  assert.equal(plan.refs2?.length, plan.refs.length);
  assert.equal(plan.tableCaptionAlign, "right");
  assert.equal(plan.headingAlign, "center");
  assert.equal(plan.legacy, false);
});

test("apa/ieee profilida UDK ham, REFERENCES ham yo'q; ieee da sarlavhalar 1., 2. raqamlangan va chapda", () => {
  const apa = planArticle(sampleArticleDoc(META, { type: "imrad_classic", profile: "apa" }));
  assert.ok(!apa.head.some((h) => h.k === "udk"), "apa: UDK chiqmasligi kerak");
  assert.equal(apa.refs2, undefined);
  assert.equal(apa.tableCaptionAlign, "left");
  const ieee = planArticle(sampleArticleDoc(META, { type: "elsevier_ieee_style", profile: "ieee" }));
  const h1 = ieee.body.filter((b): b is Extract<BodyItem, { k: "h1" }> => b.k === "h1");
  assert.deepEqual(
    h1.map((x) => x.number),
    ["1.", "2.", "3.", "4.", "5."],
  );
  assert.ok(h1[0].text.startsWith("1. "), h1[0].text);
  assert.equal(h1[0].title, "Kirish", "`title` — raqamsiz asl sarlavha (tahrir uchun)");
  assert.equal(ieee.headingAlign, "left");
  assert.equal(ieee.numberedSections, true);
  // oak — raqamsiz
  const oak = planArticle(sampleArticleDoc(META, { type: "imrad_oak", profile: "oak" }));
  assert.ok(oak.body.every((b) => b.k !== "h1" || !b.number));
});

test("h2 bloklari raqamlangan uslubda 1.1., 1.2. (tur raqamlashni talab qilsa profil raqamsiz bo'lsa ham)", () => {
  const doc = sampleArticleDoc(META, { type: "elsevier_ieee_style", profile: "apa" });
  doc.sections[0].blocks.push({ kind: "h2", text: "Ostmavzu A" }, { kind: "p", text: "matn" }, { kind: "h2", text: "Ostmavzu B" });
  const plan = planArticle(doc);
  const h2 = plan.body.filter((b): b is Extract<BodyItem, { k: "h2" }> => b.k === "h2");
  assert.deepEqual(
    h2.map((x) => x.text),
    ["1.1. Ostmavzu A", "1.2. Ostmavzu B"],
  );
});

test("highlights faqat modelda bo'lsa; bo'sh bo'limlar tashlab ketiladi", () => {
  const doc = sampleArticleDoc(META, { type: "elsevier_ieee_style", profile: "ieee" });
  doc.article!.highlights = ["Natija 1", "Natija 2", "Natija 3"];
  doc.sections.push({ id: "empty", title: "Bo'sh", blocks: [] });
  const plan = planArticle(doc);
  const hl = plan.head.find((h) => h.k === "highlights");
  assert.ok(hl && hl.k === "highlights" && hl.items.length === 3 && hl.label === "Asosiy natijalar");
  assert.ok(!plan.body.some((b) => b.k === "h1" && b.sectionId === "empty"));
  assert.equal(plan.head[plan.head.length - 1].k, "highlights", "highlights annotatsiyadan keyin");
});

/* ══════════════════════════════ raqamlash ══════════════════════════════ */

test("rasm/jadval/formula bo'limlar tartibida raqamlanadi (flat)", () => {
  const doc = sampleArticleDoc(META);
  // Ikkinchi rasm va ikkinchi jadval qo'shamiz.
  doc.article!.figures.push({ ...doc.article!.figures[0], id: "f2", caption: "Ikkinchi sxema" });
  doc.tables!.push({ id: "t2", caption: "Ikkinchi jadval", headers: ["A"], rows: [["1"]], anchor: "discussion" });
  doc.sections[3].blocks.push({ kind: "figure", text: "Ikkinchi sxema", figureId: "f2" }, { kind: "tableRef", text: "Ikkinchi jadval", tableId: "t2" }, { kind: "formula", text: "x^2" });
  const plan = planArticle(doc);
  assert.deepEqual(plan.numbers, { figures: { f1: "1", f2: "2" }, tables: { t1: "1", t2: "2" }, formulas: 2 });
  const figs = plan.body.filter((b): b is Extract<BodyItem, { k: "figure" }> => b.k === "figure");
  assert.deepEqual(
    figs.map((f) => f.caption),
    ["1-rasm. Adaptiv o‘qitish tizimining umumiy tuzilmasi", "2-rasm. Ikkinchi sxema"],
  );
  assert.deepEqual(
    figs.map((f) => f.placeholder),
    ["[1-rasm — sxema]", "[2-rasm — sxema]"],
  );
  assert.equal(figs[0].source, "Manba: Muallif tomonidan tuzilgan");
  // Manbasiz rasm — satr yo'q; iqtibosli manba uslubga ko'ra.
  doc.article!.figures[1].source = "[W4385] asosida";
  const p2 = planArticle(doc);
  const f2 = p2.body.filter((b): b is Extract<BodyItem, { k: "figure" }> => b.k === "figure");
  assert.equal(f2[1].source, "Manba: [2] asosida");
  doc.article!.figures[0].source = "";
  assert.equal(planArticle(doc).body.filter((b): b is Extract<BodyItem, { k: "figure" }> => b.k === "figure")[0].source, undefined);
  const tabs = plan.body.filter((b): b is Extract<BodyItem, { k: "table" }> => b.k === "table");
  assert.deepEqual(
    tabs.map((t) => t.caption),
    ["1-jadval. Guruhlar bo‘yicha o‘zlashtirish ko‘rsatkichlari", "2-jadval. Ikkinchi jadval"],
  );
  const eqs = plan.body.filter((b): b is Extract<BodyItem, { k: "formula" }> => b.k === "formula");
  assert.deepEqual(
    eqs.map((e) => e.number),
    ["(1)", "(2)"],
  );
  // Jadval `tableRef` joyida — bitta marta (langar bo'yicha takrorlanmaydi).
  assert.equal(tabs.length, 2);
});

test("`figureNumbering: chapter` → «2.1-rasm» (bob bo'yicha)", () => {
  const doc = sampleArticleDoc(META);
  assert.equal(planArticle(doc).numbers.figures.f1, "1");
  // Profil obyektini vaqtincha almashtiramiz — reja `PUBLICATION_PROFILES` dan o'qiydi.
  const orig = PUBLICATION_PROFILES.oak.figureNumbering;
  (PUBLICATION_PROFILES.oak as { figureNumbering: string }).figureNumbering = "chapter";
  try {
    const p2 = planArticle(doc);
    // f1 — 2-bo'limda («Adabiyotlar tahlili va metodlar»), t1 — 3-bo'limda.
    assert.equal(p2.numbers.figures.f1, "2.1");
    assert.equal(p2.numbers.tables.t1, "3.1");
    const fig = p2.body.find((b): b is Extract<BodyItem, { k: "figure" }> => b.k === "figure")!;
    assert.equal(fig.caption.startsWith("2.1-rasm."), true, fig.caption);
  } finally {
    (PUBLICATION_PROFILES.oak as { figureNumbering: string }).figureNumbering = orig;
  }
});

test("`[fig:f1]` / `[tab:t1]` matn havolasi raqamga aylanadi; ru/en yorliqlari", () => {
  const doc = sampleArticleDoc(META);
  doc.sections[0].blocks.push({ kind: "p", text: "Tuzilma [fig:f1] da, natijalar [tab:t1] da keltirilgan." });
  const plan = planArticle(doc);
  const p = plan.body.find((b) => b.k === "p" && b.text.includes("Tuzilma"));
  assert.ok(p && p.k === "p");
  assert.equal(p.text, "Tuzilma 1-rasm da, natijalar 1-jadval da keltirilgan.");
  const ru = planArticle(sampleArticleDoc({ ...META, language: "ru" }));
  const fig = ru.body.find((b): b is Extract<BodyItem, { k: "figure" }> => b.k === "figure")!;
  assert.ok(fig.caption.startsWith("Рис. 1."), fig.caption);
  assert.equal(fig.placeholder, "[рис. 1 — схема]");
  const en = planArticle(sampleArticleDoc({ ...META, language: "en" }));
  const tab = en.body.find((b): b is Extract<BodyItem, { k: "table" }> => b.k === "table")!;
  assert.ok(tab.caption.startsWith("Table 1."), tab.caption);
});

test("rasm `fallbackBlocks` bilan — raqam olmaydi, o'rniga bloklar", () => {
  const doc = sampleArticleDoc(META);
  doc.article!.figures[0].fallbackBlocks = [{ kind: "li", text: "Talaba faoliyati" }, { kind: "li", text: "AI tahlil" }];
  const plan = planArticle(doc);
  assert.ok(!plan.body.some((b) => b.k === "figure"));
  assert.deepEqual(plan.numbers.figures, {});
  assert.ok(plan.body.some((b) => b.k === "li" && b.text === "AI tahlil"));
});

test("reyestrda yo'q rasm — o'rinbosar bilan baribir chiziladi (sarlavha yo'qolmaydi)", () => {
  const doc = sampleArticleDoc(META);
  doc.article!.figures = [];
  const plan = planArticle(doc);
  const fig = plan.body.find((b): b is Extract<BodyItem, { k: "figure" }> => b.k === "figure");
  assert.ok(fig && !fig.figure && fig.number === "1" && fig.caption.includes("Adaptiv"));
});

test("`tableRef` siz, langarli jadval — bo'lim oxirida; langarsiz — hujjat oxirida; takror yo'q", () => {
  const doc = sampleArticleDoc(META);
  doc.tables!.push({ id: "t2", caption: "Langarli", headers: ["A"], rows: [["1"]], anchor: "intro" }, { id: "t3", caption: "Langarsiz", headers: ["B"], rows: [["2"]] });
  const plan = planArticle(doc);
  const k = kinds(plan.body);
  const introH1 = plan.body.findIndex((b) => b.k === "h1" && b.sectionId === "intro");
  const nextH1 = plan.body.findIndex((b, i) => i > introH1 && b.k === "h1");
  const t2 = plan.body.findIndex((b) => b.k === "table" && b.tableId === "t2");
  assert.ok(t2 > introH1 && t2 < nextH1, "langarli jadval o'z bo'limi ichida emas");
  assert.equal(k[k.length - 1], "table");
  assert.equal((plan.body[plan.body.length - 1] as Extract<BodyItem, { k: "table" }>).tableId, "t3");
  assert.equal(plan.body.filter((b) => b.k === "table").length, 3);
  // Raqamlar hujjat tartibida: t2 (intro) = 1, t1 (results) = 2, t3 = 3.
  assert.deepEqual(plan.numbers.tables, { t2: "1", t1: "2", t3: "3" });
});

/* ══════════════════════════════ iqtiboslar ══════════════════════════════ */

const numbered = REFS.filter((r) => r.cited).map((r, i) => ({ ...r, n: i + 1 }));

test("renderCitations: 4 uslub", () => {
  const text = "Matn [W1]. Yana [W2; W1] va [u1; 25-b.] oxiri.";
  assert.equal(renderCitations(text, numbered, "gost", "uz").text, "Matn [1]. Yana [2, 1] va [3; 25-b.] oxiri.");
  assert.equal(renderCitations(text, numbered, "numeric", "uz").text, "Matn [1]. Yana [2, 1] va [3, 25-b.] oxiri.");
  assert.equal(renderCitations(text, numbered, "ieee", "uz").text, "Matn [1]. Yana [2, 1] va [3, 25-b.] oxiri.");
  assert.equal(
    renderCitations(text, numbered, "apa7", "uz").text,
    "Matn (Zorin va Ahmad, 2021). Yana (Aliyev, 2023; Zorin va Ahmad, 2021) va (Karimov va b., 2020, 25-b.) oxiri.",
  );
  assert.equal(renderCitations("A [W1] b [u1]", numbered, "apa7", "en").text, "A (Zorin & Ahmad, 2021) b (Karimov et al., 2020)");
  assert.equal(renderCitations("A [W1] b [u1]", numbered, "apa7", "ru").text, "A (Zorin и Ahmad, 2021) b (Karimov и др., 2020)");
});

test("renderCitations: bo'laklar matni `text` ga teng, `verified` guruhdagi eng zaifi, oddiy qavs tegilmaydi", () => {
  const r = renderCitations("Qarang [W1; W7] (izoh [qavs]) va [W2].", numbered, "numeric", "uz");
  assert.equal(r.spans.map((s) => s.text).join(""), r.text);
  const cites = r.spans.filter((s) => s.cite);
  assert.equal(cites.length, 2);
  assert.equal(cites[0].cite!.verified, "unverified", "W7 tekshirilmagan — guruh belgisi ⚠️");
  assert.deepEqual(cites[0].cite!.ids, ["W1", "W7"]);
  assert.equal(cites[1].cite!.verified, "crossref");
  assert.ok(r.text.includes("[qavs]"), "oddiy qavs iqtibos emas");
});

test("renderCitations: ro'yxatda yo'q id tushadi, bo'sh qavs butunlay yo'qoladi", () => {
  const r = renderCitations("Gap [W404]. Aralash [W1; W404] tugadi.", numbered, "gost", "uz");
  assert.equal(r.text, "Gap. Aralash [1] tugadi.");
});

test("cited-only: `cited:false` manba ro'yxatga kirmaydi va matndagi iqtibosi tushadi", () => {
  const doc = sampleArticleDoc(META);
  doc.article!.references = REFS;
  doc.sections[0].blocks[0] = { kind: "p", text: "A [W9]. B [W1]." };
  const plan = planArticle(doc);
  assert.ok(!plan.refs.some((r) => r.ref.id === "W9"));
  const p = plan.body.find((b) => b.k === "p") as Extract<BodyItem, { k: "p" }>;
  assert.equal(p.text, "A. B [1].");
  assert.equal(plan.refs.length, 4);
});

test("gost/numeric/ieee: ro'yxat matnda UCHRASH tartibida; uchramaganlar oxirida", () => {
  const doc = sampleArticleDoc(META);
  doc.article!.references = REFS;
  doc.article!.cite = "gost";
  doc.sections[0].blocks[0] = { kind: "p", text: "Avval [u1], keyin [W2], so'ng [W1]." };
  for (const s of doc.sections.slice(1)) for (const b of s.blocks) if ("text" in b && b.kind !== "formula") b.text = b.text.replace(/\[[^\]]+\]/g, "");
  const plan = planArticle(doc);
  assert.deepEqual(
    plan.refs.map((r) => r.ref.id),
    ["u1", "W2", "W1", "W7"],
  );
  assert.deepEqual(
    plan.refs.map((r) => r.n),
    [1, 2, 3, 4],
  );
  assert.ok(plan.refs[0].line.startsWith("1. "));
  const p = plan.body.find((b) => b.k === "p") as Extract<BodyItem, { k: "p" }>;
  assert.equal(p.text, "Avval [1], keyin [2], so'ng [3].");
});

test("apa7: ro'yxat familiya bo'yicha ALIFBO tartibida, raqamsiz", () => {
  const doc = sampleArticleDoc(META);
  doc.article!.references = REFS;
  doc.article!.cite = "apa7";
  doc.sections[0].blocks[0] = { kind: "p", text: "Avval [u1], keyin [W2], so'ng [W1]." };
  const plan = planArticle(doc);
  assert.deepEqual(
    plan.refs.map((r) => r.ref.id),
    ["W2", "W7", "u1", "W1"],
    "Aliyev, Ghost, Karimov, Zorin",
  );
  assert.ok(!plan.refs[0].line.startsWith("1."), "APA da raqam yo'q");
  assert.equal(plan.refs[0].line, plan.refs[0].text);
});

test("orderReferences/surnameOf", () => {
  assert.equal(surnameOf("Lin C."), "Lin");
  assert.equal(surnameOf("C. Lin"), "Lin");
  assert.equal(surnameOf("Karimova, D. B."), "Karimova");
  const sorted = orderReferences(REFS, "apa7", []);
  assert.deepEqual(
    sorted.map((r) => r.id),
    ["W2", "W7", "u1", "W9", "W1"],
  );
});

/* ══════════════════════════════ ro'yxat satri (VAQTINCHA, WP5 almashtiradi) ══════════════════════════════ */

test("formatReferenceLine: muallif, sarlavha, venue, yil, DOI; `raw` o'zgarishsiz; nuqta ikkilanmaydi", () => {
  const ref = REFS[0];
  const gost = formatReferenceLine({ ...ref, doi: "10.1/x" }, "gost");
  assert.equal(gost, "Zorin Z., Ahmad B. Zeta paper. J. A, 2021. DOI: 10.1/x.");
  assert.ok(!gost.includes(".."), gost);
  assert.equal(formatReferenceLine(REFS[2], "gost", "uz"), "Karimov A., Salimov B., Tosh T. Mahalliy kitob. Toshkent: Fan, 2020.");
  assert.equal(formatReferenceLine({ ...ref, doi: "10.1/x" }, "apa7", "en"), "Zorin Z. & Ahmad B. (2021). Zeta paper. J. A. https://doi.org/10.1/x");
  assert.equal(formatReferenceLine({ ...ref, doi: "10.1/x" }, "ieee"), "Zorin Z., Ahmad B., “Zeta paper,” J. A, 2021. doi: 10.1/x.");
  assert.equal(formatReferenceLine({ ...ref, raw: "  Xom satr. — T., 2020.  " }, "gost"), "Xom satr. — T., 2020.");
});

/* ══════════════════════════════ eski maqola ══════════════════════════════ */

test("legacy: `doc.article` yo'q — model meta dan, `legacy: true`, bo'limlar o'zgarmas, iqtiboslar tegilmaydi", () => {
  const legacy: AcademicDoc = {
    meta: { ...META, kind: "imrad", organization: "TDIU", email: "a@b.uz", degree: "PhD" },
    titlePage: true,
    toc: true,
    sections: [
      { id: "s1", title: "KIRISH", blocks: [{ kind: "p", text: "Eski matn [1]." }] },
      { id: "s2", title: "XULOSA", blocks: [{ kind: "p", text: "Tamom [2]." }] },
    ],
    references: ["Birinchi manba. — T., 2020.", "Second source, 2021."],
    abstracts: [{ lang: "uz", label: "Annotatsiya", text: "Qisqa.", keywords: "a, b" }],
  } as unknown as AcademicDoc;
  const m = legacyArticleModel(legacy);
  assert.equal(m.type, "imrad_classic");
  assert.deepEqual(m.authors, [{ name: "Karimova Dilnoza", degree: "PhD", org: "TDIU", email: "a@b.uz" }]);
  assert.equal(m.references.length, 2);
  assert.equal(m.references[0].verified, "unverified");
  const plan = planArticle(legacy);
  assert.equal(plan.legacy, true);
  const ps = plan.body.filter((b): b is Extract<BodyItem, { k: "p" }> => b.k === "p").map((b) => b.text);
  assert.deepEqual(ps, ["Eski matn [1].", "Tamom [2]."]);
  assert.deepEqual(
    plan.refs.map((r) => r.line),
    ["1. Birinchi manba. — T., 2020.", "2. Second source, 2021."],
  );
});
