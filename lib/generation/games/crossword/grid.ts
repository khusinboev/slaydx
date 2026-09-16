/**
 * KROSSVORD TO'RI (AUDIT-21 WP-A) — SOF ALGORITM, LLM ARALASHMAYDI.
 *
 * Model faqat SO'Z + TA'RIF beradi (`prompts.ts`); qayerga qo'yish, qaysi
 * yo'nalishda va qanday raqamlash — shu faylning ishi. Nega: modelga to'r
 * chizdirish (koordinata qaytartirish) kesishmasi mos kelmaydigan to'r
 * beradi, tekshirish esa baribir shu yerdagi qoidalar bilan qilinadi.
 * Demak to'rni O'ZIMIZ quramiz — natija deterministik va har doim to'g'ri.
 *
 * ALGORITM (`docs/research/crossword.md` §3): greedy + backtracking.
 *   1. So'zlar normalizatsiya qilinadi (apostrof, katta harf, dublikat,
 *      uzunlik) va KATAKLARGA bo'linadi (`letters`);
 *   2. eng uzun so'z markazga gorizontal qo'yiladi;
 *   3. har keyingi so'z uchun BARCHA kesishma nomzodlari sanaladi
 *      (harf × shu harfli band katak × perpendikulyar yo'nalish),
 *      eng yaxshisi tanlanadi (ko'proq kesishma → ixchamroq ramka);
 *   4. sig'magan so'z NAVBATGA qaytadi va keyingi «sweep» da qayta
 *      uriniladi (yangi harflar yangi kesishma ochadi) — birinchi
 *      backtracking qatlami;
 *   5. hamon sig'masa — `repairSweep`: BITTA joylashgan so'z olib
 *      tashlanadi, yangisi qo'yiladi, eskisi qayta joylanadi; natija
 *      to'liq tekshiriladi (`validatePlacement`), buzilsa qaytariladi —
 *      ikkinchi (chuqurlik 1) backtracking qatlami;
 *   6. butun jarayon `attempts` marta HAR XIL tartib bilan takrorlanadi
 *      (seeded permutatsiya), eng yaxshi natija tanlanadi — uchinchi
 *      qatlam (restart backtracking). To'liq DFS ATAYLAB olinmadi: 20
 *      so'zda u eksponensial, restart esa 20 so'zning odatda hammasini
 *      joylaydi (`tests/crossword-grid.test.mts`).
 *
 * TO'R QOIDALARI (o'sha §3 + CommuniCrossings):
 *   — har so'z kamida BITTA harfda kesishadi (birinchisidan tashqari);
 *   — bir yo'nalishdagi so'zlar ustma-ust tushmaydi;
 *   — so'z boshidan oldingi va oxiridan keyingi katak BO'SH (aks holda
 *     ikki so'z bitta uzun so'zga qo'shilib ketadi);
 *   — kesishmaydigan katakning perpendikulyar qo'shnilari BO'SH (parallel
 *     yonma-yon yotgan ikki so'z taqiqlanadi — u «so'z» bo'lmagan ikki
 *     harfli tasodifiy ustunlar hosil qiladi);
 *   — 180° simmetriya SHART EMAS (maktab krossvordi, §1 topilmasi).
 *
 * O'ZBEK LOTIN HARFLARI (egasining qarori, §6 4-savolga javob):
 *   — `oʻ` va `gʻ` — BITTA katak (`o'`, `o‘`, `o’` → `oʻ` normalizatsiya);
 *   — `sh`, `ch`, `ng` — IKKI katak (hisobotdagi tavsiya);
 *   — tutuq belgisi (`sanʼat`) harf emas — katak olmaydi, tashlanadi.
 *
 * DETERMINIZM: `Math.random`/`Date` YO'Q — barcha tasodif `seed` dan
 * (mulberry32). Bir xil kirish + bir xil `seed` = bayt-bayt bir xil to'r.
 * Izomorf: server/DOM/LLM importi yo'q.
 */

/* ────────────────────────── shartnoma ────────────────────────── */

