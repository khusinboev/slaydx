import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import JSZip from "jszip";
import { WordViewer } from "../../components/viewers/WordViewer.tsx";
import { TitlePage } from "../../components/viewers/TitlePage.tsx";
import { renderDocx } from "../../lib/generation/render-docx.ts";
import { planWork } from "../../lib/generation/work/layout.ts";
import { sampleWorkDoc } from "../../lib/generation/work/samples.ts";
import { titleModel } from "../../lib/generation/title-model.ts";
import type { SubjectProfileId, WorkGenreId, WorkKindId } from "../../lib/generation/work/types.ts";
import type { AcademicDoc, DocMeta } from "../../lib/generation/types.ts";

/**
 * «KO'RDIM = OLDIM» — talaba ishi (AUDIT-19 WP-C).
 *
 * Sayt ko'ruvchisi chiqargan MATN TUGUNLARI ketma-ketligi DOCX `<w:t>`
 * ketma-ketligiga AYNAN teng bo'lishi kerak — ikkalasi ham `planWork`
 * dan chizadi.
 *
 * IKKI ISTISNO, ikkalasi ham TUZILMAVIY:
 *   1. TITUL — ko'ruvchida alohida komponent (`TitlePage`), o'lchov
 *      daraxtida esa bo'sh joy egallaydi. Shuning uchun u ALOHIDA
 *      solishtiriladi (pastdagi «titul» sinovi), tana esa MUNDARIJADAN
 *      boshlab taqqoslanadi.
 *   2. FORMULA — ko'ruvchida KaTeX HTML, DOCX da OMML `<m:t>`; ular
 *      taqqoslanmaydi, faqat raqami «(2.1)».
 *
 * `renderToStaticMarkup(WordViewer)` SSR da sahifalash hali yo'q
 * (`useLayoutEffect` ishlamaydi) — chiziladigan narsa O'LCHOV daraxti
 * (`measureRef`): unda BARCHA bandlar tartib bilan turadi.
 */

