import test from "node:test";
import assert from "node:assert/strict";
import { CHAR_EM, LAYOUT_KIT, planSlide, type SlideLayer } from "../lib/generation/slide-layout.ts";
import { AUDIENCE_RULES, bodyRules } from "../lib/generation/slide-audience.ts";
import { SLIDE_LIMITS } from "../lib/generation/slide-limits.ts";
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
 * (`bodyType.minPt`, Slide Law: 1–4-sinf 24 pt) e'tiborsiz edi.
 *
 * Shartnoma (sharhlovchi qarori, AUDIT-25 P2 sharhi 1–2-band):
 *   (a) SIG'ADIGAN matn auditoriya polidan kichik chizilmaydi;
 *   (b) HECH BIR tana matni qutidan chiqmaydi va so'z o'rtasidan
 *       bo'linmaydi — matn polda sig'masa shrift maketning eski
 *       polgacha kichrayadi (`bodyFit` himoyasi). Ko'ruvchi toshgan
 *       matnni kesadi, PPTX to'kadi — toshish «ko'rdim = oldim» ni buzadi.
 */
const AUDIENCES = Object.keys(AUDIENCE_RULES) as (keyof typeof AUDIENCE_RULES)[];
const BOLD_EM = LAYOUT_KIT.CHAR_EM_BOLD ?? 0.6;

/**
 * Siyoh balandligi — maketdan MUSTAQIL hisob (maketning `inkHeight` i
 * buzilsa ham test aldanmasin): ochko'z so'z o'rash, qatordan uzun so'z
 * bir necha qator oladi.
 */
function inkIn(text: string, w: number, size: number, em: number): number {
  const perLine = Math.max(1, Math.floor((w * 72) / (size * em)));
  let rows = 0;
  let col = 0;
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    if (rows === 0) rows = 1;
    if (word.length > perLine) {
      if (col > 0) rows += 1;
      rows += Math.ceil(word.length / perLine) - 1;
      col = word.length % perLine || perLine;
      continue;
    }
    const next = col === 0 ? word.length : col + 1 + word.length;
    if (next <= perLine) {
      col = next;
    } else {
      rows += 1;
      col = word.length;
    }
  }
  return (rows * size * 1.3) / 72;
}

/** Tana matni qatlamlari (bosqich `n` — tartib belgisi, tana emas). */
function bodyLayers(layers: SlideLayer[]): TextLayer[] {
  return texts(layers).filter((l) => {
    const f = l.src?.f;
    if (f === "steps") return (l.src as { k: string }).k !== "n";
    return f === "stats" || f === "table";
  });
}

function assertFits(l: TextLayer, tag: string) {
  const t = textOf(l);
  const em = l.bold ? BOLD_EM : CHAR_EM;
  const ink = inkIn(t, l.box.w, l.size, em);
  assert.ok(ink <= l.box.h + 0.01, `${tag}: «${t.slice(0, 28)}…» ${l.size} pt da ${ink.toFixed(2)}″ > quti ${l.box.h.toFixed(2)}″`);
  const longest = Math.max(...t.split(/\s+/).map((w) => w.length));
  assert.ok(
    longest * l.size * em <= l.box.w * 72 + 0.5,
    `${tag}: «${t.slice(0, 28)}» ${l.size} pt da eng uzun so'z (${longest} belgi) qatorga sig'maydi — so'z o'rtasidan bo'linadi`,
  );
}

/** So'z chegarasida kesilgan, AYNAN `n` belgigacha to'ldirilgan o'zbekcha matn. */
const WORDS =
  "Orol dengizi havzasida sug'orish uchun olingan suv hajmi o'n yillar davomida muttasil oshib bordi va dengiz sathi keskin pasaydi natijada qirg'oq chekindi".split(
    " ",
  );
function textOfLen(n: number, shift = 0): string {
  let out = "";
  for (let i = shift; ; i++) {
    const w = WORDS[i % WORDS.length];
    const next = out ? `${out} ${w}` : w;
    if (next.length > n) return out || w.slice(0, n);
    out = next;
  }
}

const L = SLIDE_LIMITS;
type FitCase = { tag: string; slide: PlanSlide };

/** Chegara uzunligi va SONLARIDAGI holatlar + sharhlovchi keltirgan real matnlar. */
function fitCases(): FitCase[] {
  const base = sampleFor("process", false);
  const out: FitCase[] = [];
  for (const n of [3, 4, L.stepsMax]) {
    out.push({
      tag: `process×${n}/chegara`,
      slide: {
        ...base,
        layout: "process",
        steps: Array.from({ length: n }, (_, i) => ({ n: String(i + 1), title: textOfLen(L.stepTitle, i), text: textOfLen(L.stepText, i + 3) })),
      },
    });
  }
  const realTitles = ["Kuzatish", "Taqqoslash", "Tahlil", "Xulosa", "Taklif"];
  for (const n of [4, 5]) {
    out.push({
      tag: `process×${n}/real`,
      slide: {
        ...base,
        layout: "process",
        steps: realTitles.slice(0, n).map((title, i) => ({ n: String(i + 1), title, text: "Suv sathini har oy o'lchab, jadvalga yozamiz." })),
      },
    });
  }
  for (const n of [2, 3, L.statsMax]) {
    // Aralash birlik — kartalar tarmog'i.
    out.push({
      tag: `stats-karta×${n}/chegara`,
      slide: {
        ...base,
        layout: "stats",
        stats: Array.from({ length: n }, (_, i) => ({ value: i % 2 ? `${40 + i} km` : textOfLen(L.statValue, i), label: textOfLen(L.statLabel, i + 1) })),
      },
    });
  }
  for (const n of [3, L.statsMax]) {
    // Bir birlik — diagramma tarmog'i.
    out.push({
      tag: `stats-diagramma×${n}/chegara`,
      slide: {
        ...base,
        layout: "stats",
        stats: Array.from({ length: n }, (_, i) => ({ value: `${70 - i * 10}%`, label: textOfLen(L.statLabel, i + 2) })),
      },
    });
  }
  out.push({
    tag: "stats-diagramma×4/real",
    slide: {
      ...base,
      layout: "stats",
      stats: ["Sug'orishga", "Filtratsiya", "Bug'lanish", "Boshqa"].map((label, i) => ({ value: `${60 - i * 15}%`, label })),
    },
  });
  for (const [cols, rows] of [
    [3, 3],
    [4, 4],
    [L.tableCols, L.tableRows],
  ] as const) {
    const head = cols <= 3 ? L.tableHeaderWide : L.tableHeader;
    out.push({
      tag: `jadval ${cols}×${rows}/chegara`,
      slide: {
        ...base,
        layout: "table",
        table: {
          headers: Array.from({ length: cols }, (_, c) => textOfLen(head, c)),
          rows: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => textOfLen(L.tableCell, r + c))),
        },
      },
    });
  }
  return out;
}

