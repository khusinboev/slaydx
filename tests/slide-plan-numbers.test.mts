import test from "node:test";
import assert from "node:assert/strict";
import { LAYOUT_KIT, planSlide, type SlideLayer } from "../lib/generation/slide-layout.ts";
import { bodyRules } from "../lib/generation/slide-audience.ts";
import { getSlideTheme } from "../lib/generation/slide-themes.ts";
import { SLIDE_LAYOUTS, SLIDE_THEME_IDS, type SlideLayout, type SlideModel } from "../lib/generation/slide-types.ts";
import { DESIGN_VISUALS, LEGACY_VISUALS } from "../lib/generation/visuals/index.ts";
import type { SlideVisual } from "../lib/generation/slide-templates.ts";

/**
 * AUDIT-25, 4-qaror — «Raqam faqat rejadan».
 *
 * Egasi shikoyati: «reja raqamlari slaydlarda xato, ba'zida shunchaki
 * "3" raqami turadi». Sabab: bo'lim slaydidagi yirik «03» va hikoya
 * bandlaridagi kicker raqami DEKADAGI TARTIB (`index + 1`) edi — reja
 * bandi emas. Reja 4 band bo'lsa ham, 7-slayddagi bo'lim «07» ko'rsatardi.
 *
 * Shartnoma (bu fayl qulflaydi):
 *   1. `section` slaydi `plan: 3` bilan — AYNAN BITTA dekorativ «03»
 *      (hamma maketda ikki xonali, `src`siz). Deka indeksi (7) hech
 *      qayerda ko'rinmaydi.
 *   2. `plan` yo'q — bo'lim slaydida yalang 1–2 xonali raqam YO'Q
 *      (eski doc_json ham shunday chiziladi).
 *   3. HECH BIR maketda matn deka indeksiga bog'liq emas — faqat
 *      kolontitul sahifa hisoblagichi («3 / 10») bundan mustasno.
 *   4. Ro'yxat tartib raqamlari (reja 01…N, bosqich `n`, test A–D)
 *      ro'yxat ichida ma'noli — QOLADI.
 *   5. Hech bir qatlam slayddan chiqmaydi.
 *
 * `plan` maydoni P1 da `SlideModel` ga qo'shiladi; unga qadar test uni
 * kesishma turi bilan beradi.
 */

type PlanSlide = SlideModel & { plan?: number };
type TextLayer = Extract<SlideLayer, { t: "text" }>;

const W = 13.333;
const H = 7.5;
const VISUALS = [...LEGACY_VISUALS, ...DESIGN_VISUALS] as SlideVisual[];
const IMG = "https://example.test/a.png";
/** Deka indeksi ATAYLAB rejadan farqli: 6 → «07» ko'rinsa, raqam indeksdan. */
const INDEX = 6;
const TOTAL = 12;

const texts = (ls: SlideLayer[]) => ls.filter((l): l is TextLayer => l.t === "text");
const textOf = (l: TextLayer) => (l.text ?? (l.lines ?? []).join("\n")).trim();
const BARE_NUMBER = /^\d{1,2}$/;
const PAGE_COUNTER = /^\d+\s*\/\s*\d+$/;

function section(opts: { plan?: number; img: boolean; sub: boolean }): PlanSlide {
  const s: PlanSlide = {
    id: "sec",
    layout: "section",
    title: "Orol dengizining qurishi sabablari",
    ...(opts.sub ? { subtitle: "Sug'orish, iqlim va inson omili — uchta asosiy yo'nalish" } : {}),
    ...(opts.img ? { image: { url: IMG } } : {}),
  };
  if (opts.plan !== undefined) s.plan = opts.plan;
  return s;
}

function assertInside(layers: SlideLayer[], tag: string) {
  for (const l of layers) {
    assert.ok(l.box.x >= -0.01 && l.box.y >= -0.01, `${tag}: manfiy koordinata (${l.t})`);
    assert.ok(l.box.x + l.box.w <= W + 0.01, `${tag}: kenglikdan chiqdi (${l.t})`);
    assert.ok(l.box.y + l.box.h <= H + 0.01, `${tag}: balandlikdan chiqdi (${l.t})`);
  }
}

