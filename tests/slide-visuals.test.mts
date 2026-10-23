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

test("namuna dekalar (galereya) har shablonda xatosiz va chegara ichida — 15 temada", () => {
  for (const t of templates) {
    const deck = sampleDeck(t.id);
    for (const themeId of SLIDE_THEME_IDS) {
      const theme = getSlideTheme(themeId);
      deck.forEach((s, i) => {
        for (const l of planSlide(s, theme, t.visual, i, deck.length, "auto", t.id, { bodyType }).layers) {
          assert.ok(l.box.x >= -0.01 && l.box.y >= -0.01 && l.box.x + l.box.w <= W + 0.01 && l.box.y + l.box.h <= H + 0.01, `${t.id}/${themeId}/#${i}: qatlam tashqarida`);
        }
      });
    }
  }
});

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

/** Har dizayn oltita majburiy maketni O'ZI chizadi (stub yo'q). */
test("har dizayn titul/bo'lim/bandlar/reja/iqtibos/yakunni o'zi chizadi", () => {
  for (const v of DESIGN_VISUALS) {
    for (const l of ["title", "section", "bullets", "agenda", "quote", "closing"]) {
      assert.ok(VISUALS[v].plan[l as SlideLayout], `${v}: «${l}» maketi base ga tushib qolgan`);
    }
  }
});

/** JUFTLIK farqi: titul, bo'lim, bandlar… — har ikki dizaynda boshqacha. */
test("har dizayn juftligi titul/bo'lim/bandlar/reja/iqtibos/yakunda farq qiladi", () => {
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

// ═════════════════ Program 17 (17-band): `conference` va `grid` dizaynlari ═════════════════

type TextL = Extract<ReturnType<typeof planSlide>["layers"][number], { t: "text" }>;
const textLayers = (layers: ReturnType<typeof planSlide>["layers"]) => layers.filter((l): l is TextL => l.t === "text");
const bare = (n: string) => /^\d{1,2}$/.test(n);

test("reyestr: ikki yangi shablon (Ilmiy konferensiya, Minimal grid) — noyob dizayn, guruh, palitra, 10 beat, ≥ 8 to'ldirgich", () => {
  for (const [id, visual, group, theme] of [
    ["conference", "conference", "ilmiy", "summit"],
    ["grid", "grid", "bayon", "clinic"],
  ] as const) {
    const t = SLIDE_TEMPLATE_BY_ID[id];
    assert.equal(t.visual, visual);
    assert.equal(t.group, group);
    assert.equal(t.defaultTheme, theme);
    assert.equal(t.beats.length, 10);
    assert.equal(t.beats[0].layout, "title");
    assert.equal(t.beats[t.beats.length - 1].layout, "closing");
    assert.ok(t.fillers.length >= 8, `${id}: to'ldirgichlar`);
    assert.ok((DESIGN_VISUALS as readonly string[]).includes(visual));
    assert.equal(templates.filter((x) => x.visual === visual).length, 1, `${id}: dizayn bitta shablonniki`);
  }
  assert.equal(SLIDE_TEMPLATES.length, 13, "auto + 12 shablon");
  assert.equal(DESIGN_VISUALS.length, 12);
});

test("conference: har mazmun slaydi tepasida to'liq kenglikdagi to'q tasma; reja — raqamli plitkalar; bo'limda chapda to'q panel", () => {
  const theme = getSlideTheme("atlas");
  const band = (layout: SlideLayout) => {
    const p = planSlide(sampleFor(layout), theme, "conference", 2, 9, "auto", "conference", { bodyType });
    return p.layers.find((l) => l.t === "rect" && l.box.x === 0 && l.box.y === 0 && l.box.w >= W - 0.01 && l.box.h > 1 && l.box.h < 1.6 && l.fill?.color === theme.titleBg);
  };
  assert.ok(band("bullets"), "bullets: tasma yo'q");
  assert.ok(band("agenda"), "agenda: tasma yo'q");
  assert.ok(!band("quote"), "quote: tasma bo'lmasligi kerak (u chap panelli)");
  // Reja: «01 02 03» to'q kvadratlar ichida, matn src bilan.
  const ag = planSlide(sampleFor("agenda"), theme, "conference", 2, 9, "auto", "conference", { bodyType });
  const nums = textLayers(ag.layers).filter((l) => bare(l.text ?? "") && l.src === undefined).map((l) => l.text);
  assert.deepEqual(nums, ["01", "02", "03"]);
  // Bo'lim: chap panel kengligi 4.6″ va raqam FAQAT rejadan.
  const sec = { ...sampleFor("section"), plan: 2 };
  const sp = planSlide(sec, theme, "conference", 2, 9, "auto", "conference", { bodyType });
  const panel = sp.layers.find((l) => l.t === "rect" && l.box.x === 0 && l.box.w > 4 && l.box.w < 5 && l.box.h >= H - 0.01);
  assert.ok(panel, "bo'lim chap paneli");
  assert.deepEqual(textLayers(sp.layers).map((l) => l.text ?? "").filter(bare), ["02"]);
  assert.deepEqual(textLayers(planSlide(sampleFor("section"), theme, "conference", 2, 9, "auto", "conference", { bodyType }).layers).map((l) => l.text ?? "").filter(bare), []);
});

test("grid: bandlar — har biri o'z plitkasi (tartib raqami + src matn); yolg'iz oxirgi plitka butun qatorni oladi; rasm — plitka", () => {
  const theme = getSlideTheme("atlas");
  for (const withImg of [false, true]) {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const s = sampleFor("bullets");
      s.bullets = Array.from({ length: n }, (_, i) => `Band ${i + 1} matni.`);
      if (!withImg) delete s.image;
      const bt = bodyRules({ planItems: 5, textVolume: "standart" }, "lecture");
      const p = planSlide(s, theme, "grid", 2, 9, "auto", "grid", { bodyType: { ...bt, maxBullets: 6 } });
      const tag = `grid/bullets/${n}/${withImg ? "rasm" : "rasmsiz"}`;
      const rows = textLayers(p.layers).filter((l) => l.src?.f === "bullets");
      assert.equal(rows.length, n, `${tag}: band plitkalari`);
      assert.deepEqual(rows.map((l) => (l.src as { i: number }).i), Array.from({ length: n }, (_, i) => i), `${tag}: src indekslari`);
      const ords = textLayers(p.layers).filter((l) => bare(l.text ?? "") && l.src === undefined).map((l) => l.text);
      assert.deepEqual(ords, Array.from({ length: n }, (_, i) => String(i + 1)), `${tag}: tartib raqamlari`);
      const img = p.layers.filter((l) => l.t === "image");
      assert.equal(img.length, withImg ? 1 : 0, `${tag}: rasm plitkasi`);
      // Plitkalar kesishmaydi (rasm plitkasi bilan ham).
      const rects = p.layers.filter((l) => l.t === "rect" && l.line && l.box.h > 1);
      for (let i = 0; i < rects.length; i++)
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i].box, b = rects[j].box;
          const ov = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.01 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.01;
          assert.ok(!ov, `${tag}: plitkalar kesishdi`);
        }
      if (withImg) for (const r of rects) assert.ok(!(Math.min(r.box.x + r.box.w, 4.5) - Math.max(r.box.x, 0.6) > 0.01), `${tag}: plitka rasm ustiga chiqdi`);
      // Toq soni ikki ustunda — oxirgi plitka to'la kenglikda.
      if (withImg && n >= 3 && n % 2 === 1) {
        const widths = rects.map((r) => r.box.w);
        assert.ok(Math.max(...widths) > 1.8 * Math.min(...widths), `${tag}: yolg'iz plitka kengaymadi`);
      }
    }
  }
});

