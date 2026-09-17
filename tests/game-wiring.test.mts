import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GAME_COUNT_RATIO, fileSuffix, gameGateFail } from "../lib/generation/index.ts";
import { deliveredCount, infographicDelivered } from "../lib/generation/delivered.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import { GAME_TOOL_LIST, type CrosswordWord, type Flashcard, type GameModel } from "../lib/generation/games/types.ts";
import type { AcademicDoc, DocMeta } from "../lib/generation/types.ts";
import type { FormValues } from "../lib/types.ts";

/**
 * BOSMA O'YINLAR + INFOGRAFIKA ULASH (AUDIT-21 R).
 *
 * `teacher-wiring.test.mts` naqshi: bu fayl `buildArtifact`ning o'yin
 * darvozasini (`gameGateFail`) va `delivered.ts` dagi `doc.game`/
 * infografika shoxini qulflaydi. Dvigatelning O'ZI (`games/crossword/**`)
 * `crossword-engine.test.mts` da sinaladi — bu yerda ULANISH: darvoza
 * to'g'ri sonni ko'radimi, WP-B hali ulanmagan bo'lsa dvigatel ANIQ
 * `null` qaytaradimi (soxta yashil emas), fayl nomi vositani ayta
 * oladimi.
 */

const metaOf = (toolId: keyof typeof TOOL_BY_ID, values: FormValues = {}): DocMeta => extractMeta(TOOL_BY_ID[toolId], values);

/** Kesishma/to'r geometriyasi bu yerda ahamiyatsiz — darvoza faqat SONNI o'lchaydi. */
function crosswordWords(n: number): CrosswordWord[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `w${i}`,
    answer: [...`SOZ${i}`],
    clue: `Ta'rif raqami ${i} — kamida o'n belgi`,
    dir: i % 2 === 0 ? ("across" as const) : ("down" as const),
    row: i,
    col: 0,
    number: i + 1,
  }));
}

function crosswordDoc(meta: DocMeta, n: number): AcademicDoc {
  const game: GameModel = {
    v: 1,
    kind: "crossword",
    type: "klassik",
    language: "uz",
    topic: "Fotosintez",
    crossword: { words: crosswordWords(n), grid: { rows: 15, cols: 15, cells: [] }, clues: { across: [], down: [] }, dropped: [] },
  };
  return { meta, titlePage: true, toc: false, sections: [], game };
}

function flashcards(n: number): Flashcard[] {
  return Array.from({ length: n }, (_, i) => ({ id: `c${i}`, front: `Atama ${i}`, back: `Ta'rifi ${i} — bu yerda orqa yuz matni yetarlicha uzun` }));
}

function flashcardsDoc(meta: DocMeta, n: number): AcademicDoc {
  const game: GameModel = { v: 1, kind: "flashcards", type: "term-def", language: "uz", topic: "Biologiya atamalari", cards: { type: "term-def", cards: flashcards(n) } };
  return { meta, titlePage: true, toc: false, sections: [], game };
}

/* ───────────────────────── darvoza (gameGateFail) ───────────────────────── */

test("darvoza — krossvord: so'z 0.7 ulushi", () => {
  assert.equal(GAME_COUNT_RATIO, 0.7);
  const meta = metaOf("crossword", { topic: "Fotosintez", wordCount: 10 });
  const v: FormValues = { wordCount: 10 };
  // ceil(10 × 0.7) = 7 — chegarada o'tadi.
  assert.equal(gameGateFail(meta, v, crosswordDoc(meta, 7)), null, "7/10 chegarada o'tishi kerak");
  assert.equal(gameGateFail(meta, v, crosswordDoc(meta, 10)), null, "to'liq");
  // MUTATSIYA: nisbat 0.6 ga tushirilsa 6 ham o'tib ketardi.
  const fail = gameGateFail(meta, v, crosswordDoc(meta, 6));
  assert.equal(fail?.rule, "crossword.words");
  assert.match(fail!.message, /Kredit qaytariladi/);
});

