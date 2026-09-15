import test from "node:test";
import assert from "node:assert/strict";
import { scoreReviewFor, visualCoverageOf } from "../lib/generation/report/score.ts";
import { JUDGE_NEUTRAL, JUDGE_NO_ANSWER, judgeChecksFor, judgeSystemPromptFor, neutralJudgeFor, parseJudgeFor } from "../lib/generation/report/judge.ts";
import { MIN_CHARS, sampleForJudge } from "../lib/generation/report/text.ts";
import { guardSection } from "../lib/generation/report/guard.ts";
import { applyPolishWith, needsUserData, runPolishWith, type Fix } from "../lib/generation/report/polish-core.ts";
import type { DocReview, JudgeResult, JudgeSpec, ReviewCheck } from "../lib/generation/report/types.ts";
import type { AcademicDoc, DocSection } from "../lib/generation/types.ts";
import type { Reference } from "../lib/generation/article/types.ts";

/**
 * NEYTRAL HISOBOT/SAYQAL QATLAMI (Talaba ishlari 2, AUDIT-19 R0-A).
 *
 * Bu yerda maqola YO'Q: qatlam kurs ishi (`work/`) va insho (`essay/`)
 * dvigatellari uchun ham shartnoma, shuning uchun sun'iy mezonlar
 * (IELTS-ga o'xshash `tr/cc/lr/gra`) va sun'iy `Op` bilan sinaladi.
 *
 * Mutatsiyalar (har biri qizardi — pastda testda ham yozilgan):
 *   • `scoreReviewFor` da `judge.skipped` maxrajdan chiqarilmasa —
 *     «skipped maxrajdan chiqadi» testi yiqildi (100 o'rniga 78);
 *   • `sampleForJudge` da chekka (kirish/xulosa) shoxi olib tashlanib
 *     hammasi proporsional kesilsa — «kirish/xulosa to'liq» yiqildi;
 *   • `runPolishWith` da `after > before + acceptDelta` → `>=` —
 *     «ball oshmasa rad» testi yiqildi (0 farq qabul bo'ldi).
 */

/* ══════════════════════════════ fikstura ══════════════════════════════ */

type Crit = "tr" | "cc" | "lr" | "gra";

/** IELTS Task 2 ga o'xshash spetsifikatsiya — maqolaning 6 mezoni bilan aloqasi yo'q. */
const IELTS: JudgeSpec<Crit> = {
  criteria: ["tr", "cc", "lr", "gra"],
  describe: {
    tr: "the response fully addresses all parts of the task.",
    cc: "ideas are logically organised with clear progression.",
    lr: "vocabulary is wide and used precisely.",
    gra: "a wide range of structures is used accurately.",
  },
  labels: { tr: "Vazifaga javob", cc: "Mantiqiy bog‘lanish", lr: "Leksik boylik", gra: "Grammatika" },
  roleLine: "a university lecturer grading a course paper",
  typeLabel: "IELTS Task 2",
  typeNoun: "essay type",
};

const mk = (levels: ("green" | "yellow" | "red")[]): ReviewCheck[] => levels.map((level, i) => ({ id: `c${i}`, level, label: "x" }));

const full: JudgeResult<Crit> = { tr: 3, cc: 3, lr: 3, gra: 3, notes: [], fixes: [] };

/* ══════════════════════════════ ball ══════════════════════════════ */

test("scoreReviewFor: 60% qoidalar (yashil 1 / sariq 0.5 / qizil 0) + 40% baholovchi (mezon × 3); qoida yo'q → 1", () => {
  assert.equal(scoreReviewFor(mk(["green", "green"]), full, IELTS.criteria), 100);
  assert.equal(scoreReviewFor(mk(["red", "red"]), full, IELTS.criteria), 40);
  assert.equal(scoreReviewFor(mk(["yellow", "yellow"]), full, IELTS.criteria), scoreReviewFor(mk(["green", "red"]), full, IELTS.criteria));
  assert.equal(scoreReviewFor([], neutralJudgeFor(IELTS), IELTS.criteria), Math.round(60 + 40 * (2 / 3)));
  // Mezon soni ballga ta'sir qilmaydi — faqat ulushi.
  assert.equal(scoreReviewFor(mk(["green"]), { tr: 0, cc: 0, lr: 0, gra: 0, notes: [], fixes: [] }, IELTS.criteria), 60);
});

