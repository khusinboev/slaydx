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
 * Explicit edit mode (owner request 2026-11-12): the hidden "always on"
 * double-click editing of AUDIT-10 was not discoverable, so an editable deck
 * now shows ONE «Tahrirlash» toggle (`data-slide-edit-toggle`) and starts in
 * VIEW mode (`data-slide-edit-mode="off"`); `initialEdit` (`?edit=1`) starts
 * it "on". The edit layer (`data-slide-editor`) is still mounted in view
 * mode — it carries the double-click shortcut into edit mode.
 */

/** Tahrir boshqaruvi chizilganmi (tahrir qatlami + slayd «O‘chirish»). */
function hasEditUi(html: string): boolean {
  return html.includes("data-slide-editor") && html.includes("O‘chirish");
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
  // Muharrir 2: asboblar paneli minimal — chip, «+ Slayd», ▲/▼, eslatma YO'Q.
  assert.ok(!html.includes("Bo‘lim") && !html.includes("Ikki ustun"), "maket chiplari olib tashlangan");
  assert.ok(!html.includes("Eslatma"), "eslatma tugmasi va paneli olib tashlangan");
  assert.ok(!html.includes("Yuqoriga") && !html.includes("Pastga"), "▲/▼ olib tashlangan");
  assert.ok(!html.includes("Asl holatga qaytarish"), "server doc_prev tugmasi UI da yo'q");
  /*
   * Overlay o'rami `pointer-events-none` bo'lishi SHART: aks holda u butun
   * sahnani yopib ikki bosishni o'ziga oladi va `data-src` li matnga
   * yetkazmaydi — brauzerda «hech narsa bo'lmayapti» (jsdom hit-testing
   * qilmagani uchun UI testlar buni ko'rmagan, faqat Playwright ko'rdi).
   */
  // O'ram (SlideStage) + ildiz (SlideEditor, `data-slide-editor`) — ikkalasi ham `pointer-events-none`.
  assert.ok(
    html.includes('<div class="pointer-events-none absolute inset-0"><div class="pointer-events-none absolute inset-0" data-slide-editor'),
    "overlay o'rami hodisalarni o'tkazib yuborishi kerak",
  );
});

test("«Tahrirlash» tugmasi: tahrirlanadigan dekada BITTA, ko'rish rejimida; boshqa holatlarda yo'q", () => {
  const doc = docWithSlides();
  for (const gen of [completedGen(doc), completedGen(doc, { type: "pro-slide" })]) {
    const html = renderToStaticMarkup(h(SlideViewer, { doc, gen }));
    assert.equal((html.match(/data-slide-edit-toggle=/g) ?? []).length, 1, "exactly one toggle");
    assert.ok(html.includes("Tahrirlash"), "labelled");
    assert.match(html, /aria-pressed="false"[^>]*data-slide-edit-toggle/, "not pressed");
    assert.ok(html.includes('data-slide-edit-mode="off"'), "starts in view mode");
    assert.ok(html.includes('data-slide-editor-mode="view"'), "edit layer in view mode: no outlines");
    assert.ok(!html.includes("data-slide-edit-target"), "no outlines in view mode");
  }
  const legacy = legacyDoc();
  for (const [doc2, gen] of [
    [doc, undefined],
    [legacy, completedGen(legacy)],
    [doc, completedGen(doc, { status: "IN_PROGRESS" })],
    [doc, completedGen(doc, { type: "essay" })],
  ] as const) {
    const html = renderToStaticMarkup(h(SlideViewer, { doc: doc2, gen }));
    assert.ok(!html.includes("data-slide-edit-toggle"), "no toggle where editing is impossible");
    assert.ok(!html.includes("data-slide-edit-mode"), "no edit-mode state either");
  }
});

test("`initialEdit` (?edit=1): editable deck starts in edit mode with outlines; ignored when not editable or live", () => {
  const doc = docWithSlides();
  const html = renderToStaticMarkup(h(SlideViewer, { doc, gen: completedGen(doc), initialEdit: true }));
  assert.ok(html.includes('data-slide-edit-mode="on"'));
  assert.match(html, /aria-pressed="true"[^>]*data-slide-edit-toggle/, "toggle pressed");
  assert.ok(html.includes("Tayyor"), "toggle reads «Tayyor»");
  assert.ok(html.includes("data-slide-edit-target"), "editable boxes outlined");
  const passive = renderToStaticMarkup(h(SlideViewer, { doc, initialEdit: true }));
  assert.ok(!passive.includes("data-slide-edit-mode") && !passive.includes("data-slide-edit-target"), "passive viewer ignores it");
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

// ══════════════════════════════════ Mobil eskiz tasmasi

/**
 * `md:` dan past ekranda yon eskiz paneli `hidden` — telefonda deka
 * umuman ko'rinmasdi. Tasma o'sha ma'lumotni gorizontal beradi va
 * FAQAT bog'langan ko'ruvchida chiziladi (`gen` yoki `live`): passiv
 * ko'ruvchi (`gen`siz) eskicha, tasmasiz qoladi.
 */
test("mobil tasma SSR da chiziladi va `md:` dan yashirinadi", () => {
  const doc = docWithSlides();
  const html = renderToStaticMarkup(h(SlideViewer, { doc, gen: completedGen(doc) }));
  assert.ok(html.includes('data-rail="strip"'), "tasma HTML da bo'lishi kerak");
  assert.ok(html.includes("md:hidden"), "tasma katta ekranda yashirinadi (yon panel bor)");
  // Har slaydga bitta eskiz — sahna emas, aynan tasma ichidagilar.
  const marks = html.match(/data-strip-index="\d+"/g) ?? [];
  assert.equal(marks.length, slides.length, "har slaydga bitta eskiz");
});

test("gen/live bo'lmasa tasma chizilmaydi (F2 paritet fiksturasi)", () => {
  const html = renderToStaticMarkup(h(SlideViewer, { doc: docWithSlides() }));
  assert.ok(!html.includes('data-rail="strip"'), "passiv ko'ruvchi HTML i o'zgarmasligi kerak");
});

test("jonli rejimda tasma SKELET eskizlar bilan chiziladi", () => {
  const doc = docWithSlides();
  const live = {
    stage: "text",
    meta: { topic: "Namunaviy mavzu", author: "Aliyev Ali", workLabel: "Taqdimot", speakerNotes: true },
    theme: "atlas",
    template: "lecture",
    progress: 20,
    step: "Matn yozilmoqda · 1/2 slayd",
    roles: ["Muqova", "Kirish"],
    slides,
    written: [0],
    final: false,
    imageWait: [],
    images: { got: 0, want: 0 },
  };
  const html = renderToStaticMarkup(h(SlideViewer, { doc, live }));
  assert.ok(html.includes('data-rail="strip"'), "jonli ko'ruvchida ham tasma bor");
  // Hali yozilmagan slayd o'rniga reja bergan vazifa ko'rinadi.
  assert.ok(html.includes("Kirish"), "yozilmagan eskiz roli bilan ko'rsatiladi");
  /*
   * Ikkita skelet: yon panelda va TASMADA (sahnada esa 0-slayd
   * yozilgan). Tasma skeletni chizmasa — bitta bo'lib qolardi, ya'ni
   * telefonda yozilmagan slayd «tayyor»dek ko'rinardi.
   */
  assert.equal(
    (html.match(/data-skeleton="1"/g) ?? []).length,
    2,
    "yozilmagan slayd yon panelda ham, tasmada ham skelet bo'lishi kerak",
  );
});
