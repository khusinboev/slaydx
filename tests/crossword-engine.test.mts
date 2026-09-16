import test from "node:test";
import assert from "node:assert/strict";
import {
  CROSSWORD_LIMITS,
  crosswordInputFromValues,
  crosswordSeed,
  isCrosswordMode,
  nearestChoice,
  type CrosswordInput,
} from "../lib/generation/games/crossword/input.ts";
import {
  crosswordLabels,
  crosswordSourceBlock,
  crosswordSystemPrompt,
  crosswordUserPrompt,
  instructionLines,
} from "../lib/generation/games/crossword/prompts.ts";
import type { DocMeta } from "../lib/generation/types.ts";
import type { FormValues } from "../lib/types.ts";

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

/* ────────────────────────── kirish ────────────────────────── */

test("standart qiymatlar: 10 so'z, 15×15 to'r, mavzu rejimi, meta dan fan/sinf/til", () => {
  const got = crosswordInputFromValues(meta(), values());
  assert.equal(got.wordCount, CROSSWORD_LIMITS.wordCountDefault);
  assert.equal(got.gridSize, CROSSWORD_LIMITS.gridSizeDefault);
  assert.equal(got.mode, "topic");
  assert.equal(got.subject, "Biologiya");
  assert.equal(got.grade, 7);
  assert.equal(got.language, "uz");
  assert.equal(got.topic, "Hujayra tuzilishi");
  assert.equal(got.author, "Aziza Karimova");
  assert.equal(got.institution, "12-maktab");
});

test("reyestrdan tashqari son eng yaqin chipga tushadi (bezak qiymat yo'q)", () => {
  // MUTATSIYA-1: chegaralanmasa dvigatel 12 so'z bilan ishlab ketardi.
  assert.equal(crosswordInputFromValues(meta(), values({ wordCount: 12 })).wordCount, 10);
  assert.equal(crosswordInputFromValues(meta(), values({ wordCount: 13 })).wordCount, 15);
  assert.equal(crosswordInputFromValues(meta(), values({ wordCount: 999 })).wordCount, 20);
  assert.equal(crosswordInputFromValues(meta(), values({ wordCount: 1 })).wordCount, 5);
  assert.equal(crosswordInputFromValues(meta(), values({ gridSize: 14 })).gridSize, 13);
  assert.equal(crosswordInputFromValues(meta(), values({ gridSize: 40 })).gridSize, 21);
  // To'r o'lchamlari — TOQ va 13…21 (§3).
  for (const g of CROSSWORD_LIMITS.gridSizes) {
    assert.equal(g % 2, 1, `${g} toq emas`);
    assert.ok(g >= 13 && g <= 21);
  }
  assert.equal(nearestChoice(null, CROSSWORD_LIMITS.wordCounts, 10), 10);
});

test("so'z soni chiplari 5/10/15/20 va har biri o'tadi", () => {
  assert.deepEqual([...CROSSWORD_LIMITS.wordCounts], [5, 10, 15, 20]);
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
});

/* ────────────────────────── promptlar ────────────────────────── */

test("tizim prompti: model FAQAT so'z+ta'rif beradi, to'r qurmaydi", () => {
  const p = crosswordSystemPrompt(input());
  // MUTATSIYA-3: bu qator olinsa model koordinata qaytarishga urinardi.
  assert.match(p, /YOU DO NOT BUILD THE GRID/);
  assert.ok(!/row|col|coordinate|intersect at/i.test(p.replace(/computed by the program[\s\S]*/, "")), "promptda koordinata so'ralmasin");
  assert.match(p, /"words":\[\{"answer"/, "JSON shakli ko'rsatilmagan");
  assert.ok(!p.includes("```"), "markdown fence taklif qilinmasin");
});

test("tizim prompti reyestr chegaralarini AYNAN aytadi (so'z 3–15, ta'rif 10–150)", () => {
  const p = crosswordSystemPrompt(input());
  // MUTATSIYA-5: chegara promptdan tushsa model 20 harfli so'z berardi.
  assert.ok(p.includes(`${CROSSWORD_LIMITS.answerMin}–${CROSSWORD_LIMITS.answerMax} letters`), "so'z uzunligi chegarasi yo'q");
  assert.ok(p.includes(`${CROSSWORD_LIMITS.clueMin}–${CROSSWORD_LIMITS.clueMax} characters`), "ta'rif uzunligi chegarasi yo'q");
  assert.match(p, /must NOT contain the answer/, "«ta'rifda javob bo'lmasin» qoidasi yo'q");
  assert.match(p, /never cryptic/, "kriptik ta'rif taqiqi yo'q");
  assert.match(p, /ONE word/, "bir so'zlilik qoidasi yo'q");
  assert.match(p, /oʻ and gʻ/, "o'zbek apostrofli harflar qoidasi yo'q");
  assert.ok(!/hammasi to'g'ri»?\s*$/.test(p) && p.includes("hammasi to'g'ri"), "«hammasi to'g'ri» taqiqi yo'q");
});

test("tizim prompti: chiqish tili va sinf darajasi", () => {
  const uz = crosswordSystemPrompt(input({ language: "uz" }));
  assert.match(uz, /OUTPUT LANGUAGE: Uzbek/);
  assert.match(uz, /grade 7/);
  const en = crosswordSystemPrompt(input({ language: "en", grade: 0 }));
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