test("darvoza — flesh kartalar: karta 0.7 ulushi", () => {
  const meta = metaOf("flashcards", { topic: "Biologiya", cardCount: 10 });
  const v: FormValues = { cardCount: 10 };
  assert.equal(gameGateFail(meta, v, flashcardsDoc(meta, 7)), null, "7/10 chegarada o'tishi kerak");
  // MUTATSIYA: nisbat pasaytirilsa 6 ham o'tib ketardi.
  assert.equal(gameGateFail(meta, v, flashcardsDoc(meta, 6))?.rule, "flashcards.cards");
});

test("darvoza — `doc.game` yo'q bo'lsa (boshqa vosita) `null`, model yo'q bo'lsa xato", () => {
  const meta = metaOf("crossword", { topic: "X", wordCount: 10 });
  const noModel = { meta, titlePage: true, toc: false, sections: [] } as unknown as AcademicDoc;
  assert.equal(gameGateFail(meta, {}, noModel), null, "doc.game yo'q — o'yin darvozasi jim o'tishi kerak (boshqa vosita bunga tayanmasin)");
  const emptyModel: AcademicDoc = { meta, titlePage: true, toc: false, sections: [], game: { v: 1, kind: "crossword", type: "klassik", language: "uz", topic: "X" } };
  assert.equal(gameGateFail(meta, {}, emptyModel)?.rule, "crossword.model");
});

test("`index.ts`da darvoza ULANGAN: `buildArtifact` `gameGateFail`ni chaqiradi", () => {
  const src = readFileSync(new URL("../lib/generation/index.ts", import.meta.url), "utf8");
  assert.match(src, /gameGateFail\(meta, values, academic\)/, "MUTATSIYA: chaqiruv olib tashlansa juda kam so'zli/kartali hujjat ham «tayyor» bo'lib qolardi");
  assert.match(src, /\[gen\] game gate:/, "yiqilish logga yozilishi kerak (boshqa darvozalar bilan bir xil naqsh)");
});

/* ───────────────────────── delivered (`doc.game`) ───────────────────────── */

test("delivered — krossvord: joylashgan/so'ralgan, unit «so'z»", () => {
  const meta = metaOf("crossword", { topic: "Fotosintez", wordCount: 10 });
  const v: FormValues = { wordCount: 10 };
  assert.deepEqual(deliveredCount(meta, crosswordDoc(meta, 8), v), { got: 8, want: 10, unit: "so'z" });
  // MUTATSIYA: unit "atama"/"karta" bo'lib qolsa bu qator ushlaydi.
  assert.equal(deliveredCount(meta, crosswordDoc(meta, 10), v), undefined, "10/10 — delivered YO'Q (to'liq yetkazildi)");
});

test("delivered — flesh kartalar: unit «karta», `values.count` fallback", () => {
  const meta = metaOf("flashcards", { topic: "X", cardCount: 10 });
  assert.deepEqual(deliveredCount(meta, flashcardsDoc(meta, 6), { cardCount: 10 }), { got: 6, want: 10, unit: "karta" });
  // `count` — `crosswordInputFromValues`/`normalizeGameCount` ikkalasi ham shu qatorda ishlaydi.
  assert.deepEqual(deliveredCount(meta, flashcardsDoc(meta, 6), { count: 10 }), { got: 6, want: 10, unit: "karta" });
});

test("delivered — `doc.teacher`/`doc.game` yo'q bo'lsa boshqa vositalar o'zgarmaydi", () => {
  const meta = metaOf("glossary", { topic: "X", termCount: "20" });
  const doc: AcademicDoc = { meta, titlePage: true, toc: false, sections: [{ id: "terms", title: "T", blocks: Array.from({ length: 14 }, () => ({ kind: "h3", text: "a" })) }] };
  assert.deepEqual(deliveredCount(meta, doc), { got: 14, want: 20, unit: "atama" }, "MUTATSIYA: `doc.game` tekshiruvi glossariy yo'liga tushib qolsa bu buziladi");
});

/* ───────────────────────── infografika (blok) ───────────────────────── */

test("infographicDelivered — blok soni, tur chegarasiga kesilgan `want`", () => {
  // `process` turida maksimal 6 blok (registry) — 8 so'ralgan bo'lsa ham `want` 6 ga kesiladi.
  const v: FormValues = { infographicType: "process", blockCount: 8 };
  assert.equal(infographicDelivered(v, 6), undefined, "6/6 (kesilgan chegara) — to'liq");
  // MUTATSIYA: `normalizeBlockCountFor` chaqirilmasa `want` 8 bo'lib qolardi va bu qator 4/8 qaytarardi.
  assert.deepEqual(infographicDelivered(v, 4), { got: 4, want: 6, unit: "blok" });
});

