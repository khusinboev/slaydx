import test from "node:test";
import assert from "node:assert/strict";
import { planSlide, photoSlot, LAYOUT_KIT } from "../lib/generation/slide-layout.ts";
import { getSlideTheme } from "../lib/generation/slide-themes.ts";
import { SLIDE_TEMPLATES, SLIDE_TEMPLATE_BY_ID, type SlideVisual } from "../lib/generation/slide-templates.ts";
import { SLIDE_LAYOUTS, SLIDE_THEME_IDS, type SlideLayout, type SlideModel } from "../lib/generation/slide-types.ts";
import { bodyRules } from "../lib/generation/slide-audience.ts";
import { sampleDeck } from "../lib/generation/slide-samples.ts";
import { DESIGN_VISUALS, VISUALS } from "../lib/generation/visuals/index.ts";

/**
 * Shablonlar 2 — dizaynlar (`lib/generation/visuals/`) uchun umumiy
 * shartnoma: har shablon × har maket XATOSIZ chiziladi, qatlamlar slayd
 * ichida, modeldan kelgan matn `src` ko'taradi, rasm sloti bor maketda
 * `photoSlot` bor va dizaynlar BIR-BIRIDAN farq qiladi.
 */
const bodyType = bodyRules({ planItems: 5, textVolume: "standart" }, "lecture");
const W = 13.333;
const H = 7.5;
const LONG = "Juda uzun band matni bo‘lib, u qutiga sig‘masligi mumkin va shrift poliga uriladi. ".repeat(3);

function sampleFor(layout: SlideLayout, long = false): SlideModel {
  const t = long ? LONG : "Sarlavha matni";
  const bullets = long ? Array.from({ length: 6 }, () => LONG) : ["Birinchi band gapi.", "Ikkinchi band gapi.", "Uchinchi band gapi."];
  return {
    id: "s",
    layout,
    kicker: "Fan · sinf",
    title: t,
    subtitle: long ? LONG : "Izoh matni bu yerda.",
    image: { url: "https://example.test/a.png" },
    bullets,
    leftTitle: "Chap",
    left: bullets.slice(0, 3),
    rightTitle: "O‘ng",
    right: bullets.slice(0, 2),
    quote: long ? LONG : "Iqtibos matni.",
    quoteBy: "Muallif",
    stats: [{ value: "12%", label: long ? LONG : "ulush" }, { value: "3", label: "faza" }, { value: "700", label: "nm" }],
    steps: [{ n: "1", title: "Bir", text: long ? LONG : "Izoh" }, { n: "2", title: "Ikki", text: "Izoh" }, { n: "3", title: "Uch", text: "Izoh" }],
    table: { headers: ["A", "B", "C"], rows: [["1", "2", "3"], ["4", "5", "6"]] },
    quiz: [{ q: "Savol?", options: ["Bir", "Ikki", "Uch", "To‘rt"], answer: 0 }],
    refs: [{ title: "Manba", source: "example.org" }],
  } as SlideModel;
}

const templates = SLIDE_TEMPLATES.filter((t) => t.id !== "auto");
const themes = ["atlas", "chalk", "ink"] as const;

test("har shablon × har maket × 3 tema: xatosiz, qatlamlar slayd ichida (qisqa va uzun matn, rasmli/rasmsiz)", () => {
  for (const t of templates) {
    for (const themeId of themes) {
      const theme = getSlideTheme(themeId);
      for (const layout of SLIDE_LAYOUTS) {
        for (const long of [false, true]) {
          for (const withImg of [true, false]) {
            const s = sampleFor(layout, long);
            if (!withImg) delete s.image;
            const plan = planSlide(s, theme, t.visual, 2, 9, "auto", t.id, { bodyType, logo: withImg ? "data:image/png;base64,iVBORw0KGgo=" : undefined });
            assert.ok(plan.layers.length > 0, `${t.id}/${layout}: bo'sh reja`);
            for (const l of plan.layers) {
              const tag = `${t.id}/${t.visual}/${layout}/${themeId}/${long ? "uzun" : "qisqa"}/${withImg ? "rasm" : "rasmsiz"}`;
              assert.ok(l.box.x >= -0.01 && l.box.y >= -0.01, `${tag}: manfiy koordinata`);
              assert.ok(l.box.w >= 0 && l.box.h >= 0, `${tag}: manfiy o'lcham`);
              assert.ok(l.box.x + l.box.w <= W + 0.01, `${tag}: kenglikdan chiqdi (${l.t})`);
              assert.ok(l.box.y + l.box.h <= H + 0.01, `${tag}: balandlikdan chiqdi (${l.t})`);
              if (l.t === "text") assert.ok(l.size >= 9, `${tag}: shrift ${l.size} pt juda kichik`);
            }
          }
        }
      }
    }
  }
});

