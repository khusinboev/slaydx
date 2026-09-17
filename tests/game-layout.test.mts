import test from "node:test";
import assert from "node:assert/strict";
import {
  CARD_HEAD_MM,
  GAME_MARGINS_CM,
  GAME_TYPE,
  cardCellMm,
  cardSheets,
  gameLayoutLabels,
  isGameDoc,
  mirrorRow,
  planGame,
  type GameCardFace,
  type GameCardsItem,
  type GameCluesItem,
} from "../lib/generation/games/layout.ts";
import { sampleGameDoc } from "../lib/generation/games/samples.ts";
import { CARDS_PER_SHEET, GAME_LIMITS, type Flashcard } from "../lib/generation/games/types.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";

/**
 * BOSMA O'YIN MAKETI (AUDIT-21 WP-B) — `planGame` YAGONA MANBA.
 *
 * Bu yerda qulflanadigan qarorlar: 8 karta/varaq, ORQA betning OYNALI
 * tartibi, kartalarda shapka YO'Qligi, javoblar varag'i YANGI BETDAN,
 * `path` shartnomasi va katak o'lchamining bosiladigan maydonga
 * sig'ishi.
 */

const cardsPlan = (doc: AcademicDoc = sampleGameDoc("flashcards")) => planGame(doc);
const crosswordPlan = () => planGame(sampleGameDoc("crossword"));

const sheetsOf = (plan = cardsPlan()): GameCardsItem[] => plan.body.filter((b): b is GameCardsItem => b.k === "cards");

/** Katakning KARTASI (matni emas: orqa yuzda matn boshqa — ta'rif). */
const faceKey = (f: GameCardFace) => (f.k === "card" ? f.id : "—");

/** Kartalar soni boshqacha bo'lgan hujjat (varaq/oynalash sinovlari uchun). */
function docWithCards(n: number): AcademicDoc {
  const doc = sampleGameDoc("flashcards");
  const cards: Flashcard[] = Array.from({ length: n }, (_, i) => ({
    id: `k${i + 1}`,
    front: `Atama ${i + 1}`,
    back: `Bu ${i + 1}-atamaning ta'rifi: nimaligi va nimasi bilan ajralib turishi bir jumlada aytilgan.`,
  }));
  return { ...doc, game: { ...doc.game!, cards: { type: "term-def", cards, includeExample: false } } };
}

/* ══════════════════════════ umumiy ══════════════════════════ */

test("isGameDoc — faqat `doc.game` bo'lgan hujjat; ikkala kind ham PORTRET", () => {
  assert.ok(isGameDoc(sampleGameDoc("flashcards")));
  assert.ok(isGameDoc(sampleGameDoc("crossword")));
  const plain = sampleGameDoc("flashcards");
  assert.ok(!isGameDoc({ ...plain, game: undefined }));

  for (const plan of [cardsPlan(), crosswordPlan()]) {
    assert.equal(plan.landscape, false, `${plan.kind}: albom bo'lib qoldi`);
    assert.equal(plan.headingAlign, "left");
    assert.deepEqual(plan.tables, []);
  }
});

test("varaq o'lchovlari kind jadvalidan (`GAME_MARGINS_CM`/`GAME_TYPE`) keladi", () => {
  const cards = cardsPlan();
  assert.deepEqual(cards.page.marginsCm, GAME_MARGINS_CM.flashcards);
  assert.equal(cards.page.sizePt, GAME_TYPE.flashcards.sizePt);
  assert.equal(cards.page.line, GAME_TYPE.flashcards.line);

  const cw = crosswordPlan();
  assert.deepEqual(cw.page.marginsCm, GAME_MARGINS_CM.crossword);
  assert.equal(cw.page.sizePt, GAME_TYPE.crossword.sizePt);
});

/* ══════════════════════════ karta katagi ══════════════════════════ */

