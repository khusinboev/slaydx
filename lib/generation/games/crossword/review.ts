/**
 * KROSSVORD TAYYORLIK HISOBOTI (AUDIT-21 WP-A) — QOIDALAR QATLAMI.
 *
 * `teacher/test/review.ts` naqshi, ikki qatlam:
 *   1. QOIDALAR — deterministik bandlar (`docs/research/crossword.md`
 *      §4.1). Ular HUJJATDAN qayta hisoblanadi, chunki hisobot tahrirdan
 *      keyin ham chaqiriladi — o'shanda dvigatel yo'q. Dvigateldan faqat
 *      qayta tiklab BO'LMAYDIGAN narsa olinadi (`ask`: nechta so'z
 *      so'ralgan, qanday to'r o'lchami buyurtma qilingan, javob varag'i
 *      hujjatga qo'shilganmi).
 *   2. BAHOLOVCHI — `judge` roli, 5 mezon (clueClarity, wordGrade,
 *      gridConnectedness, answerAccuracy, originality). Mezonlar
 *      SPETSIFIKATSIYASI R0 ning `games/registry.ts` ida, shuning uchun
 *      baholovchi o'ramı (`reviewCrossword(doc)`) R0 substrati kelganda
 *      shu faylga qo'shiladi — ikkinchi nusxa yozilmaydi.
 *
 * Eng qimmat nuqson — TA'RIF JAVOBNI O'Z ICHIGA OLISHI («Biologiya —
 * bu qanday fan?» = BIOLOGIYA): krossvord bir zumda yechiladi. Uni
 * qoida bilan ANIQ tutish mumkin (o'zak solishtiruvi), shuning uchun
 * baholovchiga qoldirilmaydi.
 *
 * Qoidalar SOF funksiya: kirish — joylashgan so'zlar + to'r + `ask`,
 * chiqish — `ReviewCheck[]`. Tasodif/sana YO'Q (determinizm).
 */
import { check, rewrite } from "../../report/score";
import type { ReviewCheck } from "../../report/types";
import {
  cellLength,
  isConnected,
  letters,
  normalizeAnswer,
  type CrosswordGridData,
  type DroppedWord,
  type PlacedWord,
} from "./grid";
import { CROSSWORD_LIMITS } from "./input";

/**
 * Qoida id lari (§4.1 jadvali + to'r butunligi).
 *
 * R0 ning `GAME_RULE_IDS.crossword` i kelganda SHU RO'YXAT undan
 * olinadi (bitta manba); hozircha tartib — hisobot panelidagi tartib.
 */
export const CROSSWORD_RULE_IDS = [
  "wordCount",
  "gridSize",
  "minCrossings",
  "wordLength",
  "clueLength",
  "uniqueWords",
  "clueNotContainsAnswer",
  "gridMatchesWords",
  "gridConnected",
  "answerSheet",
] as const;
export type CrosswordRuleId = (typeof CROSSWORD_RULE_IDS)[number];

/** Kesishmalar soni shundan kam bo'lmasin: so'z soni × shu ulush (§4.1). */
export const MIN_CROSSING_RATIO = 0.5;
/** To'rning eng kichik mazmunli tomoni. */
export const MIN_GRID_SIDE = 5;

/** Dvigateldan keladigan, hujjatdan QAYTA TIKLAB BO'LMAYDIGAN ma'lumot. */
export type CrosswordReviewAsk = {
  /** Foydalanuvchi so'ragan so'z soni. */
  wordCount?: number;
  /** Buyurtma qilingan to'r o'lchami (eng katta tomon). */
  gridSize?: number;
  /** Javoblar bo'limi hujjatga qo'shilganmi. */
  hasAnswers?: boolean;
  /** To'rga sig'magan/tashlangan so'zlar. */
  dropped?: readonly DroppedWord[];
};

const list = (xs: string[], max = 5) => (xs.length > max ? `${xs.slice(0, max).join(", ")} … (+${xs.length - max})` : xs.join(", "));

/* ────────────────────────── ta'rif ↔ javob ────────────────────────── */

