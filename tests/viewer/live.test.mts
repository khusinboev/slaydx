import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SlideCanvas } from "../../components/viewers/SlideCanvas.tsx";
import { SlideViewer, asLiveView } from "../../components/viewers/SlideViewer.tsx";
import { SkeletonSlide } from "../../components/viewers/SkeletonSlide.tsx";
import { ImageWaitPlaque } from "../../components/viewers/ImageWaitPlaque.tsx";
import { LiveStrip } from "../../components/viewers/LiveStrip.tsx";
import type { LiveView } from "../../components/viewers/useReveal.ts";
import { RunningPanel } from "../../components/files/ResultView.tsx";
import { revealBudgets, layerChars, totalChars, clipLines } from "../../lib/viewers/reveal.ts";
import { boxStyle, photoSlot, planSlide } from "../../lib/generation/slide-layout.ts";
import { getSlideTheme } from "../../lib/generation/slide-themes.ts";
import type { SlideModel } from "../../lib/generation/slide-types.ts";
import type { AcademicDoc } from "../../lib/generation/types.ts";
import type { GenerationDetail } from "../../lib/api-client.ts";

/**
 * L5 — jonli ko'ruvchi.
 *
 * Naqsh `tests/viewer/parity.test.mts` dan: `renderToStaticMarkup`,
 * `tsconfig.viewer.json` (`npm run test:viewer`, react-server SHARTISIZ).
 * Uch qatlam tekshiriladi:
 *  1. SOF yadro (`revealBudgets`) — yig'indi va tartib;
 *  2. PARITET — `reveal` berilmasa HTML tayyor hujjatdagi bilan AYNAN teng;
 *  3. JONLI shoxlar — skelet, plashka, tasma, `RunningPanel` tanlovi.
 */

const theme = getSlideTheme("atlas");

const slides: SlideModel[] = [
  { id: "s0", layout: "title", title: "Sarlavha slaydi", subtitle: "Ikkinchi qator" },
  { id: "s1", layout: "bullets", title: "Band slaydi", bullets: ["Birinchi band.", "Ikkinchi band.", "Uchinchi band."] },
  { id: "s2", layout: "bullets", title: "Yakuniy slayd", bullets: ["Xulosa gapi."] },
];

const bulletSlide = slides[1];

function sampleDoc(): AcademicDoc {
  return {
    meta: { topic: "Namunaviy mavzu", author: "Aliyev Ali", workLabel: "Taqdimot", speakerNotes: true },
    titlePage: false,
    toc: false,
    sections: [],
    slides,
  } as unknown as AcademicDoc;
}

function sampleLive(over: Partial<LiveView> = {}): LiveView {
  return {
    stage: "text",
    meta: { topic: "Namunaviy mavzu", author: "Aliyev Ali", workLabel: "Taqdimot", speakerNotes: true } as LiveView["meta"],
    theme: "atlas",
    template: "lecture",
    progress: 22,
    step: "Matn yozilmoqda · 3/12 slayd",
    roles: ["Muqova", "Kirish", "Xulosa"],
    slides,
    written: [0],
    final: false,
    imageWait: [],
    images: { got: 0, want: 0 },
    ...over,
  };
}

// ───────────────────────── 1. sof yadro ──────────────────────────────

test("revealBudgets: yig'indi = min(chars, jami) va chegaralar", () => {
  const layers = planSlide(bulletSlide, theme, "classic", 1, 10).layers;
  const total = totalChars(layers);
  assert.ok(total > 0, "namunaviy slaydda matn bo'lishi kerak");

  const sum = (a: number[]) => a.reduce((n, v) => n + v, 0);
  assert.equal(sum(revealBudgets(layers, 0)), 0);
  assert.equal(sum(revealBudgets(layers, -50)), 0, "manfiy byudjet 0 ga tenglashtiriladi");
  assert.equal(sum(revealBudgets(layers, 7)), 7);
  assert.equal(sum(revealBudgets(layers, total)), total);
  assert.equal(sum(revealBudgets(layers, total + 1000)), total, "jami hajmdan oshmaydi");
  assert.equal(revealBudgets(layers, 5).length, layers.length, "massiv qatlamlar bilan bir uzunlikda");
});

