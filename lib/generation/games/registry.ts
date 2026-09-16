/**
 * KIND × TUR REYESTRI (AUDIT-21 R0) — `teacher/registry.ts` naqshi.
 *
 * Reyestr — dvigatelning SPETSIFIKATSIYASI. To'rt joyda o'qiladi:
 * (1) promptlar (`games/prompts.ts` — «TYPE RULES» = `guidance`),
 * (2) dvigatel (`games/engine.ts`, `crossword/grid.ts`),
 * (3) hisobot (`games/review.ts` — `GAME_RULE_IDS` va `judge`),
 * (4) forma (`lib/tools.ts` chiplari — `label`, `limits`).
 *
 * Manba: `docs/research/{crossword,flashcards}.md` §3 «bizga tavsiya:
 * reyestr» va §4 «sifat mezonlari». Raqamlar shu hisobotlardan; ular bu
 * yerda QULFLANADI (`tests/game-registry.test.mts`).
 *
 * Har kind ro'yxatining BIRINCHI elementi — shu kindning STANDART turi
 * (noma'lum/bo'sh tur shunga tushadi, `gameTypeOf`).
 */
import type { JudgeSpec } from "../report/types";
import { GAME_LIMITS, GAME_TOOL_IDS, isGameToolId, type FlashcardType, type GameKind } from "./types";

/* ══════════════════════════ umumiy shakl ══════════════════════════ */

export type GameLabel = { uz: string; ru: string; en: string };

type TypeBase<K extends GameKind> = {
  kind: K;
  id: string;
  label: GameLabel;
  /** Formadagi bir qatorli izoh (uz). */
  hint: string;
  /**
   * Hujjat SKELETI — bo'limlar tartibda (uz). `planGame` (WP-A/WP-B) shu
   * ro'yxat bo'yicha chizadi, hisobot esa yo'q bo'limni ko'rsatadi.
   */
  skeleton: readonly string[];
  /** Yozish qoidalari (en, 3–5 qator) — tizim promptining «TYPE RULES» i. */
  guidance: readonly string[];
};

/* ══════════════════════════ baholovchi ══════════════════════════ */

const CROSSWORD_JUDGE_ROLE = "a subject teacher checking a printable classroom crossword before handing it to pupils";
const CARDS_JUDGE_ROLE = "a subject teacher checking a set of printable revision flashcards prepared for their own pupils";

/** R5 (`crossword.md`) §4 — beshta mezon. */
export const CROSSWORD_JUDGE_CRITERIA = ["clueClarity", "wordGrade", "gridConnectedness", "answerAccuracy", "originality"] as const;
export type CrosswordJudgeCriterion = (typeof CROSSWORD_JUDGE_CRITERIA)[number];

const CROSSWORD_JUDGE_LABELS: Record<CrosswordJudgeCriterion, string> = {
  clueClarity: "Savollarning aniqligi",
  wordGrade: "So'zlarning sinf/fanga mosligi",
  gridConnectedness: "To'rning bog'langanligi",
  answerAccuracy: "Savol ↔ javob mosligi",
  originality: "Savollarning mustaqilligi",
};

const CROSSWORD_JUDGE_DESCRIBE: Record<CrosswordJudgeCriterion, string> = {
  clueClarity:
    "is every clue a direct definition, synonym or description that points at ONE answer? School crosswords are not cryptic: wordplay, anagrams and «hidden word» tricks are defects here, and so is a clue so broad that three different subject terms would fit it.",
  wordGrade: "are the answers terms a pupil of the stated grade and subject has actually met, rather than specialist vocabulary or random dictionary words?",
  gridConnectedness: "do the placed words form one connected figure — at most one or two words touching nothing else — so the grid reads as a crossword and not as separate word strips?",
  answerAccuracy: "does each clue match its answer EXACTLY, including spelling and word form? A clue describing the plural while the answer is singular is a failure.",
  originality: "spot-check two or three clues: are they written for this topic, or copy-pasted opening lines from a dictionary/encyclopedia entry?",
};

/** R5 (`flashcards.md`) §4 — beshta mezon. */
export const CARDS_JUDGE_CRITERIA = ["termClarity", "definitionCompleteness", "languageLevel", "exampleRelevance", "memorability"] as const;
export type CardsJudgeCriterion = (typeof CARDS_JUDGE_CRITERIA)[number];

