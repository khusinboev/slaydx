/**
 * BOSMA O'YIN MAKETI — YAGONA MANBA (AUDIT-21 WP-A/WP-B).
 *
 * `planGame(doc)` ikkala vositani (krossvord, flesh kartalar) BITTA
 * rasmiy shaklga yoyadi va DOCX (`render-docx.ts drawGame`) ham,
 * ko'ruvchi (`lib/viewers/flow.ts gameFlow` → `WordViewer`) ham FAQAT
 * shu natijani chizadi — ikkalasida ham «qaysi band qayerda» degan
 * mantiq YO'Q (`planTeacher`/`planWork` naqshi; izomorf — DOM ham,
 * `docx` ham import qilinmaydi).
 *
 *   krossvord  sarlavha → to'r (figure) → Gorizontal/Vertikal savollar
 *              IKKI USTUNDA → javoblar varag'i YANGI BETDAN
 *   kartalar   sarlavhasiz varaqlar: OLD yuzlar (2×4) → ORQA yuzlar
 *              (OYNALI tartib), har 8 kartaga bir juft bet
 *
 * ── Nega kartalarda SHAPKA YO'Q (bu maketning markaziy qarori)
 *
 * Kartalar ikki tomonlama bosiladi: 1-bet old yuzlar, 2-bet orqa
 * yuzlar, qog'oz «uzun chekka bo'ylab» aylantiriladi (R5 §1). Old bet
 * bilan orqa bet KATAKMA-KATAK ustma-ust tushishi kerak, aks holda
 * kesilgan kartaning orqasida qo'shni kartaning ta'rifi qoladi.
 * Shuning uchun HAR BETDAGI panjara BIR XIL joydan boshlanadi va
 * hujjat sarlavhasi (mavzu, tur, «FLESH KARTALAR») birinchi betning
 * tepasiga QO'YILMAYDI — u faqat old betni pastga surib, ikkala betni
 * ajratib yuborardi. Sarlavha o'rniga har betda BIR XIL BALANDLIKDAGI
 * ikki qatorli varaq shapkasi turadi (`GameCardsItem.title`/`hint`):
 * matni betga qarab o'zgaradi, balandligi esa hech qachon o'zgarmaydi.
 *
 * ── A7 geometriyasi: nega katak 74×105 mm EMAS (halol yozuv)
 *
 * R5 §1 A7 ni (74×105 mm) va A4 da 2×4 panjarani tavsiya qiladi. Bu
 * ikkisi PORTRET A4 da BIRGA bo'lishi mumkin emas: 4 × 105 = 420 mm,
 * A4 bo'yi esa 297 mm. A4 ni sakkizga bo'lish A7 ni YOTIQ qo'yishni
 * talab qiladi (2 × 105 = 210 mm eni, 4 × 74 = 296 mm bo'yi) — ya'ni
 * chegara uchun bir milli ham joy qolmaydi. Shuning uchun katak
 * A7 NISBATINI (105:74 = 1,419) saqlaydi va bosiladigan maydonga
 * SIG'DIRILADI (`cardCellMm`): 10 mm chegara va varaq shapkasi bilan
 * ≈92 × 64,9 mm chiqadi. Bu «A7 ga yaqin» karta — hisobotdagi raqamning
 * o'zi emas, lekin HAQIQATDA sakkizta bo'lib bosiladi va kesiladi.
 * `GAME_LIMITS.cardWidthMm`/`cardHeightMm` NOMINAL o'lcham bo'lib
 * qoladi (nisbat manbasi), `CARDS_PER_SHEET` esa shartnoma.
 *
 * ── Matn qayerdan keladi (dvigatellar bilan shartnoma)
 *
 * TUZILMA — `doc.game` modelida (`GameModel`), NASR esa odatdagidek
 * `doc.sections` da: hisobot (`review.ts`), baholovchi, sayqal va
 * qidiruv shu matnni o'qiydi.
 *
 * Ikki kind ikki xil manbadan chiziladi va bu ATAYLAB:
 *
 *   krossvord  BO'LIM BLOKLARIDAN (`crossword/engine.ts
 *              crosswordSections`) — ko'rsatma qatorlari, savol matni
 *              va javoblar ro'yxati hujjatning O'ZIDA yozilgan matn,
 *              maket faqat joylashtiradi (`path` =
 *              `sections.<i>.blocks.<j>`, teacher shartnomasi);
 *   kartalar   MODELDAN (`game.cards`) — nasrda old yuz bilan orqa yuz
 *              ajralmaydi (`h3` + `p`), ya'ni panjarani bloklardan
 *              qayta yig'ish qaysi paragraf qaysi kartaniki degan
 *              taxminga tayanardi. Nasr esa baribir kerak: hisobot,
 *              baholovchi va qidiruv shuni o'qiydi.
 */
