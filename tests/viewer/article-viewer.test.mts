import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { ArticleHead, CiteText } from "../../components/viewers/ArticleHead.tsx";
import { WordViewer } from "../../components/viewers/WordViewer.tsx";
import { planArticle } from "../../lib/generation/article/layout.ts";
import { sampleArticleDoc } from "../../lib/generation/article/samples.ts";
import { articleFlow, docToFlow, type FlowItem } from "../../lib/viewers/flow.ts";
import { packPages } from "../../lib/viewers/paginate.ts";
import type { AcademicDoc, DocMeta } from "../../lib/generation/types.ts";

/**
 * Maqola ko'ruvchisi (Maqola 2, WP2): KaTeX SSR chiqishi, iqtibos belgisi,
 * annotatsiya ×3, rasm o'rinbosari/rasmi, jadval sarlavhasi tepada,
 * sahifalash qoidalari (`figure` atom, annotatsiya yangi varaqdan emas).
 */

const META: DocMeta = {
  topic: "Sun’iy intellektning oliy ta’limdagi o‘rni",
  author: "Karimova Dilnoza",
  workLabel: "Maqola",
  language: "uz",
  toolId: "article",
} as unknown as DocMeta;

const PNG_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const html = (doc: AcademicDoc) => renderToStaticMarkup(h(WordViewer, { doc }));

test("formula KaTeX bilan chiziladi (`class=\"katex\"`), raqami «(1)» alohida, klient skripti yo'q", () => {
  const out = html(sampleArticleDoc(META));
  assert.ok(out.includes('class="katex'), "KaTeX chiqishi yo'q");
  assert.ok(out.includes("katex-display"), "displayMode bo'lishi kerak");
  assert.ok(out.includes('data-formula=""') || out.includes("data-formula"), "formula tuguni belgilanmagan");
  assert.ok(out.includes('<span class="word-formula-num">(1)</span>'), "formula raqami yo'q");
  assert.ok(!/<script\b/.test(out), "ko'ruvchi HTML ida skript bo'lmasligi kerak (CSP)");
  // Δ va kasr chizilgan (KaTeX `mfrac`).
  assert.ok(out.includes("mfrac") || out.includes("frac-line"), "kasr yo'q");
});

test("xato LaTeX yiqitmaydi (`throwOnError: false`)", () => {
  const doc = sampleArticleDoc(META);
  doc.sections[2].blocks.push({ kind: "formula", text: "\\frac{a}{" });
  const out = html(doc);
  assert.ok(out.includes("katex-error"), "xato formula qizil xom matn bo'lishi kerak");
  assert.ok(out.includes("(2)"), "ikkinchi formula raqami");
});

test("iqtibos `[1]` `data-ref-verified` bilan o'raladi; tekshirilmagan manba — `unverified`", () => {
  const doc = sampleArticleDoc(META);
  doc.article!.references[1] = { ...doc.article!.references[1], verified: "unverified" };
  const out = html(doc);
  assert.ok(out.includes('<span class="word-cite" data-ref-verified="openalex" data-ref-ids="W2741809807" title="Manba OpenAlex da tasdiqlangan">[1]</span>'), out.match(/<span class="word-cite"[^>]*>/g)?.join("\n"));
  assert.ok(out.includes('data-ref-verified="unverified"'), "tekshirilmagan belgisi yo'q");
  assert.ok(out.includes('data-ref-verified="user"'), "foydalanuvchi manbasi belgisi yo'q");
  // Guruh: [1, 2] — W4385 unverified → eng zaifi.
  assert.ok(/data-ref-verified="unverified"[^>]*>\[1, 2\]</.test(out), "guruh belgisi eng zaifiga qarab bo'lishi kerak");
});

