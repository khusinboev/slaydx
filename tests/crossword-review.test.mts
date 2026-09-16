import test from "node:test";
import assert from "node:assert/strict";
import {
  CROSSWORD_RULE_IDS,
  MIN_CROSSING_RATIO,
  clueContainsAnswer,
  countGridCrossings,
  crosswordRuleChecks,
  gridConnected,
  wordFitsGrid,
  type CrosswordReviewAsk,
} from "../lib/generation/games/crossword/review.ts";
import { placeWords, type CrosswordGridData, type PlacedWord } from "../lib/generation/games/crossword/grid.ts";
import { CROSSWORD_LIMITS } from "../lib/generation/games/crossword/input.ts";
import type { ReviewCheck } from "../lib/generation/report/types.ts";

/**
 * KROSSVORD HISOBOTI — QOIDALAR (AUDIT-21 WP-A).
 *
 * Baholovchi (`JudgeSpec` — R0 `games/registry.ts` da) va hujjat
 * darajasidagi `reviewCrossword(doc)` o'rami R0 substratidan keyin.
 *
 * Mutatsiyalar (qizardi):
 *   1. `clueContainsAnswer` faqat to'liq so'zni qidirdi (o'zak emas) —
 *      «agglutinativ shakl ham oshkor qiladi» testi;
 *   2. `minCrossings` chegarasi 0 ga tushdi — «kesishmasi kam to'r
 *      qizil» testi;
 *   3. `uniqueWords` dublikatni sezmadi — «takroriy javob qizil» testi;
 *   4. `gridMatchesWords` to'rni tekshirmadi — «surilgan so'z tutiladi»
 *      testi;
 *   5. `answerSheet` doim yashil qaytardi — «javoblarsiz hujjat qizil»
 *      testi;
 *   6. `crosswordRuleChecks` ichiga `Date.now` kirdi — «determinizm»
 *      testi.
 */

/* ────────────────────────── namuna ────────────────────────── */

const SAMPLE = [
  { answer: "matematika", clue: "Sonlar va shakllar haqidagi aniq fan" },
  { answer: "biologiya", clue: "Tirik organizmlarni o'rganadigan fan" },
  { answer: "atom", clue: "Modda tuzilishining eng kichik zarrasi" },
  { answer: "molekula", clue: "Bir necha zarrachadan tuzilgan birikma" },
  { answer: "tarix", clue: "O'tmish voqealarini o'rganadigan fan" },
  { answer: "kislota", clue: "Lakmusni qizartiruvchi modda" },
  { answer: "vektor", clue: "Yo'nalishga ega bo'lgan kattalik" },
  { answer: "quyosh", clue: "Sistemamiz markazidagi yulduz" },
];

const res = placeWords(SAMPLE, { seed: "review" });

const ask: CrosswordReviewAsk = { wordCount: SAMPLE.length, gridSize: 15, hasAnswers: true };

const byId = (checks: ReviewCheck[], id: string): ReviewCheck => {
  const c = checks.find((x) => x.id === id);
  assert.ok(c, `«${id}» bandi yo'q`);
  return c!;
};

const run = (words = res.placed, grid = res.grid, a: CrosswordReviewAsk = ask) => crosswordRuleChecks(words, grid, a);

/* ────────────────────────── testlar ────────────────────────── */

test("hisobot §4.1 dagi barcha bandlarni beradi, tartibi barqaror", () => {
  const checks = run();
  assert.deepEqual(checks.map((c) => c.id), [...CROSSWORD_RULE_IDS]);
  assert.equal(checks.length, 10);
  for (const c of checks) {
    assert.ok(c.label.length > 0, `${c.id} yorlig'i bo'sh`);
    assert.ok(["green", "yellow", "red"].includes(c.level));
  }
});

test("yaxshi krossvordda hamma band YASHIL", () => {
  const checks = run();
  const bad = checks.filter((c) => c.level !== "green");
  assert.equal(bad.length, 0, `yashil emas: ${bad.map((c) => `${c.id}(${c.detail})`).join(", ")}`);
  assert.ok(checks.every((c) => !c.fix), "yashil bandda «Tuzatish» bo'lmasin");
});

