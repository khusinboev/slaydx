/**
 * O'YINCHI KO'RADIGAN MA'LUMOT (AUDIT-22 R0) — `publicGameView`.
 *
 * Bu modulning YAGONA vazifasi: hujjatdan o'yinchiga BERILADIGAN qismni
 * ajratib olish va TO'G'RI JAVOBNI olib tashlash. U ochiq havolada
 * (`/api/o/[token]`, loginsiz) qaytariladi, ya'ni bu yerdan sizib
 * chiqqan har qanday maydon — o'yinning o'zini ma'nosiz qiladi.
 *
 * Shuning uchun uchta qat'iy qoida:
 *
 *   1. Ko'rinish MODELDAN QAYTA QURILADI (nusxa olinmaydi): `{...model}`
 *      naqshi yangi maydon qo'shilganda uni JIMGINA oshkor qilardi —
 *      bu yerda har maydon QO'LDA ko'chiriladi va testda sanaladi.
 *   2. Element id lari TARTIBDAN kelib chiqmaydi: saralashda elementlar
 *      toifa bo'yicha guruhlab saqlanadi, ya'ni `item-0…item-2` id lari
 *      «birinchi uchtasi birinchi toifa» degan javobni oshkor qilardi.
 *      Id — MATN xeshi (`publicItemId`), ya'ni ma'lumot bermaydi va
 *      ball hisobida qayta topiladi.
 *   3. Variantlar tartibi ARALASHTIRILADI (`publicOptionOrder`) —
 *      deterministik, element id sidan. Model to'g'ri javobni tizimli
 *      ravishda birinchi o'ringa qo'yib yuborsa ham, o'yinchi buni
 *      ko'rmaydi. Ball hisobi (`score.ts`) AYNI tartibni qayta quradi.
 *
 * IZOMORF: server importi YO'Q (`lib/server/**`, `node:crypto`) — sahifa
 * ham (`app/o/[token]`), route ham, test ham shu modulni o'qiydi.
 */
import type { AcademicDoc } from "../generation/types";
import type { GameKind, ListeningItem } from "../generation/games/types";

/* ────────────────────────── kind ────────────────────────── */

/**
 * Ochiq o'yin turlari.
 *
 * `quiz` — o'qituvchining TESTI (`doc.teacher.test`): u `GameKind` emas,
 * lekin interaktiv runtime nuqtai nazaridan xuddi shunday o'ynaladi
 * (AUDIT-20 §4: «test/krossvord/flesh karta 2-bosqichi shu runtime
 * orqali»). Shuning uchun bu yerda ALOHIDA ro'yxat bor — vosita oilasi
 * emas, O'YIN turi.
 */
export const PUBLIC_GAME_KINDS = ["quiz", "crossword", "flashcards", "sorting", "listening"] as const;
export type PublicGameKind = (typeof PUBLIC_GAME_KINDS)[number];

export const isPublicGameKind = (v: unknown): v is PublicGameKind => (PUBLIC_GAME_KINDS as readonly string[]).includes(String(v));

/** Vosita id → ochiq o'yin turi; o'ynaladigan vosita bo'lmasa `null`. */
export function publicGameKindOf(toolId: string): PublicGameKind | null {
  if (toolId === "test") return "quiz";
  if (toolId === "crossword" || toolId === "flashcards" || toolId === "sorting" || toolId === "listening") return toolId as GameKind & PublicGameKind;
  return null;
}

/* ────────────────────────── ko'rinish ────────────────────────── */

/**
 * Interaktiv rejimda O'YNALADIGAN savol turlari.
 *
 * `open` (erkin javob) va `match` (moslashtirish) ATAYLAB yo'q: ularni
 * server tomonda avtomatik va adolatli baholab bo'lmaydi (`open` —
 * insho javobi, `match` — juftliklar jadvali). Ular bosma testda
 * qoladi; ochiq havolada esa savol soni shunga mos KAMAYADI va
 * `total` aynan shu sonni ko'rsatadi.
 */
export const PUBLIC_QUIZ_KINDS = ["single", "multi", "truefalse"] as const;
export type PublicQuizKind = (typeof PUBLIC_QUIZ_KINDS)[number];

export type PublicQuizQuestion = {
  id: string;
  kind: PublicQuizKind;
  stem: string;
  /** `truefalse` da bo'sh — o'yinchi «To'g'ri/Noto'g'ri» tugmasini ko'radi. */
  options: string[];
};

export type PublicClue = { number: number; text: string; length: number; wordId: string };

