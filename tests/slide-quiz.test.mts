import test from "node:test";
import assert from "node:assert/strict";
import { extractMeta } from "../lib/generation/meta.ts";
import { slideLabels } from "../lib/generation/i18n.ts";
import { planSlide, type SlideLayer } from "../lib/generation/slide-layout.ts";
import { finalizeQuiz, QUIZ_LETTERS } from "../lib/generation/slide-quiz.ts";
import { SLIDE_AUDIENCES, bodyRules } from "../lib/generation/slide-audience.ts";
import { SLIDE_THEMES, getSlideTheme } from "../lib/generation/slide-themes.ts";
import { resolveSlideTemplate } from "../lib/generation/slide-templates.ts";
import { coerceLayout, writeSlidesWithLlm } from "../lib/generation/slide-write.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";
import type { DocMeta } from "../lib/generation/types.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";

/**
 * WP-C — `quiz`, `references`, `answers`.
 *
 * Uch qatlam sinaladi: (1) MODEL javobining tozalanishi
 * (`normalizeSlide`, faqat haqiqiy yozuv yo'li orqali — u eksport
 * qilinmagan), (2) DEKA qoidalari (`finalizeQuiz`), (3) MAKET
 * (`slide-layout-extra.ts`).
 */

const theme = getSlideTheme("atlas");
const texts = (ls: SlideLayer[]) => ls.filter((l): l is Extract<SlideLayer, { t: "text" }> => l.t === "text");
const rects = (ls: SlideLayer[]) => ls.filter((l): l is Extract<SlideLayer, { t: "rect" }> => l.t === "rect");
const VISUALS = ["classic", "cards", "dense", "timeline", "magazine", "hero-split"] as const;
const bodyType = bodyRules({ slideAudience: "auto", textVolume: "standart", planItems: 5 }, "lecture");
const plan = (s: SlideModel, visual: (typeof VISUALS)[number] = "classic", th = theme) =>
  planSlide(s, th, visual, 1, 10, "auto", "lecture", { bodyType });
const allText = (p: { layers: SlideLayer[] }) =>
  texts(p.layers)
    .map((t) => t.text ?? t.lines?.join(" ") ?? "")
    .join("\n");

// ═══════════════════════════════════════════ 1. normalizeSlide (yozuv yo'li)

/**
 * `normalizeSlide` eksport qilinmagan, shuning uchun u HAQIQIY yo'l
 * orqali sinaladi: soxta LLM javobi → `parseDeckJson` → `normalizeSlide`
 * → `coerceLayout` → `finalizeQuiz`. Bu yo'l qo'shimcha foyda ham
 * beradi — bosqichlarning BIRIKMASI ham qulflanadi.
 */
async function deckFrom(slides: unknown[], over: Record<string, unknown> = {}): Promise<SlideModel[] | null> {
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
    const meta = extractMeta(TOOL_BY_ID.slide, { topic: "Suv aylanishi", ...over } as never);
    const tpl = resolveSlideTemplate("lecture", meta.topic);
    // Reja slaydlar sonidan olinadi: har javob slaydi o'z beat'iga tushsin.
    const beats = slides.map((s) => ({
      layout: (s as { layout: string }).layout as never,
      role: "sinov",
    }));
    return await writeSlidesWithLlm(meta, tpl, beats, Date.now() + 120_000);
  } finally {
    globalThis.fetch = realFetch;
    if (savedGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedGemini;
    if (savedXai !== undefined) process.env.XAI_API_KEY = savedXai;
  }
}

/**
 * Modelning O'ZI yozgan qismi.
 *
 * `writeSlidesWithLlm` deka boshiga titul, oxiriga yakun slaydini
 * QO'SHADI (`title-fix`/`end-fix`), shuning uchun sinov ular bo'yicha
 * emas, mazmun bo'yicha indekslanadi.
 */
function body(slides: SlideModel[] | null): SlideModel[] {
  assert.ok(slides, "deka yozilishi kerak");
  return slides.filter((s) => s.layout !== "title" && s.layout !== "closing");
}

/** 6 ta to'ldiruvchi slayd — `floor` (want × 0.85) tekshiruvidan o'tish uchun. */
function filler(n: number): unknown[] {
  return Array.from({ length: n }, (_, i) => ({
    layout: "bullets",
    title: `To‘ldiruvchi ${i + 1}`,
    bullets: ["Birinchi band gapi.", "Ikkinchi band gapi."],
  }));
}

const goodQuiz = {
  layout: "quiz",
  title: "Nazorat testi",
  quiz: [{ q: "Bug‘lanish qayerda ro‘y beradi?", options: ["Okeanda", "Bulutda", "Daryoda", "Muzda"], answer: 0 }],
};

test("normalize: variant soni 4 dan kam savol slaydni bandlarga tushiradi", async () => {
  const slides = await deckFrom([
    { ...goodQuiz, quiz: [{ q: "Uch variantli savol?", options: ["A", "B", "C"], answer: 1 }], bullets: ["Zaxira band gapi."] },
    ...filler(7),
  ]);
  const first = body(slides)[0];
  assert.equal(first.layout, "bullets", "3 variantli savol quiz bo'lib qololmaydi");
  assert.equal(first.quiz, undefined, "yarim savol modelda qolmasin");
  assert.deepEqual(first.bullets, ["Zaxira band gapi."]);
});

