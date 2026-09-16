import test from "node:test";
import assert from "node:assert/strict";
import {
  CROSSWORD_LIMITS,
  crosswordInputFromValues,
  crosswordSeed,
  isCrosswordMode,
  type CrosswordInput,
} from "../lib/generation/games/crossword/input.ts";
import { autoGridSize, wordText } from "../lib/generation/games/crossword/grid.ts";
import {
  CROSSWORD_SECTION_IDS,
  buildCrosswordDoc,
  parseWords,
  type CrosswordBuildOpts,
} from "../lib/generation/games/crossword/engine.ts";
import {
  applyClueOps,
  crosswordUserNeeds,
  planCrosswordPolish,
  rewriteClues,
} from "../lib/generation/games/crossword/polish.ts";
import { buildGameDoc } from "../lib/generation/games/engine.ts";
import { GAME_LIMITS } from "../lib/generation/games/types.ts";
import { gameDefaultTypeId, gameTypeOf, gameTypesOf } from "../lib/generation/games/registry.ts";
import {
  crosswordLabels,
  crosswordSourceBlock,
  crosswordSystemPrompt,
  crosswordUserPrompt,
  instructionLines,
} from "../lib/generation/games/crossword/prompts.ts";
import type { DocMeta } from "../lib/generation/types.ts";
import type { FormValues } from "../lib/types.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";

/**
 * KROSSVORD DVIGATELI — kirish va promptlar (AUDIT-21 WP-A).
 *
 * `buildCrosswordDoc` (mock `complete` bilan) R0 substratidan
 * (`games/types.ts CrosswordModel`, `AcademicDoc.game`) keyin shu
 * faylga qo'shiladi.
 *
 * Mutatsiyalar (qizardi):
 *   1. `nearestChoice` reyestrdan tashqari sonni o'tkazib yubordi —
 *      «12 so'z → 10 chipiga tushadi» testi;
 *   2. `crosswordInputFromValues` fayl rejimida `sourceText` ni
 *      tashlab ketdi — «fayl rejimi manbani uzatadi» testi;
 *   3. tizim promptidan «to'r qurmaysiz» qoidasi olib tashlandi —
 *      «model faqat so'z+ta'rif beradi» testi;
 *   4. `crosswordSeed` mavzuni hisobga olmadi — «urug' buyurtmadan»
 *      testi;
 *   5. ta'rif uzunligi chegarasi promptdan tushib qoldi — «prompt
 *      reyestr chegaralarini aytadi» testi.
 */

/* ────────────────────────── yordamchilar ────────────────────────── */

const meta = (over: Partial<DocMeta> = {}): DocMeta =>
  ({
    toolId: "crossword",
    topic: "Hujayra tuzilishi",
    language: "uz",
    subject: "Biologiya",
    grade: 7,
    extra: "",
    sourceText: "",
    author: "Aziza Karimova",
    university: "12-maktab",
    ...over,
  }) as DocMeta;

const values = (over: FormValues = {}): FormValues => ({ ...over });

const input = (over: Partial<CrosswordInput> = {}): CrosswordInput => ({
  ...crosswordInputFromValues(meta(), values()),
  ...over,
});

/** Reyestr turi (standart — klassik). */
const specOf = (id?: string) => gameTypeOf("crossword", id ?? gameDefaultTypeId("crossword"));

/* ────────────────────────── kirish ────────────────────────── */

test("standart qiymatlar: 10 so'z, avtomat to'r, klassik tur, meta dan fan/sinf/til", () => {
  const got = crosswordInputFromValues(meta(), values());
  assert.equal(got.wordCount, CROSSWORD_LIMITS.wordCountDefault);
  assert.equal(got.gridSize, autoGridSize(CROSSWORD_LIMITS.wordCountDefault));
  assert.equal(got.type, gameDefaultTypeId("crossword"), "standart tur reyestrdan");
  assert.equal(got.mode, "topic");
  assert.equal(got.subject, "Biologiya");
  assert.equal(got.grade, 7);
  assert.equal(got.language, "uz");
  assert.equal(got.topic, "Hujayra tuzilishi");
  assert.equal(got.author, "Aziza Karimova");
  assert.equal(got.institution, "12-maktab");
});

test("reyestrdan tashqari son standart chipga tushadi (bezak qiymat yo'q)", () => {
  // MUTATSIYA-1: chegaralanmasa dvigatel 12 so'z bilan ishlab ketardi.
  for (const bad of [12, 13, 999, 1, "ko'p", null]) {
    assert.equal(crosswordInputFromValues(meta(), values({ wordCount: bad as never })).wordCount, CROSSWORD_LIMITS.wordCountDefault, `«${bad}» chipga tushmadi`);
  }
  // Noma'lum tur ham standartga tushadi.
  assert.equal(crosswordInputFromValues(meta(), values({ crosswordType: "kriptik" })).type, gameDefaultTypeId("crossword"));
  for (const spec of gameTypesOf("crossword")) {
    assert.equal(crosswordInputFromValues(meta(), values({ crosswordType: spec.id })).type, spec.id);
  }
});

test("to'r o'lchami AVTOMAT: formada maydon yo'q, so'z soniga qarab (toq, 13–21)", () => {
  // Egasining qarori: `gridSize` forma maydoni emas — qiymat e'tiborsiz qoladi.
  const forced = crosswordInputFromValues(meta(), values({ wordCount: 10, gridSize: 13 }));
  assert.equal(forced.gridSize, autoGridSize(10), "forma qiymati to'r o'lchamini o'zgartirmasin");
  for (const n of CROSSWORD_LIMITS.wordCounts) {
    const size = autoGridSize(n);
    assert.equal(size % 2, 1, `${n} so'z → ${size} toq emas`);
    assert.ok(size >= GAME_LIMITS.gridMin && size <= GAME_LIMITS.gridMax, `${n} so'z → ${size}`);
  }
  // Ko'proq so'z — kengroq ish taxtasi.
  assert.ok(autoGridSize(5) <= autoGridSize(10));
  assert.ok(autoGridSize(10) <= autoGridSize(20));
});

