import test from "node:test";
import assert from "node:assert/strict";
import {
  CARDS_TARGET,
  cardsJudgeUserPrompt,
  cardsRuleChecks,
  flashcardsRuleIds,
  neutralCardsJudge,
  reviewFlashcards,
  scoreCardsReview,
} from "../lib/generation/games/flashcards/review.ts";
import {
  applyCardsOps,
  cardsCriterionFixes,
  flashcardsContextOf,
  flashcardsUserNeeds,
  planFlashcardsPolish,
  rewriteFlashcardsFix,
  runFlashcardsPolish,
} from "../lib/generation/games/flashcards/polish.ts";
import { cardSections } from "../lib/generation/games/flashcards/engine.ts";
import { gameLayoutLabels } from "../lib/generation/games/layout.ts";
import { sampleGameDoc } from "../lib/generation/games/samples.ts";
import { CARDS_JUDGE_CRITERIA, GAME_RULE_IDS } from "../lib/generation/games/registry.ts";
import { GAME_LIMITS, type Flashcard } from "../lib/generation/games/types.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";
import type { DocReview } from "../lib/generation/report/types.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";

/**
 * FLESH KARTALAR HISOBOTI VA SAYQALI (AUDIT-21 WP-B).
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `cardCount` bandi chip bo'lmagan sonni yashil qildi — «kamomad
 *      sariq» testi;
 *   2. `frontLength` chegarasi reyestrdan emas, qattiq sondan olindi —
 *      «chegara reyestrdan» testi;
 *   3. `examplePresence` «so'ralmagan» bilan «berilmagan» ni ajratmadi
 *      — «misol so'ralmagan bo'lsa yashil» testi;
 *   4. `cardTypeMatch` savol turida savol belgisini tekshirmadi —
 *      «tur mosligi» testi;
 *   5. sayqal kartani NASR sifatida qayta yozdi (soni o'zgardi) —
 *      «sayqal karta sonini saqlaydi» testi;
 *   6. `applyCardsOps` nasrni yangilamadi — «model va nasr birga»
 *      testi.
 */

/* ────────────────────────── yordamchilar ────────────────────────── */

const L = gameLayoutLabels("uz");

const card = (i: number, over: Partial<Flashcard> = {}): Flashcard => ({
  id: `c${i}`,
  front: `Atama ${i}`,
  back: `Bu ${i}-atamaning ta'rifi: u nima ekani va nimasi bilan ajralib turishi bir jumlada aytilgan.`,
  ...over,
});

/** `cards` — modelga qo'yiladigan ro'yxat; nasr ham SHU ro'yxatdan quriladi. */
function docOf(cards: Flashcard[], o: { type?: "term-def" | "qa"; includeExample?: boolean } = {}): AcademicDoc {
  const base = sampleGameDoc("flashcards");
  const model = { ...base.game!, type: o.type ?? "term-def", cards: { type: o.type ?? "term-def", cards, includeExample: o.includeExample ?? false } };
  return { ...base, game: model, sections: cardSections(model.cards, L) };
}

const ten = () => Array.from({ length: 10 }, (_, i) => card(i + 1));

const checkOf = (checks: { id: string }[], id: string) => checks.find((c) => c.id === id)!;

const USAGE = { provider: "gemini", model: "gemini-2.5-flash", inputTokens: 300, outputTokens: 400 };

/* ══════════════════════════ qoidalar ══════════════════════════ */

test("qoida id lari REYESTR bilan aynan mos (`GAME_RULE_IDS.flashcards`)", () => {
  const ids = cardsRuleChecks(docOf(ten())).map((c) => c.id);
  assert.deepEqual(ids, [...GAME_RULE_IDS.flashcards]);
  assert.deepEqual(flashcardsRuleIds(), GAME_RULE_IDS.flashcards);
});

