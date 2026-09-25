import test from "node:test";
import assert from "node:assert/strict";
import { extractMeta } from "../lib/generation/meta.ts";
import { SLIDE_LIMITS, clipTo, SLIDE_IMAGE_MAX_BYTES, UNDO_DEPTH, REBUILD_DEBOUNCE_MS } from "../lib/generation/slide-limits.ts";
import { resolveSlideTemplate } from "../lib/generation/slide-templates.ts";
import { bodyRules } from "../lib/generation/slide-audience.ts";
import { limitsFor } from "../lib/generation/slide-limits.ts";
import { CLIP_FLOOR_CHARS, NO_IMAGE, clipLimit, fitChars, layoutWordTargets } from "../lib/generation/slide-quality.ts";
import { QUIZ_MAX, QUIZ_OPTION_MAX, QUIZ_Q_MAX, STAT_LABEL_MAX, STEP_TEXT_MAX, extractNewSlides, writeSlidesWithLlm } from "../lib/generation/slide-write.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";

/**
 * `SLIDE_LIMITS` ↔ `normalizeSlide` MOSLIGI.
 *
 * Chegaralar endi ikki joyda emas, bitta jadvalda. Bu fayl shu
 * jadvalning HAQIQATAN yozuv yo'lida qo'llanishini qulflaydi:
 * `normalizeSlide` eksport qilinmagani uchun sinov soxta LLM javobi
 * orqali `writeSlidesWithLlm` → `parseDeckJson` → `normalizeSlide`
 * yo'lidan o'tadi (`tests/slide-quiz.test.mts` naqshi). Jadvaldagi
 * sonni o'zgartirsangiz — bu testlar aynan shu qatorda qiziradi.
 */

async function deckFrom(slides: unknown[]): Promise<SlideModel[] | null> {
  const realFetch = globalThis.fetch;
  const savedGemini = process.env.GEMINI_API_KEY;
  const savedXai = process.env.XAI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.XAI_API_KEY;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ slides }) }] } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    const meta = extractMeta(TOOL_BY_ID.slide, { topic: "Suv aylanishi" } as never);
    const tpl = resolveSlideTemplate("lecture", meta.topic);
    const beats = slides.map((s) => ({ layout: (s as { layout: string }).layout as never, role: "sinov" }));
    return await writeSlidesWithLlm(meta, tpl, beats, Date.now() + 120_000);
  } finally {
    globalThis.fetch = realFetch;
    if (savedGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedGemini;
    if (savedXai !== undefined) process.env.XAI_API_KEY = savedXai;
  }
}

function body(slides: SlideModel[] | null): SlideModel[] {
  assert.ok(slides, "deka yozilishi kerak");
  return slides.filter((s) => s.layout !== "title" && s.layout !== "closing");
}

function filler(n: number): unknown[] {
  return Array.from({ length: n }, (_, i) => ({
    layout: "bullets",
    title: `To‘ldiruvchi ${i + 1}`,
    bullets: ["Birinchi band gapi.", "Ikkinchi band gapi."],
  }));
}

/*
 * AUDIT-25 W3/W4: son va uzunlik chegaralari endi AUDITORIYA × vizual ×
 * element SONI bo'yicha (`limitsFor`, `clipLimit`) — statik `SLIDE_LIMITS`
 * faqat qopqoq. `deckFrom` ning metasi (oddiy slayd, «Ma’ruza») uchun
 * kutilgan qiymatlar shu funksiyalardan hisoblanadi.
 */
const RULES = bodyRules(extractMeta(TOOL_BY_ID.slide, { topic: "Suv aylanishi" } as never), "lecture");
const VISUAL = resolveSlideTemplate("lecture", "Suv aylanishi").visual;
const LIM = limitsFor(RULES);

/** Chegaradan bitta uzun matn — kesilishi SHART. */
const long = (n: number) => "a".repeat(n + 1);