const CARDS_JUDGE_LABELS: Record<CardsJudgeCriterion, string> = {
  termClarity: "Old yuzning aniqligi",
  definitionCompleteness: "Orqa yuzning to'liqligi",
  languageLevel: "Til darajasining mosligi",
  exampleRelevance: "Misolning bog'liqligi",
  memorability: "Eslab qolinishi",
};

const CARDS_JUDGE_DESCRIBE: Record<CardsJudgeCriterion, string> = {
  termClarity: "is the front side unambiguous and self-contained — one term or one complete question, not a fragment that only makes sense next to the back side?",
  definitionCompleteness: "does the back fully define or answer the front on its own? A pupil holding only the back side must still learn something.",
  languageLevel: "is the vocabulary appropriate for the stated grade and subject, with no unexplained jargon on either side?",
  exampleRelevance: "where an example is present, does it USE the term in a natural sentence rather than restating the definition in other words?",
  memorability: "is the back short enough to memorise — one or two sentences, not a paragraph that the pupil will re-read instead of recall?",
};

type JudgeOpts<C extends string> = { describe?: Partial<Record<C, string>>; skip?: readonly C[] };

function specOf<C extends string>(
  criteria: readonly C[],
  describe: Record<C, string>,
  labels: Record<C, string>,
  roleLine: string,
  typeNoun: string,
  typeLabel: string,
  o: JudgeOpts<C> = {},
): JudgeSpec<C> {
  return {
    criteria,
    describe: { ...describe, ...(o.describe ?? {}) },
    labels,
    ...(o.skip?.length ? { skip: o.skip } : {}),
    roleLine,
    typeLabel,
    typeNoun,
  };
}

const crosswordJudge = (typeLabel: string, o?: JudgeOpts<CrosswordJudgeCriterion>) =>
  specOf(CROSSWORD_JUDGE_CRITERIA, CROSSWORD_JUDGE_DESCRIBE, CROSSWORD_JUDGE_LABELS, CROSSWORD_JUDGE_ROLE, "crossword type", typeLabel, o);
const cardsJudge = (typeLabel: string, o?: JudgeOpts<CardsJudgeCriterion>) =>
  specOf(CARDS_JUDGE_CRITERIA, CARDS_JUDGE_DESCRIBE, CARDS_JUDGE_LABELS, CARDS_JUDGE_ROLE, "card type", typeLabel, o);

/* ══════════════════════════ tur shakllari ══════════════════════════ */

export type CrosswordTypeSpec = TypeBase<"crossword"> & {
  limits: {
    /** So'z soni chiplari va standarti (narxga TA'SIR QILMAYDI). */
    words: readonly number[];
    wordsDefault: number;
    /** Javob uzunligi (katak) [min, max]. */
    letters: readonly [number, number];
    /** Savol uzunligi (belgi) [min, max]. */
    clueChars: readonly [number, number];
    /** Javob varag'i alohida betdan boshlanadimi (R5 §3 — doim ha). */
    answerSeparate: boolean;
  };
  judge: JudgeSpec<CrosswordJudgeCriterion>;
};

export type CardsTypeSpec = TypeBase<"flashcards"> & {
  /** Model turi (`FlashcardsModel.type`) — reyestr id si bilan AYNI. */
  cardType: FlashcardType;
  limits: {
    cards: readonly number[];
    cardsDefault: number;
    frontChars: readonly [number, number];
    backChars: readonly [number, number];
    /** Shu turda misol qatori standart bo'yicha so'raladimi. */
    includeExampleDefault: boolean;
  };
  judge: JudgeSpec<CardsJudgeCriterion>;
};

export type GameTypeSpec = CrosswordTypeSpec | CardsTypeSpec;

type SpecByKind = {
  crossword: CrosswordTypeSpec;
  flashcards: CardsTypeSpec;
};

/* ══════════════════════════ skeletlar ══════════════════════════ */

const CROSSWORD_SKELETON = [
  "Sarlavha (mavzu, fan, sinf)",
  "To'r (raqamlangan kataklar)",
  "Gorizontal savollar",
  "Vertikal savollar",
  "Javoblar varag'i (yangi betdan)",
] as const;

const CARDS_SKELETON = [
  "Sarlavha (mavzu, fan, sinf)",
  "Bosish ko'rsatmasi (ikki tomonlama, uzun chekka bo'ylab)",
  "Old yuzlar varag'i (2 × 4)",
  "Orqa yuzlar varag'i (oynali tartib)",
] as const;