test("`cardCount`: chip qiymati YASHIL, chip bo'lmagan son — KAMOMAD (sariq)", () => {
  assert.equal(checkOf(cardsRuleChecks(docOf(ten())), "cardCount").level, "green");
  const short = cardsRuleChecks(docOf(ten().slice(0, 8)));
  assert.equal(checkOf(short, "cardCount").level, "yellow", "8 ta karta — 10 tadan kam, kamomad ko'rinishi kerak");
  assert.match(checkOf(short, "cardCount").detail!, /10 ta bo‘lishi mumkin/);
  // Eng kichik chipdan ham kam — qizil.
  assert.equal(checkOf(cardsRuleChecks(docOf(ten().slice(0, 3))), "cardCount").level, "red");
});

test("`frontLength`/`backLength` chegaralari REYESTRDAN va nuqsonli kartani NOMI bilan ko'rsatadi", () => {
  const [frontMin, frontMax] = [GAME_LIMITS.cardFrontCharsMin, GAME_LIMITS.cardFrontCharsMax];
  const cards = ten();
  cards[0] = card(1, { front: "ab" });
  cards[1] = card(2, { front: "x".repeat(frontMax + 5) });
  cards[2] = card(3, { back: "qisqa" });
  const checks = cardsRuleChecks(docOf(cards));
  const front = checkOf(checks, "frontLength");
  assert.notEqual(front.level, "green");
  assert.match(front.detail!, new RegExp(`${frontMin}–${frontMax} belgidan tashqarida`));
  assert.match(front.detail!, /ab/, "nuqsonli kartaning old yuzi ko'rsatilmadi");
  assert.ok(front.fix, "«Tuzatish» ko'rsatmasi yo'q");
  assert.equal(front.fix!.target, CARDS_TARGET);

  const back = checkOf(checks, "backLength");
  assert.notEqual(back.level, "green");
  assert.match(back.detail!, new RegExp(`${GAME_LIMITS.cardBackCharsMin}–${GAME_LIMITS.cardBackCharsMax}`));
  // Hammasi joyida bo'lsa — yashil.
  assert.equal(checkOf(cardsRuleChecks(docOf(ten())), "frontLength").level, "green");
});

test("`noDuplicate`: bir xil old yuz QIZIL (takrorlangan karta ikkinchi marta hech narsa o'rgatmaydi)", () => {
  const cards = ten();
  cards[3] = card(4, { front: "Atama 1" });
  const dup = checkOf(cardsRuleChecks(docOf(cards)), "noDuplicate");
  assert.equal(dup.level, "red");
  assert.match(dup.detail!, /1 ta takror/);
  assert.equal(checkOf(cardsRuleChecks(docOf(ten())), "noDuplicate").level, "green");
});

test("`examplePresence`: «so'ralmagan» bilan «berilmagan» AJRATILADI", () => {
  // Misol so'ralmagan — yo'qligi nuqson emas.
  const off = checkOf(cardsRuleChecks(docOf(ten(), { includeExample: false })), "examplePresence");
  assert.equal(off.level, "green");
  assert.match(off.detail!, /so‘ralmagan/);

  // So'ralgan, lekin model bermagan — qizil.
  const none = checkOf(cardsRuleChecks(docOf(ten(), { includeExample: true })), "examplePresence");
  assert.equal(none.level, "red");
  assert.ok(none.fix, "«Tuzatish» ko'rsatmasi yo'q");

  // Yetarli ulush (≥ 50 %) — yashil.
  const some = ten().map((c, i) => (i < 6 ? { ...c, example: `${c.front} shunday ishlatiladi.` } : c));
  assert.equal(checkOf(cardsRuleChecks(docOf(some, { includeExample: true })), "examplePresence").level, "green");
  // Yarmidan kam — sariq.
  const few = ten().map((c, i) => (i < 2 ? { ...c, example: "misol" } : c));
  assert.equal(checkOf(cardsRuleChecks(docOf(few, { includeExample: true })), "examplePresence").level, "yellow");
});