// ═══════════════════════════════════════════ 1. Eski eksportlar jadvaldan oladi

test("eski eksportlar SLIDE_LIMITS dan olinadi", () => {
  assert.equal(STEP_TEXT_MAX, SLIDE_LIMITS.stepText);
  assert.equal(STAT_LABEL_MAX, SLIDE_LIMITS.statLabel);
  assert.equal(QUIZ_MAX, SLIDE_LIMITS.quizMax);
  assert.equal(QUIZ_Q_MAX, SLIDE_LIMITS.quizQ);
  assert.equal(QUIZ_OPTION_MAX, SLIDE_LIMITS.quizOption);
});

test("tahrir konstantalari — rejadagi qiymatlar", () => {
  assert.equal(SLIDE_IMAGE_MAX_BYTES, 5 * 1024 * 1024);
  assert.equal(UNDO_DEPTH, 100);
  assert.equal(REBUILD_DEBOUNCE_MS, 3000);
});

// ═══════════════════════════════════════════ 2. clipTo

test("clipTo: bo'shliqni siqadi, chegarada «…» bilan tugaydi", () => {
  assert.equal(clipTo("  ikki   so‘z  ", 40), "ikki so‘z");
  const out = clipTo("a".repeat(50), 10);
  assert.equal(out.length, 10, "natija AYNAN chegara uzunligida");
  assert.equal(out.endsWith("…"), true);
  assert.equal(clipTo("qisqa", 10), "qisqa", "chegaradan qisqa matn tegilmaydi");
});

// ═══════════════════════════════════════════ 3. normalizeSlide shu jadvaldan o'qiydi

test("normalize: sarlavha SLIDE_LIMITS.title bilan kesiladi", async () => {
  const s = body(await deckFrom([{ layout: "bullets", title: long(SLIDE_LIMITS.title), bullets: ["Band."] }, ...filler(7)]))[0];
  assert.equal(s.title.length, SLIDE_LIMITS.title);
});

test("normalize: subtitle chegarasi maketga bog'liq (section/closing/standart)", async () => {
  const slides = await deckFrom([
    { layout: "section", title: "Bo‘lim", subtitle: long(SLIDE_LIMITS.subtitleSection) },
    { layout: "bullets", title: "Band", subtitle: long(SLIDE_LIMITS.subtitle), bullets: ["Band."] },
    ...filler(6),
  ]);
  const b = body(slides);
  assert.equal(b[0].subtitle?.length, SLIDE_LIMITS.subtitleSection);
  assert.equal(b[1].subtitle?.length, SLIDE_LIMITS.subtitle);
  assert.notEqual(SLIDE_LIMITS.subtitleSection, SLIDE_LIMITS.subtitle, "ikki chegara ajralib turishi kerak");
});

test("normalize: kicker/imageHint/notes chegaralari", async () => {
  const s = body(
    await deckFrom([
      {
        layout: "bullets",
        title: "Sarlavha",
        kicker: long(SLIDE_LIMITS.kicker),
        imageHint: long(SLIDE_LIMITS.imageHint),
        notes: long(SLIDE_LIMITS.notes),
        bullets: ["Band."],
      },
      ...filler(7),
    ]),
  )[0];
  assert.equal(s.kicker?.length, SLIDE_LIMITS.kicker);
  assert.equal(s.imageHint?.length, SLIDE_LIMITS.imageHint);
  assert.equal(s.notes?.length, SLIDE_LIMITS.notes);
});