test("katak A7 NISBATIDA (105:74) va bosiladigan maydondan CHIQMAYDI", () => {
  const c = cardCellMm();
  assert.equal(c.cols, GAME_LIMITS.cardCols);
  assert.equal(c.rows, GAME_LIMITS.cardRows);

  const nominal = GAME_LIMITS.cardHeightMm / GAME_LIMITS.cardWidthMm;
  const actual = c.wMm / c.hMm;
  assert.ok(Math.abs(actual - nominal) < 0.02, `nisbat ${actual.toFixed(3)} ≈ ${nominal.toFixed(3)} bo'lishi kerak`);

  const m = GAME_MARGINS_CM.flashcards;
  const availW = 210 - (m.left + m.right) * 10;
  // Ko'ruvchi varag'idagi sahifa raqami zaxirasi (`A4.footerPx` = 7,41 mm) + varaq shapkasi.
  const availH = 297 - (m.top + m.bottom) * 10 - 7.4 - CARD_HEAD_MM;
  assert.ok(c.wMm * c.cols <= availW, `panjara eni ${c.wMm * c.cols} mm > ${availW} mm`);
  assert.ok(c.hMm * c.rows <= availH, `panjara bo'yi ${c.hMm * c.rows} mm > ${availH} mm`);
  // Katak shunchalik kichkina bo'lib ketmasin (200 belgilik ta'rif sig'sin).
  assert.ok(c.wMm > 80 && c.hMm > 55, `katak juda kichik: ${c.wMm}×${c.hMm} mm`);
});

test("chegara kengaysa katak kichrayadi — o'lcham CHEGARADAN hisoblanadi", () => {
  const wide = cardCellMm({ top: 3, right: 3, bottom: 3, left: 3 });
  const tight = cardCellMm();
  assert.ok(wide.wMm < tight.wMm, "kengroq chegarada katak kichrayishi kerak");
});

/* ══════════════════════════ varaqlar ══════════════════════════ */

test("bir varaqda AYNAN 8 karta (2 × 4) — 10 karta 2 varaqqa bo'linadi", () => {
  assert.equal(CARDS_PER_SHEET, 8);
  const sheets = sheetsOf();
  assert.equal(sheets.length, 4, "10 karta → 2 varaq × 2 yuz = 4 band");
  for (const s of sheets) {
    assert.equal(s.rows.length, GAME_LIMITS.cardRows, "qator soni");
    for (const row of s.rows) assert.equal(row.length, GAME_LIMITS.cardCols, "ustun soni");
    assert.equal(s.rows.flat().length, CARDS_PER_SHEET);
  }
  assert.deepEqual(
    sheets.map((s) => [s.sheet, s.side]),
    [
      [1, "front"],
      [1, "back"],
      [2, "front"],
      [2, "back"],
    ],
    "varaqlar juft-juft: old → orqa",
  );
});

test("`cardSheets` oxirgi varaqni BO'SH kataklar bilan to'ldiradi", () => {
  const cards: Flashcard[] = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, front: `F${i}`, back: `B${i}` }));
  const sheets = cardSheets(cards);
  assert.equal(sheets.length, 2);
  assert.equal(sheets[0].filter(Boolean).length, 8);
  assert.equal(sheets[1].filter(Boolean).length, 2, "ikkinchi varaqda 2 ta karta");
  assert.equal(sheets[1].length, 8, "katak soni baribir 8");
  assert.ok(sheets[1].slice(2).every((x) => x === null), "qolganlari BO'SH");
});

test("5 / 15 / 20 karta uchun varaq soni: ceil(n / 8) × 2 bet", () => {
  for (const [n, want] of [
    [5, 1],
    [8, 1],
    [15, 2],
    [16, 2],
    [20, 3],
  ] as const) {
    const sheets = sheetsOf(cardsPlan(docWithCards(n)));
    assert.equal(sheets.length, want * 2, `${n} karta → ${want} varaq (${want * 2} bet)`);
  }
});

/* ══════════════════════════ oynali tartib ══════════════════════════ */

test("`mirrorRow` — qator ustunlari teskari: [A B] → [B A]", () => {
  assert.deepEqual(mirrorRow(["A", "B"]), ["B", "A"]);
  assert.deepEqual(mirrorRow(["A", "B", "C"]), ["C", "B", "A"]);
  assert.deepEqual(mirrorRow([]), []);
});

test("ORQA bet OYNALI: har qatorda ustunlar almashadi, QATORLAR tartibi o'zgarmaydi", () => {
  const [front, back] = sheetsOf();
  assert.equal(front.side, "front");
  assert.equal(back.side, "back");
  assert.equal(front.sheet, back.sheet, "old va orqa AYNI varaq");

  for (let r = 0; r < front.rows.length; r++) {
    const f = front.rows[r].map(faceKey);
    const b = back.rows[r].map(faceKey);
    assert.notDeepEqual(b, f, `${r}-qator oynalanmagan`);
    assert.deepEqual(b, [...f].reverse(), `${r}-qator oynasi noto'g'ri: ${f.join("|")} → ${b.join("|")}`);
  }
  /*
   * QATORLAR tartibi o'zgarmaydi: 1-qator baribir 1-qator (agar
   * «flip on SHORT edge» qilinsa, qatorlar ham teskarilanardi va
   * kesilgan kartaning orqasida butunlay boshqa ta'rif chiqardi).
   */
  const frontRowFirst = front.rows.map((row) => faceKey(row[0]));
  const backRowLast = back.rows.map((row) => faceKey(row[row.length - 1]));
  assert.deepEqual(backRowLast, frontRowFirst, "qatorlar tartibi ham teskarilanib ketgan");
});

