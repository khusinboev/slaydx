import test from "node:test";
import assert from "node:assert/strict";
import {
  GRID_DEFAULTS,
  OKINA,
  canPlace,
  cellLength,
  cluesOf,
  isPlaceable,
  letters,
  normalizeAnswer,
  normalizeApostrophes,
  placeWords,
  validatePlacement,
  wordText,
  type CrosswordGridData,
  type PlaceResult,
  type PlacedWord,
  type WordInput,
} from "../lib/generation/games/crossword/grid.ts";

/**
 * KROSSVORD TO'RI (AUDIT-21 WP-A) — sof algoritm.
 *
 * Mutatsiyalar (qizardi):
 *   1. `canPlace` da parallel qo'shnilik tekshiruvi o'chirildi —
 *      «yonma-yon so'z taqiqlanadi» testi (qator/ustun yugurishlari);
 *   2. `canPlace` so'z boshidan oldingi katakni tekshirmadi —
 *      «so'zlar bir-biriga yopishmaydi» testi;
 *   3. `letters` da `oʻ` ikki katakka bo'lindi — «apostrofli harf bitta
 *      katak» testi;
 *   4. `placeWords` da `seed` ishlatilmay `Math.random` qo'yildi —
 *      «determinizm» testi;
 *   5. `canPlace` harf mos kelishini tekshirmadi — «harflar so'zlarga
 *      aynan mos tushadi» testi;
 *   6. `finalize` ramkani kesmadi (to'liq 21×21 qaytardi) — «to'r
 *      kesiladi» testi (18 band qizardi);
 *   7. nomzod bahosi teskari (eng yomoni tanlandi) — «to'r ixcham» testi;
 *   8. dublikat filtri o'chdi — «tashlangan so'zlar sababi» testi.
 */

/* ────────────────────────── namuna lug'at ────────────────────────── */

/** 20 ta maktab atamasi — jonli promptning o'rniga (§5 misollari uslubida). */
const SAMPLE: WordInput[] = [
  { answer: "matematika", clue: "Sonlar va shakllar haqidagi aniq fan" },
  { answer: "biologiya", clue: "Tirik organizmlarni o'rganadigan fan" },
  { answer: "kimyo", clue: "Moddalar tarkibi va o'zgarishi haqidagi fan" },
  { answer: "fizika", clue: "Tabiat hodisalari va energiya haqidagi fan" },
  { answer: "geografiya", clue: "Yer yuzasi va mamlakatlarni o'rganuvchi fan" },
  { answer: "tarix", clue: "O'tmish voqealarini o'rganadigan fan" },
  { answer: "adabiyot", clue: "So'z san'ati asarlari majmuasi" },
  { answer: "algebra", clue: "Harflar bilan ifodalangan amallar bo'limi" },
  { answer: "geometriya", clue: "Shakllar va ularning o'lchamlari bo'limi" },
  { answer: "atom", clue: "Modda tuzilishining eng kichik zarrasi" },
  { answer: "molekula", clue: "Atomlardan tuzilgan zarracha" },
  { answer: "hujayra", clue: "Tirik organizmning asosiy tuzilma birligi" },
  { answer: "vektor", clue: "Yo'nalishga ega bo'lgan kattalik" },
  { answer: "tenglama", clue: "Noma'lumli tenglik ifodasi" },
  { answer: "kislota", clue: "Lakmusni qizartiruvchi modda" },
  { answer: "bosim", clue: "Yuzaga tik ta'sir etuvchi kuch kattaligi" },
  { answer: "tezlik", clue: "Vaqt birligida bosib o'tilgan yo'l" },
  { answer: "quyosh", clue: "Sistemamiz markazidagi yulduz" },
  { answer: "o'simlik", clue: "Fotosintez qiluvchi tirik organizm" },
  { answer: "shakar", clue: "Shirin ta'mli oziq-ovqat mahsuloti" },
];

/* ────────────────────────── yordamchilar ────────────────────────── */