import { docLabels, type DocLabels } from "../i18n";
import type { AcademicDoc, Figure } from "../types";
import { gameTypeOf } from "./registry";
import {
  CARDS_PER_SHEET,
  GAME_LIMITS,
  type Flashcard,
  type FlashcardsModel,
  type CrosswordModel,
  type GameKind,
  type GameModel,
} from "./types";

/* ══════════════════════════ varaq ══════════════════════════ */

/**
 * Chegaralar (sm) — kind bo'yicha. `docx-profile.ts gameProfile` ham,
 * ko'ruvchi varag'i (`WordViewer gameSheet`) ham SHU YERDAN o'qiydi.
 *
 * Kartalarda 1 sm: panjara qanchalik keng bo'lsa, karta shunchalik A7
 * ga yaqin bo'ladi, lekin uy printerlari 5–10 mm ni umuman bosmaydi.
 * Krossvordda o'qituvchi hujjatlarining odatdagi chegarasi.
 */
export const GAME_MARGINS_CM: Record<GameKind, { top: number; right: number; bottom: number; left: number }> = {
  crossword: { top: 2, right: 1.5, bottom: 2, left: 2 },
  flashcards: { top: 1, right: 1, bottom: 1, left: 1 },
  /*
   * AUDIT-22: interaktiv o'yinlarning BOSMA versiyasi — oddiy o'quv
   * varag'i (saralash jadvali, lug'at jadvali), shuning uchun chegara
   * krossvorddagidek. Maketning O'ZI (`planGame` shoxlari) WP-D da.
   */
  sorting: { top: 2, right: 1.5, bottom: 2, left: 2 },
  listening: { top: 2, right: 1.5, bottom: 2, left: 2 },
};

/**
 * Tipografiya — kind bo'yicha (`sizePt` tana matni, `line` interval).
 *
 * Kartada 14 pt / 1,0: old yuzdagi atama uzoqdan o'qilishi kerak va
 * katak balandligi QAT'IY (qator balandligi `exact`) — 1,15 interval
 * 200 belgilik ta'rifni katakdan chiqarib yuborardi. Krossvordda 12 pt
 * / 1,15: savollar ikki ustunda, ular zich bo'lishi kerak.
 */
export const GAME_TYPE: Record<GameKind, { sizePt: number; line: number; tableSizePt: number; smallPt: number }> = {
  crossword: { sizePt: 12, line: 1.15, tableSizePt: 11, smallPt: 9 },
  flashcards: { sizePt: 14, line: 1, tableSizePt: 12, smallPt: 9 },
  // AUDIT-22: jadval asosidagi varaqlar — krossvord tipografiyasi.
  sorting: { sizePt: 12, line: 1.15, tableSizePt: 11, smallPt: 9 },
  listening: { sizePt: 12, line: 1.15, tableSizePt: 11, smallPt: 9 },
};

/** To'rtala vosita ham PORTRET (`GamePlan.landscape` doim `false`). */
export const GAME_LANDSCAPE: Record<GameKind, false> = { crossword: false, flashcards: false, sorting: false, listening: false };

/** Orqa yuz (ta'rif/javob) shrifti — old yuzdan kichik. */
export const CARD_BACK_PT = 10;
/** Misol qatori — eng kichik, kursiv. */
export const CARD_EXAMPLE_PT = 9;
/** Katak ichidagi bo'shliq (mm) — matn kesish chizig'iga tegmasin. */
export const CARD_PAD_MM = 2;

