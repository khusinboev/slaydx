/**
 * O'YINLAR (AUDIT-21 R0) — krossvord va flesh kartalarning YAGONA modeli.
 * Izomorf: server/DOM/sharp importi YO'Q (`teacher/types.ts` naqshi).
 *
 * Ikki vosita bitta qobiqda (`games/engine.ts` — WP-A/WP-B), lekin har
 * biri O'Z modeli bilan: krossvordning to'ri bilan kartaning old/orqa
 * yuzi orasida umumiy shakl yo'q va ularni bitta «universal» tuzilmaga
 * tiqish maketni ham, hisobot qoidalarini ham noaniq qilardi.
 *
 * MATN bu yerda YO'Q: hujjat matni odatdagidek `AcademicDoc.sections`
 * da qoladi (`paginate.ts`, `render-docx` bloklari o'zgarmaydi),
 * `GameModel` esa TUZILMA — so'zlar, to'r, savollar, kartalar, hisobot.
 * Tartib va raqamlash ham bu yerda emas: uni `games/layout.ts planGame`
 * (WP-A/WP-B) beradi — DOCX ham, ko'ruvchi ham undan o'qiydi.
 *
 * Reyestr (kind → tur/guidance/JudgeSpec/qoidalar) — `registry.ts`.
 * Manba: `docs/research/{crossword,flashcards}.md` §3–§4.
 */
import type { DocReview, PolishLog, UserNeed } from "../report/types";
import type { Figure } from "../types";

/* ────────────────────────── kind va vosita ────────────────────────── */

export const GAME_KINDS = ["crossword", "flashcards", "sorting", "listening"] as const;
export type GameKind = (typeof GAME_KINDS)[number];

export const isGameKind = (v: unknown): v is GameKind => (GAME_KINDS as readonly string[]).includes(String(v));

/**
 * Vosita id ↔ kind xaritasi — YAGONA manba (`TEACHER_TOOL_IDS` naqshi).
 *
 * `write-llm.ts` dispatchi, `viewerKind`, `budgetFor` va forma shu
 * jadvaldan o'qiydi; ilgari har biri o'z `if` zanjirini yozardi va
 * yangi vosita qo'shilganda ular jimgina ajralib ketardi.
 *
 * Hozircha id va kind BIR XIL yozilgan — bu tasodif, shartnoma emas:
 * 3-dastur (AUDIT-22) `sorting`/`listening` ni qo'shdi va xarita shu
 * yerda qoldi.
 */
export const GAME_TOOL_IDS = {
  crossword: "crossword",
  flashcards: "flashcards",
  sorting: "sorting",
  listening: "listening",
} as const satisfies Record<string, GameKind>;

export type GameToolId = keyof typeof GAME_TOOL_IDS;

/** Vosita id lari — kind tartibida (krossvord → kartalar). */
export const GAME_TOOL_LIST = Object.keys(GAME_TOOL_IDS) as GameToolId[];

/** Teskari yo'nalish: kind → vosita id (havola, `hrefBase`, jonli sinov). */
export const GAME_TOOL_BY_KIND = Object.fromEntries(
  (Object.entries(GAME_TOOL_IDS) as [GameToolId, GameKind][]).map(([tool, kind]) => [kind, tool]),
) as Record<GameKind, GameToolId>;

export const isGameToolId = (v: unknown): v is GameToolId => Object.prototype.hasOwnProperty.call(GAME_TOOL_IDS, String(v));

/* ────────────────────────── krossvord ────────────────────────── */

export const CROSSWORD_DIRS = ["across", "down"] as const;
/** `across` — gorizontal (chapdan o'ngga), `down` — vertikal (yuqoridan pastga). */
export type CrosswordDir = (typeof CROSSWORD_DIRS)[number];

