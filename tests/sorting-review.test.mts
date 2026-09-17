import test from "node:test";
import assert from "node:assert/strict";
import {
  ambiguousItems,
  contentTokens,
  nameCollisions,
  reviewSorting,
  scoreSortingReview,
  sortingJudgeUserPrompt,
  sortingRuleChecks,
  sortingRuleIds,
  neutralSortingJudge,
  SORTING_EXTRA_RULE_IDS,
} from "../lib/generation/games/sorting/review.ts";
import { planSortingPolish, applySortingOps, sortingUserNeeds } from "../lib/generation/games/sorting/polish.ts";
import { sortingSections } from "../lib/generation/games/sorting/engine.ts";
import { gameLayoutLabels } from "../lib/generation/games/layout.ts";
import { GAME_RULE_IDS, SORTING_JUDGE_CRITERIA } from "../lib/generation/games/registry.ts";
import { sampleGameDoc } from "../lib/generation/games/samples.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";
import type { SortingCategory } from "../lib/generation/games/types.ts";

/**
 * SARALASH HISOBOTI (AUDIT-22 WP-D).
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `itemSingleCategory` bandi o'chirildi — «ikki ma'noli element
 *      QIZIL» testi;
 *   2. `uniqueItems` faqat toifa ICHIDA tekshirdi — «toifalar orasidagi
 *      takror» testi;
 *   3. `answerKey` bo'lim yo'qligini sezmadi — «javob kaliti majburiy»
 *      testi;
 *   4. qoida id lari reyestrdan ajralib ketdi — «REYESTR qopqog'i»
 *      testi;
 *   5. sayqal `categoryCount` ni ham tuzatmoqchi bo'ldi — «miqdor
 *      bandi tuzatilmaydi» testi.
 */

const L = gameLayoutLabels("uz");

function docOf(categories: SortingCategory[], over: Partial<AcademicDoc> = {}): AcademicDoc {
  const base = sampleGameDoc("sorting");
  const model = { ...base.game!, sorting: { categories } };
  return { ...base, game: model, sections: sortingSections({ categories }, L), ...over };
}

const GOOD: SortingCategory[] = [
  { id: "s1", name: "Qushlar", items: ["Laylak", "Burgut", "Chumchuq"] },
  { id: "s2", name: "Baliqlar", items: ["Sazan", "Laqqa", "Zog‘ora"] },
];

const levelOf = (doc: AcademicDoc, id: string) => sortingRuleChecks(doc).find((c) => c.id === id)?.level;
const checkOf = (doc: AcademicDoc, id: string) => sortingRuleChecks(doc).find((c) => c.id === id);

/* ══════════════════════════ reyestr qopqog'i ══════════════════════════ */

test("qoida id lari REYESTRNI to'liq qoplaydi (`GAME_RULE_IDS.sorting` + qo'shimcha)", () => {
  const ids = sortingRuleChecks(docOf(GOOD)).map((c) => c.id);
  for (const id of GAME_RULE_IDS.sorting) assert.ok(ids.includes(id), `reyestr bandi yo‘q: ${id}`);
  assert.deepEqual(ids.slice(0, GAME_RULE_IDS.sorting.length), [...GAME_RULE_IDS.sorting], "reyestr tartibi buzildi");
  assert.deepEqual(ids.slice(GAME_RULE_IDS.sorting.length), [...SORTING_EXTRA_RULE_IDS]);
  assert.deepEqual(sortingRuleIds(), ids);
});

test("model yo'q hujjatda faqat `structure` bandi qaytadi (yiqilmaydi)", () => {
  const doc = { ...docOf(GOOD), game: undefined } as AcademicDoc;
  const checks = sortingRuleChecks(doc);
  assert.deepEqual(checks.map((c) => c.id), ["structure"]);
  assert.equal(checks[0].level, "red");
});

/* ══════════════════════════ bir ma'nolilik ══════════════════════════ */

