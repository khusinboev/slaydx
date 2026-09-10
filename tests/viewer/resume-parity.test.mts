import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import JSZip from "jszip";
import { ResumePage } from "../../components/viewers/resume/ResumePage.tsx";
import { renderDocx } from "../../lib/generation/render-docx.ts";
import { planResume, type ResumeItem } from "../../lib/generation/resume/layout.ts";
import { docFromResume, type ResumeModel } from "../../lib/generation/resume/model.ts";
import { sampleResume } from "../../lib/generation/resume/samples.ts";
import { RESUME_PALETTE_IDS, RESUME_TEMPLATE_IDS, RESUME_TEMPLATES } from "../../lib/generation/resume/templates.ts";
import type { AcademicDoc, DocMeta } from "../../lib/generation/types.ts";

/**
 * «KO'RDIM = OLDIM» — rezyume (Rezyume 2, AUDIT-15).
 *
 * Bu faylning butun mazmuni bitta jumla: sayt ko'ruvchisi chiqargan
 * MATN KETMA-KETLIGI DOCX chiqargan `<w:t>` ketma-ketligiga AYNAN teng
 * bo'lishi kerak. Ikkalasi ham `planResume` dan chizadi, ya'ni farq
 * chiqsa — kimdir rejaga bo'ysunmay o'zicha matn qo'shgan yoki tartibni
 * o'zgartirgan.
 *
 * Solishtiruvda BO'SH/faqat-bo'shliqli tugunlar hisobga olinmaydi:
 * DOCX da ko'nikmalar orasidagi ajratgich bo'sh joy runi, ko'ruvchida
 * esa CSS `gap`. Ko'rinadigan har qanday matn (yorliq, sana, «•»,
 * « — ») ikkala tomonda ham bir xil bo'lishi shart.
 */

const META: DocMeta = {
  topic: "Moliya tahlilchisi",
  author: "Karimova Dilnoza",
  workLabel: "Rezyume",
  language: "uz",
  toolId: "resume",
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

/** HTML dagi ko'rinadigan matn tugunlari (teglar tashqarisi). */
function htmlTexts(html: string): string[] {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/<[^>]*>/)
    .map((t) => decode(t).trim())
    .filter(Boolean);
}

function docxTexts(xml: string): string[] {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((m) => decode(m[1]).trim())
    .filter(Boolean);
}

async function docxOf(doc: AcademicDoc) {
  const zip = await JSZip.loadAsync(Buffer.from(await renderDocx(doc)));
  return zip.file("word/document.xml")!.async("string");
}

function modelFor(id: (typeof RESUME_TEMPLATE_IDS)[number], withPhoto: boolean): ResumeModel {
  const m = sampleResume(id, undefined, false);
  // Namunadagi surat `/samples/...` — DOCX uni yuklay olmaydi; paritet
  // sinovi uchun ikkala tomon ham o'qiy oladigan `data:` URL kerak.
  if (withPhoto) m.photo = { url: PNG_URL, shape: RESUME_TEMPLATES[id].photo.shape, assetId: "" };
  return m;
}

function viewerHtml(m: ResumeModel): string {
  const layout = planResume(m);
  const main: ResumeItem[] = layout.zones.find((z) => z.id === "main")?.items ?? [];
  return renderToStaticMarkup(h(ResumePage, { layout, pageItems: main, pageIndex: 0, total: 1 }));
}

/* ══════════════════════════════ paritet ══════════════════════════════ */

for (const id of RESUME_TEMPLATE_IDS) {
  for (const withPhoto of [false, true]) {
    test(`${id}${withPhoto ? " + surat" : ""}: ko'ruvchi va DOCX matni bir xil`, async () => {
      const m = modelFor(id, withPhoto);
      const xml = await docxOf(docFromResume(m, META));
      const fromDocx = docxTexts(xml);
      const fromView = htmlTexts(viewerHtml(m));
      assert.ok(fromDocx.length > 10, "sinov ma'noli bo'lishi uchun matn tugunlari ko'p bo'lsin");
      assert.deepEqual(fromView, fromDocx);
    });
  }
}

test("har shablonda `<img>` bor ⇔ `<w:drawing>` bor", async () => {
  for (const id of RESUME_TEMPLATE_IDS) {
    for (const withPhoto of [false, true]) {
      const m = modelFor(id, withPhoto);
      const xml = await docxOf(docFromResume(m, META));
      const html = viewerHtml(m);
      const inDocx = xml.includes("<w:drawing>");
      const inView = /<img\b/.test(html);
      assert.equal(inView, inDocx, `${id} (surat: ${withPhoto}): ko'ruvchi ${inView}, DOCX ${inDocx}`);
      assert.equal(inDocx, withPhoto, `${id}: surat kutilgani bilan mos emas`);
    }
  }
});

test("palitra almashsa ikkala tomonda ham matn o'zgarmaydi (faqat rang)", async () => {
  const base = modelFor("modern", false);
  const first = htmlTexts(viewerHtml(base));
  for (const p of RESUME_PALETTE_IDS) {
    const m: ResumeModel = { ...base, palette: p };
    assert.deepEqual(htmlTexts(viewerHtml(m)), first, `${p}: matn o'zgardi`);
    const html = viewerHtml(m);
    assert.ok(html.includes(`#${planResume(m).palette.accent}`), `${p}: aksent rangi HTML ga chiqmadi`);
  }
});

test("shablon almashsa ko'ruvchi ham, DOCX ham yangi maketga o'tadi", async () => {
  const side = viewerHtml(modelFor("modern", false));
  const single = viewerHtml(modelFor("classic", false));
  assert.ok(side.includes('data-resume-zone="aside"'), "modern da panel yo'q");
  assert.ok(!single.includes('data-resume-zone="aside"'), "classic da panel bor");
  assert.ok(single.includes('data-resume-zone="header"'), "classic da bosh qism yo'q");
});

test("ikkinchi varaqda panel FONI qoladi, matni takrorlanmaydi (Word bilan bir xil)", () => {
  const m = modelFor("modern", false);
  const layout = planResume(m);
  const main = layout.zones.find((z) => z.id === "main")?.items ?? [];
  const page2 = renderToStaticMarkup(h(ResumePage, { layout, pageItems: main.slice(0, 2), pageIndex: 1, total: 2 }));
  assert.ok(page2.includes(`#${layout.palette.dark}`), "panel foni yo'qoldi");
  assert.ok(!htmlTexts(page2).includes(m.identity.fullName), "panel matni ikkinchi varaqda takrorlandi");
});