test("scoreReviewFor: `skipped` mezonlar MAXRAJDAN chiqadi (AUDIT-18 Q-7)", () => {
  const skipped: JudgeResult<Crit> = { ...full, lr: 0, gra: 0, skipped: ["lr", "gra"] };
  assert.equal(scoreReviewFor(mk(["green"]), skipped, IELTS.criteria), 100, "MUTATSIYA: skipped maxrajdan chiqarilmasa 78 chiqadi");
  // Nazorat: skipped bo'lmasa aynan shu ballar past baho beradi.
  assert.equal(scoreReviewFor(mk(["green"]), { ...full, lr: 0, gra: 0 }, IELTS.criteria), Math.round(60 + 40 * (6 / 12)));
});

/* ══════════════════════════════ baholovchi prompti ══════════════════════════════ */

test("judgeSystemPromptFor: ixtiyoriy mezonlar — sxema, ta'rif, rol qatori, tur so'zi; `skip` sxemada ham, ta'rifda ham yo'q", () => {
  const sys = judgeSystemPromptFor(IELTS, ["intro", "body-1", "conclusion"]);
  assert.ok(sys.startsWith("You are a university lecturer grading a course paper."), sys.slice(0, 80));
  assert.ok(sys.includes("(essay type: IELTS Task 2)"));
  for (const c of IELTS.criteria) assert.ok(sys.includes(`- ${c}: ${IELTS.describe[c]}`), c);
  assert.match(sys, /JSON schema: \{"tr":0-3,"cc":0-3,"lr":0-3,"gra":0-3,"notes"/);
  assert.ok(sys.includes("Allowed target ids: intro, body-1, conclusion."));
  // Q-2 ning baholovchi tomoni — keltirilmagan tajriba tafsiloti so'ralmaydi.
  assert.ok(sys.includes("NEVER ask to add unreported experimental details"));
  assert.ok(sys.includes("OUTPUT LANGUAGE: Uzbek"));

  const skipped = judgeSystemPromptFor({ ...IELTS, skip: ["lr"] }, ["intro"], ["keywords"]);
  assert.ok(!skipped.includes("- lr:"), "skip qilingan mezon promptda qolmasin");
  assert.match(skipped, /JSON schema: \{"tr":0-3,"cc":0-3,"gra":0-3,"notes"/);
  assert.ok(skipped.includes("Allowed target ids: intro, keywords."), "extraTargets ruxsat ro'yxatiga qo'shilsin");

  // Rol/tur berilmasa — standart maqola matni (maqola prompti o'zgarmasligi shartnomasi).
  const plain = judgeSystemPromptFor({ criteria: IELTS.criteria, describe: IELTS.describe, labels: IELTS.labels }, ["intro"]);
  assert.ok(plain.startsWith("You are a strict peer reviewer for an academic journal. Evaluate the manuscript and return ONLY a JSON object"), plain.slice(0, 120));
});

test("parseJudgeFor: ballar 0–3 ga qisiladi, yo'q maydon → neytral, notes ≤5, noma'lum target tashlanadi, skip → skipped; JSON emas → null", () => {
  const raw = JSON.stringify({
    tr: 3,
    cc: 9,
    lr: -1,
    notes: Array.from({ length: 7 }, (_, i) => `n${i}`),
    fixes: [
      { target: "body-1", instruction: "x" },
      { target: "zzz", instruction: "y" },
      { target: "keywords", instruction: "k" },
      { target: "body-1", instruction: "" },
    ],
  });
  const j = parseJudgeFor({ ...IELTS, skip: ["gra"] }, raw, ["intro", "body-1"], ["keywords"])!;
  assert.deepEqual({ ...j, notes: j.notes.length }, {
    tr: 3,
    cc: 3,
    lr: 0,
    gra: JUDGE_NEUTRAL,
    notes: 5,
    fixes: [
      { target: "body-1", instruction: "x" },
      { target: "keywords", instruction: "k" },
    ],
    skipped: ["gra"],
  });
  assert.equal(parseJudgeFor(IELTS, "not json at all", ["intro"]), null);
  assert.equal(parseJudgeFor(IELTS, null, ["intro"]), null);
  // `skip` yo'q bo'lsa `skipped` maydoni umuman qo'shilmaydi.
  assert.ok(!("skipped" in parseJudgeFor(IELTS, "{}", [])!));
});

test("neutralJudgeFor / judgeChecksFor: hamma mezon 2; bandlar 3→yashil, 2→sariq, ≤1→qizil; skipped band yo'q; fixes → tavsiya bandlari", () => {
  const n = neutralJudgeFor(IELTS);
  assert.deepEqual(n, { tr: 2, cc: 2, lr: 2, gra: 2, notes: [], fixes: [] });

  const j: JudgeResult<Crit> = { tr: 3, cc: 2, lr: 0, gra: 1, notes: [], fixes: [{ target: "body-1", instruction: "Aniqroq yoz" }] };
  const checks = judgeChecksFor(IELTS, j);
  assert.deepEqual(checks.map((c) => `${c.id}:${c.level}`), ["judge:tr:green", "judge:cc:yellow", "judge:lr:red", "judge:gra:red", "judge:fix:1:yellow"]);
  assert.equal(checks[0].label, "Vazifaga javob");
  assert.equal(checks[2].detail, "0/3");
  assert.deepEqual(checks[4].fix, { op: "rewrite", target: "body-1", instruction: "Aniqroq yoz" });

  const ids = judgeChecksFor(IELTS, { ...j, skipped: ["lr", "gra"] }).map((c) => c.id);
  assert.ok(!ids.includes("judge:lr") && !ids.includes("judge:gra") && ids.includes("judge:tr"), ids.join(","));
});

/* ══════════════════════════════ matn namunasi (X-4) ══════════════════════════════ */

const group = (id: string, n: number) => ({ id, title: id.toUpperCase(), lines: [Array.from({ length: n }, () => "x").join("")] });

test("sampleForJudge: hammasi sig'sa hech narsa kesilmaydi", () => {
  const out = sampleForJudge([group("intro", 100), group("body", 200), group("conclusion", 50)], 1000);
  assert.deepEqual(out.map((g) => g.text.length), [100, 200, 50]);
  assert.ok(out.every((g) => !g.truncated));
});

test("sampleForJudge: kirish va XULOSA to'liq qoladi, ulushi o'rtadagilardan olinadi (X-4)", () => {
  const groups = [group("intro", 500), group("body-1", 4000), group("body-2", 4000), group("conclusion", 500)];
  const out = sampleForJudge(groups, 3000);
  assert.equal(out[0].text.length, 500, "MUTATSIYA: chekka shoxi olib tashlansa kirish 200 ga tushadi");
  assert.equal(out[3].text.length, 500, "MUTATSIYA: xulosa ham kesilsa qizaradi");
  assert.ok(!out[0].truncated && !out[3].truncated);
  // O'rtadagilar o'z ulushida, proporsional: (3000 − 1000) / 8000 = 0.25.
  assert.deepEqual(out.slice(1, 3).map((g) => g.text.length), [1000, 1000]);
  assert.ok(out[1].truncated && out[2].truncated);
  assert.equal(out.reduce((n, g) => n + g.text.length, 0), 3000, "jami byudjetdan oshmasin");
});

test("sampleForJudge: chekkalar byudjetga sig'masa — proporsional (o'rta yo'qolmaydi); har guruhda kamida MIN_CHARS", () => {
  const groups = [group("intro", 40_000), group("body", 40_000), group("conclusion", 40_000)];
  const out = sampleForJudge(groups, 5000);
  assert.deepEqual(out.map((g) => g.text.length), [1666, 1666, 1666]);
  assert.ok(out.every((g) => g.truncated));
  // Ikki guruh (chekkasiz o'rta yo'q) — ular ham proporsional kesiladi.
  const two = sampleForJudge([group("intro", 5000), group("conclusion", 5000)], 2000);
  assert.deepEqual(two.map((g) => g.text.length), [1000, 1000]);
  // Juda kichik byudjetda ham har guruh MIN_CHARS ni saqlaydi.
  const tiny = sampleForJudge([group("a", 5000), group("b", 5000), group("c", 5000)], 100);
  assert.deepEqual(tiny.map((g) => g.text.length), [MIN_CHARS, MIN_CHARS, MIN_CHARS]);
});

/* ══════════════════════════════ qo'riqchi ══════════════════════════════ */

test("guardSection (report): reyestrda yo'q iqtibos o'chadi, manbasiz foiz hisoblanadi, fakt raqami topiladi, «suv» ibora sanaladi", () => {
  const refs: Reference[] = [{ id: "W1", title: "T", authors: ["A"], year: 2024, verified: "openalex", cited: true }];
  const r = guardSection(
    [
      { kind: "p", text: "Bugungi kunda tizim samaradorligi 42% ga oshdi." },
      { kind: "p", text: "Natijalar 4,6 ball bilan tasdiqlandi [W1; W9999]." },
    ],
    { refs, userFacts: "o‘rtacha ball 4,6" },
  );
  assert.deepEqual(r.report.removedCitations, ["W9999"]);
  assert.equal(r.report.citations, 1);
  assert.deepEqual(r.report.unsourcedNumbers, ["42%"], "iqtibossiz foiz manbasiz hisoblanadi");
  assert.deepEqual(r.report.factNumbersFound, ["4.6"]);
  assert.deepEqual(r.report.filler, ["bugungi kunda"]);
  assert.ok(r.report.words > 0 && r.report.wordRangeOk);
  assert.ok(!r.blocks[1].text.includes("W9999"));
  // `wordRange` berilsa chegara tekshiriladi.
  assert.equal(guardSection([{ kind: "p", text: "juda qisqa" }], { refs, wordRange: [50, 100] }).report.wordRangeOk, false);
});

test("visualCoverageOf: `[fig:id]` tokeni, raqamli yorliq yoki «jadval» so'zi havola sanaladi; fallback sxema talab qilmaydi", () => {
  const sections: DocSection[] = [
    { id: "intro", title: "Kirish", blocks: [{ kind: "p", text: "Tuzilma [fig:f1] da." }, { kind: "figure", text: "Sxema", figureId: "f1" }] },
    { id: "body", title: "Asosiy", blocks: [{ kind: "tableRef", text: "Jadval", tableId: "t1" }] },
    { id: "out", title: "Xulosa", blocks: [{ kind: "figure", text: "Chizilmadi", figureId: "f2" }] },
  ];
  const labels = { figureRef: (n: string) => `${n}-rasm`, tableRef: (n: string) => `${n}-jadval` };
  const numbers = { figures: { f1: "1", f2: "2" }, tables: { t1: "1" } };
  const v = visualCoverageOf(sections, [{ id: "f1" }, { id: "f2", fallbackBlocks: [{}] }], numbers, labels, "uz");
  assert.equal(v.fallback, 1, "chizilmagan sxema havola talab qilmaydi");
  assert.equal(v.count, 2);
  assert.deepEqual(v.unreferenced.map((u) => `${u.kind}:${u.id}:${u.label}`), ["table:t1:1-jadval"]);
  assert.equal(v.unreferenced[0].sectionId, "body");
});

/* ══════════════════════════════ Q-2 ══════════════════════════════ */

test("needsUserData: kuchli belgi yolg'iz yetarli; kuchsiz faqat «qo'sh/keltir» fe'li bilan; xavfsiz tavsiya o'tadi", () => {
  assert.equal(needsUserData("Report the statistical tests and p-values used"), true);
  assert.equal(needsUserData("Dastgoh parametrlarini ko‘rsating"), true);
  assert.equal(needsUserData("Укажите платформу и параметры выборки"), true);
  assert.equal(needsUserData("Provide the methods in more detail"), true, "kuchsiz + fe'l");
  assert.equal(needsUserData("Compare the results with the cited sources"), false, "fe'lsiz kuchsiz belgi o'tadi");
  assert.equal(needsUserData("Xulosani maqsadga moslang"), false);
});

/* ══════════════════════════════ sayqal yadrosi ══════════════════════════════ */

/** Sun'iy op: maqolaga ham, kurs ishiga ham tegishli emas. */
type TestOp = { op: "set"; sectionId: string; text: string };

const doc = (): AcademicDoc =>
  ({
    meta: { topic: "T", language: "uz" },
    titlePage: false,
    toc: false,
    sections: [
      { id: "intro", title: "Kirish", blocks: [{ kind: "p", text: "eski kirish" }] },
      { id: "out", title: "Xulosa", blocks: [{ kind: "p", text: "eski xulosa" }] },
    ],
  }) as unknown as AcademicDoc;

const review = (score: number): DocReview => ({ score, checks: [], judgeNotes: [], verifiedShare: 1, recentShare: 1, builtAt: "2026-09-15T00:00:00.000Z" });

const fix = (target: string): Fix => ({ op: "rewrite", target, instruction: `fix ${target}` });

/** `rewrite` dependensiyasi — `target` `fail` bo'lsa xato. */
const rewriteDep = (calls: string[]) => async (d: AcademicDoc, f: Fix) => {
  calls.push(f.target);
  if (f.target === "fail") throw new Error("model javob bermadi");
  assert.equal(d.sections.length, 2, "har fix ASL hujjat ustida");
  return { ops: [{ op: "set" as const, sectionId: f.target, text: f.instruction }], unresolved: [{ id: "W9", sectionId: f.target }], rewrittenSections: [f.target] };
};

test("applyPolishWith: fix lar parallel, bitta xato boshqalarini to'xtatmaydi; op/unresolved/rewrittenSections yig'iladi", async () => {
  const calls: string[] = [];
  const r = await applyPolishWith<TestOp>(doc(), [fix("intro"), fix("fail"), fix("out")], { rewrite: rewriteDep(calls), concurrency: 2 });
  assert.deepEqual(calls.sort(), ["fail", "intro", "out"]);
  assert.deepEqual(r.applied.map((f) => f.target), ["intro", "out"]);
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].fix.target, "fail");
  assert.match(r.failed[0].reason, /javob bermadi/);
  assert.deepEqual(r.ops.map((o) => o.sectionId), ["intro", "out"]);
  assert.deepEqual(r.rewrittenSections, ["intro", "out"]);
  assert.deepEqual(r.unresolved.map((u) => u.sectionId), ["intro", "out"]);
});