const VARIANTS = [
  { img: true, sub: true },
  { img: false, sub: true },
  { img: false, sub: false },
  { img: true, sub: false },
];

test("bo'lim slaydi plan: 3 — har maket × har temada AYNAN bitta dekorativ «03», indeks ko'rinmaydi", () => {
  for (const visual of VISUALS) {
    for (const themeId of SLIDE_THEME_IDS) {
      const theme = getSlideTheme(themeId);
      for (const v of VARIANTS) {
        const tag = `${visual}/${themeId}/${v.img ? "rasm" : "rasmsiz"}/${v.sub ? "izohli" : "izohsiz"}`;
        const plan = planSlide(section({ ...v, plan: 3 }), theme, visual, INDEX, TOTAL);
        const nums = texts(plan.layers).filter((l) => BARE_NUMBER.test(textOf(l)));
        assert.deepEqual(
          nums.map(textOf),
          ["03"],
          `${tag}: bo'lim raqami rejadan «03» bo'lishi kerak, topildi ${JSON.stringify(nums.map(textOf))}`,
        );
        assert.equal(nums[0].src, undefined, `${tag}: bo'lim raqami dekorativ — src olmaydi`);
        assert.equal(nums[0].srcLines, undefined, `${tag}: bo'lim raqami dekorativ — srcLines olmaydi`);
        assertInside(plan.layers, tag);
      }
    }
  }
});

test("bo'lim slaydi plan'siz — hech bir maketda yalang raqam chizilmaydi", () => {
  for (const visual of VISUALS) {
    for (const themeId of SLIDE_THEME_IDS) {
      const theme = getSlideTheme(themeId);
      for (const v of VARIANTS) {
        const tag = `${visual}/${themeId}/${v.img ? "rasm" : "rasmsiz"}/${v.sub ? "izohli" : "izohsiz"}`;
        const plan = planSlide(section(v), theme, visual, INDEX, TOTAL);
        const nums = texts(plan.layers).map(textOf).filter((t) => BARE_NUMBER.test(t));
        assert.deepEqual(nums, [], `${tag}: plan'siz bo'limda raqam chizildi: ${JSON.stringify(nums)}`);
        assertInside(plan.layers, tag);
      }
    }
  }
});

test("plan 1..12 to'g'ri formatlanadi, noto'g'ri qiymat (0, -1, 2.5, NaN) raqam bermaydi", () => {
  const theme = getSlideTheme("atlas");
  for (const visual of VISUALS) {
    for (const n of [1, 9, 12]) {
      const nums = texts(planSlide(section({ img: false, sub: true, plan: n }), theme, visual, INDEX, TOTAL).layers)
        .map(textOf)
        .filter((t) => BARE_NUMBER.test(t));
      assert.deepEqual(nums, [String(n).padStart(2, "0")], `${visual}: plan ${n}`);
    }
    for (const bad of [0, -1, 2.5, Number.NaN]) {
      const nums = texts(planSlide(section({ img: false, sub: true, plan: bad }), theme, visual, INDEX, TOTAL).layers)
        .map(textOf)
        .filter((t) => BARE_NUMBER.test(t));
      assert.deepEqual(nums, [], `${visual}: plan ${bad} raqam bermasligi kerak`);
    }
  }
});

/** Har maket uchun to'la namuna — ro'yxat tartib raqamlari ham chiqsin. */
function sampleFor(layout: SlideLayout, img: boolean): PlanSlide {
  return {
    id: "s",
    layout,
    kicker: "Geografiya · 8-sinf",
    title: "Sarlavha matni",
    subtitle: "Izoh matni bu yerda.",
    ...(img ? { image: { url: IMG } } : {}),
    bullets: ["Birinchi band gapi.", "Ikkinchi band gapi.", "Uchinchi band gapi."],
    leftTitle: "Chap",
    left: ["Bir", "Ikki"],
    rightTitle: "O'ng",
    right: ["Uch", "To'rt"],
    quote: "Iqtibos matni.",
    quoteBy: "Muallif",
    stats: [{ value: "12%", label: "ulush" }, { value: "40 km", label: "masofa" }],
    steps: [
      { n: "1", title: "Bir", text: "Izoh" },
      { n: "2", title: "Ikki", text: "Izoh" },
      { n: "3", title: "Uch", text: "Izoh" },
    ],
    table: { headers: ["A", "B"], rows: [["x", "y"]] },
    quiz: [{ q: "Savol?", options: ["Bir", "Ikki", "Uch", "To'rt"], answer: 0 }],
    refs: [{ title: "Manba", source: "example.org" }],
  };
}