/**
 * Varaq shapkasi (ikki qator, 9 pt) uchun balandlik (mm).
 *
 * QAT'IY son: u HAR betda bir xil joyni egallashi kerak, aks holda
 * old bet bilan orqa bet siljib ketadi (fayl boshidagi izoh).
 */
export const CARD_HEAD_MM = 10;

/**
 * Sahifa raqami uchun zaxira (mm).
 *
 * Ko'ruvchi varag'ida bu `A4.footerPx` (28 px @ 96 dpi = 7,41 mm) va
 * `packPages` shu qadar joyni band deb hisoblaydi. Panjara undan
 * kengroq bo'lsa, ko'ruvchi varaqning pastini KESIB qo'yardi (DOCX da
 * esa kesmasdi) — ya'ni ekran bilan fayl ajralib ketardi.
 */
const FOOTER_MM = 7.4;

const A4_W_MM = 210;
const A4_H_MM = 297;

export type CardCell = { wMm: number; hMm: number; cols: number; rows: number };

/**
 * Bitta karta katagining o'lchami — A7 NISBATIDA, bosiladigan maydonga
 * sig'dirilgan (fayl boshidagi «A7 geometriyasi» izohi).
 *
 * Sof funksiya va EXPORT: `tests/game-layout` uni mustaqil hisoblaydi,
 * `gameProfile` esa chegarani shu yerdan oladi.
 */
export function cardCellMm(margins = GAME_MARGINS_CM.flashcards): CardCell {
  const cols = GAME_LIMITS.cardCols;
  const rows = GAME_LIMITS.cardRows;
  const availW = A4_W_MM - (margins.left + margins.right) * 10;
  const availH = A4_H_MM - (margins.top + margins.bottom) * 10 - FOOTER_MM - CARD_HEAD_MM;
  /*
   * Karta YOTIQ: uzun tomoni (105 mm) bet bo'ylab, kalta tomoni
   * (74 mm) pastga — aynan shu A4 ni sakkizga bo'ladigan yagona
   * joylashuv. Nisbat saqlanadi, o'lcham esa kichrayadi.
   */
  const scale = Math.min(availW / (cols * GAME_LIMITS.cardHeightMm), availH / (rows * GAME_LIMITS.cardWidthMm));
  const floor1 = (v: number) => Math.floor(v * 10) / 10;
  return {
    wMm: floor1(GAME_LIMITS.cardHeightMm * scale),
    hMm: floor1(GAME_LIMITS.cardWidthMm * scale),
    cols,
    rows,
  };
}

/* ══════════════════════════ yorliqlar ══════════════════════════ */

/**
 * FAQAT MAKETGA tegishli so'zlar (uch til).
 *
 * Dvigatel (`flashcards/prompts.ts`) ham shu yerdan o'qiydi: bo'lim
 * sarlavhasi bitta manbadan chiqmasa, hujjatning matni bilan maketning
 * sarlavhasi boshqa-boshqa tilda bo'lib qolardi.
 */
export type GameLayoutWords = {
  docTitle: Record<GameKind, string>;
  /** Bo'lim sarlavhalari (`doc.sections[].title` bo'sh bo'lsa). */
  sectionTitle: Record<string, string>;
  /** Shapkadagi «Mavzu:» yorlig'i (`DocLabels.subject` EMAS — u fan nomi). */
  fieldTopic: string;
  cardsFront: string;
  cardsBack: string;
  duplexHint: string;
  example: string;
  sheetOf: (n: number, total: number) => string;
  figureRef: (n: string) => string;
  clueLine: (n: number, text: string, len: number) => string;
};