/** `runPolishWith` uchun standart dependensiyalar; `after` — qayta hisobot bali. */
function deps(o: { after: number; acceptDelta?: number; fixes?: Fix[]; judgeAnswer?: boolean; prevJudge?: { s: number } | null }) {
  const applied: TestOp[] = [];
  const rescored: string[] = [];
  return {
    applied,
    rescored,
    d: {
      deadline: Date.now() + 300_000,
      acceptDelta: o.acceptDelta,
      plan: () => ({ fixes: o.fixes ?? [fix("intro")], skipped: [{ id: "udk", reason: "user" }] }),
      userNeeds: () => [{ id: "results", label: "Natijalarim", hint: "kiriting" }],
      rewrite: rewriteDep([]),
      apply: (d: AcademicDoc, ops: TestOp[]) => {
        applied.push(...ops);
        return { ok: true as const, doc: { ...d, sections: d.sections.map((s) => ({ ...s, title: `${s.title}*` })) } };
      },
      review: async (): Promise<DocReview> => ({ ...review(o.after), judgeNotes: o.judgeAnswer === false ? [JUDGE_NO_ANSWER] : [] }),
      judgeFromReview: (prev: DocReview) => (o.prevJudge === null ? null : { s: prev.score }),
      rescore: (fresh: DocReview, j: { s: number }) => {
        rescored.push(`${fresh.score}←${j.s}`);
        return { ...fresh, score: j.s };
      },
    },
  };
}

