import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import JSZip from "jszip";
import { WordViewer } from "../../components/viewers/WordViewer.tsx";
import { renderDocx } from "../../lib/generation/render-docx.ts";
import { planArticle } from "../../lib/generation/article/layout.ts";
import { sampleArticleDoc } from "../../lib/generation/article/samples.ts";
import type { ArticleTypeId, PublicationProfileId } from "../../lib/generation/article/types.ts";
import type { AcademicDoc, DocMeta } from "../../lib/generation/types.ts";

/**
 * «KO'RDIM = OLDIM» — maqola (Maqola 2, AUDIT-17 WP2).
 *
 * Sayt ko'ruvchisi chiqargan MATN TUGUNLARI ketma-ketligi DOCX `<w:t>`
 * ketma-ketligiga AYNAN teng bo'lishi kerak — ikkalasi ham `planArticle`
 * dan chizadi. Formula matni ISTISNO: ko'ruvchida KaTeX HTML (`data-formula`
 * tuguni), DOCX da OMML `<m:t>` — ular taqqoslanmaydi, faqat raqami «(1)».
 *
 * `renderToStaticMarkup(WordViewer)` SSR da sahifalash hali yo'q
 * (`useLayoutEffect` ishlamaydi) — chiziladigan narsa O'LCHOV daraxti
 * (`measureRef`): unda BARCHA bandlar tartib bilan turadi, ya'ni matn
 * ketma-ketligini aynan shu yerdan olamiz.
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

function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, c) => String.fromCodePoint(parseInt(c, 16)))
    .replace(/&#(\d+);/g, (_, c) => String.fromCodePoint(Number(c)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Formula tugunini (KaTeX HTML) butunlay olib tashlaydi. */
function stripFormulas(html: string): string {
  // `<span … data-formula …>…</span>` — ichida ichma-ich spanlar; balanslab kesamiz.
  let out = "";
  let i = 0;
  while (i < html.length) {
    const start = html.indexOf("data-formula", i);
    if (start < 0) {
      out += html.slice(i);
      break;
    }
    const open = html.lastIndexOf("<span", start);
    out += html.slice(i, open);
    // Balans: `<span` +1, `</span>` −1.
    let depth = 0;
    let j = open;
    const re = /<span\b|<\/span>/g;
    re.lastIndex = open;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      depth += m[0] === "</span>" ? -1 : 1;
      if (depth === 0) {
        j = m.index + m[0].length;
        break;
      }
    }
    i = j;
  }
  return out;
}

/** HTML dagi ko'rinadigan matn tugunlari (teglar tashqarisi), formula tashlab. */
function htmlTexts(html: string): string[] {
  return stripFormulas(html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/<[^>]*>/)
    .map((t) => decode(t).trim())
    .filter(Boolean);
}

function docxTexts(xml: string): string[] {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((m) => decode(m[1]).trim())
    // Tab belgisi (formula maketi) — ko'rinadigan matn emas.
    .filter((t) => t && t !== "\t");
}

async function docxOf(doc: AcademicDoc) {
  const zip = await JSZip.loadAsync(Buffer.from(await renderDocx(doc)));
  return zip.file("word/document.xml")!.async("string");
}

/** O'lchov daraxti — barcha bandlar tartib bilan. */
function viewerHtml(doc: AcademicDoc): string {
  const html = renderToStaticMarkup(h(WordViewer, { doc }));
  // O'lchov daraxti — `-left-[12000px]` sinfli oxirgi `aria-hidden` div.
  const i = html.lastIndexOf('<div aria-hidden="true"');
  assert.ok(i > 0 && html.slice(i, i + 400).includes("-left-[12000px]"), "o'lchov daraxti topilmadi");
  return html.slice(i);
}

const COMBOS: [ArticleTypeId, PublicationProfileId][] = [
  ["imrad_oak", "oak"],
  ["imrad_classic", "apa"],
  ["three_part_uz", "university"],
  ["elsevier_ieee_style", "ieee"],
  ["conference_thesis", "conference"],
  ["review_systematic", "apa"],
  ["analytical", "oak"],
  ["methodical", "ieee"],
];