test("revealBudgets: TARTIB — oldingi qatlam to'lmaguncha keyingisi noldan chiqmaydi", () => {
  const layers = planSlide(bulletSlide, theme, "classic", 1, 10).layers;
  for (const chars of [1, 5, 20, 60, 200]) {
    const b = revealBudgets(layers, chars);
    let seenPartial = false;
    for (let i = 0; i < layers.length; i++) {
      const cap = layerChars(layers[i]);
      if (cap === 0) {
        assert.equal(b[i], 0, "matnsiz qatlam byudjet yemaydi");
        continue;
      }
      if (seenPartial) assert.equal(b[i], 0, `to'lmagan qatlamdan keyin ${i} noldan katta bo'lmasin`);
      if (b[i] < cap) seenPartial = true;
    }
  }
});

test("clipLines: yarim qator qoladi, tegilmagan qatorlar chizilmaydi", () => {
  const lines = ["abcde", "fghij", "klmno"];
  assert.deepEqual(clipLines(lines, 0), []);
  assert.deepEqual(clipLines(lines, 3), [{ line: "abc", i: 0 }]);
  assert.deepEqual(clipLines(lines, 7), [
    { line: "abcde", i: 0 },
    { line: "fg", i: 1 },
  ]);
  assert.equal(clipLines(lines, 999).length, 3);
  // Asl indeks saqlanadi — `key`/`data-src` yozilib bo'lgan qatorda o'zgarmaydi.
  assert.deepEqual(
    clipLines(lines, 12).map((x) => x.i),
    [0, 1, 2],
  );
});

// ───────────────────────── 2. paritet ────────────────────────────────

test("SlideCanvas: reveal berilmasa HTML tayyor hujjatdagi bilan AYNAN teng", () => {
  for (const s of slides) {
    const base = renderToStaticMarkup(h(SlideCanvas, { slide: s, theme, visual: "classic", index: 1, total: 3 }));
    const withUndefined = renderToStaticMarkup(
      h(SlideCanvas, { slide: s, theme, visual: "classic", index: 1, total: 3, reveal: undefined }),
    );
    assert.equal(withUndefined, base, `«${s.title}»: reveal=undefined HTML ni o'zgartirmasligi kerak`);

    // `reveal=1` MATNI to'liq beradi (HTML atributlari bir xil bo'lmasligi
    // mumkin emas — bu ham aynan teng bo'lishi kerak, chunki byudjet
    // hamma qatlamni to'ldiradi).
    const full = renderToStaticMarkup(
      h(SlideCanvas, { slide: s, theme, visual: "classic", index: 1, total: 3, reveal: 1 }),
    );
    assert.equal(full, base, `«${s.title}»: reveal=1 to'liq matnni berishi kerak`);
  }
});

test("SlideCanvas: reveal=0 → matn yo'q, rectlar bor", () => {
  const html = renderToStaticMarkup(
    h(SlideCanvas, { slide: bulletSlide, theme, visual: "classic", index: 1, total: 3, reveal: 0 }),
  );
  assert.ok(!html.includes("Band slaydi"), "sarlavha matni chiqmasligi kerak");
  assert.ok(!html.includes("Birinchi band."), "band matni chiqmasligi kerak");
  assert.ok(!html.includes("<li"), "bitta belgi ham tegmagan qator `li` bermasin");
  // Fon/to'rtburchaklar (matnsiz qatlamlar) O'RNIDA qoladi — maket
  // «sakramaydi», matn ustiga yoziladi.
  assert.ok(html.includes("data-layer=\"text\""), "matn qatlamlarining qutilari joyida qolsin");
  assert.ok(/background:/.test(html), "fon/rect qatlamlari chizilishi kerak");
});