test("normalize: ustun bandlari colItems × colItem", async () => {
  const s = body(
    await deckFrom([
      {
        layout: "twoCol",
        title: "Ikki ustun",
        leftTitle: long(SLIDE_LIMITS.colTitle),
        left: Array.from({ length: SLIDE_LIMITS.colItems + 3 }, () => long(SLIDE_LIMITS.colItem)),
        right: ["O‘ng band."],
      },
      ...filler(7),
    ]),
  )[0];
  const colN = Math.min(SLIDE_LIMITS.colItems, layoutWordTargets(RULES, VISUAL).maxColItems);
  assert.equal(s.left?.length, colN, "ustundagi band soni chegarasi (auditoriya × vizual, N3)");
  assert.equal(s.left?.[0].length, clipLimit("colItem", RULES, VISUAL, colN, undefined, NO_IMAGE), "banddagi belgi chegarasi (ustundagi band SONIDA)");
  assert.equal(s.leftTitle?.length, SLIDE_LIMITS.colTitle);
});

test("normalize: quote/quoteBy chegaralari", async () => {
  const s = body(
    await deckFrom([
      { layout: "quote", title: "Iqtibos", quote: long(SLIDE_LIMITS.quote), quoteBy: long(SLIDE_LIMITS.quoteBy) },
      ...filler(7),
    ]),
  )[0];
  assert.equal(s.quote?.length, SLIDE_LIMITS.quote);
  assert.equal(s.quoteBy?.length, SLIDE_LIMITS.quoteBy);
});

test("normalize: stats — statsMax karta, statValue/statLabel chegarasi", async () => {
  const s = body(
    await deckFrom([
      {
        layout: "stats",
        title: "Raqamlar",
        stats: Array.from({ length: SLIDE_LIMITS.statsMax + 2 }, () => ({
          value: long(SLIDE_LIMITS.statValue),
          label: long(SLIDE_LIMITS.statLabel),
        })),
      },
      ...filler(7),
    ]),
  )[0];
  assert.equal(s.stats?.length, LIM.statsMax, "karta soni auditoriya ruxsatida");
  assert.equal(s.stats?.[0].value.length, SLIDE_LIMITS.statValue);
  assert.equal(s.stats?.[0].label.length, clipLimit("statLabel", RULES, VISUAL, LIM.statsMax, undefined, NO_IMAGE));
});

test("normalize: process — stepsMax bosqich, stepTitle/stepText chegarasi", async () => {
  const s = body(
    await deckFrom([
      {
        layout: "process",
        title: "Bosqichlar",
        steps: Array.from({ length: SLIDE_LIMITS.stepsMax + 2 }, (_, i) => ({
          n: String(i + 1),
          title: long(SLIDE_LIMITS.stepTitle),
          text: long(SLIDE_LIMITS.stepText),
        })),
      },
      ...filler(7),
    ]),
  )[0];
  assert.equal(s.steps?.length, LIM.stepsMax, "bosqich soni auditoriya ruxsatida");
  assert.equal(s.steps?.[0].title.length, clipLimit("stepTitle", RULES, VISUAL, LIM.stepsMax, undefined, NO_IMAGE));
  assert.equal(s.steps?.[0].text.length, clipLimit("stepText", RULES, VISUAL, LIM.stepsMax, undefined, NO_IMAGE));
});

test("normalize: jadval — tableCols/tableRows/tableCell va ustun soniga qarab sarlavha", async () => {
  const wide = body(
    await deckFrom([
      {
        layout: "table",
        title: "Uch ustun",
        table: {
          headers: [long(SLIDE_LIMITS.tableHeaderWide), "B", "C"],
          rows: Array.from({ length: SLIDE_LIMITS.tableRows + 2 }, () => [long(SLIDE_LIMITS.tableCell), "b", "c"]),
        },
      },
      ...filler(7),
    ]),
  )[0];
  const rowsN = LIM.tableRows;
  assert.equal(wide.table?.headers[0].length, clipLimit("tableHeader", RULES, VISUAL, 3, rowsN, NO_IMAGE), "3 ustunda sarlavha (ustun VA qator soni)");
  assert.equal(wide.table?.rows.length, rowsN);
  assert.equal(wide.table?.rows[0][0].length, clipLimit("tableCell", RULES, VISUAL, 3, rowsN, NO_IMAGE));

  const narrow = body(
    await deckFrom([
      {
        layout: "table",
        title: "To‘rt ustun",
        table: {
          headers: [long(SLIDE_LIMITS.tableHeader), "B", "C", "D"],
          rows: [
            ["1", "2", "3", "4"],
            ["5", "6", "7", "8"],
          ],
        },
      },
      ...filler(7),
    ]),
  )[0];
  // INT-07: ustun soni — prompt bilan bir manba (auditoriya ∩ vizual sig'imi, `layoutWordTargets.maxTableCols`).
  const cols = Math.min(4, LIM.tableCols, layoutWordTargets(RULES, VISUAL).maxTableCols);
  assert.equal(narrow.table?.headers.length, cols);
  const raw = long(SLIDE_LIMITS.tableHeader).length;
  assert.equal(narrow.table?.headers[0].length, Math.min(raw, clipLimit("tableHeader", RULES, VISUAL, cols, 2, NO_IMAGE)), "ustun soniga qarab sarlavha");
});

