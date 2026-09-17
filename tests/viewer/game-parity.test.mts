import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import JSZip from "jszip";
import { WordViewer } from "../../components/viewers/WordViewer.tsx";
import { renderDocx } from "../../lib/generation/render-docx.ts";
import { GAME_MARGINS_CM, cardCellMm, planGame } from "../../lib/generation/games/layout.ts";
import { sampleGameDoc } from "../../lib/generation/games/samples.ts";
import { gameProfile } from "../../lib/generation/docx-profile.ts";
import { GAME_KINDS, type GameKind } from "../../lib/generation/games/types.ts";
import { gameFlow, type FlowItem } from "../../lib/viewers/flow.ts";
import { packPages } from "../../lib/viewers/paginate.ts";
import type { AcademicDoc } from "../../lib/generation/types.ts";

/**
 * «KO'RDIM = OLDIM» — bosma o'yinlar (AUDIT-21 WP-B).
 *
 * Sayt ko'ruvchisi chiqargan MATN TUGUNLARI ketma-ketligi DOCX `<w:t>`
 * ketma-ketligiga AYNAN teng bo'lishi kerak — ikkalasi ham `planGame`
 * dan chizadi. Bu oilada paritetning ISTISNOSI YO'Q: titul beti yo'q,
 * formula yo'q, iqtibos yo'q.
 *
 * Kartalarda paritet oddiy «bir xil matn» dan ko'ra qattiqroq: katak
 * o'lchami ham ikkala tomonda BIR XIL millimetrda bo'lishi kerak,
 * chunki foydalanuvchi ekranda ko'rgan kartani kesib oladi.
 *
 * Mutatsiyalar (qizardi):
 *   1. `gameFlow` varaq shapkasini tashlab ketdi — paritet qizardi;
 *   2. ko'ruvchi panjarani foizda chizdi — «katak mm da» testi;
 *   3. `packPages` karta varag'i uchun uzilish qo'ymadi — «har varaq
 *      o'z betida» testi;
 *   4. orqa bet oynasi ko'ruvchida qo'llanmadi — paritet qizardi.
 */

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

function htmlTexts(html: string): string[] {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/<[^>]*>/)
    .map((t) => decode(t).trim())
    .filter((t) => t && t !== "•");
}

function docxTexts(xml: string): string[] {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((m) => decode(m[1]).trim())
    .filter((t) => t && t !== "\t");
}