/** To'rdagi ikkidan uzun gorizontal/vertikal harf yugurishlari. */
function runsOf(grid: CrosswordGridData): { across: string[]; down: string[] } {
  const across: string[] = [];
  const down: string[] = [];
  for (let r = 0; r < grid.rows; r++) {
    let cur: string[] = [];
    for (let c = 0; c <= grid.cols; c++) {
      const ch = c < grid.cols ? grid.cells[r][c] : null;
      if (ch) cur.push(ch);
      else {
        if (cur.length > 1) across.push(cur.join(""));
        cur = [];
      }
    }
  }
  for (let c = 0; c < grid.cols; c++) {
    let cur: string[] = [];
    for (let r = 0; r <= grid.rows; r++) {
      const ch = r < grid.rows ? grid.cells[r][c] : null;
      if (ch) cur.push(ch);
      else {
        if (cur.length > 1) down.push(cur.join(""));
        cur = [];
      }
    }
  }
  return { across, down };
}

/** So'zning to'rdagi kataklari (chizilgan harflar). */
function cellsOfWord(grid: CrosswordGridData, w: PlacedWord): (string | null)[] {
  const n = w.answer.length;
  return Array.from({ length: n }, (_, i) => (w.dir === "across" ? grid.cells[w.row][w.col + i] : grid.cells[w.row + i][w.col]));
}

/** Shu so'zning nechta katagi boshqa yo'nalishdagi so'z bilan kesishadi. */
function crossingsOfWord(res: PlaceResult, w: PlacedWord): number {
  const others = res.placed.filter((o) => o !== w && o.dir !== w.dir);
  let n = 0;
  for (let i = 0; i < w.answer.length; i++) {
    const r = w.dir === "across" ? w.row : w.row + i;
    const c = w.dir === "across" ? w.col + i : w.col;
    for (const o of others) {
      const len = o.answer.length;
      const hit = o.dir === "across" ? o.row === r && c >= o.col && c < o.col + len : o.col === c && r >= o.row && r < o.row + len;
      if (hit) {
        n++;
        break;
      }
    }
  }
  return n;
}

const OZ = `o${OKINA}`;

/* ────────────────────────── 1. harflar ────────────────────────── */

test("apostrofli harf BITTA katak: oʻ/gʻ — 1, sh/ch/ng — 2 katak", () => {
  // MUTATSIYA-3: `oʻ` ikki katakka bo'linsa bu yerda 6 chiqardi.
  assert.deepEqual(letters(normalizeAnswer("o'zbek")), [`O${OKINA}`, "Z", "B", "E", "K"]);
  assert.equal(cellLength(normalizeAnswer("o'zbek")), 5);
  assert.deepEqual(letters(normalizeAnswer("g'oza")), [`G${OKINA}`, "O", "Z", "A"]);
  // sh/ch/ng — hisobot qaroriga ko'ra ikki katak.
  assert.deepEqual(letters(normalizeAnswer("shakar")), ["S", "H", "A", "K", "A", "R"]);
  assert.equal(cellLength(normalizeAnswer("chiziq")), 6);
  assert.equal(cellLength(normalizeAnswer("keng")), 4);
});

test("apostrof normalizatsiyasi: ' ‘ ’ ʼ → oʻ, tutuq belgisi tashlanadi", () => {
  for (const raw of ["o'zbek", "o‘zbek", "o’zbek", `o${OKINA}zbek`, "oʼzbek"]) {
    assert.equal(normalizeAnswer(raw), `O${OKINA}ZBEK`, `«${raw}» normallashmadi`);
  }
  // Tutuq belgisi (san'at) harf emas — katak olmaydi.
  assert.equal(normalizeAnswer("sanʼat"), "SANAT");
  assert.equal(cellLength(normalizeAnswer("san'at")), 5);
  assert.equal(normalizeApostrophes(`${OZ}zbekiston`), `${OZ}zbekiston`);
});

test("faqat bir so'zli, tinish belgisiz javob to'rga tushadi", () => {
  assert.ok(isPlaceable("ATOM"));
  assert.ok(isPlaceable(`O${OKINA}SIMLIK`));
  assert.ok(!isPlaceable("ONA TILI"), "bo'shliqli ibora to'rga tushmaydi");
  assert.ok(!isPlaceable("ISHQIY-SHE'R"), "tireli so'z to'rga tushmaydi");
  assert.ok(!isPlaceable("ATOM!"));
});

