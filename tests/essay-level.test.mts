import test from "node:test";
import assert from "node:assert/strict";
import {
  CEFR_LEVELS,
  CEFR_UI,
  DEFAULT_ESSAY_LEVEL,
  DEFAULT_IELTS_LEVEL,
  defaultEssayLevel,
  LEVEL_BANDS,
  LEVEL_CONNECTORS,
  LEGACY_CLAIM_MIN,
  LEGACY_THESIS_WORDS,
  claimMinWords,
  essayLevelOf,
  levelCaption,
  levelDetail,
  levelGuidance,
  levelPromptBlock,
  levelReminder,
  levelRepairInstruction,
  levelTargets,
  levelVerdict,
  measureLevel,
  parseCefrLevel,
  splitSentences,
  thesisWordRange,
  wordTokens,
  type CefrLevel,
} from "../lib/generation/essay/level.ts";
import { ESSAY_CONTEXTS } from "../lib/generation/essay/registry.ts";
import type { EssayLang } from "../lib/generation/essay/registry.ts";

/**
 * ESSAY CEFR LEVEL — core module (mobile sprint, package G, R4 WP-1).
 *
 * Mutations checked (each turned a test red, then restored):
 *   1) A1 band widened to 4–20 (en)          → «A1 fixture is green at A1 and red at C2…» red;
 *   2) uz table replaced by the en numbers    → «uz is scaled below en» red;
 *   3) splitter splits after «G‘.» initials   → «splitter table» red;
 *   4) the OVERRIDES sentence removed         → «prompt block» red;
 *   5) claimMinWords returns legacy 8/5 always → «level-scaled minimums» red.
 */

const LANGS: EssayLang[] = ["uz", "ru", "en"];

/* ────────────────────────── values ────────────────────────── */

test("values: six levels, case-insensitive parse, default B2 (IELTS: C1)", () => {
  assert.deepEqual([...CEFR_LEVELS], ["A1", "A2", "B1", "B2", "C1", "C2"]);
  assert.equal(DEFAULT_ESSAY_LEVEL, "B2", "owner decision O3");
  assert.equal(parseCefrLevel("b1"), "B1");
  assert.equal(parseCefrLevel(" C2 "), "C2");
  assert.equal(parseCefrLevel("X9"), null);
  assert.equal(parseCefrLevel(5), null);
  assert.equal(parseCefrLevel(undefined), null);
  assert.equal(essayLevelOf("school_dtm", undefined), "B2");
  assert.equal(essayLevelOf("academic", "junk"), "B2");
  assert.equal(essayLevelOf("academic", "a2"), "A2");
  // IELTS has the control too (owner, 2026-10-07): the chosen level counts, the default is C1.
  assert.equal(essayLevelOf("ielts_task2", "A1"), "A1");
  assert.equal(essayLevelOf("ielts_task2", undefined), "C1");
  assert.equal(essayLevelOf("ielts_task2", "junk"), "C1");
  assert.equal(DEFAULT_IELTS_LEVEL, "C1");
  assert.equal(defaultEssayLevel("ielts_task2"), "C1");
  assert.equal(defaultEssayLevel("school_dtm"), "B2");
});

/* ────────────────────────── thresholds ────────────────────────── */

test("thresholds: per language, targets inside the band, strictly increasing with ≥ 20 % gaps, caps above the band", () => {
  for (const lang of LANGS) {
    let prev: number | null = null;
    for (const l of CEFR_LEVELS) {
      const b = LEVEL_BANDS[lang][l];
      assert.ok(b.lo < b.hi, `${lang} ${l}: lo < hi`);
      assert.ok(b.target >= b.lo && b.target <= b.hi, `${lang} ${l}: target ${b.target} inside ${b.lo}–${b.hi}`);
      assert.ok(b.cap > b.hi, `${lang} ${l}: cap above the band`);
      if (prev !== null) assert.ok(b.target >= prev * 1.2, `${lang} ${l}: target ${b.target} must be ≥ 20 % above ${prev}`);
      prev = b.target;
    }
  }
});