test("ikki ma'noli element QIZIL: element boshqa toifaning nomiga mos", () => {
  /*
   * `sorting-game.md` §5 yomon misoli: «Hayvonlar» / «Uy hayvonlari»
   * ekranda birga turganda «Uy mushugi» ikkalasiga ham tegishli va
   * o'yin YECHILMAYDIGAN bo'lib qoladi.
   */
  const bad: SortingCategory[] = [
    { id: "s1", name: "Hayvonlar", items: ["Uy mushugi", "Burgut"] },
    { id: "s2", name: "Uy hayvonlari", items: ["Sigir", "Echki"] },
  ];
  const hits = ambiguousItems(bad);
  assert.ok(hits.length >= 1, "evristika ikki ma'noli elementni ko'rmadi");
  /*
   * TORROQ toifaning («Uy hayvonlari») HAR elementi kengrog'iga
   * («Hayvonlar») ham tegishli — shuning uchun ular belgilanadi.
   */
  assert.deepEqual(hits.map((h) => h.item).sort(), ["Echki", "Sigir"]);
  assert.ok(hits.every((h) => h.owner === "Uy hayvonlari" && h.other === "Hayvonlar"));

  // MATNDAGI to'qnashuv ham ushlanadi: element BOSHQA toifaning nomi bilan bir xil.
  const direct = ambiguousItems([
    { id: "s1", name: "Hasharotlar", items: ["Chumoli", "Qushlar"] },
    { id: "s2", name: "Qushlar", items: ["Laylak", "Burgut"] },
  ]);
  assert.deepEqual(direct.map((h) => h.item), ["Qushlar"]);
  const c = checkOf(docOf(bad), "itemSingleCategory")!;
  assert.equal(c.level, "red");
  assert.match(c.detail ?? "", /Sigir/);
  assert.ok(c.fix, "tuzatish ko'rsatmasi berilmadi");

  // Toza to'plamda band YASHIL va yolg'on ogohlantirish bermaydi.
  assert.equal(levelOf(docOf(GOOD), "itemSingleCategory"), "green");
});

test("toifa nomlari BIR XIL darajada: umumiy token sariq bo'ladi", () => {
  assert.deepEqual(contentTokens("Uy hayvonlari"), ["hayvonlari"]);
  const coll = nameCollisions([
    { id: "s1", name: "Yovvoyi hayvonlar", items: [] },
    { id: "s2", name: "Uy hayvonlar", items: [] },
  ]);
  assert.equal(coll.length, 1);
  assert.equal(coll[0].token, "hayvonlar");
  assert.equal(
    levelOf(
      docOf([
        { id: "s1", name: "Yovvoyi hayvonlar", items: ["Burgut", "Bo‘ri"] },
        { id: "s2", name: "Uy hayvonlar", items: ["Sigir", "Echki"] },
      ]),
      "categoryNameDistinct",
    ),
    "yellow",
  );
  assert.equal(levelOf(docOf(GOOD), "categoryNameDistinct"), "green");
});

/* ══════════════════════════ miqdor va noyoblik ══════════════════════════ */

test("`uniqueItems` toifalar ORASIDAGI takrorni ham ushlaydi", () => {
  const dup: SortingCategory[] = [
    { id: "s1", name: "Qushlar", items: ["Laylak", "Burgut", "Chumchuq"] },
    { id: "s2", name: "Baliqlar", items: ["Sazan", "laylak!", "Laqqa"] },
  ];
  const c = checkOf(docOf(dup), "uniqueItems")!;
  assert.equal(c.level, "red", "boshqa toifadagi takror sezilmadi");
  assert.match(c.detail ?? "", /laylak!/);
  assert.equal(levelOf(docOf(GOOD), "uniqueItems"), "green");
});

