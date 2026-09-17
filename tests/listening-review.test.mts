import test from "node:test";
import assert from "node:assert/strict";
import {
  listeningJudgeUserPrompt,
  listeningRuleChecks,
  listeningRuleIds,
  neutralListeningJudge,
  oddDistractors,
  reviewListening,
  scoreListeningReview,
  LISTENING_EXTRA_RULE_IDS,
} from "../lib/generation/games/listening/review.ts";
import { applyListeningOps, listeningUserNeeds, planListeningPolish, rewriteListeningFix } from "../lib/generation/games/listening/polish.ts";
import { listeningSections } from "../lib/generation/games/listening/engine.ts";
import { gameLayoutLabels } from "../lib/generation/games/layout.ts";
import { GAME_RULE_IDS, LISTENING_JUDGE_CRITERIA } from "../lib/generation/games/registry.ts";
import { sampleGameDoc } from "../lib/generation/games/samples.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";
import type { ListeningItem } from "../lib/generation/games/types.ts";

/**
 * TINGLASH HISOBOTI (AUDIT-22 WP-D).
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `answerInRange` chegaradan chiqqan indeksni o'tkazib yubordi —
 *      «javob indeksi» testi (o'yin HAR javobni xato deb sanardi);
 *   2. `uniqueOptions` takror variantni ko'rmadi — «ikki to'g'ri javob»
 *      testi;
 *   3. qoida id lari reyestrdan ajralib ketdi — «REYESTR qopqog'i»;
 *   4. sayqal matn o'zgarganda eski audioni saqlab qoldi — «audio
 *      tashlanadi» testi;
 *   5. «Sizdan kutiladi» audio yo'qligini aytmadi — «audio bandi» testi.
 */

const L = gameLayoutLabels("uz");

function docOf(items: ListeningItem[], over: Partial<AcademicDoc> = {}): AcademicDoc {
  const base = sampleGameDoc("listening");
  const listening = { items, nativeLanguage: "uz", targetLanguage: "en" };
  return { ...base, game: { ...base.game!, listening }, sections: listeningSections(listening, L, "English"), ...over };
}

const GOOD: ListeningItem[] = [
  { id: "l1", text: "library", options: ["kutubxona", "muzey", "dorixona", "bekat"], answer: 0 },
  { id: "l2", text: "hospital", options: ["maktab", "kasalxona", "bozor", "zavod"], answer: 1 },
];

const levelOf = (doc: AcademicDoc, id: string) => listeningRuleChecks(doc).find((c) => c.id === id)?.level;
const checkOf = (doc: AcademicDoc, id: string) => listeningRuleChecks(doc).find((c) => c.id === id);

/* ══════════════════════════ reyestr qopqog'i ══════════════════════════ */

test("qoida id lari REYESTRNI to'liq qoplaydi (`GAME_RULE_IDS.listening` + qo'shimcha)", () => {
  const ids = listeningRuleChecks(docOf(GOOD)).map((c) => c.id);
  for (const id of GAME_RULE_IDS.listening) assert.ok(ids.includes(id), `reyestr bandi yo‘q: ${id}`);
  assert.deepEqual(ids.slice(0, GAME_RULE_IDS.listening.length), [...GAME_RULE_IDS.listening], "reyestr tartibi buzildi");
  assert.deepEqual(ids.slice(GAME_RULE_IDS.listening.length), [...LISTENING_EXTRA_RULE_IDS]);
  assert.deepEqual(listeningRuleIds(), ids);
});

test("model yo'q hujjatda faqat `structure` bandi qaytadi (yiqilmaydi)", () => {
  const doc = { ...docOf(GOOD), game: undefined } as AcademicDoc;
  assert.deepEqual(listeningRuleChecks(doc).map((c) => c.id), ["structure"]);
});

/* ══════════════════════════ javob va variantlar ══════════════════════════ */

test("`answerInRange`: chegaradan chiqqan indeks QIZIL (o'yin har javobni xato sanardi)", () => {
  assert.equal(levelOf(docOf(GOOD), "answerInRange"), "green");
  const bad = docOf([{ ...GOOD[0], answer: 7 }, GOOD[1]]);
  const c = checkOf(bad, "answerInRange")!;
  assert.equal(c.level, "red");
  assert.match(c.detail ?? "", /library/);
  assert.equal(levelOf(docOf([{ ...GOOD[0], answer: -1 }, GOOD[1]]), "answerInRange"), "red");
  assert.equal(levelOf(docOf([{ ...GOOD[0], answer: 1.5 }, GOOD[1]]), "answerInRange"), "red");
});