test("uz is scaled below en (agglutination), ru between — per level", () => {
  for (const l of CEFR_LEVELS) {
    const [uz, ru, en] = [LEVEL_BANDS.uz[l], LEVEL_BANDS.ru[l], LEVEL_BANDS.en[l]];
    assert.ok(uz.hi < en.hi && uz.target < en.target && uz.cap < en.cap, `${l}: uz must be below en`);
    assert.ok(ru.hi <= en.hi && ru.target <= en.target && uz.target <= ru.target, `${l}: ru between uz and en`);
  }
});

/* ────────────────────────── splitter / tokens ────────────────────────── */

test("splitter table: initials, decimals, quotes, ellipsis, dialogue dash, abbreviations, empty", () => {
  const cases: [string, number][] = [
    ["", 0],
    ["Men maktabda o‘qiyman. Maktabim katta.", 2],
    ["G‘. G‘ulom va O‘. Hoshimov — mashhur yozuvchilar. Ular ko‘p yozgan.", 2],
    ["A. Qodiriy «O‘tkan kunlar»ni yozgan. Roman mashhur.", 2],
    ["Sh. Rashidov haqida yozdim. Bu qiziq edi.", 2],
    ["Narx 3.5 baravar oshdi. Bu ko‘p.", 2],
    ["U dedi: «Men keldim.» Keyin ketdi.", 2],
    ["Kutdim… Hech kim kelmadi.", 2],
    ["Kutdim… va yana kutdim.", 1],
    ["— Qayerga borasan? — dedi u. — Uyga.", 3],
    ["Mr. Smith arrived. He was late!", 2],
    ["Is it true? Yes. It is.", 3],
    ["Birinchi band.\nIkkinchi band", 2],
    ["Это было в 2020 г. в Ташкенте. Потом мы уехали.", 2],
  ];
  for (const [text, n] of cases) assert.equal(splitSentences(text).length, n, `«${text}» → ${JSON.stringify(splitSentences(text))}`);
});

test("word tokens: Uzbek apostrophe words are ONE word, dashes are not words", () => {
  assert.deepEqual(wordTokens("Men o‘qiyman — g‘urur ham bor."), ["Men", "o‘qiyman", "g‘urur", "ham", "bor"]);
  assert.equal(wordTokens("O'zbekiston bo`ylab sayohat").length, 3);
  assert.equal(wordTokens("3,5 foiz").length, 2);
});

/* ────────────────────────── measure + verdict ────────────────────────── */

const FIXTURES: Record<EssayLang, Partial<Record<CefrLevel, string>>> = {
  en: {
    A1: "I like my school. It is big and clean. My teacher is kind. We read books every day. I play with my friends after class. Books help me learn new words. I am happy at school.",
    B1: "Many students use their phones to read the news every morning. However, they do not always check whether the story is true. A short lesson on online sources would help them a lot. For example, they could learn to compare two websites before sharing a post.",
    C1: "Digital literacy, once regarded as a peripheral technical competence, has become a precondition of informed citizenship in societies where public deliberation increasingly unfolds on algorithmically curated platforms. Universities that continue to treat the critical evaluation of online sources as an optional extra therefore risk producing graduates who are formally educated yet epistemically defenceless. Nevertheless, integrating such training into discipline-specific curricula, rather than isolating it in generic workshops, demands institutional commitment that few faculties have so far demonstrated.",
  },
  uz: {
    A1: "Men kitob o‘qiyman. Kitob menga yoqadi. Har kuni o‘qiyman. Kitobda ko‘p so‘z bor. Men yangi so‘z o‘rganaman. Onam ham o‘qiydi. Biz birga o‘qiymiz.",
    C1: "Ona tili millatning tarixiy xotirasi, ma’naviy merosi va o‘zligini anglash vositasi sifatida jamiyat taraqqiyotida beqiyos ahamiyat kasb etadi. Globallashuv sharoitida axborot oqimining keskin ortishi tilning sofligini saqlash masalasini har qachongidan ham dolzarb qilib qo‘ymoqda. Shu bois bu vazifa nafaqat tilshunoslarning, balki har bir ziyolining zimmasiga tushadi. Binobarin, tilni asrash uni muzeydagi eksponat kabi qotirib qo‘yish emas, balki zamonaviy atamalar bilan ijodiy boyitib borishni ham taqozo etadi.",
  },
  ru: {
    A1: "Я очень люблю читать книги. Книги учат меня новым словам. Я читаю каждый день вечером. Моя мама тоже любит читать. Мы часто читаем вместе дома. Это очень хорошее время.",
    C1: "Цифровая грамотность, ещё недавно считавшаяся узкотехническим навыком, превратилась в необходимое условие полноценного участия гражданина в общественной жизни, которая всё чаще разворачивается на алгоритмически управляемых платформах. Университеты, продолжающие рассматривать критическую оценку онлайн-источников как факультативное дополнение, рискуют выпускать формально образованных, но интеллектуально беззащитных специалистов. Тем не менее интеграция такой подготовки в профильные дисциплины требует институциональной воли, которую пока проявили лишь немногие факультеты.",
  },
};