const META: DocMeta = {
  topic: "Oliy ta’limda adaptiv o‘qitish tizimlarini joriy etish",
  workLabel: "Kurs ishi",
  language: "uz",
  toolId: "coursework",
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

/** `<span … data-formula …>…</span>` (KaTeX) ni butunlay olib tashlaydi. */
function stripFormulas(html: string): string {
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

function htmlTexts(html: string): string[] {
  return (
    stripFormulas(html)
      .replace(/<!--[\s\S]*?-->/g, "")
      .split(/<[^>]*>/)
      .map((t) => decode(t).trim())
      /*
       * «•» — ro'yxat BELGISI, matn emas: ko'ruvchi uni `.word-li` ichida
       * `<span>` bilan chizadi, DOCX esa `<w:numPr>` ro'yxat markerini
       * qo'yadi va uning matn tuguni bo'lmaydi. Belgining O'ZI ikkala
       * chiqishda ham bor, shuning uchun bu paritet buzilishi emas.
       */
      .filter((t) => t && t !== "•")
  );
}

function docxTexts(xml: string): string[] {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((m) => decode(m[1]).trim())
    .filter((t) => t && t !== "\t");
}

async function docxOf(doc: AcademicDoc) {
  const zip = await JSZip.loadAsync(Buffer.from(await renderDocx(doc)));
  return zip.file("word/document.xml")!.async("string");
}

/** O'lchov daraxti — barcha bandlar tartib bilan. */
function viewerHtml(doc: AcademicDoc): string {
  const html = renderToStaticMarkup(h(WordViewer, { doc }));
  const i = html.lastIndexOf('<div aria-hidden="true"');
  assert.ok(i > 0 && html.slice(i, i + 400).includes("-left-[12000px]"), "o'lchov daraxti topilmadi");
  return html.slice(i);
}

/** TITULDAN keyingi qism — mundarija sarlavhasidan boshlab. */
function fromToc(list: string[]): string[] {
  const i = list.indexOf("MUNDARIJA");
  assert.ok(i >= 0, `«MUNDARIJA» topilmadi: ${list.slice(0, 12).join(" | ")}`);
  return list.slice(i);
}

const COMBOS: [WorkGenreId, WorkKindId, SubjectProfileId][] = [
  ["coursework", "theory", "humanities"],
  ["coursework", "applied", "technical"],
  ["coursework", "project", "economic"],
  ["referat", "informative", "humanities"],
  ["referat", "analytic", "legal"],
  ["independent", "written", "natural"],
];

function docFor(genre: WorkGenreId, kind: WorkKindId, subject: SubjectProfileId, png = false): AcademicDoc {
  const toolId = genre === "coursework" ? "coursework" : genre === "referat" ? "referat" : "mustaqil-ish";
  const workLabel = genre === "coursework" ? "Kurs ishi" : genre === "referat" ? "Referat" : "Mustaqil ish";
  return sampleWorkDoc({ ...META, toolId, workLabel } as DocMeta, { genre, kind, subject, ...(png ? { png: PNG_URL } : {}) });
}

/* ══════════════════════════════ paritet ══════════════════════════════ */

for (const [genre, kind, subject] of COMBOS) {
  test(`${genre}/${kind} × ${subject}: ko'ruvchi va DOCX matni bir xil`, async () => {
    const doc = docFor(genre, kind, subject);
    const fromDocx = fromToc(docxTexts(await docxOf(doc)));
    const fromView = fromToc(htmlTexts(viewerHtml(doc)));
    assert.ok(fromDocx.length > 40, `sinov ma'noli bo'lishi uchun matn tugunlari ko'p bo'lsin (${fromDocx.length})`);
    assert.deepEqual(fromView, fromDocx);
  });
}

test("titul: `TitlePage` va DOCX tituli BITTA modeldan — matn to'plami bir xil", async () => {
  const doc = docFor("coursework", "theory", "humanities");
  const html = renderToStaticMarkup(h(TitlePage, { title: titleModel(doc) }));
  /*
   * BOSH HARF titulda CSS orqali qo'yiladi (`uppercase` sinfi), DOCX da
   * esa matnning O'ZI kattalashtiriladi — ko'ринish bir xil, matn tuguni
   * turlicha. Shuning uchun bu yerda taqqoslash HARF REGISTRIDAN qat'i
   * nazar; tanada bunday farq YO'Q (u yerda registrni `planWork` beradi
   * va yuqoridagi `deepEqual` sinovlari uni aynan qulflaydi).
   */
  const view = htmlTexts(html).map((t) => t.toUpperCase());
  const docx = docxTexts(await docxOf(doc));
  // DOCX titul — birinchi «MUNDARIJA» gacha bo'lgan qism.
  const titleDocx = docx.slice(0, docx.indexOf("MUNDARIJA")).filter((t) => t !== "____________");
  assert.ok(titleDocx.length >= 9, `titulda kamida 9 qator kutilgan: ${titleDocx.length}`);
  for (const line of titleDocx) {
    const up = line.toUpperCase();
    assert.ok(
      view.some((v) => v === up || v.includes(up)),
      `DOCX tituldagi «${line}» ko'ruvchida yo'q`,
    );
  }
  for (const needle of ["KURS ISHI", "«TA’LIMDA AXBOROT TEXNOLOGIYALARI» FANIDAN", "BAJARDI", "TEKSHIRDI", "MAVZU:"]) {
    assert.ok(view.join(" ").includes(needle), `ko'ruvchi titulida «${needle}» yo'q`);
    assert.ok(titleDocx.join(" ").toUpperCase().includes(needle), `DOCX titulida «${needle}» yo'q`);
  }
});

test("`<img>` bor ⇔ `<w:drawing>` bor (PNG fikstura bilan va usiz)", async () => {
  for (const withPng of [false, true]) {
    const doc = docFor("coursework", "applied", "technical", withPng);
    const xml = await docxOf(doc);
    const html = viewerHtml(doc);
    const inDocx = xml.includes("<w:drawing>");
    const inView = /<img\b/.test(html);
    assert.equal(inView, inDocx, `PNG=${withPng}: ko'ruvchi ${inView}, DOCX ${inDocx}`);
    assert.equal(inDocx, withPng, `PNG=${withPng}: drawing kutilgani bilan mos emas`);
    assert.deepEqual(fromToc(htmlTexts(html)), fromToc(docxTexts(xml)));
  }
});

test("raqamlar ikkala tomonda bir xil: 1.1-jadval, 2.1-rasm, (2.1), [6, 45-b.], 1-ILOVA", async () => {
  const doc = docFor("coursework", "theory", "humanities");
  const plan = planWork(doc);
  const xml = await docxOf(doc);
  const html = viewerHtml(doc);
  for (const needle of ["1.1-jadval", "2.1-rasm.", "(2.1)", "45-b.]", "1-ILOVA", "1-BOB.", "2.2."]) {
    assert.ok(docxTexts(xml).some((t) => t.includes(needle)), `DOCX da «${needle}» yo'q`);
    assert.ok(htmlTexts(html).some((t) => t.includes(needle)), `ko'ruvchida «${needle}» yo'q`);
  }
  assert.equal(plan.numbers.tables.t1, "1.1");
  assert.equal(plan.numbers.figures.f1, "2.1");
});

test("referatda raqamlar TEKIS — «1-jadval»/«1-rasm», ikkala tomonda", async () => {
  const doc = docFor("referat", "informative", "humanities");
  const xml = await docxOf(doc);
  const html = viewerHtml(doc);
  for (const needle of ["1-jadval", "1-rasm."]) {
    assert.ok(docxTexts(xml).some((t) => t.includes(needle)), `DOCX da «${needle}» yo'q`);
    assert.ok(htmlTexts(html).some((t) => t.includes(needle)), `ko'ruvchida «${needle}» yo'q`);
  }
  assert.ok(!docxTexts(xml).some((t) => t.includes("1.1-jadval")), "referatda bob raqamli jadval chiqdi");
});

test("ko'ruvchi varag'i profil chegarasi bilan: gumanitar o'ng 1 sm (o'lchov kengligi 170 mm), texnik 1,5 sm (165 mm)", () => {
  const hum = renderToStaticMarkup(h(WordViewer, { doc: docFor("coursework", "theory", "humanities") }));
  const tech = renderToStaticMarkup(h(WordViewer, { doc: docFor("coursework", "applied", "technical") }));
  assert.ok(hum.includes("width:170mm"), "gumanitar: 210−3−1 = 170 mm bo'lishi kerak");
  assert.ok(tech.includes("width:165mm"), "texnik: 210−3−1.5 = 165 mm bo'lishi kerak");
  for (const html of [hum, tech]) {
    assert.ok(html.includes("font-size:14pt"), "14 pt yo'q");
    assert.ok(html.includes("--doc-table-size:12pt"), "jadval 12 pt emas");
    assert.ok(html.includes("--doc-small:10pt"), "«Manba:» 10 pt emas");
    assert.ok(html.includes("--doc-h1-align:center"), "sarlavha markazda emas");
  }
});

test("paritet REJADAN keladi: oqimdan bitta band tushib qolsa sinov qizil bo'ladi", async () => {
  const doc = docFor("coursework", "theory", "humanities");
  const xml = await docxOf(doc);
  const full = fromToc(htmlTexts(viewerHtml(doc)));
  assert.deepEqual(full, fromToc(docxTexts(xml)));
  /*
   * Mutatsiya: ko'ruvchi oqimidan «Manba:» qatori tushib qolsa (ya'ni
   * `workFlow` `table-source` bandini bermasa) — `deepEqual` shu farqni
   * KO'RSATISHI kerak. Sinov shu farqni SUN'IY qilib tekshiradi, chunki
   * aynan bunday «bitta band jimgina yo'qoldi» nuqsoni AUDIT-5/6 da bir
   * necha marta topilgan.
   */
  const broken = full.filter((t) => !t.startsWith("Manba:"));
  assert.notDeepEqual(broken, fromToc(docxTexts(xml)), "band tushib qolsa ham sinov yashil qoldi");
});
