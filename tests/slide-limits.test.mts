import test from "node:test";
import assert from "node:assert/strict";
import { extractMeta } from "../lib/generation/meta.ts";
import { SLIDE_LIMITS, clipTo, IMAGE_REDRAW_LIMIT, SLIDE_IMAGE_MAX_BYTES, UNDO_DEPTH, REBUILD_DEBOUNCE_MS } from "../lib/generation/slide-limits.ts";
import { resolveSlideTemplate } from "../lib/generation/slide-templates.ts";
import { QUIZ_MAX, QUIZ_OPTION_MAX, QUIZ_Q_MAX, STAT_LABEL_MAX, STEP_TEXT_MAX, writeSlidesWithLlm } from "../lib/generation/slide-write.ts";
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
  assert.equal(IMAGE_REDRAW_LIMIT, 5);
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
  assert.equal(s.left?.length, SLIDE_LIMITS.colItems, "ustundagi band soni chegarasi");
  assert.equal(s.left?.[0].length, SLIDE_LIMITS.colItem, "banddagi belgi chegarasi");
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
  assert.equal(s.stats?.length, SLIDE_LIMITS.statsMax);
  assert.equal(s.stats?.[0].value.length, SLIDE_LIMITS.statValue);
  assert.equal(s.stats?.[0].label.length, SLIDE_LIMITS.statLabel);
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
  assert.equal(s.steps?.length, SLIDE_LIMITS.stepsMax);
  assert.equal(s.steps?.[0].title.length, SLIDE_LIMITS.stepTitle);
  assert.equal(s.steps?.[0].text.length, SLIDE_LIMITS.stepText);
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
  assert.equal(wide.table?.headers[0].length, SLIDE_LIMITS.tableHeaderWide, "≤3 ustunda keng sarlavha");
  assert.equal(wide.table?.rows.length, SLIDE_LIMITS.tableRows);
  assert.equal(wide.table?.rows[0][0].length, SLIDE_LIMITS.tableCell);

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
  assert.equal(narrow.table?.headers[0].length, SLIDE_LIMITS.tableHeader, "4+ ustunda tor sarlavha");
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
  assert.equal(s.quiz?.[0].options[0].length, SLIDE_LIMITS.quizOption);
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