test("`uniqueOptions`: takror variant — ikki to'g'ri javob yoki behuda tugma", () => {
  assert.equal(levelOf(docOf(GOOD), "uniqueOptions"), "green");
  const dup = docOf([{ ...GOOD[0], options: ["kutubxona", "Kutubxona!", "dorixona", "bekat"] }, GOOD[1]]);
  assert.equal(levelOf(dup, "uniqueOptions"), "red", "takror variant (boshqacha yozilgan) sezilmadi");
});

test("`optionCount`: 3–4 variantdan tashqarisi QIZIL", () => {
  assert.equal(levelOf(docOf(GOOD), "optionCount"), "green");
  assert.equal(levelOf(docOf([{ ...GOOD[0], options: ["kutubxona", "muzey"] }, GOOD[1]]), "optionCount"), "red");
  assert.equal(levelOf(docOf([{ ...GOOD[0], options: ["a", "b", "c", "d", "e"] }, GOOD[1]]), "optionCount"), "red");
});

test("`uniqueItems`: bir xil so'z ikki marta savolni behuda sarflaydi", () => {
  assert.equal(levelOf(docOf(GOOD), "uniqueItems"), "green");
  const dup = docOf([GOOD[0], { ...GOOD[1], id: "l3", text: "LIBRARY!" }]);
  const c = checkOf(dup, "uniqueItems")!;
  assert.equal(c.level, "red");
  assert.match(c.detail ?? "", /LIBRARY!/);
});

/* ══════════════════════════ matn, tillar, distraktorlar ══════════════════════════ */

test("`textLength` va `languagePair`: chegaralar va ikki tilning farqi", () => {
  assert.equal(levelOf(docOf(GOOD), "textLength"), "green");
  // Ikki topshiriqdan bittasi buzuq — bu chorakdan ko'p, ya'ni QIZIL
  // (uzun to'plamda bitta chetga chiqqan matn sariq bo'ladi).
  assert.equal(levelOf(docOf([{ ...GOOD[0], text: "a" }, GOOD[1]]), "textLength"), "red");
  assert.equal(levelOf(docOf([{ ...GOOD[0], text: "x".repeat(120) }, GOOD[1]]), "textLength"), "red");
  const many = Array.from({ length: 10 }, (_, i) => ({ ...GOOD[1], id: `m${i}`, text: `word${i}` }));
  assert.equal(levelOf(docOf([{ ...GOOD[0], text: "x".repeat(120) }, ...many]), "textLength"), "yellow");

  assert.equal(levelOf(docOf(GOOD), "languagePair"), "green");
  const same = docOf(GOOD);
  same.game!.listening!.targetLanguage = "uz";
  assert.equal(levelOf(same, "languagePair"), "red", "bir xil tillar juftligi o'tib ketdi");
});

test("`distractorSimilarity`: begona distraktor SARIQ (qizil emas — evristika taxmin qiladi)", () => {
  assert.deepEqual(oddDistractors(GOOD[0]), [], "toza to'plamda yolg'on ogohlantirish");
  /*
   * `listening-game.md` §5 yomon misoli: «library» → «quyosh», «stul»,
   * «yugurish». Evristika ma'noni bilmaydi, lekin uning IZINI
   * (uzunlik/so'z soni) o'lchaydi.
   */
  const odd: ListeningItem = { id: "l9", text: "library", options: ["kutubxona", "gul", "ish", "bir kuni yugurish"], answer: 0 };
  const hits = oddDistractors(odd);
  assert.ok(hits.length >= 2, `evristika begona variantlarni ko'rmadi: ${JSON.stringify(hits)}`);
  const c = checkOf(docOf([odd, GOOD[1]]), "distractorSimilarity")!;
  assert.equal(c.level, "yellow");
  assert.ok(c.fix, "tuzatish ko'rsatmasi berilmadi");
  assert.equal(levelOf(docOf(GOOD), "distractorSimilarity"), "green");
});

/* ══════════════════════════ baholovchi va ball ══════════════════════════ */

test("baholovchi prompti ESHITILADIGAN matnni ko'radi (bosma varaqda u yo'q)", () => {
  const p = listeningJudgeUserPrompt(docOf(GOOD));
  assert.match(p, /TOOL: listening/);
  assert.match(p, /HEARD LANGUAGE: English · OPTIONS LANGUAGE: Uzbek/);
  assert.match(p, /HEARD: library \| CORRECT: kutubxona \| WRONG: muzey, dorixona, bekat/);
});

