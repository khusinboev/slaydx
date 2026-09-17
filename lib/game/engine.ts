/**
 * O'YIN HOLAT MASHINASI (AUDIT-22 WP-C) — `lib/game/engine.ts`.
 *
 * O'yinchi tomonining BUTUN mantig'i shu yerda, SOF funksiyalar bilan:
 * `createGame(view) → state`, `answer(state, id, value)`, `next`, `prev`,
 * `flip`, `pick`, `finish(state) → {answers, seconds}`. React
 * komponentlari (`components/game/*`) faqat CHIZADI va hodisani shu
 * funksiyalarga uzatadi.
 *
 * NEGA SOF: besh tur (quiz/krossvord/kartalar/saralash/tinglash) uchun
 * «qaysi qadamda turibmiz, nima belgilandi, yakuniy payload qanday»
 * degan savol bitta joyda javob topadi va jsdom SIZ, DOM siz sinaladi
 * (`tests/game-engine.test.mts`). jsdom testi esa faqat CHIZILISHNI
 * tekshiradi — ikkalasi bir-birini takrorlamaydi.
 *
 * IKKI QAT'IY SHARTNOMA:
 *
 *   1. TARTIB TEGILMAYDI. `publicGameView` variantlarni ATAYLAB
 *      aralashtiradi (`publicOptionOrder`), va `score.ts` AYNI tartibni
 *      qayta quradi. Dvigatel esa o'yinchi bosgan OCHIQ indeksni
 *      o'zgartirmasdan payload ga qo'yadi. Bu yerda biror joyda
 *      «tartibga solish» (`sort`, teskari xarita, asl indeksga
 *      o'tkazish) paydo bo'lsa — butun ball noto'g'ri hisoblanardi va
 *      HECH BIR server testi buni ko'rmasdi. `tests/game-engine.test.mts`
 *      shuning uchun `publicGameView → engine → scoreAnswers` halqasini
 *      uchidan-uchiga yuradi.
 *   2. TO'G'RI JAVOB BU YERDA YO'Q. Dvigatel ball hisoblamaydi va
 *      hisoblay olmaydi — ko'rinishda javob yo'q. `finish()` faqat
 *      TANLOVNI yig'adi; `{score,total,percent}` submit javobidan keladi.
 *
 * XATO QIYMAT — ISTISNO EMAS. Noto'g'ri id yoki shakl berilsa holat
 * O'ZGARMASDAN qaytadi (`score.ts` bilan bir xil falsafa: bitta buzuq
 * maydon butun o'yinni yiqitmasin).
 *
 * IZOMORF: server importi YO'Q — `components/game/Player.tsx` orqali
 * ochiq sahifa bandliga kiradi (`tests/client-boundary.test.mts`).
 */
import type { PublicCrosswordGrid, PublicGameKind, PublicGameView } from "./public";
import type { PlayerAnswers } from "./score";

/* ────────────────────────── holat ────────────────────────── */

export type GameState = {
  kind: PublicGameKind;
  view: PublicGameView;
  /**
   * Joriy qadam (0 dan). Bir ekranli turlarda (krossvord, saralash)
   * DOIM 0: ular bitta to'r/taxtada o'ynaladi va «keyingi savol» tugmasi
   * ma'nosiz bo'lardi.
   */
  index: number;
  /** Jami qadam (`stepsOf`) — progress va «Yakunlash» tugmasi shundan. */
  steps: number;
  /**
   * Yig'ilgan tanlovlar.
   *
   * Kalit — ELEMENT id si, KROSSVORDDAN tashqari: u yerda kalit KATAK
   * (`r:c`, `cellKey`), chunki o'yinchi so'zni emas, katakni to'ldiradi
   * va kesishgan katak IKKI so'zga tegishli. So'z → harflar payload i
   * `finish()` da quriladi (`score.ts` aynan shuni kutadi).
   */
  answers: Record<string, unknown>;
  /** Flesh kartada: joriy karta ag'darilganmi (qadam almashsa — `false`). */
  flipped: boolean;
  /** Saralashda tanlab-joylash oqimi: qo'lga olingan element id si. */
  picked: string | null;
  /** Boshlangan vaqt (ms) — taymer FAQAT o'lchaydi, o'yinni to'xtatmaydi. */
  startedAt: number;
  /** `finish()` dan keyin to'ldiriladi; `null` — o'yin davom etyapti. */
  finishedAt: number | null;
};

export type FinishResult = {
  /** `finishedAt` qo'yilgan holat — «Yakunlash» ikki marta bosilmasin. */
  state: GameState;
  /** `POST /api/o/[token]/submit` ning `answers` maydoni. */
  answers: PlayerAnswers;
  /** O'lchangan vaqt (soniya) — server ham 86 400 bilan cheklaydi. */
  seconds: number;
};