test("runPolishWith: ball OSHSA qabul — yangi hujjat, jurnal (before/after/applied/skipped), userNeeds yangi hisobotdan", async () => {
  const { d, applied } = deps({ after: 80 });
  const r = await runPolishWith<TestOp, { s: number }>(doc(), review(70), d);
  assert.equal(r.accepted, true);
  assert.equal(r.review.score, 80);
  assert.equal(r.doc.sections[0].title, "Kirish*", "qabul qilinsa YANGI hujjat qaytadi");
  assert.deepEqual(r.log, {
    before: 70,
    after: 80,
    applied: [{ target: "intro", instruction: "fix intro" }],
    skipped: [{ id: "udk", reason: "user" }],
    accepted: true,
    at: r.log.at,
  });
  assert.deepEqual(r.ops, applied);
  assert.deepEqual(r.review.userNeeds?.map((n) => n.id), ["results"]);
});

test("runPolishWith: qabul FAQAT `after > before + acceptDelta` — teng rad, acceptDelta 2 bilan +1 ham rad, +3 qabul", async () => {
  const same = await runPolishWith<TestOp, { s: number }>(doc(), review(70), deps({ after: 70 }).d);
  assert.equal(same.accepted, false, "MUTATSIYA: `>` o'rniga `>=` bo'lsa teng ball qabul bo'ladi");
  assert.equal(same.review.score, 70, "rad etilsa ESKI hisobot qoladi");
  assert.equal(same.doc.sections[0].title, "Kirish", "rad etilsa eski hujjat");
  assert.deepEqual(same.ops, []);
  assert.deepEqual(same.applied.map((f) => f.target), ["intro"], "urinish jurnalda qoladi");
  assert.equal(same.log.after, 70);

  const lower = await runPolishWith<TestOp, { s: number }>(doc(), review(70), deps({ after: 60 }).d);
  assert.equal(lower.accepted, false);

  // X-5: baholovchi shovqini (±5) uchun kurs ishida chegara +2.
  const plusOne = await runPolishWith<TestOp, { s: number }>(doc(), review(70), deps({ after: 71, acceptDelta: 2 }).d);
  assert.equal(plusOne.accepted, false, "MUTATSIYA: acceptDelta e'tiborga olinmasa +1 qabul bo'ladi");
  const plusThree = await runPolishWith<TestOp, { s: number }>(doc(), review(70), deps({ after: 73, acceptDelta: 2 }).d);
  assert.equal(plusThree.accepted, true);
});