test("normalize: quiz — quizOptions AYNAN, quizQ/quizOption chegarasi", async () => {
  const s = body(
    await deckFrom([
      {
        layout: "quiz",
        title: "Test",
        quiz: [
          {
            q: long(SLIDE_LIMITS.quizQ),
            options: Array.from({ length: SLIDE_LIMITS.quizOptions }, () => long(SLIDE_LIMITS.quizOption)),
            answer: 0,
          },
        ],
      },
      ...filler(7),
    ]),
  )[0];
  assert.equal(s.quiz?.[0].q.length, SLIDE_LIMITS.quizQ);
  assert.equal(s.quiz?.[0].options.length, SLIDE_LIMITS.quizOptions);
  assert.equal(s.quiz?.[0].options[0].length, clipLimit("quizOption", RULES, VISUAL, undefined, undefined, NO_IMAGE));
});

test("normalize: references — refsMax, refTitle/refSource chegarasi", async () => {
  const s = body(
    await deckFrom([
      {
        layout: "references",
        title: "Manbalar",
        refs: Array.from({ length: SLIDE_LIMITS.refsMax + 2 }, () => ({
          title: long(SLIDE_LIMITS.refTitle),
          source: long(SLIDE_LIMITS.refSource),
        })),
      },
      ...filler(7),
    ]),
  )[0];
  assert.equal(s.refs?.length, SLIDE_LIMITS.refsMax);
  assert.equal(s.refs?.[0].title.length, SLIDE_LIMITS.refTitle);
  assert.equal(s.refs?.[0].source.length, SLIDE_LIMITS.refSource);
});

test("normalize: answers — quizMax qator, answersItem belgisi", async () => {
  const s = body(
    await deckFrom([
      {
        layout: "answers",
        title: "Javoblar",
        bullets: Array.from({ length: SLIDE_LIMITS.quizMax + 3 }, () => long(SLIDE_LIMITS.answersItem)),
      },
      ...filler(7),
    ]),
  )[0];
  assert.equal(s.bullets?.length, SLIDE_LIMITS.quizMax);
  assert.equal(s.bullets?.[0].length, SLIDE_LIMITS.answersItem);
});

// ═══════════════════════════════════════════ 4. AUDIT-25 — kesilgan matn

/*
 * Jonli dekada test variantlari «…me'yor…» bilan kesilgan chiqdi:
 * `quizOption` 60 belgi (~6 so'z) edi. Qopqoq endi maketdan (eng tor
 * `cards` qutisi talaba polida 129 belgi) — 12 so'zli to'liq variant
 * normalizatsiyadan butun chiqadi.
 */
