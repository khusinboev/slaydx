import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import JSZip from "jszip";
import { WordViewer } from "../../components/viewers/WordViewer.tsx";
import { renderDocx } from "../../lib/generation/render-docx.ts";
import { planTeacher, TEACHER_MARGINS_CM } from "../../lib/generation/teacher/layout.ts";
import { LANDSCAPE, sheetMetrics } from "../../lib/viewers/metrics.ts";
import { sampleTeacherDoc } from "../../lib/generation/teacher/samples.ts";
import { TEACHER_KINDS, type TeacherKind } from "../../lib/generation/teacher/types.ts";
import { teacherProfile } from "../../lib/generation/docx-profile.ts";
import type { AcademicDoc } from "../../lib/generation/types.ts";

/**
 * «KO'RDIM = OLDIM» — o'qituvchi hujjatlari (AUDIT-20 WP-C).
 *
 * Sayt ko'ruvchisi chiqargan MATN TUGUNLARI ketma-ketligi DOCX `<w:t>`
 * ketma-ketligiga AYNAN teng bo'lishi kerak — ikkalasi ham `planTeacher`
 * dan chizadi. Bu oilada paritetning ISTISNOSI YO'Q: titul beti yo'q
 * (rasmiy shakl), formula yo'q, iqtibos yo'q — ya'ni butun hujjat
 * boshidan oxirigacha solishtiriladi.
 *
 * `renderToStaticMarkup(WordViewer)` SSR da sahifalash hali yo'q
 * (`useLayoutEffect` ishlamaydi) — chiziladigan narsa O'LCHOV daraxti
 * (`measureRef`): unda BARCHA bandlar tartib bilan turadi.
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
  return (
    html
      .replace(/<!--[\s\S]*?-->/g, "")
      .split(/<[^>]*>/)
      .map((t) => decode(t).trim())
      /*
       * «•» — ro'yxat BELGISI, matn emas: ko'ruvchi uni `.word-li`
       * ichida `<span>` bilan chizadi, DOCX esa `<w:numPr>` markerini
       * qo'yadi va uning matn tuguni bo'lmaydi.
       */
      .filter((t) => t && t !== "•")
  );
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

for (const kind of TEACHER_KINDS) {
  test(`${kind}: ko'ruvchi va DOCX matni AYNAN bir xil`, async () => {
    const doc = sampleTeacherDoc(kind);
    const fromDocx = docxTexts(await docxOf(doc));
    const fromView = htmlTexts(viewerHtml(doc));
    assert.ok(fromDocx.length > 20, `sinov ma'noli bo'lishi uchun matn tugunlari ko'p bo'lsin (${fromDocx.length})`);
    assert.deepEqual(fromView, fromDocx);
  });
}

test("uch tilda ham paritet buzilmaydi (yorliqlar ikkala tomonda bitta manbadan)", async () => {
  for (const language of ["ru", "en"]) {
    for (const kind of ["lesson", "map", "glossary"] as TeacherKind[]) {
      const doc = sampleTeacherDoc(kind, { language });
      assert.deepEqual(htmlTexts(viewerHtml(doc)), docxTexts(await docxOf(doc)), `${language}/${kind}`);
    }
  }
});

/* ══════════════════════════ shapka ══════════════════════════ */

test("shapka ko'ruvchida ham bor: «Tasdiqlayman», muassasa, «Fan:», «Tuzuvchi:»", () => {
  const t = htmlTexts(viewerHtml(sampleTeacherDoc("lesson")));
  assert.equal(t[0], "Tasdiqlayman", "«Tasdiqlayman» birinchi qator emas");
  assert.ok(t.includes("DARS ISHLANMASI"), "hujjat nomi yo'q");
  assert.ok(t.includes("Fan:") && t.includes("Biologiya"));
  assert.ok(t.includes("Tuzuvchi:") && t.includes("Karimova Dilnoza Baxtiyorovna"));
  // Brend-muqova YO'Q: eski ko'ruvchilardagi lenta/kartochka matnlari.
  assert.ok(!t.some((x) => /^DARS REJASI$|^GLOSSARIY$/.test(x) && x !== "GLOSSARIY"), "brend lentasi qoldi");
});

test("titul beti YO'Q: `title` bandi chiqarilmaydi, birinchi varaq shapka bilan boshlanadi", () => {
  for (const kind of TEACHER_KINDS) {
    const plan = planTeacher(sampleTeacherDoc(kind));
    assert.equal(teacherProfile(kind).titlePage, "none", `${kind}: DOCX titul beti o'chirilmagan`);
    const html = viewerHtml(sampleTeacherDoc(kind));
    assert.ok(!html.includes('class="h-[40mm]"'), `${kind}: ko'ruvchi titul o'rnini chizdi`);
    assert.ok(plan.head.length >= 3, `${kind}: shapka bo'sh`);
  }
});

/* ══════════════════════════ jadval ══════════════════════════ */

