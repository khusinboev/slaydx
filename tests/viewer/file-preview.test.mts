import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { FilePreview } from "../../components/home/FilePreview.tsx";
import { buildSlideDeck } from "../../lib/generation/slides.ts";
import { extractMeta } from "../../lib/generation/meta.ts";
import { TOOL_BY_ID } from "../../lib/tools.ts";
import type { GenerationPreviewSlide, ServerGeneration } from "../../lib/api-client.ts";
import type { AcademicDoc } from "../../lib/generation/types.ts";

/**
 * P1 — kartochkada (`FilePreview.tsx`) `preview.slide` bo'lsa
 * `SlideCanvas` bilan HAQIQIY birinchi slayd chiziladi, bo'lmasa eski
 * yo'l (rasm/matn) o'zgarmasdan qoladi.
 *
 * `react-dom/server` `--conditions=react-server` ostida BLOKLANADI
 * (`server-only` paket "Client Component" xatosini otadi) — shuning
 * uchun bu test `npm run test` emas, `npm run test:viewer`
 * (`tsconfig.viewer.json`, alohida `--test` yo'li) qamrovida.
 */

const meta = extractMeta(TOOL_BY_ID.slide, { topic: "Suv aylanishi", slideTemplate: "lecture" } as never);
const deck = buildSlideDeck({
  meta,
  titlePage: true,
  toc: true,
  sections: [],
  slides: [{ id: "s0", layout: "title", title: "Suv aylanishi", subtitle: "Kirish" }],
} as AcademicDoc);

const SAMPLE_SLIDE: GenerationPreviewSlide = {
  model: deck.slides[0],
  themeId: deck.themeId,
  templateId: deck.templateId,
  visual: deck.visual,
  audience: deck.audience,
  bodyType: deck.bodyType,
};

function gen(overrides: Partial<ServerGeneration>): ServerGeneration {
  return {
    id: "gen-1",
    type: "slide",
    topic: "Suv aylanishi",
    status: "COMPLETED",
    createdAt: new Date().toISOString(),
    price: 0,
    fileName: "suv-aylanishi.pptx",
    format: "pptx",
    progress: 100,
    step: "",
    expiresAt: null,
    error: null,
    preview: null,
    docVersion: 1,
    fileVersion: 1,
    imageRedraws: 0,
    editedAt: null,
    liveSeq: 0,
    ...overrides,
  } as unknown as ServerGeneration;
}

test("preview.slide bo'lsa SlideCanvas HTML (data-layer=\"text\") chiqadi", () => {
  const html = renderToStaticMarkup(h(FilePreview, { gen: gen({ preview: { slide: SAMPLE_SLIDE } }) }));
  assert.match(html, /data-layer="text"/, "SlideCanvas matn qatlami chiqishi kerak");
  assert.match(html, /Suv aylanishi/, "birinchi slayd sarlavhasi ko'rinishi kerak");
});

test("preview.slide YO'Q, faqat lines bo'lsa — eski yo'l (data-layer yo'q)", () => {
  const html = renderToStaticMarkup(
    h(FilePreview, { gen: gen({ preview: { lines: ["Birinchi qator matni bu yerda."] } }) }),
  );
  assert.doesNotMatch(html, /data-layer="text"/, "SlideCanvas chizilmasligi kerak");
  assert.match(html, /Birinchi qator matni bu yerda\./);
});

test("preview.slide YO'Q, faqat url bo'lsa — eski rasm yo'li", () => {
  const html = renderToStaticMarkup(
    h(FilePreview, { gen: gen({ preview: { url: "/api/generations/gen-1/assets/img.jpg" } }) }),
  );
  assert.doesNotMatch(html, /data-layer="text"/);
  assert.match(html, /<img/);
  assert.match(html, /img\.jpg/);
});

test("preview.slide bor bo'lsa url/lines'dan USTUN turadi", () => {
  const html = renderToStaticMarkup(
    h(FilePreview, {
      gen: gen({
        preview: { slide: SAMPLE_SLIDE, url: "/should/not/render.jpg", lines: ["ko'rinmasin"] },
      }),
    }),
  );
  assert.match(html, /data-layer="text"/);
  assert.doesNotMatch(html, /should\/not\/render\.jpg/);
  assert.doesNotMatch(html, /ko'rinmasin/);
});

test("hali tugamagan (QUEUED) generatsiyada SlideCanvas chizilmaydi", () => {
  const html = renderToStaticMarkup(
    h(FilePreview, {
      gen: gen({ status: "QUEUED", progress: 40, preview: { slide: SAMPLE_SLIDE } }),
    }),
  );
  assert.doesNotMatch(html, /data-layer="text"/);
});
