import test from "node:test";
import assert from "node:assert/strict";
import { factNumbers, guardSection, missingFactNumbers, numbersOf, skeletonCoverage, wordsOf } from "../lib/generation/article/guard.ts";
import { lengthLine, wordRangeAim, wordRangePrompt, FILLER_PHRASES, articleSystemPrompt, sectionPrompt, abstractPrompt, abstractSystemPrompt, type ArticleContext } from "../lib/generation/article/prompts.ts";
import { articleWordPlan } from "../lib/generation/article/engine.ts";
import { ARTICLE_TYPES } from "../lib/generation/article/types-registry.ts";
import { PUBLICATION_PROFILES } from "../lib/generation/article/profiles.ts";
import { articleLabels } from "../lib/generation/article/labels.ts";
import { articleInputFromValues } from "../lib/generation/article/input.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { Reference } from "../lib/generation/article/types.ts";
import type { Block } from "../lib/generation/types.ts";

/** Qo'riqchi + prompt taqiqlari (Maqola 2, WP1). */

const REFS: Reference[] = [
  { id: "W2741809807", title: "A", authors: [], verified: "openalex", cited: false },
  { id: "u1", title: "C", authors: [], verified: "user", cited: false },
];
const P = (text: string): Block => ({ kind: "p", text });

test("guardSection: reyestrda yo'q iqtibos o'chadi va hisoblanadi; bor iqtibos qoladi", () => {
  const { blocks, report } = guardSection([P("Da'vo [W2741809807]. Boshqa da'vo [W1234; 12-b.]. Uchinchi [u1]."), P("Formula")], { refs: REFS });
  assert.equal(blocks[0].text, "Da'vo [W2741809807]. Boshqa da'vo. Uchinchi [u1].");
  assert.deepEqual(report.removedCitations, ["W1234"]);
  assert.equal(report.citations, 2);
  assert.equal(blocks[1].text, "Formula", "tegilmagan blok o'sha obyekt");
});

test("guardSection: manbasiz foizlar hisobga olinadi, O'CHIRILMAYDI; manbali yoki foydalanuvchi faktidagi foiz hisobga olinmaydi", () => {
  const facts = "Tajribada 120 talaba; o'zlashtirish 62 % dan 78,5% ga oshdi.";
  const { blocks, report } = guardSection(
    [P("So'rovnomada 45% ishtirokchi rozi bo'ldi."), P("Adabiyotda 30 % o'sish qayd etilgan [W2741809807]."), P("Bizning tajribada 78,5% ga yetdi va 120 talaba qatnashdi.")],
    { refs: REFS, userFacts: facts },
  );
  assert.equal(blocks[0].text, "So'rovnomada 45% ishtirokchi rozi bo'ldi.", "matn o'chirilmaydi");
  assert.deepEqual(report.unsourcedNumbers, ["45%"], "faqat manbasiz va faktda yo'q foiz");
  assert.deepEqual(report.factNumbersFound.sort(), ["120", "78.5%"]);
});

test("factNumbers / numbersOf / missingFactNumbers: vergul→nuqta, foiz belgisi; hujjat bo'yicha yo'qolgan raqamlar", () => {
  assert.deepEqual(numbersOf("4,1 dan 4.6 ga, 12 % va 120"), ["4.1", "4.6", "12%", "120"]);
  assert.deepEqual(factNumbers("120 talaba, 4,1 → 4,6, 4,1 yana"), ["120", "4.1", "4.6"]);
  const sections = [{ id: "a", title: "A", blocks: [P("Ballar 4,1 dan 4,6 ga oshdi.")] }];
  assert.deepEqual(missingFactNumbers(sections, "120 talaba, 4,1 → 4,6"), ["120"]);
  assert.deepEqual(missingFactNumbers(sections, ""), []);
});

test("guardSection: wordRange — tashqarida bo'lsa wordRangeOk=false; so'z hisobi figure/tableRef/formula ni sanamaydi", () => {
  const many = P(Array.from({ length: 120 }, (_, i) => `so'z${i}`).join(" "));
  const inRange = guardSection([many, many], { refs: [], wordRange: [200, 300] });
  assert.equal(inRange.report.words, 240);
  assert.equal(inRange.report.wordRangeOk, true);
  const short = guardSection([many], { refs: [], wordRange: [200, 300] });
  assert.equal(short.report.wordRangeOk, false);
  const noRange = guardSection([many], { refs: [] });
  assert.equal(noRange.report.wordRangeOk, true, "oraliq berilmasa doim ok");
  assert.equal(wordsOf([P("bir ikki"), { kind: "figure", text: "uzun sarlavha matni", figureId: "f1" }, { kind: "formula", text: "a+b" }]), 2);
});

