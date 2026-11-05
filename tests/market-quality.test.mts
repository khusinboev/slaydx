import test from "node:test";
import assert from "node:assert/strict";
import type { AcademicDoc } from "../lib/generation/types.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";
import { marketQuality } from "../lib/market/quality.ts";
import { hammingDistance, simhash64 } from "../lib/market/simhash.ts";
import { bodyTextOf, marketLanguageOf, marketLevelOf, marketTitleOf, outlineOf, summaryOf, SUMMARY_MAX, TITLE_MAX } from "../lib/market/listing.ts";
import { bodyText, marketWorkDoc } from "./helpers/market-fixtures.mts";

/**
 * Quality score, near-duplicate hash and listing facts (docs/market/PLAN.md §1.2).
 *
 * Mutations (each turned the named test red, then restored):
 *   1. no rescaling over applicable parts (`sum / 100`)          -> «a deck can pass»;
 *   2. review weight 60 → 6                                      -> «the report dominates»;
 *   3. slide images part always 100                              -> «images promised»;
 *   4. volume share 0.9 → 0.1                                    -> «volume»;
 *   5. bookend check removed                                     -> «structure»;
 *   6. simhash on whole words instead of 3-shingles (span = 1)   -> «unrelated bodies»;
 *   7. `summaryOf` takes a body sentence                         -> «public text»;
 *   8. Cyrillic share 0.6 → 0                                    -> «language».
 */

const slides = (n: number, over: Partial<SlideModel> = {}): SlideModel[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}`, layout: "bullets" as const, title: `Sarlavha ${i}`, bullets: ["a", "b"], ...over }));

const deck = (n: number, images?: { want: number; got: number }): AcademicDoc =>
  ({ meta: { targetPages: n, language: "uz", toolId: "slide", topic: "T" }, titlePage: true, toc: false, sections: [], slides: slides(n), ...(images ? { slideImages: { ...images, blocked: 0, skipped: 0, failed: 0 } } : {}) }) as unknown as AcademicDoc;

test("the report dominates: a full work with a low report stays under the 70 threshold, with a high one passes", () => {
  assert.ok(marketQuality(marketWorkDoc("referat", "T", 1, { score: 40 })).score < 70);
  const good = marketQuality(marketWorkDoc("referat", "T", 1, { score: 90 }));
  assert.ok(good.score >= 70);
  assert.deepEqual(good.parts.map((p) => [p.name, p.weight]), [["review", 60], ["volume", 20], ["structure", 10]]);
  assert.equal(good.score, 93, "(90×60 + 100×20 + 100×10) / 90 = 93");
});

test("a deck can pass: parts that do not apply leave the total, so a deck without a report is judged on its own parts", () => {
  const r = marketQuality(deck(10));
  assert.deepEqual(r.parts.map((p) => p.name), ["volume", "structure"]);
  assert.equal(r.score, 100);
});

test("images promised: a shortfall lowers a deck's score; a deck that promised none has no such part", () => {
  const full = marketQuality(deck(10, { want: 5, got: 5 }));
  assert.equal(full.score, 100);
  const half = marketQuality(deck(10, { want: 4, got: 2 }));
  assert.equal(half.parts.find((p) => p.name === "images")!.value, 50);
  assert.equal(half.score, 88, "(100×20 + 100×10 + 50×10) / 40 = 87.5 → 88");
  assert.ok(!marketQuality(deck(10, { want: 0, got: 0 })).parts.some((p) => p.name === "images"));
});

test("volume: at or over 90 % of the target earns the part, a thin work does not", () => {
  const full = marketWorkDoc("referat", "T", 1, { words: 1000 });
  assert.equal(marketQuality(full).parts.find((p) => p.name === "volume")!.value, 100);
  const thin = marketQuality(marketWorkDoc("referat", "T", 1, { words: 100 }));
  assert.ok(thin.parts.find((p) => p.name === "volume")!.value < 30);
  const empty = deck(6);
  empty.slides = slides(6, { bullets: [] });
  assert.ok(marketQuality(empty).parts.find((p) => p.name === "volume")!.value < 30, "slides without content are thin");
});

test("structure: ≥ 3 sections with intro + conclusion earn it; a work without its conclusion loses half; ≥ 6 slides", () => {
  const doc = marketWorkDoc("referat", "T", 1);
  assert.equal(marketQuality(doc).parts.find((p) => p.name === "structure")!.value, 100);
  doc.sections = doc.sections.slice(0, 2).concat([{ id: "ch2", title: "Ikkinchi", blocks: [] }]);
  assert.equal(marketQuality(doc).parts.find((p) => p.name === "structure")!.value, 50);
  assert.equal(marketQuality(deck(3)).parts.find((p) => p.name === "structure")!.value, 50);
  const konspekt = marketWorkDoc("konspekt", "T", 1);
  konspekt.work!.genre = "konspekt";
  konspekt.sections = konspekt.sections.map((s, i) => ({ ...s, id: `s${i}`, title: `Bo'lim ${i}` }));
  assert.equal(marketQuality(konspekt).parts.find((p) => p.name === "structure")!.value, 100, "notes have no intro + conclusion");
});