/** Kolontitul hisoblagichidan tashqari barcha matnlar. */
function contentTexts(layers: SlideLayer[]): string[] {
  return texts(layers)
    .map(textOf)
    .filter((t) => !PAGE_COUNTER.test(t));
}

test("hech bir maket × dizaynda matn deka indeksiga bog'liq emas (sahifa hisoblagichidan tashqari)", () => {
  const theme = getSlideTheme("atlas");
  for (const visual of VISUALS) {
    for (const layout of SLIDE_LAYOUTS) {
      for (const img of [true, false]) {
        for (const planNo of [undefined, 2]) {
          const s = sampleFor(layout, img);
          if (planNo !== undefined) s.plan = planNo;
          const tag = `${visual}/${layout}/${img ? "rasm" : "rasmsiz"}/plan=${planNo ?? "-"}`;
          const a = contentTexts(planSlide(s, theme, visual, 0, TOTAL).layers);
          const b = contentTexts(planSlide(s, theme, visual, INDEX, TOTAL).layers);
          assert.deepEqual(b, a, `${tag}: indeks 0 → ${INDEX} matnni o'zgartirdi`);
        }
      }
    }
  }
});

test("hikoya (story) bandlari: rasmsiz kolonkada raqam FAQAT rejadan", () => {
  const theme = getSlideTheme("ink");
  const withPlan = sampleFor("bullets", false);
  withPlan.plan = 4;
  const nums = texts(planSlide(withPlan, theme, "story", INDEX, TOTAL).layers).map(textOf).filter((t) => BARE_NUMBER.test(t));
  assert.deepEqual(nums, ["04"], "story bandlari plan: 4 → «04»");
  const bare = texts(planSlide(sampleFor("bullets", false), theme, "story", INDEX, TOTAL).layers)
    .map(textOf)
    .filter((t) => BARE_NUMBER.test(t));
  assert.deepEqual(bare, [], "story bandlari plan'siz — raqam yo'q");
});

test("titul slaydida deka indeksi raqami yo'q (titul rejaga tegishli emas)", () => {
  for (const visual of VISUALS) {
    for (const img of [true, false]) {
      const s = sampleFor("title", img);
      const nums = texts(planSlide(s, getSlideTheme("atlas"), visual, 0, TOTAL).layers)
        .map(textOf)
        .filter((t) => BARE_NUMBER.test(t));
      assert.deepEqual(nums, [], `${visual}/${img ? "rasm" : "rasmsiz"}: titulda «${nums.join(",")}»`);
      assertInside(planSlide(s, getSlideTheme("atlas"), visual, 0, TOTAL).layers, `${visual}/title`);
    }
  }
});