/* ────────────────────────── 2. qoidalar (canPlace) ────────────────────────── */

test("canPlace: chegaradan chiqish, harf mos kelmasligi va bir yo'nalishda ustma-ust yotish rad etiladi", () => {
  const res = placeWords([{ answer: "atom", clue: "zarra" }], { seed: "t", maxSize: 9 });
  assert.equal(res.placed.length, 1);
  const g = res.grid;
  // Bitta so'z — 1×4 ramka (kesilgan).
  assert.equal(g.rows, 1);
  assert.equal(g.cols, 4);

  // Taxtani qo'lda yig'amiz: 9×9, markazda ATOM.
  const size = 9;
  const board = {
    size,
    cell: new Array<string>(size * size).fill(""),
    across: new Int16Array(size * size).fill(-1),
    down: new Int16Array(size * size).fill(-1),
  };
  const word = ["A", "T", "O", "M"];
  for (let i = 0; i < 4; i++) {
    board.cell[4 * size + 2 + i] = word[i];
    board.across[4 * size + 2 + i] = 0;
  }
  // Chegaradan chiqish.
  assert.equal(canPlace(board, ["M", "O", "L", "E", "K", "U", "L", "A"], 0, 5, "across"), null);
  assert.equal(canPlace(board, ["A", "T", "O", "M"], -1, 0, "across"), null);
  // Harf mos kelmadi (T ustiga K).
  assert.equal(canPlace(board, ["K", "O", "L"], 3, 3, "down"), null);
  // Bir yo'nalishda ustma-ust (gorizontal ustiga gorizontal).
  assert.equal(canPlace(board, ["T", "O", "M"], 4, 3, "across"), null);
  // To'g'ri kesishma: O harfi orqali vertikal.
  assert.equal(canPlace(board, ["O", "L", "A"], 4, 4, "down"), 1);
  // Kesishmasdan yonma-yon (pastki qator) — parallel taqiq.
  assert.equal(canPlace(board, ["O", "L", "A"], 5, 2, "across"), null);
  // So'z oxiriga yopishish (M dan keyin darhol boshlanadi).
  assert.equal(canPlace(board, ["B", "O", "R"], 4, 6, "across"), null);
});

/* ────────────────────────── 3. joylashuv ────────────────────────── */

test("20 so'zdan ≥80 % to'rga tushadi (namuna lug'at)", () => {
  const res = placeWords(SAMPLE, { seed: "audit-21" });
  const share = res.placed.length / SAMPLE.length;
  assert.ok(share >= 0.8, `faqat ${res.placed.length}/20 joylashdi (${Math.round(share * 100)} %)`);
  assert.equal(res.placed.length + res.dropped.length, SAMPLE.length, "har so'z yo joylashdi, yo dropped da");
});

test("to'r chegarasi: har qanday so'z to'plamida tomon ≤ 21 (va `maxSize` dan oshmaydi)", () => {
  const big = placeWords(SAMPLE, { seed: "chegara" });
  assert.ok(big.grid.rows <= GRID_DEFAULTS.maxSize && big.grid.cols <= GRID_DEFAULTS.maxSize, `${big.grid.rows}×${big.grid.cols}`);
  const small = placeWords(SAMPLE, { seed: "kichik", maxSize: 11 });
  assert.ok(small.grid.rows <= 11 && small.grid.cols <= 11, `${small.grid.rows}×${small.grid.cols}`);
  // Kichik to'rga hamma so'z sig'masligi tabiiy — sig'maganlari `no-fit`.
  assert.ok(small.dropped.every((d) => d.reason === "no-fit" || d.reason === "too-long"));
});

test("to'r IXCHAM: 5 so'z ≤ 13, 10 so'z ≤ 18 tomon (har urug'da)", () => {
  // MUTATSIYA-7: nomzod bahosi teskari bo'lsa (eng yomoni tanlansa) bir
  // xil so'zlar 19×14 va 21×18 ga yoyilib ketadi — bosma betga sig'maydi.
  for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
    const five = placeWords(SAMPLE.slice(0, 5), { seed });
    assert.ok(Math.max(five.grid.rows, five.grid.cols) <= 13, `5 so'z: ${five.grid.rows}×${five.grid.cols} (urug' ${seed})`);
    const ten = placeWords(SAMPLE.slice(0, 10), { seed });
    assert.ok(Math.max(ten.grid.rows, ten.grid.cols) <= 18, `10 so'z: ${ten.grid.rows}×${ten.grid.cols} (urug' ${seed})`);
  }
});