test("the essay report counts and its word goal is the volume target; the score is capped at 0..100", () => {
  const doc = {
    meta: { targetPages: 2, language: "uz", toolId: "essay", topic: "T" },
    titlePage: true,
    toc: false,
    sections: [{ id: "essay", title: "Insho", blocks: [{ kind: "p", text: bodyText(1, 300) }] }],
    essay: { words: { min: 300, max: 400, aim: 350 }, review: { score: 500 } },
  } as unknown as AcademicDoc;
  const r = marketQuality(doc);
  assert.equal(r.parts.find((p) => p.name === "review")!.value, 100);
  assert.equal(r.parts.find((p) => p.name === "volume")!.value, 100);
});

test("near-identical bodies stay within 6 bits; unrelated bodies are ≥ 20 bits apart", () => {
  const a = bodyText(7, 800);
  const words = a.split(" ");
  words[100] = "ozgartirilgan";
  words[400] = "boshqa";
  words[700] = "soz";
  assert.ok(hammingDistance(simhash64(a), simhash64(words.join(" "))) <= 6, "three changed words");
  assert.equal(hammingDistance(simhash64(a), simhash64(a)), 0);
  assert.equal(simhash64("O'zbekiston tarixi kitobi"), simhash64("Ўзбекистон тарихи китоби"), "one hash for both scripts");
  for (const seed of [8, 9, 10, 11]) {
    assert.ok(hammingDistance(simhash64(a), simhash64(bodyText(seed, 800))) >= 20, `seed ${seed}`);
  }
});

test("simhash fits a signed BIGINT and an empty text is 0", () => {
  assert.equal(simhash64(""), "0");
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const v = BigInt(simhash64(bodyText(seed, 200)));
    assert.ok(v >= -(BigInt(1) << BigInt(63)) && v < BigInt(1) << BigInt(63));
  }
  assert.equal(hammingDistance("-1", "0"), 64, "the sign bit counts");
});

test("level: school audiences, grades and contexts; a college on the title page; otherwise otm", () => {
  const work = (university: string, ministry = "oliy") => ({ meta: { university, ministry } }) as unknown as AcademicDoc;
  assert.equal(marketLevelOf(work("Toshkent davlat universiteti")), "otm");
  assert.equal(marketLevelOf(work("3-son politexnika kolleji")), "kollej");
  assert.equal(marketLevelOf(work("Akademik litsey")), "kollej");
  assert.equal(marketLevelOf(work("12-maktab", "oliy")), "maktab");
  assert.equal(marketLevelOf(work("", "maktab")), "maktab");
  assert.equal(marketLevelOf({ meta: { slideAudience: "school_8_9" } } as unknown as AcademicDoc), "maktab");
  assert.equal(marketLevelOf({ meta: { slideAudience: "students_bachelor" } } as unknown as AcademicDoc), "otm");
  assert.equal(marketLevelOf({ meta: {}, teacher: { school: { grade: 7 } } } as unknown as AcademicDoc), "maktab");
  assert.equal(marketLevelOf({ meta: {}, teacher: { school: { grade: 0 } } } as unknown as AcademicDoc), "otm");
  assert.equal(marketLevelOf({ meta: {}, essay: { context: "school_dtm" } } as unknown as AcademicDoc), "maktab");
  assert.equal(marketLevelOf({ meta: {}, essay: { context: "ielts_task2" } } as unknown as AcademicDoc), "otm");
});

test("language: Uzbek in Cyrillic letters is uz-cyr at 60 %; ru and en stay", () => {
  const doc = (language: string, text: string) => ({ meta: { language }, sections: [{ id: "a", title: "x", blocks: [{ kind: "p", text }] }] }) as unknown as AcademicDoc;
  assert.equal(marketLanguageOf(doc("uz", "Ўзбекистон тарихи ва маданияти")), "uz-cyr");
  assert.equal(marketLanguageOf(doc("uz", "O'zbekiston tarixi")), "uz");
  assert.equal(marketLanguageOf(doc("ru", "История Узбекистана")), "ru");
  assert.equal(marketLanguageOf(doc("en", "History")), "en");
});

test("public text: the outline is headings only, the summary holds no sentence of the body, both are bounded", () => {
  const doc = marketWorkDoc("referat", "Mavzu", 3);
  doc.sections = Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, title: `Bo'lim ${i}`, blocks: [{ kind: "p" as const, text: `Maxfiy jumla ${i}` }] }));
  const outline = outlineOf(doc);
  assert.equal(outline.length, 40);
  const summary = summaryOf("referat", "Mavzu", outline, { pages: "15-20" });
  assert.ok(summary.length <= SUMMARY_MAX);
  assert.ok(!summary.includes("Maxfiy"));
  assert.ok(!outline.join(" ").includes("Maxfiy"));
  assert.match(summary, /^Referat, 15-20 bet: «Mavzu»\. Bo'limlar: Bo'lim 0; Bo'lim 1; Bo'lim 2; Bo'lim 3\.$/);
  assert.match(summaryOf("slide", "Mavzu", [], { slideCount: 12 }), /^Slayd.*, 12 slayd: «Mavzu»\.$/);
  assert.equal(marketTitleOf("x".repeat(500)).length, TITLE_MAX);
});

test("a deck's outline skips the title and closing slides and repeats nothing; its body text is the hash input", () => {
  const d = deck(0);
  d.slides = [
    { id: "a", layout: "title", title: "Mavzu" },
    { id: "b", layout: "bullets", title: "Birinchi", bullets: ["alfa"] },
    { id: "c", layout: "bullets", title: "Birinchi", bullets: ["beta"] },
    { id: "d", layout: "closing", title: "Rahmat" },
  ];
  assert.deepEqual(outlineOf(d), ["Birinchi"]);
  assert.match(bodyTextOf(d), /alfa/);
});