test("`cardTypeMatch`: savol turida old yuz «?» bilan tugaydi, atama turida — YO'Q", () => {
  const qa = ten().map((c, i) => ({ ...c, front: i < 9 ? `${c.front} nima?` : c.front }));
  const one = checkOf(cardsRuleChecks(docOf(qa, { type: "qa" })), "cardTypeMatch");
  assert.equal(one.level, "yellow", "bitta savol bo'lmagan old yuz");
  assert.match(one.detail!, /savol belgisi bilan tugashi/);

  const allQa = ten().map((c) => ({ ...c, front: `${c.front} nima?` }));
  assert.equal(checkOf(cardsRuleChecks(docOf(allQa, { type: "qa" })), "cardTypeMatch").level, "green");
  // Atama turida savol — teskari nuqson.
  assert.equal(checkOf(cardsRuleChecks(docOf(allQa, { type: "term-def" })), "cardTypeMatch").level, "red");
  assert.equal(checkOf(cardsRuleChecks(docOf(ten(), { type: "term-def" })), "cardTypeMatch").level, "green");
});

test("modelsiz hujjat — bitta QIZIL «Tuzilma» bandi (yiqilmaydi)", () => {
  const base = sampleGameDoc("flashcards");
  const checks = cardsRuleChecks({ ...base, game: undefined });
  assert.equal(checks.length, 1);
  assert.equal(checks[0].id, "structure");
  assert.equal(checks[0].level, "red");
});

/* ══════════════════════════ baholovchi va ball ══════════════════════════ */

test("baholovchi CHAQIRILMASA ballar neytral, chaqirilganda 5 mezon bandga aylanadi", async () => {
  const doc = docOf(ten());
  const off = await reviewFlashcards(doc, { judge: false });
  assert.ok(off.score > 0, "ball qo'yilmadi");
  assert.equal(off.checks.filter((c) => c.id.startsWith("judge:")).length, CARDS_JUDGE_CRITERIA.length);

  const calls: string[] = [];
  const complete = async (role: LlmRole, _s: string, user: string) => {
    calls.push(role);
    if (role !== "judge") return null;
    assert.match(user, /FRONT: .+ \| BACK: /, "baholovchi KARTA JUFTLIKLARINI ko'rishi kerak");
    // Neytral baho 2/3 — shuning uchun sinov ANIQ pastroq ballar beradi.
    return { text: JSON.stringify({ termClarity: 1, definitionCompleteness: 1, languageLevel: 1, exampleRelevance: 0, memorability: 1, notes: ["qisqa"], fixes: [] }), usage: USAGE };
  };
  const on = await reviewFlashcards(doc, { complete: complete as never, deadline: Date.now() + 60_000, judge: true });
  assert.ok(calls.includes("judge"));
  assert.ok(on.score < off.score, "past ballar umumiy ballni tushirishi kerak");
  assert.equal(checkOf(on.checks, "judge:termClarity").detail, "1/3");
});

test("baholovchi prompti: karta juftliklari, tur, sinf va til", () => {
  const p = cardsJudgeUserPrompt(docOf(ten()));
  assert.match(p, /TOOL: flashcards · TYPE: term-def/);
  assert.match(p, /GRADE: 7/);
  assert.match(p, /1\. FRONT: Atama 1 \| BACK: /);
});

test("ball: qoidalar 60 % + baholovchi 40 %", () => {
  const model = docOf(ten()).game!;
  const rules = cardsRuleChecks(docOf(ten()));
  const perfect = neutralCardsJudge(model);
  for (const c of CARDS_JUDGE_CRITERIA) (perfect as Record<string, unknown>)[c] = 3;
  assert.equal(scoreCardsReview(rules, model, perfect), 100, "hammasi yashil + 3/3 → 100");
  const zero = neutralCardsJudge(model);
  for (const c of CARDS_JUDGE_CRITERIA) (zero as Record<string, unknown>)[c] = 0;
  assert.equal(scoreCardsReview(rules, model, zero), 60, "qoidalar ulushi 60 %");
});

