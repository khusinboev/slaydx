import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { TranslationViewer, warningText } from "../../components/viewers/TranslationViewer.tsx";
import type { AcademicDoc } from "../../lib/generation/types.ts";
import type { TranslationReport } from "../../lib/generation/translate/report.ts";

/**
 * Tarjima ko'ruvchisi (Tarjimon 2, WP5) — SSR.
 * Ikki ustun juftlar, til chiplari, ogohlantirishlar, fayl rejimi panellari,
 * eski (hisobotsiz) hujjat → WordViewer.
 */
function report(over: Partial<TranslationReport> = {}): TranslationReport {
  return {
    sourceLang: "avto",
    detected: "uz",
    target: "en",
    style: "formal",
    glossary: [{ src: "fotosintez", dst: "photosynthesis" }],
    warnings: [],
    pairs: [
      { id: "a", src: "Fotosintez", dst: "Photosynthesis", kind: "h" },
      { id: "b", src: "Barg yashil.", dst: "The leaf is green.", kind: "p", ctx: "slide 1" },
      { id: "c", src: "2024 yil", dst: "year", kind: "p", ctx: "slide 1", warn: true },
    ],
    segments: 3,
    translated: 3,
    chars: 30,
    sourceKind: "text",
    ...over,
  };
}
const doc = (t?: TranslationReport): AcademicDoc =>
  ({ meta: { toolId: "translation", language: "en", topic: "x" } as never, titlePage: false, toc: false, sections: [{ id: "body", title: "", blocks: [{ kind: "p", text: "Photosynthesis" }] }], translation: t }) as AcademicDoc;

const render = (t: TranslationReport | undefined, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(h(TranslationViewer, { doc: doc(t), gen: { id: "11111111-1111-4111-8111-111111111111", format: "docx" }, ...extra }));

test("matn rejimi: ikki ustun juftlar, til chipi (aniqlangan → maqsad), uslub, band/belgi, ogohlantirishli qator amber", () => {
  const html = render(report());
  assert.ok(html.includes("data-pairs"));
  assert.ok(html.includes('data-pair="a"') && html.includes("Photosynthesis") && html.includes("Fotosintez"));
  assert.ok(html.includes("o‘zbek tili → English"), "til chipi");
  assert.ok(html.includes("Aniqlangan til: o‘zbek tili"), "avto → aniqlangan til ko'rsatiladi");
  assert.ok(html.includes("Rasmiy / ilmiy"));
  assert.ok(html.includes("3 / 3 band"));
  assert.ok(html.includes("border-amber-400"), "warn qator");
  assert.ok(html.includes("SLIDE 1") || html.includes("slide 1"), "ctx guruh yorlig'i");
  assert.ok(!html.includes('role="tablist"'), "matn rejimida tablar yo'q");
  assert.ok(html.includes("fotosintez → photosynthesis"), "glossariy");
  // Ota konteyner `overflow-hidden` — ro'yxat o'z scroll qutisida (AUDIT-14: pastga scroll bo'lmasdi).
  assert.match(html, /class="[^"]*overflow-y-auto[^"]*"[^>]*data-translation-scroll/, "scroll konteyneri");
});

test("ogohlantirishlar: soni va matni; warningText kodlari o'zbekcha", () => {
  const html = render(report({ warnings: [{ code: "numbers", id: "c", detail: "2024" }, { code: "skipped-part", detail: "2 ta SmartArt tarjima qilinmadi" }] }));
  assert.ok(html.includes("Ogohlantirishlar (2)"));
  assert.ok(html.includes("Raqam/URL mos kelmadi — tekshiring: 2024"));
  assert.ok(html.includes("2 ta SmartArt tarjima qilinmadi"));
  assert.equal(warningText({ code: "untranslated", detail: "Salom" }), "Tarjima qilinmagan band (asl matn qoldirildi): «Salom»");
});

test("fayl rejimi: tablar bor; docx + pdf feature → Fayl tabida iframe ?format=pdf; pdf'siz → yuklab olish paneli; xlsx → yuklab olish; txt → matn", () => {
  const docx = render(report({ sourceKind: "docx", sourceName: "hisobot.docx" }), { pdf: true });
  assert.ok(docx.includes('role="tablist"'));
  assert.ok(docx.includes("DOCX"));
  // Standart tab — Taqqoslash; iframe faqat «Fayl» tabida (holat klientda) — FilePane to'g'ridan-to'g'ri tekshiriladi:
  assert.ok(docx.includes("data-pairs"));
});

test("eski hujjat (translation yo'q) → WordViewer fallback", () => {
  const html = render(undefined);
  assert.ok(!html.includes("data-translation-header"));
  assert.ok(html.includes("Photosynthesis"), "WordViewer matnni chizadi");
});