/**
 * O'yin turining o'zbekcha nomi — YAGONA manba.
 *
 * Ikki tomon ham shu jadvaldan o'qiydi: o'yinchi sahifasi
 * (`components/game/Player.tsx`) va egasining paneli
 * (`components/files/GameSharePanel.tsx`). Panel yorliqni o'yinchi
 * komponentidan olsa, butun o'yin bandli (`Quiz`, `Crossword`, …)
 * har bir natija sahifasiga ergashib kirardi — shuning uchun jadval
 * React'siz modulda turadi.
 */
export const GAME_KIND_LABEL: Record<PublicGameKind, string> = {
  quiz: "Test",
  crossword: "Krossvord",
  flashcards: "Flesh kartalar",
  sorting: "Saralash",
  listening: "Tinglash",
};

/** Noto'g'ri qiymat belgisi (istisno o'rniga — fayl boshidagi qoida). */
const INVALID = Symbol("invalid");
/** «Belgini olib tashla» belgisi (bo'sh katak, tanlovni bekor qilish). */
const CLEAR = Symbol("clear");

/* ────────────────────────── krossvord to'ri ────────────────────────── */

export type CrosswordSlot = {
  wordId: string;
  number: number;
  dir: "across" | "down";
  text: string;
  length: number;
  /** To'ldiriladigan kataklar — boshidan oxirigacha, tartib bilan. */
  cells: { row: number; col: number }[];
};

/** Katak kaliti — `answers` da va DOM `data-cell` da AYNI ko'rinish. */
export const cellKey = (row: number, col: number): string => `${row}:${col}`;

const writable = (grid: PublicCrosswordGrid, row: number, col: number): boolean =>
  row >= 0 && col >= 0 && row < grid.rows && col < grid.cols && Boolean(grid.cells[row]?.[col]);

/**
 * Savollardan KATAK yo'llarini tiklaydi.
 *
 * Ochiq ko'rinishda so'zning kataklari YO'Q (u javobni bergan bo'lardi):
 * faqat to'r shakli, raqamlangan kataklar va savol uzunligi bor.
 * Yo'l shu uchtasidan qayta quriladi — raqamdan boshlab yo'nalish
 * bo'yicha `length` ta YOZILADIGAN katak. To'r chegarasidan yoki qora
 * katakdan o'tib ketmaydi: buzuq model bilan ham ekran chizilsin.
 */
export function crosswordSlots(view: Extract<PublicGameView, { kind: "crossword" }>): CrosswordSlot[] {
  const { grid, clues } = view;
  const out: CrosswordSlot[] = [];
  for (const dir of ["across", "down"] as const) {
    for (const c of clues[dir]) {
      const start = grid.numbers.find((n) => n.number === c.number);
      if (!start) continue;
      const cells: { row: number; col: number }[] = [];
      for (let i = 0; i < c.length; i++) {
        const row = dir === "down" ? start.row + i : start.row;
        const col = dir === "across" ? start.col + i : start.col;
        if (!writable(grid, row, col)) break;
        cells.push({ row, col });
      }
      out.push({ wordId: c.wordId, number: c.number, dir, text: c.text, length: c.length, cells });
    }
  }
  return out;
}

/* ────────────────────────── qurish ────────────────────────── */

/**
 * Qadamlar soni.
 *
 * Quiz/kartalar/tinglash — ELEMENTMA-ELEMENT (telefon ekraniga bitta
 * savol sig'adi va katta tugma qoladi). Krossvord va saralash — BITTA
 * ekran: krossvordda kesishmalar bir vaqtda ko'rinishi kerak,
 * saralashda esa element va toifalar bir ekranda bo'lmasa joylashtirib
 * bo'lmaydi.
 */
export function stepsOf(view: PublicGameView): number {
  if (view.kind === "quiz") return Math.max(1, view.questions.length);
  if (view.kind === "flashcards") return Math.max(1, view.cards.length);
  if (view.kind === "listening") return Math.max(1, view.items.length);
  return 1;
}

export function createGame(view: PublicGameView, opts: { now?: number } = {}): GameState {
  return {
    kind: view.kind,
    view,
    index: 0,
    steps: stepsOf(view),
    answers: {},
    flipped: false,
    picked: null,
    startedAt: opts.now ?? Date.now(),
    finishedAt: null,
  };
}

/* ────────────────────────── javob ────────────────────────── */

/**
 * `multi` savolda belgini almashtirish — SOF yordamchi.
 *
 * Komponentda `answer(s, q.id, toggleIndex(answerOf(s, q.id), i))` deb
 * yoziladi, ya'ni `answer` ning o'zi idempotent qoladi (bir xil qiymat
 * bilan ikki marta chaqirish holatni o'zgartirmaydi).
 */
