import test from "node:test";
import assert from "node:assert/strict";
import {
  WORK_ACCEPT_DELTA,
  applyWorkSectionOps,
  planWorkPolish,
  rewriteWorkFix,
  runWorkPolish,
  workContextOf,
  workCriterionFixes,
  workJudgeFromReview,
  workUserNeeds,
} from "../lib/generation/work/polish.ts";
import { reviewWork } from "../lib/generation/work/review.ts";
import type { AcademicDoc, Block, DocMeta } from "../lib/generation/types.ts";
import type { Reference } from "../lib/generation/types.ts";
import type { DocReview, ReviewCheck } from "../lib/generation/report/types.ts";
import type { WorkModel } from "../lib/generation/work/types.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";

/**
 * AVTO-SAYQAL — TALABA ISHI (AUDIT-19 WP-A). Q-2 (halollik chegarasi),
 * Q-3 + X-5 (`acceptDelta` +2) va «Sizdan kutiladi» shu yerda qulflanadi.
 */

const meta: DocMeta = { pagesLabel: "25-30", targetPages: 28, language: "uz", topic: "Mavzu", includeVisuals: true } as DocMeta;
const p = (text: string): Block => ({ kind: "p", text });
const words = (n: number, seed = "w") => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ");

const REFS: Reference[] = [{ id: "W1", kind: "article", title: "Reading", authors: ["Smith J."], year: 2021, verified: "openalex", cited: true }];

function makeDoc(o: { userFacts?: string; model?: Partial<WorkModel> } = {}): AcademicDoc {
  const model: WorkModel = {
    v: 1,
    genre: "coursework",
    kind: "theory",
    subject: "humanities",
    language: "uz",
    university: "TDU",
    faculty: "F",
    department: "K",
    subjectName: "Pedagogika",
    group: "301",
    course: "3",
    author: "Aliyev Ali",
    teacher: "Rahimov B.",
    city: "Toshkent",
    ministry: "oliy",
    chapters: [
      { id: "ch1", title: "Bob 1", paragraphs: [{ id: "ch1.1", title: "1.1", sectionId: "ch1.1" }, { id: "ch1.2", title: "1.2", sectionId: "ch1.2" }] },
    ],
    intro: { parts: {} as WorkModel["intro"]["parts"] },
    references: REFS,
    figures: [],
    refsMin: 15,
    ...(o.userFacts ? { userFacts: o.userFacts } : {}),
    ...(o.model ?? {}),
  };
  return {
    meta,
    titlePage: true,
    toc: true,
    sections: [
      { id: "intro", title: "Kirish", blocks: [p(`Mavzuning dolzarbligi. Ishning maqsadi — X. ${words(200, "i")}`)] },
      { id: "ch1", title: "Bob 1", blocks: [] },
      { id: "ch1.1", title: "1.1", blocks: [p(`${words(400, "a")} [W1].`), { kind: "figure", text: "Sxema", figureId: "f1" }] },
      { id: "ch1.2", title: "1.2", blocks: [p(`${words(400, "b")} [W1].`)] },
      { id: "conclusion", title: "Xulosa", blocks: [p(words(300, "c"))] },
    ],
    work: model,
  };
}

const check = (id: string, level: ReviewCheck["level"], fix?: ReviewCheck["fix"]): ReviewCheck => ({ id, level, label: id, ...(fix ? { fix } : {}) });

function makeReview(o: Partial<DocReview> = {}): DocReview {
  return {
    score: 70,
    checks: [],
    judgeNotes: [],
    verifiedShare: 1,
    recentShare: 1,
    builtAt: new Date().toISOString(),
    ...o,
  };
}

/* ───────────────────────────── reja ───────────────────────────── */

