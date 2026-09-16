/**
 * KROSSVORD PROMPTLARI (AUDIT-21 WP-A).
 *
 * MODEL FAQAT SO'Z + TA'RIF BERADI. To'r, koordinata, raqam, kesishma —
 * hech qaysisi promptda YO'Q va javobda kutilmaydi: ularni `grid.ts`
 * quradi. Nega shunday bo'lindi: modeldan koordinata so'ralganda javob
 * ko'pincha o'zi bilan zid bo'ladi (kesishgan katakda ikki xil harf),
 * to'rni esa baribir biz qayta tekshirishimiz kerak — demak modeldan
 * faqat TIL ishini so'raymiz, geometriyani o'zimiz qilamiz.
 *
 * Tizim prompti INGLIZCHA (`teacher/test/prompts.ts` bilan bir xil
 * qaror: ko'rsatmalar ingliz tilida barqarorroq bajariladi), CHIQISH
 * tili esa `languageDirective` bilan qat'iy belgilanadi.
 *
 * Ikki rejim (§3): `topic` — mavzudan; `file` — FAQAT yuklangan
 * manbadagi atamalardan.
 */
import { languageDirective } from "../../i18n";
import { sourceBlock } from "../../prompts";
import type { DocMeta } from "../../types";
import type { CrosswordTypeSpec } from "../registry";
import { CROSSWORD_LIMITS, type CrosswordInput } from "./input";

/**
 * Yaxshi/yomon ta'rif MISOLLARI — `docs/research/crossword.md` §5 dan.
 *
 * Nega promptda: «aniq ta'rif yozing» ko'rsatmasi o'zi yetmaydi — jonli
 * sinovlarda modellar «Narsalarni o'rgangani» tipidagi, o'nlab so'zga
 * mos keladigan umumiy ta'riflarni beraveradi.
 */
const EXAMPLES = [
  "GOOD: «Tirik organizmlarni o'rganadigan fan» = BIOLOGIYA — a precise definition tied to the topic.",
  "GOOD: «Katta o'quv muassasasi» = UNIVERSITET — a clear synonym, only one word fits.",
  "BAD:  «Narsalarni o'rgangani» = BIOLOGIYA — so vague that ten other words fit.",
  "BAD:  «To'rt harfli ovqat» = PALOV — never describe the word's spelling or letter count.",
  "BAD:  «Biologiya — bu qanday fan?» = BIOLOGIYA — the clue contains the answer itself.",
  "BAD:  «Rim mifologiyasidagi ilm xudosi» = MARS — cryptic/associative clues do not belong in a school crossword.",
];

/**
 * Tizim prompti — bir marta quriladi va qo'shimcha so'rovda ham QAYTA
 * ishlatiladi (prompt keshi va barqarorlik uchun).
 */
export function crosswordSystemPrompt(input: CrosswordInput, spec: CrosswordTypeSpec): string {
  const gradeLine = input.grade >= 1 ? `grade ${input.grade} (Uzbek general secondary school)` : "general secondary school";
  // Tur chegaralari REYESTRDAN: «ta'rifli» krossvordda ta'rif pastki
  // chegarasi 40 belgi (sinonim emas, to'liq ta'rif) — promptda ikkinchi
  // nusxa yozilmaydi, aks holda reyestr bilan ajralib ketardi.
  const [letMin, letMax] = spec.limits.letters;
  const [clueMin, clueMax] = spec.limits.clueChars;
  return [
    languageDirective(input.language),
    "You are a teacher compiling the WORD LIST for a printed classroom crossword.",
    `CROSSWORD TYPE: ${spec.label.en} · SUBJECT: ${input.subject || "from the topic"} · LEVEL: ${gradeLine}.`,
    "",
    "YOU DO NOT BUILD THE GRID. Return only words and their clues — the placement, numbering and intersections are computed by the program.",
    "",
    "TYPE RULES:",
    ...spec.guidance.map((g) => `— ${g}`),
    "",
    "ANSWER RULES:",
    `— every answer is ONE word of ${letMin}–${letMax} letters: no spaces, no hyphens, no digits, no abbreviations with dots;`,
    "— nouns in the dictionary (base) form; no proper names unless the topic is history or geography;",
    "— in Uzbek Latin write the letters oʻ and gʻ with the proper apostrophe (oʻsimlik, gʻalla), never as ou/gh;",
    "— never repeat the same answer, and never use two words with the same root (kitob / kitobxon);",
    "— every answer belongs to the stated topic and is a term the pupils of this grade have met.",
    "",
    "CLUE RULES:",
    `— every clue is ${clueMin}–${clueMax} characters: a direct definition or a synonym, never cryptic or associative;`,
    "— the clue must NOT contain the answer, its root, or a translation of it;",
    "— never describe the spelling: no «to'rt harfli…», no «… bilan boshlanadi»;",
    "— one clue fits exactly ONE answer: if another word of the same length also fits, make the clue more precise;",
    "— no option-style wording («hammasi to'g'ri», «quyidagilardan qaysi biri»), this is not a test;",
    "— the clue is a phrase, not a full question with a question mark.",
    "",
    "EXAMPLES:",
    ...EXAMPLES,
    "",
    'Answer with JSON only: {"words":[{"answer":"…","clue":"…"}]} — no prose, no markdown fence.',
  ].join("\n");
}