/* ══════════════════════════ sayqal ══════════════════════════ */

const reviewWith = (checks: DocReview["checks"], score = 50): DocReview => ({
  score,
  checks,
  judgeNotes: [],
  verifiedShare: 0,
  recentShare: 0,
  builtAt: new Date().toISOString(),
});

test("sayqal rejasi: nishon BITTA (`cards`), ko'rsatmalar birlashadi, `cardCount` TUZATILMAYDI", async () => {
  const doc = docOf(ten(), { includeExample: true });
  const base = await reviewFlashcards(doc, { judge: false });
  const plan = planFlashcardsPolish(base, doc);
  assert.equal(plan.fixes.length, 1, "bitta nishon — bitta fix");
  assert.equal(plan.fixes[0].target, CARDS_TARGET);
  assert.match(plan.fixes[0].instruction, /example/, "misol bandi ko'rsatmaga tushmadi");

  // MIQDOR bandi — foydalanuvchi ma'lumoti, avtomatik tuzatilmaydi.
  const short = docOf(ten().slice(0, 8));
  const shortReview = await reviewFlashcards(short, { judge: false });
  const p2 = planFlashcardsPolish(shortReview, short);
  assert.ok(p2.skipped.some((s) => s.id === "cardCount" && s.reason === "user"), "kamomad «Sizdan kutiladi» ga o'tishi kerak");
});

test("past mezon → HALOL ko'rsatma (baholovchi `fixes` bermasa ham sayqal bo'sh qolmaydi)", () => {
  const doc = docOf(ten(), { includeExample: true });
  const fixes = cardsCriterionFixes(reviewWith([{ id: "judge:memorability", level: "red", label: "Eslab qolinishi", detail: "1/3" }]), doc);
  assert.equal(fixes.length, 1);
  assert.equal(fixes[0].target, CARDS_TARGET);
  assert.match(fixes[0].instruction, /Shorten the backs/);
  // Yashil mezon ko'rsatma bermaydi.
  assert.equal(cardsCriterionFixes(reviewWith([{ id: "judge:memorability", level: "green", label: "x", detail: "3/3" }]), doc).length, 0);
});

test("«Sizdan kutiladi»: kamomad va darslik ma'lumoti", async () => {
  const short = docOf(ten().slice(0, 8));
  const review = await reviewFlashcards(short, { judge: false });
  const needs = flashcardsUserNeeds(review, short);
  assert.ok(needs.some((n) => n.id === "cardCount"), "kamomad bandi yo'q");
  const withExtra = { ...short, meta: { ...short.meta, extra: "Darslik 45-sahifadagi atamalardan oling" } };
  assert.ok(flashcardsUserNeeds(review, withExtra).some((n) => n.id === "textbook"), "darslik bandi yo'q");
});

test("sayqal kartani MODEL shaklida qayta yozadi va SONINI saqlaydi", async () => {
  const doc = docOf(ten());
  const complete = async (_r: LlmRole, _s: string, user: string) => {
    assert.match(user, /EXACTLY 10 cards/, "sayqal model shaklini so'ramadi");
    const cards = ten().map((c) => ({ front: c.front, back: `${c.back} Qayta yozilgan.` }));
    return { text: JSON.stringify({ cards }), usage: USAGE };
  };
  const out = await rewriteFlashcardsFix(doc, { op: "rewrite", target: CARDS_TARGET, instruction: "Qisqartiring" }, { complete: complete as never, deadline: Date.now() + 60_000 });
  assert.equal(out.ops.length, 1);
  assert.equal(out.ops[0].cards.length, 10, "karta soni o'zgardi");
  assert.deepEqual(out.ops[0].cards.map((c) => c.id), ten().map((c) => c.id), "barqaror id lar saqlanmadi (tahrir yo'llari siljirdi)");

  // Model kam karta qaytarsa — RAD etiladi (to'lagan karta yo'qolmasin).
  const fewer = async () => ({ text: JSON.stringify({ cards: ten().slice(0, 7).map((c) => ({ front: c.front, back: c.back })) }), usage: USAGE });
  await assert.rejects(
    () => rewriteFlashcardsFix(doc, { op: "rewrite", target: CARDS_TARGET, instruction: "x" }, { complete: fewer as never, deadline: Date.now() + 60_000 }),
    /javob bermadi/,
  );
});

