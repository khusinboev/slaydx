import test from "node:test";
import assert from "node:assert/strict";
import {
  CROSSWORD_MM,
  MM_PX,
  cellMm,
  crosswordHeightMm,
  crosswordSvg,
  crosswordWidthMm,
  numberMap,
} from "../lib/generation/games/crossword/svg.ts";
import { OKINA, placeWords, type CrosswordGridData, type PlacedWord } from "../lib/generation/games/crossword/grid.ts";

/**
 * KROSSVORD TO'RI — SVG (AUDIT-21 WP-A).
 *
 * Mutatsiyalar (qizardi):
 *   1. `cellMm` 170 mm chegarasini hisobga olmadi (doim 9 mm) — «21
 *      ustunli to'r betga sig'adi» testi;
 *   2. javob to'rida harflar chizilmadi — «javob to'ri harf bilan» testi;
 *   3. raqamlar har katakka chizildi (faqat so'z boshiga emas) —
 *      «raqam faqat so'z boshida» testi;
 *   4. `xmlEscape` olib tashlandi — «XML xavfsizligi» testi;
 *   5. `blackCells` bayrog'i e'tiborsiz qoldirildi — «qora katak
 *      rejimi» testi (bezak parametr yo'q).
 */

/* ────────────────────────── namuna ────────────────────────── */

const SAMPLE = [
  { answer: "matematika", clue: "Aniq fan" },
  { answer: "atom", clue: "Zarra" },
  { answer: "molekula", clue: "Atomlardan tuzilgan" },
  { answer: "tarix", clue: "O'tmish fani" },
  { answer: "o'simlik", clue: "Fotosintez qiluvchi organizm" },
];

const res = placeWords(SAMPLE, { seed: "svg-test" });

/** Sun'iy to'r — o'lchov/qochirish testlari uchun. */
function fakeGrid(cells: (string | null)[][]): CrosswordGridData {
  return { rows: cells.length, cols: cells[0]?.length ?? 0, cells };
}

const viewBox = (svg: string) => {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  assert.ok(m, "viewBox yo'q");
  return { w: Number(m![1]), h: Number(m![2]) };
};

const count = (svg: string, re: RegExp) => svg.match(re)?.length ?? 0;

/* ────────────────────────── testlar ────────────────────────── */

test("o'lchovlar jadvali: katak 9 mm, eng kichigi 7 mm, kenglik ≤ 170 mm", () => {
  assert.equal(CROSSWORD_MM.cell, 9, "MUTATSIYA: standart katak o'zgardi");
  assert.equal(CROSSWORD_MM.cellMin, 7);
  assert.equal(CROSSWORD_MM.maxWidth, 170);
  // 1 mm = 96/25.4 px — `figurePng(svg, { widthMm })` shu nisbatga tayanadi.
  assert.ok(Math.abs(MM_PX - 3.779) < 0.01, `MM_PX = ${MM_PX}`);
});

test("keng to'r betga sig'adi: 21 ustunda katak kichrayadi, 7–9 mm oralig'ida qoladi", () => {
  // MUTATSIYA-1: katak doim 9 mm bo'lsa 21 ustun 189 mm bo'lib betdan chiqardi.
  for (const cols of [5, 10, 15, 18, 19, 20, 21]) {
    const c = cellMm(cols);
    assert.ok(c >= CROSSWORD_MM.cellMin && c <= CROSSWORD_MM.cell, `${cols} ustun → ${c} mm`);
    assert.ok(cols * c <= CROSSWORD_MM.maxWidth + 0.01, `${cols} ustun → ${cols * c} mm > 170 mm`);
  }
  assert.equal(cellMm(10), 9, "tor to'rda katak kichraymaydi");
  assert.ok(cellMm(21) < 9, "21 ustunda katak kichrayishi kerak");
});

test("viewBox millimetrda: kenglik = ustun × katak + 2 × chekka", () => {
  const cell = cellMm(res.grid.cols);
  const svg = crosswordSvg(res.grid, res.placed);
  const vb = viewBox(svg);
  assert.ok(Math.abs(vb.w - crosswordWidthMm(res.grid) * MM_PX) < 0.5, `kenglik ${vb.w}`);
  assert.ok(Math.abs(vb.h - crosswordHeightMm(res.grid) * MM_PX) < 0.5, `balandlik ${vb.h}`);
  assert.equal(crosswordWidthMm(res.grid), Math.round((res.grid.cols * cell + 2 * CROSSWORD_MM.pad) * 100) / 100);
  assert.ok(crosswordWidthMm(res.grid) <= CROSSWORD_MM.maxWidth + 2 * CROSSWORD_MM.pad);
});