test("normalize: answer 0..3 oralig'iga qisiladi", async () => {
  const cases: [number, number][] = [
    [7, 3],
    [-4, 0],
    [2, 2],
  ];
  for (const [given, want] of cases) {
    const slides = await deckFrom([{ ...goodQuiz, quiz: [{ ...goodQuiz.quiz[0], answer: given }] }, ...filler(7)]);
    assert.equal(body(slides)[0].quiz?.[0].answer, want, `answer=${given} → ${want} bo'lishi kerak`);
  }
});

test("normalize: buzuq quiz maydoni slaydni bandlarga tushiradi", async () => {
  for (const broken of ["4 ta savol", 12, { q: "obyekt, massiv emas" }, [{ q: "", options: ["a", "b", "c", "d"], answer: 0 }]]) {
    const slides = await deckFrom([
      { layout: "quiz", title: "Test", quiz: broken, bullets: ["Zaxira band."] },
      ...filler(7),
    ]);
    assert.equal(body(slides)[0].layout, "bullets", `${JSON.stringify(broken)} → bandlar bo'lishi kerak`);
  }
});

/*
 * X-3 O'ZGARISHI. Ilgari bu test bitta slaydga solingan `QUIZ_MAX + 3`
 * savoldan `QUIZ_MAX` ta SLAYD chiqishini kutardi — ya'ni dekaning
 * REJADAN o'sishini rasman qulflab qo'ygan edi (aynan X-3 nuqsoni:
 * 10 slayd so'ragan foydalanuvchi 20 slayd olardi). Endi reja nechta
 * `quiz` slaydi bersa shuncha savol qoladi, ortiqchasi tashlanadi.
 *
 * `QUIZ_MAX` (normalizeSlide dagi `slice`) endi deka darajasida
 * KO'RINMAYDI — ortiqcha savol baribir tashlanadi, ya'ni u himoya
 * qatlami bo'lib qoldi. Uning o'rnini shu yerdagi UZUNLIK assertion'i
 * egallaydi: haqiqiy xavf «savol → slayd» edi, u endi imkonsiz.
 */
test("normalize: savol/variant chegaralari maketdan; ortiqcha savol SLAYD yasamaydi", async () => {
  const { QUIZ_Q_MAX, QUIZ_OPTION_MAX, QUIZ_MAX } = await import("../lib/generation/slide-write.ts");
  const model = [
    {
      layout: "quiz",
      title: "Test",
      quiz: Array.from({ length: QUIZ_MAX + 3 }, (_, i) => ({
        q: `${i}${"s".repeat(QUIZ_Q_MAX + 40)}`,
        options: Array.from({ length: 4 }, () => "v".repeat(QUIZ_OPTION_MAX + 30)),
        answer: 1,
      })),
    },
    ...filler(7),
  ];
  const slides = await deckFrom(model);
  const quizzes = body(slides).filter((s) => s.layout === "quiz");
  assert.equal(quizzes.length, 1, `reja bitta quiz slaydi bergan, ${quizzes.length} ta chiqdi`);
  assert.equal(quizzes[0].quiz!.length, 1, "bitta slaydda bitta savol");
  assert.equal(body(slides).length, model.length, "deka reja uzunligida qolishi kerak");
  const q = quizzes[0].quiz![0];
  assert.ok(q.q.length <= QUIZ_Q_MAX, `savol ${q.q.length} belgi`);
  for (const o of q.options) assert.ok(o.length <= QUIZ_OPTION_MAX, `variant ${o.length} belgi`);

  // Reja UCHTA quiz slaydi bersa — uchta savol, tartibi saqlangan holda.
  const three = await deckFrom([
    { ...goodQuiz, quiz: [1, 2, 3].map((n) => ({ q: `Savol ${n}?`, options: ["A", "B", "C", "D"], answer: 0 })) },
    { ...goodQuiz, quiz: [{ q: "Ortiqcha 1?", options: ["A", "B", "C", "D"], answer: 1 }] },
    { ...goodQuiz, quiz: [{ q: "Ortiqcha 2?", options: ["A", "B", "C", "D"], answer: 2 }] },
    ...filler(5),
  ]);
  const got = body(three).filter((s) => s.layout === "quiz");
  assert.equal(got.length, 3, "reja uchta quiz slaydi bergan");
  assert.deepEqual(got.map((s) => s.quiz![0].q), ["Savol 1?", "Savol 2?", "Savol 3?"], "savollar slaydlarga taqsimlanmadi");
  assert.equal(body(three).length, 8, "deka reja uzunligida qolishi kerak");
});

test("normalize: manbasiz references bandlar bilan qoladi, havola esa butun saqlanadi", async () => {
  const url = `https://uz.wikipedia.org/wiki/${"a".repeat(120)}`;
  const withRefs = await deckFrom([
    { layout: "references", title: "Adabiyotlar", refs: [{ title: "x".repeat(140), source: url }] },
    ...filler(7),
  ]);
  const refSlide = body(withRefs)[0];
  const ref = refSlide.refs![0];
  assert.equal(refSlide.layout, "references");
  assert.ok(ref.title.length <= 90, `nom ${ref.title.length} belgi — 90 dan oshdi`);
  assert.equal(ref.source, url, "URL 200 belgigacha butun saqlanishi kerak");

  const noRefs = await deckFrom([
    { layout: "references", title: "Adabiyotlar", bullets: ["Darslik, 2019-yil."] },
    ...filler(7),
  ]);
  assert.equal(body(noRefs)[0].layout, "references", "manbasiz ham maket saqlanadi — izoh «tekshirilmagan» deydi");
  assert.deepEqual(body(noRefs)[0].bullets, ["Darslik, 2019-yil."]);
});

// ═══════════════════════════════════════════════════ 2. coerceLayout