async function docxOf(doc: AcademicDoc): Promise<string> {
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

/* ══════════════════════════ to'liq paritet ══════════════════════════ */

for (const kind of GAME_KINDS) {
  test(`${kind}: ko'ruvchi va DOCX matni AYNAN bir xil`, async () => {
    const doc = sampleGameDoc(kind);
    const fromDocx = docxTexts(await docxOf(doc));
    const fromView = htmlTexts(viewerHtml(doc));
    assert.ok(fromDocx.length > 15, `sinov ma'noli bo'lishi uchun matn tugunlari ko'p bo'lsin (${fromDocx.length})`);
    assert.deepEqual(fromView, fromDocx);
  });
}

test("uch tilda ham paritet buzilmaydi (yorliqlar ikkala tomonda BITTA manbadan)", async () => {
  for (const language of ["ru", "en"]) {
    for (const kind of GAME_KINDS) {
      const doc = sampleGameDoc(kind, { language });
      assert.deepEqual(htmlTexts(viewerHtml(doc)), docxTexts(await docxOf(doc)), `${language}/${kind}`);
    }
  }
});

/* ══════════════════════════ karta panjarasi ══════════════════════════ */

test("ko'ruvchi panjarani MILLIMETRDA chizadi — DOCX katagi bilan bitta manbadan", () => {
  const cell = cardCellMm();
  const html = renderToStaticMarkup(h(WordViewer, { doc: sampleGameDoc("flashcards") }));
  assert.ok(html.includes(`width:${cell.wMm}mm`), `katak kengligi ${cell.wMm}mm chizilmadi`);
  assert.ok(html.includes(`height:${cell.hMm}mm`), `katak balandligi ${cell.hMm}mm chizilmadi`);
  // Kesish chizig'i — nuqtali chegara (DOCX da ham `dashed`).
  assert.ok(html.includes("dashed"), "kesish chizig'i chizilmadi");
  // Foizli kenglik panjarani printerda boshqa o'lchamga aylantirardi.
  assert.ok(!/width:\d+%[^"]*;height:\d+(\.\d+)?mm/.test(html), "katak foizda chizilgan");
});

test("ORQA bet ko'ruvchida ham OYNALI (matn tartibi DOCX bilan bir xil)", () => {
  const t = htmlTexts(viewerHtml(sampleGameDoc("flashcards")));
  assert.ok(t.indexOf("Fotosintez") < t.indexOf("Xlorofill"), "old betda tartib buzilgan");
  const defChlorophyll = t.findIndex((x) => x.startsWith("Xloroplastdagi yashil pigment"));
  const defPhoto = t.findIndex((x) => x.startsWith("Yashil o‘simlik bargida"));
  assert.ok(defChlorophyll >= 0 && defPhoto >= 0, "ta'riflar ko'ruvchida yo'q");
  assert.ok(defChlorophyll < defPhoto, "orqa bet oynalanmagan");
});

test("HAR VARAQ o'z betida: `packPages` karta bandiga majburiy uzilish qo'yadi", () => {
  const items = gameFlow(planGame(sampleGameDoc("flashcards")));
  const sheets = items.filter((i): i is Extract<FlowItem, { type: "game-cards" }> => i.type === "game-cards");
  assert.equal(sheets.length, 4, "10 karta → 4 varaq bandi");
  /*
   * Balandliklar ATAYLAB kichik berilgan (hammasi bitta betga
   * «sig'adi»): uzilish faqat `pageBreak` bayrog'idan kelishi kerak,
   * o'lchov tasodifidan emas.
   */
  const pages = packPages(items, items.map(() => 10), 2000);
  assert.equal(pages.length, 4, `har varaq o'z betida bo'lishi kerak: ${pages.length}`);
  for (const [i, pg] of pages.entries()) {
    assert.equal(pg.length, 1, `${i + 1}-betda bitta band bo'lishi kerak`);
    assert.equal(pg[0].type, "game-cards");
  }
});

test("varaq shapkasi ko'ruvchida ham HAR betda (mavzu, varaq raqami, yuz, ko'rsatma)", () => {
  const t = htmlTexts(viewerHtml(sampleGameDoc("flashcards")));
  const hint = t.filter((x) => x.startsWith("Ikki tomonlama chop eting"));
  assert.equal(hint.length, 4, "ko'rsatma har betda bo'lishi kerak");
  assert.ok(t.some((x) => x.includes("1/2-varaq") && x.includes("old yuzlar")));
  assert.ok(t.some((x) => x.includes("2/2-varaq") && x.includes("orqa yuzlar")));
  // Hujjat sarlavhasi kartalar betida YO'Q (old/orqa siljimasin).
  assert.ok(!t.includes("FLESH KARTALAR"), "kartalar betiga hujjat sarlavhasi tushdi");
});

/* ══════════════════════════ varaq ══════════════════════════ */

test("varaq chekinishi, shrifti va yo'nalishi DOCX profili bilan BITTA manbadan", () => {
  for (const kind of GAME_KINDS as readonly GameKind[]) {
    const plan = planGame(sampleGameDoc(kind));
    const p = gameProfile(kind);
    const m = plan.page.marginsCm;
    assert.deepEqual(m, GAME_MARGINS_CM[kind]);
    assert.equal(p.type.size, plan.page.sizePt * 2, `${kind}: shrift o'lchami ajralib ketdi`);
    assert.equal(p.type.line, Math.round(240 * plan.page.line), `${kind}: qator oralig'i ajralib ketdi`);
    assert.equal(p.page.margin.left, Math.round(m.left * 567), `${kind}: chap chegara ajralib ketdi`);
    assert.equal(p.page.landscape, plan.landscape, `${kind}: yo'nalish ajralib ketdi`);
    assert.equal(plan.landscape, false);

    /*
     * SSR da sahifalash hali yo'q (`useLayoutEffect` ishlamaydi), ya'ni
     * varaq kartalari chizilmaydi — lekin O'LCHOV daraxti chiziladi va
     * uning kengligi/shrifti aynan rejadan keladi (`teacher-parity`
     * naqshi). Chegara buzilsa matn varaqqa noto'g'ri joylanardi.
     */
    const html = renderToStaticMarkup(h(WordViewer, { doc: sampleGameDoc(kind) }));
    assert.ok(html.includes(`font-size:${plan.page.sizePt}pt`), `${kind}: ko'ruvchi shrifti rejadan olinmadi`);
    assert.ok(html.includes(`--doc-table-size:${plan.page.tableSizePt}pt`), `${kind}: jadval shrifti rejadan olinmadi`);
    assert.ok(html.includes(`--doc-small:${plan.page.smallPt}pt`), `${kind}: kichik shrift rejadan olinmadi`);
    // Portret o'lchov kengligi — varaq eni minus chegaralar.
    assert.ok(html.includes(`width:${210 - (m.left + m.right) * 10}mm`), `${kind}: o'lchov kengligi noto'g'ri (chegara rejadan olinmadi)`);
  }
});

test("titul beti YO'Q va TAHRIR o'chiq (karta panjarasi maketning O'ZI)", () => {
  for (const kind of GAME_KINDS as readonly GameKind[]) {
    assert.equal(gameProfile(kind).titlePage, "none", `${kind}: DOCX titul beti o'chirilmagan`);
    const html = renderToStaticMarkup(h(WordViewer, { doc: sampleGameDoc(kind), gen: { id: "g1", type: kind } }));
    assert.ok(!html.includes('class="h-[40mm]"'), `${kind}: ko'ruvchi titul o'rnini chizdi`);
    assert.ok(!html.includes("Tahrirlash"), `${kind}: o'yin hujjatida tahrir tugmasi bo'lmasligi kerak`);
    assert.ok(!html.includes("data-path"), `${kind}: tahrir nishonlari chizilmasin`);
  }
});

test("krossvordda to'r rasmi CHOP ETILADIGAN kenglikda (spec `widthMm`)", () => {
  const plan = planGame(sampleGameDoc("crossword"));
  const fig = plan.body.find((b) => b.k === "figure");
  assert.ok(fig?.k === "figure" && fig.figure?.spec.kind === "svg", "to'r rasmi spetsifikatsiyasi yo'q");
  const widthMm = fig.k === "figure" && fig.figure!.spec.kind === "svg" ? fig.figure!.spec.widthMm : 0;
  assert.ok(widthMm > 0);
  const items = gameFlow(plan);
  const flowFig = items.find((i): i is Extract<FlowItem, { type: "figure" }> => i.type === "figure");
  assert.equal(flowFig?.widthMm, widthMm, "kenglik oqim bandiga uzatilmadi — ko'ruvchi varaq eniga cho'zib yuborardi");
});

/* ══════════════════════════ interaktiv o'yinlar (AUDIT-22 WP-D) ══════════════════════════ */

/**
 * Yuqoridagi to'liq paritet sinovi `GAME_KINDS` bo'ylab yuradi, ya'ni
 * saralash va tinglash MATNI allaqachon tenglashtirilgan. Bu ikki test
 * esa maketning MA'NOSINI qulflaydi: bo'sh jadval katagida MATN YO'Q
 * (ya'ni paritet uni ko'rmaydi) va eshitiladigan so'z bosma varaqqa
 * tushmasligi kerak — ikkalasi ham faqat TUZILMA darajasida ko'rinadi.
 */

test("saralash: BO'SH jadval katagi ikkala tomonda ham chegarali va matnsiz", async () => {
  const doc = sampleGameDoc("sorting");
  const cats = doc.game!.sorting!.categories;
  const html = renderToStaticMarkup(h(WordViewer, { doc }));
  const xml = await docxOf(doc);

  // Ko'ruvchi chegarali jadval chizadi (krossvord savollari chegarasiz).
  assert.ok(html.includes("1px solid #999999"), "saralash jadvali ko'ruvchida chegarasiz chiqdi");
  // DOCX da ham chegara bor.
  assert.match(xml, /w:val="single"/, "DOCX jadvali chegarasiz chiqdi");

  // Toifa nomi IKKALA tomonda ham AYNI marta uchraydi (varaq + javob kaliti).
  for (const c of cats) {
    const inView = htmlTexts(viewerHtml(doc)).filter((t) => t === c.name).length;
    const inDocx = docxTexts(xml).filter((t) => t === c.name).length;
    assert.equal(inView, inDocx, `«${c.name}» ikki tomonda turlicha marta chizildi`);
    assert.equal(inView, 2, `«${c.name}» varaqda ham, javob kalitida ham bo'lishi kerak`);
  }
  // Element javob kalitida BOR, varaqdagi jadvalda esa faqat aralash ro'yxatda.
  const first = cats[0].items[0];
  assert.equal(htmlTexts(viewerHtml(doc)).filter((t) => t === first).length, 2, "element aralash ro'yxatda + javob kalitida bo'lishi kerak");
});

test("tinglash: eshitiladigan so'z faqat JAVOB KALITIDA (DOCX da ham, ekranda ham)", async () => {
  const doc = sampleGameDoc("listening");
  const items = doc.game!.listening!.items;
  const fromDocx = docxTexts(await docxOf(doc));
  const fromView = htmlTexts(viewerHtml(doc));
  assert.deepEqual(fromView, fromDocx, "paritet buzildi");

  const lines = fromDocx.filter((t) => /^\d+\. /.test(t));
  assert.ok(lines.length >= items.length * 2, `topshiriq + javob qatorlari: ${lines.length}`);
  for (const it of items) {
    const withWord = lines.filter((t) => t.includes(it.text));
    assert.equal(withWord.length, 1, `«${it.text}» ${withWord.length} marta chizildi — u FAQAT javob kalitida bo'lishi kerak`);
    assert.ok(withWord[0].includes(it.options[it.answer]), "javob kalitida tarjima yo'q");
  }
});