test("`itemsPerCategory` tenglikni o'lchaydi; kam to'lgan toifa QIZIL", () => {
  assert.equal(levelOf(docOf(GOOD), "itemsPerCategory"), "green");
  const uneven: SortingCategory[] = [
    { id: "s1", name: "Qushlar", items: ["Laylak", "Burgut", "Chumchuq", "Tovus"] },
    { id: "s2", name: "Baliqlar", items: ["Sazan", "Laqqa", "Zog‘ora"] },
  ];
  assert.equal(levelOf(docOf(uneven), "itemsPerCategory"), "yellow", "notekis taqsimot sezilmadi");
  const thin: SortingCategory[] = [
    { id: "s1", name: "Qushlar", items: ["Laylak", "Burgut", "Chumchuq"] },
    { id: "s2", name: "Baliqlar", items: ["Sazan"] },
  ];
  assert.equal(levelOf(docOf(thin), "itemsPerCategory"), "red");
  // Toifa soni chegaradan chiqsa — alohida band.
  assert.equal(levelOf(docOf([GOOD[0]]), "categoryCount"), "red");
});

test("uzunlik bandlari: toifa nomi va element chegaradan chiqmasin", () => {
  const long: SortingCategory[] = [
    { id: "s1", name: "Q".repeat(60), items: ["Laylak", "Burgut", "Chumchuq"] },
    { id: "s2", name: "Baliqlar", items: ["Sazan", "E".repeat(80), "Laqqa"] },
  ];
  assert.equal(levelOf(docOf(long), "categoryNameLength"), "yellow");
  assert.equal(levelOf(docOf(long), "itemLength"), "yellow");
  assert.equal(levelOf(docOf(GOOD), "categoryNameLength"), "green");
  assert.equal(levelOf(docOf(GOOD), "itemLength"), "green");
});

test("`answerKey`: javob kaliti bo'limi MAJBURIY va hamma toifani qamrasin", () => {
  assert.equal(levelOf(docOf(GOOD), "answerKey"), "green");
  const noKey = docOf(GOOD, { sections: sortingSections({ categories: GOOD }, L).slice(0, 2) });
  assert.equal(levelOf(noKey, "answerKey"), "red", "javob varag‘isiz hujjat yashil qoldi");
  const partial = docOf(GOOD, {
    sections: [
      ...sortingSections({ categories: GOOD }, L).slice(0, 2),
      { id: "answers", title: "Javoblar", blocks: [{ kind: "li", text: "Qushlar: Laylak" }] },
    ],
  });
  assert.equal(levelOf(partial, "answerKey"), "yellow");
});

/* ══════════════════════════ baholovchi va ball ══════════════════════════ */

test("baholovchi prompti TOIFA→ELEMENT shaklida (bosma aralash ro'yxat emas)", () => {
  const p = sortingJudgeUserPrompt(docOf(GOOD));
  assert.match(p, /TOOL: sorting/);
  assert.match(p, /ALL CATEGORIES SHOWN TOGETHER/);
  assert.match(p, /Qushlar: Laylak, Burgut, Chumchuq/, "baholovchi qaysi element qaysi toifaniki ekanini ko'rmaydi");
});

test("ball: qizil band ballni tushiradi, baholovchi mezonlari qo'shiladi", async () => {
  const good = await reviewSorting(docOf(GOOD), { judge: false });
  const bad = await reviewSorting(
    docOf([
      { id: "s1", name: "Hayvonlar", items: ["Uy mushugi", "Burgut", "Laylak"] },
      { id: "s2", name: "Uy hayvonlari", items: ["Sigir", "Echki", "sigir"] },
    ]),
    { judge: false },
  );
  assert.ok(good.score > bad.score, `yomon to'plam ball yo'qotmadi: ${good.score} vs ${bad.score}`);
  assert.ok(good.score > 0, `toza to'plam nol ball oldi: ${good.score}`);

  // Baholovchi o'chirilganda NEYTRAL ball ishlatiladi (`report/judge`).
  const doc = docOf(GOOD);
  const neutral = scoreSortingReview(sortingRuleChecks(doc), doc.game!, neutralSortingJudge(doc.game!));
  assert.ok(Number.isFinite(neutral) && neutral > 0, `neytral ball hisoblanmadi: ${neutral}`);
  // Baholovchi mezonlari REYESTRDAN — hisobot bandlari shu id lar bilan chiqadi.
  const withJudge = await reviewSorting(doc, {
    judge: true,
    complete: (async () => ({ text: JSON.stringify(Object.fromEntries([...SORTING_JUDGE_CRITERIA.map((c) => [c, 3]), ["notes", []], ["fixes", []]])) })) as never,
  });
  for (const c of SORTING_JUDGE_CRITERIA) assert.ok(withJudge.checks.some((x) => x.id === `judge:${c}`), `baholovchi bandi yo‘q: ${c}`);
});