const WORDS: Record<"uz" | "ru" | "en", GameLayoutWords> = {
  uz: {
    docTitle: { crossword: "KROSSVORD", flashcards: "FLESH KARTALAR", sorting: "SARALASH O‘YINI", listening: "TINGLASH O‘YINI" },
    sectionTitle: { grid: "To‘r", across: "Gorizontal", down: "Vertikal", answers: "Javoblar", cards: "Kartalar", categories: "Toifalar", items: "Elementlar", words: "So‘zlar", options: "Variantlar" },
    fieldTopic: "Mavzu",
    cardsFront: "old yuzlar",
    cardsBack: "orqa yuzlar",
    duplexHint: "Ikki tomonlama chop eting va varaqni UZUN chekka bo‘ylab aylantiring; so‘ng chiziqlar bo‘yicha kesing.",
    example: "Misol",
    sheetOf: (n, total) => `${n}/${total}-varaq`,
    figureRef: (n) => `${n}-rasm`,
    clueLine: (n, text, len) => `${n}. ${text} (${len})`,
  },
  ru: {
    docTitle: { crossword: "КРОССВОРД", flashcards: "ФЛЕШ-КАРТОЧКИ", sorting: "ИГРА-СОРТИРОВКА", listening: "ИГРА НА СЛУШАНИЕ" },
    sectionTitle: { grid: "Сетка", across: "По горизонтали", down: "По вертикали", answers: "Ответы", cards: "Карточки", categories: "Категории", items: "Элементы", words: "Слова", options: "Варианты" },
    fieldTopic: "Тема",
    cardsFront: "лицевые стороны",
    cardsBack: "обратные стороны",
    duplexHint: "Печатайте двусторонне и переворачивайте лист по ДЛИННОЙ стороне; затем разрежьте по линиям.",
    example: "Пример",
    sheetOf: (n, total) => `Лист ${n}/${total}`,
    figureRef: (n) => `Рис. ${n}`,
    clueLine: (n, text, len) => `${n}. ${text} (${len})`,
  },
  en: {
    docTitle: { crossword: "CROSSWORD", flashcards: "FLASHCARDS", sorting: "SORTING GAME", listening: "LISTENING GAME" },
    sectionTitle: { grid: "Grid", across: "Across", down: "Down", answers: "Answers", cards: "Cards", categories: "Categories", items: "Items", words: "Words", options: "Options" },
    fieldTopic: "Topic",
    cardsFront: "fronts",
    cardsBack: "backs",
    duplexHint: "Print double-sided and flip the sheet on the LONG edge; then cut along the guide lines.",
    example: "Example",
    sheetOf: (n, total) => `Sheet ${n}/${total}`,
    figureRef: (n) => `Fig. ${n}`,
    clueLine: (n, text, len) => `${n}. ${text} (${len})`,
  },
};

export type GameDocLabels = GameLayoutWords & { lang: "uz" | "ru" | "en"; doc: DocLabels };

export function gameLayoutLabels(language: string): GameDocLabels {
  const lang = language === "ru" ? "ru" : language === "en" ? "en" : "uz";
  return { ...WORDS[lang], lang, doc: docLabels(language) };
}

/* ══════════════════════════ bo'lim id lari ══════════════════════════ */

/**
 * Krossvord bo'limlari — WP-A dvigateli bilan SHARTNOMA
 * (`crossword/engine.ts crosswordSections`).
 *
 * `across` va `down` maketda YONMA-YON chiziladi, shuning uchun ular
 * bo'lim sifatida EMAS, bitta `clues` bandi bo'lib chiqadi: ikki
 * mustaqil sarlavha ostidagi ro'yxat bosma krossvordda betning yarmini
 * behuda egallardi.
 */
export const CROSSWORD_SECTIONS = { grid: "grid", across: "across", down: "down", answers: "answers" } as const;

/* ══════════════════════════ bandlar ══════════════════════════ */

/** Hujjat shapkasi — FAQAT krossvordda (kartalarda ataylab bo'sh). */
export type GameHeadItem =
  | { k: "title"; text: string; path: string }
  | { k: "subtitle"; text: string; path: string }
  | { k: "field"; label: string; text: string; path: string };