test("oynada KARTA indeksi saqlanadi — old yuz (r,c) ↔ orqa yuz (r, cols−1−c)", () => {
  const [front, back] = sheetsOf();
  const cols = GAME_LIMITS.cardCols;
  for (let r = 0; r < front.rows.length; r++) {
    for (let c = 0; c < cols; c++) {
      const f = front.rows[r][c];
      const b = back.rows[r][cols - 1 - c];
      assert.equal(f.k, b.k, `(${r},${c}): bo'shlik mos emas`);
      if (f.k === "card" && b.k === "card") {
        assert.equal(f.index, b.index, `(${r},${c}): orqa yuz boshqa kartaniki`);
        assert.equal(f.id, b.id);
        assert.equal(f.side, "front");
        assert.equal(b.side, "back");
      }
    }
  }
});

test("to'lmagan varaqda BO'SH kataklar ham oynalanadi (orqa yuz qo'shnining ta'rifini olmaydi)", () => {
  const sheets = sheetsOf(cardsPlan(docWithCards(10)));
  const [front, back] = [sheets[2], sheets[3]];
  assert.equal(front.rows.flat().filter((f) => f.k === "card").length, 2, "ikkinchi varaqda 2 karta");
  const cols = GAME_LIMITS.cardCols;
  for (let r = 0; r < front.rows.length; r++) {
    for (let c = 0; c < cols; c++) {
      assert.equal(front.rows[r][c].k, back.rows[r][cols - 1 - c].k, `(${r},${c}): bo'sh katak oynada siljidi`);
    }
  }
});

/* ══════════════════════════ sahifa uzilishi ══════════════════════════ */

test("har varaq O'Z BETIDA: birinchi old betdan boshqa hammasida `pageBreak`", () => {
  const plan = cardsPlan();
  const sheets = sheetsOf(plan);
  assert.equal(sheets[0].pageBreak, false, "birinchi bet uzilish bilan boshlanmaydi (bo'sh varaq qolardi)");
  for (const s of sheets.slice(1)) assert.equal(s.pageBreak, true, `${s.sheet}/${s.side}: uzilish yo'q`);
  assert.deepEqual(plan.pageBreaks, ["cards:1:back", "cards:2:front", "cards:2:back"]);
});

test("KARTALARDA HUJJAT SHAPKASI YO'Q — birinchi bet panjaraning O'ZI", () => {
  const plan = cardsPlan();
  assert.deepEqual(plan.head, [], "shapka old betni pastga surib, orqa bet bilan siljitib yuborardi");
  assert.equal(plan.body[0].k, "cards", "birinchi band panjara bo'lishi kerak");
  // Varaq shapkasi HAR betda bor va hint HAMMASIDA bir xil (balandlik o'zgarmasin).
  const sheets = sheetsOf(plan);
  const hints = new Set(sheets.map((s) => s.hint));
  assert.equal(hints.size, 1, "bosish ko'rsatmasi har betda bir xil bo'lishi kerak");
  assert.ok(sheets[0].title.includes("old yuzlar"), `old bet sarlavhasi: ${sheets[0].title}`);
  assert.ok(sheets[1].title.includes("orqa yuzlar"), `orqa bet sarlavhasi: ${sheets[1].title}`);
  assert.ok(sheets[0].title.includes("1/2-varaq"), `varaq raqami: ${sheets[0].title}`);
});

/* ══════════════════════════ path shartnomasi ══════════════════════════ */

test("karta `path` lari: `game.cards.<k>.front` / `.back` (tahrir shartnomasi)", () => {
  const sheets = sheetsOf();
  const front = sheets[0].rows.flat().filter((f): f is Extract<GameCardFace, { k: "card" }> => f.k === "card");
  assert.equal(front[0].path, "game.cards.0.front");
  assert.equal(front[7].path, "game.cards.7.front");
  const back = sheets[1].rows.flat().filter((f): f is Extract<GameCardFace, { k: "card" }> => f.k === "card");
  assert.ok(back.some((f) => f.path === "game.cards.0.back"));
  // Ikkinchi varaq indekslari 8 dan davom etadi.
  const second = sheets[2].rows.flat().filter((f): f is Extract<GameCardFace, { k: "card" }> => f.k === "card");
  assert.equal(second[0].path, "game.cards.8.front");
});