import {
  GAME_LIMITS,
  normalizeGridSize,
  type CrosswordClue,
  type CrosswordDir,
  type CrosswordDropped,
  type CrosswordGrid,
  type CrosswordWord,
} from "../types";

export type { CrosswordClue, CrosswordDir, CrosswordDropped, CrosswordGrid, CrosswordWord };

/** Modeldan keladigan xom band (javob — SATR, katakka bo'lish shu yerda). */
export type WordInput = { answer: string; clue: string; id?: string };

/**
 * To'rga tushgan so'z — R0 shartnomasidagi `CrosswordWord` NING O'ZI
 * (`games/types.ts`): `answer` KATAK harflari ro'yxati, ya'ni `OʻSIMLIK`
 * → `["Oʻ","S","I","M","L","I","K"]`. Adapter qatlami ATAYLAB yo'q —
 * ikkinchi shakl bo'lsa maket, hisobot va ko'ruvchi ertami-kechmi
 * boshqa-boshqa kataklarni ko'rardi.
 */
export type PlacedWord = CrosswordWord;

export type DropReason = CrosswordDropped["reason"];
export type DroppedWord = CrosswordDropped;

/** Kesilgan to'r (R0 `CrosswordGrid`): `cells[row][col]` — harf yoki `null`. */
export type CrosswordGridData = CrosswordGrid;

export type PlaceResult = {
  grid: CrosswordGridData;
  placed: PlacedWord[];
  dropped: DroppedWord[];
  /** Kesishgan kataklar soni (har kesishma bir marta). */
  crossings: number;
};

export type PlaceOpts = {
  /** To'rning eng katta tomoni (§3: 21×21). */
  maxSize?: number;
  /** Determinizm urug'i. */
  seed?: string;
  /** Eng qisqa so'z (katakda). */
  minLength?: number;
  /** Eng uzun so'z (katakda). */
  maxLength?: number;
  /** Nechta har xil tartib sinaladi (restart backtracking). */
  attempts?: number;
};

/** Chegaralar — R0 `GAME_LIMITS` dan (ikkinchi nusxa yozilmaydi). */
export const GRID_DEFAULTS = {
  maxSize: GAME_LIMITS.gridMax,
  minLength: GAME_LIMITS.wordLettersMin,
  maxLength: GAME_LIMITS.wordLettersMax,
  attempts: 16,
  /** Bitta so'z uchun ko'rib chiqiladigan eng ko'p nomzod. */
  candidateCap: 400,
  /** «Sweep» (navbatga qaytgan so'zlarni qayta urinish) soni. */
  sweeps: 4,
} as const;

/* ────────────────────────── harflar ────────────────────────── */

/** `oʻ`/`gʻ` uchun MODIFIER LETTER TURNED COMMA (U+02BB). */
export const OKINA = "ʻ";

/** Apostrof sifatida uchraydigan hamma belgi (kirish har xil klaviaturadan keladi). */
const APOSTROPHES = new Set(["ʻ", "ʼ", "‘", "’", "‛", "'", "`", "´", "′"]);

/**
 * Apostroflarni tartibga soladi: `o`/`g` dan keyingisi `oʻ`/`gʻ` ga
 * aylanadi, qolgani (tutuq belgisi — `sanʼat`, `maʼno`) TASHLANADI.
 * Tutuq belgisi alifbo HARFI emas, shuning uchun katak olmaydi.
 */
export function normalizeApostrophes(raw: string): string {
  let out = "";
  for (const ch of raw) {
    if (!APOSTROPHES.has(ch)) {
      out += ch;
      continue;
    }
    const prev = out.at(-1);
    if (prev === "o" || prev === "O" || prev === "g" || prev === "G") out += OKINA;
  }
  return out;
}

/** Xom javob → to'rga tushadigan shakl (KATTA harf). */
export function normalizeAnswer(raw: string): string {
  return normalizeApostrophes(String(raw ?? "").trim())
    .replace(/\s+/g, " ")
    .toUpperCase();
}