test("planWorkPolish: qoidalarning `fix` i rejaga tushadi, qizil AVVAL", () => {
  const doc = makeDoc();
  const review = makeReview({
    checks: [
      check("filler", "yellow", { op: "rewrite", target: "ch1.2", instruction: "Suvni olib tashlang" }),
      check("introParts", "red", { op: "rewrite", target: "intro", instruction: "Elementlarni yozing" }),
    ],
  });
  const plan = planWorkPolish(review, doc);
  assert.deepEqual(plan.fixes.map((f) => f.target), ["intro", "ch1.2"], "qizil band birinchi");
});

test("planWorkPolish: `refsCount`/`refsVerified` — `user`, `tocMatch`/`refsOrder` — `manual`, fix YO'Q", () => {
  const doc = makeDoc();
  const review = makeReview({
    checks: [check("refsCount", "red"), check("refsVerified", "yellow"), check("tocMatch", "yellow"), check("refsOrder", "yellow")],
  });
  const plan = planWorkPolish(review, doc);
  assert.deepEqual(plan.fixes, []);
  assert.deepEqual(
    plan.skipped.filter((s) => ["refsCount", "refsVerified"].includes(s.id)).map((s) => s.reason),
    ["user", "user"],
  );
  assert.deepEqual(
    plan.skipped.filter((s) => ["tocMatch", "refsOrder"].includes(s.id)).map((s) => s.reason),
    ["manual", "manual"],
  );
});

test("Q-2: tajriba/o'lchov talab qiladigan baholovchi tavsiyasi BAJARILMAYDI (faktlar bo'lsa ham)", () => {
  const dataFix = { op: "rewrite" as const, target: "ch1.1", instruction: "Add the statistical tests, p-values and the platform name used in the experiment." };
  // XAVFSIZ ko'rsatma: mavjud matn va manbalar bilan bajariladi, yangi
  // ma'lumot talab qilmaydi (`needsUserData` uni o'tkazib yuboradi).
  const safeFix = { op: "rewrite" as const, target: "ch1.2", instruction: "Rewrite so that each claim is tied to a cited source and the paragraph ends with the consequence for the topic." };
  const review = makeReview({ checks: [check("judge:fix:1", "yellow", dataFix), check("judge:fix:2", "yellow", safeFix)] });

  const noFacts = planWorkPolish(review, makeDoc());
  assert.deepEqual(noFacts.fixes.map((f) => f.target), ["ch1.2"]);
  assert.ok(noFacts.skipped.some((s) => s.id === "judge:fix:1" && s.reason === "user"));

  // Faktlar bor bo'lsa ham — o'ylab topish xavfi qoladi (AUDIT-18 jonli saboqi).
  const withFacts = planWorkPolish(review, makeDoc({ userFacts: "120 o'quvchi" }));
  assert.deepEqual(withFacts.fixes.map((f) => f.target), ["ch1.2"]);
  assert.ok(withFacts.skipped.some((s) => s.id === "judge:fix:1" && s.reason === "unreported"));
});

test("planWorkPolish: bitta nishon = bitta fix (ko'rsatmalar birlashadi), ≤6 nishon", () => {
  const doc = makeDoc();
  const review = makeReview({
    checks: [
      check("filler", "yellow", { op: "rewrite", target: "ch1.1", instruction: "Birinchi" }),
      check("repetition", "yellow", { op: "rewrite", target: "ch1.1", instruction: "Ikkinchi" }),
    ],
  });
  const plan = planWorkPolish(review, doc);
  assert.equal(plan.fixes.length, 1);
  assert.match(plan.fixes[0].instruction, /\(1\) Birinchi \(2\) Ikkinchi/);
  // Mavjud bo'lmagan nishon tushadi.
  const bad = planWorkPolish(makeReview({ checks: [check("filler", "yellow", { op: "rewrite", target: "yo-q", instruction: "x" })] }), doc);
  assert.deepEqual(bad.fixes, []);
});