export type PublicCrosswordGrid = {
  rows: number;
  cols: number;
  /** `true` — yoziladigan katak; `false` — qora/bo'sh. HARF YO'Q. */
  cells: boolean[][];
  /** Raqamlangan kataklar (to'r chizish uchun). */
  numbers: { row: number; col: number; number: number }[];
};

/**
 * `back` — AUDIT-22 R: ag'darishning o'zi javob emas.
 *
 * Kartalarda serverda tekshiriladigan «to'g'ri javob» umuman yo'q
 * (`score.ts` — ball o'yinchi o'zi bosgan «bildim» soni, orqa yuz bilan
 * SOLISHTIRILMAYDI). Shuning uchun `back` ni bu yerga chiqarish
 * o'yinning boshqa turlaridagi kabi «javob sizishi» emas: o'zini
 * tekshirish mashqida orqa yuzni yashirib bo'lmaydi — o'quvchi baribir
 * javobni ICHIDA aytadi, kartani ag'daradi va HALOL belgilaydi (WP-C
 * ochiq bandi, R da yopildi).
 */
export type PublicCard = { id: string; front: string; back: string };
export type PublicSortingCategory = { id: string; name: string };
export type PublicSortingItem = { id: string; text: string };
export type PublicListeningItem = {
  id: string;
  /**
   * Eshitiladigan matn (`targetLanguage`) — AUDIT-22 R.
   *
   * JAVOB EMAS: to'g'ri javob `options` ichidagi (ona tildagi) element,
   * bu esa boshqa TILDAGI matn. TTS hali yo'q yoki audio yiqilgan
   * holatda o'yinchi tomoni buni O'QIB javob berishi uchun kerak
   * (`Listening.tsx` «Tinglab bo'lmadi — o'qing»); usiz tinglash
   * mashqi audiosiz umuman o'ynalmasdi.
   */
  text: string;
  /** TTS parchasi (`putAssetBytes`) — bo'lmasa o'yinchi tomoni «audio yo'q» deydi. */
  audioAssetId?: string;
  /** Variantlar — ARALASHTIRILGAN tartibda (`publicOptionOrder`). */
  options: string[];
};

export type PublicGameView =
  | { kind: "quiz"; title: string; total: number; questions: PublicQuizQuestion[] }
  | { kind: "crossword"; title: string; total: number; grid: PublicCrosswordGrid; clues: { across: PublicClue[]; down: PublicClue[] } }
  | { kind: "flashcards"; title: string; total: number; cards: PublicCard[] }
  | { kind: "sorting"; title: string; total: number; categories: PublicSortingCategory[]; items: PublicSortingItem[] }
  | { kind: "listening"; title: string; total: number; items: PublicListeningItem[] };

/* ────────────────────────── determinizm ────────────────────────── */