test("measure: mean/max/lengths/commas; long-word share only for en/ru, not for uz", () => {
  const en = measureLevel(FIXTURES.en.A1!, "en");
  assert.equal(en.sentences, 7);
  assert.equal(en.lengths.length, 7);
  assert.ok(en.mean > 3.5 && en.mean < 6, `en A1 mean ${en.mean}`);
  assert.ok(en.longWordShare !== null && en.longWordShare < 0.1);
  const uz = measureLevel(FIXTURES.uz.C1!, "uz");
  assert.equal(uz.longWordShare, null, "word length means nothing in Uzbek");
  assert.ok(uz.commasPerSentence >= 1);
  const c1 = measureLevel(FIXTURES.en.C1!, "en");
  assert.ok(c1.longWordShare! > en.longWordShare!, "C1 uses more long words");
});

test("A1 fixture is green at A1 and red at C2; C1 fixture is green at C1 and red at A1 (uz/ru/en)", () => {
  for (const lang of LANGS) {
    const a1 = measureLevel(FIXTURES[lang].A1!, lang);
    const c1 = measureLevel(FIXTURES[lang].C1!, lang);
    assert.equal(levelVerdict(a1, "A1", lang).level, "green", `${lang} A1@A1 mean ${a1.mean}`);
    const a1AtC2 = levelVerdict(a1, "C2", lang);
    assert.equal(a1AtC2.level, "red", `${lang} A1@C2`);
    assert.equal(a1AtC2.direction, "low", "too simple for C2");
    assert.equal(levelVerdict(c1, "C1", lang).level, "green", `${lang} C1@C1 mean ${c1.mean}`);
    const c1AtA1 = levelVerdict(c1, "A1", lang);
    assert.equal(c1AtA1.level, "red", `${lang} C1@A1`);
    assert.equal(c1AtA1.direction, "high", "too complex for A1");
  }
  const b1 = measureLevel(FIXTURES.en.B1!, "en");
  assert.equal(levelVerdict(b1, "B1", "en").level, "green", `en B1@B1 mean ${b1.mean}`);
  // A B1 text is NOT an A1 text (a too-wide A1 band would wave it through).
  const b1AtA1 = levelVerdict(b1, "A1", "en");
  assert.notEqual(b1AtA1.level, "green", `en B1@A1 mean ${b1.mean}`);
  assert.equal(b1AtA1.direction, "high");
});