test("workCriterionFixes: past mezon → HALOL ko'rsatma (o'z bo'limiga)", () => {
  const doc = makeDoc();
  const review = makeReview({ checks: [check("judge:logic", "red"), check("judge:aimMatch", "red"), check("judge:depth", "yellow"), check("judge:originality", "green"), check("judge:style", "green")] });
  const fixes = workCriterionFixes(review, doc);
  const targets = fixes.map((f) => f.target);
  assert.ok(targets.includes("intro"), "logic → kirish");
  assert.ok(targets.includes("conclusion"), "aimMatch → xulosa");
  assert.ok(targets.some((t) => t.startsWith("ch1.")), "depth → eng qisqa paragraf");
  // Hech bir ko'rsatma tajriba tafsilotini so'ramaydi (Q-2 bilan mos).
  for (const f of fixes) assert.doesNotMatch(f.instruction, /p-value|platform|statistical test/i);
  // Hammasi yashil — tuzatish yo'q.
  assert.deepEqual(workCriterionFixes(makeReview({ checks: [check("judge:logic", "green")] }), doc), []);
});

/* ───────────────────────────── «Sizdan kutiladi» ───────────────────────────── */

test("workUserNeeds: manbalar yetmasa — nechta yetishmasligi bilan; titul bo'sh maydonlari", () => {
  const doc = makeDoc();
  const review = makeReview({ checks: [check("refsCount", "red")] });
  const needs = workUserNeeds(review, doc);
  const refs = needs.find((n) => n.id === "refs");
  assert.ok(refs, "«Manbalar» bandi yo'q");
  assert.match(refs!.hint, /14 ta manba yetishmayapti/);
  assert.match(refs!.hint, /DOI\/ISBN|o‘zingiz qo‘shing/);
  // Titul to'liq — «Titul sahifasi» bandi yo'q.
  assert.ok(!needs.some((n) => n.id === "title"));
  const empty = makeDoc({ model: { university: "", teacher: "" } });
  const t = workUserNeeds(makeReview(), empty).find((n) => n.id === "title");
  assert.ok(t);
  assert.match(t!.hint, /oliy ta’lim muassasasi/);
  assert.match(t!.hint, /rahbar/);
});

test("workUserNeeds: faktlar yo'q + mezon qizil → «Materiallaringiz»; faktlar bor → yo'q", () => {
  const review = makeReview({ checks: [check("judge:depth", "red")] });
  assert.ok(workUserNeeds(review, makeDoc()).some((n) => n.id === "results"));
  assert.ok(!workUserNeeds(review, makeDoc({ userFacts: "120 o'quvchi" })).some((n) => n.id === "results"));
  // Mezon yashil bo'lsa — talab qilinmaydi.
  assert.ok(!workUserNeeds(makeReview({ checks: [check("judge:depth", "green")] }), makeDoc()).some((n) => n.id === "results"));
});

/* ───────────────────────────── qayta yozish ───────────────────────────── */

test("rewriteWorkFix: vizual blok saqlanadi, noma'lum iqtibos o'chadi, noma'lum nishon — xato", async () => {
  const doc = makeDoc();
  const complete = (async (_role: LlmRole, _system: string, user: string) => {
    assert.match(user, /HONESTY LIMIT/, "halollik chegarasi promptda");
    return { text: JSON.stringify({ blocks: [{ kind: "p", text: `Yangi matn [W1] va uydirma [W999]. ${words(80, "n")}` }] }) };
  }) as never;
  const out = await rewriteWorkFix(doc, { op: "rewrite", target: "ch1.1", instruction: "Chuqurlashtiring" }, { complete, deadline: Date.now() + 30_000 });
  assert.equal(out.ops.length, 1);
  assert.equal(out.ops[0].sectionId, "ch1.1");
  const text = out.ops[0].blocks.map((b) => b.text).join(" ");
  assert.ok(text.includes("[W1]"));
  assert.ok(!text.includes("W999"));
  assert.ok(out.ops[0].blocks.some((b) => b.kind === "figure"), "sxema bloki saqlanadi");
  await assert.rejects(() => rewriteWorkFix(doc, { op: "rewrite", target: "yo-q", instruction: "x" }, { complete, deadline: Date.now() + 30_000 }), /topilmadi/);
  // Bob sarlavhasi bo'limi nishon BO'LA OLMAYDI (matn yo'q).
  await assert.rejects(() => rewriteWorkFix(doc, { op: "rewrite", target: "ch1", instruction: "x" }, { complete, deadline: Date.now() + 30_000 }), /topilmadi/);
});

