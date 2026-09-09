import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { SlideViewer } from "../../components/viewers/SlideViewer.tsx";
import type { AcademicDoc } from "../../lib/generation/types.ts";
import type { SlideModel } from "../../lib/generation/slide-types.ts";

/**
 * E6 — tahrir SSR da: tugma QAYERDA chiqadi va qayerda chiqmaydi.
 *
 * Bu daraja ataylab sodda (statik HTML): hodisalar `tests/ui/` da
 * jsdom bilan sinaladi. Bu yerdagi savol bitta — ko'ruvchi tahrirni
 * KIMGA taklif qiladi. Noto'g'ri javob qimmat: eski formatdagi dekada
 * tugma chiqsa, foydalanuvchi bosadi va server 409 `legacy` qaytaradi.
 */

const slides: SlideModel[] = [
  { id: "s0", layout: "title", title: "Sarlavha slaydi", subtitle: "Ikkinchi qator" },
  { id: "s1", layout: "bullets", title: "Band slaydi", bullets: ["Birinchi band.", "Ikkinchi band."] },
];

function docWithSlides(): AcademicDoc {
  return {
    meta: { topic: "Namunaviy mavzu", author: "Aliyev Ali", workLabel: "Taqdimot", speakerNotes: true },
    titlePage: false,
    toc: false,
    sections: [],
    slides,
  } as unknown as AcademicDoc;
}

/** Eski `doc_json` — `slides` YO'Q, deka `sections` dan yasaladi. */
function legacyDoc(): AcademicDoc {
  return {
    meta: { topic: "Eski hujjat", author: "Aliyev Ali", workLabel: "Taqdimot" },
    titlePage: false,
    toc: false,
    sections: [{ id: "k1", title: "Kirish", blocks: [{ kind: "p", text: "Matn." }] }],
  } as unknown as AcademicDoc;
}

function completedGen(doc: AcademicDoc, patch: Record<string, unknown> = {}) {
  return {
    id: "gen1",
    type: "slide",
    status: "COMPLETED",
    doc,
    docVersion: 1,
    fileVersion: 1,
    imageRedraws: 0,
    ...patch,
  };
}

test("gen berilsa (COMPLETED, doc.slides bor) — «Tahrirlash» tugmasi bor", () => {
  const doc = docWithSlides();
  const html = renderToStaticMarkup(h(SlideViewer, { doc, gen: completedGen(doc) }));
  assert.ok(html.includes("Tahrirlash"), "tahrir tugmasi ko'rinishi kerak");
  assert.ok(!html.includes("eski formatda"), "yangi formatda ogohlantirish bo'lmasin");
});

test("gen berilmasa — tahrir umuman taklif qilinmaydi", () => {
  const html = renderToStaticMarkup(h(SlideViewer, { doc: docWithSlides() }));
  assert.ok(!html.includes("Tahrirlash"), "gen'siz ko'ruvchi passiv qolishi kerak");
});

test("doc.slides yo'q — «eski formatda», tahrir tugmasi yo'q", () => {
  const doc = legacyDoc();
  const html = renderToStaticMarkup(h(SlideViewer, { doc, gen: completedGen(doc) }));
  assert.ok(html.includes("eski formatda"), "eski format haqida aytilishi kerak");
  assert.ok(!html.includes("Tahrirlash"), "eski dekada tahrir tugmasi bo'lmasligi kerak");
});

test("ish tugamagan (IN_PROGRESS) yoki boshqa vosita — tahrir yo'q", () => {
  const doc = docWithSlides();
  const running = renderToStaticMarkup(
    h(SlideViewer, { doc, gen: completedGen(doc, { status: "IN_PROGRESS" }) }),
  );
  assert.ok(!running.includes("Tahrirlash"), "tayyor bo'lmagan dekada tahrir yo'q");

  const other = renderToStaticMarkup(h(SlideViewer, { doc, gen: completedGen(doc, { type: "essay" }) }));
  assert.ok(!other.includes("Tahrirlash"), "slayd bo'lmagan vositada tahrir yo'q");
  assert.ok(!other.includes("eski formatda"), "begona vosita uchun ogohlantirish ham chiqmasin");
});

test("pro-slide ham tahrirlanadi", () => {
  const doc = docWithSlides();
  const html = renderToStaticMarkup(h(SlideViewer, { doc, gen: completedGen(doc, { type: "pro-slide" }) }));
  assert.ok(html.includes("Tahrirlash"), "pro-slide ham slayd dekasi");
});

test("tahrir rejimi standart holatda O'CHIQ — maket chiplari ko'rinmaydi", () => {
  const doc = docWithSlides();
  const html = renderToStaticMarkup(h(SlideViewer, { doc, gen: completedGen(doc) }));
  assert.ok(!html.includes("Ikki ustun"), "maket chiplari faqat tahrir yoqilganda");
  assert.ok(!html.includes("Bandlar"), "maket chiplari faqat tahrir yoqilganda");
});