test("misol qatori kartaning ORQA yuzida (old yuzda emas)", () => {
  const sheets = sheetsOf();
  const front = sheets[0].rows.flat().find((f) => f.k === "card");
  const back = sheets[1].rows.flat().find((f) => f.k === "card");
  assert.ok(front?.k === "card" && !("example" in front && front.example), "old yuzda misol bo'lmasligi kerak");
  assert.ok(back?.k === "card" && back.example, "orqa yuzda misol bo'lishi kerak");
});

/* ══════════════════════════ krossvord ══════════════════════════ */

test("krossvord shapkasi: hujjat nomi, tur, mavzu", () => {
  const plan = crosswordPlan();
  assert.deepEqual(
    plan.head.map((h) => h.k),
    ["title", "subtitle", "field"],
  );
  assert.equal(plan.head[0].k === "title" && plan.head[0].text, "KROSSVORD");
  assert.ok(plan.head[2].k === "field" && plan.head[2].text.includes("Fotosintez"));
});

test("krossvord tartibi: ko'rsatma + to'r → savollar (2 ustun) → javoblar YANGI BETDAN", () => {
  const plan = crosswordPlan();
  /*
   * Tartib WP-A dvigatelining bo'limlaridan chiqadi: `grid`
   * (ko'rsatma paragraflari + bo'sh to'r rasmi) → `across`/`down`
   * (bitta ikki ustunli band) → `answers` (javob to'ri + raqam→so'z).
   */
  assert.deepEqual(plan.body.map((b) => b.k), ["p", "p", "figure", "clues", "h1", "figure", "p", "p"]);
  /*
   * To'r bo'limining sarlavhasi YO'Q: WP-A yorlig'i «Krossvord» va u
   * hujjat nomining («KROSSVORD») aynan takrori — bosma varaqda ikki
   * qator ketma-ket bir xil so'z turardi (LibreOffice ko'zi).
   */
  assert.ok(!plan.body.some((b) => b.k === "h1" && b.text.toLowerCase() === "krossvord"), "hujjat nomi takrorlandi");

  const answersH1 = plan.body[4];
  assert.ok(answersH1.k === "h1" && answersH1.pageBreak, "javoblar varag'i yangi betdan boshlanmadi");
  assert.ok(plan.pageBreaks.includes("answers"));
  // To'r BIRINCHI betda: undan oldin uzilish YO'Q.
  assert.deepEqual(plan.pageBreaks, ["answers"], "to'r birinchi betda qolishi kerak");
  // Javoblar ro'yxati — HUJJAT matnidan, maket uni qayta yozmaydi.
  const answerLine = plan.body[6];
  assert.ok(answerLine.k === "p" && /FOTOSINTEZ/.test(answerLine.text), `javoblar ro'yxati: ${answerLine.k === "p" ? answerLine.text : answerLine.k}`);
});

test("savollar IKKI USTUNDA: Gorizontal/Vertikal, raqam va katak soni bilan", () => {
  const plan = crosswordPlan();
  const clues = plan.body.find((b): b is GameCluesItem => b.k === "clues")!;
  assert.equal(clues.columns.length, 2);
  assert.equal(clues.columns[0].title, "Gorizontal");
  assert.equal(clues.columns[1].title, "Vertikal");
  assert.ok(clues.columns[0].items.length >= 1 && clues.columns[1].items.length >= 1);
  // Savol qatorini DVIGATEL yozgan («4. Ta'rif (10)») — maket uni ko'chiradi.
  assert.match(clues.columns[0].items[0].text, /^\d+\. .+ \(\d+\)$/, `savol qatori: ${clues.columns[0].items[0].text}`);
  // `path` — teacher shartnomasidagidek bo'lim bloki.
  assert.match(clues.columns[0].items[0].path, /^sections\.\d+\.blocks\.0$/, clues.columns[0].items[0].path);
  assert.match(clues.columns[1].items[0].path, /^sections\.\d+\.blocks\.0$/, clues.columns[1].items[0].path);
  // Jami savol soni = joylashtirilgan so'z soni.
  const placed = plan.model.crossword!.words.length;
  assert.equal(clues.columns[0].items.length + clues.columns[1].items.length, placed);
});

