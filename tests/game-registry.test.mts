import test from "node:test";
import assert from "node:assert/strict";
import {
  CARDS_JUDGE_CRITERIA,
  CROSSWORD_JUDGE_CRITERIA,
  GAME_RULE_IDS,
  GAME_TYPES,
  gameDefaultTypeId,
  gameKindOf,
  gameTypeOf,
  gameTypesOf,
  normalizeGameType,
} from "../lib/generation/games/registry.ts";
import {
  CARDS_PER_SHEET,
  GAME_KINDS,
  GAME_LIMITS,
  GAME_TOOL_BY_KIND,
  GAME_TOOL_IDS,
  GAME_TOOL_LIST,
  isGameKind,
  isGameToolId,
  normalizeGameCount,
  normalizeGridSize,
} from "../lib/generation/games/types.ts";
import { GAME_PARAMS, gameParamsOf } from "../lib/generation/game-params.ts";

/**
 * O'YINLAR REYESTRI (AUDIT-21 R0) — krossvord + flesh kartalar.
 *
 * Reyestr dvigatelning SPETSIFIKATSIYASI: prompt («TYPE RULES» =
 * `guidance`), skelet, hisobot qoidalari va forma undan o'qiydi, shuning
 * uchun `docs/research/{crossword,flashcards}.md` §3/§4 dan olingan
 * raqamlar shu yerda QULFLANADI.
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `GAME_LIMITS.wordLettersMin` 3 → 2 — «so'z 3–15 harf» testi;
 *   2. `tarifli` turining `clueChars` pastki chegarasi 40 → 10 (klassik
 *      bilan bir xil) — «ta'rifli tur sinonimdan uzunroq savol talab
 *      qiladi» testi;
 *   3. `normalizeGridSize` dagi toqlik shoxi olib tashlandi — «to'r
 *      o'lchami TOQ» testi;
 *   4. `GAME_RULE_IDS.crossword` dan `gridMatchesWords` o'chirildi —
 *      «qoidalar ro'yxati to'liq» testi;
 *   5. `GAME_PARAMS` dagi `includeExample` ga `probeB: false` (probeA
 *      bilan bir xil) — «zond ikki XIL qiymatni solishtiradi» testi.
 */

test("2 kind, har biri o'z vositasiga bog'langan; xarita ikki tomonlama", () => {
  assert.deepEqual([...GAME_KINDS], ["crossword", "flashcards"]);
  assert.deepEqual(GAME_TOOL_LIST, ["crossword", "flashcards"]);
  for (const toolId of GAME_TOOL_LIST) {
    const kind = GAME_TOOL_IDS[toolId];
    assert.equal(gameKindOf(toolId), kind, `${toolId}: kind topilmadi`);
    // Teskari yo'nalish AYNI vositaga qaytsin (ikki jadval ajralib ketmasin).
    assert.equal(GAME_TOOL_BY_KIND[kind], toolId, `${kind}: teskari xarita boshqa vositaga ketdi`);
    assert.ok(isGameToolId(toolId));
    assert.ok(isGameKind(kind));
  }
  // O'yin vositasi bo'lmagan id — `null` (dispatch adashmasin).
  assert.equal(gameKindOf("coursework"), null);
  assert.equal(gameKindOf("test"), null);
  assert.equal(gameKindOf(""), null);
  assert.ok(!isGameKind("sorting"), "3-dastur turi hozirdan kind bo'lib qolmasin");
});

test("turlar hisobotlardan; standart — birinchi element; noma'lum tur standartga tushadi", () => {
  assert.deepEqual(gameTypesOf("crossword").map((t) => t.id), ["klassik", "tarifli"]);
  assert.deepEqual(gameTypesOf("flashcards").map((t) => t.id), ["term-def", "qa"]);
  assert.equal(gameDefaultTypeId("crossword"), "klassik");
  assert.equal(gameDefaultTypeId("flashcards"), "term-def");
  assert.equal(normalizeGameType("crossword", "yo'q-bunday"), "klassik");
  assert.equal(normalizeGameType("crossword", "qa"), "klassik", "MUTATSIYA: karta turi krossvordga o'tib ketdi");
  assert.equal(normalizeGameType("flashcards", null), "term-def");
  assert.equal(gameTypeOf("flashcards", "qa").id, "qa");
  // Karta turi model qiymati bilan AYNI — ikkalasi ajralib ketmasin.
  for (const t of gameTypesOf("flashcards")) assert.equal(t.cardType, t.id, `${t.id}: cardType reyestr id sidan farq qiladi`);
  // Har turning kindi o'z ro'yxatiga mos.
  for (const kind of GAME_KINDS) for (const t of GAME_TYPES[kind]) assert.equal(t.kind, kind, `${t.id}: begona kind`);
});