test("guardSection: «suv» iboralar hisoblanadi (o'chirilmaydi)", () => {
  const { report, blocks } = guardSection([P("Bugungi kunda AI muhim. Ma’lumki, u rivojlanmoqda.")], { refs: [] });
  assert.deepEqual(report.filler, ["bugungi kunda", "ma’lumki"]);
  assert.match(blocks[0].text, /Bugungi kunda/);
});

test("skeletonCoverage: required/hard bo'limlar, erkin `body-N` skeletdagi `body` ni qoplaydi, bo'sh bo'lim sanalmaydi", () => {
  const t = ARTICLE_TYPES.three_part_uz;
  const ok = skeletonCoverage(t, [
    { id: "intro", blocks: [P("x")] },
    { id: "body-1", blocks: [P("y")] },
    { id: "conclusion", blocks: [P("z")] },
  ]);
  assert.deepEqual(ok, { missing: [], hardMissing: [] });
  const bad = skeletonCoverage(t, [{ id: "intro", blocks: [P("x")] }, { id: "body-1", blocks: [] }]);
  assert.deepEqual(bad.hardMissing, ["body", "conclusion"]);
  // Ixtiyoriy bo'lim (`review_narrative.methods`) yo'qligi missing ga tushmaydi.
  const r = skeletonCoverage(ARTICLE_TYPES.review_narrative, ["intro", "body-1", "synthesis", "future", "conclusion"].map((id) => ({ id, blocks: [P("x")] })));
  assert.deepEqual(r.missing, []);
});

/* ────────────────────────── prompt taqiqlari ────────────────────────── */

function ctxOf(values: Record<string, string | number | boolean> = {}): ArticleContext {
  const meta = extractMeta(TOOL_BY_ID.article, { topic: "Sun'iy intellekt ta'limda", articleType: "imrad_oak", language: "uz", ...values });
  const input = articleInputFromValues({ topic: "Sun'iy intellekt ta'limda", articleType: "imrad_oak", language: "uz", ...values });
  const type = ARTICLE_TYPES[input.articleType];
  const profile = PUBLICATION_PROFILES[input.pubProfile];
  const plan = articleWordPlan({ ...meta, language: input.language }, type, profile);
  return { input, meta: { ...meta, language: input.language }, type, profile, labels: articleLabels(input.language), wordTarget: 1200, plan, refs: REFS };
}

test("tizim prompti: birinchi qator til ko'rsatmasi; uch taqiq qulflangan; foydalanuvchi fakti VERBATIM", () => {
  const sys = articleSystemPrompt(ctxOf({ userFacts: "120 talaba, 4,1 → 4,6" }));
  assert.match(sys.split("\n")[0], /^OUTPUT LANGUAGE: Uzbek/);
  assert.match(sys, /NEVER invent a source, DOI, author, journal or year/);
  assert.match(sys, /cite ONLY the sources listed under SOURCES/);
  assert.match(sys, /\[W2741809807\]/, "iqtibos shakli `[W…]` ko'rsatilgan");
  assert.match(sys, /every statistic, percentage, sample size \(n=\), p-value/);
  assert.match(sys, /USER FACTS[\s\S]*VERBATIM/);
  assert.match(sys, /120 talaba, 4,1 → 4,6/);
  assert.match(sys, /NO FILLER/);
  // AUDIT-18 Q-7: turga xos yozish qoidalari — imrad_oak da OAK ovozi, sharhda «NO own experiment».
  assert.match(sys, /TYPE RULES \(OAK journal \(IMRAD \+ Conclusion\)\):\n1\. Uzbek HAC \(OAK\) journal voice/);
  const review = articleSystemPrompt(ctxOf({ articleType: "review_narrative", pubProfile: "apa" }));
  assert.match(review, /TYPE RULES \(Narrative review\):\n1\. Narrative \(literature\) review: there is NO own experiment/);
  assert.ok(!review.includes("Uzbek HAC (OAK) journal voice"), "boshqa turning qoidasi kirmasin");
  for (const f of ["bugungi kunda", "в настоящее время", "in today's world"]) assert.match(sys, new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `taqiq ro'yxatida «${f}» bo'lishi kerak`);
  assert.ok(FILLER_PHRASES.length >= 12);
  // Rus tilida birinchi qator o'zgaradi.
  assert.match(articleSystemPrompt(ctxOf({ language: "ru" })).split("\n")[0], /Russian/);
});

