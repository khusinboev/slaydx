/**
 * NAMUNAVIY O'YIN HUJJATLARI (AUDIT-21 WP-B) — render/paritet testlari,
 * LibreOffice ko'z tekshiruvi va galereya uchun.
 *
 * Shakli dvigatellar chiqaradigan hujjat bilan AYNAN bir xil: TUZILMA
 * `doc.game` da (`GameModel`), NASR esa `doc.sections` da tekis id lar
 * bilan (`cards` yoki `grid`/`across`/`down`/`answers`). Karta
 * bloklarining shakli `flashcards/engine.ts cardSections` niki —
 * namuna maketni HAQIQIY hujjatdan boshqacha sinamasin
 * (`teacher/samples.ts` naqshi).
 *
 * Krossvord namunasi WP-A dan OLDIN yoziladi va shuning uchun `figures`
 * BERMAYDI: `planGame` rasm topolmasa o'rinbosar ramka chizadi
 * («[1-rasm]»). WP-A `crossword/svg.ts` ni ulaganda shu namunaga
 * `figures` qo'shiladi va ikkala chizuvchi ham darhol haqiqiy to'rni
 * ko'rsatadi — maket shartnomasi o'zgarmaydi.
 */
import type { AcademicDoc, DocMeta, DocSection } from "../types";
import { gameDefaultTypeId } from "./registry";
import type { CrosswordModel, Flashcard, GameKind, GameModel } from "./types";
import { cardSections } from "./flashcards/engine";
import { gameLayoutLabels } from "./layout";

/* ────────────────────────── flesh kartalar ────────────────────────── */

/** O'nta karta — 2 ta varaq (8 + 2), ya'ni 4 bet (2 old + 2 orqa). */
const CARDS: Flashcard[] = [
  {
    id: "c1",
    front: "Fotosintez",
    back: "Yashil o‘simlik bargida quyosh nuri energiyasi yordamida suv va karbonat angidriddan organik modda hosil bo‘lish jarayoni.",
    example: "Barg yorug‘likka chiqarilganda fotosintez tezlashadi.",
  },
  {
    id: "c2",
    front: "Xlorofill",
    back: "Xloroplastdagi yashil pigment; quyosh nurini yutib, uning energiyasini kimyoviy bog‘ energiyasiga o‘tkazadi.",
    example: "Kuzda xlorofill parchalanib, bargning sariq rangi ko‘rinadi.",
  },
  {
    id: "c3",
    front: "Xloroplast",
    back: "O‘simlik hujayrasidagi ikki qavat membranali organoid; fotosintezning yorug‘lik va qorong‘ilik bosqichlari shu yerda o‘tadi.",
    example: "Bir barg hujayrasida 40 tagacha xloroplast bo‘ladi.",
  },
  {
    id: "c4",
    front: "Og‘izcha (ustitsa)",
    back: "Barg epidermasidagi ikki soqqasimon hujayra oralig‘i; gaz almashinuvi va suv bug‘lanishini boshqaradi.",
    example: "Issiq kunduzda og‘izchalar yopilib, suv yo‘qotilishi kamayadi.",
  },
  {
    id: "c5",
    front: "Transpiratsiya",
    back: "O‘simlikning yer ustki qismlaridan suvning bug‘ holida ajralishi; ildizdan suv oqimini tortib turadi.",
    example: "Bir tup makkajo‘xori yozda kuniga 2 litrgacha suv bug‘latadi.",
  },
  {
    id: "c6",
    front: "Nafas olish",
    back: "Organik moddaning kislorod ishtirokida parchalanib, ATF energiyasi ajralishi; fotosintezga teskari jarayon.",
    example: "O‘simlik kechasi ham nafas oladi, fotosintez esa to‘xtaydi.",
  },
  {
    id: "c7",
    front: "Kutikula",
    back: "Barg yuzasini qoplagan mumsimon yupqa qavat; ortiqcha bug‘lanishdan va zararkunandalardan himoya qiladi.",
    example: "Cho‘l o‘simliklarida kutikula qalinroq bo‘ladi.",
  },
  {
    id: "c8",
    front: "Ustunsimon to‘qima",
    back: "Barg yuqori epidermasi ostidagi zich joylashgan hujayralar qatlami; fotosintezning asosiy qismi shu yerda boradi.",
    example: "Yorug‘ joyda o‘sgan bargda bu qatlam ikki qavat bo‘ladi.",
  },
  {
    id: "c9",
    front: "Glyukoza",
    back: "Fotosintez natijasida hosil bo‘ladigan oddiy uglevod (C₆H₁₂O₆); o‘simlik uchun energiya va qurilish materiali.",
    example: "Glyukozadan kraxmal to‘planib, kartoshka tugunagida saqlanadi.",
  },
  {
    id: "c10",
    front: "Kraxmal",
    back: "Glyukoza qoldiqlaridan tuzilgan zaxira uglevod; bargda kunduzi to‘planib, kechasi qayta sarflanadi.",
    example: "Yod eritmasi kraxmalni ko‘k rangga bo‘yaydi.",
  },
];