/** Faqat harf/raqam (va `ʻ`) — bo'shliq, tire, tinish belgisi yo'q. */
const WORD_RE = new RegExp(`^[\\p{L}\\p{N}${OKINA}]+$`, "u");

export function isPlaceable(answer: string): boolean {
  return WORD_RE.test(answer);
}

/**
 * So'zni KATAKLARGA bo'ladi. `Oʻ`/`Gʻ` bitta katak, qolgan hamma harf
 * (shu jumladan `SH`, `CH`, `NG` juftliklari) alohida katak.
 */
export function letters(answer: string): string[] {
  const chars = [...answer];
  const out: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if ((ch === "O" || ch === "G" || ch === "o" || ch === "g") && chars[i + 1] === OKINA) {
      out.push(ch + OKINA);
      i++;
      continue;
    }
    if (ch === OKINA) continue; // yakka apostrof — katak emas
    out.push(ch);
  }
  return out;
}

/** So'zning KATAKDAGI uzunligi (`OʻZBEK` = 5, `SHAKAR` = 6). */
export const cellLength = (answer: string): number => letters(answer).length;

/**
 * Kataklar ro'yxati → o'qiladigan satr (`["Oʻ","S"]` → `OʻS`).
 *
 * Model kataklarni saqlaydi (R0 qarori), lekin prompt («takrorlanmasin»
 * ro'yxati), hisobot (ta'rif javobni oshkor qilyaptimi) va javob varag'i
 * SATR bilan ishlaydi — shu yagona joyda aylantiriladi.
 */
export const wordText = (cells: readonly string[]): string => cells.join("");

/** So'zning katak soni (R0 `CrosswordWord`). */
export const wordLength = (w: { answer: readonly string[] }): number => w.answer.length;

/* ────────────────────────── tasodif ────────────────────────── */

function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — kichik, tez va TAKRORLANADIGAN. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ────────────────────────── taxta ────────────────────────── */

export type Entry = { wi: number; row: number; col: number; dir: CrosswordDir };

export type Board = {
  size: number;
  /** `""` — bo'sh katak. */
  cell: string[];
  /** Shu katakni band qilgan gorizontal so'z indeksi (`-1` — yo'q). */
  across: Int16Array;
  down: Int16Array;
};

const newBoard = (size: number): Board => ({
  size,
  cell: new Array<string>(size * size).fill(""),
  across: new Int16Array(size * size).fill(-1),
  down: new Int16Array(size * size).fill(-1),
});

const inside = (b: Board, r: number, c: number): boolean => r >= 0 && c >= 0 && r < b.size && c < b.size;
const at = (b: Board, r: number, c: number): string => (inside(b, r, c) ? b.cell[r * b.size + c] : "");

/**
 * Joylashtirish mumkinmi? Kesishmalar soni yoki `null` (mumkin emas).
 *
 * BARCHA to'r qoidasi shu funksiyada bir joyda turadi — testlar ham,
 * `validatePlacement` ham shunga tayanadi.
 */
export function canPlace(b: Board, cells: readonly string[], row: number, col: number, dir: CrosswordDir): number | null {
  const dr = dir === "down" ? 1 : 0;
  const dc = dir === "across" ? 1 : 0;
  const len = cells.length;
  if (!len) return null;
  const endR = row + dr * (len - 1);
  const endC = col + dc * (len - 1);
  if (row < 0 || col < 0 || endR >= b.size || endC >= b.size) return null;

  // So'z boshidan oldin va oxiridan keyin BO'SH bo'lsin.
  if (at(b, row - dr, col - dc) !== "") return null;
  if (at(b, endR + dr, endC + dc) !== "") return null;

  // Perpendikulyar yo'nalish (qo'shnilik tekshiruvi uchun).
  const pr = dir === "across" ? 1 : 0;
  const pc = dir === "across" ? 0 : 1;

  let crossings = 0;
  for (let i = 0; i < len; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    const cur = b.cell[r * b.size + c];
    if (cur !== "") {
      if (cur !== cells[i]) return null;
      // Bir yo'nalishda ustma-ust yotish — taqiq (kesishma emas).
      const owner = dir === "across" ? b.across[r * b.size + c] : b.down[r * b.size + c];
      if (owner >= 0) return null;
      crossings++;
      continue;
    }
    // Kesishmaydigan katakning yon qo'shnilari bo'sh (parallel yonma-yon taqiq).
    if (at(b, r - pr, c - pc) !== "") return null;
    if (at(b, r + pr, c + pc) !== "") return null;
  }
  return crossings;
}

