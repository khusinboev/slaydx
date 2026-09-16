import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";
import { buildEssayDoc, fallbackOutline, outlineFromLlm } from "../lib/generation/essay/engine.ts";
import { essayCtx } from "../lib/generation/essay/prompts.ts";
import { essayInputFromValues } from "../lib/generation/essay/input.ts";
import { reviewEssay } from "../lib/generation/essay/review.ts";
import { runEssayPolish, ESSAY_ACCEPT_DELTA } from "../lib/generation/essay/polish.ts";

/**
 * INSHO DVIGATELI (AUDIT-19 WP-D) — stub `complete` bilan.
 *
 * Mutatsiyalar: hajm qayta so'rovi olib tashlansa, qo'riqchi
 * (`guardSection`) chetlab o'tilsa, ikki qismli yo'l yo'qolsa yoki
 * `acceptDelta` 1 dan 0 ga tushsa — quyidagi testlar qizaradi.
 */

/* ────────────────────────── stub ────────────────────────── */

const filler = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(" ");
const para = (tag: string, n: number) => `Bu ${tag} bandi asosiy fikrni aniq bayon qiladi va misol bilan asoslaydi. ${filler(n, tag)}.`;
const blocksJson = (specs: [string, number][]) => JSON.stringify({ blocks: specs.map(([tag, n]) => ({ kind: "p", text: para(tag, n) })) });

const GOOD: [string, number][] = [
  ["kirish", 50],
  ["birinchi", 90],
  ["ikkinchi", 90],
  ["uchinchi", 90],
  ["xulosa", 50],
];

const outlineJson = (n = 5, thesis = "Muntazam kitob o‘qish o‘quvchining fikrlash va yozma nutq malakasini izchil rivojlantiradi.") =>
  JSON.stringify({
    title: "Ona tilim — g‘ururim",
    thesisStatement: thesis,
    paragraphs: Array.from({ length: n }, (_, i) => ({
      id: `p${i + 1}`,
      role: i === 0 ? "intro" : i === n - 1 ? "conclusion" : "body",
      topicSentence: i === 0 || i === n - 1 ? undefined : `Bu band ${i} - da'voni aniq bayon qiladi va misol bilan asoslaydi.`,
      brief: `Band ${i + 1} rejasi`,
      words: i === 0 || i === n - 1 ? 60 : 110,
    })),
  });

type Call = { role: LlmRole; user: string };

/** Haqiqiy `complete` kabi `usage` qaytaradi — `CostMeter` shuni sanaydi. */
const USAGE = { provider: "stub", model: "stub-1", inputTokens: 100, outputTokens: 200 };

function makeStub(o: { write?: (user: string, n: number) => string | null; judge?: object | null } = {}) {
  const calls: Call[] = [];
  let writes = 0;
  const fn = (async (role: LlmRole, _system: string, user: string) => {
    calls.push({ role, user });
    if (role === "judge") return o.judge ? { text: JSON.stringify(o.judge), usage: USAGE } : null;
    if (user.startsWith("Plan the essay")) return { text: outlineJson(), usage: USAGE };
    const text = o.write ? o.write(user, writes++) : blocksJson(GOOD);
    return text === null ? null : { text, usage: USAGE };
  }) as never;
  return { fn, calls };
}

const metaOf = (values: FormValues) => extractMeta(TOOL_BY_ID.essay, values);
const DEADLINE = () => Date.now() + 180_000;

/* ────────────────────────── testlar ────────────────────────── */