test("runPolishWith: baholovchi javob bermasa ballari ESKI hisobotdan (`judgeFromReview` → `rescore`); eski ball yo'q bo'lsa qayta hisoblanmaydi", async () => {
  // Yangi hisobot 95 deb ko'rsatadi, lekin baholovchi javobsiz — eski 70 tiklanadi → rad.
  const noAnswer = deps({ after: 95, judgeAnswer: false });
  const r = await runPolishWith<TestOp, { s: number }>(doc(), review(70), noAnswer.d);
  assert.deepEqual(noAnswer.rescored, ["95←70"]);
  assert.equal(r.log.after, 70);
  assert.equal(r.accepted, false, "neytral/soxta o'sish qabul qilinmasin");

  // Eski hisobotda baholovchi ballari yo'q — qayta hisoblash yo'q, yangi ball o'z holicha.
  const none = deps({ after: 95, judgeAnswer: false, prevJudge: null });
  const r2 = await runPolishWith<TestOp, { s: number }>(doc(), review(70), none.d);
  assert.deepEqual(none.rescored, []);
  assert.equal(r2.accepted, true);
  assert.equal(r2.log.after, 95);

  // Baholovchi javob bergan bo'lsa `judgeFromReview` umuman chaqirilmaydi.
  const ok = deps({ after: 95 });
  await runPolishWith<TestOp, { s: number }>(doc(), review(70), ok.d);
  assert.deepEqual(ok.rescored, []);
});