function put(b: Board, cells: readonly string[], e: Entry): void {
  const dr = e.dir === "down" ? 1 : 0;
  const dc = e.dir === "across" ? 1 : 0;
  for (let i = 0; i < cells.length; i++) {
    const k = (e.row + dr * i) * b.size + (e.col + dc * i);
    b.cell[k] = cells[i];
    if (e.dir === "across") b.across[k] = e.wi;
    else b.down[k] = e.wi;
  }
}

/* ────────────────────────── ramka ────────────────────────── */

type Box = { r0: number; c0: number; r1: number; c1: number };

const EMPTY_BOX: Box = { r0: Number.POSITIVE_INFINITY, c0: Number.POSITIVE_INFINITY, r1: -1, c1: -1 };

function growBox(box: Box, row: number, col: number, len: number, dir: CrosswordDir): Box {
  const endR = dir === "down" ? row + len - 1 : row;
  const endC = dir === "across" ? col + len - 1 : col;
  return { r0: Math.min(box.r0, row), c0: Math.min(box.c0, col), r1: Math.max(box.r1, endR), c1: Math.max(box.c1, endC) };
}

const boxRows = (b: Box): number => (b.r1 < 0 ? 0 : b.r1 - b.r0 + 1);
const boxCols = (b: Box): number => (b.c1 < 0 ? 0 : b.c1 - b.c0 + 1);

/* ────────────────────────── nomzodlar ────────────────────────── */

type Candidate = { row: number; col: number; dir: CrosswordDir; crossings: number; score: number };

/**
 * Nomzod bahosi: kesishma HAMMA narsadan muhim (×1000), keyin ixcham va
 * kvadratga yaqin ramka, oxirida urug'li «jitter» — teng nomzodlar har
 * urinishda har xil tanlanadi (restart backtracking shundan foyda oladi).
 */
function scoreOf(crossings: number, box: Box, jitter: number): number {
  const rows = boxRows(box);
  const cols = boxCols(box);
  return crossings * 1000 - rows * cols - Math.abs(rows - cols) * 3 + jitter;
}

function candidatesFor(b: Board, cells: readonly string[], box: Box, letterIndex: Map<string, number[]>, rand: () => number): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 0; i < cells.length && out.length < GRID_DEFAULTS.candidateCap; i++) {
    const spots = letterIndex.get(cells[i]);
    if (!spots) continue;
    for (const k of spots) {
      const r = Math.floor(k / b.size);
      const c = k % b.size;
      for (const dir of ["across", "down"] as const) {
        const row = dir === "across" ? r : r - i;
        const col = dir === "across" ? c - i : c;
        const crossings = canPlace(b, cells, row, col, dir);
        if (crossings === null || crossings < 1) continue;
        const nextBox = growBox(box, row, col, cells.length, dir);
        out.push({ row, col, dir, crossings, score: scoreOf(crossings, nextBox, rand()) });
      }
    }
  }
  return out;
}

const bestOf = (cands: readonly Candidate[]): Candidate | null => {
  let best: Candidate | null = null;
  for (const c of cands) if (!best || c.score > best.score) best = c;
  return best;
};

/* ────────────────────────── bitta urinish ────────────────────────── */

type Attempt = { entries: Entry[]; box: Box; placed: Set<number> };

export type WordCells = { cells: string[]; answer: string };