test("AUDIT-25: 12 so'zli test varianti normalizatsiyada «…» siz saqlanadi", async () => {
  const option = "Suvni tejash me’yorlarini buzgan korxonalarga nisbatan jarima va cheklov choralarini qo‘llash kerak";
  assert.ok(option.length > 60 && option.length <= SLIDE_LIMITS.quizOption, `shart: ${option.length} belgi`);
  const s = body(
    await deckFrom([
      { layout: "quiz", title: "Test", quiz: [{ q: "Qaysi chora to‘g‘ri?", options: [option, "Ikkinchi", "Uchinchi", "To‘rtinchi"], answer: 0 }] },
      ...filler(7),
    ]),
  )[0];
  assert.equal(s.quiz?.[0].options[0], option);
});

/*
 * Jonli `lecture-12`: 6 ustun bandining 5 tasi «…imkonini ber…», iqtibos
 * muallifi «…olim, zam…» — so'z O'RTASIDAN kesilgan. `clipTo` endi so'z
 * chegarasida kesadi, oxiridagi vergul/tire tashlanadi.
 */
test("AUDIT-25: clipTo so'z chegarasida kesadi (so'z o'rtasida «…» yo'q)", () => {
  assert.equal(
    clipTo("Adam Smit — Shotlandiyalik faylasuf va iqtisodchi olim, zamonaviy iqtisodiyot asoschisi", 60),
    "Adam Smit — Shotlandiyalik faylasuf va iqtisodchi olim…",
  );
  const src =
    "Bozor iqtisodiyotida mulk huquqining kafolatlanganligi har bir subyektga o‘z mulkini erkin tasarruf etish imkonini beradi va tadbirkorlikni rag‘batlantiradi";
  const words = src.split(" ");
  for (let n = 30; n < src.length; n += 7) {
    const out = clipTo(src, n);
    assert.ok(out.length <= n, `${n}: ${out.length} belgi`);
    assert.ok(out.endsWith("…"));
    const kept = out.slice(0, -1).split(" ");
    // Har saqlangan so'z asl matndagi so'z bilan AYNAN bir xil (oxirgisi ham — yarim so'z yo'q).
    kept.forEach((w, i) => assert.equal(w, words[i].replace(/[,;:]$/u, i === kept.length - 1 ? "" : words[i].slice(-1)), `${n}: «${out}»`));
  }
  // Bitta uzun so'z (URL) — eskicha qattiq kesiladi, uzunlik AYNAN n.
  assert.equal(clipTo("a".repeat(50), 10), `${"a".repeat(9)}…`);
  // Chegara juda erta bo'lsa (≤ 60 %) — qattiq kesish, joy isrof bo'lmaydi.
  assert.equal(clipTo(`Ab ${"c".repeat(40)}`, 20).length, 20);
  // Gap oxirida kesilsa «.…» emas (sharh 11-band).
  assert.equal(clipTo("Orol dengizi. Qurish sabablari va oqibatlari", 16), "Orol dengizi…");
  // NBSP bo'linmaydi va saqlanadi: «12 km» ikkiga ajralmaydi.
  assert.equal(clipTo("a\u00a0b", 10), "a\u00a0b");
  assert.equal(clipTo("Suv hajmi 12\u00a0km ga qisqardi", 15), "Suv hajmi…");
});

// P11 sharhi 1a: 0 belgilik quti (tahrirning xom rasmli chegarasi) — ilgari `safeSlice(t, -1)` deyarli
// butun matnni qaytarardi («Suv bug‘lanadi va bulut hosil…» 0 belgiga). MUTATSIYA: ikki qator olib tashlansa — qizaradi.
test("clipTo: n ≤ 0 — bo'sh; n = 1 — faqat «…»; natija hech qachon n dan uzun emas", () => {
  const s = "Suv bug‘lanadi va bulut hosil qiladi";
  assert.equal(clipTo(s, 0), "");
  assert.equal(clipTo(s, -3), "");
  assert.equal(clipTo(s, 1), "…");
  assert.equal(clipTo("", 0), "");
  assert.equal(clipTo("", 1), "");
  assert.equal(clipTo("A", 1), "A");
  for (let n = 0; n <= s.length + 1; n += 1) assert.ok(clipTo(s, n).length <= Math.max(0, n), `n=${n}: ${clipTo(s, n).length}`);
});