/* ══════════════════════════ sayqal rejasi ══════════════════════════ */

test("sayqal MIQDOR va TUZILMA bandlarini tuzatmaydi, ikki ma'nolilikni tuzatadi", async () => {
  const doc = docOf([
    { id: "s1", name: "Hayvonlar", items: ["Uy mushugi", "Burgut"] },
    { id: "s2", name: "Uy hayvonlari", items: ["Sigir", "Echki"] },
  ]);
  const review = await reviewSorting(doc, { judge: false });
  const plan = planSortingPolish(review, doc);
  assert.equal(plan.fixes.length, 1, "nishon bitta bo'lishi kerak (o'yin bo'linmaydi)");
  assert.equal(plan.fixes[0].target, "sorting");
  assert.match(plan.fixes[0].instruction, /second category/i, "ikki ma'nolilik ko'rsatmasi yo'q");
  // `categoryCount` — MIQDOR bandi: uni «tuzatish» yangi toifa o'ylab topish bo'lardi.
  const single = docOf([GOOD[0]]);
  const r2 = await reviewSorting(single, { judge: false });
  const p2 = planSortingPolish(r2, single);
  assert.ok(p2.skipped.some((s) => s.id === "categoryCount" && s.reason === "user"));
  assert.ok(!p2.fixes.some((f) => f.instruction.includes("categoryCount")));
});

test("`applySortingOps` model bilan nasrni BIRGA almashtiradi, element sonini qo'riqlaydi", () => {
  const doc = docOf(GOOD);
  const next: SortingCategory[] = [
    { id: "s1", name: "Qushlar", items: ["Tovus", "Burgut", "Chumchuq"] },
    { id: "s2", name: "Baliqlar", items: ["Sazan", "Laqqa", "Zog‘ora"] },
  ];
  const ok = applySortingOps(doc, [{ op: "setCategories", categories: next }]);
  assert.ok(ok.ok && ok.doc);
  assert.equal(ok.doc!.game!.sorting!.categories[0].items[0], "Tovus");
  assert.ok(ok.doc!.sections[1].blocks.some((b) => b.text === "Tovus"), "nasr eski ro'yxatda qoldi");
  assert.ok(!ok.doc!.sections[1].blocks.some((b) => b.text === "Laylak"));

  // Element O'CHIRILMASIN — foydalanuvchi shunga to'lagan.
  const fewer = applySortingOps(doc, [{ op: "setCategories", categories: [next[0], { ...next[1], items: ["Sazan"] }] }]);
  assert.ok(!fewer.ok, "kam elementli javob qabul qilindi");
  const other = applySortingOps(doc, [{ op: "setCards" } as never]);
  assert.ok(!other.ok);
});

test("«Sizdan kutiladi»: ikki ma'nolilik qizil qolsa — odamga yo'naltiriladi", async () => {
  const doc = docOf([
    { id: "s1", name: "Hayvonlar", items: ["Uy mushugi", "Burgut"] },
    { id: "s2", name: "Uy hayvonlari", items: ["Sigir", "Echki"] },
  ]);
  const review = await reviewSorting(doc, { judge: false });
  const needs = sortingUserNeeds(review, doc);
  assert.ok(needs.some((n) => n.id === "itemSingleCategory"), "«Sizdan kutiladi» bandi yo'q");
  assert.deepEqual(sortingUserNeeds(await reviewSorting(docOf(GOOD), { judge: false }), docOf(GOOD)), []);
});