test("SlideCanvas: reveal o'sishi bilan matn faqat ko'payadi", () => {
  const layers = planSlide(bulletSlide, theme, "classic", 1, 3).layers;
  const total = totalChars(layers);
  let prev = -1;
  for (const k of [0, 0.25, 0.5, 0.75, 1]) {
    const html = renderToStaticMarkup(
      h(SlideCanvas, { slide: bulletSlide, theme, visual: "classic", index: 1, total: 3, reveal: k }),
    );
    // Teglardan tozalangan matn uzunligi — monoton o'sishi kerak.
    const textLen = html.replace(/<[^>]*>/g, "").length;
    assert.ok(textLen >= prev, `reveal=${k} da matn kamayib ketdi`);
    prev = textLen;
  }
  assert.ok(total > 0);
});

// ───────────────────────── 3. jonli shoxlar ──────────────────────────

test("SkeletonSlide: rol matni chiziladi", () => {
  const html = renderToStaticMarkup(h(SkeletonSlide, { theme, role: "Kirish", index: 2 }));
  assert.ok(html.includes("Kirish"), "roles[i] yorlig'i chiqishi kerak");
  assert.ok(html.includes("data-skeleton=\"1\""), "skelet belgisi bo'lsin");
  assert.ok(html.includes("slx-shimmer"), "shimmer klassi bo'lsin");
  // Rolsiz — yorliq umuman chizilmaydi (bo'sh qator qolmasin).
  const bare = renderToStaticMarkup(h(SkeletonSlide, { theme, index: 2 }));
  assert.ok(!bare.includes("Kirish"));
});

test("ImageWaitPlaque: AYNAN photoSlot qutisida turadi", () => {
  const box = photoSlot("bullets", "classic");
  assert.ok(box, "bullets maketida rasm joyi bor");
  const css = boxStyle(box!);
  const html = renderToStaticMarkup(h(ImageWaitPlaque, { layout: "bullets", visual: "classic", theme }));
  assert.ok(html.includes("Rasm izlanmoqda"), "plashka matni");
  // React nolga `px` qo'shmaydi (`dangerousStyleValue`) — kutilgan
  // qatorni xuddi shunday yasaymiz.
  const px = (n: number) => (n === 0 ? "0" : `${n}px`);
  for (const [k, v] of [
    ["left", css.left],
    ["top", css.top],
    ["width", css.width],
    ["height", css.height],
  ] as const) {
    assert.ok(html.includes(`${k}:${px(v)}`), `plashka ${k}:${px(v)} bo'lishi kerak (photoSlot qutisi)`);
  }
});

test("ImageWaitPlaque: rasm joyi yo'q maketda umuman chizilmaydi", () => {
  /*
   * Ilgari bu yerda `table` turardi. AUDIT-9 E2 dan keyin `table` o'ng
   * chekkada rasm TASMASINI ko'taradi, ya'ni `photoSlot` quti qaytaradi
   * va plashka ham chizilishi KERAK. Rasm joyi qolmagan maket — `quiz`.
   */
  assert.equal(photoSlot("quiz", "classic"), null);
  const html = renderToStaticMarkup(h(ImageWaitPlaque, { layout: "quiz", visual: "classic", theme }));
  assert.equal(html, "", "quti yo'q ekan, plashka matn ustiga tushmasligi kerak");

  // Tasmali maketda esa plashka AYNAN tasma qutisida turadi.
  const strip = photoSlot("table", "classic");
  assert.ok(strip, "table endi rasm tasmasini ko'taradi (E2)");
  const stripCss = boxStyle(strip!);
  const stripHtml = renderToStaticMarkup(h(ImageWaitPlaque, { layout: "table", visual: "classic", theme }));
  assert.ok(stripHtml.includes(`width:${stripCss.width}px`), "plashka tasma kengligida bo'lishi kerak");
});