function rebuild(size: number, words: readonly WordCells[], entries: readonly Entry[]): { board: Board; box: Box; index: Map<string, number[]> } {
  const board = newBoard(size);
  let box = EMPTY_BOX;
  for (const e of entries) {
    const cells = words[e.wi].cells;
    put(board, cells, e);
    box = growBox(box, e.row, e.col, cells.length, e.dir);
  }
  const index = new Map<string, number[]>();
  for (let k = 0; k < board.cell.length; k++) {
    const ch = board.cell[k];
    if (!ch) continue;
    const list = index.get(ch);
    if (list) list.push(k);
    else index.set(ch, [k]);
  }
  return { board, box, index };
}

/** Kesishgan kataklar soni (across VA down egasi bor katak). */
export function countCrossings(size: number, words: readonly WordCells[], entries: readonly Entry[]): number {
  const board = newBoard(size);
  for (const e of entries) put(board, words[e.wi].cells, e);
  let n = 0;
  for (let k = 0; k < board.cell.length; k++) if (board.across[k] >= 0 && board.down[k] >= 0) n++;
  return n;
}

/**
 * Joylashuv TO'LIQ to'g'rimi: har so'z qoidalarga mos, har biri (yolg'iz
 * bo'lmasa) kesishadi va harflar BITTA bog'langan bo'lakda.
 *
 * `repairSweep` shu tekshiruvga tayanadi: so'zni olib tashlash boshqa
 * so'zni kesishmasiz qoldirishi mumkin, o'shanda o'zgarish bekor qilinadi.
 */
export function validatePlacement(size: number, words: readonly WordCells[], entries: readonly Entry[]): boolean {
  const board = newBoard(size);
  for (const e of entries) {
    const cells = words[e.wi].cells;
    // Bo'sh taxtaga qayta qo'yilganda qoidalarning hammasi qayta tekshiriladi.
    if (canPlace(board, cells, e.row, e.col, e.dir) === null) return false;
    put(board, cells, e);
  }
  if (entries.length <= 1) return true;
  for (const e of entries) {
    const cells = words[e.wi].cells;
    const dr = e.dir === "down" ? 1 : 0;
    const dc = e.dir === "across" ? 1 : 0;
    let cross = 0;
    for (let i = 0; i < cells.length; i++) {
      const k = (e.row + dr * i) * size + (e.col + dc * i);
      if (board.across[k] >= 0 && board.down[k] >= 0) cross++;
    }
    if (cross === 0) return false;
  }
  return isConnected(board);
}

/** Harfli kataklar BITTA bog'langan bo'lakmi (flood fill, 4 qo'shni). */
export function isConnected(b: Board): boolean {
  const start = b.cell.findIndex((c) => c !== "");
  if (start < 0) return true;
  const seen = new Uint8Array(b.cell.length);
  const stack = [start];
  seen[start] = 1;
  let count = 1;
  while (stack.length) {
    const k = stack.pop() as number;
    const r = Math.floor(k / b.size);
    const c = k % b.size;
    for (const [dr, dc] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= b.size || nc >= b.size) continue;
      const nk = nr * b.size + nc;
      if (seen[nk] || b.cell[nk] === "") continue;
      seen[nk] = 1;
      count++;
      stack.push(nk);
    }
  }
  let total = 0;
  for (const c of b.cell) if (c !== "") total++;
  return count === total;
}

/**
 * Bitta greedy yurish: `order` bo'yicha joylash, sig'magani navbatga
 * qaytadi (`sweeps`), oxirida `repairSweep` (chuqurlik 1 backtracking).
 */