/** FNV-1a — sof funksiya, `node:crypto` siz (modul izomorf bo'lishi kerak). */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — bir xil urug'dan bir xil ketma-ketlik. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates, urug'langan — ASL massiv o'zgarmaydi. */
export function shuffled<T>(list: readonly T[], seed: string): T[] {
  const out = [...list];
  const next = rng(hash32(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Element id si — MATNDAN, tartibdan EMAS (fayl boshidagi 2-qoida).
 *
 * Prefiks bilan: bir xil matn ikki xil o'yinda uchrasa ham id lar
 * chalkashmaydi, va id ning o'zi «bu nimaning elementi» ni aytmaydi.
 */
export function publicItemId(text: string): string {
  return `i${hash32(String(text ?? "").trim().toLowerCase()).toString(36)}`;
}

/**
 * Variantlar tartibi — element id sidan deterministik.
 *
 * `order[i]` — ochiq ko'rinishdagi i-o'rinda turadigan variantning ASL
 * indeksi. `score.ts` shu funksiyani QAYTA chaqiradi, ya'ni o'yinchi
 * yuborgan «2-variant» modelning qaysi variantiga tegishli ekani
 * saqlanmasdan tiklanadi (sessiyada hech narsa saqlash shart emas).
 */
export function publicOptionOrder(id: string, n: number): number[] {
  return shuffled(
    Array.from({ length: n }, (_, i) => i),
    `opt:${id}`,
  );
}

/* ────────────────────────── ko'rinish qurish ────────────────────────── */

const clean = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * Hujjatdan o'yinchi ko'rinishini quradi.
 *
 * `null` — hujjat bu turdagi o'yin emas (model yo'q yoki boshqa kind).
 * Route buni 404 ga aylantiradi: mavjud bo'lmagan o'yin bilan «bo'sh
 * ekran» ko'rsatishdan ko'ra, havola noto'g'ri deb aytish to'g'riroq.
 *
 * @param seed Sessiya tokeni — elementlar tartibi har havolada boshqa
 *   bo'lsin (bir sinfdagi o'quvchilar bir-biridan ko'chira olmasin).
 *   Berilmasa hujjatning o'zidan kelib chiqadi (testlar barqaror).
 */
export function publicGameView(doc: AcademicDoc, kind: PublicGameKind, opts: { seed?: string } = {}): PublicGameView | null {
  const title = clean(doc.meta?.topic) || clean(doc.game?.topic) || "O‘yin";
  const seed = opts.seed ?? `${kind}:${title}`;

  if (kind === "quiz") {
    const test = doc.teacher?.test;
    if (!test?.questions?.length) return null;
    const questions: PublicQuizQuestion[] = [];
    for (const q of test.questions) {
      if (!(PUBLIC_QUIZ_KINDS as readonly string[]).includes(q.kind)) continue;
      const id = clean(q.id) || publicItemId(q.stem);
      const order = publicOptionOrder(id, q.options.length);
      questions.push({
        id,
        kind: q.kind as PublicQuizKind,
        stem: clean(q.stem),
        // `truefalse` da variantlar modelda ham bo'sh bo'ladi.
        options: q.kind === "truefalse" ? [] : order.map((i) => clean(q.options[i])),
      });
    }
    if (!questions.length) return null;
    return { kind, title, total: questions.length, questions };
  }

  if (kind === "crossword") {
    const cw = doc.game?.crossword;
    if (!cw?.words?.length) return null;
    /*
     * To'r SHAKLI: `cells` — faqat «yoziladigan katakmi» degan bayroq.
     * MUTATSIYA: shu yerda harfni o'tkazib yuborish (`cells` ni
     * `cw.grid.cells` dan nusxalash) — butun krossvordni javobi bilan
     * berardi.
     */
    const cells = cw.grid.cells.map((row) => row.map((c) => c !== null && c !== ""));
    const numbers = cw.words.map((w) => ({ row: w.row, col: w.col, number: w.number }));
    const clue = (c: { number: number; text: string; length: number; wordId: string }): PublicClue => ({
      number: c.number,
      text: clean(c.text),
      length: c.length,
      wordId: c.wordId,
    });
    return {
      kind,
      title,
      total: cw.words.length,
      grid: { rows: cw.grid.rows, cols: cw.grid.cols, cells, numbers },
      clues: { across: cw.clues.across.map(clue), down: cw.clues.down.map(clue) },
    };
  }

  if (kind === "flashcards") {
    const cards = doc.game?.cards?.cards;
    if (!cards?.length) return null;
    // Old yuz + orqa yuz (`PublicCard.back` izohi) — `example`/`hint`
    // ATAYLAB chiqarilmaydi (ular o'zini tekshirish uchun shart emas).
    return {
      kind,
      title,
      total: cards.length,
      cards: cards.map((c) => ({ id: clean(c.id) || publicItemId(c.front), front: clean(c.front), back: clean(c.back) })),
    };
  }

  if (kind === "sorting") {
    const model = doc.game?.sorting;
    if (!model?.categories?.length) return null;
    const categories = model.categories.map((c) => ({ id: clean(c.id) || publicItemId(c.name), name: clean(c.name) }));
    const flat = model.categories.flatMap((c) => c.items.map((t) => clean(t)));
    const items = shuffled(flat, `sort:${seed}`).map((text) => ({ id: publicItemId(text), text }));
    return { kind, title, total: flat.length, categories, items };
  }

  const model = doc.game?.listening;
  if (!model?.items?.length) return null;
  return {
    kind: "listening",
    title,
    total: model.items.length,
    items: model.items.map((it) => publicListeningItem(it)),
  };
}

/** Bitta tinglash topshirig'i — AUDIO id + aralashtirilgan variantlar (javobsiz). */
function publicListeningItem(it: ListeningItem): PublicListeningItem {
  const id = clean(it.id) || publicItemId(it.text);
  const order = publicOptionOrder(id, it.options.length);
  return {
    id,
    text: clean(it.text),
    ...(it.audioAssetId ? { audioAssetId: it.audioAssetId } : {}),
    options: order.map((i) => clean(it.options[i])),
  };
}