/**
 * To'rga QO'YILGAN so'z.
 *
 * `answer` — MATN emas, KATAK HARFLARI ro'yxati. Bu R5 §6.4 ochiq
 * savolining javobi: o'zbek lotin alifbosidagi `oʻ`, `gʻ` va `ʼ` ikki
 * kod nuqtasidan iborat, lekin krossvord to'rida BITTA katak egallaydi.
 * Agar model javobni satr sifatida bersa va to'r uni `[...str]` bilan
 * ajratsa, «BOGʻ» to'rt katakka cho'zilib, kesishmalar va raqamlash
 * siljib ketardi. Ajratish QOIDASI dvigatelda (`grid.ts cells()`, WP-A)
 * — model esa har doim tayyor ro'yxatni saqlaydi, ya'ni maket, hisobot
 * va ko'ruvchi bir xil kataklarni ko'radi.
 *
 * `row`/`col` — 0 dan boshlanadigan indeks (birinchi katak).
 * `number` — to'rdagi raqam; bitta katakdan ikki so'z boshlansa (biri
 * `across`, biri `down`) IKKALASI ham AYNI raqamni oladi (standart
 * krossvord konvensiyasi, R5 §1).
 */
export type CrosswordWord = {
  id: string;
  /** Katak harflari — apostrofli harf (`oʻ`, `gʻ`) BITTA element. */
  answer: string[];
  clue: string;
  dir: CrosswordDir;
  row: number;
  col: number;
  number: number;
};

/**
 * To'r holati. `cells[row][col]` — katak harfi yoki `null` (qora/bo'sh).
 *
 * Harf `words[].answer` dan KO'CHIRILADI, hisoblanmaydi: ko'ruvchi va
 * javob varag'i to'rni so'zlarni qayta joylashtirmasdan chizishi kerak.
 * Ikkalasining mos kelishi `gridMatchesWords` qoidasi bilan (WP-A
 * `games/review.ts`) tekshiriladi.
 */
export type CrosswordGrid = {
  rows: number;
  cols: number;
  cells: (string | null)[][];
};

/** Savollar ro'yxatidagi bitta band (`number` — to'rdagi raqam). */
export type CrosswordClue = {
  number: number;
  text: string;
  /** `CrosswordWord.id` — javob varag'i shu orqali so'zni topadi. */
  wordId: string;
  /** Katak soni — «(7)» qavsi va `wordLength` qoidasi uchun. */
  length: number;
};

/** To'rga SIG'MAGAN so'z — `delivered` va hisobot izohi uchun. */
export type CrosswordDropped = {
  answer: string[];
  clue: string;
  /**
   * Nega tushib qoldi: `no-fit` — kesishma topilmadi (to'r algoritmi);
   * `too-short`/`too-long` — uzunlik chegarasidan tashqarida;
   * `duplicate` — shu javob allaqachon bor; `bad-letter` — harf emas
   * (raqam, bo'shliq, tinish belgisi).
   */
  reason: "no-fit" | "too-short" | "too-long" | "duplicate" | "bad-letter";
};

export type CrosswordModel = {
  words: CrosswordWord[];
  grid: CrosswordGrid;
  clues: { across: CrosswordClue[]; down: CrosswordClue[] };
  /**
   * LLM bergan, lekin to'rga tushmagan so'zlar.
   *
   * Bo'sh massiv — «hammasi sig'di», ya'ni `delivered` ham to'liq.
   * Maydon ATAYLAB modelda: `deliveredCount` (WP-A) uni hujjatdan
   * QAYTA hisoblaydi va o'shanda forma qiymatlari yo'q — xuddi
   * `GlossaryModel.includeExample` bilan bo'lgani kabi.
   */
  dropped: CrosswordDropped[];
};

/* ────────────────────────── flesh kartalar ────────────────────────── */

export const FLASHCARD_TYPES = ["term-def", "qa"] as const;
/** `term-def` — atama→ta'rif; `qa` — savol→javob (R5 §3; `image-word` — 3-dastur). */
export type FlashcardType = (typeof FLASHCARD_TYPES)[number];

export const isFlashcardType = (v: unknown): v is FlashcardType => (FLASHCARD_TYPES as readonly string[]).includes(String(v));

/** `front` — atama yoki savol; `back` — ta'rif yoki javob (duplex orqa yuzi). */
export type Flashcard = {
  id: string;
  front: string;
  back: string;
  example?: string;
  hint?: string;
};