function placeOnce(size: number, words: readonly WordCells[], order: readonly number[], seedNum: number): Attempt {
  const rand = rng(seedNum);
  const entries: Entry[] = [];
  let box = EMPTY_BOX;
  const board = newBoard(size);
  const index = new Map<string, number[]>();
  const placed = new Set<number>();

  const commit = (wi: number, row: number, col: number, dir: CrosswordDir) => {
    const cells = words[wi].cells;
    put(board, cells, { wi, row, col, dir });
    entries.push({ wi, row, col, dir });
    box = growBox(box, row, col, cells.length, dir);
    placed.add(wi);
    const dr = dir === "down" ? 1 : 0;
    const dc = dir === "across" ? 1 : 0;
    for (let i = 0; i < cells.length; i++) {
      const k = (row + dr * i) * size + (col + dc * i);
      const list = index.get(cells[i]);
      if (list) {
        if (!list.includes(k)) list.push(k);
      } else index.set(cells[i], [k]);
    }
  };

  let pending = [...order];
  for (let sweep = 0; sweep < GRID_DEFAULTS.sweeps && pending.length; sweep++) {
    const next: number[] = [];
    for (const wi of pending) {
      const cells = words[wi].cells;
      if (!entries.length) {
        // Birinchi so'z — markazda gorizontal.
        const row = Math.floor((size - 1) / 2);
        const col = Math.max(0, Math.floor((size - cells.length) / 2));
        if (canPlace(board, cells, row, col, "across") === null) {
          next.push(wi);
          continue;
        }
        commit(wi, row, col, "across");
        continue;
      }
      const best = bestOf(candidatesFor(board, cells, box, index, rand));
      if (!best) {
        next.push(wi);
        continue;
      }
      commit(wi, best.row, best.col, best.dir);
    }
    const stuck = next.length === pending.length;
    pending = next;
    if (stuck) break;
  }

  if (pending.length) return repairSweep(size, words, { entries, box, placed }, pending, rand);
  return { entries, box, placed };
}

/**
 * BACKTRACKING (chuqurlik 1): sig'magan so'z uchun joylashgan so'zlardan
 * BITTASI olib tashlanadi, yangisi qo'yiladi, eskisi qayta joylanadi.
 * Natija `validatePlacement` dan o'tmasa — o'zgarish bekor qilinadi.
 */
function repairSweep(size: number, words: readonly WordCells[], state: Attempt, pending: readonly number[], rand: () => number): Attempt {
  let cur = state;
  for (const wi of pending) {
    let done = false;
    for (let vi = 0; vi < cur.entries.length && !done; vi++) {
      const victim = cur.entries[vi];
      const kept = cur.entries.filter((_, i) => i !== vi);
      if (!kept.length) continue;
      const base = rebuild(size, words, kept);
      // 1. Yangi so'zni bo'shagan joyga qo'yish.
      const best = bestOf(candidatesFor(base.board, words[wi].cells, base.box, base.index, rand));
      if (!best) continue;
      const withNew: Entry[] = [...kept, { wi, row: best.row, col: best.col, dir: best.dir }];
      // 2. Qurbonni qayta joylash.
      const re = rebuild(size, words, withNew);
      const back = bestOf(candidatesFor(re.board, words[victim.wi].cells, re.box, re.index, rand));
      if (!back) continue;
      const finalEntries: Entry[] = [...withNew, { wi: victim.wi, row: back.row, col: back.col, dir: back.dir }];
      if (!validatePlacement(size, words, finalEntries)) continue;
      let nbox = EMPTY_BOX;
      for (const e of finalEntries) nbox = growBox(nbox, e.row, e.col, words[e.wi].cells.length, e.dir);
      cur = { entries: finalEntries, box: nbox, placed: new Set(finalEntries.map((e) => e.wi)) };
      done = true;
    }
  }
  return cur;
}

/* ────────────────────────── raqamlash va kesish ────────────────────────── */

/**
 * Kesilgan to'r + raqamlar. Raqamlash — chapdan o'ngga, yuqoridan
 * pastga: yangi so'z BOSHLANADIGAN har katak keyingi raqamni oladi
 * (gorizontal va vertikal bitta katakdan boshlansa — bitta raqam).
 */