test("to'r RAMKAGA kesiladi: chekka qator/ustunlarda kamida bitta harf bor", () => {
  const res = placeWords(SAMPLE, { seed: "kesish" });
  const g = res.grid;
  // MUTATSIYA-6: kesilmagan to'rda chekka qator butunlay bo'sh bo'lardi.
  assert.ok(g.cells[0].some(Boolean), "yuqori qator bo'sh");
  assert.ok(g.cells[g.rows - 1].some(Boolean), "pastki qator bo'sh");
  assert.ok(g.cells.some((row) => row[0]), "chap ustun bo'sh");
  assert.ok(g.cells.some((row) => row[g.cols - 1]), "o'ng ustun bo'sh");
  assert.equal(g.cells.length, g.rows);
  assert.ok(g.cells.every((row) => row.length === g.cols));
});

test("har so'z kamida bitta harfda kesishadi (yolg'iz so'z qolmaydi)", () => {
  const res = placeWords(SAMPLE, { seed: "kesishma" });
  assert.ok(res.placed.length > 1);
  for (const w of res.placed) {
    // MUTATSIYA-5: kesishma sharti olib tashlansa bu yerda 0 chiqardi.
    assert.ok(crossingsOfWord(res, w) >= 1, `«${w.answer}» hech kim bilan kesishmadi`);
  }
  assert.ok(res.crossings >= res.placed.length - 1, `kesishmalar soni ${res.crossings}`);
});

test("to'rdagi harflar so'zlarga AYNAN mos tushadi", () => {
  const res = placeWords(SAMPLE, { seed: "harflar" });
  for (const w of res.placed) {
    assert.deepEqual(cellsOfWord(res.grid, w), w.answer, `«${wordText(w.answer)}» kataklari mos emas`);
  }
});

test("TAQIQLI QO'SHNILIK: to'rdagi har bir ikki harfli yugurish — haqiqiy so'z", () => {
  const res = placeWords(SAMPLE, { seed: "qoshni" });
  const runs = runsOf(res.grid);
  const acrossWords = new Set(res.placed.filter((w) => w.dir === "across").map((w) => wordText(w.answer)));
  const downWords = new Set(res.placed.filter((w) => w.dir === "down").map((w) => wordText(w.answer)));
  // MUTATSIYA-1 va 2: parallel yoki yopishgan so'zlar «RAOT» kabi
  // lug'atda yo'q yugurishlar hosil qilardi.
  for (const r of runs.across) assert.ok(acrossWords.has(r), `gorizontal «${r}» so'z emas`);
  for (const r of runs.down) assert.ok(downWords.has(r), `vertikal «${r}» so'z emas`);
  assert.equal(runs.across.length, acrossWords.size);
  assert.equal(runs.down.length, downWords.size);
});

test("joylashuv butunligi: `validatePlacement` qayta yig'ilgan to'rni tasdiqlaydi", () => {
  const res = placeWords(SAMPLE, { seed: "butunlik" });
  const words = res.placed.map((w) => ({ cells: w.answer, answer: wordText(w.answer) }));
  const entries = res.placed.map((w, i) => ({ wi: i, row: w.row, col: w.col, dir: w.dir }));
  const size = Math.max(res.grid.rows, res.grid.cols);
  assert.ok(validatePlacement(size, words, entries), "chiqarilgan to'r o'z qoidalaridan o'tmadi");
  // Bitta so'zni bir katak surib yuborsak — buziladi (qoidalar haqiqatan ishlayapti).
  const broken = entries.map((e, i) => (i === entries.length - 1 ? { ...e, row: e.row + 1 } : e));
  assert.ok(!validatePlacement(size, words, broken), "surilgan so'z ham «to'g'ri» deb topildi");
});