test("infographicDelivered — `list` turida 8 ruxsat etilgan (chegara turga bog'liq)", () => {
  const v: FormValues = { infographicType: "list", blockCount: 8 };
  assert.equal(infographicDelivered(v, 8), undefined);
  assert.deepEqual(infographicDelivered(v, 5), { got: 5, want: 8, unit: "blok" });
});

/* ───────────────────────── fayl nomi ───────────────────────── */

test("fayl nomi qo'shimchasi — har vosita bir-biridan ajraladi", () => {
  // AUDIT-22: oila to'rtta o'yinga chiqdi; audio ham shu jadvaldan.
  assert.deepEqual(GAME_TOOL_LIST.map(fileSuffix), ["-krossvord", "-kartalar", "-saralash", "-tinglash"]);
  assert.equal(fileSuffix("infographic"), "-infografika");
  assert.equal(fileSuffix("podcast"), "-podkast");
  assert.equal(fileSuffix("greeting"), "-tabriknoma");
  const all = [...GAME_TOOL_LIST.map(fileSuffix), fileSuffix("infographic"), fileSuffix("podcast"), fileSuffix("greeting")];
  assert.equal(new Set(all).size, all.length, "qo'shimchalar noyob");
  assert.equal(fileSuffix("referat"), "", "boshqa vositalar o'zgarmaydi");
});

/* ───────────────────────── dispatch (WP-B holati) ───────────────────────── */

test("dispatch — kartalar dvigateli hali ulanmagan (WP-B) bo'lsa ANIQ `null`, soxta yashil emas", async () => {
  const { buildGameDoc } = await import("../lib/generation/games/engine.ts");
  const meta = metaOf("flashcards", { topic: "X", cardCount: 10 });
  const built = await buildGameDoc(meta, { topic: "X", cardCount: 10 }, { deadline: Date.now() + 1000 });
  /*
   * `games/flashcards/engine.ts` hali yo'q bo'lsa bu `null` bo'lishi
   * SHART. Fayl paydo bo'lgach (WP-B) bu test o'zgarishsiz o'tadi —
   * `buildFlashcardsDoc` chaqirilib, natija (haqiqiy LLM kalitsiz)
   * baribir `null` bo'ladi.
   */
  assert.equal(built, null);
});

/*
 * Smoke: flashcards byudjeti (90 s) dvigatel zaxiralaridan (hisobot 40 s +
 * sayqal 55 s) kichik bo'lib, yozishga vaqt qolmay «0 karta» chiqardi.
 * Byudjet zaxiralar + kamida bitta to'liq yozish chaqiruvi (55 s) dan katta bo'lsin.
 */
test("flashcards byudjeti dvigatel zaxiralari + bitta yozish chaqiruvidan katta", async () => {
  const { gameBudgetMs } = await import("../lib/generation/budget.ts");
  const { CARDS_REVIEW_RESERVE_MS, CARDS_POLISH_RESERVE_MS } = await import("../lib/generation/games/flashcards/engine.ts");
  assert.ok(gameBudgetMs("flashcards", 5) >= CARDS_REVIEW_RESERVE_MS + CARDS_POLISH_RESERVE_MS + 55_000, `byudjet ${gameBudgetMs("flashcards", 5)} ms`);
});

test("saralash/tinglash byudjeti dvigatel zaxiralari + bitta yozish chaqiruvidan katta", async () => {
  const { gameBudgetMs } = await import("../lib/generation/budget.ts");
  const so = await import("../lib/generation/games/sorting/engine.ts");
  const li = await import("../lib/generation/games/listening/engine.ts");
  assert.ok(gameBudgetMs("sorting", 6) >= so.SORTING_REVIEW_RESERVE_MS + so.SORTING_POLISH_RESERVE_MS + 55_000, `saralash ${gameBudgetMs("sorting", 6)}`);
  assert.ok(gameBudgetMs("listening", 10) >= li.LISTENING_REVIEW_RESERVE_MS + li.LISTENING_POLISH_RESERVE_MS + 55_000, `tinglash ${gameBudgetMs("listening", 10)}`);
});