test("so'z soni chiplari 5/10/15/20 va har biri o'tadi", () => {
  assert.deepEqual([...CROSSWORD_LIMITS.wordCounts], [5, 10, 15, 20]);
  assert.deepEqual([...CROSSWORD_LIMITS.wordCounts], [...GAME_LIMITS.counts], "chiplar R0 GAME_LIMITS dan");
  for (const n of CROSSWORD_LIMITS.wordCounts) {
    assert.equal(crosswordInputFromValues(meta(), values({ wordCount: n })).wordCount, n);
  }
});

test("fayl rejimi: manba matni uzatiladi, mavzu rejimida uzatilmaydi", () => {
  const src = "Hujayra — tirik organizmning asosiy tuzilma birligi.";
  const file = crosswordInputFromValues(meta({ sourceText: src }), values({ mode: "file", sourceText: src }));
  // MUTATSIYA-2: manba tushib qolsa fayl rejimi mavzu rejimiga aylanardi.
  assert.equal(file.mode, "file");
  assert.equal(file.sourceText, src);
  const topic = crosswordInputFromValues(meta({ sourceText: src }), values({ mode: "topic", sourceText: src }));
  assert.equal(topic.sourceText, "", "mavzu rejimida manba promptga tushmasin");
  assert.ok(isCrosswordMode("file") && isCrosswordMode("topic"));
  assert.ok(!isCrosswordMode("curriculum"), "krossvordda darslik rejimi yo'q");
  assert.equal(crosswordInputFromValues(meta(), values({ mode: "curriculum" })).mode, "topic", "noma'lum rejim → topic");
});

test("matn maydonlari kesiladi va bo'shliqlar normallashadi", () => {
  const long = "a".repeat(2000);
  const got = crosswordInputFromValues(meta({ topic: `  Hujayra\n\n  tuzilishi  ` }), values({ extra: long }));
  assert.equal(got.topic, "Hujayra tuzilishi");
  assert.equal(got.extra.length, CROSSWORD_LIMITS.extraChars);
  assert.ok(crosswordInputFromValues(meta(), values({ topic: long })).topic.length <= CROSSWORD_LIMITS.topicChars);
});

test("urug' buyurtmadan quriladi — tasodif/sana aralashmaydi", () => {
  const a = crosswordSeed(meta(), input());
  const b = crosswordSeed(meta(), input());
  assert.equal(a, b, "bir xil buyurtma — bir xil urug'");
  // MUTATSIYA-4: mavzu hisobga olinmasa ikki xil krossvord bir xil to'r olardi.
  assert.notEqual(a, crosswordSeed(meta({ topic: "Boshqa mavzu" }), input({ topic: "Boshqa mavzu" })));
  assert.notEqual(a, crosswordSeed(meta(), input({ wordCount: 20 })));
  assert.notEqual(a, crosswordSeed(meta(), input({ type: "tarifli" })), "tur ham urug'ga kiradi");
});

/* ────────────────────────── promptlar ────────────────────────── */