test("coerceLayout: quiz va references MAJBURLANMAYDI", () => {
  const bare: SlideModel = { id: "s", layout: "bullets", title: "Band", bullets: ["Bir", "Ikki"] };
  assert.equal(coerceLayout(bare, "quiz").layout, "bullets", "savolsiz slayd quiz ga aylantirilmasin");
  assert.equal(coerceLayout(bare, "references").layout, "bullets", "manbasiz slayd references ga aylantirilmasin");

  const withQuiz: SlideModel = { ...bare, quiz: [{ q: "Savol?", options: ["a", "b", "c", "d"], answer: 0 }] };
  assert.equal(coerceLayout(withQuiz, "quiz").layout, "quiz", "savol bor — layout qo'yiladi");
  const withRefs: SlideModel = { ...bare, refs: [{ title: "uz.wikipedia.org", source: "https://uz.wikipedia.org" }] };
  assert.equal(coerceLayout(withRefs, "references").layout, "references", "manba bor — layout qo'yiladi");
  // Ma'lumot saqlanadi — majburlash o'rniga model yozgani qoladi.
  assert.deepEqual(coerceLayout(bare, "quiz").bullets, ["Bir", "Ikki"]);
});

// ═══════════════════════════════════════════════════ 3. finalizeQuiz

const META: DocMeta = extractMeta(TOOL_BY_ID.slide, { topic: "Suv aylanishi" } as never);

function quizSlide(id: string, n: number): SlideModel {
  return {
    id,
    layout: "quiz",
    title: "Nazorat testi",
    footer: "Muallif · TDPU",
    quiz: Array.from({ length: n }, (_, i) => ({
      q: `Savol ${i + 1}?`,
      options: ["Birinchi", "Ikkinchi", "Uchinchi", "To‘rtinchi"],
      answer: i % 4,
    })),
  };
}

/**
 * REJADAGI deka — `blocksToBeats` beradigan shakl (X-3).
 *
 * Ilgari bu yordamchi BITTA ko'p savolli `quiz` slaydi berardi va
 * `finalizeQuiz` uni ajratardi. Endi savol slaydlari rejada bor:
 * test faqat ULARNI to'ldirishni sinaydi. `answers` ham rejadan
 * keladi — funksiya slayd QO'SHMAYDI.
 */
function deck(quizzes: SlideModel[], answers = false): SlideModel[] {
  return [
    { id: "s0", layout: "title", title: "Suv aylanishi", footer: "F" },
    ...quizzes,
    ...(answers ? [{ id: "sa", layout: "answers" as const, title: "Kalit", bullets: ["model yozgan axlat"], footer: "F" }] : []),
    { id: "sz", layout: "closing", title: "Xulosa", footer: "F" },
  ];
}

/** Rejadagi `n` ta bo'sh savol slaydi — model hali savol yozmagan holat. */
function emptyQuizzes(n: number): SlideModel[] {
  return Array.from({ length: n }, (_, i) => ({ ...quizSlide(`q${i}`, 0), quiz: [] }));
}

/*
 * X-3 O'ZGARISHI. Eski test «uchta savol — uchta slayd» deb AJRATISHNI
 * qulflardi, ya'ni dekaning rejadan uzayishini shartnoma deb yozgan
 * edi. Endi ajratish rejaga ko'chgan: bu yerda taqsimlash sinaladi va
 * har uch holatda ham DEKA UZUNLIGI o'zgarmasligi talab qilinadi.
 */
test("finalizeQuiz: savollar rejadagi slaydlarga taqsimlanadi, uzunlik o'zgarmaydi", () => {
  // (a) model hammasini BIRINCHI slaydga solgan.
  const packed = deck([quizSlide("s1", 3), ...emptyQuizzes(2)]);
  const beforeA = packed.length;
  finalizeQuiz(packed, META);
  const a = packed.filter((s) => s.layout === "quiz");
  assert.equal(packed.length, beforeA, "deka uzunligi o'zgardi");
  assert.deepEqual(a.map((s) => s.quiz!.length), [1, 1, 1], "har slaydda bitta savol");
  assert.deepEqual(a.map((s) => s.quiz![0].q), ["Savol 1?", "Savol 2?", "Savol 3?"], "savol tartibi saqlanadi");
  assert.equal(new Set(packed.map((s) => s.id)).size, packed.length, "id lar noyob bo'lishi kerak");
  assert.equal(a[0].id, "s1", "slayd O'Z id sida qoladi");
  for (const s of a) assert.equal(s.footer, "Muallif · TDPU", "kolontitul saqlanadi");
  assert.equal(packed[packed.length - 1].layout, "closing", "yakun slaydi oxirida qoladi");

  // (b) model REJADAN KO'P savol yozgan — ortiqchasi tashlanadi.
  const many = deck([quizSlide("s1", 3), quizSlide("s2", 3)]);
  finalizeQuiz(many, META);
  const b = many.filter((s) => s.layout === "quiz");
  assert.equal(many.length, 4, "ortiqcha savol slayd yasadi");
  assert.deepEqual(b.map((s) => s.quiz![0].q), ["Savol 1?", "Savol 2?"], "birinchi ikkitasi qoladi, qolgani tashlanadi");

  // (c) model REJADAN KAM savol yozgan — ortgan slayd o'z holicha qoladi.
  const few = deck([quizSlide("s1", 1), ...emptyQuizzes(2)]);
  finalizeQuiz(few, META);
  assert.equal(few.length, 5, "kam savol deka uzunligini qisqartirdi");
  assert.deepEqual(
    few.filter((s) => s.layout === "quiz").map((s) => s.quiz!.length),
    [1, 0, 0],
    "bor savol birinchi slaydga, qolgani bo'sh qoladi",
  );
});