test("LiveStrip: bosqich, haqiqiy foiz va sanoqlar", () => {
  const html = renderToStaticMarkup(
    h(LiveStrip, {
      live: sampleLive({ step: "Matn yozilmoqda · 3/12", written: [0, 1], images: { got: 3, want: 9 }, research: { sources: 5 } }),
    }),
  );
  assert.ok(html.includes("Matn yozilmoqda · 3/12"), "bosqich matni");
  assert.ok(html.includes("2/3 slayd"), "slayd sanog'i");
  assert.ok(html.includes("3/9 rasm"), "rasm sanog'i");
  assert.ok(html.includes("5 manba"), "manba sanog'i");
  assert.ok(html.includes("22%"), "haqiqiy foiz");
  assert.ok(html.includes("Sahifani yopsangiz ham ish davom etadi"), "tinchlantiruvchi jumla");
});

test("asLiveView: shakli buzilgan JSON dan jonli rejim yoqilmaydi", () => {
  assert.equal(asLiveView(null), null);
  assert.equal(asLiveView(undefined), null);
  assert.equal(asLiveView("live"), null);
  assert.equal(asLiveView({}), null);
  assert.equal(asLiveView({ ...sampleLive(), slides: [] }), null, "bo'sh deka → jonli rejim yo'q");
  assert.equal(asLiveView({ ...sampleLive(), written: null }), null);
  assert.equal(asLiveView({ ...sampleLive(), images: { got: 1 } }), null);
  assert.equal(asLiveView({ ...sampleLive(), step: 3 }), null);
  assert.ok(asLiveView(sampleLive()), "to'g'ri shakl o'tishi kerak");
});

test("SlideViewer: live berilsa rail'da roles va tasma chiqadi, jonli belgilar bor", () => {
  const html = renderToStaticMarkup(
    h(SlideViewer, { doc: sampleDoc(), live: sampleLive({ step: "Matn yozilmoqda · 3/12" }) }),
  );
  // Sahnada 0-slayd yozilgan, 1 va 2 hali yo'q → eskizlarda rollar.
  assert.ok(html.includes("Kirish"), "yozilmagan slayd eskizida roles[1]");
  assert.ok(html.includes("Xulosa"), "yozilmagan slayd eskizida roles[2]");
  assert.ok(html.includes("data-skeleton=\"1\""), "yozilmagan slaydlar skelet bo'lsin");
  assert.ok(html.includes("data-live-strip=\"1\""), "tasma chizilsin");
  assert.ok(html.includes("Matn yozilmoqda · 3/12"), "tasmada bosqich");
  assert.ok(html.includes("slx-typing"), "«yozilmoqda» nuqtasi");
  // Yozilgan slaydning sarlavhasi haqiqiy matn bilan qoladi.
  assert.ok(html.includes("Sarlavha slaydi"));
});

test("SlideViewer: live'da taqdimot/to'liq ekran/eslatma tugmalari yashirin", () => {
  const plain = renderToStaticMarkup(h(SlideViewer, { doc: sampleDoc() }));
  assert.ok(plain.includes("Eslatma"), "tayyor hujjatda eslatma tugmasi bor");
  assert.ok(plain.includes("To‘liq ekran"), "tayyor hujjatda to'liq ekran tugmasi bor");

  const live = renderToStaticMarkup(h(SlideViewer, { doc: sampleDoc(), live: sampleLive() }));
  assert.ok(!live.includes("To‘liq ekran"), "jonli rejimda to'liq ekran tugmasi bo'lmasin");
  assert.ok(!live.includes(">Eslatma<"), "jonli rejimda eslatma tugmasi bo'lmasin");
});