test("tizim prompti: model FAQAT so'z+ta'rif beradi, to'r qurmaydi", () => {
  const p = crosswordSystemPrompt(input(), specOf());
  // MUTATSIYA-3: bu qator olinsa model koordinata qaytarishga urinardi.
  assert.match(p, /YOU DO NOT BUILD THE GRID/);
  assert.ok(!/row|col|coordinate|intersect at/i.test(p.replace(/computed by the program[\s\S]*/, "")), "promptda koordinata so'ralmasin");
  assert.match(p, /"words":\[\{"answer"/, "JSON shakli ko'rsatilmagan");
  assert.ok(!p.includes("```"), "markdown fence taklif qilinmasin");
});

test("tizim prompti reyestr chegaralarini AYNAN aytadi (so'z 3–15, ta'rif 10–150)", () => {
  const p = crosswordSystemPrompt(input(), specOf());
  // MUTATSIYA-5: chegara promptdan tushsa model 20 harfli so'z berardi.
  assert.ok(p.includes(`${CROSSWORD_LIMITS.answerMin}–${CROSSWORD_LIMITS.answerMax} letters`), "so'z uzunligi chegarasi yo'q");
  assert.ok(p.includes(`${CROSSWORD_LIMITS.clueMin}–${CROSSWORD_LIMITS.clueMax} characters`), "ta'rif uzunligi chegarasi yo'q");
  assert.match(p, /must NOT contain the answer/, "«ta'rifda javob bo'lmasin» qoidasi yo'q");
  assert.match(p, /never cryptic/, "kriptik ta'rif taqiqi yo'q");
  assert.match(p, /ONE word/, "bir so'zlilik qoidasi yo'q");
  assert.match(p, /oʻ and gʻ/, "o'zbek apostrofli harflar qoidasi yo'q");
  assert.ok(!/hammasi to'g'ri»?\s*$/.test(p) && p.includes("hammasi to'g'ri"), "«hammasi to'g'ri» taqiqi yo'q");
});

test("tur REYESTRDAN promptga tushadi: guidance qatorlari va turga xos ta'rif uzunligi", () => {
  const klassik = specOf("klassik");
  const tarifli = specOf("tarifli");
  const pk = crosswordSystemPrompt(input({ type: "klassik" }), klassik);
  const pt = crosswordSystemPrompt(input({ type: "tarifli" }), tarifli);
  // Reyestrdagi HAR guidance qatori promptda (ikkinchi nusxa yozilmagan).
  for (const g of klassik.guidance) assert.ok(pk.includes(g), `guidance yo'q: ${g.slice(0, 40)}…`);
  for (const g of tarifli.guidance) assert.ok(pt.includes(g), `guidance yo'q: ${g.slice(0, 40)}…`);
  // «Ta'rifli» turda ta'rif pastki chegarasi 40 belgi (sinonim emas).
  assert.ok(pt.includes(`${tarifli.limits.clueChars[0]}–${tarifli.limits.clueChars[1]} characters`));
  assert.notEqual(klassik.limits.clueChars[0], tarifli.limits.clueChars[0], "reyestrda turlar farqi yo'qolgan");
  assert.ok(pk.includes(klassik.label.en) && pt.includes(tarifli.label.en), "tur nomi promptda yo'q");
});

test("tizim prompti: chiqish tili va sinf darajasi", () => {
  const uz = crosswordSystemPrompt(input({ language: "uz" }), specOf());
  assert.match(uz, /OUTPUT LANGUAGE: Uzbek/);
  assert.match(uz, /grade 7/);
  const en = crosswordSystemPrompt(input({ language: "en", grade: 0 }), specOf());
  assert.match(en, /OUTPUT LANGUAGE: English/);
  assert.match(en, /general secondary school/);
  assert.ok(!/grade 0/.test(en), "sinf ko'rsatilmasa «grade 0» yozilmasin");
});

test("so'rov prompti: so'z soni, takrorlanmaslik ro'yxati va qayta so'rov ohangi", () => {
  const first = crosswordUserPrompt(input(), { n: 10 });
  assert.match(first, /Write 10 answer\+clue pairs/);
  assert.ok(!first.includes("ALREADY USED"), "birinchi so'rovda takror ro'yxati yo'q");
  const again = crosswordUserPrompt(input(), { n: 3, avoid: ["HUJAYRA", "YADRO"], retry: true });
  assert.match(again, /Write 3 answer\+clue pairs/);
  assert.match(again, /ALREADY USED/);
  assert.ok(again.includes("HUJAYRA") && again.includes("YADRO"));
  // Sig'magan so'z o'rniga — qisqaroq so'z so'raladi (to'rga oson tushadi).
  assert.match(again, /prefer SHORTER answers/);
  assert.ok(!first.includes("prefer SHORTER answers"));
});

test("so'rov prompti: qo'shimcha talab va uzunlik xilma-xilligi", () => {
  const p = crosswordUserPrompt(input({ extra: "Faqat mitoxondriya mavzusida" }), { n: 5 });
  assert.match(p, /TEACHER'S EXTRA REQUEST: Faqat mitoxondriya mavzusida/);
  assert.match(p, /Vary the answer length/, "to'r uchun har xil uzunlik so'ralmadi");
  assert.ok(!crosswordUserPrompt(input({ extra: "" }), { n: 5 }).includes("EXTRA REQUEST"));
});

test("fayl rejimi bloki: so'zlar faqat manbadan, kam bo'lsa kam qaytarsin", () => {
  const src = "Hujayra — tirik organizmning asosiy tuzilma birligi. Yadro hujayraning markazi.";
  const block = crosswordSourceBlock(meta({ sourceText: src }));
  assert.ok(block.includes(src), "manba matni blokka tushmadi");
  assert.match(block, /APPEARS in the source text/);
  assert.match(block, /return fewer words rather than inventing/);
  assert.equal(crosswordSourceBlock(meta({ sourceText: "" })), "", "manbasiz bo'sh satr");
  // Blok so'rov promptiga qo'shiladi.
  assert.ok(crosswordUserPrompt(input({ mode: "file" }), { n: 5 }, { source: block }).includes("SOURCE MODE"));
});

/* ────────────────────────── yorliqlar ────────────────────────── */

test("hujjat yorliqlari hujjat tiliga ergashadi (uz/ru/en, boshqasi — en)", () => {
  assert.equal(crosswordLabels("uz").across, "Gorizontal");
  assert.equal(crosswordLabels("ru").across, "По горизонтали");
  assert.equal(crosswordLabels("en").across, "Across");
  // Noma'lum tilda zaxira — o'zbekcha (`sectionLabels`/`omrLabels` bilan bir xil).
  assert.equal(crosswordLabels("de").across, "Gorizontal");
  assert.equal(crosswordLabels("").across, "Gorizontal");
  for (const lang of ["uz", "ru", "en"]) {
    const L = crosswordLabels(lang);
    for (const v of [L.grid, L.across, L.down, L.answers, L.numbering, L.fromFile]) assert.ok(v.length > 0);
    assert.match(L.howTo(10), /10/);
  }
});

test("ko'rsatma satrlari dvigateldan chiqadi va fayl rejimida manba eslatiladi", () => {
  const topic = instructionLines(input(), 10, "uz");
  assert.ok(topic.length >= 2);
  assert.match(topic[0], /10 ta so'zni toping/);
  assert.match(topic[1], /Katakdagi raqam/);
  assert.ok(!topic.some((l) => l.includes("yuklangan hujjatdan")));
  const file = instructionLines(input({ mode: "file" }), 8, "uz");
  assert.ok(file.some((l) => l.includes("yuklangan hujjatdan")), "fayl rejimida manba eslatilmadi");
  assert.match(file[0], /8 ta so'zni toping/);
});

/* ══════════════════════════ dvigatel (mock LLM) ══════════════════════════ */

/**
 * Tarmoq ham, `sharp` ham chaqirilmaydi: LLM `complete` seam i bilan,
 * PNG `buildFigures` seam i bilan, fayl matni `sourceTextOf` seam i
 * bilan almashtiriladi (`teacher/test/engine` naqshi).
 *
 * Mutatsiyalar (qizardi):
 *   6. `buildCrosswordDoc` sig'magan so'zlar uchun qo'shimcha so'rov
 *      qilmadi — «qo'shimcha so'rov» testi;
 *   7. `delivered` so'ralgan sonni qaytardi (joylashganini emas) —
 *      «delivered to'rdan hisoblanadi» testi;
 *   8. javoblar bo'limi bo'sh qoldi — «javoblar bo'limi» testi;
 *   9. `doc.game.crossword.grid` model bilan ajralib ketdi —
 *      «model ↔ to'r mosligi» testi;
 *  10. `CostMeter` sarfni yig'madi — «sarf telemetriyasi» testi.
 */

const WORDS: [string, string][] = [
  ["matematika", "Sonlar va shakllar haqidagi aniq fan"],
  ["biologiya", "Tirik organizmlarni o'rganadigan fan"],
  ["kimyo", "Moddalar tarkibi haqidagi fan nomi"],
  ["fizika", "Tabiat hodisalari haqidagi fan nomi"],
  ["geografiya", "Yer yuzasini o'rganuvchi fan nomi"],
  ["tarix", "O'tmish voqealarini o'rganuvchi fan"],
  ["adabiyot", "So'z san'ati asarlari majmuasi"],
  ["algebra", "Harfli amallar bilan ishlovchi bo'lim"],
  ["atom", "Modda tuzilishining kichik zarrasi"],
  ["molekula", "Zarrachalardan tuzilgan birikma nomi"],
  ["o'simlik", "Fotosintez qiluvchi tirik organizm"],
  ["quyosh", "Sistemamiz markazidagi yulduz nomi"],
  ["vektor", "Yo'nalishga ega bo'lgan kattalik"],
  ["kislota", "Lakmusni qizartiruvchi modda nomi"],
  ["hujayra", "Organizmning asosiy tuzilma birligi"],
  ["tenglama", "Noma'lumli tenglik ifodasi nomi"],
  ["bosim", "Yuzaga tik ta'sir etuvchi kattalik"],
  ["tezlik", "Vaqt birligida bosib o'tilgan yo'l"],
  ["shakar", "Shirin ta'mli oziq-ovqat mahsuloti"],
  ["daraxt", "Yog'och tanali ko'p yillik o'simlik"],
];

type MockOpts = {
  /** Birinchi javobda nechta so'z qaytsin (standart: so'ralgancha). */
  first?: number;
  /** Qo'shimcha so'rovda qaytadigan so'zlar (standart: navbatdagilari). */
  retryWords?: [string, string][];
  /** Baholovchi ballari. */
  judge?: Record<string, number>;
};

const USAGE = { provider: "gemini", model: "gemini-2.5-flash", inputTokens: 800, outputTokens: 900 };

function mockComplete(o: MockOpts = {}) {
  const calls: { role: string; system: string; user: string }[] = [];
  let at = 0;
  const fn = async (role: LlmRole, system: string, user: string) => {
    calls.push({ role, system, user });
    if (role === "judge") {
      const scores = o.judge ?? { clueClarity: 3, wordGrade: 3, gridConnectedness: 3, answerAccuracy: 3, originality: 2 };
      return { text: JSON.stringify({ ...scores, notes: ["yaxshi"], fixes: [] }), usage: USAGE };
    }
    const asked = Number(/Write (\d+) answer\+clue pairs/.exec(user)?.[1] ?? 10);
    const retry = user.includes("prefer SHORTER answers");
    const list = retry && o.retryWords ? o.retryWords : WORDS.slice(at, at + (o.first && !retry ? o.first : asked));
    if (!retry) at += list.length;
    return { text: JSON.stringify({ words: list.map(([answer, clue]) => ({ answer, clue })) }), usage: USAGE };
  };
  return { fn: fn as unknown as NonNullable<CrosswordBuildOpts["complete"]>, calls };
}

/** PNG o'rniga — `figurePng` chaqirilmaydi, faqat o'lcham qo'yiladi. */
const fakeFigures = (): NonNullable<CrosswordBuildOpts["buildFigures"]> => async (figs) =>
  figs.map((f) => ({ ...f, url: "data:image/png;base64,AA==", w: 1800, h: 1600 }));

const buildOpts = (over: Partial<CrosswordBuildOpts> = {}): CrosswordBuildOpts => ({
  deadline: Date.now() + 300_000,
  complete: mockComplete().fn,
  buildFigures: fakeFigures(),
  judge: false,
  polish: false,
  seed: "engine-test",
  now: new Date("2026-09-17T10:00:00Z"),
  ...over,
});

test("buildCrosswordDoc: bo'lim id lari SHARTNOMA — grid · across · down · answers", async () => {
  const built = await buildCrosswordDoc(meta(), values({ wordCount: 10 }), buildOpts());
  assert.ok(built, "hujjat qurilmadi");
  assert.deepEqual(built!.doc.sections.map((s) => s.id), [...CROSSWORD_SECTION_IDS]);
  const grid = built!.doc.sections.find((s) => s.id === "grid")!;
  assert.ok(grid.blocks.some((b) => b.kind === "figure"), "to'r rasmi bloki yo'q");
  assert.ok(grid.blocks.some((b) => b.kind === "p"), "ko'rsatma matni yo'q");
  // Savollar «1. Ta'rif (katak soni)» ko'rinishida.
  const across = built!.doc.sections.find((s) => s.id === "across")!;
  assert.ok(across.blocks.length > 0);
  for (const b of across.blocks) assert.match(b.text, /^\d+\. .+ \(\d+\)$/, `savol shakli: ${b.text}`);
});

test("model: `doc.game` R0 shartnomasi bo'yicha to'ldiriladi", async () => {
  const built = await buildCrosswordDoc(meta(), values({ wordCount: 10, crosswordType: "tarifli" }), buildOpts());
  const game = built!.doc.game!;
  assert.equal(game.v, 1);
  assert.equal(game.kind, "crossword");
  assert.equal(game.type, "tarifli", "tur modelga yozilmadi");
  assert.equal(game.language, "uz");
  assert.equal(game.topic, "Hujayra tuzilishi");
  const cw = game.crossword!;
  assert.ok(cw.words.length > 0);
  // MUTATSIYA-9: model va to'r ajralib ketsa bu tekshiruv qizaradi.
  for (const w of cw.words) {
    assert.ok(Array.isArray(w.answer), "javob katak ro'yxati bo'lishi kerak");
    w.answer.forEach((ch, i) => {
      const r = w.dir === "across" ? w.row : w.row + i;
      const c = w.dir === "across" ? w.col + i : w.col;
      assert.equal(cw.grid.cells[r][c], ch, `«${wordText(w.answer)}» to'rga mos emas`);
    });
  }
  assert.equal(cw.clues.across.length + cw.clues.down.length, cw.words.length);
  assert.ok(Array.isArray(cw.dropped));
  assert.ok(game.figures && game.figures.length === 2, "to'r va javob rasmlari yo'q");
});

test("javoblar bo'limi: rasm + raqam→so'z ro'yxati (PNG chizilmasa ham javob ko'rinadi)", async () => {
  const built = await buildCrosswordDoc(meta(), values({ wordCount: 10 }), buildOpts());
  const answers = built!.doc.sections.find((s) => s.id === "answers")!;
  // MUTATSIYA-8: bo'lim bo'sh qolsa o'qituvchi javoblarni ololmasdi.
  assert.ok(answers.blocks.length >= 2, "javoblar bo'limi bo'sh");
  assert.ok(answers.blocks.some((b) => b.kind === "figure"), "javob to'ri rasmi yo'q");
  const text = answers.blocks.filter((b) => b.kind === "p").map((b) => b.text).join(" ");
  const first = built!.doc.game!.crossword!.words[0];
  assert.ok(text.includes(wordText(first.answer)), "javob matni ro'yxatda yo'q");
  // PNG seam i ishlamasa ham (rasm yo'q) javob ro'yxati qoladi.
  const noPng = await buildCrosswordDoc(meta(), values({ wordCount: 10 }), buildOpts({ buildFigures: async () => [] }));
  const plain = noPng!.doc.sections.find((s) => s.id === "answers")!;
  assert.ok(!plain.blocks.some((b) => b.kind === "figure"));
  assert.ok(plain.blocks.some((b) => b.kind === "p"), "rasm yo'q bo'lsa ham javoblar matni bo'lsin");
});

test("delivered — TO'RGA TUSHGAN so'z soni (va'da qilingan emas)", async () => {
  const built = await buildCrosswordDoc(meta(), values({ wordCount: 10 }), buildOpts());
  const placed = built!.doc.game!.crossword!.words.length;
  // MUTATSIYA-7: `want` ni `got` sifatida qaytarish qisman qaytarishni o'chirardi.
  assert.equal(built!.delivered!.got, placed);
  assert.equal(built!.delivered!.want, 10);
  assert.ok(placed <= 10, "va'dadan ortiq so'z qo'yilmasin");
});

test("sig'magan so'zlar uchun bir marta QO'SHIMCHA so'rov (qisqaroq so'z so'raladi)", async () => {
  // Birinchi javobda atigi 4 so'z — 10 tasi so'ralgan edi.
  const mock = mockComplete({ first: 4, retryWords: WORDS.slice(10, 18) });
  const built = await buildCrosswordDoc(meta(), values({ wordCount: 10 }), buildOpts({ complete: mock.fn }));
  const writers = mock.calls.filter((c) => c.role === "writer");
  // MUTATSIYA-6: qo'shimcha so'rov bo'lmasa bitta chaqiruv qolardi.
  assert.equal(writers.length, 2, "qo'shimcha so'rov qilinmadi");
  assert.match(writers[1].user, /prefer SHORTER answers/, "qayta so'rov ohangi yo'q");
  assert.match(writers[1].user, /ALREADY USED/, "takrorlanmaslik ro'yxati yo'q");
  assert.ok(built!.doc.game!.crossword!.words.length > 4, "qo'shimcha so'zlar to'rga qo'shilmadi");
  // Qo'shimcha so'rov FAQAT BIR MARTA (cheksiz tsikl yo'q).
  const poor = mockComplete({ first: 3, retryWords: [["kitob", "O'qish uchun bosma nashr turi"]] });
  await buildCrosswordDoc(meta(), values({ wordCount: 20 }), buildOpts({ complete: poor.fn }));
  assert.equal(poor.calls.filter((c) => c.role === "writer").length, 2, "ikkinchi marta qayta so'ralmasin");
});

test("sarf telemetriyasi: `CostMeter` har chaqiruvni sanaydi", async () => {
  const costs: unknown[] = [];
  const usages: unknown[] = [];
  const built = await buildCrosswordDoc(
    meta(),
    values({ wordCount: 10 }),
    buildOpts({ judge: true, onCost: (c) => costs.push(c), onUsage: (u) => usages.push(u) }),
  );
  // MUTATSIYA-10: `meter.add` chaqirilmasa sarf nolga tushardi.
  assert.equal(costs.length, 1, "`onCost` bir marta chaqirilsin");
  assert.ok(usages.length >= 2, `yozuvchi + baholovchi sarfi: ${usages.length}`);
  assert.ok(JSON.stringify(built!.cost).includes("gemini"), "provayder sarfda yo'q");
});

test("bosqichlar: `onStage` foizi kamaymaydi va 100 bilan tugaydi", async () => {
  const seen: number[] = [];
  await buildCrosswordDoc(meta(), values({ wordCount: 10 }), buildOpts({ onStage: (e) => seen.push(e.progress) }));
  assert.ok(seen.length >= 3, `bosqichlar: ${seen.join(", ")}`);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1], `foiz kamaydi: ${seen.join(", ")}`);
  assert.equal(seen.at(-1), 100);
});

test("hisobot hujjatga yoziladi; `judge:false` da model CHAQIRILMAYDI (ballar neytral)", async () => {
  const off = mockComplete();
  const built = await buildCrosswordDoc(meta(), values({ wordCount: 10 }), buildOpts({ complete: off.fn, judge: false }));
  const review = built!.doc.game!.review!;
  assert.ok(review.score > 0, "ball qo'yilmadi");
  assert.ok(review.checks.filter((c) => !c.id.startsWith("judge:")).length >= 10, "qoidalar bandlari yetishmadi");
  // Oila naqshi (`reviewTest`): baholovchi o'chirilganda bandlar NEYTRAL
  // (2/3) bo'lib qoladi, lekin modelga chaqiruv KETMAYDI.
  assert.equal(off.calls.filter((c) => c.role === "judge").length, 0, "baholovchi chaqirildi");
  const neutral = review.checks.filter((c) => c.id.startsWith("judge:") && !c.id.startsWith("judge:fix:"));
  assert.ok(neutral.length > 0);
  assert.ok(neutral.every((c) => c.detail === "2/3"), `neytral emas: ${neutral.map((c) => c.detail).join(", ")}`);

  const on = mockComplete({ judge: { clueClarity: 3, wordGrade: 3, gridConnectedness: 3, answerAccuracy: 3, originality: 1 } });
  const judged = await buildCrosswordDoc(meta(), values({ wordCount: 10 }), buildOpts({ complete: on.fn, judge: true }));
  assert.equal(on.calls.filter((c) => c.role === "judge").length, 1, "baholovchi chaqirilmadi");
  const checks = judged!.doc.game!.review!.checks;
  assert.equal(checks.find((c) => c.id === "judge:originality")?.detail, "1/3", "baholovchi bali hisobotga tushmadi");
  assert.equal(checks.find((c) => c.id === "judge:originality")?.level, "red");
  assert.ok(judged!.doc.game!.review!.score < review.score + 100);
});

test("determinizm: bir xil urug'da hujjat bayt-bayt bir xil", async () => {
  const a = await buildCrosswordDoc(meta(), values({ wordCount: 10 }), buildOpts());
  const b = await buildCrosswordDoc(meta(), values({ wordCount: 10 }), buildOpts());
  assert.equal(JSON.stringify(a!.doc.game!.crossword), JSON.stringify(b!.doc.game!.crossword));
  assert.deepEqual(a!.doc.sections, b!.doc.sections);
});

test("fayl rejimi: manba matni promptga tushadi (`sourceTextOf` seam)", async () => {
  const mock = mockComplete();
  const src = "Hujayra — tirik organizmning asosiy tuzilma birligi. Yadro hujayra markazi.";
  await buildCrosswordDoc(
    meta({ sourceText: "" }),
    values({ wordCount: 10, mode: "file" }),
    buildOpts({
      complete: mock.fn,
      source: { bytes: new Uint8Array([1]), name: "dars.docx", kind: "docx", mime: "application/vnd", chars: src.length },
      sourceTextOf: async () => src,
    }),
  );
  const first = mock.calls.find((c) => c.role === "writer")!;
  assert.ok(first.user.includes(src), "manba matni promptda yo'q");
  assert.match(first.user, /SOURCE MODE/, "fayl rejimi bloki yo'q");
});

test("LLM javob bermasa — `null` (chaqiruvchi mavjud xulqqa tushadi)", async () => {
  const empty = (async () => null) as unknown as NonNullable<CrosswordBuildOpts["complete"]>;
  assert.equal(await buildCrosswordDoc(meta(), values({ wordCount: 10 }), buildOpts({ complete: empty })), null);
  const junk = (async () => ({ text: "kechirasiz, men krossvord tuza olmayman", usage: USAGE })) as unknown as NonNullable<
    CrosswordBuildOpts["complete"]
  >;
  assert.equal(await buildCrosswordDoc(meta(), values({ wordCount: 10 }), buildOpts({ complete: junk })), null);
});

test("`parseWords`: maydon nomlari erkin, bo'sh bandlar tashlanadi", () => {
  const raw = JSON.stringify({
    words: [
      { answer: "atom", clue: "Zarra nomi" },
      { word: "modda", definition: "Moddaning o'zi" },
      { answer: "", clue: "Javobsiz" },
      { answer: "yadro", clue: "" },
      { answer: "  hujayra  ", clue: "  Ko'p   bo'shliqli   ta'rif  " },
    ],
  });
  const got = parseWords(raw);
  assert.deepEqual(got.map((w) => w.answer), ["atom", "modda", "hujayra"]);
  assert.equal(got[2].clue, "Ko'p bo'shliqli ta'rif", "bo'shliqlar normallashmadi");
  assert.deepEqual(parseWords(null), []);
  assert.deepEqual(parseWords("bu JSON emas"), []);
});

/* ══════════════════════════ sayqal ══════════════════════════ */

/**
 * Mutatsiyalar (qizardi):
 *  11. `planCrosswordPolish` to'r bandlarini ham tuzatishga urindi —
 *      «to'r bandlari `manual`» testi;
 *  12. `applyClueOps` javob/koordinatani ham o'zgartirdi — «so'z
 *      daxlsiz» testi;
 *  13. `rewriteClues` javobni oshkor qiladigan ta'rifni qabul qildi —
 *      «yomon ta'rif rad etiladi» testi.
 */

const docOf = async (over: Partial<CrosswordBuildOpts> = {}) =>
  (await buildCrosswordDoc(meta(), values({ wordCount: 10 }), buildOpts(over)))!.doc;

test("sayqal rejasi: TA'RIF bandlari tuzatiladi, TO'R bandlari `manual`", () => {
  const review = {
    score: 60,
    checks: [
      { id: "clueLength", level: "yellow" as const, label: "Ta'rif uzunligi", fix: { op: "rewrite" as const, target: "clues", instruction: "Qisqa ta'riflarni yozing." } },
      { id: "clueNotContainsAnswer", level: "red" as const, label: "Oshkor", fix: { op: "rewrite" as const, target: "clues", instruction: "Javobni ta'rifdan olib tashlang." } },
      { id: "minCrossings", level: "red" as const, label: "Kesishmalar", fix: { op: "rewrite" as const, target: "grid", instruction: "Ko'proq kesishadigan so'z tanlang." } },
      { id: "wordCount", level: "yellow" as const, label: "So'zlar soni", fix: { op: "rewrite" as const, target: "grid", instruction: "Qisqaroq so'z tanlang." } },
      { id: "judge:clueClarity", level: "red" as const, label: "Aniqlik", fix: { op: "rewrite" as const, target: "clues", instruction: "Ta'riflarni aniqlashtiring." } },
    ],
    judgeNotes: [],
    verifiedShare: 0,
    recentShare: 0,
    builtAt: "2026-09-17T10:00:00.000Z",
  };
  const plan = planCrosswordPolish(review);
  // MUTATSIYA-11: to'r bandlari fix ga tushsa sayqal so'zni o'zgartirishga urinardi.
  assert.deepEqual(plan.fixes.map((f) => f.target), ["clues", "clues", "clues"]);
  assert.ok(plan.skipped.some((s) => s.id === "minCrossings" && s.reason === "manual"));
  assert.ok(plan.skipped.some((s) => s.id === "wordCount" && s.reason === "manual"));
  assert.ok(!plan.fixes.some((f) => f.instruction.includes("so'z tanlang")), "to'r ko'rsatmasi rejaga tushdi");
});

test("`applyClueOps`: ta'rif almashadi, JAVOB va koordinata daxlsiz", async () => {
  const doc = await docOf();
  const before = doc.game!.crossword!;
  const target = before.words[0];
  const res = applyClueOps(doc, [{ op: "clue", wordId: target.id, clue: "Butunlay yangi va aniq ta'rif matni" }]);
  assert.ok(res.ok, "op qo'llanmadi");
  const after = (res as { ok: true; doc: typeof doc }).doc.game!.crossword!;
  const got = after.words.find((w) => w.id === target.id)!;
  assert.equal(got.clue, "Butunlay yangi va aniq ta'rif matni");
  // MUTATSIYA-12: javob yoki koordinata o'zgarsa to'r buzilardi.
  assert.deepEqual(got.answer, target.answer, "javob o'zgardi");
  assert.equal(got.row, target.row);
  assert.equal(got.col, target.col);
  assert.equal(got.number, target.number);
  assert.deepEqual(after.grid, before.grid, "to'r o'zgardi");
  // Savollar ro'yxati va HUJJAT MATNI ham yangilanadi (uch joy ajralmasin).
  const clue = [...after.clues.across, ...after.clues.down].find((c) => c.wordId === target.id)!;
  assert.equal(clue.text, "Butunlay yangi va aniq ta'rif matni");
  const section = (res as { ok: true; doc: typeof doc }).doc.sections.find((s) => s.id === (target.dir === "across" ? "across" : "down"))!;
  assert.ok(section.blocks.some((b) => b.text.includes("Butunlay yangi va aniq ta'rif matni")), "bo'lim matni yangilanmadi");
  assert.ok(!applyClueOps(doc, []).ok, "bo'sh op ro'yxati rad etilsin");
});

test("`rewriteClues`: javobni oshkor qiladigan yoki o'lchovsiz ta'rif RAD etiladi", async () => {
  const doc = await docOf();
  const words = doc.game!.crossword!.words;
  const first = words[0];
  const answer = wordText(first.answer);
  const reply = JSON.stringify({
    clues: [
      // 1) javobni o'z ichiga oladi — rad;
      { id: first.id, clue: `${answer} nima ekanini ayting` },
      // 2) juda qisqa — rad;
      { id: words[1].id, clue: "Qisqa" },
      // 3) noma'lum id — rad;
      { id: "yoq-bunday-id", clue: "Mutlaqo yaroqli va uzunligi yetarli ta'rif" },
      // 4) to'g'ri — qabul.
      { id: words[2].id, clue: "Mutlaqo yaroqli va uzunligi yetarli ta'rif" },
    ],
  });
  const complete = (async () => ({ text: reply, usage: USAGE })) as unknown as NonNullable<CrosswordBuildOpts["complete"]>;
  const out = await rewriteClues(doc, { op: "rewrite", target: "clues", instruction: "Aniqlashtiring" }, {
    complete,
    input: crosswordInputFromValues(meta(), values({ wordCount: 10 })),
    spec: specOf(),
    deadline: Date.now() + 120_000,
  });
  // MUTATSIYA-13: filtr bo'lmasa to'rttasi ham qabul qilinardi.
  assert.deepEqual(out.ops.map((o) => o.wordId), [words[2].id]);
  assert.deepEqual(out.rewrittenSections, ["across", "down"]);
  // Hech biri qabul qilinmasa — xato (sayqal yomonlashtirmasin).
  const allBad = (async () => ({ text: JSON.stringify({ clues: [{ id: first.id, clue: `${answer} haqida` }] }), usage: USAGE })) as unknown as NonNullable<
    CrosswordBuildOpts["complete"]
  >;
  await assert.rejects(
    rewriteClues(doc, { op: "rewrite", target: "clues", instruction: "x" }, {
      complete: allBad,
      input: crosswordInputFromValues(meta(), values({ wordCount: 10 })),
      spec: specOf(),
      deadline: Date.now() + 120_000,
    }),
  );
});

test("«Sizdan kutiladi»: to'rga sig'magan so'zlar o'qituvchiga aytiladi", () => {
  const needs = crosswordUserNeeds(
    { dropped: [{ answer: ["Q", "W", "X", "Z"], reason: "no-fit" }, { answer: ["U", "Y"], reason: "too-short" }] },
    { wordCount: 10 },
  );
  assert.equal(needs.length, 1, "faqat sig'magan so'zlar uchun band");
  assert.equal(needs[0].id, "droppedWords");
  assert.match(needs[0].hint, /QWXZ/);
  assert.ok(!needs[0].hint.includes("UY"), "uzunlik sababli tashlangan so'z bu bandda emas");
  assert.equal(crosswordUserNeeds({ dropped: [] }, { wordCount: 10 }).length, 0);
});

test("delivered: so'zlar to'rga sig'masa `got` KAMAYADI (qisman qaytarish shunga tayanadi)", async () => {
  /*
   * Model 20 so'z so'ralganda faqat 6 tasini beradi va qo'shimcha
   * so'rovda ham bitta qo'shadi — ya'ni va'da bajarilmaydi. `delivered`
   * SHU holatni ko'rsatishi kerak: `write-llm.ts` undan qisman pul
   * qaytarishni hisoblaydi.
   */
  const mock = mockComplete({ first: 6, retryWords: [["kitob", "O'qish uchun bosma nashr turi"]] });
  const built = await buildCrosswordDoc(meta(), values({ wordCount: 20 }), buildOpts({ complete: mock.fn }));
  const placed = built!.doc.game!.crossword!.words.length;
  assert.ok(placed < 20, `${placed} so'z joylashdi — sinov holati noto'g'ri`);
  assert.equal(built!.delivered!.got, placed, "delivered to'rdan hisoblanmadi");
  assert.equal(built!.delivered!.want, 20);
  assert.notEqual(built!.delivered!.got, built!.delivered!.want, "qisman yetkazish ko'rinmadi");
});

test("sayqal: TO'R bandi `clues` nishoni bilan kelsa ham tuzatishga tushmaydi", () => {
  /*
   * Ikki qatlamli himoya: `GRID_RULE_IDS` (band id si bo'yicha) va
   * nishon tekshiruvi (`target !== "clues"`). Reyestr band id sini
   * o'zgartirsa ham to'r bandi sayqalga tushmasligi kerak.
   */
  const plan = planCrosswordPolish({
    score: 50,
    checks: [
      { id: "minCrossings", level: "red", label: "Kesishmalar", fix: { op: "rewrite", target: "clues", instruction: "Ko'proq kesishsin." } },
      { id: "clueLength", level: "yellow", label: "Ta'rif", fix: { op: "rewrite", target: "clues", instruction: "Uzunlikni to'g'rilang." } },
    ],
    judgeNotes: [],
    verifiedShare: 0,
    recentShare: 0,
    builtAt: "2026-09-17T10:00:00.000Z",
  });
  assert.deepEqual(plan.fixes.map((f) => f.instruction), ["Uzunlikni to'g'rilang."], "to'r bandi tuzatishga tushdi");
  assert.ok(plan.skipped.some((s) => s.id === "minCrossings" && s.reason === "manual"));
});

test("`buildGameDoc` dispatch: krossvord bizning dvigatelga, boshqasi `null`", async () => {
  // MUTATSIYA-12: dispatch ulanmasa vosita hech qachon hujjat qurmasdi.
  const built = await buildGameDoc(meta(), values({ wordCount: 10 }), buildOpts());
  assert.ok(built, "krossvord dispatch qilinmadi");
  assert.equal(built!.doc.game!.kind, "crossword");
  // Flesh kartalar dvigateli (WP-B) hali yo'q — `null`, yiqilish YO'Q.
  assert.equal(await buildGameDoc(meta({ toolId: "flashcards" } as Partial<DocMeta>), values({ cardCount: 10 }), buildOpts()), null);
  // O'yin bo'lmagan vosita.
  assert.equal(await buildGameDoc(meta({ toolId: "lesson-plan" } as Partial<DocMeta>), values(), buildOpts()), null);
});