test("hujjat shakli: bitta «essay» bo'limi, mundarijasiz, model to'ldirilgan", async () => {
  const values: FormValues = { topic: "Ona tilim", pages: "2" };
  const stub = makeStub();
  const stages: number[] = [];
  const built = await buildEssayDoc(metaOf(values), values, { deadline: DEADLINE(), complete: stub.fn, judge: false, polish: false, onStage: (e) => stages.push(e.progress) });
  assert.ok(built);
  const { doc, cost } = built;
  assert.equal(doc.sections.length, 1);
  assert.equal(doc.sections[0].id, "essay");
  assert.equal(doc.sections[0].title, "Ona tilim — g‘ururim", "sarlavha rejadan");
  assert.equal(doc.toc, false);
  assert.equal(doc.titlePage, false, "maktab inshosida titul varaq yo'q");
  assert.equal(doc.essay?.context, "school_dtm");
  assert.equal(doc.essay?.kind, "reflective");
  assert.equal(doc.essay?.rubric, "dtm24");
  assert.equal(doc.essay?.paragraphs.length, 5);
  assert.deepEqual(doc.essay?.words, { aim: 460, min: 368, max: 575 });
  assert.ok(cost.calls > 0, "LLM chaqiruvlari sanaladi");
  assert.deepEqual([...stages].sort((a, b) => a - b), stages, "bosqich foizi kamaymaydi");
  assert.equal(stages[stages.length - 1], 100);
});