/* ══════════════════════════ turlar ══════════════════════════ */

const CROSSWORD_COUNTS = GAME_LIMITS.counts;
const CROSSWORD_LETTERS = [GAME_LIMITS.wordLettersMin, GAME_LIMITS.wordLettersMax] as const;
const CROSSWORD_CLUE_CHARS = [GAME_LIMITS.clueCharsMin, GAME_LIMITS.clueCharsMax] as const;

const CROSSWORD_TYPES: readonly CrosswordTypeSpec[] = [
  {
    kind: "crossword",
    id: "klassik",
    label: { uz: "Klassik", ru: "Классический", en: "Classic" },
    hint: "Sinonim yoki qisqa tavsif — eng keng tarqalgan maktab krossvordi",
    skeleton: CROSSWORD_SKELETON,
    limits: {
      words: CROSSWORD_COUNTS,
      wordsDefault: GAME_LIMITS.countDefault,
      letters: CROSSWORD_LETTERS,
      clueChars: CROSSWORD_CLUE_CHARS,
      answerSeparate: true,
    },
    guidance: [
      "Classic school crossword: each clue is a short synonym or a one-line description of the answer, the way a pupil would explain the word to a classmate.",
      "Never use cryptic devices — no anagrams, no hidden words, no «sounds like». Difficulty must come from the subject content, not from decoding the clue.",
      "Answers are single words in the output language, written without spaces, hyphens, digits or punctuation; a two-word term is replaced by a one-word equivalent or dropped.",
      "Vary the answer lengths: a set where every word has six letters produces a grid with almost no crossings.",
    ],
    judge: crosswordJudge("Classic school crossword"),
  },
  {
    kind: "crossword",
    id: "tarifli",
    label: { uz: "Ta'rifli", ru: "С определениями", en: "Definition-based" },
    hint: "Savol — atamaning to'liq ta'rifi; darslik atamalarini mustahkamlash uchun",
    skeleton: CROSSWORD_SKELETON,
    limits: {
      words: CROSSWORD_COUNTS,
      wordsDefault: GAME_LIMITS.countDefault,
      letters: CROSSWORD_LETTERS,
      // Ta'rif sinonimdan uzunroq — pastki chegara ko'tarilgan (R5 §3).
      clueChars: [40, GAME_LIMITS.clueCharsMax] as const,
      answerSeparate: true,
    },
    guidance: [
      "Definition crossword: each clue is a complete textbook-style definition of the term, stating its category and its distinguishing feature.",
      "The definition must single out ONE term: «a living organism» fits hundreds of answers and is a defect; «the green pigment that captures light in a leaf» fits one.",
      "Keep every definition inside one sentence — the clue list is printed in two columns and a three-line clue breaks the layout.",
      "Do not begin the definition with the answer itself or with an obvious word-form of it.",
    ],
    judge: crosswordJudge("Definition-based crossword", {
      describe: {
        clueClarity: "is each clue a complete, textbook-style definition that identifies exactly one term (category + distinguishing feature), rather than a loose association?",
      },
    }),
  },
];

const CARDS_COUNTS = GAME_LIMITS.counts;
const CARDS_FRONT = [GAME_LIMITS.cardFrontCharsMin, GAME_LIMITS.cardFrontCharsMax] as const;
const CARDS_BACK = [GAME_LIMITS.cardBackCharsMin, GAME_LIMITS.cardBackCharsMax] as const;