test("chegaralar hisobot §3/§4 dan: so'z 3–15 harf, savol 10–150 belgi, to'r 13–21", () => {
  assert.equal(GAME_LIMITS.wordLettersMin, 3);
  assert.equal(GAME_LIMITS.wordLettersMax, 15);
  assert.equal(GAME_LIMITS.clueCharsMin, 10);
  assert.equal(GAME_LIMITS.clueCharsMax, 150);
  assert.equal(GAME_LIMITS.gridMin, 13);
  assert.equal(GAME_LIMITS.gridMax, 21);
  assert.ok(GAME_LIMITS.gridMin % 2 === 1 && GAME_LIMITS.gridMax % 2 === 1, "to'r chegaralari TOQ bo'lishi kerak");
  assert.equal(GAME_LIMITS.minCrossingsPerWord, 1);
  assert.equal(GAME_LIMITS.crossingRatio, 0.5);
  // Element soni chiplari — ikkala vositada bir xil (hisobot §3).
  assert.deepEqual([...GAME_LIMITS.counts], [5, 10, 15, 20]);
  assert.equal(GAME_LIMITS.countDefault, 10);
  assert.equal(GAME_LIMITS.countMin, 5);
  assert.equal(GAME_LIMITS.countMax, 20);
});

test("flesh karta chegaralari: old 5–50, orqa 20–200 belgi; A7 74×105 mm, A4 da 2×4 = 8", () => {
  assert.equal(GAME_LIMITS.cardFrontCharsMin, 5);
  assert.equal(GAME_LIMITS.cardFrontCharsMax, 50);
  assert.equal(GAME_LIMITS.cardBackCharsMin, 20);
  assert.equal(GAME_LIMITS.cardBackCharsMax, 200);
  // ISO A7 (hisobot §1) — A4 ning 1/8 qismi.
  assert.equal(GAME_LIMITS.cardWidthMm, 74);
  assert.equal(GAME_LIMITS.cardHeightMm, 105);
  assert.equal(CARDS_PER_SHEET, 8, "A4 betga 8 ta karta sig'adi (2 × 4)");
  assert.ok(GAME_LIMITS.cardWidthMm * GAME_LIMITS.cardCols <= 210, "ikki ustun A4 kengligiga sig'maydi");
  assert.ok(GAME_LIMITS.cardHeightMm * GAME_LIMITS.cardRows <= 420, "to'rt qator A4 balandligidan oshdi");
  assert.equal(GAME_LIMITS.exampleCoverage, 0.5, "misol qamrovi hisobot §4 dagi ≥50% bo'lsin");
});

test("tur chegaralari umumiy chegaralar ICHIDA; ta'rifli krossvord uzunroq savol talab qiladi", () => {
  for (const t of gameTypesOf("crossword")) {
    const [lo, hi] = t.limits.letters;
    assert.equal(lo, GAME_LIMITS.wordLettersMin, `${t.id}: harf pastki chegarasi`);
    assert.equal(hi, GAME_LIMITS.wordLettersMax, `${t.id}: harf yuqori chegarasi`);
    const [cLo, cHi] = t.limits.clueChars;
    assert.ok(cLo >= GAME_LIMITS.clueCharsMin && cHi <= GAME_LIMITS.clueCharsMax, `${t.id}: savol chegarasi umumiydan chiqdi`);
    assert.ok(cLo < cHi, `${t.id}: savol chegarasi teskari`);
    assert.ok(t.limits.answerSeparate, `${t.id}: javob varag'i yangi betdan bo'lishi kerak (hisobot §3)`);
    assert.ok(t.limits.words.includes(t.limits.wordsDefault), `${t.id}: standart so'z soni chiplar ichida emas`);
  }
  // Ta'rif sinonimdan UZUN: pastki chegara klassikdan yuqori bo'lishi shart.
  const klassik = gameTypeOf("crossword", "klassik");
  const tarifli = gameTypeOf("crossword", "tarifli");
  assert.ok(tarifli.limits.clueChars[0] > klassik.limits.clueChars[0], "MUTATSIYA: ta'rifli tur klassik bilan bir xil savol uzunligini qabul qiladi");
  for (const t of gameTypesOf("flashcards")) {
    assert.deepEqual([...t.limits.frontChars], [GAME_LIMITS.cardFrontCharsMin, GAME_LIMITS.cardFrontCharsMax], `${t.id}: old yuz chegarasi`);
    assert.deepEqual([...t.limits.backChars], [GAME_LIMITS.cardBackCharsMin, GAME_LIMITS.cardBackCharsMax], `${t.id}: orqa yuz chegarasi`);
    assert.ok(t.limits.cards.includes(t.limits.cardsDefault), `${t.id}: standart karta soni chiplar ichida emas`);
  }
});