/** Bitta karta yuzi yoki BO'SH katak (oxirgi varaq to'lmagan). */
export type GameCardFace =
  | {
      k: "card";
      /** Kartaning `model.cards.cards` dagi indeksi — old va orqa yuzda BIR XIL. */
      index: number;
      id: string;
      side: "front" | "back";
      text: string;
      example?: string;
      path: string;
    }
  | { k: "blank" };

/** Bitta BOSMA VARAQ (old yoki orqa yuzlar) — atom band, o'z betida. */
export type GameCardsItem = {
  k: "cards";
  /** Varaq raqami (1 dan) — old va orqa juftligida BIR XIL. */
  sheet: number;
  sheets: number;
  side: "front" | "back";
  /** Varaq shapkasining birinchi qatori (mavzu, varaq, yuz). */
  title: string;
  /** Ikkinchi qator — bosish ko'rsatmasi (HAR betda bir xil). */
  hint: string;
  rows: GameCardFace[][];
  /** Birinchi varaqdan boshqasi YANGI BETDAN. */
  pageBreak: boolean;
  path: string;
};

/** Savollar ro'yxati — IKKI USTUN (DOCX: chegarasiz jadval). */
export type GameCluesItem = {
  k: "clues";
  columns: { title: string; path: string; items: { text: string; path: string }[] }[];
  path: string;
};

export type GameBodyItem =
  | { k: "h1"; text: string; sectionId: string; path: string; pageBreak: boolean }
  | { k: "h3"; text: string; path: string }
  | { k: "p"; text: string; path: string }
  | { k: "li"; text: string; path: string }
  /** Ogohlantirish/ko'rsatma qatori — markazda, qalin. */
  | { k: "note"; text: string; path: string }
  | GameCluesItem
  | GameCardsItem
  /** To'r yoki javob to'ri; PNG bo'lmasa o'rinbosar ramka. */
  | { k: "figure"; figureId: string; figure?: Figure; number: string; caption: string; placeholder: string; path: string };

export type GamePlan = {
  model: GameModel;
  kind: GameKind;
  /** Reyestr tur id (`klassik`/`tarifli`/`term-def`/`qa`). */
  type: string;
  language: string;
  labels: GameDocLabels;
  /** Krossvord shapkasi; KARTALARDA BO'SH (fayl boshidagi izoh). */
  head: GameHeadItem[];
  body: GameBodyItem[];
  /** Bu oilada hujjat jadvali YO'Q — maydon shartnoma uchun (`TeacherPlan`). */
  tables: [];
  /** Yangi betdan boshlanadigan nishonlar (`answers`, `cards:2:front`…). */
  pageBreaks: string[];
  landscape: false;
  page: {
    marginsCm: { top: number; right: number; bottom: number; left: number };
    sizePt: number;
    line: number;
    tableSizePt: number;
    smallPt: number;
    /** Kartalar panjarasi — DOCX katak kengligi ham, ko'ruvchi ham shundan. */
    card: CardCell & { padMm: number; headMm: number; backPt: number; examplePt: number };
  };
  headingAlign: "left";
};

/* ══════════════════════════ yordamchilar ══════════════════════════ */

const clean = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ").trim();

/** Hujjat o'yin oilasiga tegishlimi — `renderDocx`/`docToFlow` shoxi. */
export function isGameDoc(doc: AcademicDoc): boolean {
  return Boolean(doc.game);
}

/**
 * Kartalarni VARAQLARGA bo'lish — old yuzlar tartibida.
 * Oxirgi varaq to'lmasa qolgan kataklar BO'SH (`null`).
 */
export function cardSheets(cards: readonly Flashcard[]): (Flashcard | null)[][] {
  const out: (Flashcard | null)[][] = [];
  for (let i = 0; i < cards.length; i += CARDS_PER_SHEET) {
    const chunk = cards.slice(i, i + CARDS_PER_SHEET);
    out.push([...chunk, ...Array.from({ length: CARDS_PER_SHEET - chunk.length }, () => null)]);
  }
  return out;
}