/** Solishtirish uchun: apostrof normallashadi, kichik harf, faqat harf/raqam. */
function foldText(s: string): string {
  return normalizeAnswer(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\sʻ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Ta'rif javobni (yoki uning o'zagini) o'z ichiga oladimi?
 *
 * O'zbek tili agglutinativ: «hujayralarning» ham «hujayra» ni oshkor
 * qiladi, shuning uchun to'liq so'z emas, O'ZAK qidiriladi — javobning
 * birinchi ⌈0,6×uzunlik⌉ (kamida 4) harfi.
 */
export function clueContainsAnswer(clue: string, answer: string): boolean {
  const a = foldText(answer).replace(/\s+/g, "");
  const c = foldText(clue);
  if (!a || !c) return false;
  if (c.includes(a)) return true;
  const chars = [...a];
  const rootLen = Math.max(4, Math.ceil(chars.length * 0.6));
  if (chars.length <= 4 || rootLen >= chars.length) return false;
  return c.includes(chars.slice(0, rootLen).join(""));
}

/* ────────────────────────── qoidalar ────────────────────────── */

/**
 * O'nta band — hammasi SOF funksiya, testda bitta-bitta qo'zg'atiladi
 * (`tests/crossword-review.test.mts`).
 */
export function crosswordRuleChecks(words: readonly PlacedWord[], grid: CrosswordGridData, ask: CrosswordReviewAsk = {}): ReviewCheck[] {
  const out: ReviewCheck[] = [];
  const dropped = ask.dropped ?? [];

  /* 1. wordCount — va'da qilingancha so'z to'rga tushdimi. */
  const want = Math.max(1, Math.round(ask.wordCount ?? words.length));
  const share = want ? words.length / want : 1;
  out.push(
    check(
      "wordCount",
      words.length === want ? "green" : share >= 0.8 ? "yellow" : "red",
      "So'zlar soni",
      `${words.length} / ${want} so'z to'rga tushdi${dropped.length ? `; ${dropped.length} so'z tashlandi` : ""}`,
      words.length < want ? rewrite("grid", "To'rga sig'maydigan so'zlar o'rniga qisqaroq (3–6 harfli) so'zlar tanlang.") : undefined,
    ),
  );

  /* 2. gridSize — to'r buyurtma o'lchamiga va 21×21 chegarasiga sig'adimi. */
  const maxSide = Math.max(grid.rows, grid.cols);
  const limit = Math.min(21, Math.round(ask.gridSize ?? 21));
  out.push(
    check(
      "gridSize",
      maxSide <= limit && maxSide >= MIN_GRID_SIDE ? "green" : maxSide <= 21 ? "yellow" : "red",
      "To'r o'lchami",
      // To'r RAMKA bo'yicha kesiladi (§3), shuning uchun u buyurtma
      // o'lchamidan kichik bo'lishi NORMAL — kattasi nuqson.
      `${grid.rows}×${grid.cols} (buyurtma ≤ ${limit})`,
      maxSide > limit ? rewrite("grid", "To'r buyurtma o'lchamidan katta chiqdi — uzun so'zlar sonini kamaytiring.") : undefined,
    ),
  );

  /* 3. minCrossings — o'zaro bog'lanish yetarlimi. */
  const crossings = countGridCrossings(words);
  const need = Math.ceil(words.length * MIN_CROSSING_RATIO);
  out.push(
    check(
      "minCrossings",
      crossings >= need ? "green" : crossings >= Math.ceil(need / 2) ? "yellow" : "red",
      "Kesishmalar",
      `${crossings} ta kesishma (kamida ${need} kerak)`,
      crossings < need ? rewrite("grid", "So'zlarni ko'proq kesishadigan qilib tanlang: umumiy harflari ko'p so'zlar qo'shing.") : undefined,
    ),
  );

  /* 4. wordLength — har javob 3–15 katak. */
  const badLen = words.filter((w) => {
    const n = cellLength(w.answer);
    return n < CROSSWORD_LIMITS.answerMin || n > CROSSWORD_LIMITS.answerMax;
  });
  out.push(
    check(
      "wordLength",
      badLen.length === 0 ? "green" : badLen.length <= 1 ? "yellow" : "red",
      "So'z uzunligi",
      badLen.length ? `chegaradan tashqari: ${list(badLen.map((w) => `${w.answer} (${cellLength(w.answer)})`))}` : `hammasi ${CROSSWORD_LIMITS.answerMin}–${CROSSWORD_LIMITS.answerMax} katak`,
      badLen.length ? rewrite("grid", `Har javob ${CROSSWORD_LIMITS.answerMin}–${CROSSWORD_LIMITS.answerMax} harfli bitta so'z bo'lsin.`) : undefined,
    ),
  );

  /* 5. clueLength — ta'rif 10–150 belgi. */
  const badClue = words.filter((w) => w.clue.trim().length < CROSSWORD_LIMITS.clueMin || w.clue.trim().length > CROSSWORD_LIMITS.clueMax);
  out.push(
    check(
      "clueLength",
      badClue.length === 0 ? "green" : badClue.length / Math.max(1, words.length) <= 0.2 ? "yellow" : "red",
      "Ta'rif uzunligi",
      badClue.length ? `${badClue.length} ta'rif ${CROSSWORD_LIMITS.clueMin}–${CROSSWORD_LIMITS.clueMax} belgi oralig'ida emas: ${list(badClue.map((w) => w.answer))}` : "hammasi o'lchamda",
      badClue.length
        ? rewrite("clues", `Juda qisqa yoki juda uzun ta'riflarni qayta yozing (${CROSSWORD_LIMITS.clueMin}–${CROSSWORD_LIMITS.clueMax} belgi).`)
        : undefined,
    ),
  );

  /* 6. uniqueWords — dublikat javob yo'q. */
  const seen = new Map<string, number>();
  for (const w of words) {
    const k = normalizeAnswer(w.answer);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  out.push(
    check(
      "uniqueWords",
      dupes.length === 0 ? "green" : "red",
      "Takrorlanmas so'zlar",
      dupes.length ? `takrorlangan: ${list(dupes)}` : "dublikat yo'q",
      dupes.length ? rewrite("clues", "Takrorlangan javoblarni boshqa atamalar bilan almashtiring.") : undefined,
    ),
  );

  /* 7. clueNotContainsAnswer — ta'rifda javobning o'zi/o'zagi yo'q. */
  const leaky = words.filter((w) => clueContainsAnswer(w.clue, w.answer));
  out.push(
    check(
      "clueNotContainsAnswer",
      leaky.length === 0 ? "green" : "red",
      "Ta'rif javobni oshkor qilmaydi",
      leaky.length ? `javob ta'rifda ko'rinib turibdi: ${list(leaky.map((w) => w.answer))}` : "hech bir ta'rifda javob yo'q",
      leaky.length
        ? rewrite("clues", "Ta'rifda javobning o'zini yoki o'zagini ishlatmang — tushunchani boshqa so'zlar bilan tavsiflang.")
        : undefined,
    ),
  );

  /* 8. gridMatchesWords — to'rdagi harflar so'zlarga mos. */
  const mismatched = words.filter((w) => !wordFitsGrid(w, grid));
  out.push(
    check(
      "gridMatchesWords",
      mismatched.length === 0 ? "green" : "red",
      "To'r so'zlarga mos",
      mismatched.length ? `to'rda mos kelmagan: ${list(mismatched.map((w) => w.answer))}` : `${words.length} so'zning harflari to'rda o'z joyida`,
      mismatched.length ? rewrite("grid", "To'rni qayta quring — so'z harflari kataklarga mos tushmagan.") : undefined,
    ),
  );

  /* 9. gridConnected — barcha harflar bitta bo'lakda. */
  const connected = gridConnected(grid);
  out.push(
    check(
      "gridConnected",
      connected ? "green" : "red",
      "To'r bog'langan",
      connected ? "barcha so'zlar bir-biriga ulangan" : "to'r ikkiga bo'linib qolgan (ajralgan so'zlar bor)",
      connected ? undefined : rewrite("grid", "Ajralib qolgan so'zlarni boshqa so'zlar bilan kesishadigan qilib almashtiring."),
    ),
  );

  /* 10. answerSheet — javoblar varag'i hujjatda bormi. */
  const hasAnswers = ask.hasAnswers !== false;
  out.push(
    check(
      "answerSheet",
      hasAnswers ? "green" : "red",
      "Javoblar varag'i",
      hasAnswers ? "javoblar alohida betda berilgan" : "javoblar bo'limi topilmadi",
      hasAnswers ? undefined : rewrite("answers", "Javoblar varag'ini alohida betdan qo'shing."),
    ),
  );

  return out;
}

/* ────────────────────────── yordamchilar ────────────────────────── */

/** So'zning harflari to'rda o'z joyidami. */
export function wordFitsGrid(w: PlacedWord, grid: CrosswordGridData): boolean {
  const cells = letters(w.answer);
  for (let i = 0; i < cells.length; i++) {
    const r = w.dir === "across" ? w.row : w.row + i;
    const c = w.dir === "across" ? w.col + i : w.col;
    if (r < 0 || c < 0 || r >= grid.rows || c >= grid.cols) return false;
    if (grid.cells[r]?.[c] !== cells[i]) return false;
  }
  return true;
}

/** Ikki yo'nalishdagi so'z umumiy katakni bo'lishsa — kesishma. */
export function countGridCrossings(words: readonly PlacedWord[]): number {
  const owners = new Map<string, Set<string>>();
  for (const w of words) {
    const n = cellLength(w.answer);
    for (let i = 0; i < n; i++) {
      const r = w.dir === "across" ? w.row : w.row + i;
      const c = w.dir === "across" ? w.col + i : w.col;
      const k = `${r}:${c}`;
      const set = owners.get(k);
      if (set) set.add(w.dir);
      else owners.set(k, new Set([w.dir]));
    }
  }
  let n = 0;
  for (const dirs of owners.values()) if (dirs.size > 1) n++;
  return n;
}

/** To'rning harfli kataklari bitta bog'langan bo'lakmi. */
export function gridConnected(grid: CrosswordGridData): boolean {
  if (!grid.rows || !grid.cols) return true;
  const size = Math.max(grid.rows, grid.cols);
  const board = {
    size,
    cell: new Array<string>(size * size).fill(""),
    across: new Int16Array(size * size).fill(-1),
    down: new Int16Array(size * size).fill(-1),
  };
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const ch = grid.cells[r]?.[c];
      if (ch) board.cell[r * size + c] = ch;
    }
  }
  return isConnected(board);
}