export function finalize(size: number, words: readonly WordCells[], inputs: readonly WordInput[], entries: readonly Entry[]): Omit<PlaceResult, "dropped"> {
  if (!entries.length) return { grid: { rows: 0, cols: 0, cells: [] }, placed: [], crossings: 0 };
  let box = EMPTY_BOX;
  for (const e of entries) box = growBox(box, e.row, e.col, words[e.wi].cells.length, e.dir);
  const rows = boxRows(box);
  const cols = boxCols(box);
  const cells: (string | null)[][] = Array.from({ length: rows }, () => new Array<string | null>(cols).fill(null));
  for (const e of entries) {
    const dr = e.dir === "down" ? 1 : 0;
    const dc = e.dir === "across" ? 1 : 0;
    const list = words[e.wi].cells;
    for (let i = 0; i < list.length; i++) cells[e.row + dr * i - box.r0][e.col + dc * i - box.c0] = list[i];
  }

  const numberAt = new Map<string, number>();
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (cells[r][c] === null) continue;
      const startsAcross = (c === 0 || cells[r][c - 1] === null) && c + 1 < cols && cells[r][c + 1] !== null;
      const startsDown = (r === 0 || cells[r - 1][c] === null) && r + 1 < rows && cells[r + 1][c] !== null;
      if (startsAcross || startsDown) numberAt.set(`${r}:${c}`, ++n);
    }
  }

  const placed: PlacedWord[] = entries.map((e) => {
    const row = e.row - box.r0;
    const col = e.col - box.c0;
    const src = inputs[e.wi];
    return {
      id: src.id ?? `w${e.wi + 1}`,
      // R0 shartnomasi: javob — KATAK harflari ro'yxati.
      answer: [...words[e.wi].cells],
      clue: src.clue,
      dir: e.dir,
      row,
      col,
      number: numberAt.get(`${row}:${col}`) ?? 0,
    };
  });
  placed.sort((a, b) => a.number - b.number || (a.dir === b.dir ? 0 : a.dir === "across" ? -1 : 1));

  return { grid: { rows, cols, cells }, placed, crossings: countCrossings(size, words, entries) };
}

/* ────────────────────────── asosiy ────────────────────────── */

/** Uzunlik bo'yicha kamayuvchi tartib (teng uzunlikda — alifbo, deterministik). */
function baseOrder(words: readonly WordCells[]): number[] {
  return words
    .map((_, i) => i)
    .sort((a, b) => words[b].cells.length - words[a].cells.length || (words[a].answer < words[b].answer ? -1 : words[a].answer > words[b].answer ? 1 : a - b));
}