test("jadval ustunlari va tartibi: raqam → sarlavha → ustun nomlari → qatorlar", () => {
  const t = htmlTexts(viewerHtml(sampleTeacherDoc("map")));
  const i = t.indexOf("1-jadval");
  assert.ok(i >= 0, "jadval raqami ko'ruvchida yo'q");
  assert.deepEqual(t.slice(i + 1, i + 7), ["Hafta", "Soat", "Mavzu", "Metod", "Ta’minot", "Nazorat"], `ustun nomlari: ${t.slice(i, i + 8).join(" | ")}`);
  // Birinchi qator ustun nomlaridan keyin.
  assert.equal(t[i + 7], "1", "birinchi hafta raqami");
});

test("kalit jadvali ustunlari: har variant o'z ustuni, ball/Bloom/qiyinlik", () => {
  const t = htmlTexts(viewerHtml(sampleTeacherDoc("test")));
  const i = t.indexOf("№");
  assert.ok(i >= 0, "kalit jadvali yo'q");
  assert.deepEqual(t.slice(i, i + 6), ["№", "Variant A", "Variant B", "Ball", "Bloom", "Qiyinlik"]);
});

/* ══════════════════════════ varaq ══════════════════════════ */

test("xarita ALBOM varaqda o'lchanadi (kenglik 297 mm dan, portretda 210 mm dan)", () => {
  /*
   * SSR da sahifalash hali yo'q (`useLayoutEffect` ishlamaydi), ya'ni
   * varaq kartalari chizilmaydi — lekin O'LCHOV daraxti chiziladi va
   * uning kengligi aynan varaq enidan kelib chiqadi. Albom buzilsa
   * (portret kengligi bilan o'lchansa) matn varaqqa noto'g'ri
   * joylanardi, shuning uchun test aynan shu songa qaraydi.
   */
  const ls = sheetMetrics(true, TEACHER_MARGINS_CM.map);
  assert.equal(ls.wPx, LANDSCAPE.wPx);
  assert.equal(ls.measureWidth, "262mm", "albom o'lchov kengligi 297 − (2 + 1,5) sm bo'lishi kerak");
  assert.ok(renderToStaticMarkup(h(WordViewer, { doc: sampleTeacherDoc("map") })).includes("width:262mm"), "xarita albom kengligida o'lchanmadi");

  for (const kind of ["lesson", "glossary", "keys", "test"] as TeacherKind[]) {
    const m = TEACHER_MARGINS_CM[kind];
    const want = `width:${210 - (m.left + m.right) * 10}mm`;
    assert.ok(renderToStaticMarkup(h(WordViewer, { doc: sampleTeacherDoc(kind) })).includes(want), `${kind}: portret kengligi (${want}) kutilgan`);
  }
});

test("varaq chekinishi, shrifti va yo'nalishi DOCX profili bilan BITTA manbadan", () => {
  for (const kind of TEACHER_KINDS) {
    const plan = planTeacher(sampleTeacherDoc(kind));
    const p = teacherProfile(kind);
    const m = plan.page.marginsCm;
    assert.equal(p.type.size, plan.page.sizePt * 2, `${kind}: shrift o'lchami ajralib ketdi`);
    assert.equal(p.tableSize, plan.page.tableSizePt * 2, `${kind}: jadval shrifti ajralib ketdi`);
    assert.equal(p.type.line, Math.round(240 * plan.page.line), `${kind}: qator oralig'i ajralib ketdi`);
    assert.equal(p.page.margin.left, Math.round(m.left * 567), `${kind}: chap chegara ajralib ketdi`);
    assert.equal(p.page.margin.top, Math.round(m.top * 567), `${kind}: yuqori chegara ajralib ketdi`);
    assert.equal(p.page.landscape, plan.landscape, `${kind}: yo'nalish ajralib ketdi`);
    // Ko'ruvchi varag'i ham shu chekinishni oladi (`teacherSheet` `style.padding`).
    const html = renderToStaticMarkup(h(WordViewer, { doc: sampleTeacherDoc(kind) }));
    assert.ok(html.includes(`font-size:${plan.page.sizePt}pt`), `${kind}: ko'ruvchi shrifti rejadan olinmadi`);
    assert.ok(html.includes(`--doc-table-size:${plan.page.tableSizePt}pt`), `${kind}: jadval shrifti rejadan olinmadi`);
  }
});

/* ══════════════════════════ tahrir ══════════════════════════ */

test("tahrir hozircha O'CHIQ (WP-D qo'shadi), lekin varaq to'liq chiziladi", () => {
  const html = renderToStaticMarkup(h(WordViewer, { doc: sampleTeacherDoc("lesson"), gen: { id: "g1", type: "lesson-plan" } }));
  assert.ok(!html.includes("Tahrirlash"), "o'qituvchi hujjatida tahrir tugmasi hali bo'lmasligi kerak");
  assert.ok(!html.includes("data-path"), "tahrir nishonlari hali chizilmasin");
  assert.ok(html.includes("DARS ISHLANMASI"), "varaq baribir to'liq chizilishi kerak");
});