test("apostrofli so'z to'rda bitta katak egallaydi va kesishishi mumkin", () => {
  const res = placeWords(SAMPLE, { seed: "apostrof" });
  const oz = res.placed.find((w) => w.answer[0] === `O${OKINA}`);
  if (oz) {
    assert.equal(oz.answer.length, 7, "OʻSIMLIK 7 katak");
    assert.deepEqual(cellsOfWord(res.grid, oz), [`O${OKINA}`, "S", "I", "M", "L", "I", "K"]);
  }
  // Kesishma ham apostrofli katak orqali bo'lishi mumkin.
  const pair = placeWords(
    [
      { answer: "o'simlik", clue: "Fotosintez qiluvchi organizm" },
      { answer: "o'zbek", clue: "Xalq nomi" },
    ],
    { seed: "juft" },
  );
  assert.equal(pair.placed.length, 2, "ikkala apostrofli so'z joylashishi kerak");
  assert.ok(pair.crossings >= 1);
});

/* ────────────────────────── 4. determinizm ────────────────────────── */

test("determinizm: bir xil urug' — bayt-bayt bir xil to'r", () => {
  const a = placeWords(SAMPLE, { seed: "bir-xil" });
  const b = placeWords(SAMPLE, { seed: "bir-xil" });
  // MUTATSIYA-4: `Math.random` bilan bu tenglik buzilardi.
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a.grid), JSON.stringify(b.grid));
});

test("urug' natijaga TA'SIR qiladi (aks holda restartlar foydasiz)", () => {
  const seeds = ["a", "b", "c", "d", "e"].map((s) => JSON.stringify(placeWords(SAMPLE, { seed: s }).grid));
  assert.ok(new Set(seeds).size > 1, "hamma urug'da bir xil to'r chiqdi");
});

/* ────────────────────────── 5. raqamlash ────────────────────────── */

test("raqamlash chapdan-o'ngga, yuqoridan-pastga va uzluksiz", () => {
  const res = placeWords(SAMPLE, { seed: "raqam" });
  const starts = res.placed.map((w) => ({ n: w.number, r: w.row, c: w.col }));
  for (const s of starts) assert.ok(s.n >= 1, "raqamsiz so'z qoldi");
  const uniq = [...new Map(starts.map((s) => [`${s.r}:${s.c}`, s])).values()].sort((a, b) => a.n - b.n);
  // Raqamlar 1…N, bo'shliqsiz.
  uniq.forEach((s, i) => assert.equal(s.n, i + 1, `${i + 1}-raqam o'rnida ${s.n}`));
  // Tartib: qator, keyin ustun.
  for (let i = 1; i < uniq.length; i++) {
    const prev = uniq[i - 1];
    const cur = uniq[i];
    assert.ok(cur.r > prev.r || (cur.r === prev.r && cur.c > prev.c), `${cur.n}-raqam ${prev.n} dan oldin turibdi`);
  }
});

test("bitta katakdan boshlanadigan gorizontal va vertikal so'z BITTA raqam oladi", () => {
  const res = placeWords(SAMPLE, { seed: "juft-raqam" });
  const byCell = new Map<string, PlacedWord[]>();
  for (const w of res.placed) {
    const k = `${w.row}:${w.col}`;
    byCell.set(k, [...(byCell.get(k) ?? []), w]);
  }
  for (const [k, ws] of byCell) {
    if (ws.length < 2) continue;
    assert.equal(new Set(ws.map((w) => w.number)).size, 1, `${k} katagida raqamlar farq qildi`);
    assert.equal(new Set(ws.map((w) => w.dir)).size, ws.length, "bir katakda bir yo'nalishdan ikkita so'z");
  }
});