/** Bitta so'rovning buyurtmasi. */
export type WordsAsk = {
  /** Nechta so'z so'ralmoqda. */
  n: number;
  /** Allaqachon olingan javoblar — TAKRORLANMASIN. */
  avoid?: readonly string[];
  /** Qo'shimcha so'rov (sig'magan so'zlar o'rniga) — boshqacha ohang. */
  retry?: boolean;
};

/**
 * Fayl rejimining «faqat manbadan» bloki. Umumiy `sourceBlock` qayta
 * ishlatiladi, ustiga krossvordga xos shart qo'shiladi.
 */
export function crosswordSourceBlock(meta: DocMeta): string {
  const base = sourceBlock(meta);
  if (!base) return "";
  return [
    base,
    "",
    "SOURCE MODE — HARD RULE:",
    "— every answer is a term that APPEARS in the source text above; do not add words from outside knowledge;",
    "— the clue is built from how the source itself explains that term;",
    "— if the source does not have enough suitable terms, return fewer words rather than inventing them.",
  ].join("\n");
}

/** So'z ro'yxati so'rovi. */
export function crosswordUserPrompt(input: CrosswordInput, ask: WordsAsk, blocks: { source?: string } = {}): string {
  const avoid = ask.avoid?.filter(Boolean) ?? [];
  return [
    input.mode === "topic" ? `TOPIC: «${input.topic}»` : `TOPIC (for the heading only): «${input.topic}»`,
    `Write ${ask.n} answer+clue pairs for this crossword.`,
    // Turli uzunlik — to'r uchun hayotiy: bir xil uzunlikdagi so'zlar kam kesishadi.
    `Vary the answer length across the list (some short ${CROSSWORD_LIMITS.answerMin}–5 letters, some long 8–${CROSSWORD_LIMITS.answerMax}) — a grid needs both.`,
    avoid.length ? `ALREADY USED — do not repeat these answers or their roots:\n${avoid.map((a) => `— ${a}`).join("\n")}` : "",
    ask.retry
      ? "These replace words that could not be placed in the grid: prefer SHORTER answers (3–6 letters) with common letters, they intersect more easily."
      : "",
    blocks.source ?? "",
    input.extra ? `TEACHER'S EXTRA REQUEST: ${input.extra}` : "",
    "",
    "JSON shape:",
    '{"words":[{"answer":"biologiya","clue":"Tirik organizmlarni o\'rganadigan fan"}]}',
  ]
    .filter(Boolean)
    .join("\n");
}

/** Hujjatdagi ko'rsatma satrlari — LLM dan emas, DVIGATELDAN. */
export function instructionLines(input: CrosswordInput, placedCount: number, lang: string): string[] {
  const L = crosswordLabels(lang);
  return [
    L.howTo(placedCount),
    L.numbering,
    ...(input.mode === "file" ? [L.fromFile] : []),
  ];
}

export type CrosswordLabels = {
  grid: string;
  across: string;
  down: string;
  answers: string;
  howTo: (n: number) => string;
  numbering: string;
  fromFile: string;
};

/**
 * Hujjat yorliqlari. Hujjat tili interfeys tilidan MUSTAQIL
 * (`i18n.ts sectionLabels` qoidasi). Noma'lum tilda ZAXIRA — o'zbekcha,
 * `sectionLabels`/`omrLabels` bilan bir xil (hujjatning qolgan yorliqlari
 * ham o'sha jadvaldan keladi: zaxirani inglizchaga o'zgartirsak bitta
 * hujjatda ikki xil zaxira til aralashib qolardi).
 */
export function crosswordLabels(lang: string): CrosswordLabels {
  const c = (lang || "uz").toLowerCase();
  if (c === "ru") {
    return {
      grid: "Кроссворд",
      across: "По горизонтали",
      down: "По вертикали",
      answers: "Ответы",
      howTo: (n) => `Разгадайте ${n} слов и впишите их в сетку.`,
      numbering: "Номер в клетке — начало слова: по горизонтали слева направо, по вертикали сверху вниз.",
      fromFile: "Слова взяты из загруженного документа.",
    };
  }
  if (c === "en") {
    return {
      grid: "Crossword",
      across: "Across",
      down: "Down",
      answers: "Answers",
      howTo: (n) => `Solve ${n} words and write them into the grid.`,
      numbering: "The number in a cell marks where a word starts: across left to right, down top to bottom.",
      fromFile: "The words come from the uploaded document.",
    };
  }
  return {
    grid: "Krossvord",
    across: "Gorizontal",
    down: "Vertikal",
    answers: "Javoblar",
    howTo: (n) => `${n} ta so'zni toping va katakchalarga yozing.`,
    numbering: "Katakdagi raqam — so'zning boshi: gorizontal chapdan o'ngga, vertikal yuqoridan pastga.",
    fromFile: "So'zlar yuklangan hujjatdan olingan.",
  };
}