test("tezis so'z mo'ljali — oraliqning yuqori yarmi (200–300 → 260), qisqa chiqsa qayta yozish «kamida N so'z qo'sh» deydi", () => {
  const ctx = ctxOf({ articleType: "conference_thesis", pubProfile: "conference", pages: "1-2" });
  const plan = { id: "body", skeletonId: "body", title: "Tezis", brief: "x", words: 250, hard: true };
  const whole = sectionPrompt(ctx, { plan, wantTable: false, wantFigure: false, wantChart: false });
  // Jonli: «about 250» so'ralganda 157/185/207 chiqdi — o'rtaga mo'ljal yetarli emas.
  assert.match(whole, /aim for about 260 words, never fewer than 200 and never more than 300/);
  assert.match(whole, /write MORE, up to the maximum/);
  assert.equal(wordRangeAim(200, 300), 260);
  const short = wordRangePrompt(ctx, plan, 185, [200, 300]);
  assert.match(short, /too short \(185 whitespace-separated words\)/);
  assert.match(short, /to about 260 words/);
  assert.match(short, /you were 15 words short, so add at least 23 words/);
  const long = wordRangePrompt(ctx, plan, 340, [200, 300]);
  assert.match(long, /too long .* to about 250 words — cut redundancy/);
});

test("bo'lim hajmi qatori: mo'ljal +10 %, paragraf oralig'i per…per×1.2, pastki chegara 80 % (prod: 0.85·per–per so'ralganda 80 % chiqdi)", () => {
  const line = lengthLine(300);
  assert.match(line, /about 330 words — write 3 paragraphs of roughly 100–120 words each/);
  assert.match(line, /fewer than 240 or more than 375 words is unacceptable/);
  assert.match(line, /when unsure, write more/);
  assert.match(lengthLine(60), /about 66 words — write 1 paragraph of roughly 60–72 words/);
});