function cardsDocSample(meta: DocMeta): AcademicDoc {
  const L = gameLayoutLabels(meta.language);
  const model: GameModel = {
    v: 1,
    kind: "flashcards",
    type: gameDefaultTypeId("flashcards"),
    language: meta.language,
    topic: meta.topic,
    cards: { type: "term-def", cards: CARDS, includeExample: true },
  };
  return {
    meta,
    titlePage: false,
    toc: false,
    sections: cardSections(model.cards!, L),
    game: model,
  };
}

/* ────────────────────────── krossvord ────────────────────────── */

/** Kichik, lekin HAQIQIY to'r: 4 so'z, 2 kesishma, 13×13. */
function crosswordModelSample(): CrosswordModel {
  const words = [
    { id: "w1", answer: [..."FOTOSINTEZ"], clue: "Yashil bargda quyosh nuri ostida organik modda hosil bo‘lish jarayoni", dir: "across" as const, row: 2, col: 1, number: 1 },
    { id: "w2", answer: [..."XLOROFILL"], clue: "Bargga yashil rang beruvchi pigment", dir: "down" as const, row: 2, col: 3, number: 2 },
    { id: "w3", answer: [..."GLYUKOZA"], clue: "Fotosintezning asosiy organik mahsuloti", dir: "across" as const, row: 6, col: 3, number: 3 },
    { id: "w4", answer: [..."ILDIZ"], clue: "O‘simlikni tuproqqa mahkamlab, suv va mineral moddalarni so‘radi", dir: "down" as const, row: 6, col: 7, number: 4 },
  ];
  const rows = 13;
  const cols = 13;
  const cells: (string | null)[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
  for (const w of words) {
    w.answer.forEach((ch, i) => {
      const r = w.dir === "across" ? w.row : w.row + i;
      const c = w.dir === "across" ? w.col + i : w.col;
      if (r < rows && c < cols) cells[r][c] = ch;
    });
  }
  return {
    words,
    grid: { rows, cols, cells },
    clues: {
      across: words.filter((w) => w.dir === "across").map((w) => ({ number: w.number, text: w.clue, wordId: w.id, length: w.answer.length })),
      down: words.filter((w) => w.dir === "down").map((w) => ({ number: w.number, text: w.clue, wordId: w.id, length: w.answer.length })),
    },
    dropped: [],
  };
}

function crosswordDocSample(meta: DocMeta): AcademicDoc {
  const L = gameLayoutLabels(meta.language);
  const cw = crosswordModelSample();
  const model: GameModel = {
    v: 1,
    kind: "crossword",
    type: gameDefaultTypeId("crossword"),
    language: meta.language,
    topic: meta.topic,
    crossword: cw,
  };
  /*
   * Bo'limlar — WP-A dvigateli beradigan shakl: sarlavha + savol
   * qatorlari NASR sifatida (hisobot/baholovchi shu matnni o'qiydi),
   * maket esa ularni MODELDAN chizadi.
   */
  const sections: DocSection[] = [
    { id: "grid", title: L.sectionTitle.grid, blocks: [] },
    { id: "across", title: L.sectionTitle.across, blocks: cw.clues.across.map((c) => ({ kind: "li" as const, text: L.clueLine(c.number, c.text, c.length) })) },
    { id: "down", title: L.sectionTitle.down, blocks: cw.clues.down.map((c) => ({ kind: "li" as const, text: L.clueLine(c.number, c.text, c.length) })) },
    { id: "answers", title: L.sectionTitle.answers, blocks: cw.words.map((w) => ({ kind: "li" as const, text: `${w.number}. ${w.answer.join("")}` })) },
  ];
  return { meta, titlePage: false, toc: false, sections, game: model };
}

/* ────────────────────────── kirish nuqtasi ────────────────────────── */

const TOPIC_OF: Record<GameKind, string> = {
  crossword: "Fotosintez va o‘simlik organlari",
  flashcards: "Fotosintez atamalari",
};

const LABEL_OF: Record<GameKind, string> = { crossword: "Krossvord", flashcards: "Flesh kartalar" };

export function sampleGameMeta(kind: GameKind): DocMeta {
  return {
    toolId: kind,
    workLabel: LABEL_OF[kind],
    topic: TOPIC_OF[kind],
    language: "uz",
    subject: "Biologiya",
    author: "Karimova Dilnoza Baxtiyorovna",
    grade: 7,
  } as unknown as DocMeta;
}

/** `sampleGameDoc("flashcards")` — ikkala kind uchun to'liq hujjat. */
export function sampleGameDoc(kind: GameKind, meta?: Partial<DocMeta>): AcademicDoc {
  const full = { ...sampleGameMeta(kind), ...meta } as DocMeta;
  return kind === "crossword" ? crosswordDocSample(full) : cardsDocSample(full);
}