/**
 * OYNALI tartib — duplex «flip on long edge».
 *
 * Portret varaqning UZUN chekkasi chap/o'ng tomonda: varaq shu chekka
 * bo'ylab aylantirilganda chap ustun o'ngga, o'ng ustun chapga o'tadi,
 * QATORLAR esa o'z joyida qoladi. Ya'ni orqa betda har qatorning
 * ustunlari teskari tartibda yoziladi: `[A B] → [B A]`.
 *
 * Bu funksiya bitta QATORNI aylantiradi (ustun soni ixtiyoriy) —
 * `tests/game-layout` uni alohida ham, butun varaq ustida ham sinaydi.
 */
export function mirrorRow<T>(row: readonly T[]): T[] {
  return [...row].reverse();
}

/** Varaqni qatorlarga ajratadi (`cols` ta ustun). */
function toRows<T>(flat: readonly T[], cols: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < flat.length; i += cols) out.push(flat.slice(i, i + cols));
  return out;
}

/* ══════════════════════════ reja ══════════════════════════ */

export function planGame(doc: AcademicDoc): GamePlan {
  const model = doc.game;
  if (!model) throw new Error("planGame: hujjatda `doc.game` modeli yo‘q (o‘yin vositasi emas)");
  const kind = model.kind;
  const language = model.language || doc.meta.language || "uz";
  const L = gameLayoutLabels(language);
  const spec = gameTypeOf(kind, model.type);

  const head: GameHeadItem[] = [];
  const body: GameBodyItem[] = [];
  const pageBreaks: string[] = [];
  let figureN = 0;

  const titleOf = (id: string): string => clean(doc.sections.find((s) => s.id === id)?.title) || L.sectionTitle[id] || id;

  const pushFigure = (figureId: string, caption: string, path: string) => {
    figureN++;
    const n = String(figureN);
    const figure = (model.figures ?? []).find((f) => f.id === figureId);
    body.push({
      k: "figure",
      figureId,
      ...(figure ? { figure } : {}),
      number: n,
      caption: `${L.figureRef(n)}. ${clean(caption)}`.trim(),
      placeholder: `[${L.figureRef(n)}]`,
      path,
    });
  };

  if (kind === "crossword") planCrossword(model, doc, L, spec.label[L.lang], head, body, pageBreaks, titleOf, pushFigure);
  else if (kind === "flashcards") planCards(model, L, body, pageBreaks);
  else planSectionsOnly(model, doc, L, spec.label[L.lang], head, body, pageBreaks, titleOf);

  return {
    model,
    kind,
    type: model.type,
    language,
    labels: L,
    head,
    body,
    tables: [],
    pageBreaks,
    landscape: false,
    page: {
      marginsCm: GAME_MARGINS_CM[kind],
      ...GAME_TYPE[kind],
      card: {
        ...cardCellMm(GAME_MARGINS_CM.flashcards),
        padMm: CARD_PAD_MM,
        headMm: CARD_HEAD_MM,
        backPt: CARD_BACK_PT,
        examplePt: CARD_EXAMPLE_PT,
      },
    },
    headingAlign: "left",
  };
}

/* ────────────────────────── krossvord ────────────────────────── */

