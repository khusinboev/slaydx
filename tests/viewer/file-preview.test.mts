import test from "node:test";
import assert from "node:assert/strict";
import { renderToPipeableStream, renderToStaticMarkup } from "react-dom/server";
import { Writable } from "node:stream";
import { createElement as h, type ReactElement } from "react";
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
 *
 * Ops sprint WP-C: the thumbnail (`SlideThumb`, slide engine) is a lazy chunk.
 * The synchronous shell therefore shows a same-size placeholder, and the
 * slide assertions run on the FULL render (`renderAll` waits for every
 * Suspense boundary, i.e. the chunk). Changed assertions: tests 1 and 4 used
 * `renderToStaticMarkup` and now use `renderAll` with the same expectations;
 * the new first test locks that the slide engine is NOT in the first render.
 * Mutation: a static `import SlideThumb from "./SlideThumb"` in
 * `FilePreview.tsx` turned the first test red.
 */

/** Full HTML after every lazy chunk has loaded (Suspense boundaries resolved). */
function renderAll(el: ReactElement): Promise<string> {
  return new Promise((resolve, reject) => {
    let html = "";
    const sink = new Writable({
      write(chunk, _enc, cb) {
        html += chunk.toString();
        cb();
      },
    });
    sink.on("finish", () => resolve(html));
    const { pipe } = renderToPipeableStream(el, {
      onAllReady: () => pipe(sink),
      onShellError: reject,
      onError: reject,
    });
  });
}

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

/*
 * MUST stay the first render of a slide card in this file: once the lazy chunk
 * has loaded (the tests below), `lazy` renders synchronously.
 */
test("WP-C: first render has a same-size placeholder, not the slide engine (lazy chunk)", () => {
  const html = renderToStaticMarkup(h(FilePreview, { gen: gen({ preview: { slide: SAMPLE_SLIDE } }) }));
  assert.match(html, /data-slide-thumb="loading"/, "placeholder while the thumbnail chunk loads");
  assert.match(html, /h-full w-full/, "placeholder fills the card box");
  assert.doesNotMatch(html, /data-layer="text"/, "SlideCanvas must not be in the first render");
});

test("preview.slide bo'lsa SlideCanvas HTML (data-layer=\"text\") chiqadi", async () => {
  const html = await renderAll(h(FilePreview, { gen: gen({ preview: { slide: SAMPLE_SLIDE } }) }));
  assert.match(html, /data-slide-thumb="ready"/, "thumbnail chunk rendered");
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

test("preview.slide bor bo'lsa url/lines'dan USTUN turadi", async () => {
  const html = await renderAll(
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

test("DOCX natija (referat/tarjima): eskiz <img> `/thumb` + yuklanguncha matn qatorlari (AUDIT-14)", () => {
  const html = renderToStaticMarkup(
    h(FilePreview, { gen: gen({ type: "referat" as never, format: "docx", fileName: "referat.docx", preview: { lines: ["Kirish qismi matni bu yerda."] } }) }),
  );
  assert.match(html, /data-doc-thumb="loading"/);
  // `?v=<fileVersion>` — W2-B/W2-E: eskiz faqat joriy versiya bilan keshlanadi.
  assert.match(html, /src="\/api\/generations\/gen-1\/thumb(\?v=\d+)?"/, "eskiz havolasi");
  assert.match(html, /Kirish qismi matni bu yerda\./, "yuklanguncha matn qatorlari");
  assert.match(html, /loading="lazy"/);
});

/*
 * Redesign W2 (lead note): a finished file with no preview lines and no
 * thumbnail used to render a blank paper-white box (`#f7f4ec` / `#eef1f4`),
 * glaring in dark mode on «Ishlarim» and the Bosh «Davom ettirish» list.
 * Now: the themed muted surface + the kind's icon, while the thumbnail loads
 * and when it fails. Mutation: the DocThumb fallback back to bare `linesView`
 * (null) turned the first case red.
 */
test("bo'sh eskiz: qator/eskiz yo'q — mavzuli `bg-muted` + tur belgisi, oq quti emas (DOCX, slayd, rasm)", () => {
  const cases = [
    { type: "referat", format: "docx", preview: null, icon: /lucide-file-text/ },
    { type: "coursework", format: "docx", preview: { lines: [] }, icon: /lucide-file-text/ },
    { type: "slide", format: "pptx", preview: null, icon: /lucide-presentation/ },
    { type: "image", format: "png", preview: null, icon: /lucide-image/ },
  ] as const;
  for (const c of cases) {
    const html = renderToStaticMarkup(h(FilePreview, { gen: gen({ type: c.type as never, format: c.format as never, preview: c.preview as never }) }));
    assert.match(html, /data-preview-empty/, `${c.type}: placeholder`);
    assert.match(html, /class="bg-muted [^"]*"[^>]*data-preview-empty/, `${c.type}: themed surface`);
    assert.match(html, c.icon, `${c.type}: kind icon`);
    assert.doesNotMatch(html, /#f7f4ec|#eef1f4/, `${c.type}: no fixed paper colour`);
  }
  // With text lines the paper preview (it draws the document) is unchanged.
  const withLines = renderToStaticMarkup(h(FilePreview, { gen: gen({ type: "referat" as never, format: "docx", preview: { lines: ["Kirish"] } }) }));
  assert.doesNotMatch(withLines, /data-preview-empty/);
  assert.match(withLines, /#f7f4ec/);
});