test("grid: bo'lim raqami — ulkan (≥ 120 pt) va FAQAT rejadan; titul/yakunda yalang raqam yo'q", () => {
  const theme = getSlideTheme("atlas");
  const sec = planSlide({ ...sampleFor("section"), plan: 3 }, theme, "grid", 2, 9, "auto", "grid", { bodyType });
  const big = textLayers(sec.layers).filter((l) => l.text === "03");
  assert.equal(big.length, 1);
  assert.ok(big[0].size >= 120, `raqam ${big[0].size} pt`);
  for (const layout of ["title", "closing"] as const) {
    const p = planSlide({ ...sampleFor(layout), plan: 3 }, theme, "grid", 2, 9, "auto", "grid", { bodyType });
    assert.deepEqual(textLayers(p.layers).map((l) => l.text ?? "").filter(bare), [], `grid/${layout}`);
  }
});

test("yangi dizaynlar: rasm slotlari — titul/bandlar/iqtibos/yakunda; boshqalarda null; slot ichida rasm qatlami AYNAN shu quti", () => {
  const theme = getSlideTheme("atlas");
  for (const v of ["conference", "grid"] as const) {
    for (const layout of ["title", "bullets", "quote", "closing"] as const) {
      const slot = photoSlot(layout, v);
      const p = planSlide(sampleFor(layout), theme, v, 2, 9, "auto", v, { bodyType });
      const im = p.layers.filter((l) => l.t === "image");
      if (v === "conference" && layout === "quote") {
        assert.equal(slot, null);
        assert.equal(im.length, 0);
        continue;
      }
      assert.ok(slot, `${v}/${layout}: slot`);
      assert.equal(im.length, 1, `${v}/${layout}: rasm qatlami`);
      assert.deepEqual(im[0].box, slot, `${v}/${layout}: rasm qutisi slotdan farq qiladi`);
    }
    for (const layout of ["section", "agenda"] as const) assert.equal(photoSlot(layout, v), null, `${v}/${layout}`);
  }
});

test("yangi dizaynlar: tahrir `src` xaritasi to'liq — kicker, sarlavha, izoh, iqtibos, muallif, reja bandlari, kolontitul", () => {
  const theme = getSlideTheme("atlas");
  const want: Record<string, string[]> = {
    title: ["kicker", "title", "subtitle", "footer"],
    section: ["title", "subtitle", "footer"],
    bullets: ["title", "bullets", "footer"],
    agenda: ["title", "bullets", "footer"],
    quote: ["quote", "quoteBy", "footer"],
    closing: ["title", "subtitle", "footer"],
  };
  for (const v of ["conference", "grid"] as const) {
    for (const [layout, fields] of Object.entries(want)) {
      const s = sampleFor(layout as SlideLayout);
      const p = planSlide(s, theme, v, 2, 9, "auto", v, { bodyType });
      for (const f of fields) {
        const hit = textLayers(p.layers).filter((l) => l.src?.f === f || l.srcLines?.some((x) => x?.f === f));
        assert.ok(hit.length >= 1, `${v}/${layout}: «${f}» src qatlami yo'q`);
        // Maydon matni aynan model matni (transformatsiyasiz): tahrir ko'rsatkichi to'g'ri joyga borishi uchun.
        if (f === "quoteBy") assert.equal(hit[0].text, s.quoteBy);
        if (f === "quote") assert.equal(hit[0].text, s.quote);
        if (f === "kicker") assert.equal(hit[0].text, s.kicker);
        if (f === "subtitle") assert.equal(hit[0].text, s.subtitle);
      }
    }
  }
});