function planCrossword(
  model: GameModel,
  doc: AcademicDoc,
  L: GameDocLabels,
  typeLabel: string,
  head: GameHeadItem[],
  body: GameBodyItem[],
  pageBreaks: string[],
  titleOf: (id: string) => string,
  pushFigure: (figureId: string, caption: string, path: string) => void,
): void {
  head.push({ k: "title", text: L.docTitle.crossword, path: "game.kind" });
  if (typeLabel) head.push({ k: "subtitle", text: typeLabel, path: "game.type" });
  const topic = clean(model.topic) || clean(doc.meta.topic);
  if (topic) head.push({ k: "field", label: L.fieldTopic, text: topic, path: "meta.topic" });

  const sectionAt = (id: string) => {
    const i = doc.sections.findIndex((s) => s.id === id);
    return i < 0 ? null : { i, s: doc.sections[i] };
  };

  /**
   * Bo'lim BLOKLARI — nasr DVIGATELDAN (`crosswordSections`), maket
   * uni QAYTA YOZMAYDI.
   *
   * Kartalardan farqi shu: karta panjarasi tekis MODELDAN chiziladi
   * (nasrda old/orqa yuz ajralmaydi), krossvordda esa ko'rsatma
   * qatorlari, savol matni va javoblar ro'yxati hujjatning O'ZIDA
   * yozilgan matn — maket faqat ularni JOYLASHTIRADI. Shuning uchun
   * `path` ham teacher shartnomasidagidek `sections.<i>.blocks.<j>`.
   */
  const pushBlocks = (id: string) => {
    const at = sectionAt(id);
    if (!at) return;
    at.s.blocks.forEach((b, j) => {
      const path = `sections.${at.i}.blocks.${j}`;
      if (b.kind === "figure") pushFigure(b.figureId, b.text || titleOf(id), path);
      else if (b.kind === "li") body.push({ k: "li", text: clean(b.text), path });
      else if (b.kind === "h3") body.push({ k: "h3", text: clean(b.text), path });
      else body.push({ k: "p", text: clean(b.text), path });
    });
  };

  /* ── to'r: ko'rsatma qatorlari + bo'sh to'r rasmi ── */
  /*
   * To'r bo'limining sarlavhasi HUJJAT NOMINING takrori bo'lsa
   * chizilmaydi.
   *
   * WP-A dvigatelida bu bo'limning yorlig'i «Krossvord»
   * (`crosswordLabels.grid`), ya'ni bosma varaqda «KROSSVORD» ostida
   * yana «Krossvord» turardi — LibreOffice ko'z tekshiruvida darhol
   * ko'rindi. Shart AYNIQSA tor (faqat aynan takror): dvigatel
   * yorlig'ini «To'r» ga o'zgartirsa yoki boshqa tilda boshqacha
   * bo'lsa, sarlavha avvalgidek qoladi (`planTeacher` dagi «Mavzu =
   * Fan» takrori bilan bir xil qaror).
   */
  const gridTitle = titleOf("grid");
  if (gridTitle.toLowerCase() !== L.docTitle.crossword.toLowerCase()) {
    body.push({ k: "h1", text: gridTitle, sectionId: "grid", path: "sections.grid.title", pageBreak: false });
  }
  pushBlocks("grid");

  /* ── savollar: IKKI USTUN yonma-yon (`across` + `down` bitta bandda) ── */
  const column = (id: "across" | "down") => {
    const at = sectionAt(id);
    const cw: CrosswordModel | undefined = model.crossword;
    /*
     * Savol matni BO'LIMDAN olinadi (dvigatel uni «1. Ta'rif (7)»
     * shaklida yozgan). Bo'lim yo'q bo'lsa — modeldan: eski yoki
     * qo'lda yig'ilgan hujjat ham chizilsin.
     */
    const items = at
      ? at.s.blocks.map((b, j) => ({ text: clean(b.text), path: `sections.${at.i}.blocks.${j}` }))
      : (cw?.clues[id] ?? []).map((c, j) => ({ text: L.clueLine(c.number, clean(c.text), c.length), path: `game.crossword.clues.${id}.${j}` }));
    return { title: titleOf(id), path: at ? `sections.${at.i}.title` : `game.crossword.clues.${id}`, items };
  };
  body.push({ k: "clues", columns: [column("across"), column("down")], path: "game.crossword.clues" });

  /* ── javoblar varag'i: YANGI BETDAN (reyestr `answerSeparate` — doim) ── */
  pageBreaks.push("answers");
  body.push({ k: "h1", text: titleOf("answers"), sectionId: "answers", path: "sections.answers.title", pageBreak: true });
  pushBlocks("answers");
}

/* ────────────────────────── saralash / tinglash (AUDIT-22 R0) ────────────────────────── */