test("bo'sh to'r: har harf katagi uchun bitta oq to'rtburchak, HARF yo'q", () => {
  const svg = crosswordSvg(res.grid, res.placed);
  const filled = res.grid.cells.flat().filter(Boolean).length;
  // Fon to'rtburchagi + har harf katagi.
  assert.equal(count(svg, /<rect /g), filled + 1, "katak to'rtburchaklari soni mos emas");
  assert.equal(count(svg, /<rect [^>]*fill="#000"/g), 0, "bo'sh to'rda qora katak chizilmasin");
  // Raqamlardan boshqa matn bo'lmasligi kerak.
  const texts = [...svg.matchAll(/>([^<]+)<\/text>/g)].map((m) => m[1]);
  assert.ok(texts.length > 0, "raqamlar chizilmadi");
  assert.ok(
    texts.every((t) => /^\d+$/.test(t)),
    `bo'sh to'rda harf chiqdi: ${texts.filter((t) => !/^\d+$/.test(t)).join(", ")}`,
  );
});

test("javob to'ri: har katakda o'z harfi (apostrofli harf ham)", () => {
  const svg = crosswordSvg(res.grid, res.placed, { answers: true });
  const texts = [...svg.matchAll(/>([^<]+)<\/text>/g)].map((m) => m[1]);
  const lettersDrawn = texts.filter((t) => !/^\d+$/.test(t));
  const filled = res.grid.cells.flat().filter(Boolean) as string[];
  // MUTATSIYA-2: harflar chizilmasa bu ro'yxat bo'sh qolardi.
  assert.equal(lettersDrawn.length, filled.length, "harflar soni katak soniga teng emas");
  assert.deepEqual([...lettersDrawn].sort(), [...filled].sort(), "chizilgan harflar to'rga mos emas");
  const oz = res.placed.find((w) => w.answer.startsWith(`O${OKINA}`));
  if (oz) assert.ok(svg.includes(`>O${OKINA}</text>`), "apostrofli harf bitta katakda chizilmadi");
  // Bo'sh to'r bilan bir xil ramka (o'quvchi va o'qituvchi beti ustma-ust tushadi).
  assert.equal(viewBox(svg).w, viewBox(crosswordSvg(res.grid, res.placed)).w);
});

test("raqam FAQAT so'z boshlanadigan katakda va bitta katakda bitta raqam", () => {
  const svg = crosswordSvg(res.grid, res.placed);
  const numbers = [...svg.matchAll(/>(\d+)<\/text>/g)].map((m) => Number(m[1]));
  const starts = numberMap(res.placed);
  // MUTATSIYA-3: har katakka raqam qo'yilsa bu son katak soniga teng bo'lardi.
  assert.equal(numbers.length, starts.size, "raqamlar soni so'z boshlari soniga teng emas");
  assert.deepEqual([...numbers].sort((a, b) => a - b), [...starts.values()].sort((a, b) => a - b));
  // Gorizontal va vertikal bitta katakdan boshlansa — bitta raqam.
  assert.ok(starts.size <= res.placed.length);
});

test("qora katak rejimi: `blackCells` so'zsiz kataklarni bo'yaydi (bezak bayroq emas)", () => {
  const plain = crosswordSvg(res.grid, res.placed);
  const black = crosswordSvg(res.grid, res.placed, { blackCells: true });
  const filled = res.grid.cells.flat().filter(Boolean).length;
  const empty = res.grid.rows * res.grid.cols - filled;
  // MUTATSIYA-5: bayroq e'tiborsiz qolsa ikkala satr bir xil bo'lardi.
  assert.notEqual(plain, black, "`blackCells` hech narsani o'zgartirmadi");
  assert.equal(count(black, /<rect [^>]*fill="#000"/g), empty, "qora kataklar soni mos emas");
  assert.equal(count(black, /<rect /g), filled + empty + 1);
});

test("XML xavfsizligi: katak va shrift nomi qochiriladi", () => {
  // MUTATSIYA-4: `xmlEscape` olib tashlansa SVG buzilardi.
  const grid = fakeGrid([
    ["<", "&", null],
    [null, '"', null],
  ]);
  const words: PlacedWord[] = [{ id: "w1", answer: "<&", clue: "x", dir: "across", row: 0, col: 0, number: 1 }];
  const svg = crosswordSvg(grid, words, { answers: true });
  assert.ok(svg.includes("&lt;"), "`<` qochirilmadi");
  assert.ok(svg.includes("&amp;"), "`&` qochirilmadi");
  assert.ok(!/>[<&"]<\/text>/.test(svg), "xom belgi matnga tushdi");
  assert.ok(svg.includes("Liberation Serif"), "shrift zanjiri yo'q");
});

test("determinizm: bir xil to'r — bayt-bayt bir xil SVG", () => {
  const a = crosswordSvg(res.grid, res.placed, { answers: true });
  const b = crosswordSvg(res.grid, res.placed, { answers: true });
  assert.equal(a, b);
  assert.notEqual(a, crosswordSvg(res.grid, res.placed), "javob to'ri bo'sh to'rdan farq qilishi kerak");
});

test("bo'sh to'r (so'z joylashmagan) — yiqilmaydi, to'g'ri SVG qaytadi", () => {
  const svg = crosswordSvg({ rows: 0, cols: 0, cells: [] }, []);
  assert.ok(svg.startsWith("<svg "), "SVG emas");
  assert.ok(svg.endsWith("</svg>"));
  const vb = viewBox(svg);
  assert.ok(vb.w > 0 && vb.h > 0, "o'lchov nol");
  assert.equal(count(svg, /<text /g), 0);
});
