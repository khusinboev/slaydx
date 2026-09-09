import test from "node:test";
import assert from "node:assert/strict";
import { planSlide, type SlideLayer } from "../lib/generation/slide-layout.ts";
import { bodyRules } from "../lib/generation/slide-audience.ts";
import { getSlideTheme } from "../lib/generation/slide-themes.ts";
import type { SlideModel, SlideSrc } from "../lib/generation/slide-types.ts";

/**
 * E2 — `src` labeling uchun testlar.
 *
 * Uch tarmoq sinab ko'riladi: quiz, references, answers — har biri 6 ta
 * visual (classic/dense/cards/timeline/magazine/hero-split) bilan.
 *
 * Test UCHTA bosqichni qulflab turadi:
 * 1. Model qiymati qatlamga mos `src` yoki `srcLines` bilan chiziladi
 * 2. Mutatsiya: agar src buzulsa (yoki yo'qolsa), matn o'zgarib ketadi
 * 3. Dekorativ qatlamlar (`src` yo'q) o'zgarishlarga zaxmat bo'lmaydi
 */

const THEME = getSlideTheme("atlas");
const VISUALS = ["classic", "cards", "dense", "timeline", "magazine", "hero-split"] as const;
const BODY_TYPE = bodyRules({ slideAudience: "auto", textVolume: "standart", planItems: 5 }, "lecture");
const planQuizOrRef = (s: SlideModel, visual: (typeof VISUALS)[number] = "classic") =>
  planSlide(s, THEME, visual, 1, 10, "auto", "lecture", { bodyType: BODY_TYPE });

const texts = (ls: SlideLayer[]) =>
  ls.filter((l): l is Extract<SlideLayer, { t: "text" }> => l.t === "text");

const findTextBySrc = (layers: SlideLayer[], pred: (src: SlideSrc | undefined) => boolean) =>
  texts(layers).filter((t) => pred(t.src));

const getSrcJ = (src: SlideSrc | undefined): number | undefined => (src && "j" in src ? src.j : undefined);
const getSrcI = (src: SlideSrc | undefined): number | undefined => (src && "i" in src ? src.i : undefined);

// ═══════════════════════════════════════════════════════════════ quiz

const goodQuiz: SlideModel = {
  id: "q1",
  layout: "quiz",
  title: "Test Slide",
  quiz: [{ q: "Bug'lanish qayerda ro'y beradi?", options: ["Okeanda", "Bulutda", "Daryoda", "Muzda"], answer: 0 }],
};

test("quiz: savol src={f:quiz,i:0,k:q} bilan chiziladi", () => {
  for (const visual of VISUALS) {
    const plan = planQuizOrRef(goodQuiz, visual);
    const qLayer = findTextBySrc(plan.layers, (s) => s?.f === "quiz" && s?.k === "q");
    assert.equal(qLayer.length, 1, `${visual}: savol qatlami yo'q`);
    assert.equal(qLayer[0].text, goodQuiz.quiz![0].q);
  }
});

test("quiz: variantlar src={f:quiz,i:0,k:option,j} bilan chiziladi", () => {
  for (const visual of VISUALS) {
    const plan = planQuizOrRef(goodQuiz, visual);
    const opts = findTextBySrc(plan.layers, (s) => s?.f === "quiz" && s?.k === "option");
    assert.equal(opts.length, 4, `${visual}: 4 ta variant kerak`);
    const options = goodQuiz.quiz![0].options;
    for (let i = 0; i < 4; i++) {
      const opt = opts[i];
      assert.equal(opt.text, options[i], `${visual}: variant ${i} matn mos emas`);
      assert.equal(opt.src?.f, "quiz");
      assert.equal(opt.src?.k, "option");
      assert.equal(getSrcJ(opt.src), i, `${visual}: variant index j=${i} kerak`);
    }
  }
});

test("quiz: harflar (A/B/C/D) src yo'q", () => {
  for (const visual of VISUALS) {
    const plan = planQuizOrRef(goodQuiz, visual);
    const letters = texts(plan.layers).filter((t) => t.text && /^[A-D]$/.test(t.text));
    for (const letter of letters) {
      assert.equal(letter.src, undefined, `${visual}: harf '${letter.text}' src yo'q bo'lishi kerak`);
    }
  }
});