test("applyWorkSectionOps: bo'limni almashtiradi, asl hujjatga TEGMAYDI; bo'sh matn rad", () => {
  const doc = makeDoc();
  const before = doc.sections.find((s) => s.id === "ch1.2")!.blocks[0].text;
  const res = applyWorkSectionOps(doc, [{ op: "setSection", sectionId: "ch1.2", blocks: [p("Yangi")] }]);
  assert.ok(res.ok);
  assert.equal(res.ok && res.doc.sections.find((s) => s.id === "ch1.2")!.blocks[0].text, "Yangi");
  assert.equal(doc.sections.find((s) => s.id === "ch1.2")!.blocks[0].text, before, "asl hujjat o'zgarmaydi");
  assert.equal(applyWorkSectionOps(doc, [{ op: "setSection", sectionId: "yo-q", blocks: [p("x")] }]).ok, false);
  assert.equal(applyWorkSectionOps(doc, [{ op: "setSection", sectionId: "ch1.2", blocks: [] }]).ok, false);
});

/* ───────────────────────────── Q-3 / X-5 ───────────────────────────── */

test("Q-3 + X-5: ball AYNAN +2 oshsa RAD, +3 oshsa QABUL (standart chegara)", async () => {
  const doc = makeDoc();
  const fix = check("filler", "yellow", { op: "rewrite", target: "ch1.2", instruction: "Suvni olib tashlang" });
  const complete = (async () => ({ text: JSON.stringify({ blocks: [{ kind: "p", text: `Sayqallangan matn [W1]. ${words(400, "s")}` }] }) })) as never;
  const deps = { complete, deadline: Date.now() + 120_000, judge: false };

  // X-5: chegara AYNAN +2 — baholovchi ballari bir xil matnda ±5 tebranadi.
  assert.equal(WORK_ACCEPT_DELTA, 2);

  // 1-qadam: sayqaldan keyingi ballni o'lchaymiz (boshlang'ich ball ataylab past).
  const probe = await runWorkPolish(doc, makeReview({ score: 1, checks: [fix] }), deps);
  const after = probe.log.after;
  assert.ok(probe.accepted, "katta o'sish qabul bo'lishi kerak");

  // 2-qadam: o'sish AYNAN +2 — RAD (chegara qat'iy `>`), hujjat o'zgarmaydi.
  const exact = await runWorkPolish(doc, makeReview({ score: after - 2, checks: [fix] }), deps);
  assert.equal(exact.log.after, after);
  assert.equal(exact.accepted, false, `+2 o'sish qabul qilinmasligi kerak (${after - 2} → ${after})`);
  assert.equal(exact.doc, doc);

  // 3-qadam: o'sish +3 — QABUL.
  const enough = await runWorkPolish(doc, makeReview({ score: after - 3, checks: [fix] }), deps);
  assert.equal(enough.accepted, true, `+3 o'sish qabul qilinishi kerak (${after - 3} → ${after})`);

  // `acceptDelta: 0` bilan aynan +2 ham qabul bo'ladi — chegara haqiqatan ishlaydi.
  const loose = await runWorkPolish(doc, makeReview({ score: after - 2, checks: [fix] }), { ...deps, acceptDelta: 0 });
  assert.equal(loose.accepted, true);
});

test("runWorkPolish: fix bo'lmasa hech narsa qilinmaydi, `userNeeds` baribir yoziladi", async () => {
  const doc = makeDoc();
  const review = makeReview({ score: 70, checks: [check("refsCount", "red")] });
  const r = await runWorkPolish(doc, review, { complete: (async () => null) as never, deadline: Date.now() + 60_000, judge: false });
  assert.deepEqual(r.plan.fixes, []);
  assert.equal(r.accepted, false);
  assert.equal(r.doc, doc, "hujjat o'zgarmaydi");
  assert.ok(r.review.userNeeds?.some((n) => n.id === "refs"));
});