test("rasm SPECI bor, PNG yo'q — maket YIQILMAYDI, o'rinbosar ramka chiziladi", () => {
  const plan = crosswordPlan();
  const figures = plan.body.filter((b): b is Extract<(typeof plan.body)[number], { k: "figure" }> => b.k === "figure");
  assert.equal(figures.length, 2);
  assert.equal(figures[0].figureId, "crossword-grid");
  assert.equal(figures[1].figureId, "crossword-answers");
  assert.equal(figures[0].placeholder, "[1-rasm]");
  assert.equal(figures[1].placeholder, "[2-rasm]");
  for (const f of figures) {
    assert.ok(f.figure, "rasm reyestrdan topilishi kerak (`model.figures`)");
    assert.ok(!f.figure!.url, "namunada PNG yo'q — o'rinbosar ramka chiziladi");
    assert.equal(f.figure!.spec.kind, "svg");
    assert.ok(f.figure!.spec.kind === "svg" && f.figure!.spec.widthMm > 0, "chop etiladigan kenglik specda bo'lishi kerak");
  }
});

/* ══════════════════════════ til ══════════════════════════ */

test("yorliqlar hujjat tiliga ergashadi (uz/ru/en) — maket va dvigatel BITTA manbadan", () => {
  assert.equal(gameLayoutLabels("uz").docTitle.crossword, "KROSSVORD");
  assert.equal(gameLayoutLabels("ru").docTitle.crossword, "КРОССВОРД");
  assert.equal(gameLayoutLabels("en").sectionTitle.across, "Across");
  // Noma'lum kod → o'zbekcha (standart).
  assert.equal(gameLayoutLabels("kk").docTitle.flashcards, "FLESH KARTALAR");

  const ru = planGame(sampleGameDoc("flashcards", { language: "ru" }));
  const sheets = sheetsOf(ru);
  assert.ok(sheets[0].title.includes("лицевые стороны"), `ru sarlavha: ${sheets[0].title}`);
  assert.ok(sheets[0].hint.includes("ДЛИННОЙ"), `ru ko'rsatma: ${sheets[0].hint}`);
});

/* ══════════════════════════ interaktiv o'yinlar (AUDIT-22 WP-D) ══════════════════════════ */

/**
 * `planSectionsOnly` (R0 ning vaqtinchalik sxemasi) `planInteractive`
 * bilan ALMASHTIRILDI. Bu yerda qulflanadigan qarorlar: saralashda
 * TOIFALAR JADVALI (bo'sh kataklar = yozish joyi) va javob kalitidagi
 * to'ldirilgan nusxasi, tinglashda esa eshitiladigan matnning bosma
 * varaqda YO'Qligi; ikkalasida javob kaliti YANGI BETDAN.
 */

const sortingPlan = () => planGame(sampleGameDoc("sorting"));
const listeningPlan = () => planGame(sampleGameDoc("listening"));

const gridsOf = (plan: ReturnType<typeof planGame>): GameCluesItem[] => plan.body.filter((b): b is GameCluesItem => b.k === "clues");

test("saralash: BO'SH toifalar jadvali (ustun = toifa) aralash ro'yxatdan KEYIN", () => {
  const plan = sortingPlan();
  const cats = plan.model.sorting!.categories;
  const grids = gridsOf(plan);
  assert.equal(grids.length, 2, "saralashda ikkita jadval bo'lishi kerak (varaq + javob kaliti)");

  const sheet = grids[0];
  assert.equal(sheet.bordered, true, "o'quvchi yozadigan jadval chegarasiz chiqdi");
  assert.deepEqual(sheet.columns.map((c) => c.title), cats.map((c) => c.name));
  assert.ok(sheet.columns.every((c) => c.items.length === 0), "varaq jadvalida javoblar ko'rinib turibdi");
  assert.equal(sheet.minRows, Math.max(...cats.map((c) => c.items.length)), "yozish uchun qator qoldirilmadi");

  // Jadval — ARALASH ro'yxatdan keyin: o'quvchi avval ro'yxatni o'qiydi.
  const at = plan.body.indexOf(sheet);
  const items = plan.body.filter((b, i) => i < at && b.k === "li");
  assert.equal(items.length, cats.flatMap((c) => c.items).length, "aralash ro'yxat jadvaldan oldin chizilmadi");
  assert.match((items[0] as { path: string }).path, /^sections\.\d+\.blocks\.\d+$/, "nasr `path` shartnomasi buzildi");
});