test("SlideViewer: live berilmasa jonli hech narsa chizilmaydi", () => {
  const html = renderToStaticMarkup(h(SlideViewer, { doc: sampleDoc() }));
  assert.ok(!html.includes("data-skeleton"), "skelet bo'lmasin");
  assert.ok(!html.includes("data-live-strip"), "tasma bo'lmasin");
  assert.ok(!html.includes("data-image-wait"), "plashka bo'lmasin");
});

test("SlideViewer: imageWait dagi sahna slaydida plashka, boshqasida yo'q", () => {
  // 0-slayd yozilgan va sahnada; imageWait unga ishora qiladi.
  const withWait = renderToStaticMarkup(
    h(SlideViewer, { doc: sampleDoc(), live: sampleLive({ imageWait: [0] }) }),
  );
  assert.ok(withWait.includes("Rasm izlanmoqda"), "kutilayotgan slaydda plashka bo'lsin");

  const other = renderToStaticMarkup(
    h(SlideViewer, { doc: sampleDoc(), live: sampleLive({ imageWait: [2] }) }),
  );
  assert.ok(!other.includes("Rasm izlanmoqda"), "boshqa slayd kutayotgan bo'lsa sahnada plashka bo'lmasin");
});

// ───────────────────────── 4. ResultView tanlovi ─────────────────────

const mockRouter: AppRouterInstance = {
  back() {},
  forward() {},
  refresh() {},
  push() {},
  replace() {},
  prefetch() {},
};

function genDetail(over: Partial<GenerationDetail> = {}): GenerationDetail {
  return {
    id: "g1",
    type: "slide",
    topic: "Namunaviy mavzu",
    status: "IN_PROGRESS",
    createdAt: "2024-03-01T10:00:00.000Z",
    price: 2000,
    format: "pptx",
    progress: 31,
    step: "Yaratilmoqda…",
    hasFile: false,
    ...over,
  } as unknown as GenerationDetail;
}

function renderPanel(gen: GenerationDetail): string {
  return renderToStaticMarkup(
    h(AppRouterContext.Provider, { value: mockRouter }, h(RunningPanel, { gen })),
  );
}

test("RunningPanel: IN_PROGRESS + live → skelet va tasma (progress bar emas)", () => {
  const html = renderPanel(genDetail({ live: sampleLive() }));
  assert.ok(html.includes("data-live-strip=\"1\""), "jonli tasma chiqsin");
  assert.ok(html.includes("data-skeleton=\"1\""), "yozilmagan slaydlar skelet bo'lsin");
  assert.ok(!html.includes("role=\"progressbar\" aria-valuenow=\"31\""), "eski progress kartochkasi bo'lmasin");
});

test("RunningPanel: live yo'q → eski progress bar", () => {
  const html = renderPanel(genDetail({ live: null }));
  assert.ok(html.includes("aria-valuenow=\"31\""), "eski progress bar qolishi kerak");
  assert.ok(!html.includes("data-live-strip"), "jonli tasma bo'lmasin");
  assert.ok(!html.includes("data-skeleton"), "skelet bo'lmasin");
});

test("RunningPanel: slayd BO'LMAGAN vosita jonli holat bilan ham eski progress bar", () => {
  // Matn hujjatlari uchun jonli model hali yo'q — `liveDocOf` ularga
  // hech narsa bermaydi, shuning uchun filtr `viewerKind` da.
  const html = renderPanel(genDetail({ type: "essay", live: sampleLive() }));
  assert.ok(html.includes("aria-valuenow=\"31\""), "slayd bo'lmagan vositada eski progress bar");
  assert.ok(!html.includes("data-live-strip"), "jonli tasma bo'lmasin");
});

test("RunningPanel: live shakli buzilgan bo'lsa ham eski progress bar (yiqilish xavfsiz tomonga)", () => {
  const html = renderPanel(genDetail({ live: { stage: "text", progress: 5 } as unknown }));
  assert.ok(html.includes("aria-valuenow=\"31\""));
  assert.ok(!html.includes("data-live-strip"));
});