test("runWorkPolish: model javob bermasa — `skipped: error`, hujjat o'zgarmaydi", async () => {
  const doc = makeDoc();
  const review = makeReview({ score: 70, checks: [check("filler", "yellow", { op: "rewrite", target: "ch1.2", instruction: "Suvni olib tashlang" })] });
  const r = await runWorkPolish(doc, review, { complete: (async () => null) as never, deadline: Date.now() + 60_000, judge: false });
  assert.equal(r.accepted, false);
  assert.ok(r.log.skipped.some((s) => s.reason === "error"));
  assert.equal(r.doc, doc);
});

test("workJudgeFromReview: eski hisobotdan ballar ko'chadi, bandsiz mezon `skipped`", () => {
  const prev = makeReview({
    checks: [
      { id: "judge:logic", level: "green", label: "l", detail: "3/3" },
      { id: "judge:depth", level: "yellow", label: "d", detail: "2/3" },
      { id: "judge:style", level: "red", label: "s", detail: "1/3" },
      { id: "judge:aimMatch", level: "green", label: "a", detail: "3/3" },
    ],
    judgeNotes: ["izoh"],
  });
  const j = workJudgeFromReview(prev)!;
  assert.equal(j.logic, 3);
  assert.equal(j.depth, 2);
  assert.equal(j.style, 1);
  assert.deepEqual(j.skipped, ["originality"], "hisobotda yo'q mezon ballga kirmaydi");
  assert.deepEqual(j.notes, ["izoh"]);
  assert.equal(workJudgeFromReview(makeReview()), null, "baholovchi bandlari yo'q — null");
  assert.equal(workJudgeFromReview(undefined), null);
});

test("workContextOf: hujjatdan kontekst (forma qiymatlarisiz) — reja va mavzu joyida", () => {
  const doc = makeDoc({ userFacts: "120 o'quvchi" });
  const ctx = workContextOf(doc);
  assert.equal(ctx.kind.id, "theory");
  assert.equal(ctx.subject.id, "humanities");
  assert.equal(ctx.input.userFacts, "120 o'quvchi");
  assert.deepEqual(ctx.input.outline, [{ title: "Bob 1", paragraphs: ["1.1", "1.2"] }]);
  assert.ok(ctx.plan.body > 0);
  assert.equal(ctx.refs, doc.work!.references);
});

test("sayqal → qayta hisobot: qabul qilinganda YANGI matn va yangi hisobot qaytadi", async () => {
  const doc = makeDoc();
  // Hisobot sun'iy past: bitta qizil band (`filler`) fix bilan.
  const first = await reviewWork(doc, { judge: false });
  const review = { ...first, score: 1, checks: [...first.checks, check("filler", "red", { op: "rewrite", target: "ch1.2", instruction: "Suvni olib tashlang" })] };
  const complete = (async () => ({ text: JSON.stringify({ blocks: [{ kind: "p", text: `Aniq da'vo va mexanizm bayoni [W1]. ${words(400, "z")}` }] }) })) as never;
  const r = await runWorkPolish(doc, review, { complete, deadline: Date.now() + 120_000, judge: false });
  assert.equal(r.accepted, true, `ball ${r.log.before} → ${r.log.after}`);
  assert.ok(r.doc.sections.find((s) => s.id === "ch1.2")!.blocks[0].text.startsWith("Aniq da'vo"));
  assert.equal(r.review.polish?.accepted, true);
  // Qoidaning fix i + past baholangan mezonlarning halol tuzatishlari.
  assert.ok(r.review.polish?.applied.some((f) => f.target === "ch1.2"));
  assert.ok((r.review.polish?.applied.length ?? 0) <= 6, "bir sayqalda ko'pi bilan 6 nishon");
});