const CARDS_TYPES: readonly CardsTypeSpec[] = [
  {
    kind: "flashcards",
    id: "term-def",
    cardType: "term-def",
    label: { uz: "Atama — ta'rif", ru: "Термин — определение", en: "Term — definition" },
    hint: "Old yuzda atama, orqa yuzda ta'rif — lug'at va fan atamalari uchun",
    skeleton: CARDS_SKELETON,
    limits: {
      cards: CARDS_COUNTS,
      cardsDefault: GAME_LIMITS.countDefault,
      frontChars: CARDS_FRONT,
      backChars: CARDS_BACK,
      includeExampleDefault: false,
    },
    guidance: [
      "Term–definition cards: the front carries ONLY the term, with no article, no explanation and no punctuation beyond what the term itself needs.",
      "The back defines the term so that a pupil reading it alone understands the concept: category first, then the distinguishing feature.",
      "Never repeat the term as the first word of its own definition — the pupil is trying to recall it.",
      "Where the term has a standard textbook formula or unit, put it on the back; that is what makes the card worth carrying.",
    ],
    judge: cardsJudge("Term–definition cards"),
  },
  {
    kind: "flashcards",
    id: "qa",
    cardType: "qa",
    label: { uz: "Savol — javob", ru: "Вопрос — ответ", en: "Question — answer" },
    hint: "Old yuzda savol, orqa yuzda javob — takrorlash va imtihonga tayyorgarlik",
    skeleton: CARDS_SKELETON,
    limits: {
      cards: CARDS_COUNTS,
      cardsDefault: GAME_LIMITS.countDefault,
      frontChars: CARDS_FRONT,
      backChars: CARDS_BACK,
      includeExampleDefault: false,
    },
    guidance: [
      "Question–answer cards: the front is ONE complete question ending in a question mark, answerable without seeing the back.",
      "Ask about one fact per card. A question with «and» in it produces a card the pupil can get half-right, which teaches nothing.",
      "The answer states the fact and, in one short clause, WHY it is so — recall without the reason does not survive the exam.",
      "Avoid yes/no questions: a card with two possible answers is guessed, not learned.",
    ],
    judge: cardsJudge("Question–answer cards", {
      describe: {
        termClarity: "is the front ONE complete question, ending in a question mark, that a pupil can answer without seeing the back?",
      },
    }),
  },
];

export const GAME_TYPES: { [K in GameKind]: readonly SpecByKind[K][] } = {
  crossword: CROSSWORD_TYPES,
  flashcards: CARDS_TYPES,
};

/* ══════════════════════════ hisobot qoidalari ══════════════════════════ */

/**
 * Deterministik hisobot qoidalari — hisobotlar §4 dagi `ReviewCheck`
 * id lari. BU YERDA faqat NOMLAR: implementatsiya WP-A/WP-B
 * (`games/review.ts`) da. Ro'yxat shu yerda, chunki hujjat paneli qaysi
 * bandlar bo'lishini oldindan bilishi kerak, va chunki qoidani unutib
 * qo'yish testda ko'rinadi.
 *
 * `gridMatchesWords` hisobotda YO'Q edi — WP-A uchun qo'shildi:
 * `CrosswordGrid.cells` `words[].answer` dan ko'chiriladi va ikkalasi
 * jimgina ajralib ketsa, ko'ruvchi bilan javob varag'i boshqa-boshqa
 * to'r ko'rsatardi.
 */
export const GAME_RULE_IDS: Record<GameKind, readonly string[]> = {
  crossword: ["wordCount", "gridSize", "minCrossings", "wordLength", "clueLength", "uniqueWords", "answerSheet", "gridMatchesWords", "clueNotContainsAnswer", "gridConnected"],
  flashcards: ["cardCount", "frontLength", "backLength", "noDuplicate", "examplePresence", "cardTypeMatch"],
};

/* ══════════════════════════ kirish nuqtalari ══════════════════════════ */

/** Vosita id → kind; o'yin vositasi bo'lmasa `null`. */
export function gameKindOf(toolId: string): GameKind | null {
  return isGameToolId(toolId) ? GAME_TOOL_IDS[toolId] : null;
}

/** Kindning barcha turlari (forma tartibida; birinchisi — standart). */
export function gameTypesOf<K extends GameKind>(kind: K): readonly SpecByKind[K][] {
  return GAME_TYPES[kind];
}

/** Kind × tur; noma'lum/bo'sh tur → kindning STANDART turi (birinchisi). */
export function gameTypeOf<K extends GameKind>(kind: K, id: unknown): SpecByKind[K] {
  const list = GAME_TYPES[kind] as readonly SpecByKind[K][];
  const want = String(id ?? "").trim();
  return list.find((t) => t.id === want) ?? list[0];
}

/** Kindning standart tur id si (forma va dvigatel bir xil qoidadan o'qisin). */
export function gameDefaultTypeId(kind: GameKind): string {
  return GAME_TYPES[kind][0].id;
}

/** Noma'lum tur → standart id (`normalizeTeacherType` naqshi). */
export function normalizeGameType(kind: GameKind, v: unknown): string {
  return gameTypeOf(kind, v).id;
}