test("annotatsiya ×3 — yorliq o'z tilida, matn bilan bitta paragrafda, kalit so'zlar", () => {
  const out = html(sampleArticleDoc(META));
  for (const [label, kw] of [
    ["Annotatsiya", "Kalit so‘zlar"],
    ["Аннотация", "Ключевые слова"],
    ["Abstract", "Keywords"],
  ]) {
    assert.ok(out.includes(`<b>${label}.</b>`), `«${label}» inline yorlig'i yo'q`);
    assert.ok(out.includes(`<b>${kw}:</b>`), `«${kw}» yorlig'i yo'q`);
  }
  assert.equal((out.match(/data-article="abstract"/g) ?? []).length, 3);
  assert.ok(out.includes('lang="ru"') && out.includes('lang="en"'));
});

test("bosh blok: UDK chapda, sarlavha, 2 muallif (unvon + tashkilot/email/ORCID)", () => {
  const out = html(sampleArticleDoc(META));
  assert.ok(out.includes('<div class="word-udk" data-article="udk">UDK 004.8:37.02</div>'));
  assert.ok(out.includes(`<div class="word-article-title" data-article="title">${META.topic}</div>`));
  assert.equal((out.match(/class="word-author-line"/g) ?? []).length, 2);
  assert.ok(out.includes("ORCID: 0000-0002-1825-0097"));
  // `ArticleHead` o'rami ham ishlaydi.
  const items = articleFlow(planArticle(sampleArticleDoc(META))).filter(
    (it): it is Extract<FlowItem, { type: "udk" | "articleTitle" | "authors" | "abstract" | "highlights" }> =>
      ["udk", "articleTitle", "authors", "abstract", "highlights"].includes(it.type),
  );
  const head = renderToStaticMarkup(h(ArticleHead, { items }));
  assert.ok(head.includes("UDK 004.8:37.02") && head.includes("<b>Abstract.</b>"));
});

test("rasm: PNG bo'lsa `<img>`, bo'lmasa o'rinbosar ramka; sarlavha PASTDA", () => {
  const plain = html(sampleArticleDoc(META));
  assert.ok(plain.includes('<div class="word-figure-placeholder">[1-rasm — sxema]</div>'));
  assert.ok(plain.indexOf("word-figure-placeholder") < plain.indexOf('<div class="word-figure-caption">1-rasm.'), "sarlavha rasmdan oldin");
  assert.ok(plain.includes('<div class="word-figure-source">Manba: Muallif tomonidan tuzilgan</div>'), "manba satri yo'q");
  const doc = sampleArticleDoc(META);
  doc.article!.figures[0].url = PNG_URL;
  const withPng = html(doc);
  assert.ok(withPng.includes(`<img src="${PNG_URL}"`), "rasm yo'q");
  assert.ok(!withPng.includes("word-figure-placeholder"));
  assert.ok(withPng.indexOf("<img ") < withPng.indexOf('<div class="word-figure-caption">1-rasm.'));
});

test("jadval sarlavhasi «1-jadval. …» TEPADA, o'ngda (oak) / chapda (apa)", () => {
  const oak = html(sampleArticleDoc(META, { profile: "oak" }));
  const cap = oak.indexOf("1-jadval. Guruhlar");
  assert.ok(cap > 0);
  const capDiv = oak.slice(oak.lastIndexOf("<div", cap), cap);
  assert.ok(capDiv.includes("text-align:right"), capDiv);
  assert.ok(cap < oak.indexOf("<table", cap - 400) + 400 && oak.indexOf("<table", cap) > cap, "jadval sarlavhadan keyin bo'lishi kerak");
  const apa = html(sampleArticleDoc(META, { type: "imrad_classic", profile: "apa" }));
  const capA = apa.indexOf("1-jadval. Guruhlar");
  assert.ok(apa.slice(apa.lastIndexOf("<div", capA), capA).includes("text-align:left"));
});