test("ro'yxat tartib raqamlari qoladi: reja 1..N, bosqich n, test A–D", () => {
  const theme = getSlideTheme("atlas");
  const ord = (t: string, n: number) => t === String(n) || t === String(n).padStart(2, "0") || t === `${n}.`;
  for (const visual of VISUALS) {
    // Reja (agenda) — har qator o'z tartib raqamini oladi (plan'dan qat'i nazar).
    // `notebook` rejasi — raqamsiz katakchalar (dizayn shunday, AUDIT-13).
    if (visual !== "notebook") {
      const agenda = contentTexts(planSlide(sampleFor("agenda", false), theme, visual, INDEX, TOTAL).layers);
      const joined = agenda.join("\n");
      for (const n of [1, 2, 3]) {
        assert.ok(
          agenda.some((t) => ord(t, n)) || new RegExp(`(^|\\n)0?${n}[.)]? `).test(joined),
          `${visual}/agenda: ${n}-qator tartib raqami yo'qoldi: ${JSON.stringify(agenda)}`,
        );
      }
    }
    // Raqamli band kartalari (ro'yxat ichidagi tartib) — dizaynlar (rail
    // bandlari raqamsiz tugunlar, story/split — abzats/ro'yxat, ya'ni raqamsiz).
    if (["circle", "notebook", "editorial", "bold"].includes(visual)) {
      const bl = contentTexts(planSlide(sampleFor("bullets", false), theme, visual, INDEX, TOTAL).layers);
      for (const n of [1, 2, 3]) assert.ok(bl.some((t) => ord(t, n)), `${visual}/bullets: «${n}» karta raqami yo'q: ${JSON.stringify(bl)}`);
    }
    // Bosqichlar — `n` modeldan.
    const proc = contentTexts(planSlide(sampleFor("process", false), theme, visual, INDEX, TOTAL).layers);
    for (const n of [1, 2, 3]) assert.ok(proc.some((t) => ord(t, n)), `${visual}/process: «${n}» yo'q: ${JSON.stringify(proc)}`);
    // Test variantlari — harflar.
    const quiz = contentTexts(planSlide(sampleFor("quiz", false), theme, visual, INDEX, TOTAL).layers).join("\n");
    for (const letter of ["A", "B", "C", "D"]) {
      assert.ok(new RegExp(`(^|\\n|\\s)${letter}[).]?(\\s|$)`).test(quiz), `${visual}/quiz: «${letter}» yo'q`);
    }
  }
});

// ═══════════════════════════════════════════ A2-04: auditoriya shrift poli

/**
 * AUDIT-25 A2-04 («process kartalari mayda»). `planProcess`/`planStats`/
 * `planTable` (va `rail` bosqichlari, `bold`/`dashboard` raqamlari)
 * shrift polini QAT'IY (10–15 pt) yozardi — auditoriya poli
 * (`bodyType.minPt`, Slide Law: 1–4-sinf 24 pt) e'tiborsiz edi. Boshqa
 * hamma maket `minPt` ni o'qiydi. Endi bu matnlar ham auditoriya
 * polidan kichik chizilmaydi (bosqich `n` — tartib belgisi, tana matni
 * emas, u tekshiruvdan tashqari).
 */
const AUDIENCES = ["school_1_4", "school_5_7", "school_10_11", "students_bachelor", "general"] as const;

/**
 * `long` — polda ham sig'maydigan matn: pol QAT'IY ekanini aynan shu
 * holat sinaydi (qisqa matn `bodyPt` da sig'adi va pol hech qachon
 * ishga tushmaydi — mutatsiya tekshiruvi shuni ko'rsatdi).
 */
const LONG_TXT = "Orol dengizi havzasida sug'orish uchun olingan suv hajmi o'n yillar davomida muttasil oshib bordi va dengiz sathi keskin pasaydi. ".repeat(2);

function floorCase(layout: SlideLayout, chart: boolean, long = false): PlanSlide {
  const s = sampleFor(layout, false);
  if (long) {
    s.steps = [1, 2, 3].map((n) => ({ n: String(n), title: LONG_TXT.slice(0, 90), text: LONG_TXT }));
    s.stats = chart
      ? [{ value: "68%", label: LONG_TXT.slice(0, 120) }, { value: "22%", label: LONG_TXT.slice(0, 120) }, { value: "10%", label: LONG_TXT.slice(0, 120) }]
      : [{ value: "68%", label: LONG_TXT }, { value: "40 km", label: LONG_TXT }];
    s.table = { headers: [LONG_TXT.slice(0, 60), "Maydon", "Sho'rlik"], rows: [[LONG_TXT, LONG_TXT, "10 g/l"], ["2020", LONG_TXT, "100 g/l"]] };
    return s;
  }
  s.steps = [
    { n: "1", title: "Kuzatish", text: "Suv sathini har oy o'lchab, jadvalga yozamiz." },
    { n: "2", title: "Taqqoslash", text: "Oldingi yil bilan solishtirib, farqni topamiz." },
    { n: "3", title: "Xulosa", text: "Sababini tushuntirib, taklif beramiz." },
  ];
  s.stats = chart
    ? [{ value: "68%", label: "Sug'orish" }, { value: "22%", label: "Iqlim" }, { value: "10%", label: "Boshqa" }]
    : [{ value: "68%", label: "sug'orishga ketadi" }, { value: "40 km", label: "qirg'oq chekindi" }];
  s.table = { headers: ["Yil", "Maydon", "Sho'rlik"], rows: [["1960", "68 ming km²", "10 g/l"], ["2020", "8 ming km²", "100 g/l"]] };
  return s;
}