export type FlashcardsModel = {
  type: FlashcardType;
  cards: Flashcard[];
  /**
   * Misol qatori SO'RALGANMI (`includeExample` formasi).
   *
   * `GlossaryModel.includeExample` bilan AYNI sabab: `examplePresence`
   * qoidasi bu bayroqsiz javob bera olmaydi — misolsiz to'plam
   * «foydalanuvchi misol so'ramagan» ham, «model misol bermagan» ham
   * bo'lishi mumkin, birinchisi yashil, ikkinchisi sariq. Hisobot esa
   * hujjatdan QAYTA hisoblanadi (tahrirdan keyin ham) va o'shanda forma
   * qiymatlari yo'q.
   */
  includeExample?: boolean;
};

/* ────────────────────────── saralash o'yini ────────────────────────── */

/**
 * Bitta toifa va unga tegishli elementlar (`sorting-game.md` §3).
 *
 * `id` ATAYLAB bor: o'yinchi javobi (`game_results.answers_json`) va ball
 * hisobi (`lib/game/score.ts`) element → TOIFA id ini yozadi, NOMINI
 * emas. Nom tahrirda o'zgarishi mumkin va o'shanda eski natijalar
 * jadvali «Sut emizuvchilar» ni topa olmasdan hammasini xato deb
 * sanardi.
 */
export type SortingCategory = {
  id: string;
  name: string;
  items: string[];
};

export type SortingModel = {
  categories: SortingCategory[];
};

/* ────────────────────────── tinglash o'yini ────────────────────────── */

/**
 * Bitta tinglash topshirig'i (`listening-game.md` §3).
 *
 * `text` — EShITILADIGAN matn (o'rganiladigan tilda): TTS aynan shuni
 * aytadi. `options` — ona tilidagi variantlar (3–4 ta), `answer` esa
 * ularning INDEKSI.
 *
 * Nega indeks, matn emas: o'yinchi tomoni variantlarni ARALASHTIRIB
 * ko'rsatadi va javobni indeks bilan yuboradi; to'g'ri javob matn
 * sifatida saqlansa, uni ochiq JSON dan yashirish uchun modelning
 * o'zini qayta yozish kerak bo'lardi (`publicGameView` esa faqat
 * MAYDON tashlaydi). Mutatsiya: `answer` ni ochiq ko'rinishga qo'shish
 * `tests/game-public.test.mts` da darrov qizaradi.
 */
export type ListeningItem = {
  id: string;
  /** Eshitiladigan so'z/ibora — `targetLanguage` da. */
  text: string;
  /** Variantlar — `nativeLanguage` da; biri to'g'ri, qolgani distraktor. */
  options: string[];
  /** To'g'ri variantning indeksi (`options` ichida). */
  answer: number;
  /**
   * TTS parchasi aktivga chiqarilgandan keyingi id (`putAssetBytes`).
   *
   * WP-A gacha (kalitlar yo'q) — `undefined`: bosma versiya (lug'at
   * varag'i) baribir chiqadi, interaktiv rejimda esa o'yinchi tomoni
   * audio yo'qligini ko'rsatadi.
   */
  audioAssetId?: string;
};

export type ListeningModel = {
  items: ListeningItem[];
  /** Variantlar tili (o'quvchining ona tili). */
  nativeLanguage: string;
  /** Eshitiladigan matn tili — TTS ovozi SHU kod bo'yicha tanlanadi. */
  targetLanguage: string;
};

/* ────────────────────────── model ────────────────────────── */

export type GameModel = {
  v: 1;
  kind: GameKind;
  /** Reyestr TUR id (`registry.ts gameTypeOf`) — `klassik`, `tarifli`, `term-def`, `qa`. */
  type: string;
  /** Hujjat tili (18 til) — savol/karta matni shu tilda. */
  language: string;
  /** Mavzu (fayl rejimida — manbadan olingan sarlavha). */
  topic: string;
  crossword?: CrosswordModel;
  cards?: FlashcardsModel;
  /** Saralash o'yini (AUDIT-22): toifalar va ularning elementlari. */
  sorting?: SortingModel;
  /** Tinglash o'yini (AUDIT-22): eshitiladigan matn + variantlar. */
  listening?: ListeningModel;
  /**
   * Chizilgan rasmlar reyestri (krossvord to'ri va javob to'ri).
   *
   * `Block kind:"figure"` `figureId` orqali SHU ro'yxatga ishora qiladi
   * — `article`/`work`/`teacher` bilan bir xil naqsh. Nega modelda,
   * blok ichida emas: PNG `data:` URL i kilobaytlar bilan o'lchanadi va
   * uni matn bloki ichida saqlash `sections` ni ham tahrirda, ham
   * qidiruvda og'irlashtirardi; `assets.ts` esa aynan shu ro'yxatdan
   * baytni aktivga chiqaradi.
   */
  figures?: Figure[];
  review?: DocReview;
  polish?: PolishLog;
  /** «Sizdan kutiladi» — AI o'ylab topmaydigan ma'lumot (hisobot paneli). */
  userNeeds?: UserNeed[];
};