// ═══════════════════════════════════════════ 5. AUDIT-25 — limitsFor (auditoriya × son)

test("limitsFor: son o'zgaruvchi maydonlar pol × son jadvalidan, statik qopqoqdan oshmaydi", async () => {
  const { bodyRules } = await import("../lib/generation/slide-audience.ts");
  const { limitsFor, LIMIT_FLOORS } = await import("../lib/generation/slide-limits.ts");
  const kids = bodyRules({ slideAudience: "school_1_4", textVolume: "standart", planItems: 5 }, "lesson");
  const adult = bodyRules({ slideAudience: "students_bachelor", textVolume: "standart", planItems: 5 }, "lecture");
  // P2 o'lchovi: 1–4 sinf polida 5 bosqich matni ~15 belgi — 160 emas.
  assert.ok(limitsFor(kids, { steps: 5 }).stepText <= 15);
  // Jadval kaliti ustun × qator: talaba 4×5 (auditoriya ruxsati) — 5×6 ning 20 belgisi emas (sharh 5-band).
  assert.equal(limitsFor(adult).tableCols, 4);
  assert.equal(limitsFor(adult).tableRows, 5);
  assert.ok(limitsFor(adult).tableCell >= 40, `talaba katak ${limitsFor(adult).tableCell}`);
  assert.ok(limitsFor(adult, { cols: 3, rows: 5 }).tableCell >= limitsFor(adult, { cols: 5, rows: 6 }).tableCell);
  // Test varianti pol bo'yicha (sharh 7-band): talaba ≤ statik, 1–4 sinf ancha tor.
  assert.ok(limitsFor(adult).quizOption <= SLIDE_LIMITS.quizOption && limitsFor(adult).quizOption >= 95);
  assert.ok(limitsFor(kids).quizOption <= 25);
  assert.ok(limitsFor(kids, { stats: 4 }).statLabel <= 30);
  assert.ok(limitsFor(kids, { cols: 5, rows: 6 }).tableCell <= 10);
  // Hech bir kombinatsiya statik qopqoqdan oshmaydi; qolgan maydonlar statik bilan bir xil.
  for (const rules of [kids, adult]) {
    for (const steps of [1, 3, 4, 5, 9]) {
      const l = limitsFor(rules, { steps, stats: steps, cols: steps, rows: steps });
      assert.ok(l.stepText <= SLIDE_LIMITS.stepText && l.stepTitle <= SLIDE_LIMITS.stepTitle);
      assert.ok(l.statLabel <= SLIDE_LIMITS.statLabel && l.tableCell <= SLIDE_LIMITS.tableCell);
      assert.ok(l.tableHeader <= SLIDE_LIMITS.tableHeaderWide && l.tableHeader === l.tableHeaderWide);
      assert.ok(l.quizOption <= SLIDE_LIMITS.quizOption);
      assert.equal(l.title, SLIDE_LIMITS.title);
    }
  }
  // Monoton: pol kattalashsa (yosh auditoriya) va son ko'paysa — chegara kamayadi yoki teng.
  const at = (minPt: number, steps: number) =>
    limitsFor({ minPt, stepsMax: 5, statsMax: 4, tableCols: 5, tableRows: 6 }, { steps, stats: Math.min(4, steps - 1), cols: steps, rows: steps });
  for (let i = 1; i < LIMIT_FLOORS.length; i += 1) {
    for (const n of [3, 4, 5]) {
      const a = at(LIMIT_FLOORS[i - 1], n);
      const b = at(LIMIT_FLOORS[i], n);
      for (const k of ["stepText", "stepTitle", "statLabel", "tableCell", "tableHeader"] as const) assert.ok(b[k] <= a[k], `${k} ${LIMIT_FLOORS[i]}pt×${n}`);
    }
  }
  for (const f of LIMIT_FLOORS) {
    for (const k of ["stepText", "stepTitle", "tableCell"] as const) assert.ok(at(f, 5)[k] <= at(f, 4)[k] && at(f, 4)[k] <= at(f, 3)[k], `${k} ${f}pt`);
  }
  // Son berilmasa — auditoriya ruxsat bergan eng katta son (qattiqroq tomon).
  assert.deepEqual(limitsFor(kids), limitsFor(kids, { steps: kids.stepsMax, stats: kids.statsMax, cols: kids.tableCols, rows: kids.tableRows }));
  assert.equal(limitsFor(kids).stepsMax, 3);
  assert.equal(limitsFor(adult).stepsMax, 4);
  const k = await import("../lib/generation/slide-limits.ts");
  assert.equal(k.tableKey(3, 5), "4x5");
  assert.equal(k.tableKey(2, 2), "3x3");
  assert.equal(k.tableKey(4, 3), "4x4");
  assert.equal(k.tableKey(6, 9), "5x6");
});

