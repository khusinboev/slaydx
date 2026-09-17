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
 * Krossvord namunasi WP-A ning O'Z quvuridan o'tadi (`placeWords` →
 * `crosswordSections` → `crosswordFigure`): qo'lda yig'ilgan bo'limlar
 * dvigatel chiqishidan jimgina ajralib ketardi va o'shanda maket
 * sinovlari HAQIQIY hujjatni emas, namunani sinagan bo'lardi.
 */
import type { AcademicDoc, DocMeta } from "../types";
import { gameDefaultTypeId } from "./registry";
import type { CrosswordModel, Flashcard, GameKind, GameModel, ListeningItem, SortingCategory } from "./types";
import { cardSections } from "./flashcards/engine";
import { sortingSections } from "./sorting/engine";
import { listeningSections } from "./listening/engine";
import { langInfo } from "../i18n";
import { crosswordFigure, crosswordSections } from "./crossword/engine";
import { crosswordInputFromValues } from "./crossword/input";
import { cluesOf, placeWords } from "./crossword/grid";
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

/**
 * Krossvord so'zlari — namuna HAQIQIY to'r algoritmidan o'tadi.
 *
 * Bo'limlarni qo'lda yig'ish mumkin edi, lekin o'shanda namuna
 * dvigatelning chiqishidan JIMGINA ajralib ketardi (`teacher/samples.ts`
 * saboqi: namuna maketni haqiqiy hujjatdan boshqacha sinardi). Endi
 * `placeWords` + `crosswordSections` — WP-A ning O'Z yo'li — ishlatiladi,
 * ya'ni maket sinovlari dvigatel bergan aynan o'sha shaklni ko'radi.
 */
const CROSSWORD_WORDS = [
  { answer: "FOTOSINTEZ", clue: "Yashil bargda quyosh nuri ostida organik modda hosil bo‘lish jarayoni" },
  { answer: "XLOROFILL", clue: "Bargga yashil rang beruvchi pigment" },
  { answer: "GLYUKOZA", clue: "Fotosintezning asosiy organik mahsuloti" },
  { answer: "ILDIZ", clue: "O‘simlikni tuproqqa mahkamlab, suv va mineral moddalarni so‘radi" },
  { answer: "BARG", clue: "O‘simlikning fotosintez boradigan yassi organi" },
  { answer: "KISLOROD", clue: "Fotosintezda ajraladigan va nafas olish uchun zarur gaz" },
];

function crosswordDocSample(meta: DocMeta): AcademicDoc {
  const place = placeWords(CROSSWORD_WORDS, { seed: "sample-crossword", maxSize: 15 });
  const input = crosswordInputFromValues(meta, { topic: meta.topic, language: meta.language, wordCount: CROSSWORD_WORDS.length });
  const L = gameLayoutLabels(meta.language);
  const cw: CrosswordModel = { words: place.placed, grid: place.grid, clues: cluesOf(place.placed), dropped: place.dropped };
  /*
   * Rasm SPETSIFIKATSIYASI bor, PNG esa YO'Q (`url` bo'sh).
   *
   * `figurePng` `sharp` bilan ishlaydi va uni namunaga tiqish har
   * render sinovini rasm quvuriga bog'lab qo'yardi (sekin, muhitga
   * bog'liq). Spec bo'lsa maket rasm bandini ROSTAKAM chizadi va
   * `widthMm` yo'li ham sinaladi; PNG topilmagani uchun o'rinbosar
   * ramka chiqadi — aynan `sharp` yiqilgandagi holat.
   */
  const figures = [crosswordFigure(place, L.sectionTitle.grid, { answers: false }), crosswordFigure(place, L.sectionTitle.answers, { answers: true })];
  const model: GameModel = {
    v: 1,
    kind: "crossword",
    type: gameDefaultTypeId("crossword"),
    language: meta.language,
    topic: meta.topic,
    crossword: cw,
    figures,
  };
  return {
    meta,
    titlePage: false,
    toc: false,
    sections: crosswordSections(place, input, { grid: figures[0].id, answers: figures[1].id }),
    game: model,
  };
}

/* ────────────────────────── saralash (AUDIT-22 WP-D) ────────────────────────── */

/**
 * To'rt toifa × uch element — `sorting-game.md` §3 chegaralari ichida
 * (2–6 × 3–8) va ATAYLAB bir ma'noli: hech bir element ikkinchi toifaga
 * tushmaydi (`itemSingleCategory` qoidasi). Ball testlari (`game-score`)
 * va ochiq ko'rinish testlari (`game-public`) shu namunada yuradi.
 *
 * NASR endi DVIGATELNING O'Z quvuridan (`sortingSections`) — karta va
 * krossvord namunalari bilan bir xil qoida: qo'lda yig'ilgan bo'limlar
 * dvigatel chiqishidan jimgina ajralib ketardi va o'shanda maket
 * sinovlari HAQIQIY hujjatni emas, namunani sinagan bo'lardi.
 */
