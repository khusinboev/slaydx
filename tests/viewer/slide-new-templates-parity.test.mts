import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import JSZip from "jszip";
import { SlideCanvas } from "../../components/viewers/SlideCanvas.tsx";
import { extractMeta } from "../../lib/generation/meta.ts";
import { renderPptx } from "../../lib/generation/render-pptx.ts";
import { bodyRules } from "../../lib/generation/slide-audience.ts";
import { planSlide, type SlideLayer } from "../../lib/generation/slide-layout.ts";
import { sampleDeck } from "../../lib/generation/slide-samples.ts";
import { buildSlideDeck } from "../../lib/generation/slides.ts";
import { SLIDE_TEMPLATE_BY_ID } from "../../lib/generation/slide-templates.ts";
import { getSlideTheme } from "../../lib/generation/slide-themes.ts";
import type { SlideModel } from "../../lib/generation/slide-types.ts";
import { TOOL_BY_ID } from "../../lib/tools.ts";
import type { AcademicDoc } from "../../lib/generation/types.ts";

/**
 * «Ko'rdim = oldim» — Program 17 (17-band) yangi shablonlari: `conference`
 * («Ilmiy konferensiya») va `grid` («Minimal grid»).
 *
 * Uchala chiqish (planSlide qatlamlari, sayt ko'ruvchisi `SlideCanvas`,
 * yuklab olinadigan PPTX) AYNAN bir xil matn ketma-ketligini berishi
 * shart. Namuna deka + `plan` raqamlari (bo'lim raqami, mazmun nishoni)
 * bilan, 3 temada, rasmli (`data:` URL — PPTX o'qiy oladi).
 */
const NEW = ["conference", "grid"] as const;
const THEMES = ["atlas", "chalk", "ink"] as const;
const TOTAL = 9;
const bodyType = bodyRules({ planItems: 5, textVolume: "standart" }, "lecture");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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

/** Namuna deka + reja raqamlari (bo'lim va mazmun slaydlari), rasm `data:` URL. */
function deckFor(id: (typeof NEW)[number]): SlideModel[] {
  const plans: Record<string, number> = { section: 1, bullets: 1, twoCol: 2, stats: 3, process: 3 };
  return sampleDeck(id).map((s) => ({
    ...s,
    ...(plans[s.layout] ? { plan: plans[s.layout] } : {}),
    ...(s.image ? { image: { url: PNG } } : {}),
  }));
}

/** `upper` — PPTX matnni o'zi katta harfga o'giradi; ko'ruvchi CSS `text-transform` bilan (matn tuguni o'zgarmaydi). */
function planTexts(layers: SlideLayer[], upper: boolean): string[] {
  const out: string[] = [];
  for (const l of layers) {
    if (l.t !== "text") continue;
    const up = (t: string) => (upper && l.uppercase ? t.toUpperCase() : t);
    for (const t of l.lines ?? [l.text ?? ""]) if (t.trim()) out.push(up(t).trim());
  }
  return out;
}

function htmlTexts(html: string): string[] {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/<[^>]*>/)
    .map((t) => decode(t).trim())
    .filter(Boolean);
}

for (const id of NEW) {
  test(`${id}: planSlide ⇔ SlideCanvas matni bir xil — 9 slayd × 3 tema`, () => {
    const tpl = SLIDE_TEMPLATE_BY_ID[id];
    const slides = deckFor(id);
    for (const themeId of THEMES) {
      const theme = getSlideTheme(themeId);
      slides.forEach((s, i) => {
        const plan = planSlide(s, theme, tpl.visual, i, TOTAL, "auto", id, { bodyType });
        const html = renderToStaticMarkup(h(SlideCanvas, { slide: s, theme, visual: tpl.visual, audience: "auto", templateId: id, bodyType, index: i, total: TOTAL }));
        const fromPlan = planTexts(plan.layers, false);
        assert.ok(fromPlan.length >= 3, `${id}/${themeId}/#${i}: matn qatlamlari yo'q`);
        assert.deepEqual(htmlTexts(html), fromPlan, `${id}/${themeId}/#${i} (${s.layout})`);
        // Rasm qatlamlari soni ham mos (ko'ruvchi `<img>`).
        const imgs = plan.layers.filter((l) => l.t === "image").length;
        assert.equal((html.match(/<img\b/g) ?? []).length, imgs, `${id}/${themeId}/#${i}: rasm soni`);
      });
    }
  });

  test(`${id}: planSlide ⇔ PPTX \`<a:t>\` matni bir xil — 9 slayd`, async () => {
    const tpl = SLIDE_TEMPLATE_BY_ID[id];
    const slides = deckFor(id);
    const meta = extractMeta(TOOL_BY_ID.slide, { topic: "Namuna", slideTemplate: id, slideTheme: tpl.defaultTheme, author: "Karimova Nilufar", language: "uz" } as never);
    const doc = { meta, titlePage: false, toc: false, sections: [], slides, slideTemplate: id, slideTheme: tpl.defaultTheme } as unknown as AcademicDoc;
    const file = await renderPptx(doc, `${id}.pptx`, { resolveImage: async () => ({ data: PNG, type: "png" }) });
    const zip = await JSZip.loadAsync(Buffer.from(file.bytes));
    // `renderPptx` aynan shu deka modelidan chizadi — `planSlide` ga ham undan beramiz.
    const deck = buildSlideDeck(doc);
    assert.equal(deck.visual, tpl.visual);
    const theme = getSlideTheme(deck.themeId);
    for (let i = 0; i < slides.length; i++) {
      const xml = await zip.file(`ppt/slides/slide${i + 1}.xml`)!.async("string");
      const fromPptx = [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((m) => decode(m[1]).trim()).filter(Boolean);
      const plan = planSlide(deck.slides[i], theme, deck.visual, i, deck.slides.length, deck.audience, deck.templateId, { bodyType: deck.bodyType });
      assert.deepEqual(fromPptx, planTexts(plan.layers, true), `${id}/#${i} (${slides[i].layout}): PPTX matni plandan farq qiladi`);
    }
  });
}