// ═══════════════════════════════════════════ 6. AUDIT-25 P11 — chegara deka VIZUALIGA ergashadi

/*
 * Jonli dalil (slides-3 e268937, 8–9 sinf, `lesson`): 6 dekaning 3 tasida HAMMA process
 * bosqich matni «…» bilan tugadi. Sabab: `clipLimit` har doim `limitsFor` jadvali bilan
 * qisilardi — u 17 vizualning ENG TORI, RASM bilan, × 0.88 (20 pt, 3 bosqich → 45).
 * `circle` ning rasmsiz qutisi esa 121 belgi: P8 «rasmsiz qutida qirq, rasm joy beradi»
 * qoidasi amalda o'chgan edi. Endi vizual ma'lum bo'lsa — SHU vizualning o'lchovi, statik
 * shift (`SLIDE_LIMITS`) bilan; jadval faqat vizual noma'lum bo'lganda (zaxira).
 *
 * MUTATSIYA: `fieldCap` vizual ma'lum bo'lganda ham `tableCap` (jadval) qaytarsa — (a) qizaradi.
 */
const G89 = bodyRules({ slideAudience: "school_8_9", textVolume: "standart", planItems: 5 } as never, "lesson");
/** ~100 belgi, 15 so'z — real o'zbekcha bosqich matni. */
const STEP100 = "Quyosh issiqligi suvni bug‘ga aylantiradi, bug‘ esa havoda sovib bulut hosil qiladi va yomg‘ir yog‘adi";

test("P11 (a): circle 3 bosqich (8–9 sinf) — 100 belgilik matn RASMSIZ qutiga sig'adi, qirqilmaydi; rail o'z (torroq) qutisida", () => {
  assert.ok(STEP100.length >= 95 && STEP100.length <= 105, `sinov matni ${STEP100.length}`);
  const target = layoutWordTargets(G89, "circle").stepTextBy[3];
  const words = STEP100.split(/\s+/).length;
  assert.ok(words <= target.max * 1.5, `sinov matni ${words} so'z > 1.5 × maqsad ${target.max}`);
  const raw = [{ layout: "process", title: "Suv aylanishi", steps: [1, 2, 3].map((i) => ({ n: String(i), title: `Bosqich ${i}`, text: STEP100 })) }];
  const write = (visual: "circle" | "rail") => extractNewSlides(JSON.stringify({ slides: raw }), 0, "F", G89, { final: true }, visual).map((x) => x.slide)[0];
  const circle = write("circle");
  assert.equal(circle.steps?.length, 3);
  for (const st of circle.steps!) assert.equal(st.text, STEP100, "circle rasmsiz qutisi 121 — 100 belgi kesilmasligi kerak");
  // `rail` ning qutisi torroq (85) — o'z o'lchovida qirqiladi, jadvalning 45 iga emas.
  const railMax = clipLimit("stepText", G89, "rail", 3, undefined, NO_IMAGE);
  assert.equal(railMax, 85);
  const rail = write("rail");
  for (const st of rail.steps!) {
    assert.ok(st.text.length <= railMax && st.text.length > limitsFor(G89, { steps: 3 }).stepText, `rail ${st.text.length}`);
    assert.ok(st.text.endsWith("…") && STEP100.startsWith(st.text.slice(0, -1)));
  }
});