test("wordCount: sig'magan so'z sariq/qizil qiladi va tuzatish taklif etadi", () => {
  const green = byId(run(), "wordCount");
  assert.equal(green.level, "green");
  // 8 dan 7 tasi (87 %) — sariq; 8 dan 4 tasi (50 %) — qizil.
  const yellow = byId(run(res.placed.slice(0, 7), res.grid, { ...ask, dropped: [{ answer: "QUYOSH", clue: "x", reason: "nofit" }] }), "wordCount");
  assert.equal(yellow.level, "yellow");
  assert.match(yellow.detail ?? "", /7 \/ 8/);
  assert.match(yellow.detail ?? "", /1 so'z tashlandi/);
  assert.ok(yellow.fix, "tuzatish taklifi yo'q");
  assert.equal(byId(run(res.placed.slice(0, 4)), "wordCount").level, "red");
});

test("gridSize: kesilgan to'r buyurtmadan KICHIK bo'lsa ham yashil, kattasi nuqson", () => {
  const small: CrosswordGridData = { rows: 8, cols: 9, cells: res.grid.cells };
  assert.equal(byId(crosswordRuleChecks(res.placed, small, { ...ask, gridSize: 21 }), "gridSize").level, "green");
  const big: CrosswordGridData = { rows: 19, cols: 19, cells: res.grid.cells };
  const over = byId(crosswordRuleChecks(res.placed, big, { ...ask, gridSize: 15 }), "gridSize");
  assert.equal(over.level, "yellow", "buyurtmadan katta — nuqson");
  assert.ok(over.fix);
  const huge: CrosswordGridData = { rows: 25, cols: 25, cells: res.grid.cells };
  assert.equal(byId(crosswordRuleChecks(res.placed, huge, { ...ask, gridSize: 21 }), "gridSize").level, "red", "21 dan katta to'r qizil");
});

test("minCrossings: kesishmalar so'z sonining yarmidan kam bo'lsa qizil", () => {
  const green = byId(run(), "minCrossings");
  assert.equal(green.level, "green");
  assert.ok(countGridCrossings(res.placed) >= Math.ceil(res.placed.length * MIN_CROSSING_RATIO));
  // MUTATSIYA-2: bir-biriga tegmaydigan so'zlarda kesishma 0.
  const loose: PlacedWord[] = SAMPLE.slice(0, 4).map((w, i) => ({
    id: `w${i}`,
    answer: w.answer.toUpperCase(),
    clue: w.clue,
    dir: "across",
    row: i * 3,
    col: 0,
    number: i + 1,
  }));
  const check = byId(crosswordRuleChecks(loose, { rows: 12, cols: 12, cells: [] }, ask), "minCrossings");
  assert.equal(check.level, "red");
  assert.equal(countGridCrossings(loose), 0);
  assert.ok(check.fix);
});

test("wordLength: 3 harfdan qisqa yoki 15 dan uzun javob tutiladi", () => {
  const green = byId(run(), "wordLength");
  assert.equal(green.level, "green");
  const bad: PlacedWord[] = [
    { ...res.placed[0], answer: "UY", clue: "Qisqa javob" },
    { ...res.placed[1], answer: "ELEKTROGENERATORLAR", clue: "Juda uzun javob" },
  ];
  const check = byId(crosswordRuleChecks([...res.placed, ...bad], res.grid, ask), "wordLength");
  assert.equal(check.level, "red");
  assert.match(check.detail ?? "", /UY/);
  assert.ok(check.detail?.includes(String(CROSSWORD_LIMITS.answerMin)) || check.fix);
});

test("clueLength: 10–150 belgi oralig'idan chiqqan ta'riflar sanaladi", () => {
  assert.equal(byId(run(), "clueLength").level, "green");
  const short = res.placed.map((w, i) => (i === 0 ? { ...w, clue: "Fan" } : w));
  const one = byId(crosswordRuleChecks(short, res.grid, ask), "clueLength");
  assert.equal(one.level, "yellow", "8 tadan 1 tasi — sariq");
  assert.match(one.detail ?? "", /1 ta'rif/);
  const allBad = res.placed.map((w) => ({ ...w, clue: "x".repeat(CROSSWORD_LIMITS.clueMax + 1) }));
  assert.equal(byId(crosswordRuleChecks(allBad, res.grid, ask), "clueLength").level, "red");
});

test("uniqueWords: bir xil javob ikki marta — QIZIL", () => {
  assert.equal(byId(run(), "uniqueWords").level, "green");
  // MUTATSIYA-3: dublikat sezilmasa bu yerda yashil qolardi.
  const dupe = [...res.placed, { ...res.placed[0], id: "dup" }];
  const check = byId(crosswordRuleChecks(dupe, res.grid, ask), "uniqueWords");
  assert.equal(check.level, "red");
  assert.match(check.detail ?? "", new RegExp(res.placed[0].answer));
  // Registr va apostrof farqi ham dublikat hisoblanadi.
  const same = [...res.placed, { ...res.placed[0], id: "d2", answer: res.placed[0].answer.toLowerCase() }];
  assert.equal(byId(crosswordRuleChecks(same, res.grid, ask), "uniqueWords").level, "red");
});

test("clueNotContainsAnswer: ta'rif javobni yoki O'ZAGINI oshkor qilsa — QIZIL", () => {
  assert.equal(byId(run(), "clueNotContainsAnswer").level, "green");
  // MUTATSIYA-1: faqat to'liq so'z qidirilsa agglutinativ shakl o'tib ketardi.
  assert.ok(clueContainsAnswer("Biologiya fani nimani o'rganadi", "biologiya"), "to'liq so'z tutilmadi");
  assert.ok(clueContainsAnswer("Hujayralarning asosiy qismi", "hujayra"), "qo'shimchali shakl tutilmadi");
  assert.ok(clueContainsAnswer("Matematik amallar bo'limi", "matematika"), "o'zak tutilmadi");
  assert.ok(clueContainsAnswer("O'simliklar dunyosi", "o'simlik"), "apostrofli o'zak tutilmadi");
  // Yolg'on ijobiy bo'lmasin: boshqa so'zlar.
  assert.ok(!clueContainsAnswer("Tirik organizmlarni o'rganadigan fan", "biologiya"));
  assert.ok(!clueContainsAnswer("Modda tuzilishining eng kichik zarrasi", "atom"));
  assert.ok(!clueContainsAnswer("Sistemamiz markazidagi yulduz", "quyosh"));
  const leaky = res.placed.map((w, i) => (i === 0 ? { ...w, clue: `${w.answer} nimani o'rganadi` } : w));
  const check = byId(crosswordRuleChecks(leaky, res.grid, ask), "clueNotContainsAnswer");
  assert.equal(check.level, "red");
  assert.ok(check.fix, "tuzatish taklifi yo'q");
});

test("gridMatchesWords: bir katakka surilgan so'z tutiladi", () => {
  assert.equal(byId(run(), "gridMatchesWords").level, "green");
  assert.ok(res.placed.every((w) => wordFitsGrid(w, res.grid)));
  // MUTATSIYA-4: to'r tekshirilmasa surilgan so'z sezilmasdan qolardi.
  const moved = res.placed.map((w, i) => (i === 0 ? { ...w, col: w.col + 1, row: w.row + 1 } : w));
  const check = byId(crosswordRuleChecks(moved, res.grid, ask), "gridMatchesWords");
  assert.equal(check.level, "red");
  assert.ok(!wordFitsGrid(moved[0], res.grid));
});

test("gridConnected: ikkiga bo'lingan to'r — QIZIL", () => {
  assert.equal(byId(run(), "gridConnected").level, "green");
  assert.ok(gridConnected(res.grid));
  const split: CrosswordGridData = {
    rows: 3,
    cols: 5,
    cells: [
      ["A", "T", "O", null, "K"],
      [null, null, null, null, "O"],
      [null, null, null, null, "L"],
    ],
  };
  assert.ok(!gridConnected(split), "ajralgan to'r bog'langan deb topildi");
  assert.equal(byId(crosswordRuleChecks(res.placed, split, ask), "gridConnected").level, "red");
  assert.ok(gridConnected({ rows: 0, cols: 0, cells: [] }), "bo'sh to'r — bog'langan hisoblanadi");
});

test("answerSheet: javoblar bo'limi yo'q bo'lsa — QIZIL", () => {
  assert.equal(byId(run(), "answerSheet").level, "green");
  // MUTATSIYA-5: doim yashil qaytarilsa javobsiz hujjat o'tib ketardi.
  const check = byId(run(res.placed, res.grid, { ...ask, hasAnswers: false }), "answerSheet");
  assert.equal(check.level, "red");
  assert.ok(check.fix);
  // Bayroq berilmasa — javoblar bor deb hisoblanadi (eski hujjatlar).
  assert.equal(byId(crosswordRuleChecks(res.placed, res.grid, { wordCount: 8 }), "answerSheet").level, "green");
});

test("determinizm: bir xil kirishda hisobot bayt-bayt bir xil (tasodif/sana yo'q)", () => {
  // MUTATSIYA-6: `Date.now`/`Math.random` kirsa bu tenglik buzilardi.
  assert.deepEqual(run(), run());
  assert.equal(JSON.stringify(run()), JSON.stringify(run()));
});