test("verdict boundaries: mean just outside the band → yellow, > 25 % outside → red; over-cap share counts", () => {
  const synthetic = (lengths: number[]) => ({ sentences: lengths.length, words: lengths.reduce((a, b) => a + b, 0), mean: lengths.reduce((a, b) => a + b, 0) / lengths.length, max: Math.max(...lengths), lengths, commasPerSentence: 0, longWordShare: null });
  const b = levelTargets("B1", "en"); // 11–16, cap 24
  assert.equal(levelVerdict(synthetic(Array(10).fill(13)), "B1", "en").level, "green");
  assert.equal(levelVerdict(synthetic(Array(10).fill(b.hi + 2)), "B1", "en").level, "yellow", "18 is 12.5 % above 16");
  assert.equal(levelVerdict(synthetic(Array(10).fill(b.hi * 1.3)), "B1", "en").level, "red", "30 % above");
  assert.equal(levelVerdict(synthetic(Array(10).fill(b.lo - 2)), "B1", "en").direction, "low");
  // In-band mean but 30 % of sentences over the cap → red, direction high.
  const bimodal = [...Array(7).fill(6), ...Array(3).fill(30)];
  const v = levelVerdict(synthetic(bimodal), "B1", "en");
  assert.ok(v.overCapShare >= 0.3);
  assert.equal(v.direction, "high");
  assert.notEqual(v.level, "green");
  // Too short to judge.
  assert.equal(levelVerdict(synthetic([40, 40]), "A1", "en").unmeasured, true);
  // Review G-2: A1/A2 have no "too simple" — a 3.7-word beginner text is on level; B1 still flags it.
  const beginner = measureLevel("I like my school. It is big. My teacher is kind. We read books. I play with friends. I am happy.", "en");
  assert.ok(beginner.mean < 4, `mean ${beginner.mean}`);
  for (const l of ["A1", "A2"] as const) {
    const v1 = levelVerdict(beginner, l, "en");
    assert.equal(v1.level, "green", `${l}`);
    assert.equal(v1.direction, null);
  }
  assert.equal(levelVerdict(beginner, "B1", "en").direction, "low");
  // Review G-5: short mean but over-cap sentences → "high" (combining sentences would worsen them).
  const mixed = levelVerdict(synthetic([...Array(8).fill(3), 30, 30]), "B1", "en");
  assert.equal(mixed.direction, "high");
});

test("report detail: Uzbek numbers with comma decimal, band, direction", () => {
  const m = measureLevel(FIXTURES.en.C1!, "en");
  const v = levelVerdict(m, "A1", "en");
  const d = levelDetail(m, v, "A1");
  assert.match(d, /^A1: o‘rtacha gap \d+,\d so‘z \(kerak 4–8\)/);
  assert.match(d, /eng uzun \d+/);
  assert.match(d, /uzun so‘zlar \d+ %/);
  assert.match(d, /darajadan murakkab$/);
  assert.ok(!/uzun so‘zlar/.test(levelDetail(measureLevel(FIXTURES.uz.A1!, "uz"), levelVerdict(measureLevel(FIXTURES.uz.A1!, "uz"), "A1", "uz"), "A1")), "no long-word share for uz");
});

/* ────────────────────────── prompt ────────────────────────── */