test("`applyCardsOps`: model VA nasr BIRGA almashadi (ikkalasi ajralib ketmasin)", () => {
  const doc = docOf(ten());
  const next = ten().map((c) => ({ ...c, back: `${c.back} Yangi.` }));
  const res = applyCardsOps(doc, [{ op: "setCards", cards: next }]);
  assert.ok(res.ok);
  const out = res.ok ? res.doc : doc;
  assert.equal(out.game!.cards!.cards[0].back, next[0].back, "model yangilanmadi");
  assert.ok(out.sections[0].blocks.some((b) => b.text === next[0].back), "nasr eski matn bilan qoldi");
  // Soni mos kelmasa — rad.
  assert.equal(applyCardsOps(doc, [{ op: "setCards", cards: next.slice(0, 5) }]).ok, false);
});

test("`runFlashcardsPolish`: ball oshsa QABUL, oshmasa eski hujjat qoladi (Q-3)", async () => {
  // Misol so'ralgan, lekin yo'q — hisobot qizil, sayqal uni to'ldiradi.
  const doc = docOf(ten(), { includeExample: true });
  const before = await reviewFlashcards(doc, { judge: false });
  const good = async (role: LlmRole, _s: string, _u: string) =>
    role === "judge"
      ? { text: JSON.stringify({ termClarity: 3, definitionCompleteness: 3, languageLevel: 3, exampleRelevance: 3, memorability: 3, notes: [], fixes: [] }), usage: USAGE }
      : { text: JSON.stringify({ cards: ten().map((c) => ({ front: c.front, back: c.back, example: `${c.front} jumlada shunday ishlatiladi.` })) }), usage: USAGE };
  const res = await runFlashcardsPolish(doc, before, { complete: good as never, deadline: Date.now() + 120_000, judge: false });
  assert.ok(res.accepted, `sayqal qabul qilinmadi: ${res.log.before} → ${res.log.after}`);
  assert.ok(res.review.score > before.score);
  assert.ok(res.doc.game!.cards!.cards.every((c) => c.example), "misol qatori qo'shilmadi");

  // Model hech narsani yaxshilamasa — ESKI hujjat qoladi.
  const same = async (role: LlmRole) =>
    role === "judge" ? { text: JSON.stringify({ termClarity: 2, definitionCompleteness: 2, languageLevel: 2, exampleRelevance: 2, memorability: 2, notes: [], fixes: [] }), usage: USAGE } : { text: JSON.stringify({ cards: ten().map((c) => ({ front: c.front, back: c.back })) }), usage: USAGE };
  const noop = await runFlashcardsPolish(doc, before, { complete: same as never, deadline: Date.now() + 120_000, judge: false });
  assert.equal(noop.accepted, false);
  assert.equal(noop.doc, doc, "rad etilganda hujjat O'ZGARMASLIGI kerak");
});

test("`flashcardsContextOf` kontekstni HUJJATDAN quradi (forma qiymatlari yo'q)", () => {
  const doc = docOf(ten(), { type: "qa", includeExample: true });
  const ctx = flashcardsContextOf(doc);
  assert.equal(ctx.spec.cardType, "qa");
  assert.equal(ctx.input.cardCount, 10);
  assert.equal(ctx.input.includeExample, true);
  assert.equal(ctx.input.grade, 7, "sinf `doc.meta` dan olinmadi");
  assert.equal(ctx.input.topic, doc.game!.topic);
});