test("A2-04: har auditoriya × har maket — process/stats/table tana matni qutidan chiqmaydi, so'z bo'linmaydi (SLIDE_LIMITS uzunlik va sonlarida)", () => {
  const theme = getSlideTheme("atlas");
  const cases = fitCases();
  let checked = 0;
  for (const aud of AUDIENCES) {
    const bodyType = bodyRules({ slideAudience: aud, textVolume: "standart", planItems: 4 }, "lecture");
    for (const visual of VISUALS) {
      for (const c of cases) {
        const plan = planSlide(c.slide, theme, visual, 3, TOTAL, aud, "lecture", { bodyType });
        const body = bodyLayers(plan.layers);
        assert.ok(body.length > 0, `${aud}/${visual}/${c.tag}: tana matni topilmadi`);
        for (const l of body) {
          assertFits(l, `${aud}/${visual}/${c.tag}`);
          checked += 1;
        }
        assertInside(plan.layers, `${aud}/${visual}/${c.tag}`);
      }
    }
  }
  assert.ok(checked > 10_000, `matritsa kichik: ${checked} qatlam`);
});

/**
 * Ijobiy holat: SIG'ADIGAN oddiy matn auditoriya polidan kichik emas —
 * himoya (b) polni «arzon» qilib qo'ymasin.
 */
function shortCase(layout: SlideLayout, chart: boolean): PlanSlide {
  const s = sampleFor(layout, false);
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

test("A2-04: sig'adigan oddiy matn auditoriya polidan (minPt) kichik emas — maktab va talaba auditoriyalari, har maket", () => {
  const theme = getSlideTheme("atlas");
  for (const aud of ["school_1_4", "school_5_7", "school_10_11", "students_bachelor", "general"] as const) {
    const bodyType = bodyRules({ slideAudience: aud, textVolume: "standart", planItems: 4 }, "lecture");
    for (const visual of VISUALS) {
      for (const [layout, chart] of [
        ["process", false],
        ["stats", false],
        ["stats", true],
        ["table", false],
      ] as const) {
        const plan = planSlide(shortCase(layout, chart), theme, visual, 3, TOTAL, aud, "lecture", { bodyType });
        for (const l of bodyLayers(plan.layers)) {
          const tag = `${aud}/${visual}/${layout}${chart ? "/diagramma" : ""}`;
          assert.ok(l.size >= bodyType.minPt, `${tag}: «${textOf(l)}» ${l.size} pt < pol ${bodyType.minPt} pt`);
          assertFits(l, tag);
        }
      }
    }
  }
});

test("A2-04: 1–4-sinf bosqichlari (minPt 24) — qisqa matn 24 pt dan kichik emas va qutiga sig'adi", () => {
  const theme = getSlideTheme("atlas");
  const bodyType = bodyRules({ slideAudience: "school_1_4", textVolume: "standart", planItems: 4 }, "lecture");
  assert.equal(bodyType.minPt, 24);
  for (const visual of VISUALS) {
    const plan = planSlide(shortCase("process", false), theme, visual, 3, TOTAL, "school_1_4", "lecture", { bodyType });
    const steps = texts(plan.layers).filter((l) => l.src?.f === "steps" && (l.src as { k: string }).k !== "n");
    assert.equal(steps.length, 6, `${visual}: 3 × (sarlavha + matn) kutilgan`);
    for (const l of steps) {
      assert.ok(l.size >= 24, `${visual}: «${textOf(l)}» ${l.size} pt`);
      assertFits(l, `${visual}`);
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
      (l): l is Extract<SlideLayer, { t: "rect" }> => l.t === "rect" && Boolean(l.radius) && l.box.w === l.box.h && l.box.x > 1.4 && l.box.x < 4.5 && l.box.w < 1.5,
    );
    assert.ok(inner.length > 0, `${themeId}: nishon markazi yo'q`);
    // Ichma-ich doiralar (kichikdan kattaga), oxirida ularni o'rab turgan disk.
    const rings = [...inner].sort((a, b) => a.box.w - b.box.w).map((d) => (d.fill?.color ?? "").toLowerCase());
    rings.push(theme.titleBg.toLowerCase());
    // Markaz (eng kichik) o'zini bevosita o'rab turgan rangdan farqlansin —
    // oraliq halqa disk bilan bir xil bo'lsa ham (`orbit`: bg = titleBg).
    assert.notEqual(rings[0], rings[1], `${themeId}: nishon markazi (${rings[0]}) atrofi bilan bir rangda — bo'sh nishon`);
  }
});