test("ball: qizil band ballni tushiradi, baholovchi mezonlari hisobotga tushadi", async () => {
  const good = await reviewListening(docOf(GOOD), { judge: false });
  const bad = await reviewListening(docOf([{ ...GOOD[0], answer: 9, options: ["kutubxona", "kutubxona", "a", "b"] }, GOOD[1]]), { judge: false });
  assert.ok(good.score > bad.score, `yomon to'plam ball yo'qotmadi: ${good.score} vs ${bad.score}`);
  const doc = docOf(GOOD);
  const neutral = scoreListeningReview(listeningRuleChecks(doc), doc.game!, neutralListeningJudge(doc.game!));
  assert.ok(Number.isFinite(neutral) && neutral > 0);

  const withJudge = await reviewListening(doc, {
    judge: true,
    complete: (async () => ({ text: JSON.stringify(Object.fromEntries([...LISTENING_JUDGE_CRITERIA.map((c) => [c, 3]), ["notes", []], ["fixes", []]])) })) as never,
  });
  for (const c of LISTENING_JUDGE_CRITERIA) assert.ok(withJudge.checks.some((x) => x.id === `judge:${c}`), `baholovchi bandi yo‘q: ${c}`);
});

/* ══════════════════════════ sayqal ══════════════════════════ */

test("sayqal MIQDOR va TILLAR bandini tuzatmaydi, distraktorlarni tuzatadi", async () => {
  const doc = docOf([{ id: "l9", text: "library", options: ["kutubxona", "gul", "ish", "bir kuni yugurish"], answer: 0 }, GOOD[1]]);
  const review = await reviewListening(doc, { judge: false });
  const plan = planListeningPolish(review, doc);
  assert.equal(plan.fixes.length, 1);
  assert.equal(plan.fixes[0].target, "items");
  assert.match(plan.fixes[0].instruction, /SAME semantic field/i);

  const langBad = docOf(GOOD);
  langBad.game!.listening!.targetLanguage = "uz";
  const r2 = await reviewListening(langBad, { judge: false });
  const p2 = planListeningPolish(r2, langBad);
  assert.ok(p2.skipped.some((s) => s.id === "languagePair" && s.reason === "user"), "tillar juftligi FORMA tanlovi — matn qayta yozilmaydi");
});

test("sayqal MATN o'zgarsa AUDIONI tashlaydi, o'zgarmasa saqlaydi", async () => {
  const withAudio: ListeningItem[] = [
    { ...GOOD[0], audioAssetId: "a1" },
    { ...GOOD[1], audioAssetId: "a2" },
  ];
  const doc = docOf(withAudio);
  // Birinchi topshiriq matni O'ZGARDI, ikkinchisi o'sha-o'sha.
  const answer = JSON.stringify({
    items: [
      { text: "bookshop", answer: "kitob do‘koni", distractors: ["muzey", "dorixona", "bekat"] },
      { text: "hospital", answer: "kasalxona", distractors: ["maktab", "bozor", "zavod"] },
    ],
  });
  const { ops } = await rewriteListeningFix(doc, { op: "rewrite", target: "items", instruction: "Yaxshilang" }, {
    complete: (async () => ({ text: answer })) as never,
    deadline: Date.now() + 60_000,
  });
  const items = ops[0].items;
  assert.deepEqual(items.map((i) => i.id), ["l1", "l2"], "barqaror id lar yo‘qoldi (ball hisobi shularga tayanadi)");
  assert.ok(!items[0].audioAssetId, "matn o‘zgardi — eski audio saqlanib qoldi (o‘quvchi boshqa so‘zni eshitardi)");
  assert.equal(items[1].audioAssetId, "a2", "matni o‘zgarmagan topshiriq audiosi bekorga yo‘qotildi");

  const applied = applyListeningOps(doc, ops);
  assert.ok(applied.ok && applied.doc);
  assert.ok(applied.doc!.sections[2].blocks.some((b) => b.text.includes("bookshop")), "javob kaliti eski matnda qoldi");
  // Topshiriq O'CHIRILMASIN — foydalanuvchi shunga to'lagan.
  assert.ok(!applyListeningOps(doc, [{ op: "setItems", items: [items[0]] }]).ok);
});

test("«Sizdan kutiladi»: audio yo'qligi HISOBOTDA aytiladi (fayl ochilganda emas)", async () => {
  const doc = docOf(GOOD);
  const review = await reviewListening(doc, { judge: false });
  const needs = listeningUserNeeds(review, doc);
  assert.ok(needs.some((n) => n.id === "audio"), "audio yo‘qligi haqida band yo‘q");
  assert.match(needs.find((n) => n.id === "audio")!.hint, /o‘qib bering/);

  const voiced = docOf(GOOD.map((i) => ({ ...i, audioAssetId: "a" })));
  const after = listeningUserNeeds(await reviewListening(voiced, { judge: false }), voiced);
  assert.ok(!after.some((n) => n.id === "audio"), "audio bor, lekin band baribir chiqdi");
});