test("bo'lim prompti: manbalar `[ID] Muallif (yil). Sarlavha. Venue.` ko'rinishida; manbasiz — iqtibos taqiqi; jadval/sxema faqat so'ralganda; chart faqat userData bilan", () => {
  const ctx = ctxOf();
  const plan = { id: "results", skeletonId: "results", title: "Natijalar", brief: "x", words: 300, hard: true };
  const withRefs = sectionPrompt(ctx, { plan, wantTable: false, wantFigure: false, wantChart: false });
  assert.match(withRefs, /\[W2741809807\] — \(n\.d\.\)\. A\./);
  assert.ok(!/"table"/.test(withRefs) && !/"figure"/.test(withRefs));
  /*
   * Manba ulushi: butun maqola ≥ profil minimumi (OAK 10) turli manba,
   * bo'limga so'z ulushi bo'yicha — 300/1200 × 10 = 3, lekin ro'yxatda 2 ta
   * bor → 2. Jonli smoke: 20 topilgan manbadan 8 tasi iqtibos qilingan edi.
   */
  assert.match(withRefs, /cite about 10 DIFFERENT sources \(not fewer than 10\), so this section should draw on about 2 different ones:/);
  const many = { ...ctx, refs: Array.from({ length: 12 }, (_, i) => ({ ...REFS[0], id: `W${i}` })) };
  assert.match(sectionPrompt(many, { plan, wantTable: false, wantFigure: false, wantChart: false }), /draw on about 3 different ones:/);
  // `round`, `ceil` emas — 250/1200 × 10 = 2.08 → 2 (ceil 3 bo'lardi; yig'indi oshib 12 manba chiqqan edi).
  assert.match(sectionPrompt(many, { plan: { ...plan, words: 250 }, wantTable: false, wantFigure: false, wantChart: false }), /draw on about 2 different ones:/);
  assert.match(sectionPrompt(many, { plan: { ...plan, id: "conclusion", skeletonId: "conclusion", words: 60 }, wantTable: false, wantFigure: false, wantChart: false }), /about 1 different ones \(a conclusion may cite fewer\)/);
  const noRefs = sectionPrompt({ ...ctx, refs: [] }, { plan, wantTable: true, wantFigure: true, wantChart: false });
  assert.match(noRefs, /SOURCES: none available — write WITHOUT any citations/);
  assert.match(noRefs, /"table":\{"caption"/);
  assert.match(noRefs, /"figure":\{"caption"/);
  assert.match(noRefs, /charts are NOT allowed/);
  const chart = sectionPrompt(ctxOf({ userData: '{"categories":["2022","2023"],"series":[{"name":"Talabalar","values":[80,120]}]}' }), { plan, wantTable: false, wantFigure: false, wantChart: true });
  assert.match(chart, /"kind":"chart"/);
  assert.match(chart, /categories: 2022, 2023/);
});

test("sxema prompti (AUDIT-18): 8 tur shakli + «use for» qoidasi; tur tavsiyasi (analytical → matrix/compare/flow); figureKinds → faqat tanlangan turlar + «Allowed kinds»", () => {
  const plan = { id: "results", skeletonId: "results", title: "Natijalar", brief: "x", words: 300, hard: true };
  const ask = { plan, wantTable: false, wantFigure: true, wantChart: false };
  const auto = sectionPrompt(ctxOf(), ask);
  for (const k of ["flow", "process", "tree", "layers", "cycle", "timeline", "matrix", "compare"]) assert.match(auto, new RegExp(`\\{"kind":"${k}"`), `«${k}» shakli promptda`);
  assert.match(auto, /"kind":"layers".*use for a system or platform ARCHITECTURE.*TOP .*BOTTOM/);
  assert.match(auto, /"kind":"cycle".*REPEATING process or life cycle/);
  assert.match(auto, /"kind":"timeline".*HISTORICAL stages.*chronological order/);
  assert.match(auto, /"kind":"matrix".*EXACTLY 4 quadrants in the order top-left, top-right, bottom-left, bottom-right/);
  assert.match(auto, /"kind":"compare".*"traditional vs proposed"/);
  assert.match(auto, /every label ≤ 40 characters/);
  assert.match(auto, /flow.*ACYCLIC/);
  // Tur tavsiyasi: imrad_oak → flow, layers; analytical → matrix, compare, flow; review → timeline, layers, tree; methodical → process, cycle.
  assert.match(auto, /most suitable kinds are usually: flow, layers/);
  assert.match(sectionPrompt(ctxOf({ articleType: "analytical" }), ask), /most suitable kinds are usually: matrix, compare, flow/);
  assert.match(sectionPrompt(ctxOf({ articleType: "review_narrative" }), ask), /usually: timeline, layers, tree/);
  assert.match(sectionPrompt(ctxOf({ articleType: "methodical" }), ask), /usually: process, cycle/);
  assert.match(sectionPrompt(ctxOf({ articleType: "case_study_care" }), ask), /usually: timeline/);
  assert.ok(!/Allowed kinds/.test(auto), "avtomatik rejimda cheklov qatori yo'q");
  // Foydalanuvchi tanlovi: faqat tanlangan turlar shakli + cheklov qatori; tavsiya yo'q.
  const chosen = sectionPrompt(ctxOf({ figureKinds: '["cycle","matrix"]' }), ask);
  assert.match(chosen, /Allowed kinds \(chosen by the author\): cycle, matrix — any other kind will be rejected/);
  assert.match(chosen, /"kind":"cycle"/);
  assert.match(chosen, /"kind":"matrix"/);
  for (const k of ["flow", "process", "tree", "layers", "timeline", "compare"]) assert.ok(!new RegExp(`\\{"kind":"${k}"`).test(chosen), `«${k}» shakli tanlovda yo'q`);
  assert.ok(!/most suitable kinds/.test(chosen));
  // Noma'lum/`prisma`/`chart` tanlov sifatida qabul qilinmaydi.
  assert.deepEqual(articleInputFromValues({ topic: "T", articleType: "imrad_oak", figureKinds: '["prisma","chart","zzz","tree","tree"]' }).figureKinds, ["tree"]);
  assert.deepEqual(articleInputFromValues({ topic: "T", articleType: "imrad_oak", figureKinds: "cycle, matrix" }).figureKinds, ["cycle", "matrix"], "CSV ham qabul");
});

test("annotatsiya prompti: o'z tili birinchi qatorda, MUSTAQIL (tarjima emas), so'z va kalit so'z chegarasi profildan; structured — 4 qism", () => {
  const ctx = ctxOf();
  const sysRu = abstractSystemPrompt(ctx, "ru");
  assert.match(sysRu.split("\n")[0], /Russian/);
  assert.match(sysRu, /INDEPENDENTLY/);
  // Standart paket 3–5 bet: mo'ljal pastki chegaraga yaqin (170); 10–15 betda o'rtaga (200).
  const p = abstractPrompt(ctx, "en", "• Kirish: …");
  // Pastki chegara promptda 10 % yuqori (165): model chegaraning o'zida 146–149 yozardi.
  assert.match(p, /about 170 words, never fewer than 165 and never more than 250/);
  assert.match(abstractPrompt(ctxOf({ pages: "10-15" }), "en", "…"), /about 200 words, never fewer than 165/);
  assert.match(p, /5–12 keywords/);
  assert.match(p, /\{"text":"…","keywords":\["…"\]\}/);
  const structured = abstractPrompt(ctxOf({ articleType: "review_systematic", pubProfile: "apa" }), "en", "…");
  assert.match(structured, /"background":"…","methods":"…","results":"…","conclusions":"…"/);
  assert.match(structured, /never fewer than 165 and never more than 250/);
  assert.match(structured, /4–6 keywords/);
});