test("P11: vizual bo'yicha o'lchov (20 pt, 3 bosqich) — circle/academic/rail rasmsiz 121/121/85, rasm bilan 42/42/36; jadval (zaxira) 45", () => {
  const cases = [
    ["circle", 121, 42],
    ["academic", 121, 42],
    ["rail", 85, 36],
  ] as const;
  for (const [visual, none, both] of cases) {
    assert.equal(fitChars("stepText", G89, visual, 3, { images: "none" }), none, `${visual} rasmsiz`);
    assert.equal(fitChars("stepText", G89, visual, 3), both, `${visual} rasm bilan`);
    assert.equal(clipLimit("stepText", G89, visual, 3, undefined, NO_IMAGE), none, `${visual}: qirqish = rasmsiz quti (jadval 45 emas)`);
    assert.equal(limitsFor(G89, { steps: 3 }, { visual, images: "none" }).stepText, none, `${visual}: tahrir chegarasi ham shu`);
    assert.equal(limitsFor(G89, { steps: 3 }, { visual, images: "both" }).stepText, Math.max(CLIP_FLOOR_CHARS, both), `${visual}: rasmli slayd — rasmli quti`);
  }
  // Vizual noma'lum — eski jadval (zaxira) o'zgarmagan.
  assert.equal(limitsFor(G89, { steps: 3 }).stepText, 45);
  assert.equal(clipLimit("stepText", G89, undefined, 3, undefined, NO_IMAGE), 45);
});

test("P11: limitsFor(rules, counts, {visual, images}) — clipLimit bilan AYNAN bir funksiya (generatsiya = tahrir)", () => {
  const bach = bodyRules({ slideAudience: "students_bachelor", textVolume: "standart", planItems: 5 } as never, "lecture");
  for (const rules of [G89, bach]) {
    for (const visual of ["circle", "academic", "rail", "story", "dashboard", "classic"] as const) {
      for (const images of ["none", "both"] as const) {
        for (const n of [2, 3, 4]) {
          const l = limitsFor(rules, { steps: n, stats: n, cols: n, rows: 4 }, { visual, images });
          const c = (f: Parameters<typeof clipLimit>[0], k?: number, rows?: number) => clipLimit(f, rules, visual, k, rows, { images });
          const tag = `${rules.minPt}pt/${visual}/${images}/${n}`;
          assert.equal(l.stepText, c("stepText", n), tag);
          assert.equal(l.stepTitle, c("stepTitle", n), tag);
          assert.equal(l.statLabel, c("statLabel", n), tag);
          assert.equal(l.tableCell, c("tableCell", n, 4), tag);
          assert.equal(l.tableHeader, c("tableHeader", n, 4), tag);
          assert.equal(l.tableHeaderWide, l.tableHeader, tag);
          assert.equal(l.quizOption, c("quizOption"), tag);
          // Statik shiftdan hech qachon oshmaydi.
          assert.ok(l.stepText <= SLIDE_LIMITS.stepText && l.statLabel <= SLIDE_LIMITS.statLabel && l.tableCell <= SLIDE_LIMITS.tableCell && l.quizOption <= SLIDE_LIMITS.quizOption, tag);
          assert.ok(l.tableHeader <= (n <= 3 ? SLIDE_LIMITS.tableHeaderWide : SLIDE_LIMITS.tableHeader), tag);
          // Son chegaralari vizualga bog'liq emas.
          assert.equal(l.stepsMax, limitsFor(rules).stepsMax, tag);
        }
      }
    }
  }
});