test("guidance — ingliz tilida, skelet esa o'zbekcha va javob/orqa yuz bilan tugaydi", () => {
  for (const kind of GAME_KINDS) {
    for (const t of GAME_TYPES[kind]) {
      assert.ok(t.guidance.length >= 3, `${t.id}: kamida 3 qoida kerak`);
      for (const g of t.guidance) {
        assert.ok(g.length > 40, `${t.id}: «${g}» juda qisqa`);
        // Prompt ingliz tilida yoziladi (barcha dvigatellarda bir xil qoida).
        assert.ok(!/[ʻʼōʼ]|o'q|so'z|kerak/i.test(g), `${t.id}: guidance o'zbekcha yozilgan — «${g}»`);
      }
      assert.ok(t.skeleton.length >= 4, `${t.id}: skelet juda qisqa`);
      assert.ok(t.hint.length > 10, `${t.id}: forma izohi yo'q`);
      for (const lang of ["uz", "ru", "en"] as const) assert.ok(t.label[lang].length > 0, `${t.id}: ${lang} yorlig'i yo'q`);
    }
  }
  // Krossvordda javob varag'i OXIRGI bo'lim (hisobot §3: yangi betdan).
  for (const t of gameTypesOf("crossword")) assert.match(t.skeleton[t.skeleton.length - 1], /Javob/i, `${t.id}: javob varag'i skeletning oxirida emas`);
  // Kartalarda orqa yuzlar varag'i OXIRGI (duplex tartibi).
  for (const t of gameTypesOf("flashcards")) assert.match(t.skeleton[t.skeleton.length - 1], /Orqa/i, `${t.id}: orqa yuzlar varag'i oxirida emas`);
});

/** Generik `JudgeSpec<C>` ni mezon nomini bilmasdan tekshirish uchun. */
type AnyJudge = { criteria: readonly string[]; describe: Record<string, string>; labels: Record<string, string>; roleLine?: string; typeLabel?: string; typeNoun?: string };

test("baholovchi: hisobotlar §4 dagi beshta mezon, har biri izohlangan", () => {
  assert.deepEqual([...CROSSWORD_JUDGE_CRITERIA], ["clueClarity", "wordGrade", "gridConnectedness", "answerAccuracy", "originality"]);
  assert.deepEqual([...CARDS_JUDGE_CRITERIA], ["termClarity", "definitionCompleteness", "languageLevel", "exampleRelevance", "memorability"]);
  for (const kind of GAME_KINDS) {
    for (const t of GAME_TYPES[kind]) {
      const j = t.judge as unknown as AnyJudge;
      assert.ok(j.criteria.length >= 3 && j.criteria.length <= 6, `${t.id}: mezonlar soni 3–6 bo'lishi kerak`);
      for (const c of j.criteria) {
        assert.ok(j.describe[c] && j.describe[c].length > 30, `${t.id}/${c}: izoh yo'q`);
        assert.ok(j.labels[c] && j.labels[c].length > 0, `${t.id}/${c}: o'zbekcha yorliq yo'q`);
      }
      assert.ok(j.roleLine && j.roleLine.length > 20, `${t.id}: baholovchi roli yo'q`);
      assert.ok(j.typeLabel && j.typeNoun, `${t.id}: tur nomi qavsda ko'rsatilmaydi`);
    }
  }
  // Tur bo'yicha o'ziga xoslik: `tarifli` va `qa` o'z izohini bekor qiladi.
  assert.notEqual(gameTypeOf("crossword", "tarifli").judge.describe.clueClarity, gameTypeOf("crossword", "klassik").judge.describe.clueClarity);
  assert.notEqual(gameTypeOf("flashcards", "qa").judge.describe.termClarity, gameTypeOf("flashcards", "term-def").judge.describe.termClarity);
});