const SORTING_CATEGORIES: SortingCategory[] = [
  { id: "s1", name: "Sut emizuvchilar", items: ["Mushuk", "Delfin", "Ko‘rshapalak"] },
  { id: "s2", name: "Qushlar", items: ["Laylak", "Burgut", "Chumchuq"] },
  { id: "s3", name: "Baliqlar", items: ["Sazan", "Zog‘ora baliq", "Laqqa"] },
  { id: "s4", name: "Hasharotlar", items: ["Chumoli", "Asalari", "Kapalak"] },
];

function sortingDocSample(meta: DocMeta): AcademicDoc {
  const L = gameLayoutLabels(meta.language);
  const sorting = { categories: SORTING_CATEGORIES };
  const model: GameModel = {
    v: 1,
    kind: "sorting",
    type: gameDefaultTypeId("sorting"),
    language: meta.language,
    topic: meta.topic,
    sorting,
  };
  return {
    meta,
    titlePage: false,
    toc: false,
    sections: sortingSections(sorting, L),
    game: model,
  };
}

/* ────────────────────────── tinglash (AUDIT-22 WP-D) ────────────────────────── */

/**
 * O'nta topshiriq × to'rt variant (`listening-game.md` §3 standarti).
 *
 * Distraktorlar AYNI semantik maydondan (joylar) va hech biri to'g'ri
 * javobning ikkinchi tarjimasi emas — `distractorQuality` mezoni shuni
 * talab qiladi. `audioAssetId` YO'Q: TTS kaliti kelmaguncha (WP-A)
 * parcha ham bo'lmaydi, bosma varaq esa baribir chiqadi — aynan shu
 * bugungi ISHLAB TURGAN yo'l, ya'ni namuna uni sinashi kerak.
 */
const LISTENING_ITEMS: ListeningItem[] = [
  { id: "l1", text: "library", options: ["kutubxona", "muzey", "dorixona", "bekat"], answer: 0 },
  { id: "l2", text: "hospital", options: ["maktab", "kasalxona", "bozor", "zavod"], answer: 1 },
  { id: "l3", text: "market", options: ["kutubxona", "teatr", "bozor", "stadion"], answer: 2 },
  { id: "l4", text: "school", options: ["muzey", "bekat", "dorixona", "maktab"], answer: 3 },
  { id: "l5", text: "pharmacy", options: ["dorixona", "kasalxona", "kutubxona", "bozor"], answer: 0 },
  { id: "l6", text: "station", options: ["maktab", "bekat", "teatr", "muzey"], answer: 1 },
  { id: "l7", text: "museum", options: ["stadion", "zavod", "muzey", "dorixona"], answer: 2 },
  { id: "l8", text: "theatre", options: ["bozor", "bekat", "kasalxona", "teatr"], answer: 3 },
  { id: "l9", text: "stadium", options: ["stadion", "maktab", "muzey", "zavod"], answer: 0 },
  { id: "l10", text: "factory", options: ["teatr", "zavod", "bekat", "kutubxona"], answer: 1 },
];

function listeningDocSample(meta: DocMeta): AcademicDoc {
  const L = gameLayoutLabels(meta.language);
  const listening = { items: LISTENING_ITEMS, nativeLanguage: meta.language, targetLanguage: "en" };
  const model: GameModel = {
    v: 1,
    kind: "listening",
    type: gameDefaultTypeId("listening"),
    language: meta.language,
    topic: meta.topic,
    listening,
  };
  return {
    meta,
    titlePage: false,
    toc: false,
    sections: listeningSections(listening, L, langInfo(listening.targetLanguage).native),
    game: model,
  };
}

/* ────────────────────────── kirish nuqtasi ────────────────────────── */

const TOPIC_OF: Record<GameKind, string> = {
  crossword: "Fotosintez va o‘simlik organlari",
  flashcards: "Fotosintez atamalari",
  sorting: "Hayvonlar sinflari",
  listening: "Shahardagi joylar (ingliz tili)",
};

const LABEL_OF: Record<GameKind, string> = {
  crossword: "Krossvord",
  flashcards: "Flesh kartalar",
  sorting: "Saralash o‘yini",
  listening: "Tinglash o‘yini",
};

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

/** `sampleGameDoc("sorting")` — to'rtala kind uchun to'liq hujjat. */
export function sampleGameDoc(kind: GameKind, meta?: Partial<DocMeta>): AcademicDoc {
  const full = { ...sampleGameMeta(kind), ...meta } as DocMeta;
  if (kind === "crossword") return crosswordDocSample(full);
  if (kind === "flashcards") return cardsDocSample(full);
  if (kind === "sorting") return sortingDocSample(full);
  return listeningDocSample(full);
}