test("finalizeQuiz: to'g'ri javob NOTIQ IZOHIGA yoziladi", () => {
  const slides = deck([quizSlide("s1", 3), ...emptyQuizzes(2)]);
  finalizeQuiz(slides, META);
  const quizzes = slides.filter((s) => s.layout === "quiz");
  assert.deepEqual(
    quizzes.map((s) => s.notes),
    ["Javob: A — Birinchi", "Javob: B — Ikkinchi", "Javob: C — Uchinchi"],
  );
});

test("finalizeQuiz: mavjud izoh ustiga yozilmaydi va takror chaqiruv qo'shmaydi", () => {
  const one = quizSlide("s1", 1);
  const slides = deck([{ ...one, notes: "Sinfga 2 daqiqa bering." }]);
  finalizeQuiz(slides, META);
  const notes = slides.find((s) => s.layout === "quiz")!.notes!;
  assert.ok(notes.startsWith("Sinfga 2 daqiqa bering."), "model yozgan izoh saqlanadi");
  assert.ok(notes.includes("Javob: A — Birinchi"), "javob qo'shiladi");
  finalizeQuiz(slides, META);
  assert.equal(slides.find((s) => s.layout === "quiz")!.notes, notes, "ikkinchi chaqiruv javobni takrorlamaydi");
});

/*
 * X-3 O'ZGARISHI. Eski test `finalizeQuiz` javoblar slaydini
 * QO'SHISHINI talab qilardi — aynan shu qo'shish dekani rejadan bir
 * slaydga uzaytirardi. Endi slayd rejada (`blocksToBeats` 8-qoidasi),
 * bu funksiya esa uni TO'LDIRADI. Shuning uchun assertion «qo'shildimi»
 * dan «to'ldirildimi va uzunlik o'zgarmadimi» ga ko'chdi.
 */
test("finalizeQuiz: rejadagi javoblar slaydi to'ldiriladi, YANGI slayd qo'shilmaydi", () => {
  const slides = deck([quizSlide("s1", 3), ...emptyQuizzes(2)], true);
  const before = slides.length;
  finalizeQuiz(slides, { ...META, speakerNotes: false });
  const at = slides.findIndex((s) => s.layout === "answers");
  assert.equal(slides.length, before, "javoblar slaydi QO'SHILDI — deka uzaydi");
  assert.equal(at, slides.length - 2, "yakun slaydidan OLDIN turishi kerak");
  assert.equal(slides[slides.length - 1].layout, "closing");
  assert.deepEqual(slides[at].bullets, ["1 — A", "2 — B", "3 — C"], "model yozgani ustiga kalit yozilmadi");
  assert.equal(slides[at].title, slideLabels("uz").answers);
  assert.equal(slides[at].footer, "Muallif · TDPU", "kolontitul test slaydidan olinadi");

  // Rejada `answers` yo'q (juda qisqa deka) — funksiya uni O'ZI qo'shmaydi.
  const noKey = deck([quizSlide("s1", 3), ...emptyQuizzes(2)]);
  finalizeQuiz(noKey, { ...META, speakerNotes: false });
  assert.equal(noKey.some((s) => s.layout === "answers"), false, "rejada yo'q slayd qo'shildi — uzunlik shartnomasi buzildi");
  assert.equal(noKey.length, 5, "deka uzunligi o'zgardi");
  // Javob yo'qolmaydi — u har savol slaydining izohida qoladi.
  assert.ok(noKey.filter((s) => s.layout === "quiz").every((s) => s.notes?.startsWith("Javob:")));
});

test("finalizeQuiz: izoh yoqiq bo'lsa rejada javoblar slaydi bo'lmaydi", () => {
  const slides = deck([quizSlide("s1", 3), ...emptyQuizzes(2)]);
  finalizeQuiz(slides, { ...META, speakerNotes: true });
  assert.equal(slides.some((s) => s.layout === "answers"), false, "izoh yoqiq — javob izohda, alohida slayd shart emas");
  assert.equal(slides.length, 5, "3 savol + titul + yakun");
});

test("finalizeQuiz: testsiz dekaga tegmaydi", () => {
  const slides: SlideModel[] = [
    { id: "s0", layout: "title", title: "T", footer: "F" },
    { id: "s1", layout: "bullets", title: "B", bullets: ["x"], footer: "F" },
    { id: "s2", layout: "closing", title: "X", footer: "F" },
  ];
  const before = JSON.stringify(slides);
  finalizeQuiz(slides, { ...META, speakerNotes: false });
  assert.equal(JSON.stringify(slides), before, "test yo'q — deka o'zgarmasin");
});

test("finalizeQuiz: javoblar slaydining sarlavhasi deka tiliga ergashadi", () => {
  const titles = ["uz", "ru", "en"].map((language) => {
    const slides = deck([quizSlide("s1", 2), ...emptyQuizzes(1)], true);
    finalizeQuiz(slides, { ...META, language, speakerNotes: false });
    const title = slides.find((s) => s.layout === "answers")!.title;
    assert.equal(title, slideLabels(language).answers, `${language}: sarlavha yorliqdan olinishi kerak`);
    return title;
  });
  /*
   * Yorliqning O'ZI tarjima qilinganini ham tekshiramiz: yuqoridagi
   * solishtiruv ikkala tomonni bitta manbadan oladi, ya'ni ruscha
   * yorliq o'zbekcha qolib ketsa ham u yashil qolardi (mutatsiya M20
   * aynan shuni ko'rsatdi). Ruscha dekada o'zbekcha sarlavha —
   * AUDIT-6 A4 dagi aralash til nuqsoni.
   */
  assert.equal(new Set(titles).size, 3, `har til o'z yorlig'ini olishi kerak: ${titles.join(" / ")}`);
});