test("runPolishWith: fix yo'q / vaqt yetmadi / op lar qo'llanmadi → rad, LLM chaqirilmaydi, sabab jurnalda", async () => {
  const calls: string[] = [];
  const empty = await runPolishWith<TestOp, { s: number }>(doc(), review(70), { ...deps({ after: 90 }).d, plan: () => ({ fixes: [], skipped: [{ id: "udk", reason: "user" }] }), rewrite: rewriteDep(calls) });
  assert.equal(empty.accepted, false);
  assert.deepEqual(empty.log.skipped, [{ id: "udk", reason: "user" }]);
  assert.deepEqual(calls, [], "fix bo'lmasa model chaqirilmaydi");
  assert.equal(empty.log.after, 70, "urinish bo'lmasa `after` = `before`");

  const noTime = await runPolishWith<TestOp, { s: number }>(doc(), review(70), { ...deps({ after: 90 }).d, deadline: Date.now() + 1000, rewrite: rewriteDep(calls) });
  assert.ok(noTime.log.skipped.some((s) => s.reason === "budget"), JSON.stringify(noTime.log.skipped));
  assert.deepEqual(calls, [], "byudjet yetmasa model chaqirilmaydi");

  const badOps = await runPolishWith<TestOp, { s: number }>(doc(), review(70), { ...deps({ after: 90 }).d, apply: () => ({ ok: false as const, error: "bo'lim yo'q" }) });
  assert.equal(badOps.accepted, false);
  assert.ok(badOps.log.skipped.some((s) => s.id === "ops" && s.reason === "error"));

  const allFail = await runPolishWith<TestOp, { s: number }>(doc(), review(70), { ...deps({ after: 90, fixes: [fix("fail")] }).d });
  assert.equal(allFail.accepted, false);
  assert.deepEqual(allFail.failed.map((f) => f.fix.target), ["fail"]);
  assert.ok(allFail.log.skipped.some((s) => s.id === "fail" && s.reason === "error"));
});