/* ────────────────────────── chegaralar ────────────────────────── */

/**
 * Butun oila uchun QATTIQ chegaralar (kirish kesish, to'r algoritmi,
 * hisobot qoidalari). Tur bo'yicha nozik chegaralar — REYESTRDA.
 *
 * Raqamlar `docs/research/{crossword,flashcards}.md` §3–§4 dan va bu
 * yerda QULFLANADI (`tests/game-registry.test.mts`).
 */
export const GAME_LIMITS = {
  /* ── krossvord: so'z ── */
  /** R5 §1 (CommuniCrossings): eng qisqa so'z 3 harf. */
  wordLettersMin: 3,
  /**
   * 15 harf — 21×21 to'rning bir yo'nalishiga kafolatli sig'adigan eng
   * uzun so'z (chekkada 3 katak zaxira bilan). Undan uzun so'z har doim
   * `dropped` ga tushardi, ya'ni uni umuman so'ramagan ma'qul.
   */
  wordLettersMax: 15,
  /** Savol uzunligi (belgi) — R5 §4 `clueLength`. */
  clueCharsMin: 10,
  clueCharsMax: 150,

  /* ── krossvord: to'r ── */
  /** To'r o'lchami TOQ va shu oraliqda (R5 §1: 13×13 … 21×21). */
  gridMin: 13,
  gridMax: 21,
  /** Kesishma: har so'z kamida shuncha joyda boshqasini kesib o'tadi. */
  minCrossingsPerWord: 1,
  /** `minCrossings` qoidasi: jami kesishma ≥ so'z soni × shu ulush. */
  crossingRatio: 0.5,

  /* ── umumiy: element soni ── */
  /** Formadagi chiplar (krossvord so'zi va karta soni — bir xil, R5 §3). */
  counts: [5, 10, 15, 20] as readonly number[],
  countDefault: 10,
  countMin: 5,
  countMax: 20,

  /* ── flesh kartalar ── */
  /** Old yuz (atama/savol) — R5 §4 `frontLength`. */
  cardFrontCharsMin: 5,
  cardFrontCharsMax: 50,
  /** Orqa yuz (ta'rif/javob) — R5 §4 `backLength`. */
  cardBackCharsMin: 20,
  cardBackCharsMax: 200,
  /** Misol qatori (`includeExample`) — orqa yuzga sig'ishi kerak. */
  cardExampleCharsMax: 120,
  /** A7 karta (mm) va A4 dagi panjara — R5 §1 (ISO). */
  cardWidthMm: 74,
  cardHeightMm: 105,
  cardCols: 2,
  cardRows: 4,
  /** `includeExample=true` bo'lsa kamida shuncha ulush kartada misol bo'lsin. */
  exampleCoverage: 0.5,

  /* ── saralash o'yini (AUDIT-22, `sorting-game.md` §3) ── */
  /** Toifalar soni: 2–6 (formadagi chiplar). */
  categoryCounts: [2, 3, 4, 5, 6] as readonly number[],
  categoryCountDefault: 4,
  categoryCountMin: 2,
  categoryCountMax: 6,
  /** Har toifadagi element soni: 3–8. */
  itemsPerCategoryCounts: [3, 4, 5, 6, 8] as readonly number[],
  itemsPerCategoryDefault: 5,
  itemsPerCategoryMin: 3,
  itemsPerCategoryMax: 8,
  /** Toifa nomi va element matni — ekranda tugma, bosma versiyada jadval katagi. */
  categoryNameCharsMin: 3,
  categoryNameCharsMax: 40,
  sortItemCharsMin: 1,
  sortItemCharsMax: 40,

  /* ── tinglash o'yini (AUDIT-22, `listening-game.md` §3) ── */
  /**
   * Topshiriqlar soni: 10/15/20.
   *
   * Krossvord/kartadagi `counts` (5/10/15/20) dan FARQ QILADI va bu
   * ataylab: har topshiriq TTS chaqiruvi, ya'ni 5 talik to'plam
   * tannarxni oqlamaydi, 20 dan ortig'i esa byudjetga sig'maydi
   * (`gameBudgetMs`).
   */
  listeningCounts: [10, 15, 20] as readonly number[],
  listeningCountDefault: 10,
  listeningCountMin: 10,
  listeningCountMax: 20,
  /** Variantlar soni: 3–4 (`listening-game.md` §3 — 3 distraktor). */
  listeningOptionsMin: 3,
  listeningOptionsMax: 4,
  listeningOptionsDefault: 4,
  /** Eshitiladigan matn — so'z yoki qisqa ibora (TTS bo'lagiga bemalol sig'adi). */
  listeningTextCharsMin: 2,
  listeningTextCharsMax: 60,

  /* ── umumiy kirish ── */
  topicChars: 300,
  extraChars: 1500,
  sourceTextChars: 24_000,
} as const;