function docFor(type: ArticleTypeId, profile: PublicationProfileId, withPng = false): AcademicDoc {
  const doc = sampleArticleDoc(META, { type, profile });
  if (withPng) doc.article!.figures = doc.article!.figures.map((f) => ({ ...f, url: PNG_URL }));
  return doc;
}

/* ══════════════════════════════ paritet ══════════════════════════════ */

for (const [type, profile] of COMBOS) {
  test(`${type} × ${profile}: ko'ruvchi va DOCX matni bir xil`, async () => {
    const doc = docFor(type, profile);
    const fromDocx = docxTexts(await docxOf(doc));
    const fromView = htmlTexts(viewerHtml(doc));
    assert.ok(fromDocx.length > 25, `sinov ma'noli bo'lishi uchun matn tugunlari ko'p bo'lsin (${fromDocx.length})`);
    assert.deepEqual(fromView, fromDocx);
  });
}

test("`<img>` bor ⇔ `<w:drawing>` bor (PNG fikstura bilan va usiz)", async () => {
  for (const withPng of [false, true]) {
    const doc = docFor("imrad_oak", "oak", withPng);
    const xml = await docxOf(doc);
    const html = viewerHtml(doc);
    const inDocx = xml.includes("<w:drawing>");
    const inView = /<img\b/.test(html);
    assert.equal(inView, inDocx, `PNG=${withPng}: ko'ruvchi ${inView}, DOCX ${inDocx}`);
    assert.equal(inDocx, withPng, `PNG=${withPng}: drawing kutilgani bilan mos emas`);
    // PNG bo'lsa ham matn ketma-ketligi o'zgarmaydi (o'rinbosar matni tushadi, sarlavha qoladi).
    assert.deepEqual(htmlTexts(html), docxTexts(xml));
  }
});

test("raqamlar ikkala tomonda bir xil: 1-rasm, 1-jadval, (1), [1, 2]", async () => {
  const doc = docFor("imrad_oak", "oak");
  const plan = planArticle(doc);
  const xml = await docxOf(doc);
  const html = viewerHtml(doc);
  for (const needle of ["1-rasm.", "1-jadval.", "(1)", "[1, 2]", "[1]", "[2]", "[3]"]) {
    assert.ok(docxTexts(xml).some((t) => t.includes(needle)), `DOCX da «${needle}» yo'q`);
    assert.ok(htmlTexts(html).some((t) => t.includes(needle)), `ko'ruvchida «${needle}» yo'q`);
  }
  assert.equal(plan.numbers.figures.f1, "1");
  assert.equal(plan.numbers.tables.t1, "1");
});

test("o'rinbosar matni ikkala tomonda: «[1-rasm — sxema]»", async () => {
  const doc = docFor("imrad_oak", "oak");
  const xml = await docxOf(doc);
  assert.ok(docxTexts(xml).includes("[1-rasm — sxema]"));
  assert.ok(htmlTexts(viewerHtml(doc)).includes("[1-rasm — sxema]"));
});

test("ko'ruvchi varag'i profil chegarasi/shrifti bilan (oak 3 sm chap, 14 pt; ieee 2 sm, 12 pt)", () => {
  const oak = renderToStaticMarkup(h(WordViewer, { doc: docFor("imrad_oak", "oak") }));
  const ieee = renderToStaticMarkup(h(WordViewer, { doc: docFor("elsevier_ieee_style", "ieee") }));
  assert.ok(oak.includes("font-size:14pt"), "oak: 14 pt yo'q");
  assert.ok(oak.includes("width:165mm"), "oak: o'lchov kengligi 210−3−1.5 = 165 mm bo'lishi kerak");
  assert.ok(ieee.includes("font-size:12pt"), "ieee: 12 pt yo'q");
  assert.ok(ieee.includes("width:170mm"), "ieee: o'lchov kengligi 210−2−2 = 170 mm bo'lishi kerak");
  assert.ok(ieee.includes("--doc-h1-align:left"), "ieee: sarlavha chapda bo'lishi kerak");
  assert.ok(oak.includes("--doc-h1-align:center"), "oak: sarlavha markazda bo'lishi kerak");
});