/**
 * INTERAKTIV o'yinlarning BOSMA varag'i — hozircha UMUMIY sxema:
 * shapka + bo'limlar tartib bilan, javob kaliti yangi betdan.
 *
 * Nega shunday, «hali maket yo'q» emas: `planGame` — DOCX ning ham,
 * ko'ruvchining ham YAGONA manbasi. Kind uchun shox bo'lmasa, oqim
 * jimgina kartalar panjarasiga tushib ketardi (`else planCards`) va
 * saralash o'yini bo'sh A7 kataklari bo'lib chiqardi — ekran bilan
 * fayl aynan shu yerda ajralardi.
 *
 * WP-D bu funksiyani ALMASHTIRADI: saralashda toifalar JADVALI
 * (ustunlar) va aralash elementlar ro'yxati, tinglashda «so'z —
 * tarjima» lug'at jadvali. Shartnoma o'zgarmaydi: nasr dvigateldan
 * (`doc.sections`), `path` esa `sections.<i>.blocks.<j>`.
 */
function planSectionsOnly(
  model: GameModel,
  doc: AcademicDoc,
  L: GameDocLabels,
  typeLabel: string,
  head: GameHeadItem[],
  body: GameBodyItem[],
  pageBreaks: string[],
  titleOf: (id: string) => string,
): void {
  head.push({ k: "title", text: L.docTitle[model.kind], path: "game.kind" });
  if (typeLabel) head.push({ k: "subtitle", text: typeLabel, path: "game.type" });
  const topic = clean(model.topic) || clean(doc.meta.topic);
  if (topic) head.push({ k: "field", label: L.fieldTopic, text: topic, path: "meta.topic" });

  doc.sections.forEach((s, i) => {
    // Javob kaliti DOIM yangi betdan — o'quvchiga tarqatiladigan varaqda
    // javoblar ko'rinib turmasligi kerak (reyestr skeleti ham shunday).
    const answers = s.id === "answers";
    if (answers) pageBreaks.push(s.id);
    body.push({ k: "h1", text: titleOf(s.id), sectionId: s.id, path: `sections.${i}.title`, pageBreak: answers });
    s.blocks.forEach((b, j) => {
      const path = `sections.${i}.blocks.${j}`;
      if (b.kind === "li") body.push({ k: "li", text: clean(b.text), path });
      else if (b.kind === "h3") body.push({ k: "h3", text: clean(b.text), path });
      else body.push({ k: "p", text: clean(b.text), path });
    });
  });
}

/* ────────────────────────── flesh kartalar ────────────────────────── */

function planCards(model: GameModel, L: GameDocLabels, body: GameBodyItem[], pageBreaks: string[]): void {
  const cards: FlashcardsModel["cards"] = model.cards?.cards ?? [];
  const sheets = cardSheets(cards);
  const total = sheets.length;
  const topic = clean(model.topic);
  const cols = GAME_LIMITS.cardCols;

  sheets.forEach((sheet, s) => {
    const n = s + 1;
    const faceOf = (card: Flashcard | null, index: number, side: "front" | "back"): GameCardFace => {
      if (!card) return { k: "blank" };
      const path = `game.cards.${index}.${side}`;
      if (side === "front") return { k: "card", index, id: card.id, side, text: clean(card.front), path };
      const example = clean(card.example);
      return { k: "card", index, id: card.id, side, text: clean(card.back), ...(example ? { example } : {}), path };
    };

    for (const side of ["front", "back"] as const) {
      const faces = sheet.map((card, j) => faceOf(card, s * CARDS_PER_SHEET + j, side));
      /*
       * ORQA bet: har QATOR ichida ustunlar almashadi (`mirrorRow`),
       * qatorlarning tartibi esa O'ZGARMAYDI — «flip on long edge».
       */
      const rows = toRows(faces, cols).map((row) => (side === "back" ? mirrorRow(row) : row));
      const id = `cards:${n}:${side}`;
      const pageBreak = !(s === 0 && side === "front");
      if (pageBreak) pageBreaks.push(id);
      body.push({
        k: "cards",
        sheet: n,
        sheets: total,
        side,
        title: [topic && `«${topic}»`, L.sheetOf(n, total), side === "front" ? L.cardsFront : L.cardsBack].filter(Boolean).join(" · "),
        hint: L.duplexHint,
        rows,
        pageBreak,
        path: id,
      });
    }
  });
}