/** Seeded Fisher–Yates — birinchi so'z (eng uzuni) JOYIDA qoladi. */
function shuffled(order: readonly number[], rand: () => number): number[] {
  const out = [...order];
  for (let i = out.length - 1; i > 1; i--) {
    const j = 1 + Math.floor(rand() * i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * SO'ZLARNI TO'RGA JOYLASH — moduldagi asosiy kirish nuqtasi.
 *
 * Sig'magan so'z `dropped` ga tushadi (`reason: "nofit"`), qisqa/uzun/
 * dublikat/yaroqsiz belgili so'zlar esa to'rga UMUMAN kirmaydi.
 */
export function placeWords(words: readonly WordInput[], opts: PlaceOpts = {}): PlaceResult {
  const size = Math.max(5, Math.min(GRID_DEFAULTS.maxSize, Math.round(opts.maxSize ?? GRID_DEFAULTS.maxSize)));
  const minLength = Math.max(2, Math.round(opts.minLength ?? GRID_DEFAULTS.minLength));
  const maxLength = Math.min(size, Math.round(opts.maxLength ?? GRID_DEFAULTS.maxLength));
  const attempts = Math.max(1, Math.round(opts.attempts ?? GRID_DEFAULTS.attempts));
  const seedNum = hashSeed(String(opts.seed ?? "crossword"));

  /* ── 1. normalizatsiya va saralash ── */
  const dropped: DroppedWord[] = [];
  const kept: WordInput[] = [];
  const cellsOf: WordCells[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    const answer = normalizeAnswer(w.answer);
    const clue = String(w.clue ?? "").trim();
    const cells = letters(answer);
    if (!answer || !isPlaceable(answer)) {
      dropped.push({ answer: cells, clue, reason: "bad-letter" });
      continue;
    }
    if (seen.has(answer)) {
      dropped.push({ answer: cells, clue, reason: "duplicate" });
      continue;
    }
    if (cells.length < minLength) {
      dropped.push({ answer: cells, clue, reason: "too-short" });
      continue;
    }
    if (cells.length > maxLength) {
      dropped.push({ answer: cells, clue, reason: "too-long" });
      continue;
    }
    seen.add(answer);
    kept.push({ ...w, answer, clue });
    cellsOf.push({ cells, answer });
  }
  if (!kept.length) return { grid: { rows: 0, cols: 0, cells: [] }, placed: [], dropped, crossings: 0 };

  /* ── 2. restartlar: har xil tartib, eng yaxshi natija ── */
  const order0 = baseOrder(cellsOf);
  let best: Attempt | null = null;
  let bestKey: [number, number, number] = [-1, -1, -1];
  for (let a = 0; a < attempts; a++) {
    const rand = rng(seedNum + a * 0x9e3779b1);
    const order = a === 0 ? order0 : shuffled(order0, rand);
    const got = placeOnce(size, cellsOf, order, seedNum + a * 0x85ebca6b);
    const area = boxRows(got.box) * boxCols(got.box) || 1;
    const cross = countCrossings(size, cellsOf, got.entries);
    // Tanlov: ko'proq so'z → ko'proq kesishma → kichikroq ramka.
    const key: [number, number, number] = [got.entries.length, cross, -area];
    if (key[0] > bestKey[0] || (key[0] === bestKey[0] && (key[1] > bestKey[1] || (key[1] === bestKey[1] && key[2] > bestKey[2])))) {
      best = got;
      bestKey = key;
    }
    if (got.entries.length === kept.length && cross >= kept.length - 1) break;
  }
  const attempt = best ?? { entries: [], box: EMPTY_BOX, placed: new Set<number>() };

  /* ── 3. sig'maganlar ── */
  for (let i = 0; i < kept.length; i++) {
    if (!attempt.placed.has(i)) dropped.push({ answer: [...cellsOf[i].cells], clue: kept[i].clue ?? "", reason: "no-fit" });
  }

  // Joylashuv tartibi kirish tartibiga qaytariladi (determinizm + o'qilishi oson).
  const entries = [...attempt.entries].sort((a, b) => a.wi - b.wi);
  return { ...finalize(size, cellsOf, kept, entries), dropped };
}

/**
 * Savollar ro'yxati — R0 `CrosswordModel.clues` shakli.
 *
 * `length` (katak soni) SAQLANADI: bosma ro'yxatda «(7)» qavsi shundan
 * chiqadi va `wordLength` qoidasi javob varag'isiz ham tekshira oladi.
 */
export function cluesOf(placed: readonly PlacedWord[]): { across: CrosswordClue[]; down: CrosswordClue[] } {
  const by = (dir: CrosswordDir): CrosswordClue[] =>
    placed
      .filter((w) => w.dir === dir)
      .sort((a, b) => a.number - b.number)
      .map((w) => ({ number: w.number, text: w.clue, wordId: w.id, length: w.answer.length }));
  return { across: by("across"), down: by("down") };
}

/**
 * To'r o'lchami — AVTOMAT (egasining qarori: formada maydon yo'q).
 *
 * So'z soniga qarab ish taxtasi tanlanadi, natija esa baribir RAMKA
 * bo'yicha kesiladi — ya'ni bu yuqori chegara, chop etiladigan to'r
 * odatda kichikroq (10 so'z → ≈13×13). O'lchov `normalizeGridSize`
 * dan o'tadi (toq, 13–21).
 */
export function autoGridSize(wordCount: number): number {
  const n = Math.max(1, Math.round(wordCount));
  return normalizeGridSize(n <= 5 ? 13 : n <= 10 ? 17 : GAME_LIMITS.gridMax);
}