test("akademik esse: titul varaq va thesis statement modelga tushadi", async () => {
  const values: FormValues = { topic: "Kitob o‘qish", pages: "3", essayContext: "academic", essayKind: "argumentative", language: "en" };
  const stub = makeStub();
  const built = await buildEssayDoc(metaOf(values), values, { deadline: DEADLINE(), complete: stub.fn, judge: false, polish: false });
  assert.ok(built);
  assert.equal(built.doc.titlePage, true, "OTM essesi GOST titul bilan");
  assert.equal(built.doc.essay?.language, "en");
  assert.match(built.doc.essay?.thesisStatement ?? "", /Muntazam kitob/);
  // Thesis statement yozuv promptiga VERBATIM uzatiladi.
  const write = stub.calls.find((c) => c.user.startsWith("Write the WHOLE essay"));
  assert.match(write?.user ?? "", /THESIS STATEMENT \(use it verbatim/);
});

test("reja kelmasa — deterministik zaxira reja bilan baribir yoziladi", async () => {
  const values: FormValues = { topic: "Ona tilim", pages: "2" };
  const stub = makeStub();
  const broken = (async (role: LlmRole, _s: string, user: string) => {
    if (role === "judge") return null;
    if (user.startsWith("Plan the essay")) return { text: "reja emas, oddiy matn" };
    return { text: blocksJson(GOOD) };
  }) as never;
  const built = await buildEssayDoc(metaOf(values), values, { deadline: DEADLINE(), complete: broken, judge: false, polish: false });
  assert.ok(built);
  assert.equal(built.doc.sections[0].title, "Ona tilim", "sarlavha mavzudan");
  assert.ok((built.doc.essay?.paragraphs.length ?? 0) >= 4);
  assert.equal(built.doc.essay?.paragraphs[0].role, "intro");
  assert.equal(built.doc.essay?.paragraphs.at(-1)?.role, "conclusion");
  assert.equal(stub.calls.length, 0);
});

test("hajm oralig'idan chiqsa BIR marta qayta so'raladi va yaxshisi olinadi", async () => {
  const values: FormValues = { topic: "Ona tilim", pages: "2" };
  const stub = makeStub({
    write: (user) => (user.startsWith("The essay you wrote is") ? blocksJson(GOOD) : blocksJson([["kirish", 20], ["tana", 25], ["xulosa", 20]])),
  });
  const built = await buildEssayDoc(metaOf(values), values, { deadline: DEADLINE(), complete: stub.fn, judge: false, polish: false });
  assert.ok(built);
  const retry = stub.calls.filter((c) => c.user.startsWith("The essay you wrote is"));
  assert.equal(retry.length, 1, "qayta so'rov FAQAT bir marta");
  assert.match(retry[0].user, /required range is 368–575/);
  assert.equal(built.doc.sections[0].blocks.length, 5, "uzunroq variant qabul qilindi");
});

test("qayta so'rov ham yomon bo'lsa — eski matn qoladi", async () => {
  const values: FormValues = { topic: "Ona tilim", pages: "2" };
  const stub = makeStub({
    write: (user) =>
      user.startsWith("The essay you wrote is")
        ? blocksJson([["bitta", 30]])
        : blocksJson([["kirish", 60], ["tana", 70], ["xulosa", 60]]),
  });
  const built = await buildEssayDoc(metaOf(values), values, { deadline: DEADLINE(), complete: stub.fn, judge: false, polish: false });
  assert.ok(built);
  assert.equal(built.doc.sections[0].blocks.length, 3, "oraliqqa yaqinrog'i saqlanadi");
});

test("qo'riqchi: klişe va manbasiz raqam hisobotga tushadi, iqtibos id lari o'chadi", async () => {
  const values: FormValues = { topic: "Ona tilim", pages: "2" };
  const dirty = JSON.stringify({
    blocks: [
      { kind: "p", text: `Bugungi kunda ona tili masalasi dolzarb [W123]. ${filler(50, "kirish")}.` },
      { kind: "p", text: `Ma’lumki til millat ko‘zgusidir va yoshlarning 78 % i buni his qiladi. ${filler(90, "a")}.` },
      { kind: "p", text: para("b", 90) },
      { kind: "p", text: para("c", 90) },
      { kind: "p", text: `Xulosa qilib aytganda ona tili — milliy boylik. ${filler(50, "x")}.` },
    ],
  });
  const stub = makeStub({ write: () => dirty });
  const built = await buildEssayDoc(metaOf(values), values, { deadline: DEADLINE(), complete: stub.fn, judge: false, polish: false });
  assert.ok(built);
  const text = built.doc.sections[0].blocks.map((b) => b.text).join(" ");
  assert.ok(!text.includes("[W123]"), "inshoda iqtibos reyestri yo'q — id o'chiriladi");
  const review = built.doc.essay?.review;
  assert.ok(review);
  assert.equal(review.checks.find((c) => c.id === "filler")?.level, "red", "uchta klişe");
  assert.equal(review.checks.find((c) => c.id === "unsourcedNumbers")?.level, "red");
});

test("5 varaqli insho ikki qismda yoziladi", async () => {
  const values: FormValues = { topic: "Ona tilim", pages: "5" };
  const stub = makeStub({
    write: (user) =>
      user.startsWith("Write the FIRST part")
        ? blocksJson([["kirish", 120], ["a", 150], ["b", 150]])
        : blocksJson([["c", 150], ["d", 150], ["xulosa", 120]]),
  });
  const built = await buildEssayDoc(metaOf(values), values, { deadline: DEADLINE(), complete: stub.fn, judge: false, polish: false });
  assert.ok(built);
  assert.ok(stub.calls.some((c) => c.user.startsWith("Write the FIRST part")));
  const tail = stub.calls.find((c) => c.user.startsWith("Write the REMAINING part"));
  assert.ok(tail, "ikkinchi qism so'raladi");
  assert.match(tail!.user, /ALREADY WRITTEN/, "birinchi qism matni uzatiladi (takror bo'lmasin)");
  assert.equal(built.doc.sections[0].blocks.length, 6);
  // 2 varaqli insho — bitta chaqiruv.
  const small = makeStub();
  await buildEssayDoc(metaOf({ topic: "Ona tilim", pages: "2" }), { topic: "Ona tilim", pages: "2" }, { deadline: DEADLINE(), complete: small.fn, judge: false, polish: false });
  assert.ok(!small.calls.some((c) => c.user.startsWith("Write the FIRST part")));
});

test("epigraf birinchi blok bo'lib turadi va hajmga kirmaydi", async () => {
  const values: FormValues = { topic: "Ona tilim", pages: "2", essayKind: "literary", workTitle: "Alpomish", epigraph: "So‘z — qalb kaliti — Alisher Navoiy" };
  const stub = makeStub();
  const built = await buildEssayDoc(metaOf(values), values, { deadline: DEADLINE(), complete: stub.fn, judge: false, polish: false });
  assert.ok(built);
  const first = built.doc.sections[0].blocks[0];
  assert.equal(first.kind, "quote");
  assert.match(first.text, /So‘z — qalb kaliti — Alisher Navoiy/);
  assert.deepEqual(built.doc.essay?.epigraph, { text: "So‘z — qalb kaliti", author: "Alisher Navoiy" });
  assert.equal(built.doc.essay?.workTitle, "Alpomish");
  // Epigraf promptga ham VERBATIM tushadi.
  assert.match(stub.calls[0].user.length ? stub.calls[0].user : "", /Plan the essay/);
});

test("LLM javob bermasa — hujjat qaytadi, xato tashlanmaydi", async () => {
  const values: FormValues = { topic: "Ona tilim", pages: "2" };
  const built = await buildEssayDoc(metaOf(values), values, { deadline: DEADLINE(), complete: (async () => null) as never, judge: false, polish: false });
  assert.ok(built, "hujjat qaytadi — hajm darvozasi (index.ts) uni yiqitadi");
  assert.equal(built.doc.sections[0].blocks.length, 0);
  assert.equal(built.cost.calls, 0);
});

test("avto-sayqal: ball oshsa qabul, oshmasa hujjat o'zgarmaydi (acceptDelta 1)", async () => {
  const values: FormValues = { topic: "Ona tilim", pages: "2" };
  const weak = makeStub({ write: () => blocksJson([["kirish", 30], ["tana", 35], ["xulosa", 30]]) });
  const built = await buildEssayDoc(metaOf(values), values, { deadline: DEADLINE(), complete: weak.fn, judge: false, polish: false });
  assert.ok(built);
  const doc = built.doc;
  const review = await reviewEssay(doc, { judge: false });
  assert.ok(review.score < 80, `zaif insho bali: ${review.score}`);

  // Qabul: sayqal to'liq inshoni qaytaradi.
  const good = (async (role: LlmRole) => (role === "judge" ? null : { text: blocksJson([["kirish", 50], ["birinchi", 90], ["ikkinchi", 90], ["uchinchi", 90], ["xulosa", 50]]) })) as never;
  const accepted = await runEssayPolish(doc, review, { complete: good, deadline: DEADLINE(), judge: false });
  assert.equal(accepted.accepted, true);
  assert.ok(accepted.log.after > accepted.log.before + ESSAY_ACCEPT_DELTA, `${accepted.log.before} → ${accepted.log.after}`);
  assert.equal(accepted.doc.sections[0].blocks.length, 5);
  assert.ok(accepted.applied.length >= 1);

  // Rad: sayqal o'sha zaif matnni qaytaradi — eski hujjat qoladi.
  const same = (async (role: LlmRole) => (role === "judge" ? null : { text: blocksJson([["kirish", 30], ["tana", 35], ["xulosa", 30]]) })) as never;
  const rejected = await runEssayPolish(doc, review, { complete: same, deadline: DEADLINE(), judge: false });
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.doc, doc, "rad etilganda ASL hujjat qoladi");
  assert.equal(rejected.review.polish?.accepted, false);
  assert.ok((rejected.review.userNeeds ?? []).every((n) => typeof n.id === "string"));

  // Chegara HAQIQATAN ishlatiladi: bir xil yaxshilanish baland chegarada rad etiladi.
  assert.equal(ESSAY_ACCEPT_DELTA, 1);
  const strict = await runEssayPolish(doc, review, { complete: good, deadline: DEADLINE(), judge: false, acceptDelta: 50 });
  assert.equal(strict.accepted, false, "acceptDelta chegarasi qo'llanmasa bu qabul bo'lardi");
  assert.ok(strict.log.after > strict.log.before, "ball oshdi, lekin chegaradan kam");
});

test("reja tahlili: noto'g'ri rol tashlanadi, yetarli bo'lmasa zaxiraga tushadi", () => {
  const input = essayInputFromValues({ topic: "Ona tilim", pages: "2" });
  const ctx = essayCtx(metaOf({ topic: "Ona tilim", pages: "2" }), input);
  const ok = outlineFromLlm(outlineJson(5), ctx);
  assert.equal(ok.plans.length, 5);
  assert.equal(ok.plans[1].role, "body");
  // Faqat ikki band — ishonchsiz reja, zaxira ishlaydi.
  const few = outlineFromLlm(JSON.stringify({ title: "X", paragraphs: [{ id: "p1", role: "intro", brief: "a", words: 60 }] }), ctx);
  assert.deepEqual(few.plans.map((p) => p.role), fallbackOutline(ctx).map((p) => p.role));
  // Noma'lum rol («summary») tashlanadi.
  const junk = outlineFromLlm(JSON.stringify({ paragraphs: [{ id: "p1", role: "summary", brief: "a", words: 60 }] }), ctx);
  assert.ok(junk.plans.length >= 4);
});