test("finalizeQuiz: deterministik — bir xil kirish, bir xil chiqish", () => {
  const a = deck([quizSlide("s1", 4), ...emptyQuizzes(3)], true);
  const b = deck([quizSlide("s1", 4), ...emptyQuizzes(3)], true);
  finalizeQuiz(a, { ...META, speakerNotes: false });
  finalizeQuiz(b, { ...META, speakerNotes: false });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

// ═══════════════════════════════════════════════════════ 4. maketlar

const quizModel: SlideModel = {
  id: "q",
  layout: "quiz",
  title: "Nazorat testi",
  footer: "Muallif · TDPU",
  quiz: [
    {
      q: "Suvning bug‘lanishi asosan qayerda ro‘y beradi va bunga qaysi energiya sarflanadi?",
      options: ["Okean yuzasida, quyosh energiyasi", "Bulut ichida", "Yer ostida", "Muzliklarda"],
      answer: 0,
    },
  ],
};

const refsModel: SlideModel = {
  id: "r",
  layout: "references",
  title: "Foydalanilgan adabiyotlar",
  footer: "Muallif · TDPU",
  refs: [
    { title: "uz.wikipedia.org", source: "https://uz.wikipedia.org/wiki/Suv_aylanishi" },
    { title: "NASA — Water Cycle", source: "https://science.nasa.gov/earth/water-cycle/very-long-path/segment" },
  ],
};

const answersModel: SlideModel = {
  id: "a",
  layout: "answers",
  title: "Test javoblari",
  footer: "Muallif · TDPU",
  bullets: ["1 — A", "2 — B", "3 — C", "4 — D", "5 — A"],
};

test("uchala maket 15 tema × 6 visual da chegara ichida qoladi", () => {
  const long = "Juda uzun matn bo‘lagi bo‘lib, u qutiga sig‘masligi mumkin. ".repeat(3);
  const samples: SlideModel[] = [
    quizModel,
    { ...quizModel, id: "q2", title: long, quiz: [{ q: long, options: [long, long, long, long], answer: 3 }] },
    { ...quizModel, id: "q3", quiz: [] as never, bullets: ["Savolsiz test slaydi."] },
    refsModel,
    { ...refsModel, id: "r2", refs: Array.from({ length: 6 }, () => ({ title: long, source: `https://${"d".repeat(80)}.uz/${"p".repeat(60)}` })) },
    { ...refsModel, id: "r3", refs: [], bullets: ["Manbasiz band."] },
    answersModel,
    { ...answersModel, id: "a2", bullets: Array.from({ length: 12 }, (_, i) => `${i + 1} — ${QUIZ_LETTERS[i % 4]}`) },
    { ...answersModel, id: "a3", bullets: [] },
    // X-4: yirik kalit rejimi (1–2 javob) ham chegara ichida qolsin —
    // karta maydonni bo'lib oladi, ya'ni pastki chegaraga eng yaqin holat.
    { ...answersModel, id: "a4", bullets: ["1 — B"] },
    { ...answersModel, id: "a5", bullets: ["1 — B", "2 — D"] },
    { ...answersModel, id: "a6", bullets: [long, long] },
  ];
  for (const t of SLIDE_THEMES) {
    const th = getSlideTheme(t.id);
    for (const visual of VISUALS) {
      for (const s of samples) {
        // Logo bor holat ham: yuqori sarlavhalar `reserve` bilan torayadi.
        for (const logo of [undefined, "data:image/png;base64,AA"]) {
          const p = planSlide(s, th, visual, 1, 10, "auto", "lecture", { bodyType, logo });
          for (const l of p.layers) {
            const tag = `${t.id}/${visual}/${s.id}${logo ? "+logo" : ""}`;
            assert.ok(l.box.x >= -0.01 && l.box.y >= -0.01, `${tag}: manfiy koordinata`);
            assert.ok(l.box.w >= 0 && l.box.h >= 0, `${tag}: manfiy o'lcham`);
            assert.ok(l.box.x + l.box.w <= 13.34, `${tag}: kenglikdan chiqdi (${l.box.x + l.box.w})`);
            assert.ok(l.box.y + l.box.h <= 7.51, `${tag}: balandlikdan chiqdi (${l.box.y + l.box.h})`);
          }
        }
      }
    }
  }
});

test("quiz maketi to'rtala variantni A/B/C/D harfi bilan chizadi", () => {
  for (const visual of VISUALS) {
    const p = plan(quizModel, visual);
    const drawn = allText(p);
    for (const o of quizModel.quiz![0].options) {
      assert.ok(drawn.includes(o), `${visual}: «${o}» varianti chizilmadi`);
    }
    for (const letter of QUIZ_LETTERS) {
      assert.ok(
        texts(p.layers).some((t) => t.text === letter),
        `${visual}: «${letter}» harfi yo'q`,
      );
    }
    assert.ok(drawn.includes(quizModel.quiz![0].q), `${visual}: savol matni chizilmadi`);
  }
});

/**
 * TO'G'RI JAVOB SLAYDDA KO'RINMAYDI.
 *
 * Tekshiruv «Javob» so'zini izlash bilan cheklanmaydi: `answer`
 * indeksini 0..3 ga o'zgartirib, chizma AYNAN bir xil qolishi
 * talab qilinadi. Ya'ni javob rang, ramka, tartib yoki qo'shimcha
 * qatlam orqali ham sizib chiqa olmaydi.
 */
test("quiz slaydida to'g'ri javob hech qanday ko'rinishda sizmaydi", () => {
  for (const visual of VISUALS) {
    const base = JSON.stringify(plan({ ...quizModel, quiz: [{ ...quizModel.quiz![0], answer: 0 }] }, visual));
    for (const answer of [1, 2, 3]) {
      const other = JSON.stringify(plan({ ...quizModel, quiz: [{ ...quizModel.quiz![0], answer }] }, visual));
      assert.equal(other, base, `${visual}: answer=${answer} chizmani o'zgartirdi — javob ko'rinib qoladi`);
    }
    assert.ok(!allText(plan(quizModel, visual)).includes("Javob"), `${visual}: slaydda «Javob» so'zi bor`);
  }
});

test("quiz maketi har `visual` da boshqacha chiziladi, `dense` to'q sahifada", () => {
  const drawn = VISUALS.map((v) => JSON.stringify(plan(quizModel, v)));
  assert.equal(new Set(drawn).size, VISUALS.length, "har shablon o'z maketini olishi kerak");
  assert.equal(plan(quizModel, "dense").bg, theme.titleBg, "dense — to'q sahifa");
  for (const v of VISUALS.filter((x) => x !== "dense")) {
    assert.equal(plan(quizModel, v).bg, theme.bg, `${v}: yorug' sahifada qolsin`);
  }
});

test("quiz ranglari faqat o'lchangan juftliklardan", () => {
  for (const t of SLIDE_THEMES) {
    const th = getSlideTheme(t.id);
    const light = new Set([th.text, th.accentInk, th.muted]);
    const dark = new Set([th.titleText, th.titleMuted]);
    for (const visual of VISUALS) {
      const p = plan(quizModel, visual, th);
      const dense = visual === "dense";
      for (const l of texts(p.layers)) {
        const ok = dense ? dark.has(l.color) : light.has(l.color) || dark.has(l.color);
        // `atlas` da `titleMuted` aynan `accent` ga teng — shuning uchun
        // tekshiruv rangni «aksentmi» deb emas, O'LCHANGAN juftlar
        // ro'yxatida bormi deb so'raydi.
        assert.ok(ok, `${t.id}/${visual}: «${l.text}» rangi ${l.color} — o'lchanmagan juft`);
      }
    }
  }
});

test("savolsiz quiz slaydi bo'sh ramka bo'lib qolmaydi", () => {
  const p = plan({ ...quizModel, quiz: [], bullets: ["Zaxira band gapi."] });
  assert.ok(allText(p).includes("Zaxira band gapi."), "bandlar chizilishi kerak");
});

test("references maketi manbani ham, raqamni ham, izohni ham chizadi", () => {
  for (const visual of VISUALS) {
    const drawn = allText(plan(refsModel, visual));
    assert.ok(drawn.includes("uz.wikipedia.org/wiki/Suv_aylanishi"), `${visual}: havola ko'rinmadi`);
    assert.ok(drawn.includes("NASA — Water Cycle"), `${visual}: manba nomi ko'rinmadi`);
    assert.ok(drawn.includes("01") && drawn.includes("02"), `${visual}: raqamlash yo'q`);
    assert.ok(drawn.includes("Manba: internet (Google Search)"), `${visual}: manba izohi yo'q`);
    // Protokol tashlanadi — qator qisqaradi.
    assert.ok(!drawn.includes("https://uz.wikipedia.org"), `${visual}: URL qisqartirilmagan`);
  }
});

test("references: uzun havola 60 belgida qisqaradi, model yozgan ro'yxat «tekshirilmagan» deb belgilanadi", () => {
  const longUrl = `https://example.uz/${"p".repeat(120)}`;
  const drawnLong = allText(plan({ ...refsModel, refs: [{ title: "Manba", source: longUrl }] }));
  const shown = drawnLong.split("\n").find((l) => l.startsWith("example.uz"))!;
  assert.ok(shown.length <= 60, `havola ${shown.length} belgi — 60 dan oshdi`);
  assert.ok(shown.endsWith("…"), "qisqartirish belgisi qo'yilishi kerak");

  // Model havolasiz yozgan ro'yxat ishonchli ko'rinmasin.
  const offline = allText(plan({ ...refsModel, refs: [{ title: "Darslik, 2019", source: "Toshkent" }] }));
  assert.ok(offline.includes("Tekshirilmagan ro‘yxat"), "havolasiz ro'yxat tekshirilmagan deb belgilanadi");
  assert.ok(!offline.includes("Manba: internet"), "havolasiz ro'yxat internetdan deb ko'rsatilmasin");

  const bullets = allText(plan({ ...refsModel, refs: [], bullets: ["Darslik, 2019-yil."] }));
  assert.ok(bullets.includes("Darslik, 2019-yil."), "manbasiz slaydda bandlar chiziladi");
  assert.ok(bullets.includes("Tekshirilmagan ro‘yxat"), "manbasiz slaydda ham izoh bo'lishi kerak");
});

/**
 * PDF nuqsoni: uch javobli kalit «2 + 1» bo'lib bo'linardi va slaydning
 * uchdan ikkisi bo'sh qolardi. Ustun soni endi javoblar soniga bog'liq.
 */
test("answers maketi ustun sonini javoblar soniga qarab tanlaydi", () => {
  const columns = (n: number) => {
    const p = plan({ ...answersModel, bullets: Array.from({ length: n }, (_, i) => `${i + 1} — ${QUIZ_LETTERS[i % 4]}`) });
    const cards = rects(p.layers).filter((r) => r.fill?.color === theme.surface);
    assert.equal(cards.length, n, `${n}: har javob o'z qatorida bo'lishi kerak`);
    return new Set(cards.map((r) => Number(r.box.x.toFixed(2)))).size;
  };
  for (const n of [3, 5, 6]) assert.equal(columns(n), 1, `${n} javob bitta ustunda qolsin`);
  for (const n of [7, 10, 12]) assert.equal(columns(n), 2, `${n} javob ikki ustunga bo'linsin`);

  const p = plan(answersModel);
  const drawn = allText(p);
  for (const b of answersModel.bullets!) assert.ok(drawn.includes(b), `«${b}» chizilmadi`);
});

/**
 * Bo'sh maydon: kam bandli slaydda blok tepaga yopishib qolmasin
 * (AUDIT-8 N-5 naqshi — PDF da uchala maketda ham ko'rindi).
 *
 * X-4 O'ZGARISHI. `answers` uchun MARKAZLASHTIRISH yetarli emasligi
 * aniqlandi: u bo'sh maydonni faqat SURADI. Kalit endi maydonni
 * qoldiqsiz bo'lib oladi, ya'ni «tepaga yopishib qolmadimi» o'lchovi
 * o'z ma'nosini yo'qotdi — uning o'rniga QAMROV o'lchanadi (pastdagi
 * test). Bu yerda faqat sarlavha bilan kesishmaslik va maydonning
 * yarmidan oshib tushish qoladi. `references` esa hamon markazlashadi.
 */
test("kam bandli answers va references bloklari maydonni bo'sh qoldirmaydi", () => {
  const gapOf = (p: { layers: SlideLayer[] }, fill: string) => {
    const cards = rects(p.layers).filter((r) => r.fill?.color === fill);
    const first = Math.min(...cards.map((r) => r.box.y));
    const last = Math.max(...cards.map((r) => r.box.y + r.box.h));
    return { top: first, bottom: last };
  };
  const answers = gapOf(plan({ ...answersModel, bullets: ["1 — A", "2 — B", "3 — C"] }), theme.surface);
  assert.ok(answers.top > 1.4, `javoblar bloki sarlavha ustiga chiqdi (y=${answers.top})`);
  assert.ok(answers.bottom > 6.3, `javoblar bloki maydon oxirigacha yetmadi (${answers.bottom})`);

  const refs = plan({ ...refsModel, refs: refsModel.refs!.slice(0, 2) });
  const nums = texts(refs.layers).filter((t) => t.text === "01" || t.text === "02");
  assert.equal(nums.length, 2);
  assert.ok(Math.min(...nums.map((t) => t.box.y)) > 1.9, "manbalar bloki ham markazlashadi");
});

/**
 * PDF nuqsoni: `timeline` da nuqta qatorning TEPASIDA, matn esa
 * markazda chizilardi — har nuqta o'z variantidan ~0.3 dyuym yuqorida
 * turar va o'q variantlar orasidagi bo'shliq bilan hizalangandek
 * ko'rinardi.
 */
test("timeline quiz nuqtalari variant matni bilan bir markazda", () => {
  const p = plan(quizModel, "timeline");
  const dots = rects(p.layers).filter((r) => r.radius === 0.11 && r.fill?.color === theme.accent);
  assert.equal(dots.length, 4, "har variantga bitta nuqta");
  const rows = texts(p.layers).filter((t) => quizModel.quiz![0].options.includes(t.text ?? ""));
  assert.equal(rows.length, 4);
  dots.sort((a, b) => a.box.y - b.box.y);
  rows.sort((a, b) => a.box.y - b.box.y);
  dots.forEach((d, i) => {
    const dotMid = d.box.y + d.box.h / 2;
    const textMid = rows[i].box.y + rows[i].box.h / 2;
    assert.ok(Math.abs(dotMid - textMid) < 0.02, `${i + 1}-nuqta ${Math.abs(dotMid - textMid).toFixed(2)}″ siljigan`);
  });
});

test("answers: 12 tagacha javob shrift polidan yuqorida qoladi", () => {
  const many = Array.from({ length: 12 }, (_, i) => `${i + 1} — ${QUIZ_LETTERS[i % 4]}`);
  const p = plan({ ...answersModel, bullets: many });
  for (const t of texts(p.layers).filter((x) => many.includes(x.text ?? ""))) {
    assert.ok(t.size >= 12, `javob matni ${t.size} pt ga tushdi`);
  }
});

// ═══════════════════════════════════════════ X-4: kalitning BO'SH MAYDONI

/** «1 — A», «2 — B»… — `finalizeQuiz` yozadigan kalit qatorlari. */
const key = (n: number) => Array.from({ length: n }, (_, i) => `${i + 1} — ${QUIZ_LETTERS[i % 4]}`);

/**
 * Matn qatlamlari qamragan BALANDLIK ulushi (slayd balandligiga nisbatan).
 *
 * Ustma-ust tushgan qutilar bir marta sanaladi — ikki ustunli kalitda
 * o'ng ustun chapining balandligini TAKRORLAYDI, oddiy yig'indi esa
 * qamrovni ikki barobar ko'rsatib, o'lchovni yolg'on qilardi.
 */
function textCover(p: { layers: SlideLayer[] }, only: string[]): number {
  const spans = texts(p.layers)
    .filter((t) => only.includes(t.text ?? ""))
    .map((t) => [t.box.y, t.box.y + t.box.h] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let cur: [number, number] | null = null;
  for (const [a, b] of spans) {
    if (!cur || a > cur[1]) {
      if (cur) covered += cur[1] - cur[0];
      cur = [a, b];
    } else if (b > cur[1]) cur[1] = b;
  }
  if (cur) covered += cur[1] - cur[0];
  return covered / 7.5;
}

/**
 * X-4 — jonli PDF nuqsoni.
 *
 * Rejaga bitta savol sig'di, ya'ni kalitda BITTA qator qoldi: u qat'iy
 * 1.15″ qutida, maydon o'rtasida chizilar va 13.3×7.5″ slaydning ~86% i
 * bo'sh qolardi (AUDIT-8 N-3/N-5 naqshi). O'lchov aynan shu nuqsonni
 * ushlaydi: qamrov 1 javobda ham slayd balandligining kamida 45% i.
 * Nuqson vaqtidagi qiymat — 13.7%.
 */
test("answers: 1 javobda ham kalit slaydning kamida 45% ini egallaydi", () => {
  const worst: string[] = [];
  for (const n of [1, 2, 3, 6, 7, 10, 12]) {
    const items = key(n);
    for (const visual of VISUALS) {
      const share = textCover(plan({ ...answersModel, bullets: items }, visual), items);
      if (share < 0.45) worst.push(`${n} javob/${visual}: ${(share * 100).toFixed(0)}%`);
    }
  }
  assert.deepEqual(worst, [], `kalit bo'sh maydon qoldirdi:\n  ${worst.join("\n  ")}`);
  // Kalit maydonni QOLDIQSIZ bo'lib oladi: qamrov javob sonidan deyarli
  // mustaqil — 1 javob bilan 10 javob orasidagi farq 15% dan kam.
  const one = textCover(plan({ ...answersModel, bullets: key(1) }), key(1));
  const ten = textCover(plan({ ...answersModel, bullets: key(10) }), key(10));
  assert.ok(Math.abs(one - ten) < 0.15, `1 javob ${(one * 100).toFixed(0)}%, 10 javob ${(ten * 100).toFixed(0)}%`);
});

/**
 * 1–2 javob — YIRIK kalit varag'i: keng karta, markazlashgan matn,
 * yirik shrift. 3 tadan boshlab oddiy ustun rejimi (chapdan boshlanadi).
 */
test("answers: 1–2 javob yirik kalit kartasi, 3 dan boshlab oddiy ustun", () => {
  for (const n of [1, 2]) {
    const items = key(n);
    const p = plan({ ...answersModel, bullets: items });
    const cards = rects(p.layers).filter((r) => r.fill?.color === theme.surface);
    assert.equal(cards.length, n, `${n}: har javobga bitta karta`);
    assert.ok(cards[0].box.w > 9, `${n}: yirik kalit kartasi tor qoldi (${cards[0].box.w.toFixed(1)}″)`);
    const rows = texts(p.layers).filter((t) => items.includes(t.text ?? ""));
    assert.equal(rows.length, n);
    for (const t of rows) {
      assert.equal(t.align, "center", `${n}: yirik kalit matni markazda emas`);
      assert.ok(t.size >= 40, `${n}: yirik kalit shrifti ${t.size} pt — kalit varag'i bo'lib ko'rinmaydi`);
    }
    /*
     * Aksent tasma yirik kartada TEPADA va aynan karta kengligida.
     * Tekshiruv karta koordinatasiga bog'lanadi: `pushChrome` ning
     * sahifa bo'ylab aksent chizig'i («bar-top» temalari) ham «keng va
     * ingichka» edi va umumiy shart uni karta tasmasi deb qabul qilardi.
     */
    for (const card of cards) {
      assert.ok(
        rects(p.layers).some(
          (r) => r.fill?.color === theme.accent && r.box.x === card.box.x && r.box.y === card.box.y && r.box.w === card.box.w && r.box.h < 0.2,
        ),
        `${n}: yirik kartada tepa tasma yo'q`,
      );
    }
  }
  const three = key(3);
  const rows3 = texts(plan({ ...answersModel, bullets: three }).layers).filter((t) => three.includes(t.text ?? ""));
  assert.equal(rows3.length, 3);
  for (const t of rows3) assert.equal(t.align, undefined, "3 javob oddiy ustunda chapdan o'qiladi");
});

/**
 * Slide Law: kalit shrifti ham auditoriya polida qoladi (maktabda 20–24,
 * ma'ruzada 15 pt). Ilgari bu maketda pol qo'lda 12 pt qilib yozilgan edi
 * — ya'ni 8–9 sinf uchun tanlangan 20 pt poli kalit slaydida ishlamasdi.
 */
test("answers shrifti AUDITORIYA polidan pastga tushmaydi", () => {
  const fails: string[] = [];
  for (const audience of SLIDE_AUDIENCES) {
    if (audience === "auto") continue;
    const bt = bodyRules({ slideAudience: audience, textVolume: "kop", planItems: 5 }, "lesson");
    for (const n of [1, 6, 12]) {
      const items = key(n);
      const p = planSlide({ ...answersModel, bullets: items }, theme, "classic", 1, 10, audience, "lesson");
      for (const t of texts(p.layers).filter((x) => items.includes(x.text ?? ""))) {
        if (t.size < bt.minPt) fails.push(`${audience}/${n}: ${t.size} pt < ${bt.minPt} pt`);
      }
    }
  }
  assert.deepEqual(fails, [], `shrift poli buzildi:\n  ${fails.join("\n  ")}`);
});