test("saralash: javob kaliti TO'LDIRILGAN jadval va YANGI BETDAN", () => {
  const plan = sortingPlan();
  const cats = plan.model.sorting!.categories;
  const key = gridsOf(plan)[1];
  assert.equal(key.bordered, true);
  assert.deepEqual(
    key.columns.map((c) => c.items.map((i) => i.text)),
    cats.map((c) => c.items),
  );
  assert.ok(key.columns.every((c) => c.items.every((i) => /^game\.sorting\.\d+\.items\.\d+$/.test(i.path))), "javob katagi modelga ishora qilmaydi");

  assert.ok(plan.pageBreaks.includes("answers"), "javob kaliti yangi betdan boshlanmadi");
  const h1 = plan.body.find((b) => b.k === "h1" && b.sectionId === "answers");
  assert.ok(h1 && h1.k === "h1" && h1.pageBreak, "javoblar sarlavhasida uzilish yo'q");
  // Javob jadvali AYNAN o'sha sarlavhadan keyin.
  assert.ok(plan.body.indexOf(key) > plan.body.indexOf(h1!), "javob jadvali sarlavhadan oldin chizildi");
});

test("tinglash: bosma varaqda ESHITILADIGAN MATN yo'q, javob kalitida bor", () => {
  const plan = listeningPlan();
  const items = plan.model.listening!.items;
  const at = plan.body.findIndex((b) => b.k === "h1" && b.sectionId === "answers");
  assert.ok(at > 0);

  const before = plan.body.slice(0, at).filter((b) => b.k === "li").map((b) => (b as { text: string }).text);
  assert.equal(before.length, items.length, "har topshiriq bitta qator bo'lishi kerak");
  for (const it of items) {
    assert.ok(!before.some((t) => t.includes(it.text)), `«${it.text}» topshiriq betiga bosildi — mashq o'qishga aylanadi`);
  }
  // Variantlar esa BOR va harflangan.
  assert.match(before[0], /^1\. A\) /);
  // Javob kalitida so'z ham, tarjimasi ham bor.
  const after = plan.body.slice(at).filter((b) => b.k === "li").map((b) => (b as { text: string }).text);
  assert.ok(after.some((t) => t.includes(items[0].text) && t.includes(items[0].options[items[0].answer])), "javob kalitida so'z–tarjima juftligi yo'q");
});

test("tinglash: javob kaliti YANGI BETDAN, ustunli jadval YO'Q", () => {
  const plan = listeningPlan();
  assert.ok(plan.pageBreaks.includes("answers"));
  assert.equal(gridsOf(plan).length, 0, "tinglashda ustunli jadval kerak emas");
  assert.deepEqual(
    plan.body.filter((b) => b.k === "h1").map((b) => (b as { sectionId: string }).sectionId),
    ["intro", "items", "answers"],
  );
});

test("ikkala o'yinda ham shapka (sarlavha, tur, mavzu) va KO'RSATMA `note` bo'lib chiziladi", () => {
  for (const kind of ["sorting", "listening"] as const) {
    const plan = planGame(sampleGameDoc(kind));
    assert.deepEqual(plan.head.map((h) => h.k), ["title", "subtitle", "field"], `${kind}: shapka to'liq emas`);
    assert.equal(plan.head[0].k === "title" && plan.head[0].text, gameLayoutLabels("uz").docTitle[kind]);
    // Ko'rsatma + javob kaliti ogohlantirishi — ikkalasi ham markazda.
    assert.equal(plan.body.filter((b) => b.k === "note").length, 2, `${kind}: ko'rsatma qatorlari markazda chizilmadi`);
    assert.equal(plan.landscape, false);
    assert.deepEqual(plan.page.marginsCm, GAME_MARGINS_CM[kind]);
    assert.equal(plan.page.sizePt, GAME_TYPE[kind].sizePt);
  }
});

test("interaktiv o'yinlarda karta panjarasi CHIZILMAYDI (R0 da `planCards` ga tushib ketish xavfi)", () => {
  for (const kind of ["sorting", "listening"] as const) {
    const plan = planGame(sampleGameDoc(kind));
    assert.equal(plan.body.filter((b) => b.k === "cards").length, 0, `${kind}: A7 kataklari chizildi`);
    assert.equal(plan.body.filter((b) => b.k === "figure").length, 0, `${kind}: rasm bandi paydo bo'ldi`);
    assert.ok(plan.body.length > 3, `${kind}: maket bo'sh`);
  }
});