export function toggleIndex(list: unknown, i: number): number[] {
  const cur = (Array.isArray(list) ? list : []).filter((v): v is number => Number.isInteger(v));
  return cur.includes(i) ? cur.filter((v) => v !== i) : [...cur, i];
}

const asIndex = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

/**
 * Bitta katakka yoziladigan HARF.
 *
 * O'zbek lotinidagi `oʻ`/`gʻ` IKKI kod nuqtasi, lekin BITTA katak
 * (`games/types.ts CrosswordWord.answer` shu sababdan massiv). Shuning
 * uchun bu yerda «birinchi belgi» emas, «birinchi belgi + ergashgan
 * apostrof» olinadi — aks holda o'quvchi `oʻ` yozganda katakda `o`
 * qolib, keyingi katakka `ʻ` tushardi.
 */
function oneLetter(v: unknown): string {
  const chars = [...String(v ?? "").replace(/\s+/g, "")];
  if (!chars.length) return "";
  const first = chars[0]!;
  const second = chars[1];
  const apostrophe = second !== undefined && /[ʻʼ'’`]/.test(second);
  return (apostrophe ? first + second : first).toUpperCase();
}

function normalize(view: PublicGameView, id: string, value: unknown): unknown {
  if (view.kind === "quiz") {
    const q = view.questions.find((x) => x.id === id);
    if (!q) return INVALID;
    if (q.kind === "truefalse") return typeof value === "boolean" ? value : INVALID;
    if (q.kind === "single") {
      const i = asIndex(value);
      return i !== null && i < q.options.length ? i : INVALID;
    }
    if (!Array.isArray(value)) return INVALID;
    const idx: number[] = [];
    for (const raw of value) {
      const i = asIndex(raw);
      if (i === null || i >= q.options.length) return INVALID;
      if (!idx.includes(i)) idx.push(i);
    }
    /*
     * Bo'sh to'plam — «hech narsa belgilanmagan», ya'ni javobni
     * O'CHIRISH. `score.ts` da ham `picked.length > 0` sharti bor:
     * bo'sh massiv «hammasini topdim» degani emas.
     */
    return idx.length ? idx : CLEAR;
  }

  if (view.kind === "crossword") {
    const [r, c] = id.split(":");
    const row = Number(r);
    const col = Number(c);
    if (!Number.isInteger(row) || !Number.isInteger(col) || !writable(view.grid, row, col)) return INVALID;
    return oneLetter(value) || CLEAR;
  }

  if (view.kind === "flashcards") {
    if (!view.cards.some((c) => c.id === id)) return INVALID;
    return typeof value === "boolean" ? value : INVALID;
  }

  if (view.kind === "sorting") {
    if (!view.items.some((it) => it.id === id)) return INVALID;
    if (value === null || value === "") return CLEAR;
    return view.categories.some((c) => c.id === value) ? value : INVALID;
  }

  const it = view.items.find((x) => x.id === id);
  if (!it) return INVALID;
  const i = asIndex(value);
  return i !== null && i < it.options.length ? i : INVALID;
}

const same = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((v, i) => v === b[i]) : a === b;

/**
 * Tanlovni yozadi. Noto'g'ri id/shakl — HOLAT O'ZGARMAYDI.
 *
 * Krossvordda `id` — katak (`cellKey`), boshqa turlarda element id si.
 * `null`/bo'sh qiymat belgini OLIB TASHLAYDI (o'quvchi fikridan qaytsa).
 */
export function answer(state: GameState, id: string, value: unknown): GameState {
  if (state.finishedAt !== null) return state;
  const v = normalize(state.view, id, value);
  if (v === INVALID) return state;
  if (v === CLEAR) {
    if (!(id in state.answers)) return state;
    const rest = { ...state.answers };
    delete rest[id];
    return { ...state, answers: rest };
  }
  if (id in state.answers && same(state.answers[id], v)) return state;
  return { ...state, answers: { ...state.answers, [id]: v } };
}

/** Joriy tanlov (komponent `toggleIndex` bilan juftlashtiradi). */
export function answerOf(state: GameState, id: string): unknown {
  return state.answers[id];
}

/* ────────────────────────── harakat ────────────────────────── */

const move = (state: GameState, to: number): GameState => {
  const index = Math.max(0, Math.min(state.steps - 1, to));
  if (index === state.index) return state;
  /*
   * Qadam almashganda karta yopiladi va qo'ldagi element tushadi — aks
   * holda yangi karta OCHIQ (orqa yuzi ko'rinib turgan) holda kelardi.
   */
  return { ...state, index, flipped: false, picked: null };
};

export function next(state: GameState): GameState {
  return move(state, state.index + 1);
}

export function prev(state: GameState): GameState {
  return move(state, state.index - 1);
}

export function goTo(state: GameState, index: number): GameState {
  return move(state, index);
}

/** Kartani ag'darish (faqat `flashcards`). */
export function flip(state: GameState): GameState {
  if (state.kind !== "flashcards" || state.finishedAt !== null) return state;
  return { ...state, flipped: !state.flipped };
}

/**
 * Saralashda elementni «qo'lga olish» (tanlab-joylash oqimi).
 *
 * Drag-and-drop TELEFONDA ishonchli emas (HTML5 DnD mobil brauzerlarda
 * yo'q), shuning uchun asosiy oqim — element ustiga bosish, keyin toifa
 * ustiga bosish. DnD esa ustiga qo'shimcha (`Sorting.tsx`) va AYNI shu
 * ikki chaqiruvga tushadi.
 */
export function pick(state: GameState, itemId: string | null): GameState {
  const view = state.view;
  if (view.kind !== "sorting" || state.finishedAt !== null) return state;
  if (itemId !== null && !view.items.some((it) => it.id === itemId)) return state;
  if (state.picked === itemId) return { ...state, picked: null };
  return { ...state, picked: itemId };
}

/** Qo'ldagi elementni toifaga qo'yadi (tanlov bo'shaydi). */
export function place(state: GameState, categoryId: string): GameState {
  if (state.kind !== "sorting" || !state.picked) return state;
  const moved = answer(state, state.picked, categoryId);
  if (moved === state) return state;
  return { ...moved, picked: null };
}

/* ────────────────────────── progress ────────────────────────── */

/** Javob berilgan elementlar soni (KATAK emas — foydalanuvchi ko'radigan birlik). */
export function answeredCount(state: GameState): number {
  const v = state.view;
  if (v.kind === "quiz") return v.questions.filter((q) => q.id in state.answers).length;
  if (v.kind === "flashcards") return v.cards.filter((c) => typeof state.answers[c.id] === "boolean").length;
  if (v.kind === "sorting") return v.items.filter((it) => typeof state.answers[it.id] === "string").length;
  if (v.kind === "listening") return v.items.filter((it) => typeof state.answers[it.id] === "number").length;
  /*
   * Krossvord: so'z TO'LIQ to'lgandagina sanaladi — yarim yozilgan so'z
   * `score.ts` da baribir xato bo'ladi va progress uni va'da qilmasin.
   */
  return crosswordSlots(v).filter((s) => s.cells.length > 0 && s.cells.every((c) => state.answers[cellKey(c.row, c.col)])).length;
}

export function progress(state: GameState): { done: number; total: number; percent: number } {
  const total = state.view.total;
  const done = answeredCount(state);
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

/** Oxirgi qadamdami (Yakunlash tugmasi shu yerda chiqadi). */
export const isLast = (state: GameState): boolean => state.index >= state.steps - 1;

export const isFinished = (state: GameState): boolean => state.finishedAt !== null;

/** O'lchangan vaqt (soniya). Taymer O'YINNI TO'XTATMAYDI — faqat o'lchov. */
export function elapsed(state: GameState, now: number = Date.now()): number {
  const end = state.finishedAt ?? now;
  const s = Math.round((end - state.startedAt) / 1000);
  /*
   * Server ham 86 400 bilan cheklaydi (`game-sessions.ts addResult`) —
   * brauzer soati o'zgarsa manfiy yoki ulkan son ketmasin.
   */
  return Math.max(0, Math.min(86_400, Number.isFinite(s) ? s : 0));
}

/* ────────────────────────── yakun ────────────────────────── */

/**
 * Submit payload ini quradi.
 *
 * Shakl `score.ts scoreAnswers` bilan AYNAN mos bo'lishi shart:
 *   quiz        — savol id → indeks | indekslar | boolean
 *   crossword   — SO'Z id → harflar satri (kataklardan yig'iladi)
 *   flashcards  — karta id → boolean («bildim»)
 *   sorting     — element id → toifa id
 *   listening   — element id → indeks
 */
export function finish(state: GameState, opts: { now?: number } = {}): FinishResult {
  const now = opts.now ?? Date.now();
  const ended: GameState = state.finishedAt !== null ? state : { ...state, finishedAt: now, picked: null };
  return { state: ended, answers: payload(state), seconds: elapsed(ended, now) };
}

function payload(state: GameState): PlayerAnswers {
  const v = state.view;
  if (v.kind !== "crossword") {
    /*
     * Tartib TEGILMAYDI (fayl boshidagi 1-shartnoma): ochiq indeks
     * qanday bosilgan bo'lsa, shundayligicha ketadi.
     */
    return { ...state.answers };
  }
  const out: PlayerAnswers = {};
  for (const slot of crosswordSlots(v)) {
    out[slot.wordId] = slot.cells.map((c) => String(state.answers[cellKey(c.row, c.col)] ?? "")).join("");
  }
  return out;
}
