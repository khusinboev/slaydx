import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { SlideViewer } from "../../components/viewers/SlideViewer.tsx";
import type { AcademicDoc } from "../../lib/generation/types.ts";
import type { SlideModel } from "../../lib/generation/slide-types.ts";

/**
 * E6 — tahrir SSR da: boshqaruv QAYERDA chiqadi va qayerda chiqmaydi.
 *
 * Bu daraja ataylab sodda (statik HTML): hodisalar `tests/ui/` da
 * jsdom bilan sinaladi. Bu yerdagi savol bitta — ko'ruvchi tahrirni
 * KIMGA taklif qiladi. Noto'g'ri javob qimmat: eski formatdagi dekada
 * boshqaruv chiqsa, foydalanuvchi bosadi va server 409 `legacy`
 * qaytaradi.
 *
 * AUDIT-10 dan keyin «Tahrirlash» TUGMASI YO'Q — tahrir tayyor dekada
 * doim yoqiq. Shuning uchun belgi sifatida tugma emas, tahrir
 * BOSHQARUVI (maket chipi, «+ Slayd», tahrir qatlami) tekshiriladi va
 * «Tahrirlash» so'zining o'zi HTML da bo'lmasligi alohida qulflanadi:
 * u qaytsa, foydalanuvchi yana ikki qadamli tahrirga qaytardi.
 */

/** Tahrir boshqaruvi chizilganmi (maket chipi + tahrir qatlami). */
function hasEditUi(html: string): boolean {
  return html.includes("data-slide-editor") && html.includes("Bo‘lim");
}

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

test("gen berilsa (COMPLETED, doc.slides bor) — tahrir DARHOL yoqiq", () => {
  const doc = docWithSlides();
  const html = renderToStaticMarkup(h(SlideViewer, { doc, gen: completedGen(doc) }));
  assert.ok(hasEditUi(html), "tahrir boshqaruvi ko'rinishi kerak");
  assert.ok(!html.includes("eski formatda"), "yangi formatda ogohlantirish bo'lmasin");
});

test("«Tahrirlash» tugmasi HTML da UMUMAN yo'q", () => {
  const doc = docWithSlides();
  for (const gen of [completedGen(doc), completedGen(doc, { type: "pro-slide" }), undefined]) {
    const html = renderToStaticMarkup(h(SlideViewer, { doc, gen }));
    assert.ok(!html.includes("Tahrirlash"), "tahrir rejimi tugmasi olib tashlangan");
  }
});

test("«Saqlash» tugmasi o'zgarishsiz KO'RINMAYDI", () => {
  const doc = docWithSlides();
  const html = renderToStaticMarkup(h(SlideViewer, { doc, gen: completedGen(doc) }));
  assert.ok(!html.includes("Saqlash"), "saqlanmagan o'zgarish yo'q — tugma ham yo'q");
  assert.ok(!html.includes("Saqlandi"), "hech narsa saqlanmagan");
});

test("gen berilmasa — tahrir umuman taklif qilinmaydi", () => {
  const html = renderToStaticMarkup(h(SlideViewer, { doc: docWithSlides() }));
  assert.ok(!hasEditUi(html), "gen'siz ko'ruvchi passiv qolishi kerak");
  assert.ok(!html.includes("draggable"), "sudrab tartiblash ham faqat tahrirlanadigan dekada");
});

test("doc.slides yo'q — «eski formatda», tahrir boshqaruvi yo'q", () => {
  const doc = legacyDoc();
  const html = renderToStaticMarkup(h(SlideViewer, { doc, gen: completedGen(doc) }));
  assert.ok(html.includes("eski formatda"), "eski format haqida aytilishi kerak");
  assert.ok(!hasEditUi(html), "eski dekada tahrir bo'lmasligi kerak");
});

test("ish tugamagan (IN_PROGRESS) yoki boshqa vosita — tahrir yo'q", () => {
  const doc = docWithSlides();
  const running = renderToStaticMarkup(
    h(SlideViewer, { doc, gen: completedGen(doc, { status: "IN_PROGRESS" }) }),
  );
  assert.ok(!hasEditUi(running), "tayyor bo'lmagan dekada tahrir yo'q");

  const other = renderToStaticMarkup(h(SlideViewer, { doc, gen: completedGen(doc, { type: "essay" }) }));
  assert.ok(!hasEditUi(other), "slayd bo'lmagan vositada tahrir yo'q");
  assert.ok(!other.includes("eski formatda"), "begona vosita uchun ogohlantirish ham chiqmasin");
});

test("pro-slide ham tahrirlanadi", () => {
  const doc = docWithSlides();
  const html = renderToStaticMarkup(h(SlideViewer, { doc, gen: completedGen(doc, { type: "pro-slide" }) }));
  assert.ok(hasEditUi(html), "pro-slide ham slayd dekasi");
});

test("mumkin bo'lmagan maket chipi chizilmaydi", () => {
  const doc = docWithSlides();
  const html = renderToStaticMarkup(h(SlideViewer, { doc, gen: completedGen(doc) }));
  // Birinchi slayd — muqova: `canConvert` undan faqat `section`/`closing`
  // ga o'girishga ruxsat beradi.
  assert.ok(!html.includes("Ikki ustun"), "muqovadan ikki ustunga o'girib bo'lmaydi");
  assert.ok(!html.includes("Jadval"), "muqovadan jadvalga o'girib bo'lmaydi");
});