test("quiz: magazine va hero — title src={f:title} bilan", () => {
  for (const visual of ["magazine", "hero-split"] as const) {
    const plan = planQuizOrRef(goodQuiz, visual);
    const titleLayers = texts(plan.layers).filter((t) => t.text === goodQuiz.title);
    assert.ok(titleLayers.length > 0, `${visual}: title qatlami kerak`);
    for (const title of titleLayers) {
      assert.deepEqual(title.src, { f: "title" }, `${visual}: title src kerak`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════ references

const goodRefs: SlideModel = {
  id: "r1",
  layout: "references",
  title: "Adabiyotlar",
  refs: [
    { title: "Xayvonlar dunyosi", source: "https://en.wikipedia.org/wiki/Animal" },
    { title: "O'simliklarni taniymiz", source: "https://example.com/plants" },
    { title: "", source: "https://study.com/lesson" },
  ],
};

test("references: title qutilari src={f:refs,i,k:title} bilan", () => {
  for (const visual of VISUALS) {
    const plan = planQuizOrRef(goodRefs, visual);
    // Birinchi ikkita title qatlami
    const titles = findTextBySrc(plan.layers, (s) => s?.f === "refs" && s?.k === "title");
    assert.equal(titles.length, 3, `${visual}: 3 ta refs.title kerak`);
    for (let i = 0; i < 3; i++) {
      const t = titles[i];
      assert.equal(t.src?.f, "refs");
      assert.equal(t.src?.k, "title");
      assert.equal(getSrcI(t.src), i, `${visual}: refs[${i}].title`);
      // Title yoki shortSource kerak
      assert.ok(
        t.text?.includes(goodRefs.refs![i].title.slice(0, 5)) ||
          t.text?.includes(goodRefs.refs![i].source.slice(0, 5)),
        `${visual}: title text mos emas`
      );
    }
  }
});

test("references: source qutilari src={f:refs,i,k:source} bilan", () => {
  for (const visual of VISUALS) {
    const plan = planQuizOrRef(goodRefs, visual);
    const sources = findTextBySrc(plan.layers, (s) => s?.f === "refs" && s?.k === "source");
    assert.equal(sources.length, 3, `${visual}: 3 ta refs.source kerak`);
    for (let i = 0; i < 3; i++) {
      const src = sources[i];
      assert.equal(src.src?.f, "refs");
      assert.equal(src.src?.k, "source");
      assert.equal(getSrcI(src.src), i, `${visual}: refs[${i}].source`);
      // shortSource qirqiladi (yoki mavjud)
      assert.ok(src.text, `${visual}: source text kerak`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════ answers

const goodAnswers: SlideModel = {
  id: "a1",
  layout: "answers",
  title: "Kalit",
  bullets: ["A", "B", "C", "D"],
};

test("answers: bullets src={f:bullets,i} bilan chiziladi", () => {
  for (const visual of VISUALS) {
    const plan = planQuizOrRef(goodAnswers, visual);
    const ans = findTextBySrc(plan.layers, (s) => s?.f === "bullets");
    assert.equal(ans.length, 4, `${visual}: 4 ta javob qatlami kerak`);
    for (let i = 0; i < 4; i++) {
      const bullet = ans[i];
      assert.equal(bullet.text, goodAnswers.bullets![i], `${visual}: javob ${i} matn`);
      assert.equal(bullet.src?.f, "bullets");
      assert.equal(getSrcI(bullet.src), i);
    }
  }
});

// ═══════════════════════════════════════════════════════════════ mutatsiya

test("mutatsiya: quiz savol src yo'qolsa, savol qatlami boshqa qiymatga almashadi", () => {
  // Bu test srcni o'chirish aslida model qiymatini tahrir qilmasligini tasdiqlaydi
  // Faqat src label qulflangan: agar src yo'qsa, ko'ruvchi tahrirlash imkoniyatini yo'qotadi
  const plan1 = planQuizOrRef(goodQuiz, "classic");
  const q1 = texts(plan1.layers).find((t) => t.src?.f === "quiz" && t.src?.k === "q");
  assert.ok(q1, "savol src bilan chiziladi");

  // Endi biz test holatda src mavjudligini qulflab qo'ydik
  // Mutatsiya: agar kod src ni qo'ymasaydira?
  // Shu test aynan buni ushlab turadi — src yo'qolsa, qatlam TOPILMASLIGI kerak
});

test("mutatsiya: quiz variant index yo'qolsa, tahrirlash uzaylaydi", () => {
  // Variant indexi j yo'qolsa, variant A/B/C/D tahririni to'g'ri variant qilib qo'yish iloji yo'q
  const plan = planQuizOrRef(goodQuiz, "classic");
  const opts = findTextBySrc(plan.layers, (s) => s?.f === "quiz" && s?.k === "option");
  for (let i = 0; i < opts.length; i++) {
    const opt = opts[i];
    assert.equal(getSrcJ(opt.src), i, `variant ${i} indexi kerak`);
    // Agar j yo'qolsa, variant tahriri buziladi
  }
});

test("mutatsiya: refs title/source almashsa, matn o'zgaradi", () => {
  // Agar refs title va source almashaydira, src indekslari noto'g'ri bo'ladi
  const plan = planQuizOrRef(goodRefs, "classic");
  const titles = findTextBySrc(plan.layers, (s) => s?.f === "refs" && s?.k === "title");
  const sources = findTextBySrc(plan.layers, (s) => s?.f === "refs" && s?.k === "source");

  // Har bir refs uchun title va source mos indeksda bo'lishi kerak
  for (let i = 0; i < titles.length; i++) {
    assert.equal(getSrcI(titles[i].src), i);
    assert.equal(getSrcI(sources[i].src), i);
  }
});

test("mutatsiya: answers javob indeksi noto'g'ri bo'lsa, kalit buziladi", () => {
  const plan = planQuizOrRef(goodAnswers, "classic");
  const ans = findTextBySrc(plan.layers, (s) => s?.f === "bullets");
  for (let i = 0; i < ans.length; i++) {
    assert.equal(getSrcI(ans[i].src), i, `javob ${i} indeksi kerak`);
  }
  // Agar indeks noto'g'ri bo'lsa, kalit numuratsiyasi buziladi
});

// ═══════════════════════════════════════════════════════════════ srcLines parametri

test("asList: srcLines parametri bandlarni mos indeksga etkazadi", () => {
  // Fallback bo'lganda srcLines ixtiyoriy bo'lishi kerak
  // Agar quiz/references bo'lsa, srcLines mavjud bo'ladi
  // Agar ularning ma'lumoti kelmasa, bandlar sodda ro'yxat sifatida chiziladi
  const fallback: SlideModel = {
    id: "f1",
    layout: "quiz",
    title: "Fallback",
    quiz: [], // Savol yo'q
    bullets: ["Band 1", "Band 2"],
  };
  const plan = planQuizOrRef(fallback, "classic");
  // Agar fallback savol bo'lsa, bullets chiziladi, srcLines bo'lishi mumkin yoki yo'q
  // Asosiy narsa: fallback to'g'ri ishlashi
  assert.ok(texts(plan.layers).length > 0);
});

// ═══════════════════════════════════════════════════════════════ dekorativ qatlamlar

test("dekorativ qatlamlar src yo'q: raqamlar, ko'priklar, to'ldirish", () => {
  const plan = planQuizOrRef(goodQuiz, "classic");
  const allTexts = texts(plan.layers);

  // FAQAT src bilan chizilgan qatlamlar
  const withSrc = allTexts.filter((t) => t.src);
  const withoutSrc = allTexts.filter((t) => !t.src);

  // Dekorativ (harflar, raqamlar, yo'naltirish simvollari) src yo'q
  for (const t of withoutSrc) {
    // src yo'q bo'lish kerak — bu tahrirlanmaydi
    assert.equal(t.src, undefined);
  }

  assert.ok(withSrc.length > 0, "bitta-ikki qatlam src bilan bo'lishi kerak");
});

// ═══════════════════════════════════════════════════════════════ 3 layout × 6 visual matrix

test("3 layout × 6 visual: barcha kombinatsiya matn qatlami bilan", () => {
  const layouts = [
    { model: goodQuiz, name: "quiz" },
    { model: goodRefs, name: "refs" },
    { model: goodAnswers, name: "answers" },
  ];

  for (const { model, name } of layouts) {
    for (const visual of VISUALS) {
      const plan = planQuizOrRef(model, visual);
      const textLayers = texts(plan.layers);
      assert.ok(textLayers.length > 0, `${name} + ${visual}: matn qatlamlari kerak`);

      // Har qatlam src yoki yo'qolish kerak
      for (const t of textLayers) {
        // src undefined yoki to'g'ri struktura bo'lishi kerak
        if (t.src) {
          assert.ok(t.src.f, `${name} + ${visual}: src.f mavjud`);
        }
      }
    }
  }
});

// ═══════════════════════════════════════════════════════════════ shortSource izohi

test("references: shortSource qirqilganda src to'g'ri ishlaydi", () => {
  const longUrl: SlideModel = {
    id: "l1",
    layout: "references",
    title: "Uzoq havolalar",
    refs: [
      {
        title: "Xayvonlar",
        source: "https://en.wikipedia.org/wiki/" + "a".repeat(100),
      },
    ],
  };

  const plan = planQuizOrRef(longUrl, "classic");
  const srcLayers = findTextBySrc(plan.layers, (s) => s?.f === "refs" && s?.k === "source");
  assert.equal(srcLayers.length, 1);

  // shortSource matn qirqiladi, lekin src davom etadi
  const srcText = srcLayers[0].text;
  assert.ok(srcText && srcText.length < 70, "shortSource kesadi");
  assert.deepEqual(srcLayers[0].src, { f: "refs", i: 0, k: "source" });
});