test("REFERENCES ikkinchi ro'yxati (oak) va osilgan chekinish (apa)", () => {
  const oak = html(sampleArticleDoc(META, { profile: "oak" }));
  assert.ok(oak.includes('<div class="word-h1">REFERENCES</div>'));
  assert.ok(oak.includes('<p class="word-ref">1. Lin C.'));
  const apa = html(sampleArticleDoc(META, { type: "imrad_classic", profile: "apa" }));
  assert.ok(!apa.includes(">REFERENCES<"));
  assert.ok(apa.includes('class="word-ref word-ref--hanging"'));
});

test("CiteText: bo'laklar matni asl matnga teng; spans'siz oddiy matn", () => {
  const plan = planArticle(sampleArticleDoc(META));
  const p = plan.body.find((b) => b.k === "p" && b.spans.some((s) => s.cite)) as Extract<(typeof plan.body)[number], { k: "p" }>;
  const out = renderToStaticMarkup(h(CiteText, { text: p.text, spans: p.spans }));
  const text = out.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
  assert.equal(text, p.text.replace(/&/g, "&amp;").replace(/&amp;/g, "&"));
  assert.equal(renderToStaticMarkup(h(CiteText, { text: "oddiy" })), "oddiy");
});

/* ══════════════════════════════ sahifalash ══════════════════════════════ */

test("`figure`/`formula` atom: bo'linmaydi va o'zidan keyingi matnga bog'lanmaydi; UDK/sarlavha/mualliflar birga", () => {
  const items = docToFlow(sampleArticleDoc(META));
  const fig = items.findIndex((it) => it.type === "figure");
  assert.ok(fig > 0);
  // Har band 100 px, chegara 250 — rasm (300 px) o'z varag'ida, keyingi paragraf bilan zanjirlanmaydi.
  const heights = items.map((it) => (it.type === "figure" ? 300 : 100));
  const pages = packPages(items, heights, 350, { abstractBreak: false });
  const figPage = pages.find((pg) => pg.some((it) => it.type === "figure"))!;
  assert.ok(figPage.length === 1, "rasm o'z varag'ida yolg'iz bo'lishi kerak (300 + 100 > 350)");
  /*
   * UDK + sarlavha + mualliflar + birinchi annotatsiya — keep-with-next
   * zanjiri (4 × 100 = 400). Chegara 450: zanjir sig'adi va to'rtalasi
   * birinchi varaqda; keyingi band (2-annotatsiya) sig'maydi va yangi
   * varaqqa o'tadi — UDK yoki sarlavha yolg'iz qolmaydi.
   */
  const small = items.map(() => 100);
  const p2 = packPages(items, small, 450, { abstractBreak: false });
  assert.deepEqual(
    p2[0].map((it) => it.type),
    ["udk", "articleTitle", "authors", "abstract"],
  );
});

test("annotatsiya yangi varaqdan BOSHLANMAYDI (`abstractBreak: false`); eski hujjatlarda boshlanadi", () => {
  const items = docToFlow(sampleArticleDoc(META));
  const heights = items.map(() => 50);
  const article = packPages(items, heights, 10_000, { abstractBreak: false });
  assert.equal(article.length, 1, "maqola bosh bloki bitta varaqda oqishi kerak");
  const legacy = packPages(items, heights, 10_000);
  assert.equal(legacy.length, 2, "standart rejimda annotatsiya yangi varaqdan");
});

test("ko'ruvchi varag'i `.word-article` sinfi va profil o'zgaruvchilari bilan; eski hujjatda yo'q", () => {
  const out = html(sampleArticleDoc(META));
  assert.ok(out.includes("word-article"));
  assert.ok(out.includes("--doc-table-size:10pt"), "oak jadval shrifti 10 pt");
  // SSR da varaqlar hali yo'q (sahifalash `useLayoutEffect` da) — o'lchov daraxti kengligi chegaradan.
  assert.ok(out.includes("width:165mm"), "oak chegaralari (210 − 3 − 1.5)");
  const legacy: AcademicDoc = { ...sampleArticleDoc(META), article: undefined };
  const lo = html(legacy);
  assert.ok(!lo.includes("word-article"));
  assert.ok(!lo.includes("--doc-table-size"));
});