test("A2-04: bosqich/raqam/jadval matni auditoriya polidan (minPt) kichik emas — har maket", () => {
  const theme = getSlideTheme("atlas");
  for (const aud of AUDIENCES) {
    const bodyType = bodyRules({ slideAudience: aud, textVolume: "standart", planItems: 4 }, "lecture");
    for (const visual of VISUALS) {
      for (const [layout, chart, long] of [
        ["process", false, false],
        ["process", false, true],
        ["stats", false, false],
        ["stats", false, true],
        ["stats", true, false],
        ["stats", true, true],
        ["table", false, false],
        ["table", false, true],
      ] as const) {
        const plan = planSlide(floorCase(layout, chart, long), theme, visual, 3, TOTAL, aud, "lecture", { bodyType });
        const body = texts(plan.layers).filter((l) => {
          const f = l.src?.f;
          if (f === "steps") return (l.src as { k: string }).k !== "n";
          return f === "stats" || f === "table";
        });
        assert.ok(body.length > 0, `${aud}/${visual}/${layout}: tana matni topilmadi`);
        for (const l of body) {
          assert.ok(
            l.size >= bodyType.minPt,
            `${aud}/${visual}/${layout}${chart ? "/diagramma" : ""}${long ? "/uzun" : ""}: «${textOf(l).slice(0, 30)}» ${l.size} pt < pol ${bodyType.minPt} pt`,
          );
        }
        assertInside(plan.layers, `${aud}/${visual}/${layout}`);
      }
    }
  }
});

test("A2-04: 1–4-sinf bosqichlari (minPt 24) — matn 24 pt dan kichik emas va oddiy matn qutiga sig'adi", () => {
  const theme = getSlideTheme("atlas");
  const bodyType = bodyRules({ slideAudience: "school_1_4", textVolume: "standart", planItems: 4 }, "lecture");
  assert.equal(bodyType.minPt, 24);
  for (const visual of VISUALS) {
    const plan = planSlide(floorCase("process", false), theme, visual, 3, TOTAL, "school_1_4", "lecture", { bodyType });
    const steps = texts(plan.layers).filter((l) => l.src?.f === "steps" && (l.src as { k: string }).k !== "n");
    assert.equal(steps.length, 6, `${visual}: 3 × (sarlavha + matn) kutilgan`);
    for (const l of steps) {
      assert.ok(l.size >= 24, `${visual}: «${textOf(l)}» ${l.size} pt`);
      const ink = LAYOUT_KIT.inkHeight(textOf(l), l.box.w, l.size);
      assert.ok(ink <= l.box.h + 0.01, `${visual}: «${textOf(l)}» ${l.size} pt da ${ink.toFixed(2)}″ — quti ${l.box.h.toFixed(2)}″ dan chiqdi`);
    }
  }
});

/**
 * Katta shrift joy talab qiladi: ikki qatorli (5 bosqich) oqimda izoh
 * qutisi ilgari QAT'IY `y + 1.78` dan boshlanardi — karta 2.45″ bo'lsa
 * izohga 0.5″ (bir qator) qolardi va auditoriya polida matn chiqib
 * ketardi. Endi sarlavha qutisi siyoh balandligida, qolgani izohga.
 */