/** Bitta A4 betga sig'adigan karta soni (2 × 4 = 8). */
export const CARDS_PER_SHEET = GAME_LIMITS.cardCols * GAME_LIMITS.cardRows;

/** Ruxsat etilgan element soni; noma'lum qiymat → standart 10. */
export function normalizeGameCount(v: unknown): number {
  const n = Number(v);
  return GAME_LIMITS.counts.includes(n) ? n : GAME_LIMITS.countDefault;
}

/** Toifalar soni (2–6); noma'lum qiymat → standart 4. */
export function normalizeCategoryCount(v: unknown): number {
  const n = Number(v);
  return GAME_LIMITS.categoryCounts.includes(n) ? n : GAME_LIMITS.categoryCountDefault;
}

/** Toifadagi element soni (3–8); noma'lum qiymat → standart 5. */
export function normalizeItemsPerCategory(v: unknown): number {
  const n = Number(v);
  return GAME_LIMITS.itemsPerCategoryCounts.includes(n) ? n : GAME_LIMITS.itemsPerCategoryDefault;
}

/** Tinglash topshiriqlari soni (10/15/20); noma'lum qiymat → standart 10. */
export function normalizeListeningCount(v: unknown): number {
  const n = Number(v);
  return GAME_LIMITS.listeningCounts.includes(n) ? n : GAME_LIMITS.listeningCountDefault;
}

/*
 * `gamePromisedCount` — AUDIT-22 R: BU YERDA EMAS, `registry.ts` da.
 *
 * Saralashda «qarama-qarshi juftlik» turi toifa sonini 2 ga QULFLAYDI
 * (`gameTypeOf("sorting", …).limits.categories`), ya'ni va'da TURNI
 * bilishi kerak. Reyestr shu spetsifikatsiyaning yagona manbai va bu
 * modul (`types.ts`) reyestrni import qila olmaydi (`registry.ts`
 * allaqachon BU fayldan `GAME_LIMITS`ni import qiladi — teskari yo'nalish
 * doiraviy import va, agar bu fayl birinchi yuklansa, `registry.ts`
 * modul darajasidagi `SORTING_LIMITS` konstantasi hali ishga
 * tushirilmagan `GAME_LIMITS` ga tegib TDZ xatosini berardi).
 */

/**
 * To'r o'lchami TOQ bo'lishi kerak (R5 §1) — raqamlash va markaziy
 * ustun/qator shu bilan barqaror bo'ladi. Chegaradan tashqaridagi qiymat
 * kesiladi, juft son yuqoriga yaxlitlanadi.
 */
export function normalizeGridSize(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return GAME_LIMITS.gridMax;
  const clamped = Math.min(GAME_LIMITS.gridMax, Math.max(GAME_LIMITS.gridMin, n));
  return clamped % 2 === 0 ? clamped + 1 : clamped;
}
