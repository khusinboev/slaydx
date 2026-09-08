import test from "node:test";
import assert from "node:assert/strict";
import { extractMeta } from "../lib/generation/meta.ts";
import { slideLabels } from "../lib/generation/i18n.ts";
import { planSlide, type SlideLayer } from "../lib/generation/slide-layout.ts";
import { finalizeQuiz, QUIZ_LETTERS } from "../lib/generation/slide-quiz.ts";
import { bodyRules } from "../lib/generation/slide-audience.ts";
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

test("normalize: savol va variant chegaralari maketdan olingan", async () => {
  const { QUIZ_Q_MAX, QUIZ_OPTION_MAX, QUIZ_MAX } = await import("../lib/generation/slide-write.ts");
  const slides = await deckFrom([
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
  ]);
  const quizzes = body(slides).filter((s) => s.layout === "quiz");
  assert.equal(quizzes.length, QUIZ_MAX, `${QUIZ_MAX} ta savol qolishi kerak, ${quizzes.length} ta chiqdi`);
  for (const s of quizzes) {
    assert.ok(s.quiz![0].q.length <= QUIZ_Q_MAX, `savol ${s.quiz![0].q.length} belgi`);
    for (const o of s.quiz![0].options) assert.ok(o.length <= QUIZ_OPTION_MAX, `variant ${o.length} belgi`);
  }
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

function deck(quiz: SlideModel): SlideModel[] {
  return [
    { id: "s0", layout: "title", title: "Suv aylanishi", footer: "F" },
    quiz,
    { id: "s2", layout: "closing", title: "Xulosa", footer: "F" },
  ];
}

test("finalizeQuiz: har savol alohida slaydga ajraladi, id lar noyob qoladi", () => {
  const slides = deck(quizSlide("s1", 3));
  finalizeQuiz(slides, META);
  const quizzes = slides.filter((s) => s.layout === "quiz");
  assert.equal(quizzes.length, 3, "uchta savol — uchta slayd");
  assert.deepEqual(quizzes.map((s) => s.quiz!.length), [1, 1, 1], "har slaydda bitta savol");
  assert.deepEqual(quizzes.map((s) => s.quiz![0].q), ["Savol 1?", "Savol 2?", "Savol 3?"], "savol tartibi saqlanadi");
  assert.equal(new Set(slides.map((s) => s.id)).size, slides.length, "id lar noyob bo'lishi kerak");
  assert.equal(quizzes[0].id, "s1", "birinchi savol slaydning O'Z id sida qoladi");
  for (const s of quizzes) {
    assert.equal(s.title, "Nazorat testi", "sarlavha saqlanadi");
    assert.equal(s.footer, "Muallif · TDPU", "kolontitul saqlanadi");
  }
  // Yakun slaydi oxirida qoladi.
  assert.equal(slides[slides.length - 1].layout, "closing");
});

test("finalizeQuiz: to'g'ri javob NOTIQ IZOHIGA yoziladi", () => {
  const slides = deck(quizSlide("s1", 3));
  finalizeQuiz(slides, META);
  const quizzes = slides.filter((s) => s.layout === "quiz");
  assert.deepEqual(
    quizzes.map((s) => s.notes),
    ["Javob: A — Birinchi", "Javob: B — Ikkinchi", "Javob: C — Uchinchi"],
  );
});

test("finalizeQuiz: mavjud izoh ustiga yozilmaydi va takror chaqiruv qo'shmaydi", () => {
  const one = quizSlide("s1", 1);
  const slides = deck({ ...one, notes: "Sinfga 2 daqiqa bering." });
  finalizeQuiz(slides, META);
  const notes = slides.find((s) => s.layout === "quiz")!.notes!;
  assert.ok(notes.startsWith("Sinfga 2 daqiqa bering."), "model yozgan izoh saqlanadi");
  assert.ok(notes.includes("Javob: A — Birinchi"), "javob qo'shiladi");
  finalizeQuiz(slides, META);
  assert.equal(slides.find((s) => s.layout === "quiz")!.notes, notes, "ikkinchi chaqiruv javobni takrorlamaydi");
});

test("finalizeQuiz: speakerNotes=false bo'lsa javoblar slaydi yakundan OLDIN qo'shiladi", () => {
  const slides = deck(quizSlide("s1", 3));
  finalizeQuiz(slides, { ...META, speakerNotes: false });
  const at = slides.findIndex((s) => s.layout === "answers");
  assert.ok(at > 0, "javoblar slaydi qo'shilishi kerak");
  assert.equal(at, slides.length - 2, "yakun slaydidan OLDIN turishi kerak");
  assert.equal(slides[slides.length - 1].layout, "closing");
  assert.deepEqual(slides[at].bullets, ["1 — A", "2 — B", "3 — C"]);
  assert.equal(slides[at].title, slideLabels("uz").answers);
  assert.equal(slides[at].footer, "Muallif · TDPU", "kolontitul test slaydidan olinadi");
});

test("finalizeQuiz: izoh yoqiq bo'lsa javoblar slaydi qo'shilmaydi", () => {
  const slides = deck(quizSlide("s1", 3));
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
  for (const language of ["uz", "ru", "en"]) {
    const slides = deck(quizSlide("s1", 2));
    finalizeQuiz(slides, { ...META, language, speakerNotes: false });
    assert.equal(
      slides.find((s) => s.layout === "answers")!.title,
      slideLabels(language).answers,
      `${language}: sarlavha o'z tilida bo'lishi kerak`,
    );
  }
});

test("finalizeQuiz: deterministik — bir xil kirish, bir xil chiqish", () => {
  const a = deck(quizSlide("s1", 4));
  const b = deck(quizSlide("s1", 4));
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

test("answers maketi hamma javobni ikki ustunda chizadi", () => {
  const p = plan(answersModel);
  const drawn = allText(p);
  for (const b of answersModel.bullets!) assert.ok(drawn.includes(b), `«${b}» chizilmadi`);
  const cards = rects(p.layers).filter((r) => r.fill?.color === theme.surface);
  assert.equal(cards.length, answersModel.bullets!.length, "har javob o'z qatorida");
  const xs = new Set(cards.map((r) => Number(r.box.x.toFixed(2))));
  assert.equal(xs.size, 2, `ikki ustun kutilgan, ${xs.size} ta chiqdi`);
});

test("answers: 12 tagacha javob shrift polidan yuqorida qoladi", () => {
  const many = Array.from({ length: 12 }, (_, i) => `${i + 1} — ${QUIZ_LETTERS[i % 4]}`);
  const p = plan({ ...answersModel, bullets: many });
  for (const t of texts(p.layers).filter((x) => many.includes(x.text ?? ""))) {
    assert.ok(t.size >= 12, `javob matni ${t.size} pt ga tushdi`);
  }
});