test("cluesOf: gorizontal/vertikal ro'yxatlar raqam bo'yicha saralangan", () => {
  const res = placeWords(SAMPLE, { seed: "clues" });
  const { across, down } = cluesOf(res.placed);
  assert.equal(across.length + down.length, res.placed.length);
  for (const list of [across, down]) {
    for (let i = 1; i < list.length; i++) assert.ok(list[i].number > list[i - 1].number, "raqamlar tartibi buzildi");
  }
  // R0 `CrosswordClue`: raqam, matn, so'z id si va KATAK soni.
  const byId = new Map(res.placed.map((w) => [w.id, w]));
  for (const c of [...across, ...down]) {
    const w = byId.get(c.wordId);
    assert.ok(w, `«${c.wordId}» so'zi topilmadi`);
    assert.equal(c.text, w!.clue, "ta'rif matni mos emas");
    assert.equal(c.length, w!.answer.length, "katak soni mos emas");
    assert.ok(c.text.length > 0, "ta'rifsiz band qoldi");
  }
  assert.deepEqual(across.map((c) => byId.get(c.wordId)!.dir), across.map(() => "across"));
  assert.deepEqual(down.map((c) => byId.get(c.wordId)!.dir), down.map(() => "down"));
});

/* ────────────────────────── 6. tashlangan so'zlar ────────────────────────── */

test("qisqa, uzun, dublikat va yaroqsiz belgili so'zlar sababi bilan tashlanadi", () => {
  const res = placeWords(
    [
      { answer: "atom", clue: "Zarra" },
      { answer: "uy", clue: "Qisqa — 2 katak" },
      { answer: "elektrogeneratorlashtirish", clue: "Juda uzun" },
      { answer: "ATOM", clue: "Dublikat (registr farq qilmaydi)" },
      { answer: "ona tili", clue: "Ikki so'z" },
      { answer: "molekula", clue: "Atomlardan tuzilgan zarracha" },
    ],
    { seed: "drop" },
  );
  const why = (a: string) => res.dropped.find((d) => wordText(d.answer) === a)?.reason;
  assert.equal(why("UY"), "too-short");
  assert.equal(why("ELEKTROGENERATORLASHTIRISH"), "too-long");
  assert.equal(why("ATOM"), "duplicate");
  // Yaroqsiz javobning kataklari XOM holda saqlanadi (hisobotda o'qituvchi
  // nima yuborilganini ko'rishi kerak) — shu sababli bo'shliq ham qoladi.
  assert.equal(why("ONA TILI"), "bad-letter", "bo'shliqli javob — harf emas");
  assert.ok(res.placed.some((w) => wordText(w.answer) === "ATOM"));
  assert.ok(res.placed.some((w) => wordText(w.answer) === "MOLEKULA"));
});

test("kesishmaydigan so'z to'rga KIRMAYDI (`no-fit`), lekin yo'qolmaydi", () => {
  const res = placeWords(
    [
      { answer: "atom", clue: "Zarra" },
      { answer: "modda", clue: "Atomlardan iborat" },
      { answer: "qwxz", clue: "Hech bir harfi mos kelmaydigan so'z" },
    ],
    { seed: "nofit" },
  );
  const bad = res.dropped.find((d) => wordText(d.answer) === "QWXZ");
  assert.ok(bad, "kesishmaydigan so'z dropped da yo'q");
  assert.equal(bad!.reason, "no-fit");
  assert.ok(bad!.clue.length > 0, "ta'rif saqlanmadi");
  assert.ok(!res.placed.some((w) => wordText(w.answer) === "QWXZ"));
});

test("bo'sh kirish va bitta so'z — yiqilmaydi", () => {
  const none = placeWords([], { seed: "bosh" });
  assert.deepEqual(none, { grid: { rows: 0, cols: 0, cells: [] }, placed: [], dropped: [], crossings: 0 });
  const one = placeWords([{ answer: "atom", clue: "Zarra" }], { seed: "bitta" });
  assert.equal(one.placed.length, 1);
  assert.equal(one.crossings, 0);
  assert.equal(one.placed[0].number, 1);
  assert.equal(one.placed[0].dir, "across");
});

test("id barqaror: berilgan `id` saqlanadi, berilmasa tartib raqamidan", () => {
  const res = placeWords(
    [
      { id: "q1", answer: "atom", clue: "Zarra" },
      { answer: "modda", clue: "Atomlardan iborat" },
    ],
    { seed: "id" },
  );
  const ids = res.placed.map((w) => w.id);
  assert.ok(ids.includes("q1"), "berilgan id yo'qoldi");
  assert.equal(new Set(ids).size, ids.length, "id lar takrorlandi");
});