test("hisobot qoidalari: har kind qamralgan, id lar unikal, hisobotdagi bandlar bor", () => {
  assert.deepEqual(Object.keys(GAME_RULE_IDS).sort(), [...GAME_KINDS].sort());
  for (const kind of GAME_KINDS) {
    const ids = GAME_RULE_IDS[kind];
    assert.equal(new Set(ids).size, ids.length, `${kind}: qoida id lari takrorlandi`);
    assert.ok(ids.length >= 6, `${kind}: qoidalar juda kam`);
  }
  // `crossword.md` §4 jadvalidagi yettita band + WP-A qo'shgan `gridMatchesWords`.
  for (const id of ["wordCount", "gridSize", "minCrossings", "wordLength", "clueLength", "uniqueWords", "answerSheet", "gridMatchesWords"]) {
    assert.ok(GAME_RULE_IDS.crossword.includes(id), `MUTATSIYA: krossvord qoidasi «${id}» yo'qoldi`);
  }
  // `flashcards.md` §4 jadvalidagi oltita band.
  for (const id of ["cardCount", "frontLength", "backLength", "noDuplicate", "examplePresence", "cardTypeMatch"]) {
    assert.ok(GAME_RULE_IDS.flashcards.includes(id), `MUTATSIYA: karta qoidasi «${id}» yo'qoldi`);
  }
});

test("normalizeGameCount chiplardan tashqariga chiqmaydi; to'r o'lchami TOQ va 13–21", () => {
  for (const n of GAME_LIMITS.counts) assert.equal(normalizeGameCount(n), n);
  for (const bad of [0, 7, 21, -5, "ko'p", null, undefined, Number.NaN]) {
    assert.equal(normalizeGameCount(bad), GAME_LIMITS.countDefault, `${String(bad)}: standartga tushmadi`);
  }
  // To'r: juft son yuqoriga yaxlitlanadi, chegaradan tashqarisi kesiladi.
  assert.equal(normalizeGridSize(15), 15);
  assert.equal(normalizeGridSize(16), 17, "MUTATSIYA: juft to'r o'lchami qabul qilindi");
  assert.equal(normalizeGridSize(9), GAME_LIMITS.gridMin);
  assert.equal(normalizeGridSize(40), GAME_LIMITS.gridMax);
  assert.equal(normalizeGridSize(Number.NaN), GAME_LIMITS.gridMax);
  for (const v of [9, 12, 13, 14, 20, 21, 30]) {
    const s = normalizeGridSize(v);
    assert.ok(s % 2 === 1, `${v} → ${s}: juft`);
    assert.ok(s >= GAME_LIMITS.gridMin && s <= GAME_LIMITS.gridMax, `${v} → ${s}: chegaradan chiqdi`);
  }
});

test("zond reyestri: id unikal, har parametrning egasi, ta'siri va IKKI XIL qiymati bor", () => {
  const ids = GAME_PARAMS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "parametr id lari takrorlandi");
  for (const p of GAME_PARAMS) {
    assert.ok(p.kinds.length > 0, `${p.id}: hech bir vositada ko'rinmaydi`);
    for (const k of p.kinds) assert.ok((GAME_KINDS as readonly string[]).includes(k), `${p.id}: noma'lum kind «${k}»`);
    assert.ok(p.impacts.length > 0, `${p.id}: hech narsaga ta'sir qilmaydi — «bezak maydon»`);
    assert.notDeepEqual(p.probeA, p.probeB, `MUTATSIYA: ${p.id} zondi bir xil ikki qiymatni solishtiradi`);
  }
  // Har vositada kamida mavzu, til, tur va son bo'lsin.
  for (const kind of GAME_KINDS) {
    const own = gameParamsOf(kind).map((p) => p.id);
    for (const need of ["topic", "language", "extra"]) assert.ok(own.includes(need), `${kind}: «${need}» maydoni yo'q`);
    assert.ok(own.some((id) => /Type$/.test(id)), `${kind}: tur tanlovi yo'q`);
    assert.ok(own.some((id) => /Count$/.test(id)), `${kind}: element soni yo'q`);
  }
  // Fayl rejimi FAQAT krossvordda (hisobot §2) — kartalar mavzudan tuziladi.
  assert.deepEqual(gameParamsOf("crossword").filter((p) => p.id === "mode").length, 1);
  assert.equal(gameParamsOf("flashcards").filter((p) => p.id === "mode").length, 0);
  // Narx tekis: hech bir parametr narxga ta'sir qilmaydi (egasi qarori 6).
  for (const p of GAME_PARAMS) assert.ok(!(p.impacts as readonly string[]).includes("price"), `MUTATSIYA: ${p.id} narxga ta'sir qiladi`);
});