test("A2-04: ikki qatorli oqim (5 bosqich) — auditoriya polida oddiy izoh qutiga sig'adi", () => {
  const theme = getSlideTheme("atlas");
  const bodyType = bodyRules({ slideAudience: "general", textVolume: "standart", planItems: 4 }, "lecture");
  const s = floorCase("process", false);
  s.steps = ["Kuzatish", "Taqqoslash", "Tahlil", "Xulosa", "Taklif"].map((title, i) => ({
    n: String(i + 1),
    title,
    text: "Suv sathini har oy o'lchab, jadvalga yozamiz.",
  }));
  // `rail` bosqichlari o'z geometriyasida (bir qatorda 5 ta) — u yuqoridagi testda.
  for (const visual of VISUALS.filter((v) => v !== "rail")) {
    const plan = planSlide(s, theme, visual, 3, TOTAL, "general", "lecture", { bodyType });
    const desc = texts(plan.layers).filter((l) => l.src?.f === "steps" && (l.src as { k: string }).k === "text");
    assert.equal(desc.length, 5, `${visual}: 5 ta izoh kutilgan`);
    for (const l of desc) {
      assert.ok(l.size >= bodyType.minPt, `${visual}: izoh ${l.size} pt < ${bodyType.minPt}`);
      const ink = LAYOUT_KIT.inkHeight(textOf(l), l.box.w, l.size);
      assert.ok(ink <= l.box.h + 0.01, `${visual}: izoh ${l.size} pt da ${ink.toFixed(2)}″ — quti ${l.box.h.toFixed(2)}″`);
    }
  }
});

// ═══════════════════════════════════ ko'z tekshiruvida topilganlar (PDF)

/**
 * Bo'lim slaydida ingichka bezak chizig'i sarlavha SIYOHINI kesib
 * o'tmasin. `dashboard` panel to'rining o'rta chizig'i 3.75 da turardi
 * va sarlavhaning oxirgi qatorini ustidan chizardi (raqamli va raqamsiz
 * holatda ham — AUDIT-25 PNG tekshiruvida ko'rindi).
 */
test("bo'lim: ingichka chiziq sarlavha siyohini kesib o'tmaydi — har maket, plan bilan/siz", () => {
  const theme = getSlideTheme("atlas");
  for (const visual of VISUALS) {
    for (const plan of [3, undefined]) {
      const p = planSlide(section({ img: false, sub: true, plan }), theme, visual, INDEX, TOTAL);
      const title = texts(p.layers).find((l) => l.src?.f === "title")!;
      const inkH = LAYOUT_KIT.inkHeight(textOf(title), title.box.w, title.size);
      const bottom = title.valign === "bottom" ? title.box.y + title.box.h : title.box.y + inkH;
      const top = title.valign === "bottom" ? bottom - inkH : title.valign === "middle" ? title.box.y + (title.box.h - inkH) / 2 : title.box.y;
      const bot = title.valign === "middle" ? top + inkH : bottom;
      for (const r of p.layers) {
        // Daftar katagi (notebook `pushGrid`, alpha 0.1) — qog'oz foni, bezak emas.
        if (r.t !== "rect" || r.box.h > 0.05 || r.box.w < 2 || (r.fill?.alpha ?? 1) < 0.2) continue;
        const overlapsX = r.box.x < title.box.x + title.box.w && r.box.x + r.box.w > title.box.x;
        const inside = r.box.y > top + 0.05 && r.box.y < bot - 0.05;
        assert.ok(!(overlapsX && inside), `${visual}/plan=${plan ?? "-"}: chiziq y=${r.box.y} sarlavha siyohi (${top.toFixed(2)}–${bot.toFixed(2)}) ichida`);
      }
    }
  }
});

/**
 * `circle` plan'siz bo'limida nishon markazi ko'rinsin: `accent2` ba'zi
 * palitralarda (`atlas`) `titleBg` bilan aynan bir rang — markaz disk
 * bilan qo'shilib, nishon BO'SH ko'rinardi (PDF da ko'rindi).
 */
test("circle plan'siz bo'lim: nishon markazi har temada diskdan farqli rangda", () => {
  for (const themeId of SLIDE_THEME_IDS) {
    const theme = getSlideTheme(themeId);
    const p = planSlide(section({ img: false, sub: true }), theme, "circle", INDEX, TOTAL);
    const inner = p.layers.filter(
      (l): l is Extract<SlideLayer, { t: "rect" }> => l.t === "rect" && Boolean(l.radius) && l.box.x > 1.4 && l.box.w < 1.5 && l.box.y > 2.2,
    );
    assert.ok(inner.length > 0, `${themeId}: nishon markazi yo'q`);
    const disk = theme.titleBg.toLowerCase();
    assert.ok(
      inner.some((d) => d.fill && d.fill.color.toLowerCase() !== disk),
      `${themeId}: nishon markazi disk rangida (${disk}) — bo'sh nishon`,
    );
  }
});