test("prompt block: per-language numbers and connectors, OVERRIDES sentence, structure stays", () => {
  for (const lang of LANGS) {
    for (const l of CEFR_LEVELS) {
      const block = levelPromptBlock(l, lang);
      const b = levelTargets(l, lang);
      assert.match(block, new RegExp(`CEFR ${l}`));
      assert.ok(block.includes(`average about ${b.target} words per sentence`), `${lang} ${l}: target`);
      assert.ok(block.includes(`${b.lo}–${b.hi}`) && block.includes(`${b.cap} words`), `${lang} ${l}: band and cap`);
      for (const w of LEVEL_CONNECTORS[l][lang]) assert.ok(block.includes(`«${w}»`), `${lang} ${l}: connector ${w}`);
      assert.match(block, /The level OVERRIDES any request in this prompt for richer vocabulary, figurative language, hedging/);
      assert.match(block, /overrides the author's additional requirements/);
      assert.match(block, /STRUCTURE rules above .* stay/);
    }
  }
  assert.match(levelPromptBlock("A1", "uz"), /use only «va», «lekin», «chunki», «keyin»/);
  assert.notEqual(levelPromptBlock("A2", "uz"), levelPromptBlock("A2", "ru"), "language-specific");
  assert.match(levelReminder("B1", "ru"), /CEFR B1 .* about 12 words per sentence, never over 22/);
  assert.match(levelRepairInstruction("A1", "en", "high"), /split long sentences/);
  assert.match(levelRepairInstruction("C2", "en", "low"), /combine choppy sentences/);
});

test("kind guidance: figurative and hedging lines are replaced at low levels, kept from B2; null keeps all", () => {
  const descriptive = ESSAY_CONTEXTS.school_dtm.kinds.descriptive!.guidance;
  const argumentative = ESSAY_CONTEXTS.academic.kinds.argumentative!.guidance;
  const fig = descriptive.find((g) => /figurative/i.test(g))!;
  const hedge = argumentative.find((g) => /hedg/i.test(g))!;
  assert.ok(fig && hedge, "registry still carries the lines that fight low levels");

  assert.deepEqual(levelGuidance(descriptive, null), [...descriptive]);
  assert.deepEqual(levelGuidance(descriptive, "B2"), [...descriptive]);
  const a1 = levelGuidance(descriptive, "A1");
  assert.equal(a1.length, descriptive.length, "structure lines stay — same count");
  assert.ok(!a1.includes(fig) && a1.some((g) => /No figurative language/.test(g)));
  assert.ok(levelGuidance(descriptive, "A2").some((g) => /At most ONE simple comparison/.test(g)));
  assert.ok(levelGuidance(descriptive, "B1").some((g) => /Light figurative language/.test(g)));
  assert.ok(!levelGuidance(argumentative, "A1").includes(hedge));
  assert.ok(levelGuidance(argumentative, "A1").some((g) => /no hedging/.test(g)));
  assert.ok(levelGuidance(argumentative, "B1").some((g) => /«may», «often», «usually»/.test(g)));
  assert.ok(levelGuidance(argumentative, "C1").includes(hedge));
  // Non-IELTS contexts: at A1 no figurative/hedging WISH survives in any kind.
  for (const ctx of [ESSAY_CONTEXTS.school_dtm, ESSAY_CONTEXTS.academic]) {
    for (const k of Object.values(ctx.kinds)) {
      for (const g of levelGuidance(k!.guidance, "A1")) {
        assert.ok(!/at least once per paragraph|claims are hedged/.test(g), `${ctx.id}/${k!.id}: «${g}»`);
      }
    }
  }
});

test("level-scaled minimums: thesis range ≤ cap and monotone; claim minimums lower at A1, legacy 8/5 and 12–35 without a level", () => {
  assert.deepEqual(thesisWordRange(null, "uz"), LEGACY_THESIS_WORDS);
  assert.deepEqual(claimMinWords(null, "en"), { ...LEGACY_CLAIM_MIN });
  for (const lang of LANGS) {
    let prevHi = 0;
    let prevThesis = 0;
    for (const l of CEFR_LEVELS) {
      const [lo, hi] = thesisWordRange(l, lang);
      assert.ok(lo < hi && hi <= levelTargets(l, lang).cap, `${lang} ${l}: thesis ${lo}–${hi}`);
      assert.ok(hi >= prevHi, `${lang} ${l}: monotone`);
      prevHi = hi;
      const m = claimMinWords(l, lang);
      assert.ok(m.thesis >= prevThesis && m.thesis <= 8 && m.topic <= 5);
      prevThesis = m.thesis;
    }
  }
  assert.ok(claimMinWords("A1", "uz").thesis <= 4, "a 4-word Uzbek A1 thesis is a claim");
  assert.ok(claimMinWords("A1", "en").topic <= 4);
  assert.deepEqual(claimMinWords("C1", "en"), { thesis: 8, topic: 5 }, "high levels keep the old minimums");
});

/* ────────────────────────── UI table ────────────────────────── */

test("UI table: six Uzbek rows in level order; caption quotes the prompt's own target for the language", () => {
  assert.deepEqual(CEFR_UI.map((u) => u.id), [...CEFR_LEVELS]);
  for (const u of CEFR_UI) assert.ok(u.name && u.phrase);
  assert.equal(levelCaption("A1", "uz"), `Boshlang‘ich: juda sodda gaplar, atamasiz, gap ~${LEVEL_BANDS.uz.A1.target} so‘z`);
  assert.match(levelCaption("C1", "en"), new RegExp(`~${LEVEL_BANDS.en.C1.target} so‘z$`));
  for (const l of CEFR_LEVELS) for (const lang of LANGS) assert.ok(levelCaption(l, lang).length <= 56, `${l}/${lang}: caption fits one line at 360 px (measured in the Chromium smoke)`);
});