test("modeldan kelgan matn `src` ko'taradi: sarlavha, izoh, bandlar, iqtibos — har shablonda", () => {
  const theme = getSlideTheme("atlas");
  for (const t of templates) {
    for (const layout of ["title", "section", "bullets", "agenda", "quote", "closing"] as const) {
      const s = sampleFor(layout);
      const plan = planSlide(s, theme, t.visual, 2, 9, "auto", t.id, { bodyType });
      const texts = plan.layers.filter((l) => l.t === "text");
      const has = (f: string) => texts.some((l) => l.t === "text" && (l.src?.f === f || l.srcLines?.some((x) => x?.f === f)));
      if (layout === "quote") assert.ok(has("quote"), `${t.id}/${layout}: iqtibos src siz`);
      else assert.ok(has("title"), `${t.id}/${layout}: sarlavha src siz`);
      if (layout === "bullets" || layout === "agenda") assert.ok(has("bullets"), `${t.id}/${layout}: bandlar src siz`);
      if (layout === "title" || layout === "closing" || layout === "section") assert.ok(has("subtitle"), `${t.id}/${layout}: izoh src siz`);
      // Kolontitul har slaydda (tahrirlanadi).
      assert.ok(has("footer"), `${t.id}/${layout}: kolontitul yo'q`);
    }
  }
});

test("rasm ko'taradigan maketlarda `photoSlot` bor va slayd ichida; dumaloq rasm — kvadrat quti", () => {
  for (const t of templates) {
    for (const layout of ["title", "section", "bullets", "agenda", "quote", "closing"] as const) {
      const slot = photoSlot(layout, t.visual);
      if (!slot) continue;
      assert.ok(slot.x >= 0 && slot.y >= 0 && slot.x + slot.w <= W + 0.01 && slot.y + slot.h <= H + 0.01, `${t.id}/${layout}: rasm sloti tashqarida`);
      const plan = planSlide(sampleFor(layout), getSlideTheme("atlas"), t.visual, 2, 9, "auto", t.id, { bodyType });
      for (const l of plan.layers) {
        if (l.t === "image" && l.shape === "circle") {
          assert.ok(Math.abs(l.box.w - l.box.h) < 0.01, `${t.id}/${layout}: dumaloq rasm qutisi kvadrat emas`);
        }
      }
    }
  }
});

test("har shablon o'z dizaynini oladi — dizayn id lari noyob, reyestrda bor", () => {
  const seen = new Set<SlideVisual>();
  for (const t of templates) {
    assert.ok((DESIGN_VISUALS as readonly string[]).includes(t.visual), `${t.id}: eski oila emas, dizayn bo'lishi kerak (${t.visual})`);
    assert.ok(!seen.has(t.visual), `${t.id}: «${t.visual}» dizayni boshqa shablon bilan bo'lishilgan`);
    seen.add(t.visual);
    assert.ok(SLIDE_THEME_IDS.includes(t.defaultTheme), `${t.id}: standart palitra reyestrda yo'q`);
  }
  assert.equal(SLIDE_TEMPLATE_BY_ID.auto.visual, "academic");
});

/**
 * JUFTLIK farqi: titul, bo'lim, bandlar — har ikki dizaynda boshqacha.
 * Dizaynlar chizilgunicha (stub) `todo`; hammasi tayyor bo'lgach oddiy
 * testga aylanadi.
 */
const allDrawn = DESIGN_VISUALS.every((v) => ["title", "section", "bullets", "agenda", "quote", "closing"].every((l) => VISUALS[v].plan[l as SlideLayout]));
test("har dizayn juftligi titul/bo'lim/bandlar/reja/iqtibos/yakunda farq qiladi", { todo: !allDrawn }, () => {
  const theme = getSlideTheme("atlas");
  const keyOf = (v: SlideVisual, layout: SlideLayout) =>
    JSON.stringify(planSlide(sampleFor(layout), theme, v, 2, 9, "auto", "lecture", { bodyType }).layers.map((l) => ({ ...l, url: undefined })));
  for (let i = 0; i < DESIGN_VISUALS.length; i++) {
    for (let j = i + 1; j < DESIGN_VISUALS.length; j++) {
      for (const layout of ["title", "section", "bullets", "agenda", "quote", "closing"] as const) {
        assert.notEqual(keyOf(DESIGN_VISUALS[i], layout), keyOf(DESIGN_VISUALS[j], layout), `${DESIGN_VISUALS[i]} va ${DESIGN_VISUALS[j]}: «${layout}» bir xil`);
      }
    }
  }
  // Har dizayn majburiy maketlarni o'zi chizadi.
  for (const v of DESIGN_VISUALS) {
    for (const l of ["title", "section", "bullets", "agenda", "quote", "closing"] as const) {
      assert.ok(VISUALS[v].plan[l], `${v}: «${l}» maketi dizaynda chizilmagan`);
    }
  }
  void LAYOUT_KIT;
});
